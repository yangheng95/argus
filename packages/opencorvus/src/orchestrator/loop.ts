/**
 * Task Control Loop — the single entry point for task lifecycle.
 *
 * Replaces fire-and-forget Orchestrator triggers with a structured loop:
 *   Decision Point (Orchestrator) → GoalPool (execution) → collect results → repeat
 *
 * What this eliminates:
 *   - recoverOrphanedTasks (loop IS the lifecycle)
 *   - notifyGoalResult fire-and-forget (pool drain collects results)
 *   - fire-and-forget agent-notification races (PerRunState claim+finalize
 *     runs on the single updateRun terminal transition, not scattered maps)
 *   - dispatch gate (Orchestrator only runs between pool drains)
 *   - infinite wake-up loops (no re-triggering — the loop decides)
 *
 * All timeouts are inactivity-based, never hard/absolute.
 */

import { Log } from "@/util/log"
import { GoalPool, type PoolHooks } from "@/engine/goal-pool"
import type { RuntimeHooks } from "@/engine/runtime-hooks"
import { Orchestrator } from "@/orchestrator/agent"
import { effectiveMaxExecutorGroups, findTask, findRun, findPlan, listGoalsByPlan, listPlanNodesByPlan, findNextQueuedTaskForProject } from "@/engine"
import type { TaskRow, RunRow, PlanRow } from "@/engine"
import { mergeGoalDelivery } from "@/engine/runtime"
import { describeTaskFromRow, statusOf } from "@/engine/describe"
import type { GoalDesc } from "@/engine/describe"
import { Database, eq } from "@/storage/db"
import { isRunReadyForGoalDispatch } from "./scheduler"

const log = Log.create({ service: "orchestrator-loop" })

/** Inactivity timeout for the Orchestrator Decision Point (no hard timeout). */
const DECISION_INACTIVITY_MS = parseInt(
  process.env.OPENCORVUS_DECISION_INACTIVITY_MS || String(10 * 60 * 1000), 10,
) // 10 min default — if Orchestrator produces no streaming tokens for 10 min, abort

const LOOP_SLEEP_TICK_MS = 50

// Per-taskID serial chain. A second runTaskLoop() call for the same task
// waits for the in-flight loop to finish, then runs a fresh decision pass —
// which reads the freshly-appended session message. Replaces the previous
// in-memory "is running" Set that silently dropped user messages into
// recordOperatorNote and was the root of the "queued, no resume" bug.
const taskLoopChain = new Map<string, Promise<void>>()
const taskLoopAbort = new Map<string, AbortController>()

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    const deadline = Date.now() + ms
    function tick() {
      if (signal?.aborted) {
        resolve()
        return
      }
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        resolve()
        return
      }
      setTimeout(tick, Math.min(LOOP_SLEEP_TICK_MS, remaining))
    }
    tick()
  })
}

function combineSignals(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const active = signals.filter((signal): signal is AbortSignal => !!signal)
  if (active.length === 0) return undefined
  if (active.length === 1) return active[0]

  const controller = new AbortController()
  const listeners = new Map<AbortSignal, () => void>()

  const abortFrom = (source: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(source.reason)
    for (const [signal, listener] of listeners) {
      signal.removeEventListener("abort", listener)
    }
    listeners.clear()
  }

  for (const signal of active) {
    if (signal.aborted) {
      abortFrom(signal)
      return controller.signal
    }
    const listener = () => abortFrom(signal)
    listeners.set(signal, listener)
    signal.addEventListener("abort", listener, { once: true })
  }

  return controller.signal
}

export function interruptTaskLoop(taskID: string, reason = "task loop interrupted") {
  taskLoopAbort.get(taskID)?.abort(reason)
  Orchestrator.abort(taskID)
}

