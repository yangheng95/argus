/**
 * Task serialization queue — single source of truth for "which task is
 * active in a working directory".
 *
 * Lock key: the task's working directory (cwd), resolved from
 *   session.directory → project.worktree.
 *
 * Two tasks in the same cwd must never run concurrently (shared git state,
 * shared file system). Two tasks in different cwds are independent.
 *
 * All external scheduling requests must go through this module so queued-task
 * claiming and active-task re-entry share one coordinator.
 */

import { ProjectTable } from "@/project/project.sql"
import { SessionTable } from "@/session/session.sql"
import { Database, and, desc, eq, sql } from "@/storage/db"
import { Log } from "@/util/log"
import { EngineTaskTable } from "./engine.sql"
import { findTask, type TaskRow } from "./store"
import type { TaskLoopTrigger } from "@/orchestrator/loop"

const log = Log.create({ service: "engine.queue" })

// Process-local dedup — prevents two loops running for the same taskID
// in the same process. The real queue lock is in the DB (claimNextForCwd).
const loopInFlight = new Set<string>()
const queuedTaskTriggers = new Map<string, TaskLoopTrigger>()

function zeroSummary() {
  return { passed: 0, failed: 0, total: 0 }
}

function deriveQueuedTrigger(task: TaskRow): TaskLoopTrigger {
  if (task.active_run_id) {
    return { kind: "retry" }
  }

  return { kind: "created" }
}

function deriveResumeTrigger(task: TaskRow): TaskLoopTrigger {
  if (!task.active_run_id) {
    return { kind: "created" }
  }

  return {
    kind: "batch_complete",
    runID: task.active_run_id ?? "",
    summary: zeroSummary(),
  }
}

async function launchTaskLoop(taskID: string, trigger: TaskLoopTrigger, interrupt = false): Promise<void> {
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
  return runTaskLoop({ taskID, trigger, hooks: hooks() })
    .catch((err) => {
      log.error("task loop failed", { taskID, error: err instanceof Error ? err.message : String(err) })
    })
}

/**
 * Bind the cwd queue-advance hook to an in-flight loop promise.
 *
 * Single authoritative bind point between per-invocation loop lifecycle
 * and serial-queue progression. All paths that start a loop (initial
 * claim, resume, retrigger on already-active task) route through here so
 * the "loop exited → advance siblings" contract is written exactly once.
 *
 * Idempotent against overlapping invocations for the same task: the Set
 * add/delete and the claim SQL both treat repeated calls as no-ops.
 */
