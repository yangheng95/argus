/**
 * Task timeline rewind — the single entry point for "回到这一步".
 *
 * Rewind is a task projection cursor. `resetWorktree=false` only filters
 * UI-facing task history. `resetWorktree=true` additionally resets/removes
 * affected goal worktrees through Worktree.reset/remove, using the
 * goal_run_attempt artifact payload as the single workspace source. Task
 * rewind must stay out of the session snapshot subsystem.
 */
import z from "zod"
import fs from "node:fs/promises"
import { Identifier } from "@/id/id"
import { MessageTable } from "@/session/session.sql"
import { Database, NotFoundError, and, eq, gt } from "@/storage/db"
import { Log } from "@/util/log"
import { interruptTaskLoop, awaitTaskLoopIdle } from "@/orchestrator/loop"
import { taskIDForSession } from "@/orchestrator/task-event"
import { Worktree } from "@/worktree"
import { EngineGoalTable, EngineTaskTable, type EngineGoalRunStatus } from "./engine.sql"
import { Event } from "./model"
import { EngineProtocol } from "./protocol"
import { updateGoalRun } from "./persist"
import { clearEngineTaskRewindCursor, setEngineTaskRewindCursor } from "./task"
import { findTask, listGoalRunsForTask, type GoalRunRow } from "./store"
import { isTerminalGoalRunStatus } from "./catalog"

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

function requireMessageAnchor(input: Extract<RewindTaskInput["anchor"], { kind: "message" }>) {
  const row = Database.use((db) =>
    db
      .select()
      .from(MessageTable)
      .where(and(eq(MessageTable.id, input.messageID), eq(MessageTable.session_id, input.sessionID)))
      .get(),
  )
  if (!row) {
    throw new NotFoundError({ message: `Message not found: ${input.messageID} in session ${input.sessionID}` })
  }
  return row
}

function ensureAnchorBelongsToTask(taskID: string, sessionID: string) {
  const owner = taskIDForSession(sessionID)
  if (owner !== taskID) {
    throw new NotFoundError({ message: `Session ${sessionID} does not belong to task ${taskID}` })
  }
}

type RewindWorkspaceAction = {
  goalID: string
  goalRunID: string
  workspaceDir: string | null
  workspaceBaseRef: string | null
  remove: boolean
  status: EngineGoalRunStatus
}

function runTimeForRewind(row: GoalRunRow): number {
  const created = Number(row.time_created)
  const started = Number(row.time_started)
  const updated = Number(row.time_updated)
  return Math.max(
    Number.isFinite(created) && created > 0 ? created : 0,
    Number.isFinite(started) && started > 0 ? started : 0,
    Number.isFinite(updated) && updated > 0 ? updated : 0,
  )
}

function goalsCreatedAfterCursor(taskID: string, cursorTime: number): Set<string> {
  const rows = Database.use((db) =>
    db
      .select({ id: EngineGoalTable.id })
      .from(EngineGoalTable)
      .where(and(eq(EngineGoalTable.task_id, taskID), gt(EngineGoalTable.time_created, cursorTime)))
      .all(),
  )
  return new Set(rows.map((row) => row.id))
}

function latestRunByGoal(rows: GoalRunRow[]): Map<string, GoalRunRow> {
  const out = new Map<string, GoalRunRow>()
  for (const row of rows) {
    const prev = out.get(row.goal_id)
    if (
      !prev ||
      row.time_updated > prev.time_updated ||
      (row.time_updated === prev.time_updated && row.time_created > prev.time_created)
    ) {
      out.set(row.goal_id, row)
    }
  }
  return out
}

function collectWorkspaceActions(taskID: string, cursorTime: number): RewindWorkspaceAction[] {
  const runs = listGoalRunsForTask(taskID)
  const goalsAfterCursor = goalsCreatedAfterCursor(taskID, cursorTime)
  const affectedGoalIDs = new Set<string>(goalsAfterCursor)
  for (const run of runs) {
    if (runTimeForRewind(run) > cursorTime) affectedGoalIDs.add(run.goal_id)
  }
  const latest = latestRunByGoal(runs)
  return [...affectedGoalIDs].flatMap((goalID) => {
    const run = latest.get(goalID)
    if (!run) return []
    return [
      {
        goalID,
        goalRunID: run.id,
        workspaceDir: run.workspace_dir,
        workspaceBaseRef: run.workspace_base_ref,
        remove: goalsAfterCursor.has(goalID),
        status: run.status,
      },
    ]
  })
}

async function validateWorkspaceActions(actions: RewindWorkspaceAction[]): Promise<void> {
  for (const action of actions) {
    if (!action.workspaceDir) continue
    if (!action.remove && !action.workspaceBaseRef) {
      throw new Error(`rewindTask: goal ${action.goalID} workspace is missing workspace_base_ref`)
    }
    const stat = await fs.stat(action.workspaceDir).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`rewindTask: goal ${action.goalID} workspace_dir not found: ${action.workspaceDir}: ${message}`)
    })
    if (!stat.isDirectory()) {
      throw new Error(`rewindTask: goal ${action.goalID} workspace_dir is not a directory: ${action.workspaceDir}`)
    }
  }
}

function projectWorkspaceAction(action: RewindWorkspaceAction): void {
  if (action.remove) {
    updateGoalRun(action.goalRunID, {
      workspace_dir: null,
      workspace_branch: null,
      workspace_base_ref: null,
      ...(!isTerminalGoalRunStatus(action.status) ? { status: "aborted" as const } : {}),
    })
    return
  }
  if (!isTerminalGoalRunStatus(action.status)) {
    updateGoalRun(action.goalRunID, { status: "aborted" })
  }
}

async function applyWorktreeReset(input: RewindTaskInput, cursorTime: number): Promise<void> {
  interruptTaskLoop(input.taskID, "task rewind worktree reset")
  await awaitTaskLoopIdle(input.taskID, WORKTREE_RESET_IDLE_TIMEOUT_MS)

  const actions = collectWorkspaceActions(input.taskID, cursorTime)
  await validateWorkspaceActions(actions)
  for (const action of actions) {
    if (action.workspaceDir) {
      if (action.remove) {
        await Worktree.remove({ directory: action.workspaceDir })
      } else {
        await Worktree.reset({ directory: action.workspaceDir, baseRef: action.workspaceBaseRef! })
      }
    }
    projectWorkspaceAction(action)
  }
}

export async function rewindTask(raw: RewindTaskInput): Promise<RewindTaskResult> {
  const input = RewindTaskInput.parse(raw)
  const task = findTask(input.taskID)
  if (!task) {
    throw new NotFoundError({ message: `Task not found: ${input.taskID}` })
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
    setEngineTaskRewindCursor(db, {
      taskID: input.taskID,
      cursorTime,
      anchorEventID,
      rewindCount: nextCount,
      timeUpdated: now,
    }),
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
  if (!task) throw new NotFoundError({ message: `Task not found: ${taskID}` })
  if (task.rewind_cursor_time == null) return

  const now = Date.now()
  Database.use((db) => clearEngineTaskRewindCursor(db, { taskID, timeUpdated: now }))
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
