import { Database, and, eq, sql } from "@/storage/db"
import { CronJobTable } from "./cron.sql"
import { Cron } from "./cron"
import { Scheduler } from "./index"
import { SessionWake } from "@/session/wake"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"

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

  const POLL_INTERVAL_MS = 60 * 1000
  const LEASE_MS = 2 * 60 * 1000
  const LEASE_RENEW_MS = 30 * 1000
  const MAX_BACKOFF_MS = 5 * 60 * 1000
  const CONCURRENCY_ENV = "OPENCORVUS_CRON_CONCURRENCY"
  const CONCURRENCY_DEFAULT = 4
  const CONCURRENCY_MAX = 32

  const state = Instance.state(() => ({
    running: false,
  }))

  export function init() {
    Scheduler.register({
      id: "cron-service.poll",
      interval: POLL_INTERVAL_MS,
      run: poll,
      scope: "instance",
    })
    log.info("cron service initialized")
  }

  export async function runNow() {
    await poll()
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

    await Promise.all(Array.from({ length: slots }, async () => {
      while (true) {
        const row = pick()
        if (!row) return
        const job = claim(row.id, projectID, owner, now)
        if (!job) continue
        await execute(job, owner, now).catch(async (err) => {
          await fail(job, owner, err)
        })
      }
    }))
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
          and(
            eq(CronJobTable.id, id),
            eq(CronJobTable.project_id, projectID),
            eq(CronJobTable.lease_owner, owner),
          ),
        )
        .get(),
    )
  }

  async function execute(job: typeof CronJobTable.$inferSelect, owner: string, now: number): Promise<void> {
    log.info("executing cron job", { jobId: job.id, name: job.name, prompt: job.prompt.slice(0, 100) })

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

    const sessionID = await SessionWake.wake({
      sessionID: job.session_id ?? undefined,
      prompt: job.prompt,
      agent: job.agent === "default" ? undefined : job.agent,
    }).finally(() => {
      clearInterval(timer)
    })
    const committedAt = Date.now()

    if (job.one_shot) {
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
        name: job.name,
        sessionID,
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
      name: job.name,
      sessionID,
      nextRun: new Date(nextRun).toISOString(),
    })
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

  async function fail(
    job: typeof CronJobTable.$inferSelect,
    owner: string,
    err: unknown,
  ): Promise<void> {
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
}