function attachLoopCompletion(taskID: string, cwd: string, loopPromise: Promise<void>): void {
  loopInFlight.add(taskID)
  loopPromise.finally(() => {
    loopInFlight.delete(taskID)
    // Detach via queueMicrotask so `advanceQueue` → `startLoopForTask` →
    // `.finally` re-entry doesn't stack synchronously.
    queueMicrotask(() => {
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
  const result = Database.use((db) =>
    db
      .update(EngineTaskTable)
      .set({
        status: "active",
        time_started: sql`COALESCE(${EngineTaskTable.time_started}, ${now})`,
        time_updated: now,
        time_status_changed: now,
      })
      .where(
        sql`${EngineTaskTable.id} = (
          SELECT t.id
          FROM engine_task t
          LEFT JOIN session s ON s.id = t.session_id
          LEFT JOIN project p ON p.id = t.project_id
          WHERE t.status = 'queued'
            AND COALESCE(s.directory, p.worktree) = ${cwd}
            AND NOT EXISTS (
              SELECT 1
              FROM engine_task t2
              LEFT JOIN session s2 ON s2.id = t2.session_id
              LEFT JOIN project p2 ON p2.id = t2.project_id
              WHERE t2.status = 'active'
                AND COALESCE(s2.directory, p2.worktree) = ${cwd}
            )
          ORDER BY
            CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
            t.time_created
          LIMIT 1
        )`,
      )
      .returning()
      .get(),
  )
  return result ?? undefined
}

/**
 * List active tasks for a cwd. Used by restart recovery.
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
          eq(EngineTaskTable.status, "active"),
          sql`COALESCE(${SessionTable.directory}, ${ProjectTable.worktree}) = ${cwd}`,
        ),
      )
      .orderBy(desc(EngineTaskTable.time_status_changed))
      .all(),
  ).map((r) => r.task)
}

/**
 * List distinct cwds that have any queued tasks for the given project.
 * Used by restart recovery to decide which cwds need an advanceQueue.
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
          eq(EngineTaskTable.status, "queued"),
        ),
      )
      .all(),
  )
  return [...new Set(rows.map((r) => r.cwd).filter((x): x is string => !!x))]
}

/**
 * List active tasks in a project that have no in-flight loop.
 * Used by restart recovery and the poll safety net.
 */
export function listOrphanedActiveInProject(projectID: string): TaskRow[] {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineTaskTable)
      .where(
        and(
          eq(EngineTaskTable.project_id, projectID),
          eq(EngineTaskTable.status, "active"),
        ),
      )
      .all(),
  )
  return rows.filter((row) => !loopInFlight.has(row.id))
}

/**
 * Advance the queue for a cwd: if the cwd is idle, claim the next queued
 * task and start its loop. Called from every dispatch site (createTask,
 * retryTask, restart recovery, loop exit).
 *
 * Idempotent: calling advanceQueue multiple times for the same cwd is safe.
 * The atomic claim ensures only one call will actually start a loop.
 */
export async function advanceQueue(cwd: string): Promise<void> {
  if (!cwd) return
  const claimed = claimNextForCwd(cwd)
  if (!claimed) return
  const trigger = queuedTaskTriggers.get(claimed.id) ?? deriveQueuedTrigger(claimed)
  queuedTaskTriggers.delete(claimed.id)
  await startLoopForTask(claimed, trigger, cwd)
}

export async function dispatchTaskLoop(input: {
  taskID: string
  trigger: TaskLoopTrigger
  interrupt?: boolean
}): Promise<void> {
  const task = findTask(input.taskID)
  if (!task) return
  const cwd = taskCwd(task.id)
  if (!cwd) {
    log.warn("dispatchTaskLoop: task has no cwd", { taskID: task.id, trigger: input.trigger.kind })
    return
  }

  if (task.status === "queued") {
    queuedTaskTriggers.set(task.id, input.trigger)
    await advanceQueue(cwd)
    return
  }

  // Task is already active — inject a new trigger into the existing loop
  // chain (loop.ts serialises multi-trigger entries per taskID). The new
  // invocation might be the one that drives the task to terminal, so its
  // completion must also advance the cwd queue. Fire-and-forget: callers
  // don't want to block on task completion.
  attachLoopCompletion(task.id, cwd, launchTaskLoop(task.id, input.trigger, input.interrupt === true))
}

/**
 * Resume a task whose status is already `active` but has no in-flight loop.
 * Used by restart recovery and the poll safety net.
 *
 * Does NOT go through claim (the task is already active). Caller must have
 * verified the task is not already tracked in loopInFlight.
 */
export async function resumeActiveTaskLoop(taskID: string): Promise<void> {
  if (loopInFlight.has(taskID)) return
  const task = findTask(taskID)
  if (!task) return
  if (task.status !== "active") return
  const cwd = taskCwd(taskID)
  if (!cwd) {
    log.warn("resumeActiveTaskLoop: task has no cwd", { taskID })
    return
  }
  await startLoopForTask(task, deriveResumeTrigger(task), cwd)
}

/**
 * Internal: actually start the loop for a claimed/resumed task.
 * Serial dispatch is guaranteed by the DB claim SQL, not by blocking the
 * caller; advance-on-exit is wired via `attachLoopCompletion`.
 *
 * Dynamic import of task-loop avoids a circular dependency
 * (task-loop → queue → task-loop).
 */
async function startLoopForTask(
  task: TaskRow,
  trigger: TaskLoopTrigger,
  cwd: string,
): Promise<void> {
  if (loopInFlight.has(task.id)) {
    log.info("loop already in flight, skipping", { taskID: task.id })
    return
  }
  attachLoopCompletion(task.id, cwd, launchTaskLoop(task.id, trigger))
}

/** Check if a task loop is currently running in this process. */
export function isLoopInFlight(taskID: string): boolean {
  return loopInFlight.has(taskID)
}
