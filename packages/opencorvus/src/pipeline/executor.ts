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
 * Design (from SVG spec — agent-driven, not state machine):
 *   - This is one of several TOOLS the Task Agent can call
 *   - Task Agent decides: when to execute, whether to plan first, whether to eval after
 *   - Retry is agent reasoning, not mechanical policy
 */

import { Log } from "@/util/log"
import { Event } from "@/orchestrator/model"
import { OrchestratorProtocol } from "@/orchestrator/protocol"
import { Database, eq } from "@/storage/db"
import { OrchestratorGoalTable } from "@/orchestrator/orchestrator.sql"
import { updateGoalRun, updateGoalRunExecutorSessionStatus, persistDelivery } from "@/orchestrator/persist"
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
 * Returns an async generator of PipelineEvents. The Task Agent consumes
 * the "completed" event (with delivery) and decides what to do next
 * (eval? merge? retry? — that's the agent's decision, not ours).
 */
export async function* runGoalPipeline(
  contract: GoalContract,
  deps: PipelineDeps,
): AsyncGenerator<PipelineEvent> {
  const { goal, run, task } = contract
  const { executor, workDir, sessionID, executorSessionID, queueTaskID, signal } = deps
  const goalRunID = findGoalRunByGoalAndRun(goal.id, run.id)
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
      markGoalFailed(goalRunID, goal.id, task.id, goalLabel(goal),
        "Executor did not produce a delivery", workDir)
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

    // Mark goal run completed (execution done — Task Agent decides what's next)
    updateGoalRun(goalRunID, { status: "completed", time_completed: Date.now() })
    Database.use((db) =>
      db.update(OrchestratorGoalTable)
        .set({ status: "passed", time_updated: Date.now() })
        .where(eq(OrchestratorGoalTable.id, goal.id))
        .run(),
    )

    OrchestratorProtocol.emit(Event.GoalPassed, {
      taskID: task.id, goalID: goal.id, summary: goalLabel(goal),
    }, { source: "goal-executor" }).catch(() => {})

    log.info("goal execution completed", {
      goalRunID, goalID: goal.id, files: delivery.diffs.length,
    })

    yield { type: "completed", delivery }

  } catch (err) {
    if (signal.aborted) {
      yield { type: "aborted" }
      return
    }
    const error = err instanceof Error ? err.message : String(err)
    log.error("goal execution failed", { goalRunID, goalID: goal.id, error })
    markGoalFailed(goalRunID, goal.id, task.id, goalLabel(goal), `Execution error: ${error}`, workDir)
    yield { type: "failed", error, failureClass: "bug" }
  }
}

// ---------------------------------------------------------------------------
// Mark goal as failed
// ---------------------------------------------------------------------------

function markGoalFailed(
  goalRunID: string,
  goalID: string,
  taskID: string,
  label: string,
  error: string,
  workDir?: string,
) {
  updateGoalRun(goalRunID, {
    status: "failed",
    error,
    time_completed: Date.now(),
  })
  updateGoalRunExecutorSessionStatus(goalRunID, "failed")
  Database.use((db) =>
    db.update(OrchestratorGoalTable)
      .set({ status: "failed", time_updated: Date.now() })
      .where(eq(OrchestratorGoalTable.id, goalID))
      .run(),
  )
  OrchestratorProtocol.emit(Event.GoalFailed, {
    taskID, goalID, summary: `${label}: ${error.slice(0, 200)}`,
  }, { source: "goal-executor" }).catch(() => {})
  if (workDir) cleanupGoalWorkspace(workDir).catch(() => {})
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
  const { executor, workDir, sessionID, queueTaskID, signal } = deps

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

  let lastHeartbeat = Date.now()
  for await (const event of executor.events({ sessionID, signal })) {
    if (signal.aborted) break

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
    log.error("goal executor failed", { runID: run.id, goalRunID, error: status.error })
    updateGoalRun(goalRunID, { status: "failed", error: status.error ?? "Executor failed", time_completed: Date.now() })
    updateGoalRunExecutorSessionStatus(goalRunID, "failed")
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

function findGoalRunByGoalAndRun(goalID: string, runID: string): string | undefined {
  const { listGoalRunsByCoordinator } = require("@/orchestrator/store")
  const runs = listGoalRunsByCoordinator(runID) as Array<{ id: string; goal_id: string; status: string }>
  const active = runs.find((gr) => gr.goal_id === goalID && gr.status !== "completed" && gr.status !== "failed")
  return active?.id
}
