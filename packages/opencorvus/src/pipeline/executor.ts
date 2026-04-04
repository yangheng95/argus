/**
 * Goal Executor — thin execution wrapper for a single goal.
 *
 * NOT a pipeline. NOT a state machine. Just executes a goal and returns delivery.
 * All decisions (when to plan, when to eval, how to retry) are made by the
 * Task Agent (LLM), not by this code.
 *
 * What this module does:
 *   1. Stream executor events (for session projection)
 *   2. Extract delivery diffs from worktree
 *   3. Update goal_run status in DB
 *   4. That's it. No planning, no evaluation, no retry logic.
 *
 * IMPORTANT: This is INFRASTRUCTURE. Per the architecture spec:
 *   - goal_run writer: Infrastructure (this file)
 *   - goal writer: Task Agent ONLY
 *   - Infrastructure NEVER writes goal.status — that's the Task Agent's decision.
 */

import { Log } from "@/util/log"
import { Event } from "@/orchestrator/model"
import { OrchestratorProtocol } from "@/orchestrator/protocol"
import { updateGoalRun, updateGoalRunExecutorSessionStatus, persistDelivery } from "@/orchestrator/persist"
import { Database, eq } from "@/storage/db"
import { Identifier } from "@/id/id"
import { deliveryFromWorktreeGit, cleanupGoalWorkspace } from "@/goal/runner"

import type { GoalContract, GoalContractFields, PipelineEvent, PipelineDelivery, PipelineDeps } from "./types"

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
 * Infrastructure only writes goal_run status. Goal status is the Task Agent's decision.
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

    const delivery = yield* streamExecutorEvents(contract, deps, goalRunID)

    if (signal.aborted) {
      yield { type: "aborted" }
      return
    }

    if (!delivery) {
      // Only update goal_run — NOT goal.status (that's the Task Agent's job)
      updateGoalRun(goalRunID, {
        status: "failed",
        error: "Executor did not produce a delivery",
        time_completed: Date.now(),
      })
      updateGoalRunExecutorSessionStatus(goalRunID, "failed")
      if (workDir) cleanupGoalWorkspace(workDir).catch(() => {})
      yield { type: "failed", error: "Executor did not produce a delivery", failureClass: "bug" }
      return
    }

    yield { type: "executed", delivery }

    // Persist delivery to DB
    const deliveryID = Identifier.ascending("delivery")
    persistDelivery({
      task, run, goalRunID, deliveryID,
      delivery: { summary: delivery.summary, diffs: delivery.diffs },
      now: Date.now(),
    })

    // Mark goal_run completed — NOT goal.status (Task Agent decides after eval)
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
    if (workDir) cleanupGoalWorkspace(workDir).catch(() => {})
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
): AsyncGenerator<PipelineEvent, PipelineDelivery | undefined> {
  const { goal, run, task } = contract
  const { executor, workDir, sessionID, executorSessionID, queueTaskID, signal } = deps

  if (!executor.capabilities().events) {
    const status = await executor.status(queueTaskID).catch(() => ({
      status: "failed" as const, error: "status check failed",
    }))
    if (status.status === "failed") {
      updateGoalRun(goalRunID, { status: "failed", error: status.error ?? "Executor failed", time_completed: Date.now() })
      updateGoalRunExecutorSessionStatus(goalRunID, "failed")
      return undefined
    }
    return await extractDelivery(goalRunID, workDir, goal.id)
  }

  // Three-layer completion detection (matches production patterns):
  // 1. Primary: event stream delivers task-queue.completed → for-await loop exits
  // 2. Fallback: status poller detects executor finished every 5s
  // 3. Safety net: inactivity timeout — no events AND no status change → dead
  const INACTIVITY_TIMEOUT_MS = Number(process.env.OPENCORVUS_GOAL_INACTIVITY_TIMEOUT_MS) || 90_000
  const STATUS_POLL_INTERVAL_MS = 5_000

  const streamAbort = new AbortController()
  const combinedSignal = AbortSignal.any([signal, streamAbort.signal])
  let streamDone = false
  let lastActivityAt = Date.now()

  // Status poller + inactivity watchdog
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
      // Inactivity watchdog: if no event activity for INACTIVITY_TIMEOUT_MS, abort
      const inactiveMs = Date.now() - lastActivityAt
      if (inactiveMs >= INACTIVITY_TIMEOUT_MS) {
        log.warn("inactivity timeout — no executor events", { goalRunID, inactiveMs })
        streamAbort.abort("inactivity timeout")
        break
      }
    }
  })()

  let lastHeartbeat = Date.now()
  for await (const event of executor.events({ sessionID, queueTaskID, signal: combinedSignal })) {
    if (combinedSignal.aborted) break

    lastActivityAt = Date.now()
    yield { type: "executor_event", event }

    const now = Date.now()
    if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
      lastHeartbeat = now
      OrchestratorProtocol.emit(Event.GoalProgress, {
        taskID: task.id, goalRunID, summary: `Goal ${goalRunID.slice(-8)} executing`,
      }, { taskID: task.id, runID: run.id, goalRunID, source: "goal-executor" }).catch(() => {})
      yield { type: "heartbeat" }
    }
  }
  streamDone = true
  streamAbort.abort("stream ended")
  await poller.catch(() => {})

  if (signal.aborted) return undefined

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
    const failError = status.error ?? "Executor failed"
    log.error("goal_run executor status not completed", { runID: run.id, goalRunID, goalID: goal.id, statusResult: status.status, error: failError })
    updateGoalRun(goalRunID, { status: "failed", error: failError, time_completed: Date.now() })
    updateGoalRunExecutorSessionStatus(goalRunID, "failed")

    // CRITICAL: also transition goal.status to "failed".
    // Without this, goal stays "running" forever — auto-eval never runs on failed
    // executors, so nothing else will transition goal.status. The Task Agent sees
    // goals stuck at "running" and loops endlessly.
    try {
      const { OrchestratorGoalTable } = await import("@/orchestrator/orchestrator.sql")
      Database.use((db) => {
        db.update(OrchestratorGoalTable)
          .set({ status: "failed", time_updated: Date.now() })
          .where(eq(OrchestratorGoalTable.id, goal.id))
          .run()
      })
      log.info("goal status transitioned to failed after executor failure", { goalID: goal.id, error: failError })
    } catch (err) {
      log.error("failed to transition goal status", { goalID: goal.id, error: String(err) })
    }

    return undefined
  }

  updateGoalRunExecutorSessionStatus(goalRunID, "completed")
  return await extractDelivery(goalRunID, workDir, goal.id)
}

// ---------------------------------------------------------------------------
// Extract delivery diffs from worktree
// ---------------------------------------------------------------------------

async function extractDelivery(
  goalRunID: string,
  workDir: string | undefined,
  goalID: string,
): Promise<PipelineDelivery> {
  if (!workDir) {
    return { summary: "No worktree — empty delivery", diffs: [] }
  }
  const delivery = await deliveryFromWorktreeGit(workDir, `Goal ${goalID.slice(-8)}`)
  log.info("delivery extracted", { goalRunID, files: delivery.diffs.length })
  return delivery
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findGoalRunByGoalAndRun(goalID: string, runID: string): Promise<string | undefined> {
  const { listGoalRunsByCoordinator } = await import("@/orchestrator/store")
  const runs = listGoalRunsByCoordinator(runID) as Array<{ id: string; goal_id: string; status: string }>
  const active = runs.find((gr) => gr.goal_id === goalID && gr.status !== "completed" && gr.status !== "failed")
  return active?.id
}
