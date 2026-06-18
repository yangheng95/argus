/**
 * Writer/invariant primitives for terminating live execution state.
 *
 * Both process-restart recovery and operator-driven restart_from_stage need
 * to abort the same kinds of rows — live goal_runs and live runs — while
 * preserving per-goal workspaces. Historically each call site had its own
 * copy of the "loop + abort" logic, which drifted: error messages formatted
 * differently, and new rows were created with raw `db.insert` side-stepping
 * the state-machine writers.
 *
 * This module keeps the primitives in one place so callers only choose the
 * scope filter (project vs task) and the cleanup policy. Cleanup itself is
 * success-only: a workspace can be deleted only when the latest goal_run is
 * completed. All status writes go through `updateGoalRun` / `updateRun`,
 * which enforce CAS + state-machine transitions + event emission (for
 * task/run).
 */
import { Log } from "@/util/log"
import { Database, and, eq, inArray, isNotNull, isNull } from "@/storage/db"
import { Identifier } from "@/id/id"
import { GOAL_RUN_RESETTABLE_STATUSES, LIVE_RUN_STATUSES, isLiveGoalRunStatus, isLiveRunStatus } from "./catalog"
import { EngineArtifactTable, EngineTaskTable, type EngineRunStatus } from "./engine.sql"
import { Event } from "./model"
import { EngineProtocol } from "./protocol"
import { Message } from "@/session/message"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { toolFailureCauseFromUnknown } from "@/session/tool-failure-cause"
import { PartTable } from "@/session/session.sql"
import { updateGoalRun } from "./persist"
import {
  findGoal,
  findRun,
  findRuns,
  findTask,
  goalRunQueueTaskID,
  listGoals,
  listGoalWorkspacesForProject,
  listGoalRunsForTask,
  listLiveGoalRunsForProject,
  listLiveRunsForProject,
  type GoalRunRow,
  type RunRow,
  type TaskRow,
} from "./store"
import { updateRun, updateTask } from "./state"
import {
  completeOrchestratorToolOwnership,
  listLiveOrchestratorToolOwnership,
  type OrchestratorToolOwnershipRow,
  type OrchestratorToolOwnershipPayload,
} from "./tool-ownership"
import { abortGoalRunExecution } from "./execution-abort"
import { updateGoalWorkspace } from "./persist"
import { processOwner } from "./lease"
import { isGoalRunOrphaned } from "./orphan"
import { taskIDForSession } from "@/orchestrator/task-event"
import { Project } from "@/project/project"
import { Instance } from "@/project/instance"

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
      db.update(EngineTaskTable).set({ time_updated: now }).where(eq(EngineTaskTable.id, input.taskID)).run()
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
      .where(and(inArray(TaskQueueTable.id, ids), inArray(TaskQueueTable.status, ["queued", "running"])))
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
  await finalizeInterruptedQueueTasks(
    rows.map((row) => goalRunQueueTaskID(row)),
    options.reason,
  )
  return aborted
}

/** Abort a batch of run rows via the state.ts writer (CAS + event emission). */
export async function abortRuns(rows: RunRow[], reason: string): Promise<number> {
  let aborted = 0
  for (const row of rows) {
    await updateRun(row, { status: "aborted", error: reason, blocking_reason: null }, reason)
    aborted += 1
  }
  await finalizeInterruptedQueueTasks(
    rows.map((row) => row.executor_ref?.queue_task_id),
    reason,
  )
  return aborted
}

// ---------------------------------------------------------------------------
// Scoped composites
// ---------------------------------------------------------------------------

export interface AbortLiveResult {
  goalRuns: number
  runs: number
}

export interface AbortActiveTasksResult {
  tasks: number
  sessions: number
  toolParts: number
}

export interface AbortLiveOwnershipResult {
  ownerships: number
  goalRuns: number
  sessions: number
  toolParts: number
}

