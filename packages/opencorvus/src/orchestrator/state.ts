import { Bus } from "@/bus"
import { Database, and, eq } from "@/storage/db"
import { Event } from "./model"
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
  Database.transaction((db) => {
    db.update(OrchestratorTaskTable)
      .set({
        ...values,
        time_updated: now,
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
    Database.effect(() => Bus.publish(Event.TaskUpdated, { taskID: row.id, status: nextStatus, summary }))
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
  const now = Date.now()
  Database.transaction((db) => {
    db.update(OrchestratorRunTable)
      .set({
        ...values,
        time_updated: now,
      })
      .where(eq(OrchestratorRunTable.id, row.id))
      .run()
    db.update(OrchestratorTaskTable)
      .set({
        time_updated: now,
      })
      .where(
        and(
          eq(OrchestratorTaskTable.id, row.task_id),
          eq(OrchestratorTaskTable.active_run_id, row.id),
        ),
      )
      .run()
    Database.effect(() => Bus.publish(Event.RunUpdated, { taskID: row.task_id, runID: row.id, status: nextStatus, summary }))
  })
  return requireRun(row.id)
}

export function hooks() {
  return {
    updateTask,
    updateRun,
  }
}
