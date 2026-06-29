/**
 * Task serialization queue — single source of truth for queue=true task
 * admission in a working directory.
 *
 * Lock key: the task's working directory (cwd), resolved from
 *   session.directory → project.worktree.
 *
 * queue=true tasks in the same cwd are serialized. queue=false creation
 * intentionally starts immediately so same-project tasks can run in parallel;
 * runtime isolation is provided by task/session-scoped runtime paths.
 *
 * All queued scheduling requests must go through this module so queued-task
 * claiming and active-task re-entry share one coordinator.
 */

import { ProjectTable } from "@/project/project.sql"
import { SessionTable } from "@/session/session.sql"
import { Database, and, desc, eq, sql } from "@/storage/db"
import { Log } from "@/util/log"
import { EngineArtifactTable, EngineProgressSnapshotTable, EngineTaskTable } from "./engine.sql"
import { findActiveRunForTask, findTask, type TaskRow } from "./store"
import { deriveTaskStatus, isTaskActive, isTaskQueued, isTaskTerminal } from "./task-status"
import type { OrchestratorEvent } from "@/orchestrator/agent"
import { Identifier } from "@/id/id"
import { Event } from "./model"
import { EngineProtocol } from "./protocol"
import { openTaskForOperatorWake } from "./task-message-open"
import { listLiveOrchestratorToolOwnership } from "./tool-ownership"
import { Instance } from "@/project/instance"

const log = Log.create({ service: "engine.queue" })
const DEAD_OWNER_QUEUE_CONVERGENCE_REASON = "Directory queue: previous owner process died before interruption"

// Process-local loop accounting. The real queue lock is in the DB
// (claimNextForCwd), but interrupt-driven replacement can briefly overlap an
// old loop that is unwinding with the new wake that supersedes it.
const loopInFlight = new Map<string, number>()

type QueuedOperatorWakePayload = {
  wake_id: string
  task_id: string
  message_id?: string
  request_id?: string
  lifecycle_event_id?: string
  source_kind: "operator_message" | "operator_intent" | "coordination_request" | "task_lifecycle" | "orchestrator_event"
  event: OrchestratorEvent
  time_queued: number
  queued_by_process_id: number
  queued_by_instance_directory?: string
  queued_by_project_id?: string
}

export function discardQueuedTaskEvent(taskID: string): void {
  discardPendingQueuedOperatorWakes(taskID)
}

export function queuedTaskEventStats(taskID?: string) {
  if (taskID) {
    const durableCount = pendingQueuedOperatorWakeTaskIDs().filter((id) => id === taskID).length
    return {
      tasks: durableCount > 0 ? 1 : 0,
      events: durableCount,
    }
  }
  const durableRows = pendingQueuedOperatorWakeTaskIDs()
  return {
    tasks: new Set<string>(durableRows).size,
    events: durableRows.length,
  }
}

function pendingQueuedOperatorWakeTaskIDs(): string[] {
  return Database.use((db) =>
    db
      .select({ taskID: EngineArtifactTable.task_id })
      .from(EngineArtifactTable)
      .where(and(eq(EngineArtifactTable.kind, "queued_operator_wake"), eq(EngineArtifactTable.label, "pending")))
      .all()
      .map((row) => row.taskID),
  )
}

function enqueueTaskEvent(taskID: string, event: OrchestratorEvent): void {
  const messageID = event.operatorMessage?.messageID?.trim()
  const requestID = event.coordinationRequest?.requestID.trim()
  const lifecycleEventID = event.lifecycleFact?.eventID.trim()
  persistQueuedOperatorWake(taskID, event, { messageID, requestID, lifecycleEventID })
}

