import { Database, NotFoundError, and, eq, isNull, or, sql } from "@/storage/db"
import { CronJobTable } from "./cron.sql"
import { Cron } from "./cron"
import { Scheduler } from "./index"
import { SessionWake } from "@/session"
import { SessionTable } from "@/session/session.sql"
import { EngineTaskTable } from "@/engine/engine.sql"
import { Log } from "@/util/log"
import { Instance, lazyInstanceState } from "@/project/instance"
import { Identifier } from "@/id/id"
import { Bus } from "@/bus"
import { Message } from "@/session/message"
import { taskIDForSession } from "@/orchestrator/task-event"

export type CronJobView = {
  id: string
  name: string
  expression: string
  prompt: string
  taskId: string | null
  enabled: boolean
  oneShot: boolean
  lastRun: number | null
  nextRun: number
  failureCount: number
  lastError: string | null
}

export type CreateCronJobInput = {
  name: string
  expression: string
  prompt: string
  projectId: string
  sessionId?: string
  oneShot?: boolean
}

export type CreateDelayedSessionWakeInput = {
  name: string
  prompt: string
  projectId: string
  sessionId: string
  durationMs: number
}

export type CreateTaskCronWakeInput = {
  name: string
  reason: string
  projectId: string
  taskId: string
  durationMs: number
}

export type ConsumedCronWaits = {
  jobIDs: string[]
}

/**
 * CronService polls due cron jobs and executes them with lease-based claims.
 *
 * Guarantees:
 * - only jobs in the current project are processed
 * - one poll run at a time per instance
 * - job state is committed after successful wake (no one-shot loss on failure)
 * - failed jobs are retried with bounded exponential backoff
 */
export namespace CronService {
  const log = Log.create({ service: "cron-service" })

  const POLL_INTERVAL_MS = 1_000
  const LEASE_MS = 2 * 60 * 1000
  const LEASE_RENEW_MS = 30 * 1000
  const MAX_BACKOFF_MS = 5 * 60 * 1000
  const CONCURRENCY_ENV = "OPENCORVUS_CRON_CONCURRENCY"
  const CONCURRENCY_DEFAULT = 4
  const CONCURRENCY_MAX = 32

  const state = lazyInstanceState(
    () => ({
      running: false,
      activityUnsubscribers: [] as Array<() => void>,
    }),
    async (entry) => {
      for (const unsubscribe of entry.activityUnsubscribers.splice(0)) unsubscribe()
    },
  )

  export function init() {
    Scheduler.register({
      id: "cron-service.poll",
      interval: POLL_INTERVAL_MS,
      run: poll,
      scope: "instance",
    })
    installActivitySubscriptions()
    log.info("cron service initialized")
  }

  export async function runNow() {
    await poll()
  }

  export function list(projectID: string): CronJobView[] {
    const rows = Database.use((db) =>
      db.select().from(CronJobTable).where(eq(CronJobTable.project_id, projectID)).all(),
    )
    return rows.map((j) => ({
      id: j.id,
      name: j.name,
      expression: j.expression,
      prompt: j.prompt,
      taskId: j.task_id ?? null,
      enabled: j.enabled,
      oneShot: j.one_shot,
      lastRun: j.last_run,
      nextRun: j.next_run,
      failureCount: j.failure_count,
      lastError: j.last_error ?? null,
    }))
  }

  function assertSessionInProject(input: { sessionId?: string; projectId: string }) {
    const sessionId = input.sessionId
    if (!sessionId) return
    const session = Database.use((db) =>
      db
        .select({ id: SessionTable.id })
        .from(SessionTable)
        .where(and(eq(SessionTable.id, sessionId), eq(SessionTable.project_id, input.projectId)))
        .get(),
    )
    if (!session) throw new NotFoundError({ message: `Session not found: ${sessionId}` })
  }

  function assertTaskInProject(input: { taskId: string; projectId: string }) {
    const task = Database.use((db) =>
      db
        .select({ id: EngineTaskTable.id })
        .from(EngineTaskTable)
        .where(and(eq(EngineTaskTable.id, input.taskId), eq(EngineTaskTable.project_id, input.projectId)))
        .get(),
    )
    if (!task) throw new NotFoundError({ message: `Task not found: ${input.taskId}` })
  }

