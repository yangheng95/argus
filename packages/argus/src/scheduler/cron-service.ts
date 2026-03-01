import { Database, eq, sql } from "@/storage/db"
import { CronJobTable } from "./cron.sql"
import { Cron } from "./cron"
import { Scheduler } from "./index"
import { SessionWake } from "@/session/wake"
import { Log } from "@/util/log"

/**
 * CronService — polls the cron_job table every 60s for due tasks.
 *
 * Uses the existing Scheduler.register() infrastructure. When a cron job
 * is due (next_run <= now), it:
 * 1. Updates last_run and computes the new next_run
 * 2. Disables one-shot jobs after execution
 * 3. Calls SessionWake.wake() to inject the prompt into a session
 */
export namespace CronService {
  const log = Log.create({ service: "cron-service" })

  const POLL_INTERVAL_MS = 60 * 1000 // 60 seconds

  export function init() {
    Scheduler.register({
      id: "cron-service.poll",
      interval: POLL_INTERVAL_MS,
      run: poll,
      scope: "instance",
    })
    log.info("cron service initialized")
  }

  /** Poll for due cron jobs and execute them. */
  async function poll(): Promise<void> {
    const now = Date.now()

    const dueJobs = Database.use((db) =>
      db
        .select()
        .from(CronJobTable)
        .where(sql`${CronJobTable.enabled} = 1 AND ${CronJobTable.next_run} <= ${now}`)
        .all(),
    )

    if (dueJobs.length === 0) return

    log.info("found due cron jobs", { count: dueJobs.length })

    for (const job of dueJobs) {
      try {
        await executeJob(job, now)
      } catch (err) {
        log.error("cron job execution failed", { jobId: job.id, name: job.name, err })
      }
    }
  }

  async function executeJob(
    job: typeof CronJobTable.$inferSelect,
    now: number,
  ): Promise<void> {
    log.info("executing cron job", { jobId: job.id, name: job.name, prompt: job.prompt.slice(0, 100) })

    // Parse expression to compute next run
    let newNextRun: number
    if (job.one_shot) {
      // One-shot: disable after execution
      Database.use((db) =>
        db
          .update(CronJobTable)
          .set({
            last_run: now,
            enabled: false,
          })
          .where(eq(CronJobTable.id, job.id))
          .run(),
      )
      newNextRun = 0
    } else {
      const parsed = Cron.parse(job.expression)
      newNextRun = Cron.nextRun(parsed, now)
      Database.use((db) =>
        db
          .update(CronJobTable)
          .set({
            last_run: now,
            next_run: newNextRun,
          })
          .where(eq(CronJobTable.id, job.id))
          .run(),
      )
    }

    // Wake the session with the prompt
    // Pass agent only if it's not "default" — SessionWake resolves the default agent
    const sessionID = await SessionWake.wake({
      sessionID: job.session_id ?? undefined,
      prompt: job.prompt,
      agent: job.agent === "default" ? undefined : job.agent,
    })

    log.info("cron job triggered session wake", {
      jobId: job.id,
      name: job.name,
      sessionID,
      nextRun: newNextRun > 0 ? new Date(newNextRun).toISOString() : "disabled",
    })
  }
}
