import z from "zod"
import { NamedError } from "@opencorvus-ai/util/error"
import { Instance, lazyInstanceState } from "@/project/instance"
import { Bus } from "@/bus"
import { GlobalBus } from "@/bus/global"
import { BusEvent } from "@/bus/bus-event"
import { Session } from "@/session"
import { sessionLifecycleOrderKey } from "@/session/status"
import { SessionPrompt } from "@/session/prompt"
import { SessionContext } from "@/session/context"
import { SessionTable } from "@/session/session.sql"
import { Message } from "@/session/message"
import { Database, and, eq, inArray, sql, type SQL } from "@/storage/db"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import { EngineConfig } from "@/engine/config"
import { awaitSessionPromptFinishedInScope, cancelSessionPromptInScope } from "@/engine/cancellation-scope"
import { TaskQueueTable } from "./task-queue.sql"
import { SessionAgentIdentity } from "@/session/agent-identity"
import { SessionWake } from "@/session/wake"

export const TaskQueueEvent = {
  Completed: BusEvent.define(
    "task-queue.completed",
    z.object({
      queueTaskID: z.string(),
      sessionID: z.string(),
    }),
  ),
}

const RawTaskMetadata = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("session_prompt"),
    input: z.unknown(),
  }),
  z.object({
    kind: z.literal("session_wake"),
    messageID: z.string(),
    input: z.unknown(),
  }),
  z.object({
    kind: z.literal("session_compaction"),
    input: z.unknown(),
  }),
])

const EnqueuePromptInput = z.object({
  sessionID: Identifier.schema("session"),
  prompt: z.unknown(),
  priority: z.enum(["high", "normal", "low"]).optional(),
  source: z.string().optional(),
})

const CompactionModelRef = z.object({
  providerID: z.string(),
  modelID: z.string(),
})

const ExecuteCompactionInput = z.object({
  sessionID: Identifier.schema("session"),
  sourceUserMessageID: Identifier.schema("message"),
  model: CompactionModelRef.optional(),
  auto: z.boolean().optional().default(false),
  overflow: z.boolean().optional().default(false),
  focus: z.string().optional(),
})

const StoredCompactionInput = ExecuteCompactionInput.omit({ sessionID: true })

const EnqueueCompactionInput = ExecuteCompactionInput.extend({
  priority: z.enum(["high", "normal", "low"]).optional(),
  source: z.string().optional(),
})

export namespace TaskQueueService {
  const log = Log.create({ service: "task-queue-service" })

  const BATCH_SIZE = 10
  const CONCURRENCY_ENV = "OPENCORVUS_TASK_QUEUE_CONCURRENCY"
  const CONCURRENCY_DEFAULT = 4
  type QueueTaskRow = typeof TaskQueueTable.$inferSelect
  type InFlightTask = {
    promise: Promise<void>
    cleanup: () => void
    sessionID: string
    source: string
    cancellationReason?: string
  }

  const state = lazyInstanceState(
    () => ({
      draining: false,
      drainRequested: false,
      activeDrain: undefined as Promise<Promise<void>[]> | undefined,
      inFlight: new Map<string, InFlightTask>(),
      recoveryTimers: new Map<string, ReturnType<typeof setTimeout>>(),
      recoveryTimerTokens: new Map<string, number>(),
      recoveryTimerSequence: 0,
    }),
    async (current) => {
      for (const timer of current.recoveryTimers.values()) clearTimeout(timer)
      current.recoveryTimers.clear()
      current.recoveryTimerTokens.clear()
      current.inFlight.clear()
    },
  )

  export function init() {
    scheduleRunningRecoveryTimers("init")
    log.info("task queue service initialized")
  }

  export async function runNow() {
    await drainUntilIdle()
  }

