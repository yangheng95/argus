/**
 * Task timeline rewind — the single entry point for "回到这一步".
 *
 * Rewind is a task projection cursor. `resetWorktree=false` only filters
 * UI-facing task history. `resetWorktree=true` additionally replays the
 * PatchPart snapshots after the anchor so the worktree returns to the
 * anchored point. No session-scoped rewind implementation may exist beside it.
 */
import z from "zod"
import { Identifier } from "@/id/id"
import { Snapshot } from "@/snapshot"
import { Message } from "@/session/message"
import { Session } from "@/session"
import { MessageTable, PartTable } from "@/session/session.sql"
import { SessionSummary } from "@/session/summary"
import { Bus } from "@/bus"
import { Database, and, asc, eq, gt, gte, inArray } from "@/storage/db"
import { Log } from "@/util/log"
import { interruptTaskLoop, awaitTaskLoopIdle } from "@/orchestrator/loop"
import { taskIDForSession } from "@/orchestrator/task-event"
import { EngineTaskTable } from "./engine.sql"
import { Event } from "./model"
import { EngineProtocol } from "./protocol"
import { findTask, sessionIDsForTask } from "./store"

const log = Log.create({ service: "engine-rewind" })
const WORKTREE_RESET_IDLE_TIMEOUT_MS = 10_000

export const RewindTaskInput = z.object({
  taskID: Identifier.schema("task"),
  anchor: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("cursorTime"),
      cursorTime: z.number().int().nonnegative(),
      anchorEventID: z.string().optional(),
    }),
    z.object({
      kind: z.literal("message"),
      sessionID: Identifier.schema("session"),
      messageID: Identifier.schema("message"),
      partID: Identifier.schema("part").optional(),
    }),
  ]),
  resetWorktree: z.boolean(),
  reason: z.string().optional(),
})
export type RewindTaskInput = z.infer<typeof RewindTaskInput>

export interface RewindTaskResult {
  taskID: string
  cursorTime: number
  rewindCount: number
  resetWorktree: boolean
  anchorKind: RewindTaskInput["anchor"]["kind"]
}

type PatchPartRow = {
  id: string
  sessionID: string
  messageID: string
  timeCreated: number
  patch: Snapshot.Patch
}

function patchFromPartRow(row: typeof PartTable.$inferSelect): PatchPartRow | undefined {
  const parsed = Message.PatchPart.omit({ id: true, sessionID: true, messageID: true }).safeParse(row.data)
  if (!parsed.success) return undefined
  const data = parsed.data
  return {
    id: row.id,
    sessionID: row.session_id,
    messageID: row.message_id,
    timeCreated: row.time_created,
    patch: {
      hash: data.hash,
      files: data.files,
    },
  }
}

function normalizePatchRows(rows: Array<typeof PartTable.$inferSelect>): PatchPartRow[] {
  return rows.map(patchFromPartRow).filter((row): row is PatchPartRow => !!row)
}

function patchList(rows: PatchPartRow[]): Snapshot.Patch[] {
  return rows.map((row) => row.patch)
}

function requireMessageAnchor(input: Extract<RewindTaskInput["anchor"], { kind: "message" }>) {
  const row = Database.use((db) =>
    db
      .select()
      .from(MessageTable)
      .where(and(eq(MessageTable.id, input.messageID), eq(MessageTable.session_id, input.sessionID)))
      .get(),
  )
  if (!row) throw new Error(`rewindTask: message ${input.messageID} not found in session ${input.sessionID}`)
  return row
}

function ensureAnchorBelongsToTask(taskID: string, sessionID: string) {
  const owner = taskIDForSession(sessionID)
  if (owner !== taskID) {
    throw new Error(`rewindTask: session ${sessionID} does not belong to task ${taskID}`)
  }
}

async function collectPatchesAfterCursor(taskID: string, cursorTime: number): Promise<PatchPartRow[]> {
  const sessionIDs = sessionIDsForTask(taskID)
  if (sessionIDs.length === 0) return []
  const rows = Database.use((db) =>
    db
      .select()
      .from(PartTable)
      .where(and(inArray(PartTable.session_id, sessionIDs), gt(PartTable.time_created, cursorTime)))
      .orderBy(asc(PartTable.time_created), asc(PartTable.id))
      .all(),
  )
  return normalizePatchRows(rows)
}

async function collectPatchesFromMessageAnchor(
  input: Extract<RewindTaskInput["anchor"], { kind: "message" }>,
  messageTime: number,
): Promise<PatchPartRow[]> {
  if (!input.partID) {
    const rows = Database.use((db) =>
      db
        .select()
        .from(PartTable)
        .where(and(eq(PartTable.session_id, input.sessionID), gt(PartTable.time_created, messageTime)))
        .orderBy(asc(PartTable.time_created), asc(PartTable.id))
        .all(),
    )
    return normalizePatchRows(rows)
  }

  const anchorPart = Database.use((db) =>
    db
      .select()
      .from(PartTable)
      .where(and(eq(PartTable.id, input.partID!), eq(PartTable.session_id, input.sessionID)))
      .get(),
  )
  if (!anchorPart) throw new Error(`rewindTask: part ${input.partID} not found in session ${input.sessionID}`)

  const rows = Database.use((db) =>
    db
      .select()
      .from(PartTable)
      .where(and(eq(PartTable.session_id, input.sessionID), gte(PartTable.time_created, anchorPart.time_created)))
      .orderBy(asc(PartTable.time_created), asc(PartTable.id))
      .all(),
  ).filter((row) => row.time_created > anchorPart.time_created || row.id >= anchorPart.id)
  return normalizePatchRows(rows)
}

