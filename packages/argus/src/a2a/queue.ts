import { Database, eq, and, desc } from "@/storage/db"
import { A2ATaskQueueTable } from "./queue.sql"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import { Bus } from "@/bus"
import { A2AProtocol } from "./protocol"

/**
 * TaskQueue — Priority queue for A2A task management.
 *
 * Purely programmatic (not LLM-backed). Manages task lifecycle:
 * enqueue → dispatch → complete/fail.
 *
 * The Orchestrator polls this queue when idle to pick the next task.
 */
export namespace TaskQueue {
  const log = Log.create({ service: "a2a.queue" })

  // ── Types ──────────────────────────────────────────────────

  export type Priority = "critical" | "high" | "normal" | "low"
  export type Status = "queued" | "planning" | "executing" | "completed" | "failed" | "cancelled"
  export type Source = "slack" | "api" | "schedule" | "retry"

  const PRIORITY_ORDER: Record<Priority, number> = {
    critical: 0,
    high: 1,
    normal: 2,
    low: 3,
  }

  export interface QueuedTask {
    id: string
    sessionID: string
    prompt: string
    priority: Priority
    status: Status
    source: Source
    retryCount: number
    maxRetries: number
    previousSummary: string | null
    errorMessage: string | null
    metadata: Record<string, unknown>
    timeCreated: number
    timeUpdated: number
    timeStarted: number | null
    timeCompleted: number | null
  }

  // ── Row mapping ────────────────────────────────────────────

  function fromRow(row: typeof A2ATaskQueueTable.$inferSelect): QueuedTask {
    let metadata: Record<string, unknown> = {}
    try {
      metadata = JSON.parse(row.metadata || "{}")
    } catch {
      metadata = {}
    }
    return {
      id: row.id,
      sessionID: row.session_id,
      prompt: row.prompt,
      priority: row.priority as Priority,
      status: row.status as Status,
      source: row.source as Source,
      retryCount: row.retry_count,
      maxRetries: row.max_retries,
      previousSummary: row.previous_summary,
      errorMessage: row.error_message,
      metadata,
      timeCreated: row.time_created,
      timeUpdated: row.time_updated,
      timeStarted: row.time_started,
      timeCompleted: row.time_completed,
    }
  }

  // ── CRUD ───────────────────────────────────────────────────

  export function enqueue(input: {
    sessionID: string
    prompt: string
    priority?: Priority
    source?: Source
    maxRetries?: number
    previousSummary?: string
    metadata?: Record<string, unknown>
  }): QueuedTask {
    const id = Identifier.ascending("task")
    const priority = input.priority ?? "normal"
    const source = input.source ?? "api"

    Database.use((db) =>
      db
        .insert(A2ATaskQueueTable)
        .values({
          id,
          session_id: input.sessionID,
          prompt: input.prompt,
          priority,
          source,
          max_retries: input.maxRetries ?? 3,
          previous_summary: input.previousSummary ?? null,
          metadata: JSON.stringify(input.metadata ?? {}),
        })
        .run(),
    )

    const task = get(id)!
    log.info("task enqueued", { id, prompt: input.prompt.slice(0, 80), priority, source })

    Bus.publish(A2AProtocol.TaskEnqueued, {
      taskID: id,
      sessionID: input.sessionID,
      prompt: input.prompt,
      priority,
      source,
    })

    return task
  }

  export function get(taskID: string): QueuedTask | null {
    const row = Database.use((db) =>
      db.select().from(A2ATaskQueueTable).where(eq(A2ATaskQueueTable.id, taskID)).get(),
    )
    return row ? fromRow(row) : null
  }

