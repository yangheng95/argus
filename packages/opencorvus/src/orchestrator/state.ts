import { Database, eq } from "@/storage/db"
import { Event } from "./model"
import { OrchestratorProtocol } from "./protocol"
import { progressStatus } from "./helpers"
import { OrchestratorProgressSnapshotTable, OrchestratorRunTable, OrchestratorTaskTable } from "./orchestrator.sql"
import { requireRun, requireTask, type RunRow, type TaskRow } from "./store"
import { Identifier } from "@/id/id"

export async function updateTask(
  row: TaskRow,
  values: Partial<typeof OrchestratorTaskTable.$inferInsert>,
  summary: string,
) {
  const nextStatus = values.status ?? row.status
  const nextBlocking = values.blocking_reason === undefined ? row.blocking_reason : values.blocking_reason
  const nextError = values.error === undefined ? row.error : values.error
  const nextStarted = values.time_started === undefined ? row.time_started : values.time_started
  const nextCompleted = values.time_completed === undefined ? row.time_completed : values.time_completed
  if (
    nextStatus === row.status &&
    nextBlocking === row.blocking_reason &&
    nextError === row.error &&
    nextStarted === row.time_started &&
    nextCompleted === row.time_completed
  ) {
    return row
  }
  const now = Date.now()
  const statusChanged = nextStatus !== row.status
  Database.transaction((db) => {
    db.update(OrchestratorTaskTable)
      .set({
        ...values,
        time_updated: now,
        ...(statusChanged ? { time_status_changed: now } : {}),
      })
      .where(eq(OrchestratorTaskTable.id, row.id))
      .run()
    db.insert(OrchestratorProgressSnapshotTable)
      .values({
        id: Identifier.ascending("progress"),
        task_id: row.id,
        status: progressStatus(nextStatus),
        summary,
        payload: {
          status: nextStatus,
          blockingReason: nextBlocking,
          error: nextError,
        },
        time_created: now,
        time_updated: now,
      })
      .run()
    Database.effect(() =>
      OrchestratorProtocol.emit(
        Event.TaskUpdated,
        { taskID: row.id, status: nextStatus, summary },
        { source: "state.task" },
      ),
    )
  })
  return requireTask(row.id)
}

export async function updateRun(
  row: RunRow,
  values: Partial<typeof OrchestratorRunTable.$inferInsert>,
  summary: string,
) {
  const nextStatus = values.status ?? row.status
  const nextBlocking = values.blocking_reason === undefined ? row.blocking_reason : values.blocking_reason
  const nextError = values.error === undefined ? row.error : values.error
  const nextStarted = values.time_started === undefined ? row.time_started : values.time_started
  const nextCompleted = values.time_completed === undefined ? row.time_completed : values.time_completed
  const nextRef = values.executor_ref === undefined ? row.executor_ref : values.executor_ref
  const nextPhase = values.phase ?? row.phase
  if (
    nextStatus === row.status &&
    nextBlocking === row.blocking_reason &&
    nextError === row.error &&
    nextStarted === row.time_started &&
    nextCompleted === row.time_completed &&
    nextPhase === row.phase &&
    JSON.stringify(nextRef ?? {}) === JSON.stringify(row.executor_ref ?? {})
  ) {
    return row
  }
  Database.transaction((db) => {
    db.update(OrchestratorRunTable)
      .set({
        ...values,
        time_updated: Date.now(),
      })
      .where(eq(OrchestratorRunTable.id, row.id))
      .run()
    db.update(OrchestratorTaskTable)
      .set({
        active_run_id: row.id,
        time_updated: Date.now(),
      })
      .where(eq(OrchestratorTaskTable.id, row.task_id))
      .run()
    Database.effect(() =>
      OrchestratorProtocol.emit(
        Event.RunUpdated,
        { taskID: row.task_id, runID: row.id, status: nextStatus, summary },
        { source: "state.run" },
      ),
    )
  })
  return requireRun(row.id)
}

export function hooks() {
  return {
    updateTask,
    updateRun,
  }
}
