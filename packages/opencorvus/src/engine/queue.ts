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
import { findTask, type TaskRow } from "./store"
import { isTaskActive, isTaskQueued } from "./task-status"
import type { OrchestratorEvent } from "@/orchestrator/agent"
import { Identifier } from "@/id/id"
import { Event } from "./model"
import { EngineProtocol } from "./protocol"
import { listLiveOrchestratorToolOwnership } from "./tool-ownership"

const log = Log.create({ service: "engine.queue" })
const DEAD_OWNER_QUEUE_CONVERGENCE_REASON = "Directory queue: previous owner process died before terminalization"

// Process-local loop accounting. The real queue lock is in the DB
// (claimNextForCwd), but interrupt-driven replacement can briefly overlap an
// old loop that is unwinding with the new wake that supersedes it.
const loopInFlight = new Map<string, number>()
type QueuedVolatileTaskEvent = {
  event: OrchestratorEvent
  timeQueued: number
  sequence: number
}

type QueuedOperatorWakePayload = {
  message_id: string
  event: OrchestratorEvent
  time_queued: number
}

const queuedTaskEvents = new Map<string, QueuedVolatileTaskEvent[]>()
let queuedTaskEventSequence = 0

export function discardQueuedTaskEvent(taskID: string): void {
  queuedTaskEvents.delete(taskID)
  discardPendingQueuedOperatorWakes(taskID)
}

export function queuedTaskEventStats() {
  for (const [taskID, events] of queuedTaskEvents) {
    if (events.length === 0 || !findTask(taskID)) queuedTaskEvents.delete(taskID)
  }
  const volatileTasks = [...queuedTaskEvents.values()].filter((events) => events.length > 0)
  const durableRows = pendingQueuedOperatorWakeTaskIDs()
  const taskIDs = new Set<string>(durableRows)
  for (const [taskID, events] of queuedTaskEvents) {
    if (events.length > 0) taskIDs.add(taskID)
  }
  return {
    tasks: taskIDs.size,
    events: volatileTasks.reduce((sum, events) => sum + events.length, 0) + durableRows.length,
  }
}

function pendingQueuedOperatorWakeTaskIDs(): string[] {
  return Database.use((db) =>
    db
      .select({ taskID: EngineArtifactTable.task_id })
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.kind, "queued_operator_wake"),
          eq(EngineArtifactTable.label, "pending"),
        ),
      )
      .all()
      .map((row) => row.taskID),
  )
}

function enqueueTaskEvent(taskID: string, event: OrchestratorEvent): void {
  const messageID = event.operatorMessage?.messageID?.trim()
  if (messageID) {
    persistQueuedOperatorWake(taskID, event, messageID)
    return
  }
  const events = queuedTaskEvents.get(taskID) ?? []
  events.push({
    event,
    timeQueued: Date.now(),
    sequence: (queuedTaskEventSequence += 1),
  })
  queuedTaskEvents.set(taskID, events)
}

function persistQueuedOperatorWake(taskID: string, event: OrchestratorEvent, messageID: string): void {
  const exists = Database.use((db) =>
    db
      .select({ id: EngineArtifactTable.id })
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, taskID),
          eq(EngineArtifactTable.kind, "queued_operator_wake"),
          sql`json_extract(${EngineArtifactTable.payload}, '$.message_id') = ${messageID}`,
        ),
      )
      .get(),
  )
  if (exists) return
  const now = Date.now()
  const payload: QueuedOperatorWakePayload = {
    message_id: messageID,
    event,
    time_queued: now,
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
  const volatile = queuedTaskEvents.get(taskID)?.[0]
  const durable = findNextPendingQueuedOperatorWake(taskID)
  if (durable && (!volatile || durable.timeCreated < volatile.timeQueued)) {
    markQueuedOperatorWakeDrained(durable.id)
    return durable.event
  }
  if (!volatile) return undefined
  const events = queuedTaskEvents.get(taskID) ?? []
  const [next, ...rest] = events
  if (rest.length > 0) {
    queuedTaskEvents.set(taskID, rest)
  } else {
    queuedTaskEvents.delete(taskID)
  }
  return next?.event
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
  if ((queuedTaskEvents.get(taskID)?.length ?? 0) > 0) return true
  return findNextPendingQueuedOperatorWake(taskID) !== undefined
}