  export function create(input: CreateCronJobInput): { id: string; name: string; nextRun: number } {
    const parsed = Cron.parse(input.expression)
    assertSessionInProject({ sessionId: input.sessionId, projectId: input.projectId })
    const now = Date.now()
    const nextRun = Cron.nextRun(parsed, now)
    const id = Identifier.ascending("cron")
    const oneShot = input.oneShot ?? parsed.type === "interval"
    Database.use((db) =>
      db
        .insert(CronJobTable)
        .values({
          id,
          project_id: input.projectId,
          session_id: input.sessionId,
          name: input.name,
          expression: input.expression,
          prompt: input.prompt,
          enabled: true,
          one_shot: oneShot,
          next_run: nextRun,
        })
        .run(),
    )
    return { id, name: input.name, nextRun }
  }

  export function createDelayedSessionWake(input: CreateDelayedSessionWakeInput): {
    id: string
    name: string
    nextRun: number
  } {
    assertSessionInProject({ sessionId: input.sessionId, projectId: input.projectId })
    assertDuration(input.durationMs)
    const now = Date.now()
    const nextRun = now + input.durationMs
    const id = Identifier.ascending("cron")
    Database.use((db) =>
      db
        .insert(CronJobTable)
        .values({
          id,
          project_id: input.projectId,
          session_id: input.sessionId,
          name: input.name,
          expression: delayExpression(input.durationMs),
          prompt: input.prompt,
          enabled: true,
          one_shot: true,
          next_run: nextRun,
        })
        .run(),
    )
    return { id, name: input.name, nextRun }
  }

  export function createTaskWake(input: CreateTaskCronWakeInput): { id: string; name: string; nextRun: number } {
    assertTaskInProject({ taskId: input.taskId, projectId: input.projectId })
    assertDuration(input.durationMs)
    const now = Date.now()
    const nextRun = now + input.durationMs
    const id = Identifier.ascending("cron")
    Database.use((db) =>
      db
        .insert(CronJobTable)
        .values({
          id,
          project_id: input.projectId,
          task_id: input.taskId,
          name: input.name,
          expression: delayExpression(input.durationMs),
          prompt: input.reason,
          enabled: true,
          one_shot: true,
          next_run: nextRun,
        })
        .run(),
    )
    return { id, name: input.name, nextRun }
  }

  export function remove(id: string, projectID: string): boolean {
    const row = Database.use((db) =>
      db
        .delete(CronJobTable)
        .where(and(eq(CronJobTable.id, id), eq(CronJobTable.project_id, projectID)))
        .returning({ id: CronJobTable.id })
        .get(),
    )
    return !!row
  }

  export function consumePendingTaskWaits(input: {
    taskId: string
    projectId: string
    reason: string
    now?: number
  }): ConsumedCronWaits {
    const now = input.now ?? Date.now()
    const rows = Database.use((db) =>
      db
        .delete(CronJobTable)
        .where(
          and(
            eq(CronJobTable.project_id, input.projectId),
            eq(CronJobTable.task_id, input.taskId),
            eq(CronJobTable.enabled, true),
            eq(CronJobTable.one_shot, true),
            or(isNull(CronJobTable.lease_owner), sql`${CronJobTable.lease_until} <= ${now}`),
          ),
        )
        .returning({ id: CronJobTable.id })
        .all(),
    )
    const jobIDs = rows.map((row) => row.id)
    if (jobIDs.length > 0) {
      log.info("pending task wait cron consumed", {
        taskID: input.taskId,
        projectID: input.projectId,
        jobIDs,
        reason: input.reason,
      })
    }
    return { jobIDs }
  }