function persistQueuedOperatorWake(
  taskID: string,
  event: OrchestratorEvent,
  identity: { messageID?: string; requestID?: string; lifecycleEventID?: string },
): void {
  const messageID = identity.messageID
  const requestID = identity.requestID
  const lifecycleEventID = identity.lifecycleEventID
  if (messageID || requestID || lifecycleEventID) {
    const exists = Database.use((db) =>
      db
        .select({ id: EngineArtifactTable.id })
        .from(EngineArtifactTable)
        .where(
          and(
            eq(EngineArtifactTable.task_id, taskID),
            eq(EngineArtifactTable.kind, "queued_operator_wake"),
            messageID
              ? sql`json_extract(${EngineArtifactTable.payload}, '$.message_id') = ${messageID}`
              : requestID
                ? sql`json_extract(${EngineArtifactTable.payload}, '$.request_id') = ${requestID}`
                : sql`json_extract(${EngineArtifactTable.payload}, '$.lifecycle_event_id') = ${lifecycleEventID}`,
          ),
        )
        .get(),
    )
    if (exists) return
  }
  const now = Date.now()
  const instance = Instance.current()
  const payload: QueuedOperatorWakePayload = {
    wake_id: messageID ?? requestID ?? lifecycleEventID ?? Identifier.ascending("artifact"),
    task_id: taskID,
    ...(messageID ? { message_id: messageID } : {}),
    ...(requestID ? { request_id: requestID } : {}),
    ...(lifecycleEventID ? { lifecycle_event_id: lifecycleEventID } : {}),
    source_kind: messageID
      ? "operator_message"
      : requestID
        ? "coordination_request"
        : lifecycleEventID
          ? "task_lifecycle"
          : event.operatorIntent
            ? "operator_intent"
            : "orchestrator_event",
    event,
    time_queued: now,
    queued_by_process_id: process.pid,
    ...(instance
      ? { queued_by_instance_directory: instance.directory, queued_by_project_id: instance.project.id }
      : {}),
  }
  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id: Identifier.ascending("artifact"),
        task_id: taskID,
        run_id: null,
        goal_run_id: null,
        acceptance_id: null,
        kind: "queued_operator_wake",
        label: "pending",
        payload,
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}

function discardPendingQueuedOperatorWakes(taskID: string): void {
  const now = Date.now()
  Database.use((db) =>
    db
      .update(EngineArtifactTable)
      .set({ label: "discarded", time_updated: now })
      .where(
        and(
          eq(EngineArtifactTable.task_id, taskID),
          eq(EngineArtifactTable.kind, "queued_operator_wake"),
          eq(EngineArtifactTable.label, "pending"),
        ),
      )
      .run(),
  )
}

function takeQueuedTaskEvent(taskID: string): OrchestratorEvent | undefined {
  const durable = findNextPendingQueuedOperatorWake(taskID)
  if (!durable) return undefined
  markQueuedOperatorWakeDrained(durable.id)
  return durable.event
}

function peekQueuedTaskEvent(taskID: string): OrchestratorEvent | undefined {
  const durable = findNextPendingQueuedOperatorWake(taskID)
  return durable?.event
}

function findNextPendingQueuedOperatorWake(taskID: string):
  | {
      id: string
      timeCreated: number
      event: OrchestratorEvent
    }
  | undefined {
  const row = Database.use((db) =>
    db
      .select({
        id: EngineArtifactTable.id,
        payload: EngineArtifactTable.payload,
        timeCreated: EngineArtifactTable.time_created,
      })
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, taskID),
          eq(EngineArtifactTable.kind, "queued_operator_wake"),
          eq(EngineArtifactTable.label, "pending"),
        ),
      )
      .orderBy(EngineArtifactTable.time_created, EngineArtifactTable.id)
      .get(),
  )
  if (!row) return undefined
  const payload = row.payload as QueuedOperatorWakePayload
  return {
    id: row.id,
    timeCreated: row.timeCreated,
    event: payload.event,
  }
}

function markQueuedOperatorWakeDrained(artifactID: string): void {
  Database.use((db) =>
    db
      .update(EngineArtifactTable)
      .set({ label: "drained", time_updated: Date.now() })
      .where(eq(EngineArtifactTable.id, artifactID))
      .run(),
  )
}

function hasQueuedTaskEvent(taskID: string): boolean {
  return findNextPendingQueuedOperatorWake(taskID) !== undefined
}

