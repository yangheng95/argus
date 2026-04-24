/**
 * Goal Executor — thin execution wrapper for a single goal.
 *
 * NOT a pipeline. NOT a state machine. Just executes a goal and returns delivery.
 * All decisions (when to plan, when to eval, how to retry) are made by the
 * Orchestrator (LLM), not by this code.
 *
 * What this module does:
 *   1. Stream executor events (for session projection)
 *   2. Extract delivery diffs from worktree
 *   3. Update goal_run status in DB
 *   4. That's it. No planning, no evaluation, no retry logic.
 *
 * IMPORTANT: This is INFRASTRUCTURE. Per the architecture spec:
 *   - goal_run writer: Infrastructure (this file)
 *   - goal writer: Orchestrator ONLY
 *   - Infrastructure NEVER writes goal.status — that's the Orchestrator's decision.
 */

import { Log } from "@/util/log"
import { Event, EngineProtocol, updateGoalRun, updateGoalRunExecutorSessionStatus, persistGoalDelivery } from "@/engine"
import { Database, eq, and } from "@/storage/db"
import { Identifier } from "@/id/id"
import { deliveryFromWorktree } from "@/goal/runner"
import { extractGoalReport } from "@/tool/goal-report"
import { Instance } from "@/project/instance"

import type { GoalContract, GoalContractFields, PipelineEvent, PipelineDelivery, PipelineDeps } from "./types"

/** Result from streamExecutorEvents — always carries the real error reason when delivery is absent. */
type StreamResult = { delivery: PipelineDelivery; error?: undefined } | { delivery?: undefined; error: string }

function goalLabel(goal: GoalContractFields & Record<string, unknown>): string {
  return goal.title || goal.id
}

const log = Log.create({ service: "goal-executor" })

const EXECUTOR_STATUS_TIMEOUT_MS = 30_000
const HEARTBEAT_INTERVAL_MS = 30_000
/**
 * Minimum interval between `last_progress_at` writes. Reasoning-delta
 * chunks can fire hundreds of times per second — writing the DB on
 * every one would starve other writers. 1s is coarse enough to spare
 * SQLite, fine enough for the goal-run-watchdog scanner's tens-of-
 * seconds resolution.
 */

/**
 * Execute a single goal: stream executor events, extract delivery.
 *
 * Returns an async generator of PipelineEvents.
 * Infrastructure only writes goal_run status. Goal status is the Orchestrator's decision.
 */
export async function* runGoalPipeline(
  contract: GoalContract,
  deps: PipelineDeps,
): AsyncGenerator<PipelineEvent> {
  const { goal, run, task } = contract
  const { executor, workDir, sessionID, executorSessionID, queueTaskID, signal } = deps
  const goalRunID = await findGoalRunByGoalAndRun(goal.id, run.id)
  if (!goalRunID) {
    yield { type: "failed", error: "No goal_run record found", failureClass: "goal_wrong" }
    return
  }

  try {
    // ── Execute (stream events from executor, extract delivery) ──
    yield { type: "executing" }
    updateGoalRun(goalRunID, { status: "running" })

    const result = yield* streamExecutorEvents(contract, deps, goalRunID)

    if (signal.aborted) {
      yield { type: "aborted" }
      return
    }

    if (!result.delivery) {
      // Only update goal_run — NOT goal.status (that's the Orchestrator's job)
      updateGoalRun(goalRunID, {
        status: "failed",
        error: result.error,
        time_completed: Date.now(),
      })
      updateGoalRunExecutorSessionStatus(goalRunID, "failed")
      yield { type: "failed", error: result.error, failureClass: "bug" }
      return
    }

    const delivery = result.delivery

    yield { type: "executed", delivery }

    // Persist delivery to DB — goal-scoped variant, does NOT create an
    // evaluation row (see persist.ts: per-goal evals have no updater).
    const deliveryID = Identifier.ascending("delivery")
    persistGoalDelivery({
      task, run, goalRunID, deliveryID,
      delivery: { summary: delivery.summary, commitRef: delivery.commitRef, diffs: delivery.diffs, report: delivery.report },
      now: Date.now(),
    })

    // Executor finished — move to `evaluating`, not `completed`. goal-pool
    // is the only caller; it hands the delivery to the delivery agent which
    // settles the row to completed/failed. Keeping the row in `evaluating`
    // at this point means engine_goal.status can be derived from goal_run
    // alone (Phase 4 invariant) — a delivered-but-rejected goal no longer
    // requires a separate UPDATE on engine_goal.
    updateGoalRun(goalRunID, { status: "evaluating" })
    updateGoalRunExecutorSessionStatus(goalRunID, "completed")

    log.info("goal_run moved to evaluating", {
      goalRunID, goalID: goal.id, files: delivery.diffs.length,
    })

    yield { type: "completed", delivery }

  } catch (err) {
    if (signal.aborted) {
      yield { type: "aborted" }
      return
    }
    const error = err instanceof Error ? err.message : String(err)
    log.error("goal_run failed", { goalRunID, goalID: goal.id, error })
    updateGoalRun(goalRunID, {
      status: "failed",
      error: `Execution error: ${error}`,
      time_completed: Date.now(),
    })
    updateGoalRunExecutorSessionStatus(goalRunID, "failed")
    yield { type: "failed", error, failureClass: "bug" }
  }
}

