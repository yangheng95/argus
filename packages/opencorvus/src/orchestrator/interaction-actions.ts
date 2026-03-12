import { Bus } from "@/bus"
import { ExecutorRegistry } from "@/executor/registry"
import { Database, eq } from "@/storage/db"
import { Event } from "./model"
import {
  OrchestratorInteractionRequestTable,
  OrchestratorProgressSnapshotTable,
  OrchestratorRunTable,
  OrchestratorTaskTable,
  type OrchestratorInteractionStatus,
} from "./orchestrator.sql"
import {
  activeGoalRunByCoordinator,
  goalRunQueueTaskID,
  requireRun,
  requireTask,
  type InteractionRow,
  type RunRow,
} from "./store"
import { updateRun, updateTask } from "./state"
import { Identifier } from "@/id/id"

function executionTarget(run: RunRow) {
  const goalRun = activeGoalRunByCoordinator(run.id)
  return {
    sessionID: goalRun?.session_id ?? run.session_id ?? undefined,
    queueTaskID: goalRunQueueTaskID(goalRun) ?? run.executor_ref?.queue_task_id,
  }
}

export function markInteraction(
  row: InteractionRow,
  status: OrchestratorInteractionStatus,
  response: Record<string, unknown>,
  now = Date.now(),
  summary = status === "answered" ? "Interaction answered" : "Interaction rejected",
) {
  Database.transaction((db) => {
    db.update(OrchestratorInteractionRequestTable)
      .set({
        status,
        response,
        time_resolved: now,
        time_updated: now,
      })
      .where(eq(OrchestratorInteractionRequestTable.id, row.id))
      .run()
    Database.effect(() =>
      Bus.publish(Event.InteractionResolved, {
        taskID: row.task_id,
        runID: row.run_id,
        interactionID: row.id,
        status,
        summary,
      }),
    )
  })
}

export async function rejectProtocolInteraction(row: InteractionRow, message?: string) {
  const run = requireRun(row.run_id)
  const executor = ExecutorRegistry.require(run.executor)
  if (!executor.resolve) throw new Error(`executor ${run.executor} does not support interaction resolution`)
  const payload = row.payload ?? {}
  const requestID = typeof payload.request_id === "string" ? payload.request_id : row.external_id
  const now = Date.now()
  const target = executionTarget(run)
  if (row.request_type === "permission") {
    await executor.resolve({
      sessionID: target.sessionID,
      queueTaskID: target.queueTaskID,
      requestID,
      kind: "approval",
      response: {
        decision: "decline",
      },
    })
    markInteraction(row, "rejected", { message }, now)
    return
  }
  await executor.resolve({
    sessionID: target.sessionID,
    queueTaskID: target.queueTaskID,
    requestID,
    kind: "input",
    error: {
      code: -32000,
      message: message?.trim() || "Rejected by operator",
    },
  })
  markInteraction(row, "rejected", { message }, now)
}

export function isPlannerClarification(row: InteractionRow) {
  return row.payload?.planner_clarification === true
}

export async function rejectPlannerClarification(row: InteractionRow, message?: string) {
  const task = requireTask(row.task_id)
  const run = requireRun(row.run_id)
  if (run.status === "completed" || run.status === "failed" || run.status === "aborted") return
  if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") return
  const now = Date.now()
  const error = message?.trim() || "Planning clarification was rejected"
  Database.transaction((db) => {
    db.update(OrchestratorInteractionRequestTable)
      .set({
        status: "rejected",
        response: message?.trim() ? { message: message.trim() } : {},
        time_resolved: now,
        time_updated: now,
      })
      .where(eq(OrchestratorInteractionRequestTable.id, row.id))
      .run()
    db.update(OrchestratorRunTable)
      .set({
        status: "failed",
        blocking_reason: null,
        error,
        time_completed: now,
        time_updated: now,
      })
      .where(eq(OrchestratorRunTable.id, run.id))
      .run()
    db.update(OrchestratorTaskTable)
      .set({
        status: "failed",
        blocking_reason: null,
        error,
        time_completed: now,
        time_updated: now,
      })
      .where(eq(OrchestratorTaskTable.id, task.id))
      .run()
    db.insert(OrchestratorProgressSnapshotTable)
      .values({
        id: Identifier.ascending("progress"),
        task_id: task.id,
        status: "failed",
        summary: "Clarification rejected; task stopped",
        payload: {
          message: message?.trim() || undefined,
        },
        time_created: now,
        time_updated: now,
      })
      .run()
    Database.effect(() =>
      Bus.publish(Event.InteractionResolved, {
        taskID: task.id,
        runID: run.id,
        interactionID: row.id,
        status: "rejected",
        summary: "Clarification rejected",
      }),
    )
    Database.effect(() => Bus.publish(Event.RunUpdated, { taskID: task.id, runID: run.id, status: "failed", summary: error }))
    Database.effect(() => Bus.publish(Event.TaskUpdated, { taskID: task.id, status: "failed", summary: error }))
  })
}

export async function rejectReplanConfirmation(row: InteractionRow, message?: string) {
  const now = Date.now()
  Database.use((db) =>
    db.update(OrchestratorInteractionRequestTable)
      .set({
        status: "rejected",
        response: {
          approved: false,
          ...(message?.trim() ? { message: message.trim() } : {}),
        },
        time_resolved: now,
        time_updated: now,
      })
      .where(eq(OrchestratorInteractionRequestTable.id, row.id))
      .run(),
  )
  const task = requireTask(row.task_id)
  const run = requireRun(row.run_id)
  const reason = message?.trim() || "Replan rejected by user"
  await updateRun(run, { status: "failed", error: reason, blocking_reason: null, time_completed: now }, reason)
  await updateTask(task, { status: "failed", error: reason, blocking_reason: null, time_completed: now }, reason)
}

export async function autoRejectInteraction(row: InteractionRow, message?: string) {
  if (row.payload?.protocol_request === true) {
    await rejectProtocolInteraction(row, message)
    return
  }
  if (row.payload?.replan_confirm === true) {
    await rejectReplanConfirmation(row, message)
    return
  }
  if (isPlannerClarification(row)) {
    await rejectPlannerClarification(row, message)
    return
  }
  markInteraction(
    row,
    "rejected",
    {
      ...(message?.trim() ? { message: message.trim() } : {}),
      timed_out: true,
    },
    Date.now(),
    "Interaction rejected after timeout",
  )
}