  export function consumePendingSessionWaits(input: {
    sessionId: string
    projectId: string
    reason: string
    now?: number
  }): ConsumedCronWaits {
    const now = input.now ?? Date.now()
    const rows = Database.use((db) =>
      db
        .delete(CronJobTable)
        .where(
          and(
            eq(CronJobTable.project_id, input.projectId),
            eq(CronJobTable.session_id, input.sessionId),
            isNull(CronJobTable.task_id),
            eq(CronJobTable.name, "session wait"),
            eq(CronJobTable.enabled, true),
            eq(CronJobTable.one_shot, true),
            or(isNull(CronJobTable.lease_owner), sql`${CronJobTable.lease_until} <= ${now}`),
          ),
        )
        .returning({ id: CronJobTable.id })
        .all(),
    )
    const jobIDs = rows.map((row) => row.id)
    if (jobIDs.length > 0) {
      log.info("pending session wait cron consumed", {
        sessionID: input.sessionId,
        projectID: input.projectId,
        jobIDs,
        reason: input.reason,
      })
    }
    return { jobIDs }
  }

  export async function triggerTaskWaitFromActivity(input: {
    taskId: string
    projectId: string
    source: string
    detail: string
  }): Promise<ConsumedCronWaits & { dispatchResult?: string }> {
    const consumed = consumePendingTaskWaits({
      taskId: input.taskId,
      projectId: input.projectId,
      reason: `${input.source}: ${input.detail}`,
    })
    if (consumed.jobIDs.length === 0) return consumed
    const { dispatchTaskLoop } = await import("@/engine/queue")
    const dispatchResult = await dispatchTaskLoop({
      taskID: input.taskId,
      event: {
        note: renderTaskWaitEarlyActivityNote({
          source: input.source,
          detail: input.detail,
          jobIDs: consumed.jobIDs,
        }),
      },
    })
    log.info("pending task wait cron triggered early from activity", {
      taskID: input.taskId,
      projectID: input.projectId,
      source: input.source,
      jobIDs: consumed.jobIDs,
      dispatchResult,
    })
    return { ...consumed, dispatchResult }
  }

  async function poll(): Promise<void> {
    const s = state()
    if (s.running) {
      log.info("poll skipped while previous run is still active")
      return
    }
    s.running = true
    await run(Date.now()).finally(() => {
      s.running = false
    })
  }

  function installActivitySubscriptions() {
    const s = state()
    if (s.activityUnsubscribers.length > 0) return
    s.activityUnsubscribers.push(
      Bus.subscribe(Message.Event.Created, (event) => handleMessageCreated(event.properties.info)),
      Bus.subscribe(Message.Event.PartUpdated, (event) => handlePartUpdated(event.properties.part)),
    )
  }

  async function handleMessageCreated(info: Message.VisibleInfo): Promise<void> {
    if (info.role !== "user") return
    if (isSchedulerWakeMessage(info)) return
    consumePendingSessionWaits({
      sessionId: info.sessionID,
      projectId: Instance.project.id,
      reason: "user message created before scheduled wait due time",
    })
    if (isTaskOperatorMessage(info)) return
    const taskID = taskIDForSession(info.sessionID)
    if (!taskID) return
    await triggerTaskWaitFromActivity({
      taskId: taskID,
      projectId: Instance.project.id,
      source: "message.created",
      detail: `user message ${info.id} created in session ${info.sessionID}`,
    })
  }

  async function handlePartUpdated(part: Message.Part): Promise<void> {
    if (part.type !== "tool") return
    if (part.tool === "wait") return
    if (part.state.status !== "completed" && part.state.status !== "error") return
    const taskID = taskIDForSession(part.sessionID)
    if (!taskID) return
    await triggerTaskWaitFromActivity({
      taskId: taskID,
      projectId: Instance.project.id,
      source: "message.part.updated",
      detail: `terminal ${part.tool} tool result ${part.id} arrived in session ${part.sessionID}`,
    })
  }

  function isSchedulerWakeMessage(info: Message.User): boolean {
    const reason = info.extra?.wake_reason
    if (!reason || typeof reason !== "object" || Array.isArray(reason)) return false
    const source = (reason as Record<string, unknown>).source
    return typeof source === "string" && source.startsWith("scheduler.")
  }