function loopInFlightFor(taskID: string): boolean {
  return (loopInFlight.get(taskID) ?? 0) > 0
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

function queuedTasksForCwd(cwd: string): QueuedTask[] {
  if (!cwd) return []
  return Database.use((db) =>
    db
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
      .where(
        and(
          sql`${EngineTaskTable.time_started} IS NULL`,
          sql`${EngineTaskTable.time_completed} IS NULL`,
          sql`COALESCE(${SessionTable.directory}, ${ProjectTable.worktree}) = ${cwd}`,
        ),
      )
      .orderBy(
        sql`CASE ${EngineTaskTable.priority} WHEN 'critical' THEN 0 ELSE 1 END`,
        EngineTaskTable.queue_order,
        EngineTaskTable.time_created,
        EngineTaskTable.id,
      )
      .all(),
  )
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
    const queued = queuedTasksForCwd(cwd)
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
    log.error("task loop failed", { taskID, error: err instanceof Error ? err.message : String(err) })
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
  loopPromise.finally(() => {
    releaseLoop(taskID)
    // Detach via queueMicrotask so `advanceQueue` → `startLoopForTask` →
    // `.finally` re-entry doesn't stack synchronously.
    queueMicrotask(() => {
      if (drainQueuedTaskEventIfUnowned(taskID)) return
      advanceQueue(cwd).catch((err) => {
        log.error("advanceQueue failed after loop exit", {
          cwd,
          error: err instanceof Error ? err.message : String(err),
        })
      })
    })
  })
}

export function drainQueuedTaskEventIfUnowned(taskID: string): boolean {
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

  const queuedEvent = takeQueuedTaskEvent(taskID)
  if (!queuedEvent) return false
  attachLoopCompletion(taskID, cwd, launchTaskLoop(taskID, queuedEvent))
  log.info("drained queued wake after orchestrator tool ownership cleared", { taskID })
  return true
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
export async function advanceQueue(cwd: string): Promise<void> {
  if (!cwd) return
  await convergeDeadOwnerActiveTasksForCwd(cwd)
  const claimed = claimNextForCwd(cwd)
  if (!claimed) return
  const event = takeQueuedTaskEvent(claimed.id)
  await startLoopForTask(claimed, event, cwd)
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

export async function dispatchTaskLoop(input: {
  taskID: string
  event?: OrchestratorEvent
}): Promise<DispatchTaskLoopResult> {
  let task = findTask(input.taskID)
  if (!task) return "ignored"
  const cwd = taskCwd(task.id)
  if (!cwd) {
    log.warn("dispatchTaskLoop: task has no cwd", { taskID: task.id, note: input.event?.note })
    return "ignored"
  }
  if (isTaskQueued(task)) {
    if (input.event) enqueueTaskEvent(task.id, input.event)
    await advanceQueue(cwd)
    return "started"
  }

  const liveOwners = listLiveOrchestratorToolOwnership(task.id)
  if (liveOwners.length > 0) {
    if (input.event) enqueueTaskEvent(task.id, input.event)
    log.info("dispatchTaskLoop: queued wake behind live orchestrator tool ownership", {
      taskID: task.id,
      liveOwners: liveOwners.map((owner) => owner.ownershipID),
    })
    return "queued"
  }

  // Task is already active — inject a new wake event into the existing loop
  // chain (loop.ts serialises multi-entry calls per taskID). The new
  // invocation might be the one that drives the task to terminal, so its
  // completion must also advance the cwd queue. Fire-and-forget: callers
  // don't want to block on task completion.
  attachLoopCompletion(task.id, cwd, launchTaskLoop(task.id, input.event))
  return "started"
}

/**
 * Internal: actually start the loop for a claimed or operator-dispatched task.
 * Serial dispatch is guaranteed by the DB claim SQL, not by blocking the
 * caller; advance-on-exit is wired via `attachLoopCompletion`.
 *
 * Dynamic import of task-loop avoids a circular dependency
 * (task-loop → queue → task-loop).
 */
async function startLoopForTask(task: TaskRow, event: OrchestratorEvent | undefined, cwd: string): Promise<void> {
  if (loopInFlightFor(task.id)) {
    log.info("loop already in flight, skipping", { taskID: task.id })
    return
  }
  attachLoopCompletion(task.id, cwd, launchTaskLoop(task.id, event))
}
