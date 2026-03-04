import z from "zod"
import { Instance } from "@/project/instance"
import { SessionPrompt } from "@/session/prompt"
import { SessionTable } from "@/session/session.sql"
import { Database, and, eq, sql } from "@/storage/db"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import { Scheduler } from "./index"
import { TaskQueueTable } from "./task-queue.sql"

const RawTaskMetadata = z.object({
  kind: z.literal("session_prompt"),
  input: z.unknown(),
})

const EnqueuePromptInput = z.object({
  sessionID: Identifier.schema("session"),
  prompt: z.unknown(),
  priority: z.enum(["high", "normal", "low"]).optional(),
  source: z.string().optional(),
  maxRetries: z.coerce.number().int().min(0).max(20).optional(),
})

export namespace TaskQueueService {
  const log = Log.create({ service: "task-queue-service" })

  const POLL_INTERVAL_MS = 2000
  const RUN_TIMEOUT_ENV = "OPENCORVUS_TASK_QUEUE_RUN_TIMEOUT_MS"
  const RUN_TIMEOUT_MS = 30 * 60 * 1000
  const HEARTBEAT_ENV = "OPENCORVUS_TASK_QUEUE_HEARTBEAT_MS"
  const HEARTBEAT_MS = 15 * 1000
  const BATCH_SIZE = 10
  const CANDIDATE_MULTIPLIER = 8
  const CONCURRENCY_ENV = "OPENCORVUS_TASK_QUEUE_CONCURRENCY"
  const CONCURRENCY_DEFAULT = 4

  const state = Instance.state(() => ({
    running: false,
  }))

  export function init() {
    Scheduler.register({
      id: "task-queue-service.poll",
      interval: POLL_INTERVAL_MS,
      run: poll,
      scope: "instance",
    })
    log.info("task queue service initialized")
  }

  export async function runNow() {
    await poll()
  }

  export async function executePrompt(raw: { sessionID: string; prompt: unknown; source?: string }) {
    const input = z
      .object({
        sessionID: Identifier.schema("session"),
        prompt: z.unknown(),
        source: z.string().optional(),
      })
      .parse(raw)
    const prompt = promptSchema().parse(input.prompt)
    return SessionPrompt.prompt({
      sessionID: input.sessionID,
      ...prompt,
    })
  }

  export function enqueuePrompt(raw: z.input<typeof EnqueuePromptInput>) {
    const input = EnqueuePromptInput.parse(raw)
    const prompt = promptSchema().parse(input.prompt)
    const now = Date.now()
    const id = Identifier.ascending("task")
    Database.use((db) =>
      db
        .insert(TaskQueueTable)
        .values({
          id,
          session_id: input.sessionID,
          prompt: firstText(prompt),
          priority: input.priority ?? "normal",
          status: "queued",
          source: input.source ?? "api",
          retry_count: 0,
          max_retries: input.maxRetries ?? 3,
          metadata: {
            kind: "session_prompt",
            input: { ...prompt },
          },
          time_created: now,
          time_updated: now,
        })
        .run(),
    )
    log.info("task queued", { id, sessionID: input.sessionID, source: input.source ?? "api" })
    return id
  }

  async function poll() {
    const current = state()
    if (current.running) return
    current.running = true
    await run(Date.now()).finally(() => {
      current.running = false
    })
  }

  async function run(now: number): Promise<void> {
    recover(now)
    const limit = concurrency()
    const queued = pending(limit)
    if (queued.length === 0) return
    log.info("found queued tasks", { count: queued.length, projectID: Instance.project.id })
    const list: Array<typeof TaskQueueTable.$inferSelect> = []
    for (const item of queued) {
      if (list.length >= limit) break
      const task = claim(item.id, item.session_id)
      if (!task) continue
      list.push(task)
    }
    if (list.length === 0) return
    await Promise.all(list.map((task) => execute(task).catch((error) => fail(task, error))))
  }

  function concurrency() {
    const raw = process.env[CONCURRENCY_ENV]
    if (!raw) return Math.min(CONCURRENCY_DEFAULT, BATCH_SIZE)
    const value = Number(raw)
    if (!Number.isFinite(value)) return Math.min(CONCURRENCY_DEFAULT, BATCH_SIZE)
    if (value < 1) return 1
    return Math.min(Math.floor(value), BATCH_SIZE)
  }

  function pending(limit: number) {
    const size = Math.max(BATCH_SIZE, limit * CANDIDATE_MULTIPLIER)
    const result: Array<{ id: string; session_id: string }> = []
    const seen = new Set<string>()
    let offset = 0

    while (result.length < limit) {
      const list = Database.use((db) =>
        db
          .select({
            id: TaskQueueTable.id,
            session_id: TaskQueueTable.session_id,
          })
          .from(TaskQueueTable)
          .where(
            sql`${TaskQueueTable.status} IN ('queued', 'retrying')
              AND ${TaskQueueTable.session_id} IN (
                SELECT ${SessionTable.id}
                FROM ${SessionTable}
                WHERE ${SessionTable.project_id} = ${Instance.project.id}
              )`,
          )
          .orderBy(
            sql`CASE ${TaskQueueTable.priority}
              WHEN 'high' THEN 0
              WHEN 'normal' THEN 1
              WHEN 'low' THEN 2
              ELSE 3
            END`,
            TaskQueueTable.time_created,
          )
          .limit(size)
          .offset(offset)
          .all(),
      )
      if (list.length === 0) break

      for (const item of list) {
        if (seen.has(item.session_id)) continue
        seen.add(item.session_id)
        result.push(item)
        if (result.length >= limit) break
      }

      if (list.length < size) break
      offset += list.length
    }

    return result
  }