  function isTaskOperatorMessage(info: Message.User): boolean {
    const operatorMessage = info.extra?.operator_message
    return !!operatorMessage && typeof operatorMessage === "object" && !Array.isArray(operatorMessage)
  }

  async function run(now: number): Promise<void> {
    const projectID = Instance.project.id
    const owner = `${process.pid}:${projectID}:${now}`
    const due = Database.use((db) =>
      db
        .select({ id: CronJobTable.id })
        .from(CronJobTable)
        .where(
          sql`${CronJobTable.project_id} = ${projectID}
            AND ${CronJobTable.enabled} = 1
            AND ${CronJobTable.next_run} <= ${now}
            AND (${CronJobTable.lease_until} <= ${now} OR ${CronJobTable.lease_until} IS NULL)`,
        )
        .orderBy(CronJobTable.next_run, CronJobTable.id)
        .all(),
    )

    if (due.length === 0) return
    log.info("found due cron jobs", { count: due.length, projectID })

    const slots = Math.min(concurrency(), due.length)
    let offset = 0
    const pick = () => {
      const row = due[offset]
      offset += 1
      return row
    }

    await Promise.all(
      Array.from({ length: slots }, async () => {
        while (true) {
          const row = pick()
          if (!row) return
          const job = claim(row.id, projectID, owner, now)
          if (!job) continue
          await execute(job, owner, now).catch(async (err) => {
            await fail(job, owner, err)
          })
        }
      }),
    )
  }

  function concurrency() {
    const raw = process.env[CONCURRENCY_ENV]
    if (!raw) return CONCURRENCY_DEFAULT
    const value = Number(raw)
    if (!Number.isFinite(value)) return CONCURRENCY_DEFAULT
    if (value < 1) return 1
    return Math.min(Math.floor(value), CONCURRENCY_MAX)
  }

  function claim(id: string, projectID: string, owner: string, now: number) {
    Database.use((db) =>
      db
        .update(CronJobTable)
        .set({
          lease_until: now + LEASE_MS,
          lease_owner: owner,
        })
        .where(
          sql`${CronJobTable.id} = ${id}
            AND ${CronJobTable.project_id} = ${projectID}
            AND ${CronJobTable.enabled} = 1
            AND ${CronJobTable.next_run} <= ${now}
            AND (${CronJobTable.lease_until} <= ${now} OR ${CronJobTable.lease_until} IS NULL)`,
        )
        .run(),
    )

    return Database.use((db) =>
      db
        .select()
        .from(CronJobTable)
        .where(
          and(eq(CronJobTable.id, id), eq(CronJobTable.project_id, projectID), eq(CronJobTable.lease_owner, owner)),
        )
        .get(),
    )
  }

