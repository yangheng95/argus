import { Bus } from "@/bus"
import { ExecutorRegistry } from "@/executor/registry"
import { PermissionNext } from "@/permission/next"
import { Question } from "@/question"
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
  findExecutorSession,
  findGoalRun,
  findInteraction,
  goalRunQueueTaskID,
  listActiveGoalRunsByCoordinator,
  requireRun,
  requireTask,
  type InteractionRow,
  type RunRow,
} from "./store"
import { updateRun, updateTask } from "./state"
import { Identifier } from "@/id/id"

function interactionGoalRun(row: InteractionRow) {
  const goalRunID = typeof row.payload?.goal_run_id === "string" ? row.payload.goal_run_id : undefined
  if (goalRunID) {
    const goalRun = findGoalRun(goalRunID)
    if (goalRun) return goalRun
  }
  const executorSessionID = typeof row.payload?.executor_session_id === "string" ? row.payload.executor_session_id : undefined
  const executorSession = executorSessionID ? findExecutorSession(executorSessionID) : undefined
  const nextGoalRunID = executorSession?.goal_run_id ?? undefined
  return nextGoalRunID ? findGoalRun(nextGoalRunID) : undefined
}

function executionTarget(run: RunRow, row?: InteractionRow) {
  const goalRun = row ? interactionGoalRun(row) : undefined
  if (goalRun) {
    return {
      sessionID: goalRun.session_id ?? undefined,
      queueTaskID: goalRunQueueTaskID(goalRun),
    }
  }
  const active = listActiveGoalRunsByCoordinator(run.id)
  const single = active.length === 1 ? active[0] : undefined
  return {
    sessionID: single?.session_id ?? run.session_id ?? undefined,
    queueTaskID: goalRunQueueTaskID(single) ?? run.executor_ref?.queue_task_id,
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
  const target = executionTarget(run, row)
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
  if (row.request_type === "permission") {
    await PermissionNext.reply({
      requestID: row.external_id,
      reply: "reject",
      message,
    })
    if (findInteraction(row.id)?.status !== "pending") return
  }
  if (row.request_type === "question") {
    await Question.reject(row.external_id)
    if (findInteraction(row.id)?.status !== "pending") return
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