// ---------------------------------------------------------------------------
// Stream executor events and extract delivery
// ---------------------------------------------------------------------------

async function* streamExecutorEvents(
  contract: GoalContract,
  deps: PipelineDeps,
  goalRunID: string,
): AsyncGenerator<PipelineEvent, StreamResult> {
  const { goal, run, task } = contract
  const { executor, workDir, sessionID, executorSessionID, queueTaskID, signal, baseRef } = deps

  if (!executor.capabilities().events) {
    const status = await executor.status(queueTaskID).catch(() => ({
      status: "failed" as const, error: "status check failed",
    }))
    if (status.status === "failed") {
      return { error: status.error ?? "Executor failed (no event stream)" }
    }
    return { delivery: await extractDelivery(goalRunID, workDir, goal.id, baseRef, sessionID) }
  }

  // Completion detection (multi-signal):
  // 1. Primary: task-queue.completed event → for-await loop exits
  // 2. Secondary: session.idle event → LLM turn finished; grace-window then exit
  //    Rationale: task-queue.completed depends on SessionPrompt.prompt() returning
  //    after flushCallbacks. Under parallel load this chain sometimes breaks
  //    (callback promise does not resolve), leaving the queue task stuck in
  //    "running". session.idle is emitted synchronously when the session enters
  //    standby, so it's a more reliable LLM-turn-done signal.
  // 3. Fallback: status poller detects executor finished every 5s
  const STATUS_POLL_INTERVAL_MS = 5_000

  const streamAbort = new AbortController()
  const combinedSignal = AbortSignal.any([signal, streamAbort.signal])
  let streamDone = false

  // Status poller: trust executor state instead of layer-local watchdogs.
  const poller = (async () => {
    while (!streamDone && !combinedSignal.aborted) {
      await new Promise(r => setTimeout(r, STATUS_POLL_INTERVAL_MS))
      if (streamDone || combinedSignal.aborted) break
      try {
        const s = await executor.status(queueTaskID)
        if (s.status === "completed" || s.status === "failed") {
          log.info("status poller detected executor completion", { goalRunID, status: s.status })
          streamAbort.abort("executor completed (poller)")
          break
        }
      } catch (err) {
        log.warn("status poller error", { goalRunID, error: err instanceof Error ? err.message : String(err) })
      }
    }
  })()

  let lastHeartbeat = Date.now()
  for await (const event of executor.events({ goalID: goal.id, sessionID, queueTaskID, signal: combinedSignal })) {
    if (combinedSignal.aborted) break
    // Phase-6-d-0: goal-run-watchdog was deleted (rule 23 — wall-clock FSM
    // driver duplicating the session-llm + executor-events gates). With it
    // gone, `last_progress_at` has no reader, so the per-chunk stamp write
    // is dead work; dropped. Stall detection lives in the inner gates.
    const now = Date.now()
    yield { type: "executor_event", event }

    if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
      lastHeartbeat = now
      EngineProtocol.emit(Event.GoalProgress, {
        taskID: task.id, goalRunID, summary: `Goal ${goalRunID.slice(-8)} executing`,
      }, { taskID: task.id, runID: run.id, goalRunID, source: "goal-executor" })
        .catch(err => log.warn("GoalProgress heartbeat emit failed", { goalRunID, error: String(err) }))
      yield { type: "heartbeat" }
    }
  }
  streamDone = true
  streamAbort.abort("stream ended")
  // Poller races the stream; after streamAbort it rejects with AbortError.
  // We join it so the handle doesn't leak, but a genuine poller bug would
  // also land here, so we log non-abort rejections instead of swallowing.
  await poller.catch(err => {
    if (!streamAbort.signal.aborted) {
      log.warn("poller rejected unexpectedly", { goalRunID, error: String(err) })
    }
  })

  if (signal.aborted) return { error: "Execution aborted" }

  const status = await Promise.race([
    executor.status(queueTaskID),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("executor.status() timeout")), EXECUTOR_STATUS_TIMEOUT_MS),
    ),
  ]).catch((err) => ({
    status: "failed" as const,
    error: err instanceof Error ? err.message : "status check failed after stream end",
  }))

  if (status.status !== "completed") {
    const failError = status.error ?? `Executor finished with status "${status.status}" (no error detail)`
    log.error("goal_run executor status not completed", { runID: run.id, goalRunID, goalID: goal.id, statusResult: status.status, error: failError })
    return { error: failError }
  }

  return { delivery: await extractDelivery(goalRunID, workDir, goal.id, baseRef, sessionID) }
}

