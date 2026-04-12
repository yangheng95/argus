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
 * This module replaces the old TOCTOU pattern (hasActiveTaskInProject +
 * runTaskLoop fire-and-forget) with a single atomic claim query. Every
 * dispatch site must go through `advanceQueue(cwd)`.
 */

import { ProjectTable } from "@/project/project.sql"
import { SessionTable } from "@/session/session.sql"
import { Database, and, desc, eq, sql } from "@/storage/db"
import { Log } from "@/util/log"
import { OrchestratorTaskTable } from "./orchestrator.sql"
import { findTask, type TaskRow } from "./store"

const log = Log.create({ service: "orchestrator.queue" })

// Process-local dedup — prevents two loops running for the same taskID
// in the same process. The real queue lock is in the DB (claimNextForCwd).
const loopInFlight = new Set<string>()

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
      .from(OrchestratorTaskTable)
      .leftJoin(SessionTable, eq(SessionTable.id, OrchestratorTaskTable.session_id))
      .leftJoin(ProjectTable, eq(ProjectTable.id, OrchestratorTaskTable.project_id))
      .where(eq(OrchestratorTaskTable.id, taskID))
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
      .update(OrchestratorTaskTable)
      .set({
        status: "active",
        time_started: sql`COALESCE(${OrchestratorTaskTable.time_started}, ${now})`,
        time_updated: now,
        time_status_changed: now,
      })
      .where(
        sql`${OrchestratorTaskTable.id} = (
          SELECT t.id
          FROM orchestrator_task t
          LEFT JOIN session s ON s.id = t.session_id
          LEFT JOIN project p ON p.id = t.project_id
          WHERE t.status = 'queued'
            AND COALESCE(s.directory, p.worktree) = ${cwd}
            AND NOT EXISTS (
              SELECT 1
              FROM orchestrator_task t2
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
      .select({ task: OrchestratorTaskTable })
      .from(OrchestratorTaskTable)
      .leftJoin(SessionTable, eq(SessionTable.id, OrchestratorTaskTable.session_id))
      .leftJoin(ProjectTable, eq(ProjectTable.id, OrchestratorTaskTable.project_id))
      .where(
        and(
          eq(OrchestratorTaskTable.status, "active"),
          sql`COALESCE(${SessionTable.directory}, ${ProjectTable.worktree}) = ${cwd}`,
        ),
      )
      .orderBy(desc(OrchestratorTaskTable.time_status_changed))
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
      .from(OrchestratorTaskTable)
      .leftJoin(SessionTable, eq(SessionTable.id, OrchestratorTaskTable.session_id))
      .leftJoin(ProjectTable, eq(ProjectTable.id, OrchestratorTaskTable.project_id))
      .where(
        and(
          eq(OrchestratorTaskTable.project_id, projectID),
          eq(OrchestratorTaskTable.status, "queued"),
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
      .from(OrchestratorTaskTable)
      .where(
        and(
          eq(OrchestratorTaskTable.project_id, projectID),
          eq(OrchestratorTaskTable.status, "active"),
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
  await startLoopForTask(claimed, { kind: "claimed" }, cwd)
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
  await startLoopForTask(task, { kind: "resume" }, cwd)
}

/**
 * Internal: actually start the loop for a claimed/resumed task.
 * Registers in-flight dedup, runs the loop, and re-triggers advanceQueue
 * on exit so the next queued task is picked up.
 *
 * Dynamic import of task-loop avoids a circular dependency
 * (task-loop → queue → task-loop).
 */
async function startLoopForTask(
  task: TaskRow,
  trigger: { kind: string; runID?: string; summary?: { passed: number; failed: number; total: number } },
  cwd: string,
): Promise<void> {
  if (loopInFlight.has(task.id)) {
    log.info("loop already in flight, skipping", { taskID: task.id })
    return
  }
  loopInFlight.add(task.id)
  const [{ runTaskLoop }, { hooks }] = await Promise.all([
    import("@/orchestrator/task-loop"),
    import("@/orchestrator/state"),
  ])
  // Fire the loop without awaiting — serial dispatch is guaranteed by the
  // claim SQL, not by blocking the caller. Callers that need completion
  // should await at the loop exit hook instead.
  void runTaskLoop({ taskID: task.id, trigger, hooks: hooks() })
    .catch((err) => {
      log.error("task loop failed", { taskID: task.id, error: err instanceof Error ? err.message : String(err) })
    })
    .finally(() => {
      loopInFlight.delete(task.id)
      // Loop has exited → the cwd may now be idle; advance the queue.
      // Detached to avoid unbounded recursion (advanceQueue → loop → finally → advanceQueue).
      queueMicrotask(() => {
        advanceQueue(cwd).catch((err) => {
          log.error("advanceQueue failed after loop exit", { cwd, error: err instanceof Error ? err.message : String(err) })
        })
      })
    })
}

/** Check if a task loop is currently running in this process. */
export function isLoopInFlight(taskID: string): boolean {
  return loopInFlight.has(taskID)
}