async function publishDiffsBySession(rows: PatchPartRow[]) {
  const sessionIDs = [...new Set(rows.map((row) => row.sessionID))]
  for (const sessionID of sessionIDs) {
    const messageIDs = new Set(rows.filter((row) => row.sessionID === sessionID).map((row) => row.messageID))
    const all = await Session.messages({ sessionID })
    const messages = all.filter((msg) => messageIDs.has(msg.info.id))
    const diff = await SessionSummary.computeDiff({ messages })
    await SessionSummary.writeDiff(sessionID, diff)
    Bus.publish(Session.Event.Diff, { sessionID, diff })
  }
}

async function applyWorktreeReset(input: RewindTaskInput, cursorTime: number): Promise<void> {
  interruptTaskLoop(input.taskID, "task rewind worktree reset")
  await awaitTaskLoopIdle(input.taskID, WORKTREE_RESET_IDLE_TIMEOUT_MS)

  const rows =
    input.anchor.kind === "cursorTime"
      ? await collectPatchesAfterCursor(input.taskID, cursorTime)
      : await collectPatchesFromMessageAnchor(input.anchor, cursorTime)

  await Snapshot.revert(patchList(rows))
  await publishDiffsBySession(rows)
}

export async function rewindTask(raw: RewindTaskInput): Promise<RewindTaskResult> {
  const input = RewindTaskInput.parse(raw)
  const task = findTask(input.taskID)
  if (!task) {
    throw new Error(`rewindTask: task ${input.taskID} not found`)
  }

  const cursorTime = (() => {
    if (input.anchor.kind === "cursorTime") return input.anchor.cursorTime
    ensureAnchorBelongsToTask(input.taskID, input.anchor.sessionID)
    return requireMessageAnchor(input.anchor).time_created
  })()

  if (input.resetWorktree) {
    await applyWorktreeReset(input, cursorTime)
  }

  const now = Date.now()
  const nextCount = (task.rewind_count ?? 0) + 1
  const anchorEventID = input.anchor.kind === "cursorTime" ? input.anchor.anchorEventID : input.anchor.messageID

  Database.use((db) =>
    db
      .update(EngineTaskTable)
      .set({
        rewind_cursor_time: cursorTime,
        rewind_cursor_event_id: anchorEventID ?? null,
        rewind_count: nextCount,
        time_updated: now,
      })
      .where(eq(EngineTaskTable.id, input.taskID))
      .run(),
  )

  log.info("task rewound", {
    taskID: input.taskID,
    cursorTime,
    anchorEventID,
    anchorKind: input.anchor.kind,
    resetWorktree: input.resetWorktree,
    reason: input.reason,
    rewindCount: nextCount,
  })

  await EngineProtocol.emit(
    Event.TaskRewound,
    {
      taskID: input.taskID,
      cursorTime,
      anchorEventID,
      reason: input.reason,
      rewindCount: nextCount,
      resetWorktree: input.resetWorktree,
      anchorKind: input.anchor.kind,
    },
    { source: "engine.rewindTask" },
  )

  return {
    taskID: input.taskID,
    cursorTime,
    rewindCount: nextCount,
    resetWorktree: input.resetWorktree,
    anchorKind: input.anchor.kind,
  }
}

/**
 * Clear a task's rewind cursor. This restores visibility only. If a previous
 * rewind used `resetWorktree=true`, file contents stay at the rewound state.
 */
export async function clearRewindCursor(taskID: string): Promise<void> {
  const task = findTask(taskID)
  if (!task) return
  if (task.rewind_cursor_time == null) return

  const now = Date.now()
  Database.use((db) =>
    db
      .update(EngineTaskTable)
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
      reason: "cursor cleared",
      rewindCount: task.rewind_count ?? 0,
      resetWorktree: false,
      anchorKind: "cursorTime",
    },
    { source: "engine.clearRewindCursor" },
  )
}

export async function clearRewindCursorForSession(sessionID: string): Promise<void> {
  const taskID = taskIDForSession(sessionID)
  if (!taskID) return
  await clearRewindCursor(taskID)
}

/**
 * Pure helper for UI / describe layer: filter typed events by the current
 * task rewind cursor. Events without a timestamp pass through because there
 * is no task-time fact to compare.
 */
export function applyRewindCursor<T extends { time_created?: number | null }>(taskID: string, events: T[]): T[] {
  const task = findTask(taskID)
  const cursor = task?.rewind_cursor_time
  if (cursor == null) return events
  return events.filter((e) => {
    const t = e.time_created
    if (t == null) return true
    return t <= cursor
  })
}

export function taskRewindCursor(taskID: string): number | null {
  return findTask(taskID)?.rewind_cursor_time ?? null
}
