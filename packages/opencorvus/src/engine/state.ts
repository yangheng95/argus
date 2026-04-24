import { Database, eq } from "@/storage/db"
import { Event } from "./model"
import { EngineProtocol } from "./protocol"
import { progressStatus } from "./helpers"
import { EngineArtifactTable, EngineProgressSnapshotTable, EngineTaskTable } from "./engine.sql"
import { findRun, requireRun, requireTask, type RunRow, type TaskRow } from "./store"
import { deriveTaskStatus } from "./task-status"
import { Identifier } from "@/id/id"

/**
 * Caller-facing task-update shape. `status` is a logical verb (queued /
 * active / completed / failed / cancelled) that the writer maps to
 * concrete fact fields; there is no `status` column anymore (6-f-2).
 *
 * Mapping:
 *   active    → time_started defaults to now if unset
 *   completed → time_completed defaults to now; clears error
 *   failed    → time_completed defaults to now; error required
 *   cancelled → time_completed defaults to now; stamps metadata.cancelled=true
 *   queued    → clears time_started / time_completed
 */
export type TaskUpdateValues = Omit<Partial<typeof EngineTaskTable.$inferInsert>, "status"> & {
  status?: "queued" | "active" | "completed" | "failed" | "cancelled"
}

export async function updateTask(
  row: TaskRow,
  values: TaskUpdateValues,
  summary: string,
) {
  const { status: intent, ...rest } = values
  const now = Date.now()

  // Resolve fact fields from the logical verb. Explicit fields in `rest`
  // win — callers can always override timestamps if they carry their own
  // "now" from the transaction entry point.
  const resolved: Partial<typeof EngineTaskTable.$inferInsert> = { ...rest }
  const metaBase: Record<string, unknown> =
    (typeof rest.metadata === "object" && rest.metadata !== null && !Array.isArray(rest.metadata))
      ? { ...(rest.metadata as Record<string, unknown>) }
      : {}
  let metaMutated = rest.metadata !== undefined
  switch (intent) {
    case "active":
      if (resolved.time_started === undefined && row.time_started == null) {
        resolved.time_started = now
      }
      break
    case "completed":
      if (resolved.time_completed === undefined) resolved.time_completed = now
      if (resolved.error === undefined) resolved.error = null
      break
    case "failed":
      if (resolved.time_completed === undefined) resolved.time_completed = now
      // error must be supplied by caller for failures
      break
    case "cancelled":
      if (resolved.time_completed === undefined) resolved.time_completed = now
      metaBase.cancelled = true
      metaMutated = true
      break
    case "queued":
      resolved.time_started = null
      resolved.time_completed = null
      break
    case undefined:
      // metadata-only or explicit field-only update
      break
  }
  if (metaMutated) {
    // Merge over row.metadata when caller didn't already supply full metadata.
    if (rest.metadata === undefined) {
      const existing = (row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata))
        ? (row.metadata as Record<string, unknown>)
        : {}
      resolved.metadata = { ...existing, ...metaBase }
    } else {
      resolved.metadata = metaBase
    }
  }

  // No-op guard: if nothing actually changes, bail. We check the fact
  // fields + the caller-supplied key set; metadata / title / etc. always
  // force a write.
  const nextError = resolved.error === undefined ? row.error : resolved.error
  const nextStarted = resolved.time_started === undefined ? row.time_started : resolved.time_started
  const nextCompleted = resolved.time_completed === undefined ? row.time_completed : resolved.time_completed
  const guardedKeys = new Set(["error", "time_started", "time_completed"])
  const hasOtherWrite = Object.keys(resolved).some((key) => !guardedKeys.has(key))
  if (
    !hasOtherWrite &&
    nextError === row.error &&
    nextStarted === row.time_started &&
    nextCompleted === row.time_completed
  ) {
    return row
  }

  let updated: TaskRow | undefined
  Database.transaction((db) => {
    updated = db
      .update(EngineTaskTable)
      .set({
        ...resolved,
        time_updated: now,
      })
      .where(eq(EngineTaskTable.id, row.id))
      .returning()
      .get()
    if (!updated) {
      throw new Error(`task ${row.id} not found during updateTask`)
    }
    const nextStatus = deriveTaskStatus(updated)
    db.insert(EngineProgressSnapshotTable)
      .values({
        id: Identifier.ascending("progress"),
        task_id: row.id,
        status: progressStatus(nextStatus),
        summary,
        payload: {
          status: nextStatus,
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
  values: Partial<RunRow>,
  summary: string,
) {
  const nextStatus = values.status ?? row.status
  // Rule 23: no state-machine transition gate. LLM / orchestrator may drive
  // run.status to any value at any time.
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
  // Phase-6-e: run rows are append-only `engine_artifact` kind="run" rows.
  // Bump time_created via Math.max(existing.time_updated + 1, now) so same-ms
  // appends retain strict order (mirror of 6-d-1 goal_run pattern).
  const effectiveNow = Math.max(row.time_updated + 1, now)
  const mergedPayload = {
    plan_version_id: values.plan_version_id === undefined ? row.plan_version_id : values.plan_version_id,
    session_id: values.session_id === undefined ? row.session_id : values.session_id,
    executor: values.executor ?? row.executor,
    status: nextStatus,
    phase: nextPhase,
    blocking_reason: nextStatus !== "blocked" && values.blocking_reason === undefined ? null : nextBlocking,
    error: nextError,
    retry_count: values.retry_count ?? row.retry_count,
    executor_ref: nextRef,
    metadata: values.metadata === undefined ? row.metadata : values.metadata,
    time_started:
      !row.time_started && ["accepted", "running", "blocked", "completed"].includes(nextStatus) && values.time_started === undefined
        ? now
        : nextStarted,
    time_completed:
      (nextStatus === "completed" || nextStatus === "failed" || nextStatus === "aborted") && values.time_completed === undefined
        ? now
        : nextCompleted,
  }
  Database.transaction((db) => {
    db.insert(EngineArtifactTable)
      .values({
        id: Identifier.ascending("run"),
        task_id: row.task_id,
        run_id: row.id,
        kind: "run",
        label: `run-${nextStatus}`,
        payload: mergedPayload,
        time_created: effectiveNow,
        time_updated: effectiveNow,
      })
      .run()
    // Phase-6-f-3: task.active_run_id deleted — derive via
    // findActiveRunForTask(taskID) from the run artifact stream. Keep the
    // time_updated bump so task listings refresh on run writes.
    db.update(EngineTaskTable)
      .set({ time_updated: effectiveNow })
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
  if (
    statusChanged &&
    (nextStatus === "completed" || nextStatus === "failed" || nextStatus === "aborted")
  ) {
    const { PerRunState } = await import("./per-run-state")
    PerRunState.finalize(row.id)
  }
  return findRun(row.id) ?? requireRun(row.id)
}

export function hooks() {
  return {
    updateTask,
    updateRun,
  }
}

/**
 * Merge new criteria check results into engine_task.criteria_results.
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
  const prev = Array.isArray(task.criteria_results) ? task.criteria_results : []
  const byName = new Map<string, any>(prev.map((c) => [String((c as any)?.name ?? ""), c]))
  for (const incoming of checks) {
    byName.set(incoming.name, { ...byName.get(incoming.name), ...incoming })
  }
  const merged = [...byName.values()].filter((c) => c && typeof c.name === "string" && c.name)
  await updateTask(task, {
    criteria_results: merged,
  }, `criteria upsert: ${checks.map((c) => `${c.name}=${c.status}`).join(", ")}`)
  return merged
}
