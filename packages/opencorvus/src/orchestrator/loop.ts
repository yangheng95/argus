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
 *   - duplicate wake-suppression gates (the loop owns all waiting between pool drains)
 *   - infinite wake-up loops (no re-triggering — the loop decides)
 *
 * All timeouts are inactivity-based, never hard/absolute.
 */

import { Log } from "@/util/log"
import { GoalPool, type PoolHooks } from "@/engine/goal-pool"
import type { RuntimeHooks } from "@/engine/runtime-hooks"
import { Orchestrator, type OrchestratorTrigger } from "@/orchestrator/agent"
import { effectiveMaxExecutorGroups, findTask, findRun, findPlan, listGoalsByPlan, listPlanNodesByPlan } from "@/engine"
import type { TaskRow, RunRow, PlanRow } from "@/engine"
import { mergeGoalDelivery } from "@/engine/runtime"
import { describeTaskFromRow } from "@/engine/describe"
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

export type TaskLoopTrigger = OrchestratorTrigger

export async function runTaskLoop(input: {
  taskID: string
  trigger: TaskLoopTrigger
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
  trigger: TaskLoopTrigger
  signal?: AbortSignal
  hooks: RuntimeHooks
}) {
  const { taskID, signal, hooks } = input
  let trigger = input.trigger

  // Immediately mark the task as active so the cwd-scoped queue can observe
  // that this task now owns execution for its workspace before the first
  // orchestrator decision completes.
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
  /** Absolute task-level iteration budget — the sole runaway guard on this
   *  loop. Per LLM-autonomous redesign the loop does not classify "stuck"
   *  itself; if the LLM is not making progress it can read the trajectory
   *  on its next decision turn (via describe / query_metric_trajectory) and
   *  call fail_task. The hard ceiling only exists so a truly wedged LLM
   *  cannot burn unbounded decision rounds. Override via
   *  `OPENCORVUS_MAX_TASK_ITERATIONS` (e.g. 200 for a debug PRD run). */
  const MAX_TASK_ITERATIONS = parseInt(
    process.env.OPENCORVUS_MAX_TASK_ITERATIONS || "50",
    10,
  )
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
    if (
      (task.status === "completed" || task.status === "failed" || task.status === "cancelled") &&
      trigger.kind !== "operator_message" &&
      trigger.kind !== "retry"
    ) {
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
    if (taskAfter.status === "completed" || taskAfter.status === "failed" || taskAfter.status === "cancelled") {
      log.info("task entered terminal state after decision", {
        taskID,
        status: taskAfter.status,
        trigger: trigger.kind,
      })
      break
    }

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
        })
        trigger = {
          kind: "delivery_rejected",
          runID: taskAfter.active_run_id ?? "",
          feedback,
        }
        continue
      }
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

    // ── Phase 3: GoalPool — execute durable dispatch facts ──
    // dispatch_goal / submit_execution now materialize dispatch immediately as
    // queued goal_run rows. The pool consumes those authoritative queued tips;
    // there is no separate in-memory channel to recover after restart.
    const { listQueuedDispatchGoalIDs } = await import("./dispatch-queue")
    const pendingDispatch = listQueuedDispatchGoalIDs(taskID)

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
        log.warn("pending goals present but none dispatched — feeding to Orchestrator", {
          taskID, passed, failed,
          pending: goals.filter((g) => g.never_dispatched || g.needs_redispatch || g.is_aborted).length,
        })

        // No stale-state circuit breaker here — the LLM reads the same
        // goal / goal_run state via describe on the next decision turn
        // and decides whether to retry, modify a goal, fail, or wait.
        // The deterministic `MAX_STALE_ITERATIONS` breaker was an FSM
        // verdict over a goal_run snapshot string (CLAUDE.md #23) and
        // masked real failures as "stuck" rather than routing them to
        // the LLM for classification.

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
  // Queue progression is owned by engine/queue.ts. This loop only owns one
  // task's lifecycle and leaves sibling dispatch to the cwd queue.
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