  export type QueuedTaskStatus = {
    taskID: string
    sessionID: string
    status: "queued" | "running" | "completed" | "failed"
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
      source: row.source,
      prompt: row.prompt,
      error: row.error_message ?? null,
      startedAt: row.time_started ?? null,
      completedAt: row.time_completed ?? null,
      updatedAt: row.time_updated,
    }
  }

  export async function executePrompt(
    raw: { sessionID: string; prompt: unknown; source?: string },
    hooks?: { beforeLoop?: () => void | Promise<void> },
  ) {
    const input = z
      .object({
        sessionID: Identifier.schema("session"),
        prompt: z.unknown(),
        source: z.string().optional(),
      })
      .parse(raw)
    const prompt = stampTaskQueueWakeReason(
      applyStoredSessionPromptIdentity(input.sessionID, promptSchema().parse(input.prompt)),
      { queueSource: input.source },
    )
    const promptInput = {
      sessionID: input.sessionID,
      ...prompt,
    }
    if (hooks) return SessionPrompt.prompt(promptInput, hooks)
    return SessionPrompt.prompt(promptInput)
  }

  export async function executeCompaction(
    raw: z.input<typeof ExecuteCompactionInput>,
    hooks?: { beforeLoop?: () => void | Promise<void> },
  ) {
    const input = ExecuteCompactionInput.parse(raw)
    const session = await Session.get(input.sessionID)
    const source = await compactionSource(input.sessionID, input.sourceUserMessageID)
    const { SessionCompaction } = await import("@/session/compaction")
    await SessionCompaction.create({
      sessionID: input.sessionID,
      source,
      model: input.model,
      auto: input.auto,
      overflow: input.overflow,
      focus: input.focus,
    })
    return SessionContext.provide(session, () =>
      Instance.provide({
        directory: session.directory,
        fn: async () => {
          const beforeLoop = hooks?.beforeLoop?.()
          if (beforeLoop) await beforeLoop
          return SessionPrompt.loop(
            input.auto ? { sessionID: input.sessionID } : { sessionID: input.sessionID, result_mode: "summary" },
          )
        },
      }),
    )
  }

  export function enqueuePrompt(raw: z.input<typeof EnqueuePromptInput>) {
    const input = EnqueuePromptInput.parse(raw)
    const id = Identifier.ascending("task")
    const prompt = stampTaskQueueWakeReason(
      applyStoredSessionPromptIdentity(input.sessionID, promptSchema().parse(input.prompt)),
      { queueTaskID: id, queueSource: input.source ?? "api" },
    )
    const now = Date.now()
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
    requestDrain("enqueuePrompt")
    return id
  }

  export function enqueueCompaction(raw: z.input<typeof EnqueueCompactionInput>) {
    const input = EnqueueCompactionInput.parse(raw)
    const id = Identifier.ascending("task")
    const now = Date.now()
    const payload = StoredCompactionInput.parse({
      sourceUserMessageID: input.sourceUserMessageID,
      model: input.model,
      auto: input.auto,
      overflow: input.overflow,
      focus: input.focus,
    })
    Database.use((db) =>
      db
        .insert(TaskQueueTable)
        .values({
          id,
          session_id: input.sessionID,
          prompt: compactionPrompt(payload),
          priority: input.priority ?? "normal",
          status: "queued",
          source: input.source ?? "api",
          metadata: {
            kind: "session_compaction",
            input: payload,
          },
          time_created: now,
          time_updated: now,
        })
        .run(),
    )
    log.info("compaction task queued", { id, sessionID: input.sessionID, source: input.source ?? "api" })
    requestDrain("enqueueCompaction")
    return id
  }

  export async function enqueuePromptAfterPersistingUserMessage(raw: z.input<typeof EnqueuePromptInput>) {
    const input = EnqueuePromptInput.parse(raw)
    const id = Identifier.ascending("task")
    const prompt = stampTaskQueueWakeReason(
      applyStoredSessionPromptIdentity(input.sessionID, promptSchema().parse(input.prompt)),
      { queueTaskID: id, queueSource: input.source ?? "api" },
    )
    const userMessage = await SessionPrompt.prompt({
      sessionID: input.sessionID,
      ...prompt,
      noReply: true,
    })
    const now = Date.now()
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
          metadata: {
            kind: "session_wake",
            messageID: userMessage.info.id,
            input: { ...prompt },
          },
          time_created: now,
          time_updated: now,
        })
        .run(),
    )
    log.info("task queued after visible user message persisted", {
      id,
      sessionID: input.sessionID,
      messageID: userMessage.info.id,
      source: input.source ?? "api",
    })
    requestDrain("enqueuePromptAfterPersistingUserMessage")
    return { taskID: id, userMessage }
  }

  export function cancelSessionPrompts(input: { sessionIDs: string[]; reason?: string; source?: string }): number {
    const sessionIDs = normalizeSessionIDs(input.sessionIDs)
    if (sessionIDs.length === 0) return 0
    const now = Date.now()
    const reason = input.reason || "task cancelled"
    const cancelledRows = Database.use((db) => {
      const where: SQL[] = [
        inArray(TaskQueueTable.session_id, sessionIDs),
        eq(TaskQueueTable.status, "queued"),
      ]
      if (input.source) where.push(eq(TaskQueueTable.source, input.source))
      return db
        .update(TaskQueueTable)
        .set({
          status: "failed",
          time_completed: now,
          error_message: reason,
          time_updated: now,
        })
        .where(and(...where))
        .returning({ id: TaskQueueTable.id })
        .all()
    })
    if (Instance.current()) {
      for (const row of cancelledRows) clearRecoveryTimer(row.id)
    }
    const inFlightCancellations = requestInFlightCancellation({ sessionIDs, reason, source: input.source })
    return cancelledRows.length + inFlightCancellations
  }

  export async function awaitSessionPromptsIdle(input: { sessionIDs: string[]; source?: string }) {
    const sessionIDs = normalizeSessionIDs(input.sessionIDs)
    if (sessionIDs.length === 0) return
    if (!Instance.current()) return
    const sessions = new Set(sessionIDs)
    while (true) {
      const running = [...state().inFlight.values()]
        .filter((task) => sessions.has(task.sessionID))
        .filter((task) => !input.source || task.source === input.source)
        .map((task) => task.promise)
      if (running.length === 0) {
        const stillRunning = Database.use((db) => {
          const where: SQL[] = [inArray(TaskQueueTable.session_id, sessionIDs), eq(TaskQueueTable.status, "running")]
          if (input.source) where.push(eq(TaskQueueTable.source, input.source))
          return db.select({ id: TaskQueueTable.id }).from(TaskQueueTable).where(and(...where)).all()
        })
        if (stillRunning.length === 0) return
        throw new Error(
          `queue task(s) still running without an in-flight prompt: ${stillRunning.map((row) => row.id).join(", ")}`,
        )
      }
      await Promise.all(running)
    }
  }

  function normalizeSessionIDs(sessionIDs: string[]) {
    return [...new Set(sessionIDs.map((id) => String(id || "").trim()).filter(Boolean))]
  }

  function requestInFlightCancellation(input: { sessionIDs: string[]; reason: string; source?: string }) {
    if (!Instance.current()) return 0
    const sessions = new Set(input.sessionIDs)
    const liveSessions = Database.use((db) =>
      db
        .select({
          id: SessionTable.id,
          directory: SessionTable.directory,
        })
        .from(SessionTable)
        .where(inArray(SessionTable.id, input.sessionIDs))
        .all(),
    )
    const directoryBySession = new Map(liveSessions.map((session) => [session.id, session.directory]))
    let cancelled = 0
    for (const task of state().inFlight.values()) {
      if (!sessions.has(task.sessionID)) continue
      if (input.source && task.source !== input.source) continue
      task.cancellationReason = input.reason
      task.cleanup()
      cancelled += 1
      const directory = directoryBySession.get(task.sessionID)
      if (directory) SessionPrompt.cancel(task.sessionID, directory)
    }
    return cancelled
  }

  function assertInFlightNotCancelled(task: typeof TaskQueueTable.$inferSelect, inFlight: InFlightTask) {
    if (!inFlight.cancellationReason) return
    throw new Error(inFlight.cancellationReason || `queue task ${task.id} cancelled`)
  }

  function requestDrain(reason: string) {
    void drainReadyTasks(reason).catch((error) => {
      log.error("explicit queue drain failed", {
        reason,
        error: message(error),
      })
    })
  }

  async function drainUntilIdle() {
    while (true) {
      const started = await drainReadyTasks("runNow")
      const current = state()
      const running = [...current.inFlight.values()].map((task) => task.promise)
      if (started.length === 0 && running.length === 0) return
      await Promise.allSettled([...started, ...running])
    }
  }

  async function drainReadyTasks(reason: string) {
    const current = state()
    if (current.draining) {
      current.drainRequested = true
      return current.activeDrain ? await current.activeDrain : []
    }
    current.draining = true
    current.activeDrain = run(Date.now(), reason)
    try {
      return await current.activeDrain
    } finally {
      current.activeDrain = undefined
      current.draining = false
      if (current.drainRequested) {
        current.drainRequested = false
        requestDrain("queued while drain was active")
      }
    }
  }

  async function run(now: number, reason: string): Promise<Promise<void>[]> {
    const current = state()
    await recover(now)
    const limit = Math.max(0, concurrency() - current.inFlight.size)
    if (limit === 0) return []
    const queued = pending(limit)
    if (queued.length === 0) return []
    log.info("found queued tasks", { count: queued.length, projectID: Instance.project.id, reason })
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
      const inFlight: InFlightTask = {
        promise: Promise.resolve(),
        cleanup: () => {},
        sessionID: task.session_id,
        source: task.source,
      }
      current.inFlight.set(task.id, inFlight)
      running = execute(task, inFlight)
        .catch((error) => {
          try {
            fail(task, error)
          } catch (failError) {
            log.error("task failure handler failed", {
              id: task.id,
              sessionID: task.session_id,
              originalError: message(error),
              error: message(failError),
            })
          }
        })
        .finally(() => {
          if (current.inFlight.get(task.id)?.promise === running) {
            current.inFlight.delete(task.id)
          }
        })
      inFlight.promise = running
      return running
    })
    return started
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
          sql`${TaskQueueTable.status} = 'queued'
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
                AND better.status = 'queued'
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
    const task = Database.use((db) =>
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
            AND ${TaskQueueTable.status} = 'queued'
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
    if (task) scheduleRunningRecoveryTimer(task, "claim")
    return task
  }

  async function execute(task: typeof TaskQueueTable.$inferSelect, inFlight: InFlightTask) {
    const metadata = RawTaskMetadata.safeParse(task.metadata)
    if (!metadata.success) {
      throw new Error("invalid queue metadata")
    }
    // Chunk-driven heartbeat: touch() only fires when SessionPrompt actually
    // makes progress (message.part.delta / message.part.updated). Replaces
    // the old unconditional setInterval(touch, 15s) which kept time_updated
    // fresh even while the upstream LLM stream was dead — defeating the
    // recover() inactivity check. GlobalBus subscription covers worktree
    // Instances too (session lives in one, executor in another).
    const handler = (msg: { payload: any }) => {
      const event = msg.payload
      if (!event || typeof event.type !== "string") return
      if (event.type !== Message.Event.PartDelta.type && event.type !== Message.Event.PartUpdated.type) return
      const props = event.properties ?? {}
      const sid =
        (typeof props.sessionID === "string" && props.sessionID) ||
        (typeof props.part === "object" &&
          props.part &&
          typeof props.part.sessionID === "string" &&
          props.part.sessionID) ||
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
    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      GlobalBus.off("event", handler)
    }
    inFlight.cleanup = cleanup
    assertInFlightNotCancelled(task, inFlight)
    try {
      if (metadata.data.kind === "session_prompt") {
        await executePrompt(
          {
            sessionID: task.session_id,
            prompt: metadata.data.input,
            source: "task-queue-service",
          },
          {
            beforeLoop: () => assertInFlightNotCancelled(task, inFlight),
          },
        )
      } else if (metadata.data.kind === "session_wake") {
        await executeSessionWake(task.session_id, {
          beforeLoop: () => assertInFlightNotCancelled(task, inFlight),
        })
      } else {
        await executeCompaction(
          {
            sessionID: task.session_id,
            ...StoredCompactionInput.parse(metadata.data.input),
          },
          {
            beforeLoop: () => assertInFlightNotCancelled(task, inFlight),
          },
        )
      }
    } finally {
      cleanup()
    }
    assertInFlightNotCancelled(task, inFlight)
    const now = Date.now()
    const completed = Database.use((db) =>
      db
        .update(TaskQueueTable)
        .set({
          status: "completed",
          time_completed: now,
          error_message: null,
          time_updated: now,
        })
        .where(and(eq(TaskQueueTable.id, task.id), eq(TaskQueueTable.status, "running")))
        .returning({ id: TaskQueueTable.id })
        .get(),
    )
    if (!completed) {
      log.info("task finished after queue row was no longer running", { id: task.id, sessionID: task.session_id })
      requestDrain("task finished after queue row changed")
      return
    }
    clearRecoveryTimer(task.id)
    log.info("task completed", { id: task.id, sessionID: task.session_id })
    publishTaskQueueCompleted(task.id, task.session_id)
    requestDrain("task completed")
  }

  async function executeSessionWake(sessionID: string, hooks?: { beforeLoop?: () => void | Promise<void> }) {
    const session = await Session.get(sessionID)
    return SessionContext.provide(session, () =>
      Instance.provide({
        directory: session.directory,
        fn: async () => {
          const beforeLoop = hooks?.beforeLoop?.()
          if (beforeLoop) await beforeLoop
          return SessionPrompt.loop({ sessionID })
        },
      }),
    )
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
    if (stale.length === 0) return 0
    let recovered = 0
    for (const task of stale) {
      const session = await Session.get(task.session_id)
      const promptCancelled = cancelSessionPromptInScope({
        session,
        handle: "TaskQueueService.recover",
      })
      if (promptCancelled) {
        await awaitSessionPromptFinishedInScope({
          session,
          handle: "TaskQueueService.recover",
        })
      }
      const failed = Database.use((db) =>
        db
          .update(TaskQueueTable)
          .set({
            status: "failed",
            time_started: null,
            time_completed: now,
            error_message: "task timed out while running",
            time_updated: now,
          })
          .where(and(eq(TaskQueueTable.id, task.id), eq(TaskQueueTable.status, "running")))
          .returning({ id: TaskQueueTable.id })
          .get(),
      )
      if (!failed) continue
      recovered += 1
      clearRecoveryTimer(task.id)
      log.warn("marked stale running task failed after inactivity", {
        id: task.id,
        sessionID: task.session_id,
      })
      log.warn("cancelled stale running session prompt after inactivity", {
        id: task.id,
        sessionID: task.session_id,
        promptCancelled,
      })
      const inFlight = state().inFlight.get(task.id)
      if (inFlight) {
        inFlight.cleanup()
        state().inFlight.delete(task.id)
      }
      publishTerminalTaskError(task.session_id, "task timed out while running")
    }
    return recovered
  }

  function fail(task: QueueTaskRow, error: unknown) {
    const now = Date.now()
    const failed = Database.use((db) =>
      db
        .update(TaskQueueTable)
        .set({
          status: "failed",
          time_started: null,
          time_completed: now,
          error_message: message(error),
          time_updated: now,
        })
        .where(and(eq(TaskQueueTable.id, task.id), eq(TaskQueueTable.status, "running")))
        .returning({ id: TaskQueueTable.id })
        .get(),
    )
    if (!failed) {
      log.info("task failed after queue row was no longer running", {
        id: task.id,
        sessionID: task.session_id,
        error: message(error),
      })
      requestDrain("task failed after queue row changed")
      return
    }
    clearRecoveryTimer(task.id)
    log.error("task failed", {
      id: task.id,
      sessionID: task.session_id,
      error: message(error),
    })
    publishTerminalTaskError(task.session_id, message(error))
    requestDrain("task failed")
  }

  function publishTerminalTaskError(sessionID: string, text: string) {
    void Bus.publish(Session.Event.Error, {
      sessionID,
      orderKey: sessionLifecycleOrderKey(sessionID),
      error: new NamedError.Unknown({ message: text }).toObject(),
    }).catch((error) => {
      log.warn("terminal task error publish failed", {
        sessionID,
        error: message(error),
      })
    })
  }

  function publishTaskQueueCompleted(queueTaskID: string, sessionID: string) {
    void Bus.publish(TaskQueueEvent.Completed, { queueTaskID, sessionID }).catch((error) => {
      log.warn("task queue completed publish failed", {
        queueTaskID,
        sessionID,
        error: message(error),
      })
    })
  }

  function touch(id: string) {
    const updated = Database.use((db) =>
      db
        .update(TaskQueueTable)
        .set({
          time_updated: Date.now(),
        })
        .where(and(eq(TaskQueueTable.id, id), eq(TaskQueueTable.status, "running")))
        .returning()
        .get(),
    )
    if (updated) scheduleRunningRecoveryTimer(updated, "progress")
  }

  function scheduleRunningRecoveryTimers(reason: string) {
    const rows = Database.use((db) =>
      db
        .select()
        .from(TaskQueueTable)
        .where(
          sql`${TaskQueueTable.status} = 'running'
            AND ${TaskQueueTable.session_id} IN (
              SELECT ${SessionTable.id}
              FROM ${SessionTable}
              WHERE ${SessionTable.project_id} = ${Instance.project.id}
            )`,
        )
        .all(),
    )
    for (const row of rows) scheduleRunningRecoveryTimer(row, reason)
  }

  function scheduleRunningRecoveryTimer(task: QueueTaskRow, reason: string) {
    const current = state()
    const token = current.recoveryTimerSequence + 1
    current.recoveryTimerSequence = token
    current.recoveryTimerTokens.set(task.id, token)
    const existing = current.recoveryTimers.get(task.id)
    if (existing) {
      clearTimeout(existing)
      current.recoveryTimers.delete(task.id)
    }
    void (async () => {
      const timeout = await runTimeout()
      if (state().recoveryTimerTokens.get(task.id) !== token) return
      const anchor = task.time_updated ?? task.time_started ?? Date.now()
      const delay = Math.max(0, anchor + timeout - Date.now())
      const timer = setTimeout(() => {
        const latest = state()
        if (latest.recoveryTimerTokens.get(task.id) !== token) return
        latest.recoveryTimers.delete(task.id)
        latest.recoveryTimerTokens.delete(task.id)
        void recover(Date.now())
          .then((recovered) => {
            if (recovered > 0) requestDrain("task inactivity timeout")
            scheduleRunningRecoveryTimers(
              recovered > 0
                ? "task inactivity timeout recovered running rows"
                : "task inactivity timeout not yet stale",
            )
          })
          .catch((error) => {
            log.error("task inactivity recovery failed", {
              id: task.id,
              reason,
              error: message(error),
            })
            publishTerminalTaskError(task.session_id, `task inactivity recovery failed: ${message(error)}`)
            scheduleRunningRecoveryRetry(task, "task inactivity recovery failed")
          })
      }, delay)
      timer.unref()
      const latest = state()
      if (latest.recoveryTimerTokens.get(task.id) !== token) {
        clearTimeout(timer)
        return
      }
      latest.recoveryTimers.set(task.id, timer)
    })().catch((error) => {
      log.error("task inactivity timer scheduling failed", {
        id: task.id,
        reason,
        error: message(error),
      })
    })
  }

  function scheduleRunningRecoveryRetry(task: QueueTaskRow, reason: string) {
    const retryAnchor = Date.now()
    scheduleRunningRecoveryTimer(
      { ...task, time_updated: retryAnchor, time_started: task.time_started ?? retryAnchor },
      reason,
    )
  }

  function clearRecoveryTimer(taskID: string) {
    const current = state()
    const timer = current.recoveryTimers.get(taskID)
    if (timer) clearTimeout(timer)
    current.recoveryTimers.delete(taskID)
    current.recoveryTimerTokens.delete(taskID)
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

function applyStoredSessionPromptIdentity<T extends z.infer<ReturnType<typeof promptSchema>>>(
  sessionID: string,
  prompt: T,
): T {
  const row = Database.use((db) =>
    db.select({ kind: SessionTable.kind }).from(SessionTable).where(eq(SessionTable.id, sessionID)).get(),
  )
  if (!row) return prompt
  return SessionAgentIdentity.applyToPrompt(row.kind, prompt)
}

function stampTaskQueueWakeReason<T extends z.infer<ReturnType<typeof promptSchema>>>(
  prompt: T,
  reason: { queueTaskID?: string; queueSource?: string },
): T {
  const existing = SessionWake.WakeReason.safeParse(prompt.extra?.wake_reason)
  if (existing.success && existing.data.source === "scheduler.task_queue") return prompt
  return {
    ...prompt,
    extra: {
      ...(prompt.extra ?? {}),
      ...SessionWake.reasonExtra({
        source: "scheduler.task_queue",
        ...reason,
      }),
    },
  }
}

async function compactionSource(sessionID: string, sourceUserMessageID: string): Promise<Message.User> {
  const source = (await Session.messages({ sessionID })).find(
    (message) => message.info.id === sourceUserMessageID,
  )?.info
  if (!source) throw new Error(`Compaction source message not found: ${sourceUserMessageID}`)
  if (source.role !== "user") {
    throw new Error(`Compaction source message ${sourceUserMessageID} is ${source.role}, not user`)
  }
  return source
}

function compactionPrompt(input: z.infer<typeof StoredCompactionInput>) {
  const kind = input.auto ? "automatic compaction" : "manual summarize"
  return input.focus ? `${kind}: ${input.focus}` : kind
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
