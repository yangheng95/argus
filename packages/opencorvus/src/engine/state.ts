import { Database, and, eq } from "@/storage/db"
import { Event } from "./model"
import { EngineProtocol } from "./protocol"
import { progressStatus } from "./helpers"
import { EngineArtifactTable, EngineProgressSnapshotTable, EngineTaskTable } from "./engine.sql"
import { findRun, requireRun, requireTask, type RunRow, type TaskRow } from "./store"
import { Identifier } from "@/id/id"

export async function updateTask(
  row: TaskRow,
  values: Partial<typeof EngineTaskTable.$inferInsert>,
  summary: string,
) {
  const nextStatus = values.status ?? row.status
  // Phase-6-f: rule 23 — no state-machine transition gate. The LLM
  // orchestrator drives task.status; illegal transition enforcement was a
  // legacy FSM gate that fought the autonomous-agent design. Callers are
  // responsible for setting coherent values; bad writes surface as runtime
  // misbehaviour, not DB errors.
  const nextError = values.error === undefined ? row.error : values.error
  const nextStarted = values.time_started === undefined ? row.time_started : values.time_started
  const nextCompleted = values.time_completed === undefined ? row.time_completed : values.time_completed
  // No-op guard: bail only when the caller supplied *only* the 4 guarded fields
  // AND none of them changed. If the caller passed any other field (metadata,
  // title, …) we MUST write — otherwise metadata-only updates get silently dropped.
  const guardedKeys = new Set(["status", "error", "time_started", "time_completed"])
  const hasOtherWrite = Object.keys(values).some((key) => !guardedKeys.has(key))
  if (
    !hasOtherWrite &&
    nextStatus === row.status &&
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
      })
      .where(whereClause)
      .returning()
      .get()
    if (!updated) {
      // For transitions: the row's status changed under us → stale row,
      // caller must decide (refetch+retry or bail). Throw so every write in
      // this tx rolls back together.
      // For metadata-only updates: the row was deleted — also a caller bug.
      // Compare-and-swap failed: the row's status changed between this
      // caller's read and the write. Throw so the whole transaction rolls
      // back; callers must refetch and retry (or bail). Silent swallow
      // re-introduces the race conditions the CAS was added to prevent.
      throw new Error(
        `task ${row.id} is stale: expected status '${row.status}', attempted write to '${nextStatus}'`,
      )
    }
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
