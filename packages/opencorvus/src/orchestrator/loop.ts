/**
 * Task Control Loop — the single entry point for task lifecycle.
 *
 * Replaces fire-and-forget Orchestrator triggers with a structured loop:
 *   Decision Point (Orchestrator) → GoalPool (execution) → collect results → repeat
 *
 * What this eliminates:
 *   - recoverOrphanedTasks (loop IS the lifecycle)
 *   - notifyGoalResult fire-and-forget (pool drain collects results)
 *   - agentNotifiedRuns dedup (single control point)
 *   - dispatch gate (Orchestrator only runs between pool drains)
 *   - infinite wake-up loops (no re-triggering — the loop decides)
 *
 * All timeouts are inactivity-based, never hard/absolute.
 */

import { Log } from "@/util/log"
import { GoalPool, type PoolHooks } from "@/engine/goal-pool"
import type { RuntimeHooks } from "@/engine/runtime-hooks"
import { Orchestrator } from "@/orchestrator/agent"
import { effectiveMaxExecutorGroups } from "@/engine/helpers"
import { mergeGoalDelivery } from "@/engine/runtime"
import { Database, eq } from "@/storage/db"
import { blockedGoalDiagnostics } from "@/goal/readiness"
import {
  findTask,
  findRun,
  findPlan,
  listGoalsByPlan,
  listPlanNodesByPlan,
  findNextQueuedTaskForProject,
  type TaskRow,
  type RunRow,
} from "@/engine/store"
import type { PlanRow } from "@/engine/store"

const log = Log.create({ service: "orchestrator-loop" })

// Guard: only one loop per task. Prevents orphan recovery from starting
// a second loop while one is already running.
const activeLoops = new Set<string>()

/** Check if a task loop is actively running for the given task ID. */
export function isTaskLoopActive(taskID: string): boolean {
  return activeLoops.has(taskID)
}

/** Inactivity timeout for the Orchestrator Decision Point (no hard timeout). */
const DECISION_INACTIVITY_MS = parseInt(
  process.env.OPENCORVUS_DECISION_INACTIVITY_MS || String(10 * 60 * 1000), 10,
) // 10 min default — if Orchestrator produces no streaming tokens for 10 min, abort

/**
 * Run the full task lifecycle as a blocking loop.
 *
 * Called once per task. Returns when the task reaches a terminal state
 * (completed, failed) or when the signal is aborted.
 */