  function claim(id: string, sessionID: string) {
    const now = Date.now()
    return Database.use((db) =>
      db
        .update(TaskQueueTable)
        .set({
          status: "running",
          time_started: now,
          time_completed: null,
          error_message: null,
          time_updated: now,
        })
        .where(
          sql`${TaskQueueTable.id} = ${id}
            AND ${TaskQueueTable.session_id} = ${sessionID}
            AND ${TaskQueueTable.status} IN ('queued', 'retrying')
            AND NOT EXISTS (
              SELECT 1
              FROM a2a_task_queue running
              WHERE running.session_id = ${sessionID}
                AND running.status = 'running'
                AND running.id != ${id}
            )
            AND ${TaskQueueTable.session_id} IN (
              SELECT ${SessionTable.id}
              FROM ${SessionTable}
              WHERE ${SessionTable.project_id} = ${Instance.project.id}
            )`,
        )
        .returning()
        .get(),
    )
  }

  async function execute(task: typeof TaskQueueTable.$inferSelect) {
    const metadata = RawTaskMetadata.safeParse(task.metadata)
    if (!metadata.success) {
      throw new Error("invalid queue metadata")
    }
    const timer = setInterval(() => {
      try {
        touch(task.id)
      } catch (error) {
        log.warn("task heartbeat update failed", {
          id: task.id,
          sessionID: task.session_id,
          error: message(error),
        })
      }
    }, heartbeat())
    timer.unref()
    await executePrompt({
      sessionID: task.session_id,
      prompt: metadata.data.input,
      source: "task-queue-service",
    }).finally(() => {
      clearInterval(timer)
    })
    const now = Date.now()
    Database.use((db) =>
      db
        .update(TaskQueueTable)
        .set({
          status: "completed",
          time_completed: now,
          error_message: null,
          time_updated: now,
        })
        .where(and(eq(TaskQueueTable.id, task.id), eq(TaskQueueTable.status, "running")))
        .run(),
    )
    log.info("task completed", { id: task.id, sessionID: task.session_id })
  }

  function recover(now: number) {
    const timeout = runTimeout()
    const stale = Database.use((db) =>
      db
        .select()
        .from(TaskQueueTable)
        .where(
          sql`${TaskQueueTable.status} = 'running'
            AND (
              ${TaskQueueTable.time_updated} <= ${now - timeout}
              OR (
                ${TaskQueueTable.time_updated} IS NULL
                AND ${TaskQueueTable.time_started} <= ${now - timeout}
              )
            )
            AND ${TaskQueueTable.session_id} IN (
              SELECT ${SessionTable.id}
              FROM ${SessionTable}
              WHERE ${SessionTable.project_id} = ${Instance.project.id}
            )`,
        )
        .all(),
    )
    if (stale.length === 0) return
    for (const task of stale) {
      const retryCount = task.retry_count + 1
      const failed = retryCount > task.max_retries
      Database.use((db) =>
        db
          .update(TaskQueueTable)
          .set({
            retry_count: retryCount,
            status: failed ? "failed" : "retrying",
            time_started: null,
            time_completed: failed ? now : null,
            error_message: "task timed out while running",
            time_updated: now,
          })
          .where(and(eq(TaskQueueTable.id, task.id), eq(TaskQueueTable.status, "running")))
          .run(),
      )
      log.warn("recovered stale running task", {
        id: task.id,
        sessionID: task.session_id,
        retryCount,
        failed,
      })
    }
  }

  function fail(task: typeof TaskQueueTable.$inferSelect, error: unknown) {
    const now = Date.now()
    const retryCount = task.retry_count + 1
    const failed = retryCount > task.max_retries
    Database.use((db) =>
      db
        .update(TaskQueueTable)
        .set({
          retry_count: retryCount,
          status: failed ? "failed" : "retrying",
          time_started: null,
          time_completed: failed ? now : null,
          error_message: message(error),
          time_updated: now,
        })
        .where(and(eq(TaskQueueTable.id, task.id), eq(TaskQueueTable.status, "running")))
        .run(),
    )
    log.error("task failed", {
      id: task.id,
      sessionID: task.session_id,
      retryCount,
      maxRetries: task.max_retries,
      failed,
      error: message(error),
    })
  }

  function touch(id: string) {
    Database.use((db) =>
      db
        .update(TaskQueueTable)
        .set({
          time_updated: Date.now(),
        })
        .where(and(eq(TaskQueueTable.id, id), eq(TaskQueueTable.status, "running")))
        .run(),
    )
  }

  function runTimeout() {
    const raw = process.env[RUN_TIMEOUT_ENV]
    if (!raw) return RUN_TIMEOUT_MS
    const value = Number(raw)
    if (!Number.isFinite(value)) return RUN_TIMEOUT_MS
    if (value < 1000) return 1000
    return Math.floor(value)
  }

  function heartbeat() {
    const raw = process.env[HEARTBEAT_ENV]
    if (!raw) return HEARTBEAT_MS
    const value = Number(raw)
    if (!Number.isFinite(value)) return HEARTBEAT_MS
    if (value < 1000) return 1000
    return Math.floor(value)
  }
}

function message(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function promptSchema() {
  return SessionPrompt.PromptInput.omit({
    sessionID: true,
  })
}

type PromptPart = z.infer<ReturnType<typeof promptSchema>>["parts"][number]
type TextPart = Extract<PromptPart, { type: "text" }>

function textPart(part: PromptPart): part is TextPart {
  return part.type === "text"
}

function firstText(input: z.infer<ReturnType<typeof promptSchema>>) {
  const part = input.parts.find(textPart)
  if (!part) return "[task]"
  if (part.text.trim().length === 0) return "[task]"
  return part.text
}