export async function runTaskLoop(input: {
  taskID: string
  trigger: { kind: string; runID?: string; summary?: { passed: number; failed: number; total: number }; depBlocked?: Array<{ goalTitle: string; blockedBy: Array<{ title: string; status: string }> }> }
  signal?: AbortSignal
  hooks: RuntimeHooks
}) {
  const prev = taskLoopChain.get(input.taskID) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(async () => {
    const localAbort = new AbortController()
    taskLoopAbort.set(input.taskID, localAbort)
    try {
      await runTaskLoopInner({
        ...input,
        signal: combineSignals([input.signal, localAbort.signal]),
      })
    } finally {
      if (taskLoopAbort.get(input.taskID) === localAbort) {
        taskLoopAbort.delete(input.taskID)
      }
    }
  })
  taskLoopChain.set(input.taskID, next)
  // Clean up only if we're still the tail — a later call may have chained
  // on top of `next` before it resolved, and that one must stay in the map.
  next.finally(() => {
    if (taskLoopChain.get(input.taskID) === next) taskLoopChain.delete(input.taskID)
  })
  return next
}

/**
 * Run the full task lifecycle as a blocking loop.
 *
 * Returns when the task reaches a terminal state (completed, failed) or when
 * the signal is aborted. Concurrent entries for the same task are serialised
 * by `runTaskLoop` above.
 */
