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
import { Identifier } from "@/id/id"
import { MessageTable } from "@/session/session.sql"
import { Database, and, eq, gt } from "@/storage/db"
import { Log } from "@/util/log"
import { interruptTaskLoop, awaitTaskLoopIdle } from "@/orchestrator/loop"
import { taskIDForSession } from "@/orchestrator/task-event"
import { Worktree } from "@/worktree"
import { EngineGoalTable, EngineTaskTable, type EngineGoalRunStatus } from "./engine.sql"
import { Event } from "./model"
import { EngineProtocol } from "./protocol"
import { updateGoalRun } from "./persist"
import { findTask, listGoalRunsForTask, type GoalRunRow } from "./store"

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
  if (!row) throw new Error(`rewindTask: message ${input.messageID} not found in session ${input.sessionID}`)
  return row
}

function ensureAnchorBelongsToTask(taskID: string, sessionID: string) {
  const owner = taskIDForSession(sessionID)
  if (owner !== taskID) {
    throw new Error(`rewindTask: session ${sessionID} does not belong to task ${taskID}`)
  }
}

const TERMINAL_GOAL_RUN_STATUSES = new Set<EngineGoalRunStatus>(["completed", "failed", "aborted"])

type RewindWorkspaceAction = {
  goalID: string
  goalRunID: string
  workspaceDir: string | null
  workspaceBaseRef: string | null
  remove: boolean
  status: EngineGoalRunStatus
}

function runTimeForRewind(row: GoalRunRow): number {
  const started = Number(row.time_started)
  return Number.isFinite(started) && started > 0 ? started : row.time_created
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

async function applyWorktreeReset(input: RewindTaskInput, cursorTime: number): Promise<void> {
  interruptTaskLoop(input.taskID, "task rewind worktree reset")
  await awaitTaskLoopIdle(input.taskID, WORKTREE_RESET_IDLE_TIMEOUT_MS)

  const actions = collectWorkspaceActions(input.taskID, cursorTime)
  for (const action of actions) {
    if (!action.workspaceDir) continue
    if (action.remove) {
      await Worktree.remove({ directory: action.workspaceDir })
      updateGoalRun(action.goalRunID, {
        workspace_dir: null,
        workspace_branch: null,
        workspace_base_ref: null,
        ...(!TERMINAL_GOAL_RUN_STATUSES.has(action.status) ? { status: "aborted" as const } : {}),
      })
      continue
    }
    if (!action.workspaceBaseRef) {
      throw new Error(`rewindTask: goal ${action.goalID} workspace is missing workspace_base_ref`)
    }
    await Worktree.reset({ directory: action.workspaceDir, baseRef: action.workspaceBaseRef })
    if (!TERMINAL_GOAL_RUN_STATUSES.has(action.status)) {
      updateGoalRun(action.goalRunID, { status: "aborted" })
    }
  }
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
