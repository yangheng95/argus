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
import { Event, EngineProtocol, updateGoalRun, updateGoalRunExecutorSessionStatus, persistDelivery } from "@/engine"
import { Database, eq, and } from "@/storage/db"
import { Identifier } from "@/id/id"
import { deliveryFromSnapshot } from "@/goal/runner"
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

    // Persist delivery to DB
    const deliveryID = Identifier.ascending("delivery")
    persistDelivery({
      task, run, goalRunID, deliveryID,
      delivery: { summary: delivery.summary, diffs: delivery.diffs },
      now: Date.now(),
    })

    // Mark goal_run completed — NOT goal.status (Orchestrator decides after eval)
    updateGoalRun(goalRunID, { status: "completed", time_completed: Date.now() })
    updateGoalRunExecutorSessionStatus(goalRunID, "completed")

    log.info("goal_run completed", {
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
    return { delivery: await extractDelivery(goalRunID, workDir, goal.id, baseRef) }
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
  // 4. Safety net: inactivity timeout — no events for this period → dead
  const INACTIVITY_TIMEOUT_MS = Number(process.env.OPENCORVUS_GOAL_INACTIVITY_TIMEOUT_MS) || 90_000
  const STATUS_POLL_INTERVAL_MS = 5_000
  const IDLE_GRACE_MS = Number(process.env.OPENCORVUS_GOAL_IDLE_GRACE_MS) || 15_000

  const streamAbort = new AbortController()
  const combinedSignal = AbortSignal.any([signal, streamAbort.signal])
  let streamDone = false
  let lastActivityAt = Date.now()
  let idleSince: number | undefined
  let idleGraceExceeded = false
  let inactivityTimeoutExceeded = false

  // Status poller + inactivity watchdog + idle-grace detector
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
      } catch { /* ignore status check errors */ }
      // Idle-grace detector: session signalled idle → LLM turn done.
      // If queue task doesn't complete within IDLE_GRACE_MS, the callback chain
      // is stuck — trust the session.idle signal and break out.
      if (idleSince !== undefined) {
        const idleMs = Date.now() - idleSince
        if (idleMs >= IDLE_GRACE_MS) {
          log.warn("session idle + queue task still running — forcing completion", { goalRunID, idleMs })
          idleGraceExceeded = true
          streamAbort.abort("session idle grace exceeded")
          break
        }
      }
      // Inactivity watchdog: if no event activity for INACTIVITY_TIMEOUT_MS, abort.
      // Same remediation as idle-grace — reporting "executor stuck in running"
      // is almost always a stuck callback chain, not a real LLM failure.
      const inactiveMs = Date.now() - lastActivityAt
      if (inactiveMs >= INACTIVITY_TIMEOUT_MS) {
        log.warn("inactivity timeout — forcing completion", { goalRunID, inactiveMs })
        inactivityTimeoutExceeded = true
        streamAbort.abort("inactivity timeout")
        break
      }
    }
  })()

  let lastHeartbeat = Date.now()
  for await (const event of executor.events({ sessionID, queueTaskID, signal: combinedSignal })) {
    if (combinedSignal.aborted) break

    lastActivityAt = Date.now()
    if (event.type === "session.idle" && idleSince === undefined) {
      idleSince = Date.now()
      log.info("session idle detected — starting grace window", { goalRunID, graceMs: IDLE_GRACE_MS })
    }
    yield { type: "executor_event", event }

    const now = Date.now()
    if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
      lastHeartbeat = now
      EngineProtocol.emit(Event.GoalProgress, {
        taskID: task.id, goalRunID, summary: `Goal ${goalRunID.slice(-8)} executing`,
      }, { taskID: task.id, runID: run.id, goalRunID, source: "goal-executor" }).catch(() => {})
      yield { type: "heartbeat" }
    }
  }
  streamDone = true
  streamAbort.abort("stream ended")
  await poller.catch(() => {})

  if (signal.aborted) return { error: "Execution aborted" }

  // idleGraceExceeded: session.idle fired → LLM turn genuinely done, but
  // the queue-task callback chain is stuck. Extract delivery normally.
  if (idleGraceExceeded) {
    log.info("session idle grace exceeded — extracting delivery", { goalRunID })
    try {
      const { TaskQueueTable } = await import("@/scheduler/task-queue.sql")
      Database.use((db) =>
        db
          .update(TaskQueueTable)
          .set({ status: "completed", time_completed: Date.now(), time_updated: Date.now() })
          .where(and(eq(TaskQueueTable.id, queueTaskID), eq(TaskQueueTable.status, "running")))
          .run(),
      )
    } catch (err) {
      log.warn("failed to force-complete queue task row", { queueTaskID, error: String(err) })
    }
    return { delivery: await extractDelivery(goalRunID, workDir, goal.id, baseRef) }
  }

  // inactivityTimeoutExceeded: no events for INACTIVITY_TIMEOUT_MS. The executor
  // is dead — permission hang, LLM crash, network failure. Fail loud.
  if (inactivityTimeoutExceeded) {
    const reason = `Executor produced no events for ${INACTIVITY_TIMEOUT_MS / 1000}s — session is dead (possible causes: permission hang, LLM timeout, network failure)`
    log.error("inactivity timeout — failing goal_run", { goalRunID, reason })
    return { error: reason }
  }

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

  return { delivery: await extractDelivery(goalRunID, workDir, goal.id, baseRef) }
}

// ---------------------------------------------------------------------------
// Extract delivery diffs via Snapshot subsystem
//
// Snapshot keeps a project-scoped git-dir separate from the user project's
// own `.git`. `Snapshot.track()` hashes the current worktree contents into
// a tree-hash using a per-call temporary index (no cross-worktree index
// corruption). `Snapshot.diffFull(baseRef, mergeRef)` returns the real
// before/after FileDiff[] between the two tree hashes.
//
// The caller must have captured `baseRef` via `Snapshot.track()` inside
// `Instance.provide({ directory: workDir })` immediately before the
// executor started. Missing baseRef or missing workDir is a dispatch bug
// and we fail loud (no silent empty-delivery fallback).
// ---------------------------------------------------------------------------

async function extractDelivery(
  goalRunID: string,
  workDir: string | undefined,
  goalID: string,
  baseRef: string,
): Promise<PipelineDelivery> {
  if (!workDir) {
    throw new Error(`extractDelivery: workDir is required (goalRunID=${goalRunID}, goalID=${goalID}). Per-goal dispatch must create a worktree before running the executor — an absent worktree is a dispatch-time bug, not a runtime condition.`)
  }
  const result = await Instance.provide({
    directory: workDir,
    fn: () => deliveryFromSnapshot(baseRef, `Goal ${goalID.slice(-8)}`),
  })
  log.info("delivery extracted", {
    goalRunID,
    files: result.delivery.diffs.length,
    baseRef,
    mergeRef: result.mergeRef,
  })
  return result.delivery
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findGoalRunByGoalAndRun(goalID: string, runID: string): Promise<string | undefined> {
  const { listGoalRunsByCoordinator } = await import("@/engine/store")
  const runs = listGoalRunsByCoordinator(runID) as Array<{ id: string; goal_id: string; status: string }>
  const active = runs.find((gr) => gr.goal_id === goalID && gr.status !== "completed" && gr.status !== "failed")
  return active?.id
}
