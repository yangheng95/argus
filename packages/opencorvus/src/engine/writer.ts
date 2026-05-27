/**
 * Writer/invariant primitives for terminating live execution state.
 *
 * Both process-restart recovery and operator-driven restart_from_stage need
 * to abort the same kinds of rows — live goal_runs, live executor_sessions,
 * live runs — while preserving per-goal workspaces. Historically
 * each call site had its own copy of the "loop + abort" logic, which
 * drifted: executor session aborts in some paths went through the writer
 * layer and in others didn't, error messages formatted differently, and new rows
 * were created with raw `db.insert` side-stepping the state-machine writers.
 *
 * This module keeps the primitives in one place so callers only choose the
 * scope filter (project vs task) and the cleanup policy. Cleanup itself is
 * success-only: a workspace can be deleted only when the latest goal_run is
 * completed. All status writes
 * go through `updateGoalRun` / `updateExecutorSessionStatus*` / `updateRun`,
 * which enforce CAS + state-machine transitions + event emission (for
 * task/run).
 */
import { Log } from "@/util/log"
import { Database, and, eq, inArray, isNotNull, isNull } from "@/storage/db"
import { Identifier } from "@/id/id"
import { GOAL_RUN_RESETTABLE_STATUSES, LIVE_RUN_STATUSES } from "./catalog"
import { EngineArtifactTable, EngineTaskTable, type EngineRunStatus } from "./engine.sql"
import { Event } from "./model"
import { EngineProtocol } from "./protocol"
import { Message } from "@/session/message"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { toolFailureCauseFromUnknown } from "@/session/tool-failure-cause"
import {
  updateExecutorSessionStatus,
  updateExecutorSessionStatusByID,
  updateGoalRun,
} from "./persist"
import {
  findGoal,
  findRun,
  findRuns,
  goalRunQueueTaskID,
  listGoals,
  listGoalWorkspacesForProject,
  listGoalRunsForTask,
  listLiveExecutorSessionsForProject,
  listLiveExecutorSessionsForTask,
  listLiveGoalRunsForProject,
  listLiveRunsForProject,
  type ExecutorSessionRow,
  type GoalRunRow,
  type RunRow,
  type TaskRow,
} from "./store"
import { updateRun, updateTask } from "./state"
import { updateGoalWorkspace } from "./persist"

const log = Log.create({ service: "engine-writer" })

// ---------------------------------------------------------------------------
// Initial writes (insertions)
// ---------------------------------------------------------------------------

export interface CreateRunInput {
  taskID: string
  planVersionID?: string | null
  sessionID?: string | null
  executor: RunRow["executor"]
  status: EngineRunStatus
  phase?: RunRow["phase"]
  retryCount?: number
  metadata?: Record<string, unknown>
  linkAsActive?: boolean
  summary?: string
  now?: number
}

/**
 * Insert a new EngineRunTable row and emit RunCreated.
 *
 * Callers used to do `db.insert(EngineRunTable).values({...})` directly with
 * their own `status`/`phase`/`metadata`, which (a) bypassed event emission
 * and (b) scattered initial-state conventions across three different tools
 * (dispatch_goal, create_run, restart_from_stage). Funnel everything through
 * here so "a new run exists" is one fact with one audit trail.
 *
 * Optional `linkAsActive=true` also sets `task.active_run_id` in the same
 * transaction — matches the behavior the tools previously inlined.
 */
export function createRun(input: CreateRunInput): RunRow {
  // Phase-6-e: run rows live in engine_artifact (kind="run"). First insert
  // sets id = run_id (self-reference) so other tables' plain-text run_id
  // pointers resolve to a valid artifact row.
  const runID = Identifier.ascending("run")
  const now = input.now ?? Date.now()
  const summary = input.summary ?? `run created (${input.status})`
  const payload = {
    plan_version_id: input.planVersionID ?? null,
    session_id: input.sessionID ?? null,
    executor: input.executor,
    status: input.status,
    phase: input.phase ?? "dispatch",
    retry_count: input.retryCount ?? 0,
    blocking_reason: null,
    error: null,
    executor_ref: null,
    metadata: input.metadata ?? {},
    time_started: null,
    time_completed: null,
  }
  Database.transaction((db) => {
    db.insert(EngineArtifactTable)
      .values({
        id: runID,
        task_id: input.taskID,
        run_id: runID,
        kind: "run",
        label: `run-${input.status}`,
        payload,
        time_created: now,
        time_updated: now,
      })
      .run()
    if (input.linkAsActive) {
      // Phase-6-f-3: task.active_run_id deleted — new runs are the active
      // one by virtue of being the latest artifact. Keep a time_updated
      // bump so task listings sort newer.
      db.update(EngineTaskTable)
        .set({ time_updated: now })
        .where(eq(EngineTaskTable.id, input.taskID))
        .run()
    }
    Database.effect(() =>
      EngineProtocol.emit(
        Event.RunCreated,
        { taskID: input.taskID, runID, status: input.status, summary },
        { source: "writer.createRun" },
      ),
    )
  })
  const inserted = findRun(runID)
  if (!inserted) throw new Error(`createRun: inserted run ${runID} not found after insert`)
  return inserted
}