function loopInFlightFor(taskID: string): boolean {
  return (loopInFlight.get(taskID) ?? 0) > 0
}

function isOperatorWakeEvent(event: OrchestratorEvent | undefined): boolean {
  return Boolean(event?.operatorIntent || event?.operatorMessage)
}

function suppressPassiveStreamErrorWake(taskID: string, event: OrchestratorEvent | undefined): boolean {
  if (isOperatorWakeEvent(event)) return false
  if (event?.lifecycleFact) return false
  const run = findActiveRunForTask(taskID)
  return run?.status === "blocked" && run.blocking_reason === "orchestrator_stream_error"
}

function retainLoop(taskID: string): void {
  loopInFlight.set(taskID, (loopInFlight.get(taskID) ?? 0) + 1)
}

function releaseLoop(taskID: string): void {
  const next = (loopInFlight.get(taskID) ?? 0) - 1
  if (next > 0) {
    loopInFlight.set(taskID, next)
  } else {
    loopInFlight.delete(taskID)
  }
}

type QueuedTask = {
  id: string
  priority: string
  queueOrder: number
  timeCreated: number
  timeUpdated: number
}

export class TaskQueueReorderError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "conflict" | "invalid_order",
  ) {
    super(message)
    this.name = "TaskQueueReorderError"
  }
}

function queueRevision(tasks: Array<Pick<QueuedTask, "id" | "queueOrder" | "timeUpdated">>) {
  return tasks.map((task) => `${task.id}:${task.queueOrder}:${task.timeUpdated}`).join("|")
}

function queuedTasksForCwd(cwd: string, input: { projectID?: string } = {}): QueuedTask[] {
  if (!cwd) return []
  return Database.use((db) => {
    const where = [
      sql`${EngineTaskTable.time_started} IS NULL`,
      sql`${EngineTaskTable.time_completed} IS NULL`,
      sql`COALESCE(${SessionTable.directory}, ${ProjectTable.worktree}) = ${cwd}`,
    ]
    if (input.projectID) where.push(eq(EngineTaskTable.project_id, input.projectID))
    return db
      .select({
        id: EngineTaskTable.id,
        priority: EngineTaskTable.priority,
        queueOrder: EngineTaskTable.queue_order,
        timeCreated: EngineTaskTable.time_created,
        timeUpdated: EngineTaskTable.time_updated,
      })
      .from(EngineTaskTable)
      .leftJoin(SessionTable, eq(SessionTable.id, EngineTaskTable.session_id))
      .leftJoin(ProjectTable, eq(ProjectTable.id, EngineTaskTable.project_id))
      .where(and(...where))
      .orderBy(
        sql`CASE ${EngineTaskTable.priority} WHEN 'critical' THEN 0 ELSE 1 END`,
        EngineTaskTable.queue_order,
        EngineTaskTable.time_created,
        EngineTaskTable.id,
      )
      .all()
  })
}

export function directoryQueueSnapshot(cwd: string) {
  const queued = queuedTasksForCwd(cwd)
  return {
    directory: cwd,
    revision: queueRevision(queued),
    queuedTaskIDs: queued.map((task) => task.id),
  }
}

export function reorderQueuedTasksForCwd(input: {
  cwd: string
  projectID: string
  orderedTaskIDs: string[]
  revision?: string
  now?: number
}) {
  const cwd = input.cwd.trim()
  if (!cwd) throw new TaskQueueReorderError("directory is required", "invalid_order")
  const orderedTaskIDs = [...input.orderedTaskIDs]
  if (orderedTaskIDs.length !== new Set(orderedTaskIDs).size) {
    throw new TaskQueueReorderError("orderedTaskIDs contains duplicate task IDs", "invalid_order")
  }

  const now = input.now ?? Date.now()
  return Database.transaction((db) => {
    const queued = queuedTasksForCwd(cwd, { projectID: input.projectID })
    const currentRevision = queueRevision(queued)
    if (input.revision !== undefined && input.revision !== currentRevision) {
      throw new TaskQueueReorderError("directory queue changed; reload before reordering", "conflict")
    }
    const currentIDs = queued.map((task) => task.id)
    const currentSet = new Set(currentIDs)
    if (orderedTaskIDs.length !== currentIDs.length || !orderedTaskIDs.every((id) => currentSet.has(id))) {
      throw new TaskQueueReorderError(
        "orderedTaskIDs must contain every queued task in the directory and no active/completed tasks",
        "invalid_order",
      )
    }

    for (const [index, taskID] of orderedTaskIDs.entries()) {
      db.update(EngineTaskTable)
        .set({ queue_order: index, time_updated: now })
        .where(eq(EngineTaskTable.id, taskID))
        .run()
    }
    const next = orderedTaskIDs.map((id, index) => ({ id, queueOrder: index, timeUpdated: now }))
    return {
      directory: cwd,
      revision: queueRevision(next),
      queuedTaskIDs: orderedTaskIDs,
    }
  })
}

