import { Database, and, eq } from "@/storage/db"
import { Event } from "./model"
import { EngineProtocol } from "./protocol"
import { progressStatus } from "./helpers"
import { EngineProgressSnapshotTable, EngineRunTable, EngineTaskTable } from "./engine.sql"
import { requireRun, requireTask, type RunRow, type TaskRow } from "./store"
import { Identifier } from "@/id/id"
import { assertTransition, type TaskStatus } from "./state-machine"
import { assertRunTransition, type RunStatus } from "./run-state-machine"

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
    readonly entity: "task" | "run" | "goal_run",
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
  values: Partial<typeof EngineTaskTable.$inferInsert>,
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
          eq(EngineTaskTable.id, row.id),
          eq(EngineTaskTable.status, row.status),
        )
      : eq(EngineTaskTable.id, row.id)
    updated = db
      .update(EngineTaskTable)
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
    db.insert(EngineProgressSnapshotTable)
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
      EngineProtocol.emit(
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
  values: Partial<typeof EngineRunTable.$inferInsert>,
  summary: string,
) {
  const nextStatus = values.status ?? row.status
  if (nextStatus !== row.status) {
    assertRunTransition(row.status as RunStatus, nextStatus as RunStatus)
  }
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
  const normalizedValues = {
    ...values,
    ...(nextStatus !== "blocked" && values.blocking_reason === undefined ? { blocking_reason: null } : {}),
    ...(!row.time_started && ["accepted", "running", "blocked", "completed"].includes(nextStatus) && values.time_started === undefined
      ? { time_started: now }
      : {}),
    ...((nextStatus === "completed" || nextStatus === "failed" || nextStatus === "aborted") && values.time_completed === undefined
      ? { time_completed: now }
      : {}),
  }
  let updated: RunRow | undefined
  Database.transaction((db) => {
    const whereClause = statusChanged
      ? and(
          eq(EngineRunTable.id, row.id),
          eq(EngineRunTable.status, row.status),
        )
      : eq(EngineRunTable.id, row.id)
    updated = db
      .update(EngineRunTable)
      .set({
        ...normalizedValues,
        time_updated: now,
      })
      .where(whereClause)
      .returning()
      .get()
    if (!updated) {
      throw new StaleRowError("run", row.id, row.status, nextStatus)
    }
    db.update(EngineTaskTable)
      .set({
        active_run_id: row.id,
        time_updated: now,
      })
      .where(eq(EngineTaskTable.id, row.task_id))
      .run()
    Database.effect(() =>
      EngineProtocol.emit(
        Event.RunUpdated,
        { taskID: row.task_id, runID: row.id, status: nextStatus, summary },
        { source: "state.run" },
      ),
    )
  })
  // Terminal transition: release in-process PerRunState (merge locks,
  // agent-notification set). This is the single authoritative point for
  // run-lifecycle cleanup — every writer path (runtime.syncRun,
  // runtime.failRun, writer.abortRuns, orchestrator tools, recovery)
  // funnels through updateRun, so no path can leak in-memory state.
  if (
    statusChanged &&
    (nextStatus === "completed" || nextStatus === "failed" || nextStatus === "aborted")
  ) {
    const { PerRunState } = await import("./per-run-state")
    PerRunState.finalize(row.id)
  }
  return updated ?? requireRun(row.id)
}

export function hooks() {
  return {
    updateTask,
    updateRun,
  }
}

/**
 * Merge new criteria check results into task.metadata.criteria_results.
 *
 * Lives in the engine/state layer rather than the task-api facade because
 * every call path (goal-pool, orchestrator tools, per-goal evaluator) needs
 * to write criteria, and routing writes through the HTTP facade would invert
 * the layering (engine calling its own API).
 */
export async function upsertTaskCriteria(
  taskID: string,
  checks: Array<{
    name: string
    label?: string
    family?: string
    status: "passed" | "failed" | "skipped"
    evidence?: string
  }>,
) {
  const task = requireTask(taskID)
  const meta = ((task.metadata as Record<string, unknown> | null) ?? {}) as Record<string, unknown>
  const prev = Array.isArray(meta.criteria_results) ? (meta.criteria_results as any[]) : []
  const byName = new Map<string, any>(prev.map((c) => [String(c?.name ?? ""), c]))
  for (const incoming of checks) {
    byName.set(incoming.name, { ...byName.get(incoming.name), ...incoming })
  }
  const merged = [...byName.values()].filter((c) => c && typeof c.name === "string" && c.name)
  await updateTask(task, {
    metadata: { ...meta, criteria_results: merged },
  }, `criteria upsert: ${checks.map((c) => `${c.name}=${c.status}`).join(", ")}`)
  return merged
}