// ---------------------------------------------------------------------------
// Termination primitives (used by both recovery and restart_from_stage)
// ---------------------------------------------------------------------------

export interface AbortOptions {
  reason: string
}

export async function cleanupGoalWorkspaceForGoal(goalID: string): Promise<boolean> {
  // Phase B (2026-05-05): persistent worktree pointer lives on the latest
  // goal_run_attempt artifact, not on engine_goal. Read via
  // findGoalLatestWorkspace(goalID); cleanup nulls the pointer through the
  // updateGoalWorkspace writer (which appends a patch to the latest tip).
  const { findGoalLatestWorkspace } = await import("@/engine/store")
  const live = findGoalLatestWorkspace(goalID)
  if (!live.directory) return false
  if (live.status !== "completed") {
    log.warn("cleanupGoalWorkspaceForGoal skipped non-completed latest goal_run", {
      goalID,
      goalRunID: live.goalRunID,
      status: live.status,
      directory: live.directory,
    })
    return false
  }

  const { cleanupGoalWorkspace } = await import("@/goal/runner")
  await cleanupGoalWorkspace(live.directory)
  updateGoalWorkspace({
    goalID,
    workspaceDir: null,
    workspaceBranch: null,
    // Terminal cleanup also clears the goal-scoped baseRef. A later fresh
    // dispatch (restart_from_stage / max_retries reset / etc.) will
    // re-capture Snapshot.track() from the new scaffold state.
    workspaceBaseRef: null,
  })
  return true
}

async function cleanupGoalWorkspaces(goalIDs: string[]) {
  let cleaned = 0
  for (const goalID of new Set(goalIDs)) {
    if (await cleanupGoalWorkspaceForGoal(goalID)) cleaned += 1
  }
  return cleaned
}

async function finalizeInterruptedQueueTasks(queueTaskIDs: Array<string | undefined>, reason: string) {
  const ids = [...new Set(queueTaskIDs.filter((id): id is string => typeof id === "string" && id.length > 0))]
  if (ids.length === 0) return
  const now = Date.now()
  const { TaskQueueTable } = await import("@/scheduler/task-queue.sql")
  Database.use((db) =>
    db
      .update(TaskQueueTable)
      .set({
        status: "failed",
        error_message: reason,
        time_completed: now,
        time_updated: now,
      })
      .where(and(
        inArray(TaskQueueTable.id, ids),
        inArray(TaskQueueTable.status, ["queued", "retrying", "running"]),
      ))
      .run(),
  )
}

/** Abort a batch of goal_run rows. Workspace lifecycle is goal-scoped. */
export async function abortGoalRuns(rows: GoalRunRow[], options: AbortOptions): Promise<number> {
  let aborted = 0
  for (const row of rows) {
    const updated = updateGoalRun(row.id, {
      status: "aborted",
      error: options.reason,
      blocking_reason: null,
    })
    if (updated) aborted += 1
  }
  await finalizeInterruptedQueueTasks(rows.map((row) => goalRunQueueTaskID(row)), options.reason)
  return aborted
}

/** Abort a batch of executor_session rows. */
export function abortExecutorSessions(rows: ExecutorSessionRow[]): number {
  for (const row of rows) {
    updateExecutorSessionStatusByID(row.id, "aborted")
  }
  return rows.length
}

/** Abort a batch of run rows via the state.ts writer (CAS + event emission). */
export async function abortRuns(rows: RunRow[], reason: string): Promise<number> {
  let aborted = 0
  for (const row of rows) {
    await updateRun(
      row,
      { status: "aborted", error: reason, blocking_reason: null },
      reason,
    )
    aborted += 1
  }
  await finalizeInterruptedQueueTasks(rows.map((row) => row.executor_ref?.queue_task_id), reason)
  return aborted
}

/** Convenience: abort the executor_session attached to a specific run. */
export function abortExecutorSessionForRun(runID: string) {
  updateExecutorSessionStatus(runID, "aborted")
}

// ---------------------------------------------------------------------------
// Scoped composites
// ---------------------------------------------------------------------------

export interface AbortLiveResult {
  goalRuns: number
  runs: number
  executorSessions: number
}

export interface AbortActiveTasksResult {
  tasks: number
  sessions: number
  toolParts: number
}