async function launchTaskLoop(taskID: string, event: OrchestratorEvent | undefined): Promise<void> {
  const { runTaskLoop } = await import("@/orchestrator/loop")
  // Return the loop's own promise (absorbing errors). Callers that want to
  // observe actual loop exit (queue-advance hook) attach `.finally` to the
  // returned promise; callers that only want fire-and-forget ignore it.
  // Previously this was `void runTaskLoop(...).catch(...)` which discarded
  // the inner promise and resolved after mere scheduling — any `.finally`
  // attached by the caller fired before the loop had done anything, so the
  // queue-advance hook never fired on real task termination and sibling
  // queued tasks in the same cwd stayed stuck forever.
  return runTaskLoop({ taskID, event }).catch((err) => {
    const error = Database.normalizeError(err, "engine.queue.launchTaskLoop")
    log.error("task loop failed", {
      taskID,
      error: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : undefined,
    })
  })
}

/**
 * Bind the cwd queue-advance hook to an in-flight loop promise.
 *
 * Single authoritative bind point between per-invocation loop lifecycle
 * and serial-queue progression. All paths that start a loop (initial
 * claim, operator retrigger on already-active task) route through here so
 * the "loop exited → advance siblings" contract is written exactly once.
 *
 * Idempotent against overlapping invocations for the same task: the Set
 * add/delete and the claim SQL both treat repeated calls as no-ops.
 */
function attachLoopCompletion(taskID: string, cwd: string, loopPromise: Promise<void>): void {
  retainLoop(taskID)
  void loopPromise
    .finally(() => {
      releaseLoop(taskID)
      // Detach via queueMicrotask so `advanceQueue` → `startLoopForTask` →
      // `.finally` re-entry doesn't stack synchronously.
      queueMicrotask(() => {
        void (async () => {
          if (await drainQueuedTaskEventIfUnowned(taskID)) return
          await advanceQueue(cwd)
        })().catch((err) => {
          const error = Database.normalizeError(err, "engine.queue.advanceQueue.afterLoop")
          log.error("advanceQueue failed after loop exit", {
            cwd,
            error: error instanceof Error ? error.message : String(error),
            errorName: error instanceof Error ? error.name : undefined,
          })
        })
      })
    })
    .catch((err) => {
      const error = Database.normalizeError(err, "engine.queue.loopCompletion")
      log.error("task loop completion hook observed failure", {
        taskID,
        cwd,
        error: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : undefined,
      })
    })
}