async function runTaskLoopInner(input: {
  taskID: string
  trigger: { kind: string; runID?: string; summary?: { passed: number; failed: number; total: number }; depBlocked?: Array<{ goalTitle: string; blockedBy: Array<{ title: string; status: string }> }> }
  signal?: AbortSignal
  hooks: RuntimeHooks
}) {
  const { taskID, signal, hooks } = input
  let trigger = input.trigger

  // Immediately mark the task as "active" so hasActiveTaskInProject() blocks
  // subsequent tasks from starting their loops concurrently. Without this,
  // a task stays "queued" through spec/requirements/architect phases, causing the
  // serial queue check to miss it and start a second task loop in parallel.
  {
    const { updateTask } = await import("@/engine/state")
    const task = findTask(taskID)
    if (task && task.status === "queued") {
      await updateTask(task, { status: "active" }, "Task loop started — marking active for serial queue")
    }
  }

  log.info("task loop started", { taskID, trigger: trigger.kind })

  // ── Main loop: Decision → Pool → Decision ──
  let iteration = 0
  /** Stale-state circuit breaker: fail the task if goal state does not change
   *  for MAX_STALE_ITERATIONS consecutive decision cycles. Catches the case
   *  where the LLM forgets to call dispatch_goal (no new goal_run rows). */
  const MAX_STALE_ITERATIONS = 5
  /** Absolute task-level iteration budget. Independent of stale detection —
   *  even if the LLM keeps producing small progress every cycle, it cannot
   *  burn more than this many decision rounds before the task is forced to
   *  fail. The LLM-autonomous redesign removed most FSM gates; this is the
   *  one hard ceiling that guarantees convergence in bounded time. Override
   *  via `OPENCORVUS_MAX_TASK_ITERATIONS` (e.g. 200 for a debug PRD run). */
  const MAX_TASK_ITERATIONS = parseInt(
    process.env.OPENCORVUS_MAX_TASK_ITERATIONS || "50",
    10,
  )
  let lastGoalSnapshot = ""
  let staleCount = 0
  /** Floor for `findRecentDeliveryRejection` — only consider verdict
   *  artifacts newer than this. Initialized to loop start so we don't react
   *  to pre-existing verdicts from previous loop runs of the same task
   *  (e.g. crash recovery), and bumped past every consumed artifact so a
   *  single rejection only fires the trigger once. */
  let lastReworkSeenAt = Date.now()

  while (!signal?.aborted) {
    iteration++
    const task = findTask(taskID)
    if (!task) { log.error("task not found, exiting loop", { taskID }); break }
    if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
      log.info("task in terminal state, exiting loop", { taskID, status: task.status })
      break
    }
    // Task-level iteration budget (hard ceiling). Prevents unbounded loops
    // when the LLM produces small progress each cycle but never converges.
    if (iteration > MAX_TASK_ITERATIONS) {
      const { updateTask } = await import("@/engine/state")
      log.error("task iteration budget exhausted — failing task", {
        taskID, iteration, max: MAX_TASK_ITERATIONS,
      })
      await updateTask(task, {
        status: "failed",
        error: `Task iteration budget exhausted: ${iteration}/${MAX_TASK_ITERATIONS}. ` +
          `Increase OPENCORVUS_MAX_TASK_ITERATIONS if the workload legitimately needs more rounds.`,
      }, "task-iteration budget")
      break
    }

    // ── Phase 1: Decision Point ──
    // Call Orchestrator with current state. It decides what to do:
    //   - dispatch goals → calls dispatch_goal/submit_execution tool → self-aborts
    //   - complete/fail task → calls fail_task/deliver tool → exits
    //   - no action → finishReason=stop with no dispatch
    log.info("decision point", { taskID, iteration, trigger: trigger.kind })

    let agentDispatched = false
    try {
      await Orchestrator.processTask(taskID, trigger as any)
      // Orchestrator finished. Check if it dispatched goals.
    } catch (err) {
      if (signal?.aborted) break
      log.error("orchestrator error at decision point", { taskID, error: String(err) })
      // Don't break — re-check task status and maybe retry
    }

    // Re-read task state after agent decision
    const taskAfter = findTask(taskID)
    if (!taskAfter) break

    // ── Delivery rejection detection ──
    // When the deliver tool rejects it writes a verdict artifact
    // (label="delivery-agent-verdict", payload.verdict="rejected") and calls
    // startNewAttempt on the goals the delivery agent attributed the rejection
    // to (verdict.affected_goal_ids). This block watermarks the artifact
    // stream so the orchestrator agent gets a `delivery_rejected` trigger
    // with structured feedback on its next decision point. The orchestrator
    // reads affected_goal_ids + rejection_details to decide strategy
    // (modify_goal vs re-run architect vs let-it-redispatch).
    //
    // Keyed on the verdict artifact — NOT on goal_run.superseded_reason
    // string matching. Per rule 23 we do not branch on enum label values;
    // the artifact is the first-class delivery output.
    if (taskAfter.status === "active") {
      const { findRecentDeliveryRejection } = await import("@/engine/store")
      const verdictArt = findRecentDeliveryRejection(taskID, lastReworkSeenAt)
      if (verdictArt) {
        lastReworkSeenAt = (verdictArt.time_created ?? Date.now()) + 1
        const verdict = (verdictArt.payload ?? {}) as Record<string, unknown>
        const feedback: Record<string, unknown> = {
          verdict_summary: verdict.summary,
          issues_found: Array.isArray(verdict.issues_found) ? verdict.issues_found : [],
          affected_goal_ids: Array.isArray(verdict.affected_goal_ids) ? verdict.affected_goal_ids : [],
          rejection_details: Array.isArray(verdict.rejection_details) ? verdict.rejection_details : [],
          startup_verification: verdict.startup_verification,
          frontend_check: verdict.frontend_check,
          verdict_artifact_id: verdictArt.id,
        }
        log.info("delivery rejection detected — re-triggering orchestrator", {
          taskID,
          verdictArtifactID: verdictArt.id,
          issues: Array.isArray(feedback.issues_found) ? (feedback.issues_found as unknown[]).length : 0,
        })

        // Reset stale counter — delivery rejection is genuine progress
        lastGoalSnapshot = ""
        staleCount = 0

        trigger = {
          kind: "delivery_rejected",
          runID: taskAfter.active_run_id ?? "",
          feedback,
        } as any
        continue // Skip Phase 2/3, go straight back to Decision Point
      }
    }

    if (taskAfter.status === "completed" || taskAfter.status === "failed" || taskAfter.status === "cancelled") {
      log.info("task reached terminal state after decision", { taskID, status: taskAfter.status })
      break
    }

    // ── Phase 2: Check if goals were dispatched ──
    // If Orchestrator called dispatch tools, goals are now running.
    // We need to wait for them to complete.
    const run = taskAfter.active_run_id ? findRun(taskAfter.active_run_id) : undefined

    // Guard: if active goal runs exist (dispatch gate suppressed Orchestrator),
    // wait before re-checking instead of busy-looping. Active goal runs mean
    // the executor is still working — poll every 5s until they complete or fail.
    if (run) {
      const { listActiveGoalRunsForRun } = await import("@/engine/store")
      const activeRuns = listActiveGoalRunsForRun(run.id)
      if (activeRuns.length > 0) {
        log.info("active goal runs present, waiting before re-check", {
          taskID, activeGoalRuns: activeRuns.length,
          goalRunIDs: activeRuns.map(gr => gr.id),
        })
        await sleep(5_000, signal)
        if (signal?.aborted) break
        trigger = { kind: "batch_complete", runID: run.id, summary: { passed: 0, failed: 0, total: 0 } }
        continue
      }
    }
    if (!run || !run.plan_version_id) {
      // No run or no plan — Orchestrator didn't dispatch anything.
      // Could be: still in spec/requirements/architect phase.
      // The Orchestrator's tool calls (spec, requirements, etc.) are handled within processTask.
      // Loop back to decision point.
      log.info("no active run with plan, re-triggering", { taskID })
      trigger = { kind: "batch_complete", runID: run?.id ?? "", summary: { passed: 0, failed: 0, total: 0 } }
      continue
    }

    const plan = findPlan(run.plan_version_id)
    if (!plan) {
      log.warn("plan not found", { taskID, planID: run.plan_version_id })
      trigger = { kind: "batch_complete", runID: run.id, summary: { passed: 0, failed: 0, total: 0 } }
      continue
    }

    if (!isRunReadyForGoalDispatch({ status: run.status, planVersionID: run.plan_version_id })) {
      log.info("active run is not dispatchable yet", {
        taskID,
        runID: run.id,
        status: run.status,
      })
      trigger = { kind: "batch_complete", runID: run.id, summary: { passed: 0, failed: 0, total: 0 } }
      continue
    }

    // Check if there are any active/pending goals to wait for. Read from
    // the describe layer (event-sourced projection) instead of engine_goal.status
    // — the cache is going away in Phase 3, and this loop is where the
    // "stale status cache → deadlock" class of bugs lived.
    const snapshot = await describeTaskFromRow(taskAfter)
    const goals: GoalDesc[] = snapshot.goals
    const hasActive = goals.some((g) => g.is_running)
    const hasPending = goals.some((g) => g.never_dispatched || g.needs_redispatch || g.is_aborted)

    if (!hasActive && !hasPending) {
      // All goals are in terminal state. Feed results back to Orchestrator.
      const passed = goals.filter((g) => g.is_terminal_ok).length
      const failed = goals.filter((g) => g.is_terminal_fail).length
      log.info("all goals in terminal state", { taskID, passed, failed })
      trigger = {
        kind: "batch_complete",
        runID: run.id,
        summary: { passed, failed, total: goals.length },
      }
      continue
    }

    // ── Phase 3: GoalPool — execute the LLM's dispatch decision ──
    // The pool runs whatever IDs the LLM just pushed onto the dispatch queue
    // via dispatch_goal (orchestrator/dispatch-queue.ts). When the queue is
    // empty — the LLM didn't dispatch anything this turn — the pool is not
    // instantiated; the loop feeds a batch_complete trigger so the LLM can
    // decide again from the latest describe snapshot. Stale-state detection
    // is the hard backstop against "LLM never calls dispatch_goal."
    const { pullDispatch } = await import("./dispatch-queue")
    const pendingDispatch = pullDispatch(taskID)

    if (pendingDispatch.length > 0) {
      const concurrency = await effectiveMaxExecutorGroups(taskAfter)
      log.info("goal pool starting", {
        taskID, concurrency,
        dispatching: pendingDispatch.length,
        ids: pendingDispatch,
      })

      const poolHooks: PoolHooks = {
        mergeDelivery: (t, r, p, gr, delivery) => mergeGoalDelivery(t, r, p, gr, delivery, hooks),
        updateRun: async (run, update, reason) => {
          await hooks.updateRun(run, update as any, reason)
        },
        onGoalResult: (result) => {
          log.info("goal result", { taskID, goalID: result.goalID, status: result.status, verdict: result.verdict })
        },
      }

      const pool = new GoalPool({
        task: taskAfter,
        run,
        plan,
        concurrency,
        signal,
        hooks: poolHooks,
      })

      pool.submit(pendingDispatch)

      if (pool.activeCount > 0 || pool.queuedCount > 0) {
        const results = await pool.drain()
        log.info("goal pool drained", {
          taskID, results: results.length,
          passed: results.filter(r => r.status === "passed").length,
          failed: results.filter(r => r.status === "failed").length,
        })
      } else {
        log.info("pool had nothing to run — all requested IDs skipped by idempotency", {
          taskID, requested: pendingDispatch,
        })
      }
    } else if (hasActive) {
      // Goals from a previous iteration are still running — wait via polling
      log.info("waiting for already-running goals", { taskID })
      await waitForGoalCompletion(taskID, run, plan, signal)
    } else {
      // No active pool submissions, no running goals: pool returned no
      // dispatchable IDs this iteration. Feed back to the Orchestrator —
      // the describe layer shows WHY each goal isn't dispatchable (running /
      // terminal_ok / never_dispatched / needs_redispatch / unsatisfied
      // depends_on flags on each GoalDesc), so the LLM can decide whether
      // to retry, modify, add, or give up without a per-goal diagnostics
      // block injected from the loop.
      log.info("no dispatchable goals", { taskID, pending: hasPending })
      if (hasPending) {
        const passed = goals.filter((g) => g.is_terminal_ok).length
        const failed = goals.filter((g) => g.is_terminal_fail).length
        const { listGoalRunsForDispatch } = await import("@/engine/store")
        const goalRuns = listGoalRunsForDispatch(taskID)

        log.warn("pending goals present but none dispatched — feeding to Orchestrator", {
          taskID, passed, failed,
          pending: goals.filter((g) => g.never_dispatched || g.needs_redispatch || g.is_aborted).length,
        })

        // Stale-state detection on immutable goal_run history — the rule
        // is unchanged: the task is stuck when the chain hasn't grown and
        // no transitions happened for MAX_STALE_ITERATIONS decision cycles.
        const snapshot = goalRuns
          .map((r) => `${r.id}:${r.status}:${(r as { supersede_of?: string | null }).supersede_of ?? ""}`)
          .sort()
          .join(",")
        if (snapshot === lastGoalSnapshot) {
          staleCount++
          log.warn("stale state detected", { taskID, staleCount, maxStale: MAX_STALE_ITERATIONS })
          if (staleCount >= MAX_STALE_ITERATIONS) {
            const breakdown = await classifyBreakerCause(
              taskID,
              goals.map((g) => ({ id: g.id, title: g.title, status: statusOf(g) })),
              goalRuns,
              [],
            )
            log.error("stale-state circuit breaker triggered — failing task", {
              taskID, staleCount, cause: breakdown.cause, detail: breakdown.detail,
            })
            const { updateTask } = await import("@/engine/state")
            await updateTask(task, {
              status: "failed",
              error:
                `Task stuck: ${staleCount} consecutive decision cycles with no progress.\n` +
                `Cause: ${breakdown.cause}.\n${breakdown.detail}`,
            }, "Stale-state circuit breaker")
            break
          }
        } else {
          lastGoalSnapshot = snapshot
          staleCount = 0
        }

        trigger = {
          kind: "batch_complete",
          runID: run.id,
          summary: { passed, failed, total: goals.length },
        }
        continue
      }
      // All goals terminal — will be handled at top of next iteration
    }

    // Dependency cascade removed — Orchestrator decides whether to retry, skip,
    // or fail dependent goals. Automatic cascade masks the real failure and
    // prevents the agent from attempting recovery strategies.
    const snapshotAfter = await describeTaskFromRow(taskAfter)
    const goalsAfter: GoalDesc[] = snapshotAfter.goals

    // ── Phase 5: Collect results and loop back ──
    const failedGoals = goalsAfter.filter((g) => g.is_terminal_fail)
    const passedGoals = goalsAfter.filter((g) => g.is_terminal_ok)
    const pendingGoals = goalsAfter.filter((g) => g.never_dispatched || g.needs_redispatch || g.is_aborted)

    log.info("goal batch complete", {
      taskID,
      passed: passedGoals.length,
      failed: failedGoals.length,
      pending: pendingGoals.length,
    })

    // GoalPool executed goals → state changed → reset stale counter
    const snapshotAfterPool = goalsAfter.map((g) => `${g.id}:${statusOf(g)}`).sort().join(",")
    if (snapshotAfterPool !== lastGoalSnapshot) {
      lastGoalSnapshot = snapshotAfterPool
      staleCount = 0
    }

    trigger = {
      kind: "batch_complete",
      runID: run.id,
      summary: {
        passed: passedGoals.length,
        failed: failedGoals.length,
        total: goalsAfter.length,
      },
    }
  }

  log.info("task loop exited", { taskID, iteration })
  // When the loop exits without the task reaching terminal, the task stays
  // at status="active" in DB. The next user message will append to the
  // session and call runTaskLoop() again — the per-taskID serial chain
  // ensures it runs after this call returns. No auto-restart, no new
  // status enum, no in-memory "is running" flag.

  // Serial queue: when this task's loop exits, start the next queued task in the project.
  const completedTask = findTask(taskID)
  if (completedTask?.project_id) {
    const next = findNextQueuedTaskForProject(completedTask.project_id)
    if (next) {
      log.info("serial queue: starting next queued task", { nextTaskID: next.id, projectID: completedTask.project_id })
      import("@/engine/state").then(async ({ hooks }) => {
        runTaskLoop({ taskID: next.id, trigger: { kind: "queued" }, hooks: hooks() }).catch((err) => {
          log.error("serial queue: task loop failed", { taskID: next.id, error: err instanceof Error ? err.message : String(err) })
        })
      })
    }
  }
}

