import z from "zod"
import { Instance, lazyInstanceState } from "@/project/instance"
import { Bus } from "@/bus"
import { GlobalBus } from "@/bus/global"
import { BusEvent } from "@/bus/bus-event"
import { SessionPrompt } from "@/session/prompt"
import { SessionTable } from "@/session/session.sql"
import { Message } from "@/session/message"
import { Database, and, eq, sql } from "@/storage/db"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import { EngineConfig } from "@/engine/config"
import { Scheduler } from "./index"
import { TaskQueueTable } from "./task-queue.sql"
import { SessionAgentIdentity } from "@/session/agent-identity"

export const TaskQueueEvent = {
  Completed: BusEvent.define("task-queue.completed", z.object({
    queueTaskID: z.string(),
    sessionID: z.string(),
  })),
}

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

  const POLL_INTERVAL_MS = 500
  const BATCH_SIZE = 10
  const CONCURRENCY_ENV = "OPENCORVUS_TASK_QUEUE_CONCURRENCY"
  const CONCURRENCY_DEFAULT = 4

  const state = lazyInstanceState(() => ({
    polling: false,
    inFlight: new Set<Promise<void>>(),
  }))

  export function init() {
    Scheduler.register({
      id: "task-queue-service.poll",
      interval: POLL_INTERVAL_MS,
      run: async () => {
        await poll()
      },
      scope: "instance",
    })
    log.info("task queue service initialized")
  }

  export async function runNow() {
    const started = await poll()
    await Promise.allSettled(started)
  }

  export type QueuedTaskStatus = {
    taskID: string
    sessionID: string
    status: "queued" | "retrying" | "running" | "completed" | "failed"
    retryCount: number
    maxRetries: number
    source: string
    prompt: string
    error: string | null
    startedAt: number | null
    completedAt: number | null
    updatedAt: number
  }

  export function getStatus(input: { sessionID: string; taskID: string; source: string }): QueuedTaskStatus | null {
    const row = Database.use((db) =>
      db
        .select()
        .from(TaskQueueTable)
        .where(
          and(
            eq(TaskQueueTable.id, input.taskID),
            eq(TaskQueueTable.session_id, input.sessionID),
            eq(TaskQueueTable.source, input.source),
          ),
        )
        .get(),
    )
    if (!row) return null
    return {
      taskID: row.id,
      sessionID: row.session_id,
      status: row.status,
      retryCount: row.retry_count,
      maxRetries: row.max_retries,
      source: row.source,
      prompt: row.prompt,
      error: row.error_message ?? null,
      startedAt: row.time_started ?? null,
      completedAt: row.time_completed ?? null,
      updatedAt: row.time_updated,
    }
  }

  export async function executePrompt(raw: { sessionID: string; prompt: unknown; source?: string }) {
    const input = z
      .object({
        sessionID: Identifier.schema("session"),
        prompt: z.unknown(),
        source: z.string().optional(),
      })
      .parse(raw)
    const prompt = applyStoredSessionPromptIdentity(input.sessionID, promptSchema().parse(input.prompt))
    return SessionPrompt.prompt({
      sessionID: input.sessionID,
      ...prompt,
    })
  }

  export function enqueuePrompt(raw: z.input<typeof EnqueuePromptInput>) {
    const input = EnqueuePromptInput.parse(raw)
    const prompt = applyStoredSessionPromptIdentity(input.sessionID, promptSchema().parse(input.prompt))
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
    if (current.polling) return []
    current.polling = true
    return run(Date.now())
  }

  async function run(now: number): Promise<Promise<void>[]> {
    const current = state()
    // audit-2026-04-29 W2-V28 — polling clear MUST happen before
    // run's async Promise resolves so the next runNow's poll can
    // proceed in the same microtask flush. Pre-fix the
    // `return run(...).finally(() => polling=false)` pattern in
    // poll() set polling=false in a chained .finally microtask
    // that fired AFTER the test's await firstRunning resume —
    // which was queued earlier when firstStarted fired inside the
    // mock during list.map. The test's resume ran first, called
    // runNow → poll, which saw polling=still=true and SKIPPED.
    // Bury the clear inside run's try/finally so it lands
    // synchronously within run's body, before the body returns.
    try {
      await recover(now)
      const limit = Math.max(0, concurrency() - current.inFlight.size)
      if (limit === 0) return []
      const queued = pending(limit)
      if (queued.length === 0) return []
      log.info("found queued tasks", { count: queued.length, projectID: Instance.project.id })
      const list: Array<typeof TaskQueueTable.$inferSelect> = []
      for (const item of queued) {
        if (list.length >= limit) break
        const task = claim(item.id, item.session_id)
        if (!task) continue
        list.push(task)
      }
      if (list.length === 0) return []
      const started = list.map((task) => {
        let running!: Promise<void>
        running = execute(task)
          .catch((error) => fail(task, error))
          .finally(() => {
            current.inFlight.delete(running)
          })
        current.inFlight.add(running)
        return running
      })
      return started
    } finally {
      current.polling = false
    }
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
    return Database.use((db) =>
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
            )
            AND NOT EXISTS (
              SELECT 1
              FROM a2a_task_queue running
              WHERE running.session_id = ${TaskQueueTable.session_id}
                AND running.status = 'running'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM a2a_task_queue better
              WHERE better.session_id = ${TaskQueueTable.session_id}
                AND better.status IN ('queued', 'retrying')
                AND (
                  CASE better.priority
                    WHEN 'high' THEN 0
                    WHEN 'normal' THEN 1
                    WHEN 'low' THEN 2
                    ELSE 3
                  END
                    < CASE ${TaskQueueTable.priority}
                        WHEN 'high' THEN 0
                        WHEN 'normal' THEN 1
                        WHEN 'low' THEN 2
                        ELSE 3
                      END
                  OR (
                    CASE better.priority
                      WHEN 'high' THEN 0
                      WHEN 'normal' THEN 1
                      WHEN 'low' THEN 2
                      ELSE 3
                    END
                      = CASE ${TaskQueueTable.priority}
                          WHEN 'high' THEN 0
                          WHEN 'normal' THEN 1
                          WHEN 'low' THEN 2
                          ELSE 3
                        END
                    AND (
                      better.time_created < ${TaskQueueTable.time_created}
                      OR (
                        better.time_created = ${TaskQueueTable.time_created}
                        AND better.id < ${TaskQueueTable.id}
                      )
                    )
                  )
                )
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
          TaskQueueTable.id,
        )
        .limit(limit)
        .all(),
    )
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
    // Chunk-driven heartbeat: touch() only fires when SessionPrompt actually
    // makes progress (message.part.delta / message.part.updated). Replaces
    // the old unconditional setInterval(touch, 15s) which kept time_updated
    // fresh even while the upstream LLM stream was dead — defeating the
    // recover() staleness gate. GlobalBus subscription covers worktree
    // Instances too (session lives in one, executor in another).
    const handler = (msg: { payload: any }) => {
      const event = msg.payload
      if (!event || typeof event.type !== "string") return
      if (event.type !== Message.Event.PartDelta.type && event.type !== Message.Event.PartUpdated.type) return
      const props = event.properties ?? {}
      const sid =
        (typeof props.sessionID === "string" && props.sessionID) ||
        (typeof props.part === "object" && props.part && typeof props.part.sessionID === "string" && props.part.sessionID) ||
        undefined
      if (sid !== task.session_id) return
      try {
        touch(task.id)
      } catch (error) {
        log.warn("task progress touch failed", {
          id: task.id,
          sessionID: task.session_id,
          error: message(error),
        })
      }
    }
    GlobalBus.on("event", handler)
    try {
      await executePrompt({
        sessionID: task.session_id,
        prompt: metadata.data.input,
        source: "task-queue-service",
      })
    } finally {
      GlobalBus.off("event", handler)
    }
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
    Bus.publish(TaskQueueEvent.Completed, { queueTaskID: task.id, sessionID: task.session_id })
  }

  async function recover(now: number) {
    const timeout = await runTimeout()
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

  async function runTimeout() {
    // Single source: engine/config.ts ActivityConfig.task_queue_run_timeout_ms.
    // No OPENCORVUS_TASK_QUEUE_RUN_TIMEOUT_MS env — assistant.activity in
    // opencorvus.jsonc is the one place to adjust it (CLAUDE.md #25).
    const cfg = await EngineConfig.get()
    return cfg.activity.task_queue_run_timeout_ms
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

function applyStoredSessionPromptIdentity<T extends z.infer<ReturnType<typeof promptSchema>>>(sessionID: string, prompt: T): T {
  const row = Database.use((db) =>
    db.select({ kind: SessionTable.kind }).from(SessionTable).where(eq(SessionTable.id, sessionID)).get(),
  )
  if (!row) return prompt
  return SessionAgentIdentity.applyToPrompt(row.kind, prompt)
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