// ---------------------------------------------------------------------------
// Extract delivery diffs via the worktree's own git.
//
// The per-goal worktree is already a proper git worktree with its own
// index + HEAD + branch. baseRef is the worktree HEAD captured before the
// executor starts (goal-pool.ts); after the executor finishes,
// `deliveryFromWorktree` stages everything (`git add -A`), commits, and
// diffs baseRef..HEAD for the FileDiff[] payload. Missing workDir/baseRef
// is a dispatch bug — fail loud.
// ---------------------------------------------------------------------------

async function extractDelivery(
  goalRunID: string,
  workDir: string | undefined,
  goalID: string,
  baseRef: string,
  // `goal_report` is a tool call persisted on the user-facing session
  // (sessionID, prefix "ses"), not the executor protocol session
  // (executorSessionID, prefix "exs"). extractGoalReport calls
  // `Session.messages({sessionID})` which Zod-validates the id prefix —
  // passing the executor session id caused every goal to fail with
  // `Invalid string: must start with "ses"` (iter-6).
  sessionID: string,
): Promise<PipelineDelivery> {
  if (!workDir) {
    throw new Error(`extractDelivery: workDir is required (goalRunID=${goalRunID}, goalID=${goalID}). Per-goal dispatch must create a worktree before running the executor — an absent worktree is a dispatch-time bug, not a runtime condition.`)
  }
  const result = await Instance.provide({
    directory: workDir,
    fn: () => deliveryFromWorktree(baseRef, `Goal ${goalID.slice(-8)}`),
  })
  // Executor contract: goal_report is mandatory and terminal. extractGoalReport
  // throws on missing / duplicated / invalid — those are failures, not fallback
  // conditions. Attach the parsed report to the delivery so the delivery agent
  // can adversarially cross-check its claims against the diff.
  const report = await extractGoalReport(sessionID)
  log.info("delivery extracted", {
    goalRunID,
    files: result.delivery.diffs.length,
    baseRef,
    mergeRef: result.mergeRef,
    reportFiles: report.files_changed.length,
    reportDecisions: report.design_decisions.length,
  })
  return { ...result.delivery, report }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findGoalRunByGoalAndRun(goalID: string, runID: string): Promise<string | undefined> {
  const { listGoalRunsForRun } = await import("@/engine/store")
  const runs = listGoalRunsForRun(runID) as Array<{ id: string; goal_id: string; status: string }>
  // `aborted` must be excluded alongside `completed`/`failed` — goal_run FSM
  // treats all three as terminal (see engine/goal-run-state-machine.ts). Without
  // excluding aborted, a retry after signal-aborted or evaluator-aborted goal_run
  // re-enters with the same ID and the downstream `updateGoalRun(status:"running")`
  // throws `Invalid goal_run transition: aborted -> running`. Observed in
  // usage-replica-vague bench6: one goal stuck in pending↔failed oscillation
  // across 4+ retry cycles because dispatch kept handing back the same
  // aborted goal_run instead of triggering supersede → createGoalRun.
  const active = runs.find((gr) =>
    gr.goal_id === goalID &&
    gr.status !== "completed" &&
    gr.status !== "failed" &&
    gr.status !== "aborted",
  )
  return active?.id
}

async function finalizeQueueTaskRow(input: {
  queueTaskID: string
  status: "completed" | "failed"
  error?: string
  goalRunID: string
}) {
  try {
    const { TaskQueueTable } = await import("@/scheduler/task-queue.sql")
    Database.use((db) =>
      db
        .update(TaskQueueTable)
        .set({
          status: input.status,
          ...(input.status === "failed" ? { error_message: input.error ?? "executor aborted" } : { error_message: null }),
          time_completed: Date.now(),
          time_updated: Date.now(),
        })
        .where(and(eq(TaskQueueTable.id, input.queueTaskID), eq(TaskQueueTable.status, "running")))
        .run(),
    )
  } catch (err) {
    log.warn("failed to finalize queue task row", {
      goalRunID: input.goalRunID,
      queueTaskID: input.queueTaskID,
      status: input.status,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