/**
 * Produce a concrete explanation for why the stale-state circuit breaker
 * fired. Reads engine_goal_run, engine_delivery, engine_evaluation to
 * distinguish the realistic shapes of "stuck":
 *
 *  - deps_unsatisfied: pending goals waiting on failed/missing upstream goals
 *  - stranded_pending: pending goals with deps met but never dispatched
 *    (readiness filter bug, supersede leak, live row without progress)
 *  - delivery_unverified: deliveries exist but their evaluation stayed
 *    pending/inconclusive for the breaker window — deliver tool stuck
 *  - goal_runs_wedged: live goal_runs never transitioned to terminal
 *  - unknown: fallback with raw counts for triage
 */
async function classifyBreakerCause(
  taskID: string,
  goals: Array<{ id: string; status: string; title: string }>,
  goalRuns: Array<{ id: string; goal_id: string; status: string; time_updated: number; supersede_of?: string | null }>,
  diag: Array<{ goalID: string; goalTitle: string; unsatisfiedDeps: Array<{ depGoalTitle: string; depStatus: string }> }>,
): Promise<{ cause: string; detail: string }> {
  const { findDeliveriesForTask, findEvaluationsByTask } = await loadStore()
  const deliveries = findDeliveriesForTask(taskID)
  const evaluations = findEvaluationsByTask(taskID)
  const pendingGoals = goals.filter((g) => g.status === "pending")
  const supersededIDs = new Set(
    goalRuns
      .map((r) => (r as { supersede_of?: string | null }).supersede_of)
      .filter((x): x is string => !!x),
  )
  const liveTips = goalRuns.filter(
    (r) =>
      !supersededIDs.has(r.id) &&
      ["queued", "accepted", "planning", "running", "evaluating", "blocked"].includes(r.status),
  )
  // Per-goal deliveries (goal_run_id != null) do not create an evaluation
  // row (persistGoalDelivery writes delivery+artifacts only) — the
  // delivery-agent's checks cover per-goal verdicts at task-level time.
  // Only task-level deliveries (goal_run_id == null, written by
  // persistTaskDelivery) own a `scope='delivery'` evaluation that the
  // deliver tool settles. If ALL of those are pending past the stale
  // window, the deliver tool is wedged — that's the real
  // "delivery_unverified" signal.
  const unverifiedDeliveries = deliveries.filter((d) => {
    if (d.status !== "candidate") return false
    if (d.goal_run_id) return false
    const ev = evaluations.find((e) => e.delivery_id === d.id)
    return !ev || ev.status === "pending"
  })

  if (diag.length > 0) {
    const blocked = diag.map((d) =>
      `"${d.goalTitle}" blocked by: ${d.unsatisfiedDeps.map((dep) => `${dep.depGoalTitle} [${dep.depStatus}]`).join(", ")}`,
    ).join("; ")
    return { cause: "deps_unsatisfied", detail: blocked }
  }
  if (unverifiedDeliveries.length > 0) {
    const list = unverifiedDeliveries.map((d) => `${d.id}@${d.goal_run_id ?? "run"}`).join(", ")
    return {
      cause: "delivery_unverified",
      detail: `${unverifiedDeliveries.length} delivery candidates with pending evaluation: ${list}`,
    }
  }
  if (liveTips.length > 0) {
    const list = liveTips.map((r) => `${r.id}[${r.status}]`).join(", ")
    return {
      cause: "goal_runs_wedged",
      detail: `${liveTips.length} live goal_run(s) that never transitioned to terminal: ${list}`,
    }
  }
  if (pendingGoals.length > 0) {
    const titles = pendingGoals.map((g) => g.title).join(", ")
    return {
      cause: "stranded_pending",
      detail:
        `${pendingGoals.length} pending goal(s) with no unmet deps but no ready dispatch: ${titles}. ` +
        `This indicates a readiness filter bug (supersede chain / live row leak) — inspect engine_goal_run rows for this task.`,
    }
  }
  return {
    cause: "unknown",
    detail: `goals=${goals.length} goal_runs=${goalRuns.length} deliveries=${deliveries.length} evaluations=${evaluations.length}`,
  }
}