  /**
   * Dequeue the highest-priority queued task for a session.
   * Returns null if the queue is empty.
   */
  export function dequeue(sessionID: string): QueuedTask | null {
    // Sort by priority order (critical=0, high=1, normal=2, low=3), then by creation time
    const rows = Database.use((db) =>
      db
        .select()
        .from(A2ATaskQueueTable)
        .where(
          and(eq(A2ATaskQueueTable.session_id, sessionID), eq(A2ATaskQueueTable.status, "queued")),
        )
        .orderBy(A2ATaskQueueTable.priority, A2ATaskQueueTable.time_created)
        .all(),
    )

    if (rows.length === 0) return null

    // Sort by priority order since SQLite sorts text alphabetically
    const sorted = rows.sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority as Priority] ?? 99
      const pb = PRIORITY_ORDER[b.priority as Priority] ?? 99
      if (pa !== pb) return pa - pb
      return a.time_created - b.time_created
    })

    const row = sorted[0]
    const task = fromRow(row)

    // Mark as planning
    Database.use((db) =>
      db
        .update(A2ATaskQueueTable)
        .set({ status: "planning", time_started: Date.now() })
        .where(eq(A2ATaskQueueTable.id, task.id))
        .run(),
    )

    log.info("task dequeued", { id: task.id, priority: task.priority })

    Bus.publish(A2AProtocol.TaskDispatched, {
      taskID: task.id,
      sessionID: task.sessionID,
    })

    return { ...task, status: "planning", timeStarted: Date.now() }
  }

  /**
   * Dequeue the highest-priority queued task across all sessions.
   * Returns null if the queue is empty.
   */
  export function dequeueAny(): QueuedTask | null {
    const rows = Database.use((db) =>
      db.select().from(A2ATaskQueueTable).where(eq(A2ATaskQueueTable.status, "queued")).all(),
    )

    if (rows.length === 0) return null

    const sorted = rows.sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority as Priority] ?? 99
      const pb = PRIORITY_ORDER[b.priority as Priority] ?? 99
      if (pa !== pb) return pa - pb
      return a.time_created - b.time_created
    })

    const row = sorted[0]
    const task = fromRow(row)
    const now = Date.now()

    Database.use((db) =>
      db
        .update(A2ATaskQueueTable)
        .set({ status: "planning", time_started: now })
        .where(eq(A2ATaskQueueTable.id, task.id))
        .run(),
    )

    log.info("task dequeued", { id: task.id, priority: task.priority, sessionID: task.sessionID })

    Bus.publish(A2AProtocol.TaskDispatched, {
      taskID: task.id,
      sessionID: task.sessionID,
    })

    return { ...task, status: "planning", timeStarted: now }
  }

  export function updateStatus(taskID: string, status: Status) {
    const set: Record<string, unknown> = { status }
    if (status === "completed" || status === "failed") {
      set.time_completed = Date.now()
    }
    Database.use((db) =>
      db.update(A2ATaskQueueTable).set(set).where(eq(A2ATaskQueueTable.id, taskID)).run(),
    )
    log.info("task status updated", { id: taskID, status })
  }

  export function complete(taskID: string, summary: string) {
    Database.use((db) =>
      db
        .update(A2ATaskQueueTable)
        .set({
          status: "completed",
          time_completed: Date.now(),
          previous_summary: summary,
        })
        .where(eq(A2ATaskQueueTable.id, taskID))
        .run(),
    )

    const task = get(taskID)
    if (task) {
      log.info("task completed", { id: taskID })
      Bus.publish(A2AProtocol.TaskCompleted, {
        taskID,
        sessionID: task.sessionID,
        success: true,
        summary,
      })
    }
  }

  export function fail(taskID: string, errorMessage: string) {
    Database.use((db) =>
      db
        .update(A2ATaskQueueTable)
        .set({
          status: "failed",
          time_completed: Date.now(),
          error_message: errorMessage,
        })
        .where(eq(A2ATaskQueueTable.id, taskID))
        .run(),
    )

    const task = get(taskID)
    if (task) {
      log.info("task failed", { id: taskID, error: errorMessage })
      Bus.publish(A2AProtocol.TaskCompleted, {
        taskID,
        sessionID: task.sessionID,
        success: false,
        summary: errorMessage,
      })
    }
  }

  export function cancel(taskID: string) {
    Database.use((db) =>
      db
        .update(A2ATaskQueueTable)
        .set({ status: "cancelled", time_completed: Date.now() })
        .where(eq(A2ATaskQueueTable.id, taskID))
        .run(),
    )
    log.info("task cancelled", { id: taskID })
  }

  export function list(sessionID: string): QueuedTask[] {
    const rows = Database.use((db) =>
      db
        .select()
        .from(A2ATaskQueueTable)
        .where(eq(A2ATaskQueueTable.session_id, sessionID))
        .orderBy(desc(A2ATaskQueueTable.time_created))
        .all(),
    )
    return rows.map(fromRow)
  }

  export function listQueued(sessionID: string): QueuedTask[] {
    const rows = Database.use((db) =>
      db
        .select()
        .from(A2ATaskQueueTable)
        .where(
          and(eq(A2ATaskQueueTable.session_id, sessionID), eq(A2ATaskQueueTable.status, "queued")),
        )
        .all(),
    )
    return rows
      .map(fromRow)
      .sort((a, b) => {
        const pa = PRIORITY_ORDER[a.priority] ?? 99
        const pb = PRIORITY_ORDER[b.priority] ?? 99
        if (pa !== pb) return pa - pb
        return a.timeCreated - b.timeCreated
      })
  }

  export function queueSize(sessionID: string): number {
    const rows = Database.use((db) =>
      db
        .select()
        .from(A2ATaskQueueTable)
        .where(
          and(eq(A2ATaskQueueTable.session_id, sessionID), eq(A2ATaskQueueTable.status, "queued")),
        )
        .all(),
    )
    return rows.length
  }

  export function incrementRetry(taskID: string): number {
    const task = get(taskID)
    if (!task) return 0
    const newCount = task.retryCount + 1
    Database.use((db) =>
      db
        .update(A2ATaskQueueTable)
        .set({ retry_count: newCount })
        .where(eq(A2ATaskQueueTable.id, taskID))
        .run(),
    )
    return newCount
  }
}