export interface AbortProcessLiveExecutionResult extends AbortActiveTasksResult, AbortLiveResult {
  ownerships: number
  corruptTasks: number
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

async function abortOwnedToolPart(input: {
  ownership: OrchestratorToolOwnershipPayload
  reason: string
  originSite: string
  metadata?: Record<string, unknown>
  now?: number
}): Promise<number> {
  const row = Database.use((db) =>
    db
      .select()
      .from(PartTable)
      .where(
        and(
          eq(PartTable.id, input.ownership.tool_part_id),
          eq(PartTable.session_id, input.ownership.orchestrator_session_id),
        ),
      )
      .get(),
  )
  const part = row
    ? ({
        ...row.data,
        id: row.id,
        sessionID: row.session_id,
        messageID: row.message_id,
      } as Message.Part)
    : undefined
  if (!part || part.type !== "tool" || part.state.status === "completed" || part.state.status === "error") return 0

  const now = input.now ?? Date.now()
  const start = part.state.status === "running" ? part.state.time.start : input.ownership.time_started
  await Session.updatePart({
    ...part,
    state: {
      status: "error",
      input: part.state.input,
      failure: toolFailureCauseFromUnknown({
        error: input.reason,
        originSite: input.originSite,
        classification: "tool-execution",
        kind: "tool-execute-error",
        data: {
          toolName: part.tool,
          callID: part.callID,
        },
      }),
      metadata: {
        ...(part.state.status === "running" ? (part.state.metadata ?? {}) : {}),
        ...(input.metadata ?? {}),
      },
      time: {
        start,
        end: now,
      },
    },
  })
  return 1
}

function listActiveTasksForProject(projectID: string): TaskRow[] {
  return Database.use((db) =>
    db
      .select()
      .from(EngineTaskTable)
      .where(
        and(
          eq(EngineTaskTable.project_id, projectID),
          isNotNull(EngineTaskTable.time_started),
          isNull(EngineTaskTable.time_completed),
        ),
      )
      .all(),
  )
}

function listActiveTasks(): TaskRow[] {
  return Database.use((db) =>
    db
      .select()
      .from(EngineTaskTable)
      .where(and(isNotNull(EngineTaskTable.time_started), isNull(EngineTaskTable.time_completed)))
      .all(),
  )
}

async function terminateTaskOwnedSessionsAndFail(input: {
  task: TaskRow
  reason: string
}): Promise<AbortActiveTasksResult> {
  let sessions = 0
  let toolParts = 0
  const task = input.task
  const project = task.project_id === "global" ? undefined : Project.get(task.project_id)
  if (!project && task.project_id !== "global") {
    throw new Error(`Cannot terminate task ${task.id}: project ${task.project_id} not found`)
  }
  if (task.session_id) {
    const ids = await Session.treeInProject({ sessionID: task.session_id, projectID: task.project_id })
    for (const sessionID of ids.slice().reverse()) {
      toolParts += await abortOpenToolParts(sessionID, input.reason)
      if (project) {
        await publishSessionAbortInProject(sessionID, project.worktree, input.reason)
        SessionPrompt.cancel(sessionID, project.worktree)
      } else {
        SessionStatus.abortActivityGate(sessionID, new DOMException(input.reason, "AbortError"))
        SessionStatus.set(sessionID, {
          type: "terminal",
          reason: "aborted",
          error: input.reason,
        })
        SessionPrompt.cancel(sessionID)
      }
      sessions += 1
    }
  }
  await updateTask(
    task,
    {
      status: "failed",
      error: input.reason,
    },
    input.reason,
    project ? { projectDir: project.worktree } : undefined,
  )
  return { tasks: 1, sessions, toolParts }
}

async function provideTaskRootSessionDirectory<T>(task: TaskRow, fn: () => Promise<T>): Promise<T> {
  if (Instance.current() || !task.session_id) return fn()
  const session = await Session.get(task.session_id)
  return Instance.provide({
    directory: session.directory,
    fn,
  })
}

async function publishSessionAbortInProject(sessionID: string, directory: string, reason: string) {
  await Instance.provide({
    directory,
    async fn() {
      SessionStatus.abortActivityGate(sessionID, new DOMException(reason, "AbortError"))
      SessionStatus.set(sessionID, {
        type: "terminal",
        reason: "aborted",
        error: reason,
      })
    },
  })
}

/**
 * Terminate task-owned session trees for every active task in a project.
 * Run / goal_run rows are aborted by the existing writers;
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
    const result = await terminateTaskOwnedSessionsAndFail({ task, reason: input.reason })
    tasks += result.tasks
    sessions += result.sessions
    toolParts += result.toolParts
  }
  return { tasks, sessions, toolParts }
}

function currentProcessSessionTaskIDs(): Set<string> {
  const taskIDs = new Set<string>()
  for (const [sessionID, status] of Object.entries(SessionStatus.list())) {
    if (status.type !== "streaming" && status.type !== "retry") continue
    const taskID = taskIDForSession(sessionID)
    if (taskID) taskIDs.add(taskID)
  }
  return taskIDs
}

function currentProcessOwnedGoalRuns(task: TaskRow): GoalRunRow[] {
  const owner = processOwner()
  return listGoalRunsForTask(task.id).filter(
    (row) => isLiveGoalRunStatus(row.status) && row.status !== "queued" && row.owner === owner,
  )
}

function currentProcessOwnedToolOwnership(task: TaskRow): OrchestratorToolOwnershipRow[] {
  const owner = processOwner()
  return listLiveOrchestratorToolOwnership(task.id).filter((row) => row.payload.owner === owner)
}

function affectedRunsForGoalRuns(taskID: string, goalRuns: GoalRunRow[]): RunRow[] {
  const runIDs = [...new Set(goalRuns.map((row) => row.coordinator_run_id).filter((item): item is string => !!item))]
  return runIDs.flatMap((runID) => {
    const run = findRun(runID)
    if (!run || !isLiveRunStatus(run.status)) return []
    const hasLiveExecutor = listGoalRunsForTask(taskID).some(
      (row) =>
        row.coordinator_run_id === runID &&
        isLiveGoalRunStatus(row.status) &&
        row.status !== "queued" &&
        !isGoalRunOrphaned(row),
    )
    return hasLiveExecutor ? [] : [run]
  })
}

async function abortRunsForRows(rows: RunRow[], reason: string): Promise<number> {
  const unique = new Map(rows.map((row) => [row.id, row]))
  return abortRuns([...unique.values()], reason)
}

async function abortGoalRunsForRows(rows: GoalRunRow[], reason: string): Promise<number> {
  const unique = new Map(rows.map((row) => [row.id, row]))
  return abortGoalRuns([...unique.values()], { reason })
}

/**
 * Process-shutdown convergence.
 *
 * This discovers live work from process-owned facts, not from the sidecar
 * launch directory. A Tauri sidecar can start in an app-data cwd that resolves
 * to the historical `global` pseudo-project; shutdown must still close the
 * concrete tasks this process owns.
 */
export async function abortCurrentProcessLiveExecution(input: {
  reason: string
}): Promise<AbortProcessLiveExecutionResult> {
  const activeTasks = listActiveTasks()
  const taskIDs = currentProcessSessionTaskIDs()
  for (const task of activeTasks) {
    if (currentProcessOwnedToolOwnership(task).length > 0) taskIDs.add(task.id)
    if (currentProcessOwnedGoalRuns(task).length > 0) taskIDs.add(task.id)
  }

  let tasks = 0
  let sessions = 0
  let toolParts = 0
  let goalRuns = 0
  let runs = 0
  let ownerships = 0
  let corruptTasks = 0

  for (const taskID of taskIDs) {
    const task = findTask(taskID)
    if (!task) continue
    await provideTaskRootSessionDirectory(task, async () => {
      const isCorruptGlobalTask = task.project_id === "global"
      if (isCorruptGlobalTask) corruptTasks += 1
      const project = isCorruptGlobalTask ? undefined : Project.get(task.project_id)
      if (!project && !isCorruptGlobalTask) {
        throw new Error(`Cannot abort task ${task.id}: project ${task.project_id} not found`)
      }
      if (isCorruptGlobalTask) {
        log.error("abortCurrentProcessLiveExecution: corrupt global task terminalized", { taskID })
      }

      const ownedToolRuns = currentProcessOwnedToolOwnership(task)
      const ownedGoalRunsBefore = currentProcessOwnedGoalRuns(task)
      const ownershipResult = await abortLiveOrchestratorToolOwnership({
        taskID: task.id,
        reason: input.reason,
        ownerships: ownedToolRuns,
        originSite: "engine.writer.abort-current-process-live-execution",
        promptDirectory: project?.worktree,
      })
      ownerships += ownershipResult.ownerships
      goalRuns += ownershipResult.goalRuns
      sessions += ownershipResult.sessions
      toolParts += ownershipResult.toolParts

      const ownedGoalRunsAfter = currentProcessOwnedGoalRuns(task)
      goalRuns += await abortGoalRunsForRows(ownedGoalRunsAfter, input.reason)
      const affectedRuns = affectedRunsForGoalRuns(task.id, [...ownedGoalRunsBefore, ...ownedGoalRunsAfter])
      runs += await abortRunsForRows(affectedRuns, input.reason)

      const taskResult = await terminateTaskOwnedSessionsAndFail({
        task: findTask(task.id) ?? task,
        reason: input.reason,
      })
      tasks += taskResult.tasks
      sessions += taskResult.sessions
      toolParts += taskResult.toolParts
    })
  }

  return { tasks, sessions, toolParts, goalRuns, runs, ownerships, corruptTasks }
}

/** Read-only startup inspection for live goal attempts whose owning process is gone. */
export async function convergeDeadOwnerLiveExecution(input: {
  reason: string
}): Promise<AbortProcessLiveExecutionResult> {
  return convergeDeadOwnerLiveExecutionForTasks({
    tasks: listActiveTasks(),
    reason: input.reason,
  })
}

export async function convergeDeadOwnerLiveExecutionForTasks(input: {
  tasks: TaskRow[]
  reason: string
}): Promise<AbortProcessLiveExecutionResult> {
  let tasks = 0
  let goalRuns = 0
  let runs = 0
  let corruptTasks = 0
  void input.reason

  for (const candidate of input.tasks) {
    const task = findTask(candidate.id)
    if (!task || task.time_started == null || task.time_completed != null) continue
    await provideTaskRootSessionDirectory(task, async () => {
      const orphanGoalRuns = listGoalRunsForTask(task.id).filter(
        (row) => row.status !== "queued" && isGoalRunOrphaned(row),
      )
      if (orphanGoalRuns.length === 0) return
      tasks += 1
      if (task.project_id === "global") {
        corruptTasks += 1
        log.error("convergeDeadOwnerLiveExecution: corrupt global task has dead-owner execution", { taskID: task.id })
      }

      goalRuns += new Set(orphanGoalRuns.map((row) => row.id)).size
      runs += new Set(affectedRunsForGoalRuns(task.id, orphanGoalRuns).map((row) => row.id)).size
    })
  }

  return { tasks, sessions: 0, toolParts: 0, goalRuns, runs, ownerships: 0, corruptTasks }
}

/**
 * Close live orchestrator-owned child tool execution for one task.
 *
 * This is used for explicit operator interrupts. It does not decide a retry
 * policy; it records the physical fact that the current child execution was
 * cancelled so the next orchestrator turn can read the terminal goal_run and
 * choose the next action.
 */
export async function abortLiveOrchestratorToolOwnership(input: {
  taskID: string
  reason: string
  ownerships?: OrchestratorToolOwnershipRow[]
  originSite?: string
  metadata?: Record<string, unknown>
  promptDirectory?: string
}): Promise<AbortLiveOwnershipResult> {
  const ownerships = input.ownerships ?? listLiveOrchestratorToolOwnership(input.taskID)
  const originSite = input.originSite ?? "engine.writer.abort-live-orchestrator-tool-ownership"
  const now = Date.now()
  let closed = 0
  let goalRuns = 0
  let sessions = 0
  let toolParts = 0

  for (const ownership of ownerships) {
    const childSessionID = ownership.payload.child_session_id
    if (input.promptDirectory) {
      await publishSessionAbortInProject(childSessionID, input.promptDirectory, input.reason)
    } else {
      SessionStatus.abortActivityGate(childSessionID, new DOMException(input.reason, "AbortError"))
      SessionStatus.set(childSessionID, {
        type: "terminal",
        reason: "aborted",
        error: input.reason,
      })
    }
    SessionPrompt.cancel(childSessionID, input.promptDirectory)
    sessions += 1

    if (ownership.payload.goal_run_id) {
      const aborted = await abortGoalRunExecution({
        taskID: input.taskID,
        goalRunID: ownership.payload.goal_run_id,
        reason: input.reason,
      })
      if (aborted.goalRunAborted) goalRuns += 1
    }

    toolParts += await abortOwnedToolPart({
      ownership: ownership.payload,
      reason: input.reason,
      originSite,
      metadata: input.metadata,
      now,
    })

    completeOrchestratorToolOwnership({
      taskID: input.taskID,
      ownershipID: ownership.ownershipID,
      outcome: "cancelled",
      error: input.reason,
      now,
    })
    closed += 1
  }

  return { ownerships: closed, goalRuns, sessions, toolParts }
}

/**
 * Scope: all live execution state for a single task.
 *
 * Used by restart_from_stage. Filters mirror what the previous inline
 * implementation used:
 *   - goal_runs with a resettable status (skips completed/aborted/failed)
 *   - runs in any live status (LIVE_RUN_STATUSES)
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
  const goalRunRows =
    input.includeGoalRuns === false
      ? []
      : listGoalRunsForTask(input.taskID).filter((row) => GOAL_RUN_RESETTABLE_STATUSES.includes(row.status))
  const runRows =
    input.includeRuns === false ? [] : findRuns(input.taskID).filter((row) => LIVE_RUN_STATUSES.includes(row.status))
  const goalRuns = await abortGoalRuns(goalRunRows, { reason: input.reason })
  const cleanupGoals = input.cleanupGoalWorkspaces === true ? listGoals(input.taskID).map((goal) => goal.id) : []
  await cleanupGoalWorkspaces(cleanupGoals)
  const runs = await abortRuns(runRows, input.reason)
  return { goalRuns, runs }
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
  const goalRunRows = listLiveGoalRunsForProject(input.projectID).filter((goalRun) => goalRun.status !== "queued")
  const goalRuns = await abortGoalRuns(goalRunRows, { reason: input.reason })
  const cleanupGoals =
    input.cleanupGoalWorkspaces === true
      ? listGoalWorkspacesForProject(input.projectID).map((entry) => entry.goal.id)
      : []
  await cleanupGoalWorkspaces(cleanupGoals)
  return { goalRuns, runs: 0 }
}

export { listLiveRunsForProject }
