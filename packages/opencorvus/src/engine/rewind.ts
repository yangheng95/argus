/**
 * Task timeline rewind — the "撤回到某一步" feature.
 *
 * Rewind is a PROJECTION cursor, not a delete. All append-only event logs
 * (engine_goal_run, engine_iteration, engine_artifact, session message,
 * decision_log, ProtocolStore) stay intact. UI-facing reads filter events
 * with `time_created > task.rewind_cursor_time` out; when a user posts a
 * new message after rewind the continueTaskMessage path appends past the
 * cursor and the next loop sees "history ≤ cursor ∪ new messages." No
 * history is destroyed; the audit trail records the rewind event itself
 * via Event.TaskRewound.
 *
 * Out of scope (by design):
 *   - worktree / workspace_dir file contents — left as-is per user
 *     directive "只撤回数据库状态，不动项目代码本身"
 *   - executor sessions already open — treated as in-flight leaks the
 *     same way process-restart recovery treats them
 *   - external side effects (channel messages, gh PRs) — unrecoverable
 *
 * Concurrency:
 *   - If activeLoops.has(taskID), rewind aborts the loop via isTaskLoopActive
 *     check in the caller; the orchestrator loop honours abort signals and
 *     exits cleanly. The rewind UPDATE itself is a single-row write.
 */
import { Database, eq } from "@/storage/db"
import { Log } from "@/util/log"
import { EngineTaskTable } from "./engine.sql"
import { Event } from "./model"
import { EngineProtocol } from "./protocol"
import { findTask } from "./store"

const log = Log.create({ service: "engine-rewind" })

export interface RewindTaskInput {
  taskID: string
  /** The `time_created` of the event the user clicked. Events with
   *  time_created > cursorTime are filtered from UI-facing reads. */
  cursorTime: number
  /** Opaque id of the anchor event (audit / UI-highlight). Not used as
   *  a filter key — time_created alone drives the projection. */
  anchorEventID?: string
  /** Human-readable reason. Appears in the TaskRewound event + decision log. */
  reason?: string
}

export interface RewindTaskResult {
  taskID: string
  cursorTime: number
  rewindCount: number
}

export async function rewindTask(input: RewindTaskInput): Promise<RewindTaskResult> {
  const task = findTask(input.taskID)
  if (!task) {
    throw new Error(`rewindTask: task ${input.taskID} not found`)
  }
  if (!Number.isFinite(input.cursorTime) || input.cursorTime < 0) {
    throw new Error(`rewindTask: invalid cursorTime ${input.cursorTime}`)
  }
  const now = Date.now()
  const nextCount = (task.rewind_count ?? 0) + 1

  Database.use((db) =>
    db.update(EngineTaskTable)
      .set({
        rewind_cursor_time: input.cursorTime,
        rewind_cursor_event_id: input.anchorEventID ?? null,
        rewind_count: nextCount,
        time_updated: now,
      })
      .where(eq(EngineTaskTable.id, input.taskID))
      .run(),
  )

  log.info("task rewound", {
    taskID: input.taskID,
    cursorTime: input.cursorTime,
    anchorEventID: input.anchorEventID,
    reason: input.reason,
    rewindCount: nextCount,
  })

  await EngineProtocol.emit(
    Event.TaskRewound,
    {
      taskID: input.taskID,
      cursorTime: input.cursorTime,
      anchorEventID: input.anchorEventID,
      reason: input.reason,
      rewindCount: nextCount,
    },
    { source: "engine.rewindTask" },
  )

  // An in-flight loop will, on its next decision point, re-read the task
  // row and see the rewind cursor. The describe layer filters accordingly,
  // so the next LLM turn sees the rewound timeline. Explicit loop abort
  // is a follow-up — the orchestrator loop doesn't expose abortTaskLoop
  // yet; until it does, the rewind takes effect on the next turn rather
  // than mid-turn. Practically the loop usually sits in a tool call or
  // pool.drain, so next iteration picks up the cursor within seconds.

  return {
    taskID: input.taskID,
    cursorTime: input.cursorTime,
    rewindCount: nextCount,
  }
}

/**
 * Clear a task's rewind cursor — "undo the undo". Re-exposes all events
 * that were filtered. Does NOT re-start the loop; the caller (e.g. a new
 * user message via continueTaskMessage) owns that.
 */
export async function clearRewindCursor(taskID: string): Promise<void> {
  const task = findTask(taskID)
  if (!task) return
  if (task.rewind_cursor_time == null) return

  const now = Date.now()
  Database.use((db) =>
    db.update(EngineTaskTable)
      .set({
        rewind_cursor_time: null,
        rewind_cursor_event_id: null,
        time_updated: now,
      })
      .where(eq(EngineTaskTable.id, taskID))
      .run(),
  )
  log.info("task rewind cursor cleared", { taskID })
  await EngineProtocol.emit(
    Event.TaskRewound,
    {
      taskID,
      cursorTime: 0,
      reason: "cursor cleared (undo rewind)",
      rewindCount: task.rewind_count ?? 0,
    },
    { source: "engine.clearRewindCursor" },
  )
}

/**
 * Pure helper for UI / describe layer: filter a typed array of events by
 * the task's current rewind cursor. Events without a `time_created`
 * timestamp pass through (safety default — we never want to silently
 * drop data we can't classify).
 */
export function applyRewindCursor<T extends { time_created?: number | null }>(
  taskID: string,
  events: T[],
): T[] {
  const task = findTask(taskID)
  const cursor = task?.rewind_cursor_time
  if (cursor == null) return events
  return events.filter((e) => {
    const t = e.time_created
    if (t == null) return true
    return t <= cursor
  })
}

/** Direct accessor for the cursor — describe layer / view functions can
 *  gate on this without re-querying the task row. */
export function taskRewindCursor(taskID: string): number | null {
  return findTask(taskID)?.rewind_cursor_time ?? null
}