  async function execute(job: typeof CronJobTable.$inferSelect, owner: string, now: number): Promise<void> {
    const fireID = Identifier.ascending("call")
    log.info("executing cron job", { jobId: job.id, fireID, name: job.name, prompt: job.prompt.slice(0, 100) })

    const timer = setInterval(() => {
      try {
        renew(job.id, owner)
      } catch (error) {
        log.warn("cron lease renew failed", {
          jobId: job.id,
          name: job.name,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }, LEASE_RENEW_MS)
    timer.unref()

    const outcome = await executeJobWake(job, fireID).finally(() => {
      clearInterval(timer)
    })
    const committedAt = Date.now()

    if (job.one_shot || job.task_id) {
      Database.use((db) =>
        db
          .update(CronJobTable)
          .set({
            last_run: committedAt,
            enabled: false,
            failure_count: 0,
            last_error: null,
            lease_until: 0,
            lease_owner: null,
          })
          .where(and(eq(CronJobTable.id, job.id), eq(CronJobTable.lease_owner, owner)))
          .run(),
      )
      log.info("cron job triggered session wake", {
        jobId: job.id,
        fireID,
        name: job.name,
        ...outcome,
        nextRun: "disabled",
      })
      return
    }

    const parsed = Cron.parse(job.expression)
    const nextRun = Cron.nextRun(parsed, committedAt)
    Database.use((db) =>
      db
        .update(CronJobTable)
        .set({
          last_run: committedAt,
          next_run: nextRun,
          failure_count: 0,
          last_error: null,
          lease_until: 0,
          lease_owner: null,
        })
        .where(and(eq(CronJobTable.id, job.id), eq(CronJobTable.lease_owner, owner)))
        .run(),
    )
    log.info("cron job triggered session wake", {
      jobId: job.id,
      fireID,
      name: job.name,
      ...outcome,
      nextRun: new Date(nextRun).toISOString(),
    })
  }

  async function executeJobWake(
    job: typeof CronJobTable.$inferSelect,
    fireID: string,
  ): Promise<{ sessionID?: string; taskID?: string; dispatchResult?: string }> {
    if (job.task_id) {
      const { dispatchTaskLoop } = await import("@/engine/queue")
      const dispatchResult = await dispatchTaskLoop({
        taskID: job.task_id,
        event: {
          note: renderTaskWaitWakeNote(job, fireID),
        },
      })
      return { taskID: job.task_id, dispatchResult }
    }

    const sessionID = await SessionWake.wake({
      sessionID: job.session_id ?? undefined,
      prompt: job.prompt,
      agent: job.agent === "default" ? undefined : job.agent,
      reason: {
        source: "scheduler.cron",
        jobID: job.id,
        jobName: job.name,
        fireID,
        expression: job.expression,
        oneShot: job.one_shot,
      },
    })
    return { sessionID }
  }

  function renew(id: string, owner: string) {
    Database.use((db) =>
      db
        .update(CronJobTable)
        .set({
          lease_until: Date.now() + LEASE_MS,
        })
        .where(and(eq(CronJobTable.id, id), eq(CronJobTable.lease_owner, owner)))
        .run(),
    )
  }

  async function fail(job: typeof CronJobTable.$inferSelect, owner: string, err: unknown): Promise<void> {
    const now = Date.now()
    const step = job.failure_count + 1
    const wait = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(step, 30))
    const nextRun = Math.max(job.next_run, now + wait)
    const msg = err instanceof Error ? err.message : String(err)

    Database.use((db) =>
      db
        .update(CronJobTable)
        .set({
          failure_count: sql`${CronJobTable.failure_count} + 1`,
          last_error: msg,
          next_run: nextRun,
          lease_until: 0,
          lease_owner: null,
        })
        .where(and(eq(CronJobTable.id, job.id), eq(CronJobTable.lease_owner, owner)))
        .run(),
    )

    log.error("cron job execution failed", {
      jobId: job.id,
      name: job.name,
      error: msg,
      retryAt: new Date(nextRun).toISOString(),
    })
  }

  function assertDuration(durationMs: number) {
    if (!Number.isInteger(durationMs) || durationMs <= 0) {
      throw new Error(`Invalid delay duration: ${durationMs}`)
    }
  }

  function delayExpression(durationMs: number) {
    return `delay:${durationMs}ms`
  }

  function renderTaskWaitWakeNote(job: typeof CronJobTable.$inferSelect, fireID: string) {
    return [
      "This is a scheduled task wait wake, not a user-authored message.",
      `wait_job_id=${job.id}`,
      `fire_id=${fireID}`,
      `scheduled_delay=${job.expression}`,
      `due_at=${new Date(job.next_run).toISOString()}`,
      `Reason: ${job.prompt}`,
      "Read the current task snapshot and decide the next workflow action from present evidence.",
    ].join("\n")
  }

  function renderTaskWaitEarlyActivityNote(input: { source: string; detail: string; jobIDs: string[] }) {
    return [
      "This is an early task wait wake triggered by new task/session activity, not a user-authored message.",
      "The pending scheduled task wait was cancelled by newer task/session activity.",
      `activity_source=${input.source}`,
      `activity_detail=${input.detail}`,
      `wait_job_ids=${input.jobIDs.join(",")}`,
      "Read the current task snapshot and decide the next workflow action from present evidence.",
    ].join("\n")
  }
}