async function abortOpenToolParts(sessionID: string, reason: string): Promise<number> {
  const messages = await Session.messages({ sessionID })
  let updated = 0
  for (const message of messages) {
    const parts = await Message.parts(message.info.id)
    for (const part of parts) {
      if (part.type !== "tool") continue
      if (part.state.status === "completed" || part.state.status === "error") continue
      const now = Date.now()
      const start = part.state.status === "running" ? part.state.time.start : now
      await Session.updatePart({
        ...part,
        state: {
          status: "error",
          input: part.state.input,
          failure: toolFailureCauseFromUnknown({
            error: reason,
            originSite: "engine.writer.abort-open-tool-parts",
            classification: "tool-execution",
            kind: "tool-execute-error",
            data: {
              sessionID,
              toolName: part.tool,
              callID: part.callID,
            },
          }),
          time: {
            start,
            end: now,
          },
        },
      })
      updated += 1
    }
  }
  return updated
}

function listActiveTasksForProject(projectID: string): TaskRow[] {
  return Database.use((db) =>
    db
      .select()
      .from(EngineTaskTable)
      .where(and(
        eq(EngineTaskTable.project_id, projectID),
        isNotNull(EngineTaskTable.time_started),
        isNull(EngineTaskTable.time_completed),
      ))
      .all(),
  )
}

/**
 * Terminate task-owned session trees for every active task in a project.
 * Run / goal_run / executor_session rows are aborted by the existing writers;
 * this closes the task-owned layer that direct in-process builds rely on.
 * Without it, shutdown can leave a stale `active` task with a pending tool
 * part even though the process that owned the session is gone.
 */
export async function abortActiveTasksForProject(input: {
  projectID: string
  reason: string
}): Promise<AbortActiveTasksResult> {
  let tasks = 0
  let sessions = 0
  let toolParts = 0
  const activeTasks = listActiveTasksForProject(input.projectID)
  for (const task of activeTasks) {
    if (task.session_id) {
      const ids = await Session.tree(task.session_id)
      for (const sessionID of ids.slice().reverse()) {
        toolParts += await abortOpenToolParts(sessionID, input.reason)
        SessionPrompt.cancel(sessionID)
        sessions += 1
      }
    }
    await updateTask(task, {
      status: "failed",
      error: input.reason,
    }, input.reason)
    tasks += 1
  }
  return { tasks, sessions, toolParts }
}

/**
 * Scope: all live execution state for a single task.
 *
 * Used by restart_from_stage. Filters mirror what the previous inline
 * implementation used:
 *   - goal_runs with a resettable status (skips completed/aborted/failed)
 *   - runs in any live status (LIVE_RUN_STATUSES)
 *   - executor_sessions attached to the task
 *
 * Goal workspaces are goal-scoped, not goal_run-scoped. Task-level aborts
 * preserve workspaces by default. Physical deletion is success-only and is
 * guarded in cleanupGoalWorkspaceForGoal by the latest goal_run status.
 */
export async function abortLiveExecutionForTask(input: {
  taskID: string
  reason: string
  cleanupGoalWorkspaces?: boolean
  includeGoalRuns?: boolean
  includeRuns?: boolean
}): Promise<AbortLiveResult> {
  const goalRunRows = input.includeGoalRuns === false
    ? []
    : listGoalRunsForTask(input.taskID).filter((row) =>
        GOAL_RUN_RESETTABLE_STATUSES.includes(row.status),
      )
  const runRows = input.includeRuns === false
    ? []
    : findRuns(input.taskID).filter((row) => LIVE_RUN_STATUSES.includes(row.status))
  const sessionRows = listLiveExecutorSessionsForTask(input.taskID)
  const executorSessions = abortExecutorSessions(sessionRows)
  const goalRuns = await abortGoalRuns(goalRunRows, { reason: input.reason })
  const cleanupGoals = input.cleanupGoalWorkspaces === true
    ? listGoals(input.taskID).map((goal) => goal.id)
    : []
  await cleanupGoalWorkspaces(cleanupGoals)
  const runs = await abortRuns(runRows, input.reason)
  return { goalRuns, runs, executorSessions }
}

/**
 * Scope: all live execution state for a project (process-restart recovery).
 *
 * Used by recoverProjectExecution. Cleans goal workspaces because the old
 * worktree directory is no longer registered with any running process — if
 * we don't remove them, leftover worktrees confuse subsequent runs.
 *
 * Orphan-run detection (run is live but has no live goal_run / session) is
 * left to the caller so recovery can log orphan IDs before aborting.
 */
export async function abortLiveExecutionForProject(input: {
  projectID: string
  reason: string
  cleanupGoalWorkspaces?: boolean
}): Promise<AbortLiveResult> {
  const sessionRows = listLiveExecutorSessionsForProject(input.projectID)
  const goalRunRows = listLiveGoalRunsForProject(input.projectID)
    .filter((goalRun) => goalRun.status !== "queued")
  const executorSessions = abortExecutorSessions(sessionRows)
  const goalRuns = await abortGoalRuns(goalRunRows, { reason: input.reason })
  const cleanupGoals = input.cleanupGoalWorkspaces === true
    ? listGoalWorkspacesForProject(input.projectID).map((entry) => entry.goal.id)
    : []
  await cleanupGoalWorkspaces(cleanupGoals)
  return { goalRuns, runs: 0, executorSessions }
}

export { listLiveRunsForProject }