export async function runTaskLoop(input: {
  taskID: string
  trigger: { kind: string; runID?: string; summary?: { passed: number; failed: number; total: number }; depBlocked?: Array<{ goalTitle: string; blockedBy: Array<{ title: string; status: string }> }> }
  signal?: AbortSignal
  hooks: RuntimeHooks
}) {
  const { taskID, signal, hooks } = input
  let trigger = input.trigger

  // Prevent duplicate loops for the same task
  if (activeLoops.has(taskID)) {
    log.info("task loop already running, skipping", { taskID })
    return
  }
  activeLoops.add(taskID)

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
   *  for MAX_STALE_ITERATIONS consecutive decision cycles. This prevents the
   *  infinite loop where pending goals are blocked by failed deps and the
   *  Orchestrator cannot (or refuses to) resolve the situation. */
  const MAX_STALE_ITERATIONS = 5
  let lastGoalSnapshot = ""
  let staleCount = 0

  while (!signal?.aborted) {
    iteration++
    const task = findTask(taskID)
    if (!task) { log.error("task not found, exiting loop", { taskID }); break }
    if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
      log.info("task in terminal state, exiting loop", { taskID, status: task.status })
      break
    }

    // ── Phase 1: Decision Point ──
    // Call Orchestrator with current state. It decides what to do:
    //   - dispatch goals → calls dispatch_ready_goals/submit_execution tool → self-aborts
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

    // ── Delivery rework detection ──
    // When the deliver tool rejects within the iteration budget, it writes
    // _delivery_rework into metadata and aborts (WITHOUT failing the task).
    // Detect this one-shot signal and re-trigger the orchestrator with a
    // delivery_rejected trigger BEFORE entering Phase 2/3 — the agent
    // needs to see the feedback and modify goals before re-execution.
    const taskAfterMeta = (taskAfter.metadata ?? {}) as Record<string, unknown>
    if (taskAfterMeta._delivery_rework && taskAfter.status === "active") {
      const rework = taskAfterMeta._delivery_rework as Record<string, unknown>
      log.info("delivery rework detected — re-triggering orchestrator", {
        taskID,
        iteration: rework.iteration,
        issues: Array.isArray(rework.issues_found) ? (rework.issues_found as unknown[]).length : 0,
      })
      // Clear the one-shot signal (full history preserved in _delivery_rework_history)
      const { updateTask } = await import("@/engine/state")
      const cleanMeta = { ...taskAfterMeta }
      delete cleanMeta._delivery_rework
      await updateTask(taskAfter, { metadata: cleanMeta }, "Consumed delivery rework signal")

      // Reset stale counter — delivery rework is genuine progress
      lastGoalSnapshot = ""
      staleCount = 0

      trigger = {
        kind: "delivery_rejected",
        runID: taskAfter.active_run_id ?? "",
        feedback: rework,
      } as any
      continue // Skip Phase 2/3, go straight back to Decision Point
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
      const { listActiveGoalRunsByCoordinator } = await import("@/engine/store")
      const activeRuns = listActiveGoalRunsByCoordinator(run.id)
      if (activeRuns.length > 0) {
        log.info("active goal runs present, waiting before re-check", {
          taskID, activeGoalRuns: activeRuns.length,
          goalRunIDs: activeRuns.map(gr => gr.id),
        })
        await new Promise(r => setTimeout(r, 5_000))
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

    // Check if there are any active/pending goals to wait for
    const goals = listGoalsByPlan(plan.id)
    const hasActive = goals.some(g => g.status === "running")
    const hasPending = goals.some(g => g.status === "pending")

    if (!hasActive && !hasPending) {
      // All goals are in terminal state. Feed results back to Orchestrator.
      const passed = goals.filter(g => g.status === "passed").length
      const failed = goals.filter(g => g.status === "failed").length
      log.info("all goals in terminal state", { taskID, passed, failed })
      trigger = {
        kind: "batch_complete",
        runID: run.id,
        summary: { passed, failed, total: goals.length },
      }
      continue
    }

    // ── Phase 3: GoalPool — queue-based execution ──
    // GoalPool handles: worktree → executor → delivery → eval → cleanup.
    // Pool auto-fills slots as goals complete (respecting dependency DAG).
    const concurrency = effectiveMaxExecutorGroups(taskAfter)
    log.info("goal pool starting", {
      taskID, concurrency,
      pending: goals.filter(g => g.status === "pending").length,
      running: goals.filter(g => g.status === "running").length,
    })

    const poolHooks: PoolHooks = {
      mergeDelivery: (t, r, p, gr, delivery) => mergeGoalDelivery(t, r, p, gr, delivery, hooks),
      updateRun: async (run, update, reason) => {
        // RuntimeHooks.updateRun returns RunRow; PoolHooks.updateRun returns void.
        // Pool doesn't need the returned row.
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

    // Submit all ready goals — pool handles dependency ordering internally
    pool.submit()

    if (pool.activeCount > 0 || pool.queuedCount > 0) {
      const results = await pool.drain()
      log.info("goal pool drained", {
        taskID, results: results.length,
        passed: results.filter(r => r.status === "passed").length,
        failed: results.filter(r => r.status === "failed").length,
      })
    } else if (hasActive) {
      // Goals from a previous iteration are still running — wait via polling
      log.info("waiting for already-running goals", { taskID })
      await waitForGoalCompletion(taskID, run, plan, signal)
    } else {
      // No ready goals, no running goals — deps not met or all done
      log.info("no dispatchable goals", { taskID, pending: hasPending })
      if (hasPending) {
        // Pending goals exist but none are ready (deps not met or plan node mismatch).
        // Feed back to Orchestrator as a batch_complete so it can decide to retry/fail/skip.
        const passed = goals.filter(g => g.status === "passed").length
        const failed = goals.filter(g => g.status === "failed").length
        const nodes = listPlanNodesByPlan(plan.id)
        const { listGoalRunsByCoordinator } = await import("@/engine/store")
        const goalRuns = listGoalRunsByCoordinator(run.id)
        const diag = blockedGoalDiagnostics(nodes, goals, goalRuns)

        log.warn("pending goals blocked — feeding to Orchestrator", {
          taskID, passed, failed,
          pending: goals.filter(g => g.status === "pending").length,
          blockedGoals: diag.map(d => d.goalTitle),
        })

        // Stale-state detection: same goal snapshot as last time?
        const snapshot = goals.map(g => `${g.id}:${g.status}`).sort().join(",")
        if (snapshot === lastGoalSnapshot) {
          staleCount++
          log.warn("stale state detected", { taskID, staleCount, maxStale: MAX_STALE_ITERATIONS })
          if (staleCount >= MAX_STALE_ITERATIONS) {
            const blockedSummary = diag.map(d =>
              `"${d.goalTitle}" blocked by: ${d.unsatisfiedDeps.map(dep => `${dep.depGoalTitle} [${dep.depStatus}]`).join(", ")}`
            ).join("; ")
            log.error("stale-state circuit breaker triggered — failing task", {
              taskID, staleCount, blockedSummary,
            })
            const { updateTask } = await import("@/engine/state")
            await updateTask(task, {
              status: "failed",
              error: `Task stuck: ${staleCount} consecutive decision cycles with no progress. Pending goals permanently blocked by failed dependencies: ${blockedSummary}`,
            }, "Stale-state circuit breaker")
            break
          }
        } else {
          lastGoalSnapshot = snapshot
          staleCount = 0
        }

        // Inject dep-blocked diagnostics into the trigger so the Orchestrator
        // knows exactly which goals are blocked and why.
        const depBlocked = diag.map(d => ({
          goalTitle: d.goalTitle,
          blockedBy: d.unsatisfiedDeps.map(dep => ({ title: dep.depGoalTitle, status: dep.depStatus })),
        }))

        trigger = {
          kind: "batch_complete",
          runID: run.id,
          summary: { passed, failed, total: goals.length },
          depBlocked: depBlocked.length > 0 ? depBlocked : undefined,
        }
        continue
      }
      // All goals terminal — will be handled at top of next iteration
    }

    // Dependency cascade removed — Orchestrator decides whether to retry, skip,
    // or fail dependent goals. Automatic cascade masks the real failure and
    // prevents the agent from attempting recovery strategies.
    const goalsAfter = listGoalsByPlan(plan.id)

    // ── Phase 5: Collect results and loop back ──
    const failedGoals = goalsAfter.filter(g => g.status === "failed")
    const passedGoals = goalsAfter.filter(g => g.status === "passed")
    const pendingGoals = goalsAfter.filter(g => g.status === "pending")

    log.info("goal batch complete", {
      taskID,
      passed: passedGoals.length,
      failed: failedGoals.length,
      pending: pendingGoals.length,
    })

    // GoalPool executed goals → state changed → reset stale counter
    const snapshotAfterPool = goalsAfter.map(g => `${g.id}:${g.status}`).sort().join(",")
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

  activeLoops.delete(taskID)
  log.info("task loop exited", { taskID, iteration })

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
  const { listGoalRunsByCoordinator, listActiveGoalRunsByCoordinator } = await import("@/engine/store")

  const POLL_INTERVAL = 5_000 // 5 seconds
  let lastChange = Date.now()
  let lastSnapshot = ""

  while (!signal?.aborted) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL))
    if (signal?.aborted) break

    // Check goal_run status (more granular than goal status)
    const activeGoalRuns = listActiveGoalRunsByCoordinator(run.id)
    const allGoalRuns = listGoalRunsByCoordinator(run.id)
    const snapshot = allGoalRuns.map(gr => `${gr.id}:${gr.status}`).join(",")

    if (snapshot !== lastSnapshot) {
      lastSnapshot = snapshot
      lastChange = Date.now()
    }

    // All goal_runs done?
    if (activeGoalRuns.length === 0) {
      // Also check goal status
      const goals = listGoalsByPlan(plan.id)
      const runningGoals = goals.filter(g => g.status === "running")
      if (runningGoals.length === 0) {
        log.info("all goals completed", { taskID })
        return
      }
      // Goal_runs done but goals still "running" — pipeline may still be wrapping up.
      // Give it some time (don't timeout yet).
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
