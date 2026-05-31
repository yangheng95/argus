/**
 * Task serialization queue — single source of truth for queue=true task
 * admission in a working directory.
 *
 * Lock key: the task's working directory (cwd), resolved from
 *   session.directory → project.worktree.
 *
 * queue=true tasks in the same cwd are serialized. queue=false creation
 * persists an active task before this module runs, so it intentionally bypasses
 * this directory queue and may run beside active same-cwd tasks.
 *
 * All queued scheduling requests must go through this module so queued-task
 * claiming and active-task re-entry share one coordinator.
 */

import { ProjectTable } from "@/project/project.sql"
import { SessionTable } from "@/session/session.sql"
import { Database, and, desc, eq, sql } from "@/storage/db"
import { Log } from "@/util/log"
import { EngineProgressSnapshotTable, EngineTaskTable } from "./engine.sql"
import { findTask, type TaskRow } from "./store"
import { openTaskForOperatorMessage } from "./task-message-open"
import { deriveTaskStatus, isTaskActive, isTaskQueued, isTaskTerminal } from "./task-status"
import type { OrchestratorEvent } from "@/orchestrator/agent"
import { Identifier } from "@/id/id"
import { Event } from "./model"
import { EngineProtocol } from "./protocol"
import { listLiveOrchestratorToolOwnership } from "./tool-ownership"

const log = Log.create({ service: "engine.queue" })

// Process-local loop accounting. The real queue lock is in the DB
// (claimNextForCwd), but interrupt-driven replacement can briefly overlap an
// old loop that is unwinding with the new wake that supersedes it.
const loopInFlight = new Map<string, number>()
const queuedTaskEvents = new Map<string, OrchestratorEvent>()

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
  constructor(message: string, readonly code: "not_found" | "conflict" | "invalid_order") {
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
      throw new TaskQueueReorderError("orderedTaskIDs must contain every queued task in the directory and no active/completed tasks", "invalid_order")
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

async function launchTaskLoop(taskID: string, event: OrchestratorEvent | undefined, interrupt = false): Promise<void> {
  const [{ runTaskLoop, interruptTaskLoop }, { hooks }] = await Promise.all([
    import("@/orchestrator/loop"),
    import("@/engine/state"),
  ])
  if (interrupt) interruptTaskLoop(taskID, "task loop dispatch interrupt")
  // Return the loop's own promise (absorbing errors). Callers that want to
  // observe actual loop exit (queue-advance hook) attach `.finally` to the
  // returned promise; callers that only want fire-and-forget ignore it.
  // Previously this was `void runTaskLoop(...).catch(...)` which discarded
  // the inner promise and resolved after mere scheduling — any `.finally`
  // attached by the caller fired before the loop had done anything, so the
  // queue-advance hook never fired on real task termination and sibling
  // queued tasks in the same cwd stayed stuck forever.
  return runTaskLoop({ taskID, event, hooks: hooks() })
    .catch((err) => {
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
      const queuedEvent = queuedTaskEvents.get(taskID)
      const task = findTask(taskID)
      if (queuedEvent && task && isTaskTerminal(task)) {
        queuedTaskEvents.delete(taskID)
      }
      if (queuedEvent && task && !isTaskTerminal(task) && listLiveOrchestratorToolOwnership(taskID).length === 0) {
        queuedTaskEvents.delete(taskID)
        attachLoopCompletion(taskID, cwd, launchTaskLoop(taskID, queuedEvent))
        return
      }
      advanceQueue(cwd).catch((err) => {
        log.error("advanceQueue failed after loop exit", { cwd, error: err instanceof Error ? err.message : String(err) })
      })
    })
  })
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
  const claimed = claimNextForCwd(cwd)
  if (!claimed) return
  const event = queuedTaskEvents.get(claimed.id)
  queuedTaskEvents.delete(claimed.id)
  await startLoopForTask(claimed, event, cwd)
}

export async function dispatchTaskLoop(input: {
  taskID: string
  event?: OrchestratorEvent
  interrupt?: boolean
}): Promise<void> {
  let task = findTask(input.taskID)
  if (!task) return
  const cwd = taskCwd(task.id)
  if (!cwd) {
    log.warn("dispatchTaskLoop: task has no cwd", { taskID: task.id, note: input.event?.note })
    return
  }
  const operatorWake = Boolean(input.event?.operatorMessage)
  if (operatorWake) {
    task = await openTaskForOperatorMessage(task)
  }

  if (isTaskTerminal(task)) {
    log.info("dispatchTaskLoop: terminal task ignored", {
      taskID: task.id,
      status: deriveTaskStatus(task),
      note: input.event?.note,
    })
    return
  }

  if (isTaskQueued(task)) {
    if (input.event) queuedTaskEvents.set(task.id, input.event)
    await advanceQueue(cwd)
    return
  }

  const liveOwners = listLiveOrchestratorToolOwnership(task.id)
  if (liveOwners.length > 0 && loopInFlightFor(task.id)) {
    if (input.interrupt === true) {
      log.info("dispatchTaskLoop: interrupting live orchestrator tool ownership for operator wake", {
        taskID: task.id,
        liveOwners: liveOwners.map((owner) => owner.ownershipID),
      })
      attachLoopCompletion(task.id, cwd, launchTaskLoop(task.id, input.event, true))
      return
    }
    if (input.event) queuedTaskEvents.set(task.id, input.event)
    log.info("dispatchTaskLoop: queued wake behind live orchestrator tool ownership", {
      taskID: task.id,
      liveOwners: liveOwners.map((owner) => owner.ownershipID),
      interrupt: Boolean(input.interrupt),
    })
    return
  }

  // Task is already active — inject a new wake event into the existing loop
  // chain (loop.ts serialises multi-entry calls per taskID). The new
  // invocation might be the one that drives the task to terminal, so its
  // completion must also advance the cwd queue. Fire-and-forget: callers
  // don't want to block on task completion.
  attachLoopCompletion(task.id, cwd, launchTaskLoop(task.id, input.event, input.interrupt === true))
}

/**
 * Internal: actually start the loop for a claimed or operator-dispatched task.
 * Serial dispatch is guaranteed by the DB claim SQL, not by blocking the
 * caller; advance-on-exit is wired via `attachLoopCompletion`.
 *
 * Dynamic import of task-loop avoids a circular dependency
 * (task-loop → queue → task-loop).
 */
async function startLoopForTask(
  task: TaskRow,
  event: OrchestratorEvent | undefined,
  cwd: string,
): Promise<void> {
  if (loopInFlightFor(task.id)) {
    log.info("loop already in flight, skipping", { taskID: task.id })
    return
  }
  attachLoopCompletion(task.id, cwd, launchTaskLoop(task.id, event))
}
