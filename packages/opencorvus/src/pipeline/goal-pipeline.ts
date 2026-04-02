/**
 * GoalPipeline — self-driving process for one goal: Execute → Eval → Retry.
 *
 * This is the central abstraction of the new architecture. The orchestrator
 * creates a GoalPipeline per goal and consumes its event stream via for-await.
 * The pipeline owns the executor event bridge and drives goal completion.
 *
 * Design principles:
 * - Tell, Don't Ask: pipeline yields events, orchestrator reacts. No polling.
 * - Single writer: only this pipeline writes to its goal_run row.
 * - Retry is internal: driven by injected RetryPolicy. Orchestrator sees retrying events.
 * - Abort is external: orchestrator calls abort() via AbortSignal.
 *
 * Current scope (Step 1 refactor):
 *   Wraps existing executor + event bridge flow from runtime.ts.
 *   Per-goal planner (Step 4) and autonomous eval (Step 5) will be added later.
 *   For now, planner output comes from the already-persisted plan_node.
 */

import { Log } from "@/util/log"
import { Event } from "@/orchestrator/model"
import { OrchestratorProtocol } from "@/orchestrator/protocol"
import { Instance } from "@/project/instance"
import { Database, eq } from "@/storage/db"
import { OrchestratorGoalTable } from "@/orchestrator/orchestrator.sql"
import { updateGoalRun, updateGoalRunExecutorSessionStatus, persistDelivery } from "@/orchestrator/persist"
import { findGoalRun, findRun, findTask, findPlan } from "@/orchestrator/store"
import { Identifier } from "@/id/id"
import { deliveryFromWorktreeGit, applyGoalDelivery, cleanupGoalWorkspace } from "@/goal/runner"
import { existsSync } from "fs"
import path from "path"

import type { GoalContract, GoalContractFields, PipelineEvent, PipelineDelivery, PipelineDeps } from "./types"

/** Compat: extract a display label from GoalContractFields (title or fallback). */
function goalLabel(goal: GoalContractFields & Record<string, unknown>): string {
  return goal.title || (goal as any).description || goal.id
}

const log = Log.create({ service: "goal-pipeline" })

const EXECUTOR_STATUS_TIMEOUT_MS = 30_000
const HEARTBEAT_INTERVAL_MS = 30_000

/**
 * Run a goal pipeline: stream executor events, extract delivery, yield events.
 *
 * Usage:
 *   for await (const event of runGoalPipeline(contract, deps)) {
 *     // orchestrator handles merge, dispatch, etc.
 *   }
 */