export async function drainQueuedTaskEventIfUnowned(taskID: string): Promise<boolean> {
  if (!hasQueuedTaskEvent(taskID)) return false

  const task = findTask(taskID)
  if (!task) {
    discardQueuedTaskEvent(taskID)
    log.warn("discarding queued wake for missing task", { taskID })
    return false
  }

  const cwd = taskCwd(task.id)
  if (!cwd) {
    discardQueuedTaskEvent(taskID)
    log.warn("discarding queued wake for task without cwd", { taskID })
    return false
  }

  const liveOwners = listLiveOrchestratorToolOwnership(taskID)
  if (liveOwners.length > 0) return false

  if (isTaskTerminal(task)) {
    const queuedEvent = peekQueuedTaskEvent(taskID)
    if (!queuedEvent) return false
    if (!isOperatorWakeEvent(queuedEvent)) {
      takeQueuedTaskEvent(taskID)
      log.info("discarded queued passive wake for terminal task", { taskID, status: deriveTaskStatus(task) })
      return hasQueuedTaskEvent(taskID) ? drainQueuedTaskEventIfUnowned(taskID) : false
    }
    await openTaskForOperatorWake(task, "Queued operator wake reopened terminal task")
    await advanceQueue(cwd)
    return !hasQueuedTaskEvent(taskID)
  }

  if (isTaskQueued(task)) {
    await advanceQueue(cwd)
    return !hasQueuedTaskEvent(taskID)
  }

  const queuedEvent = takeQueuedTaskEvent(taskID)
  if (!queuedEvent) return false
  if (suppressPassiveStreamErrorWake(taskID, queuedEvent)) {
    log.info("discarded queued passive wake for stream-error blocked run", { taskID })
    return hasQueuedTaskEvent(taskID) ? drainQueuedTaskEventIfUnowned(taskID) : false
  }
  attachLoopCompletion(taskID, cwd, launchTaskLoop(taskID, queuedEvent))
  log.info("drained queued wake after orchestrator tool ownership cleared", { taskID })
  return true
}

export async function drainPendingQueuedOperatorWakes(): Promise<number> {
  const taskIDs = [...new Set(pendingQueuedOperatorWakeTaskIDs())]
  let drained = 0
  for (const taskID of taskIDs) {
    if (await drainQueuedTaskEventIfUnowned(taskID)) drained += 1
  }
  return drained
}

/**
 * Resolve the working directory for a task.
 *
 * Source of truth: task.session_id → session.directory. If the task has no
 * session or the session was deleted, fall back to project.worktree.
 * Empty string means unknown — such tasks cannot be queued.
 */
export function taskCwd(taskID: string): string {
  const row = Database.use((db) =>
    db
      .select({
        sessionDir: SessionTable.directory,
        projectDir: ProjectTable.worktree,
      })
      .from(EngineTaskTable)
      .leftJoin(SessionTable, eq(SessionTable.id, EngineTaskTable.session_id))
      .leftJoin(ProjectTable, eq(ProjectTable.id, EngineTaskTable.project_id))
      .where(eq(EngineTaskTable.id, taskID))
      .get(),
  )
  if (!row) return ""
  return row.sessionDir ?? row.projectDir ?? ""
}

/**
 * Atomically claim the next queued task for the given cwd.
 *
 * Semantics:
 *   - If another task is already `active` in this cwd → return undefined.
 *   - Otherwise → pick the highest-priority queued task (FIFO within priority),
 *     flip its status `queued → active`, and return the updated row.
 *
 * Atomicity is provided by SQLite's statement-level write serialization:
 * the subquery + UPDATE run as a single statement, so two concurrent calls
 * cannot both observe the same "no active task" state.
 *
 * Returns undefined when nothing was claimed (active task present, or no
 * queued tasks).
 */
