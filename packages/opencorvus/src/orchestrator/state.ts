import { Database, and, eq } from "@/storage/db"
import { Event } from "./model"
import { OrchestratorProtocol } from "./protocol"
import { progressStatus } from "./helpers"
import { OrchestratorProgressSnapshotTable, OrchestratorRunTable, OrchestratorTaskTable } from "./orchestrator.sql"
import { requireRun, requireTask, type RunRow, type TaskRow } from "./store"
import { Identifier } from "@/id/id"
import { assertTransition, type TaskStatus } from "./state-machine"

/**
 * Raised by updateTask/updateRun when the caller's row snapshot is stale:
 * the row's status changed between the caller's read and the write.
 *
 * Callers must either retry (refetch + reapply) or bail. Silently swallowing
 * this error will reintroduce the race conditions this CAS pattern was added
 * to fix — do not catch-and-ignore.
 */
export class StaleRowError extends Error {
  readonly kind = "StaleRow" as const
  constructor(
    readonly entity: "task" | "run",
    readonly id: string,
    readonly expectedStatus: string,
    readonly attemptedStatus: string,
  ) {
    super(
      `${entity} ${id} is stale: expected status '${expectedStatus}', attempted write to '${attemptedStatus}'`,
    )
  }
}

export async function updateTask(
  row: TaskRow,
  values: Partial<typeof OrchestratorTaskTable.$inferInsert>,
  summary: string,
) {
  const nextStatus = values.status ?? row.status
  // Validate the requested transition against the formal state machine.
  // This catches callers constructing illegal transitions (queued → completed etc.).
  if (nextStatus !== row.status) {
    assertTransition(row.status as TaskStatus, nextStatus as TaskStatus)
  }
  const nextBlocking = values.blocking_reason === undefined ? row.blocking_reason : values.blocking_reason
  const nextError = values.error === undefined ? row.error : values.error
  const nextStarted = values.time_started === undefined ? row.time_started : values.time_started
  const nextCompleted = values.time_completed === undefined ? row.time_completed : values.time_completed
  // No-op guard: bail only when the caller supplied *only* the 5 guarded fields
  // AND none of them changed. If the caller passed any other field (metadata,
  // title, active_plan_version_id, …) we MUST write — otherwise metadata-only
  // updates (workflow step tracking, operator notes, etc.) get silently dropped.
  const guardedKeys = new Set(["status", "blocking_reason", "error", "time_started", "time_completed"])
  const hasOtherWrite = Object.keys(values).some((key) => !guardedKeys.has(key))
  if (
    !hasOtherWrite &&
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
  let updated: TaskRow | undefined
  Database.transaction((db) => {
    // Compare-and-swap on status: when this call is *transitioning* the row,
    // the UPDATE only succeeds if the row's current status still matches the
    // caller's snapshot. This is the DB-level guard that prevents two
    // concurrent callers from racing on the same transition (e.g., loop start
    // and user cancel both reading "queued" and both writing).
    //
    // For metadata-only updates (no status change) we skip the status guard
    // so harmless writes to live rows don't spuriously fail.
    const whereClause = statusChanged
      ? and(
          eq(OrchestratorTaskTable.id, row.id),
          eq(OrchestratorTaskTable.status, row.status),
        )
      : eq(OrchestratorTaskTable.id, row.id)
    updated = db
      .update(OrchestratorTaskTable)
      .set({
        ...values,
        time_updated: now,
        ...(statusChanged ? { time_status_changed: now } : {}),
      })
      .where(whereClause)
      .returning()
      .get()
    if (!updated) {
      // For transitions: the row's status changed under us → stale row,
      // caller must decide (refetch+retry or bail). Throw so every write in
      // this tx rolls back together.
      // For metadata-only updates: the row was deleted — also a caller bug.
      throw new StaleRowError("task", row.id, row.status, nextStatus)
    }
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
  return updated ?? requireTask(row.id)
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
  const statusChanged = nextStatus !== row.status
  let updated: RunRow | undefined
  Database.transaction((db) => {
    const whereClause = statusChanged
      ? and(
          eq(OrchestratorRunTable.id, row.id),
          eq(OrchestratorRunTable.status, row.status),
        )
      : eq(OrchestratorRunTable.id, row.id)
    updated = db
      .update(OrchestratorRunTable)
      .set({
        ...values,
        time_updated: now,
      })
      .where(whereClause)
      .returning()
      .get()
    if (!updated) {
      throw new StaleRowError("run", row.id, row.status, nextStatus)
    }
    db.update(OrchestratorTaskTable)
      .set({
        active_run_id: row.id,
        time_updated: now,
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
  return updated ?? requireRun(row.id)
}

export function hooks() {
  return {
    updateTask,
    updateRun,
  }
}
