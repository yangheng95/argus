import z from "zod"
import { Tool } from "./tool"
import { Database, eq, sql } from "@/storage/db"
import { CronJobTable } from "@/scheduler/cron.sql"
import { Cron } from "@/scheduler/cron"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"

/**
 * Schedule tool — create, list, and cancel scheduled tasks.
 *
 * The agent can use this to schedule future actions:
 * - One-shot timers: "30m" → execute once after 30 minutes
 * - Recurring cron: "0 9 * * *" → execute every day at 9am
 *
 * Scheduled tasks are persisted and survive server restarts.
 */
const DESCRIPTION = `Schedule future tasks that will execute automatically.

Actions:
- **create**: Schedule a new task. Supports cron expressions ("0 9 * * *") or simple intervals ("30m", "2h", "1d"). One-shot tasks execute once; recurring tasks repeat on schedule.
- **list**: View all scheduled tasks for this project.
- **cancel**: Cancel a scheduled task by ID.`

export const ScheduleTool = Tool.define("schedule", {
  description: DESCRIPTION,
  parameters: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("create"),
      name: z.string().describe("Short name for the task (e.g. 'check-build', 'daily-test')"),
      schedule: z.string().describe("Cron expression ('0 9 * * *') or interval ('30m', '2h', '1d')"),
      prompt: z.string().describe("The instruction to execute when triggered"),
      oneShot: z.boolean().optional().describe("Execute only once (default: true for intervals, false for cron)"),
    }),
    z.object({
      action: z.literal("list"),
    }),
    z.object({
      action: z.literal("cancel"),
      jobId: z.string().describe("The ID of the scheduled task to cancel"),
    }),
  ]),
  async execute(params, ctx) {
    const projectId = Instance.project.id

    await ctx.ask({
      permission: "schedule",
      patterns: ["*"],
      always: ["*"],
      metadata: { action: params.action },
    })

    switch (params.action) {
      case "create": {
        // Validate and parse the expression
        let parsed: Cron.Parsed
        try {
          parsed = Cron.parse(params.schedule)
        } catch (err) {
          return {
            title: "Invalid schedule",
            output: JSON.stringify({ error: `Invalid schedule expression: ${params.schedule}. ${err}` }),
            metadata: {},
          }
        }

        // Determine one_shot default: intervals are one-shot by default, cron is recurring
        const oneShot = params.oneShot ?? (parsed.type === "interval")

        const now = Date.now()
        const nextRun = Cron.nextRun(parsed, now)
        const id = Identifier.ascending("cron")

        Database.use((db) =>
          db
            .insert(CronJobTable)
            .values({
              id,
              project_id: projectId,
              name: params.name,
              expression: params.schedule,
              prompt: params.prompt,
              agent: "default",
              enabled: true,
              one_shot: oneShot,
              next_run: nextRun,
            })
            .run(),
        )

        const description = Cron.describe(parsed)
        return {
          title: `Scheduled: ${params.name}`,
          output: JSON.stringify({
            jobId: id,
            name: params.name,
            schedule: params.schedule,
            description,
            oneShot,
            nextRun: new Date(nextRun).toISOString(),
          }),
          metadata: {},
        }
      }

      case "list": {
        const jobs = Database.use((db) =>
          db
            .select()
            .from(CronJobTable)
            .where(eq(CronJobTable.project_id, projectId))
            .all(),
        )

        const formatted = jobs.map((j) => ({
          id: j.id,
          name: j.name,
          schedule: j.expression,
          prompt: j.prompt.slice(0, 200),
          enabled: j.enabled,
          oneShot: j.one_shot,
          lastRun: j.last_run ? new Date(j.last_run).toISOString() : null,
          nextRun: new Date(j.next_run).toISOString(),
        }))

        return {
          title: `${jobs.length} scheduled tasks`,
          output: JSON.stringify({ jobs: formatted }),
          metadata: {},
        }
      }

      case "cancel": {
        const job = Database.use((db) =>
          db
            .select()
            .from(CronJobTable)
            .where(eq(CronJobTable.id, params.jobId))
            .get(),
        )

        if (!job) {
          return {
            title: "Not found",
            output: JSON.stringify({ error: `Scheduled task ${params.jobId} not found` }),
            metadata: {},
          }
        }

        Database.use((db) =>
          db.delete(CronJobTable).where(eq(CronJobTable.id, params.jobId)).run(),
        )

        return {
          title: `Cancelled: ${job.name}`,
          output: JSON.stringify({ cancelled: true, jobId: params.jobId, name: job.name }),
          metadata: {},
        }
      }
    }
  },
})