export function claimNextForCwd(cwd: string, now = Date.now()): TaskRow | undefined {
  if (!cwd) return undefined
  // Phase-6-f-2: no status column. Queued = time_started IS NULL (never
  // picked up). Active = time_started IS NOT NULL AND time_completed IS NULL.
  // Terminal = time_completed IS NOT NULL.
  let result: TaskRow | undefined
  Database.transaction((db) => {
    result = db
      .update(EngineTaskTable)
      .set({
        time_started: now,
        time_updated: now,
      })
      .where(
        sql`${EngineTaskTable.id} = (
          SELECT t.id
          FROM engine_task t
          LEFT JOIN session s ON s.id = t.session_id
          LEFT JOIN project p ON p.id = t.project_id
          WHERE t.time_started IS NULL AND t.time_completed IS NULL
            AND COALESCE(s.directory, p.worktree) = ${cwd}
            AND NOT EXISTS (
              SELECT 1
              FROM engine_task t2
              LEFT JOIN session s2 ON s2.id = t2.session_id
              LEFT JOIN project p2 ON p2.id = t2.project_id
              WHERE t2.time_started IS NOT NULL AND t2.time_completed IS NULL
                AND COALESCE(json_extract(t2.metadata, '$.interrupted'), 0) != 1
                AND COALESCE(s2.directory, p2.worktree) = ${cwd}
            )
          ORDER BY
            CASE t.priority WHEN 'critical' THEN 0 ELSE 1 END,
            t.queue_order,
            t.time_created,
            t.id
          LIMIT 1
        )`,
      )
      .returning()
      .get()
    if (!result) return
    db.insert(EngineProgressSnapshotTable)
      .values({
        id: Identifier.ascending("progress"),
        task_id: result.id,
        status: "active",
        summary: "Task started",
        payload: { status: "active" },
        time_created: now,
        time_updated: now,
      })
      .run()
    Database.effect(() =>
      EngineProtocol.emit(
        Event.TaskUpdated,
        { taskID: result!.id, status: "active", summary: "Task started" },
        { source: "engine.queue" },
      ),
    )
  })
  return result ?? undefined
}

export function claimQueuedTaskForCwd(taskID: string, cwd: string, now = Date.now()): TaskRow | undefined {
  if (!taskID || !cwd) return undefined
  let result: TaskRow | undefined
  Database.transaction((db) => {
    result = db
      .update(EngineTaskTable)
      .set({
        time_started: now,
        time_updated: now,
      })
      .where(
        sql`${EngineTaskTable.id} = (
          SELECT t.id
          FROM engine_task t
          LEFT JOIN session s ON s.id = t.session_id
          LEFT JOIN project p ON p.id = t.project_id
          WHERE t.id = ${taskID}
            AND t.time_started IS NULL AND t.time_completed IS NULL
            AND COALESCE(s.directory, p.worktree) = ${cwd}
            AND NOT EXISTS (
              SELECT 1
              FROM engine_task t2
              LEFT JOIN session s2 ON s2.id = t2.session_id
              LEFT JOIN project p2 ON p2.id = t2.project_id
              WHERE t2.time_started IS NOT NULL AND t2.time_completed IS NULL
                AND COALESCE(json_extract(t2.metadata, '$.interrupted'), 0) != 1
                AND COALESCE(s2.directory, p2.worktree) = ${cwd}
            )
          LIMIT 1
        )`,
      )
      .returning()
      .get()
    if (!result) return
    db.insert(EngineProgressSnapshotTable)
      .values({
        id: Identifier.ascending("progress"),
        task_id: result.id,
        status: "active",
        summary: "Task started",
        payload: { status: "active" },
        time_created: now,
        time_updated: now,
      })
      .run()
    Database.effect(() =>
      EngineProtocol.emit(
        Event.TaskUpdated,
        { taskID: result!.id, status: "active", summary: "Task started" },
        { source: "engine.queue" },
      ),
    )
  })
  return result ?? undefined
}

export async function startQueuedTaskInCwd(taskID: string, cwd: string): Promise<TaskRow | undefined> {
  const claimed = claimQueuedTaskForCwd(taskID, cwd)
  if (!claimed) return undefined
  await startLoopForTask(claimed, undefined, cwd)
  return claimed
}

/**
 * List active tasks for a cwd.
 */
export function listActiveForCwd(cwd: string): TaskRow[] {
  if (!cwd) return []
  return Database.use((db) =>
    db
      .select({ task: EngineTaskTable })
      .from(EngineTaskTable)
      .leftJoin(SessionTable, eq(SessionTable.id, EngineTaskTable.session_id))
      .leftJoin(ProjectTable, eq(ProjectTable.id, EngineTaskTable.project_id))
      .where(
        and(
          sql`${EngineTaskTable.time_started} IS NOT NULL`,
          sql`${EngineTaskTable.time_completed} IS NULL`,
          sql`COALESCE(${SessionTable.directory}, ${ProjectTable.worktree}) = ${cwd}`,
        ),
      )
      .orderBy(desc(EngineTaskTable.time_updated))
      .all(),
  ).map((r) => r.task)
}

