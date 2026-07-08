import z from "zod"
import { Tool } from "./tool"
import { Cron } from "@/scheduler/cron"
import { CronService } from "@/scheduler/cron-service"
import { EventService } from "@/scheduler/event-service"
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
      oneShot: z.boolean().default(false).describe("Execute only once"),
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

        const oneShot = params.oneShot ?? parsed.type === "interval"
        const job = await CronService.create({
          projectId: projectID,
          name: params.name,
          expression: params.schedule,
          prompt: params.prompt,
          oneShot,
        })

        return {
          title: `Scheduled: ${params.name}`,
          output: JSON.stringify({
            jobId: job.id,
            name: params.name,
            schedule: params.schedule,
            description: Cron.describe(parsed),
            oneShot,
            nextRun: new Date(job.nextRun).toISOString(),
          }),
          metadata: {},
        }
      }

      case "list": {
        const jobs = CronService.list(projectID)
        return {
          title: `${jobs.length} scheduled tasks`,
          output: JSON.stringify({
            jobs: jobs.map((j) => ({
              id: j.id,
              name: j.name,
              schedule: j.expression,
              prompt: j.prompt.slice(0, 200),
              enabled: j.enabled,
              oneShot: j.oneShot,
              lastRun: j.lastRun ? new Date(j.lastRun).toISOString() : null,
              nextRun: new Date(j.nextRun).toISOString(),
              failureCount: j.failureCount,
              lastError: j.lastError,
            })),
          }),
          metadata: {},
        }
      }

      case "cancel": {
        const job = CronService.list(projectID).find((entry) => entry.id === params.jobId)
        if (!job) {
          return {
            title: "Not found",
            output: JSON.stringify({ error: `Scheduled task ${params.jobId} not found` }),
            metadata: {},
          }
        }

        CronService.remove(params.jobId, projectID)
        return {
          title: `Cancelled: ${job.name}`,
          output: JSON.stringify({ cancelled: true, jobId: params.jobId, name: job.name }),
          metadata: {},
        }
      }

      case "create_event": {
        const cooldownMs = params.cooldownMs ?? 0
        const oneShot = params.oneShot
        const job = await EventService.create({
          projectId: projectID,
          name: params.name,
          eventType: params.eventType,
          prompt: params.prompt,
          match: params.match,
          oneShot,
          cooldownMs,
        })

        return {
          title: `Event task created: ${params.name}`,
          output: JSON.stringify({
            jobId: job.id,
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
        const jobs = EventService.list(projectID)
        return {
          title: `${jobs.length} event tasks`,
          output: JSON.stringify({
            jobs: jobs.map((j) => ({
              id: j.id,
              name: j.name,
              eventType: j.eventType,
              match: j.match,
              prompt: j.prompt.slice(0, 200),
              enabled: j.enabled,
              oneShot: j.oneShot,
              cooldownMs: j.cooldownMs,
              lastRun: j.lastRun ? new Date(j.lastRun).toISOString() : null,
              lastEvent: j.lastEvent ?? null,
            })),
          }),
          metadata: {},
        }
      }

      case "cancel_event": {
        const job = EventService.list(projectID).find((entry) => entry.id === params.jobId)
        if (!job) {
          return {
            title: "Not found",
            output: JSON.stringify({ error: `Event task ${params.jobId} not found` }),
            metadata: {},
          }
        }

        EventService.remove(params.jobId, projectID)
        return {
          title: `Cancelled event task: ${job.name}`,
          output: JSON.stringify({ cancelled: true, jobId: params.jobId, name: job.name }),
          metadata: {},
        }
      }
    }
  },
})
