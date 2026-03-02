import z from "zod"
import { Tool } from "./tool"
import { Database, and, eq } from "@/storage/db"
import { CronJobTable } from "@/scheduler/cron.sql"
import { EventJobTable } from "@/scheduler/event.sql"
import { Cron } from "@/scheduler/cron"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"

const MatchSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))

const DESCRIPTION = `Schedule or trigger future tasks that execute automatically.

Actions:
- **create**: Schedule a time-based task via cron ("0 9 * * *") or interval ("30m", "2h", "1d").
- **list**: List time-based tasks for this project.
- **cancel**: Cancel a time-based task by ID.
- **create_event**: Create an event-triggered task (Bus event wildcard + optional property match).
- **list_event**: List event-triggered tasks for this project.
- **cancel_event**: Cancel an event-triggered task by ID.`

export const ScheduleTool = Tool.define("schedule", {
  description: DESCRIPTION,
  parameters: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("create"),
      name: z.string().describe("Short name for the task"),
      schedule: z.string().describe("Cron expression ('0 9 * * *') or interval ('30m', '2h', '1d')"),
      prompt: z.string().describe("The instruction to execute when triggered"),
      oneShot: z.boolean().optional().describe("Execute once (default: true for intervals, false for cron)"),
    }),
    z.object({
      action: z.literal("list"),
    }),
    z.object({
      action: z.literal("cancel"),
      jobId: z.string().describe("The ID of the scheduled task to cancel"),
    }),
    z.object({
      action: z.literal("create_event"),
      name: z.string().describe("Short name for the event task"),
      eventType: z.string().describe("Bus event type wildcard (for example: 'command.*' or 'session.updated')"),
      prompt: z.string().describe("The instruction to execute when the event matches"),
      match: MatchSchema.optional().describe("Optional event property matcher, e.g. {'properties.name':'init'}"),
      oneShot: z.boolean().optional().describe("Execute only once (default: false)"),
      cooldownMs: z.number().int().min(0).optional().describe("Minimum ms between runs for this job"),
    }),
    z.object({
      action: z.literal("list_event"),
    }),
    z.object({
      action: z.literal("cancel_event"),
      jobId: z.string().describe("The ID of the event task to cancel"),
    }),
  ]),
  async execute(params, ctx) {
    const projectID = Instance.project.id
    await ctx.ask({
      permission: "schedule",
      patterns: ["*"],
      always: ["*"],
      metadata: { action: params.action },
    })

    switch (params.action) {
      case "create": {
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

        const oneShot = params.oneShot ?? (parsed.type === "interval")
        const now = Date.now()
        const nextRun = Cron.nextRun(parsed, now)
        const id = Identifier.ascending("cron")
        Database.use((db) =>
          db
            .insert(CronJobTable)
            .values({
              id,
              project_id: projectID,
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

        return {
          title: `Scheduled: ${params.name}`,
          output: JSON.stringify({
            jobId: id,
            name: params.name,
            schedule: params.schedule,
            description: Cron.describe(parsed),
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
            .where(eq(CronJobTable.project_id, projectID))
            .all(),
        )
        return {
          title: `${jobs.length} scheduled tasks`,
          output: JSON.stringify({
            jobs: jobs.map((j) => ({
              id: j.id,
              name: j.name,
              schedule: j.expression,
              prompt: j.prompt.slice(0, 200),
              enabled: j.enabled,
              oneShot: j.one_shot,
              lastRun: j.last_run ? new Date(j.last_run).toISOString() : null,
              nextRun: new Date(j.next_run).toISOString(),
              failureCount: j.failure_count,
              lastError: j.last_error,
            })),
          }),
          metadata: {},
        }
      }

      case "cancel": {
        const job = Database.use((db) =>
          db
            .select()
            .from(CronJobTable)
            .where(and(eq(CronJobTable.id, params.jobId), eq(CronJobTable.project_id, projectID)))
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
          db
            .delete(CronJobTable)
            .where(and(eq(CronJobTable.id, params.jobId), eq(CronJobTable.project_id, projectID)))
            .run(),
        )
        return {
          title: `Cancelled: ${job.name}`,
          output: JSON.stringify({ cancelled: true, jobId: params.jobId, name: job.name }),
          metadata: {},
        }
      }

      case "create_event": {
        const id = Identifier.ascending("cron")
        const cooldownMs = params.cooldownMs ?? 0
        const oneShot = params.oneShot ?? false

        Database.use((db) =>
          db
            .insert(EventJobTable)
            .values({
              id,
              project_id: projectID,
              name: params.name,
              event_type: params.eventType,
              match_json: params.match,
              prompt: params.prompt,
              agent: "default",
              enabled: true,
              one_shot: oneShot,
              cooldown_ms: cooldownMs,
            })
            .run(),
        )

        return {
          title: `Event task created: ${params.name}`,
          output: JSON.stringify({
            jobId: id,
            name: params.name,
            eventType: params.eventType,
            oneShot,
            cooldownMs,
            match: params.match ?? {},
          }),
          metadata: {},
        }
      }

      case "list_event": {
        const jobs = Database.use((db) =>
          db
            .select()
            .from(EventJobTable)
            .where(eq(EventJobTable.project_id, projectID))
            .all(),
        )
        return {
          title: `${jobs.length} event tasks`,
          output: JSON.stringify({
            jobs: jobs.map((j) => ({
              id: j.id,
              name: j.name,
              eventType: j.event_type,
              match: j.match_json ?? {},
              prompt: j.prompt.slice(0, 200),
              enabled: j.enabled,
              oneShot: j.one_shot,
              cooldownMs: j.cooldown_ms,
              lastRun: j.last_run ? new Date(j.last_run).toISOString() : null,
              lastEvent: j.last_event ?? null,
            })),
          }),
          metadata: {},
        }
      }

      case "cancel_event": {
        const job = Database.use((db) =>
          db
            .select()
            .from(EventJobTable)
            .where(and(eq(EventJobTable.id, params.jobId), eq(EventJobTable.project_id, projectID)))
            .get(),
        )
        if (!job) {
          return {
            title: "Not found",
            output: JSON.stringify({ error: `Event task ${params.jobId} not found` }),
            metadata: {},
          }
        }

        Database.use((db) =>
          db
            .delete(EventJobTable)
            .where(and(eq(EventJobTable.id, params.jobId), eq(EventJobTable.project_id, projectID)))
            .run(),
        )
        return {
          title: `Cancelled event task: ${job.name}`,
          output: JSON.stringify({ cancelled: true, jobId: params.jobId, name: job.name }),
          metadata: {},
        }
      }
    }
  },
})