/**
 * List distinct cwds that have any queued tasks for the given project.
 */
export function listQueuedCwdsInProject(projectID: string): string[] {
  const rows = Database.use((db) =>
    db
      .select({
        cwd: sql<string>`COALESCE(${SessionTable.directory}, ${ProjectTable.worktree})`.as("cwd"),
      })
      .from(EngineTaskTable)
      .leftJoin(SessionTable, eq(SessionTable.id, EngineTaskTable.session_id))
      .leftJoin(ProjectTable, eq(ProjectTable.id, EngineTaskTable.project_id))
      .where(
        and(
          eq(EngineTaskTable.project_id, projectID),
          sql`${EngineTaskTable.time_started} IS NULL`,
          sql`${EngineTaskTable.time_completed} IS NULL`,
        ),
      )
      .all(),
  )
  return [...new Set(rows.map((r) => r.cwd).filter((x): x is string => !!x))]
}

/**
 * List active tasks in a project that have no in-flight loop.
 */
export function listOrphanedActiveInProject(projectID: string): TaskRow[] {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineTaskTable)
      .where(
        and(
          eq(EngineTaskTable.project_id, projectID),
          sql`${EngineTaskTable.time_started} IS NOT NULL`,
          sql`${EngineTaskTable.time_completed} IS NULL`,
        ),
      )
      .all(),
  )
  return rows.filter((row) => !loopInFlightFor(row.id))
}

/**
 * Advance the queue for a cwd: if the cwd is idle, claim the next queued
 * task and start its loop. Called from every dispatch site (createTask,
 * retryTask, operator message, loop exit).
 *
 * Idempotent: calling advanceQueue multiple times for the same cwd is safe.
 * The atomic claim ensures only one call will actually start a loop.
 */
export async function advanceQueue(
  cwd: string,
  options?: {
    beforeStart?: (input: { task: TaskRow; event?: OrchestratorEvent }) => void | Promise<void>
  },
): Promise<TaskRow | undefined> {
  if (!cwd) return undefined
  await convergeDeadOwnerActiveTasksForCwd(cwd)
  const claimed = claimNextForCwd(cwd)
  if (!claimed) return undefined
  const queuedWake = findNextPendingQueuedOperatorWake(claimed.id)
  const event = queuedWake?.event
  await options?.beforeStart?.({ task: claimed, event })
  const started = await startLoopForTask(claimed, event, cwd)
  if (started && queuedWake) markQueuedOperatorWakeDrained(queuedWake.id)
  return claimed
}

async function convergeDeadOwnerActiveTasksForCwd(cwd: string): Promise<void> {
  const activeTasks = listActiveForCwd(cwd)
  if (activeTasks.length === 0) return
  const { abortDeadOwnerLiveExecutionForTasks } = await import("./writer")
  const converged = await abortDeadOwnerLiveExecutionForTasks({
    tasks: activeTasks,
    reason: DEAD_OWNER_QUEUE_CONVERGENCE_REASON,
  })
  if (converged.tasks === 0 && converged.goalRuns === 0 && converged.runs === 0) return
  log.info("advanceQueue converged dead-owner active tasks", {
    cwd,
    tasks: converged.tasks,
    runs: converged.runs,
    goalRuns: converged.goalRuns,
    sessions: converged.sessions,
    toolParts: converged.toolParts,
    corruptTasks: converged.corruptTasks,
  })
}

export type DispatchTaskLoopResult = "started" | "queued" | "ignored"
export type DispatchTaskLoopAcceptedWake = {
  taskID: string
  result: Exclude<DispatchTaskLoopResult, "ignored">
}

export type DispatchTaskLoopInput = {
  taskID: string
  event?: OrchestratorEvent
  beforeAcceptedWake?: (wake: DispatchTaskLoopAcceptedWake) => void | Promise<void>
}

export function dispatchTaskLoopInBackground(input: DispatchTaskLoopInput, operation: string): void {
  void dispatchTaskLoop(input).catch((err) => {
    const error = Database.normalizeError(err, operation)
    log.error("background task wake failed", {
      taskID: input.taskID,
      operation,
      error: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : undefined,
    })
  })
}