async function loadStore() {
  const mod = await import("@/engine/store")
  return mod as typeof import("@/engine/store")
}

/**
 * Wait for all currently-running goals to reach terminal state.
 *
 * Polls goal_run status (not just goal status) because goals stay "running"
 * until the executor pipeline completes. Goal_run status transitions
 * (accepted → running → completed/failed) happen in real-time.
 *
 * Uses inactivity detection: if no goal_run changes status for DECISION_INACTIVITY_MS,
 * we break out and let the loop re-decide.
 */
async function waitForGoalCompletion(
  taskID: string,
  run: RunRow,
  plan: PlanRow,
  signal?: AbortSignal,
) {
  const { listGoalRunsForRun, listActiveGoalRunsForRun } = await import("@/engine/store")

  const POLL_INTERVAL = 5_000 // 5 seconds
  let lastChange = Date.now()
  let lastSnapshot = ""

  while (!signal?.aborted) {
    await sleep(POLL_INTERVAL, signal)
    if (signal?.aborted) break

    // Check goal_run status (more granular than goal status)
    const activeGoalRuns = listActiveGoalRunsForRun(run.id)
    const allGoalRuns = listGoalRunsForRun(run.id)
    const snapshot = allGoalRuns.map(gr => `${gr.id}:${gr.status}`).join(",")

    if (snapshot !== lastSnapshot) {
      lastSnapshot = snapshot
      lastChange = Date.now()
    }

    // All goal_runs done?
    if (activeGoalRuns.length === 0) {
      // Cross-check: even without active goal_runs, the derive layer may
      // still report a goal as running if its tip row is in a live state
      // that the store query didn't return (transactional race). Treat
      // that as "still settling" and keep polling instead of declaring
      // completion prematurely.
      const task = findTask(taskID)
      if (!task) return
      const descAfter = await describeTaskFromRow(task)
      const runningGoals = descAfter.goals.filter((g) => g.is_running)
      if (runningGoals.length === 0) {
        log.info("all goals completed", { taskID })
        return
      }
      continue
    }

    // Inactivity check
    const inactiveMs = Date.now() - lastChange
    if (inactiveMs > DECISION_INACTIVITY_MS) {
      log.warn("goal completion wait timed out (inactivity)", {
        taskID, inactiveMs, activeGoalRuns: activeGoalRuns.length,
      })
      return
    }

    // Re-check task status
    const task = findTask(taskID)
    if (!task || task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
      return
    }
  }
}