export async function* runGoalPipeline(
  contract: GoalContract,
  deps: PipelineDeps,
): AsyncGenerator<PipelineEvent> {
  const { goal, run, task, plan } = contract
  const { executor, workDir, sessionID, executorSessionID, queueTaskID, signal } = deps
  const goalRunID = findGoalRunByGoalAndRun(goal.id, run.id)
  if (!goalRunID) {
    yield { type: "failed", error: "No goal_run record found", failureClass: "goal_wrong" }
    return
  }

  try {
    // ── Phase 1: Execute (stream events from executor) ──
    yield { type: "executing" }
    updateGoalRun(goalRunID, { status: "running" })

    const delivery = yield* streamExecutorEvents(contract, deps, goalRunID)

    if (signal.aborted) {
      yield { type: "aborted" }
      return
    }

    if (!delivery) {
      // Executor failed — the streamExecutorEvents already logged and updated DB
      yield { type: "failed", error: "Executor did not produce a delivery", failureClass: "bug" }
      return
    }

    yield { type: "executed", delivery }

    // ── Phase 2: Finalize (extract and persist delivery) ──
    // Persist delivery to DB
    const deliveryID = Identifier.ascending("delivery")
    persistDelivery({
      task, run, goalRunID, deliveryID,
      delivery: { summary: delivery.summary, diffs: delivery.diffs },
      now: Date.now(),
    })

    // Mark goal run completed
    updateGoalRun(goalRunID, { status: "completed", time_completed: Date.now() })
    Database.use((db) =>
      db.update(OrchestratorGoalTable)
        .set({ status: "passed", time_updated: Date.now() })
        .where(eq(OrchestratorGoalTable.id, goal.id))
        .run(),
    )

    OrchestratorProtocol.emit(Event.GoalPassed, {
      taskID: task.id, goalID: goal.id, summary: goalLabel(goal),
    }, { source: "goal-pipeline" }).catch(() => {})

    log.info("goal pipeline completed", {
      goalRunID, goalID: goal.id, files: delivery.diffs.length,
    })

    yield { type: "completed", delivery }

  } catch (err) {
    if (signal.aborted) {
      yield { type: "aborted" }
      return
    }
    const error = err instanceof Error ? err.message : String(err)
    log.error("goal pipeline failed", { goalRunID, goalID: goal.id, error })

    updateGoalRun(goalRunID, {
      status: "failed",
      error: `Pipeline error: ${error}`,
      time_completed: Date.now(),
    })
    updateGoalRunExecutorSessionStatus(goalRunID, "failed")
    Database.use((db) =>
      db.update(OrchestratorGoalTable)
        .set({ status: "failed", time_updated: Date.now() })
        .where(eq(OrchestratorGoalTable.id, goal.id))
        .run(),
    )
    OrchestratorProtocol.emit(Event.GoalFailed, {
      taskID: task.id, goalID: goal.id, summary: `${goalLabel(goal)}: ${error}`,
    }, { source: "goal-pipeline" }).catch(() => {})

    if (workDir) await cleanupGoalWorkspace(workDir).catch(() => {})

    yield { type: "failed", error, failureClass: "bug" }
  }
}

// ---------------------------------------------------------------------------
// Internal: stream executor events and extract delivery
// ---------------------------------------------------------------------------

async function* streamExecutorEvents(
  contract: GoalContract,
  deps: PipelineDeps,
  goalRunID: string,
): AsyncGenerator<PipelineEvent, PipelineDelivery | undefined> {
  const { goal, run, task, plan } = contract
  const { executor, workDir, sessionID, executorSessionID, queueTaskID, signal } = deps

  if (!executor.capabilities().events) {
    // Executor doesn't support event streaming — poll for completion
    const status = await executor.status(queueTaskID).catch(() => ({
      status: "failed" as const, error: "status check failed",
    }))
    if (status.status === "failed") {
      updateGoalRun(goalRunID, { status: "failed", error: status.error ?? "Executor failed", time_completed: Date.now() })
      updateGoalRunExecutorSessionStatus(goalRunID, "failed")
      return undefined
    }
    // Extract delivery from worktree
    return await extractDelivery(goalRunID, workDir, goal.id)
  }

  // Stream events from executor
  let lastHeartbeat = Date.now()
  for await (const event of executor.events({ sessionID, signal })) {
    if (signal.aborted) break

    // Yield executor event for orchestrator to project to session system
    yield { type: "executor_event", event }

    // Periodic heartbeat (direct to ProtocolStore, bypasses session bridge)
    const now = Date.now()
    if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
      lastHeartbeat = now
      OrchestratorProtocol.emit(Event.GoalProgress, {
        taskID: task.id, goalRunID, summary: `Goal ${goalRunID.slice(-8)} executing`,
      }, { taskID: task.id, runID: run.id, goalRunID, source: "goal-pipeline" }).catch(() => {})
      yield { type: "heartbeat" }
    }
  }

  if (signal.aborted) return undefined

  // Stream ended — check executor final status
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
    Database.use((db) =>
      db.update(OrchestratorGoalTable)
        .set({ status: "failed", time_updated: Date.now() })
        .where(eq(OrchestratorGoalTable.id, goal.id))
        .run(),
    )
    if (workDir) await cleanupGoalWorkspace(workDir).catch(() => {})
    return undefined
  }

  updateGoalRunExecutorSessionStatus(goalRunID, "completed")
  return await extractDelivery(goalRunID, workDir, goal.id)
}

// ---------------------------------------------------------------------------
// Internal: extract delivery diffs from worktree
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