export async function dispatchTaskLoop(input: DispatchTaskLoopInput): Promise<DispatchTaskLoopResult> {
  let task = findTask(input.taskID)
  if (!task) return "ignored"
  if (isTaskTerminal(task)) {
    if (isOperatorWakeEvent(input.event)) {
      task = await openTaskForOperatorWake(task, "Operator wake reopened terminal task")
    } else {
      log.info("dispatchTaskLoop: ignoring terminal task wake", {
        taskID: task.id,
        status: deriveTaskStatus(task),
        note: input.event?.note,
      })
      return "ignored"
    }
  }
  const cwd = taskCwd(task.id)
  if (!cwd) {
    log.warn("dispatchTaskLoop: task has no cwd", { taskID: task.id, note: input.event?.note })
    return "ignored"
  }
  if (suppressPassiveStreamErrorWake(task.id, input.event)) {
    log.info("dispatchTaskLoop: ignoring passive wake for stream-error blocked run", { taskID: task.id })
    return "ignored"
  }
  if (isTaskQueued(task)) {
    if (input.event) enqueueTaskEvent(task.id, input.event)
    const claimed = await advanceQueue(cwd, {
      beforeStart: async ({ task: claimedTask }) => {
        if (claimedTask.id === task.id) {
          await consumePendingWaitCronForAcceptedWake(task, "task wake accepted as started")
          await input.beforeAcceptedWake?.({ taskID: task.id, result: "started" })
        }
      },
    })
    if (claimed?.id === task.id) return "started"
    await consumePendingWaitCronForAcceptedWake(task, "task wake accepted as queued")
    await input.beforeAcceptedWake?.({ taskID: task.id, result: "queued" })
    return "queued"
  }

  const liveOwners = listLiveOrchestratorToolOwnership(task.id)
  if (liveOwners.length > 0) {
    if (input.event) enqueueTaskEvent(task.id, input.event)
    log.info("dispatchTaskLoop: queued wake behind live orchestrator tool ownership", {
      taskID: task.id,
      liveOwners: liveOwners.map((owner) => owner.ownershipID),
    })
    await consumePendingWaitCronForAcceptedWake(task, "task wake accepted behind live orchestrator tool ownership")
    await input.beforeAcceptedWake?.({ taskID: task.id, result: "queued" })
    return "queued"
  }

  // Task is already active — inject a new wake event into the existing loop
  // chain (loop.ts serialises multi-entry calls per taskID). The new
  // invocation might be the one that drives the task to terminal, so its
  // completion must also advance the cwd queue. Fire-and-forget: callers
  // don't want to block on task completion.
  await consumePendingWaitCronForAcceptedWake(task, "task wake accepted as active re-entry")
  await input.beforeAcceptedWake?.({ taskID: task.id, result: "started" })
  attachLoopCompletion(task.id, cwd, launchTaskLoop(task.id, input.event))
  return "started"
}

async function consumePendingWaitCronForAcceptedWake(task: TaskRow, reason: string): Promise<void> {
  const { CronService } = await import("@/scheduler/cron-service")
  CronService.consumePendingTaskWaits({
    taskId: task.id,
    projectId: task.project_id,
    reason,
  })
}

/**
 * Internal: actually start the loop for a claimed or operator-dispatched task.
 * Serial dispatch is guaranteed by the DB claim SQL, not by blocking the
 * caller; advance-on-exit is wired via `attachLoopCompletion`.
 *
 * Dynamic import of task-loop avoids a circular dependency
 * (task-loop → queue → task-loop).
 */
async function startLoopForTask(task: TaskRow, event: OrchestratorEvent | undefined, cwd: string): Promise<boolean> {
  if (loopInFlightFor(task.id)) {
    log.info("loop already in flight, skipping", { taskID: task.id })
    return false
  }
  attachLoopCompletion(task.id, cwd, launchTaskLoop(task.id, event))
  return true
}
