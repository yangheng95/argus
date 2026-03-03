import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { errors } from "../error"
import { Database, and, eq } from "../../storage/db"
import { CronJobTable } from "../../scheduler/cron.sql"
import { EventJobTable } from "../../scheduler/event.sql"
import { Cron } from "../../scheduler/cron"
import { Identifier } from "../../id/id"
import { TaskPlan } from "../../memory/task-plan"
import { Scratchpad } from "../../memory/scratchpad"

export function ExperimentalScheduleRoutes() {
  return new Hono()
    // --- Schedule API ---
    .get(
      "/schedule",
      describeRoute({
        summary: "List scheduled tasks",
        operationId: "experimental.schedule.list",
        responses: {
          200: {
            description: "Scheduled tasks",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      id: z.string(),
                      name: z.string(),
                      expression: z.string(),
                      prompt: z.string(),
                      enabled: z.boolean(),
                      oneShot: z.boolean(),
                      lastRun: z.number().nullable(),
                      nextRun: z.number(),
                      failureCount: z.number(),
                      lastError: z.string().nullable(),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      validator("query", z.object({ projectId: z.string() })),
      async (c) => {
        const { projectId } = c.req.valid("query")
        const jobs = Database.use((db) =>
          db.select().from(CronJobTable).where(eq(CronJobTable.project_id, projectId)).all(),
        )
        return c.json(
          jobs.map((j) => ({
            id: j.id,
            name: j.name,
            expression: j.expression,
            prompt: j.prompt,
            enabled: j.enabled,
            oneShot: j.one_shot,
            lastRun: j.last_run,
            nextRun: j.next_run,
            failureCount: j.failure_count,
            lastError: j.last_error ?? null,
          })),
        )
      },
    )
    .post(
      "/schedule",
      describeRoute({
        summary: "Create scheduled task",
        operationId: "experimental.schedule.create",
        responses: {
          200: {
            description: "Created task",
            content: {
              "application/json": {
                schema: resolver(z.object({ id: z.string(), name: z.string(), nextRun: z.number() })),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          name: z.string(),
          expression: z.string(),
          prompt: z.string(),
          projectId: z.string(),
          sessionId: z.string().optional(),
          oneShot: z.boolean().optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        const parsed = Cron.parse(body.expression)
        const now = Date.now()
        const nextRun = Cron.nextRun(parsed, now)
        const id = Identifier.ascending("cron")
        const oneShot = body.oneShot ?? (parsed.type === "interval")
        Database.use((db) =>
          db
            .insert(CronJobTable)
            .values({
              id,
              project_id: body.projectId,
              session_id: body.sessionId,
              name: body.name,
              expression: body.expression,
              prompt: body.prompt,
              enabled: true,
              one_shot: oneShot,
              next_run: nextRun,
            })
            .run(),
        )
        return c.json({ id, name: body.name, nextRun })
      },
    )
    .delete(
      "/schedule/:id",
      describeRoute({
        summary: "Cancel scheduled task",
        operationId: "experimental.schedule.delete",
        responses: {
          200: {
            description: "Cancelled",
            content: { "application/json": { schema: resolver(z.object({ ok: z.boolean() })) } },
          },
        },
      }),
      validator("query", z.object({ projectId: z.string() })),
      async (c) => {
        const { projectId } = c.req.valid("query")
        const id = c.req.param("id")
        Database.use((db) =>
          db
            .delete(CronJobTable)
            .where(and(eq(CronJobTable.id, id), eq(CronJobTable.project_id, projectId)))
            .run(),
        )
        return c.json({ ok: true })
      },
    )
    .get(
      "/event-schedule",
      describeRoute({
        summary: "List event-triggered tasks",
        operationId: "experimental.eventschedule.list",
        responses: {
          200: {
            description: "Event-triggered tasks",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      id: z.string(),
                      name: z.string(),
                      eventType: z.string(),
                      match: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
                      prompt: z.string(),
                      enabled: z.boolean(),
                      oneShot: z.boolean(),
                      cooldownMs: z.number(),
                      lastRun: z.number().nullable(),
                      lastEvent: z.string().nullable(),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      validator("query", z.object({ projectId: z.string() })),
      async (c) => {
        const { projectId } = c.req.valid("query")
        const jobs = Database.use((db) =>
          db.select().from(EventJobTable).where(eq(EventJobTable.project_id, projectId)).all(),
        )
        return c.json(
          jobs.map((j) => ({
            id: j.id,
            name: j.name,
            eventType: j.event_type,
            match: j.match_json ?? {},
            prompt: j.prompt,
            enabled: j.enabled,
            oneShot: j.one_shot,
            cooldownMs: j.cooldown_ms,
            lastRun: j.last_run,
            lastEvent: j.last_event ?? null,
          })),
        )
      },
    )
    .post(
      "/event-schedule",
      describeRoute({
        summary: "Create event-triggered task",
        operationId: "experimental.eventschedule.create",
        responses: {
          200: {
            description: "Created event task",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    id: z.string(),
                    name: z.string(),
                    eventType: z.string(),
                  }),
                ),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          name: z.string(),
          eventType: z.string(),
          match: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
          prompt: z.string(),
          projectId: z.string(),
          sessionId: z.string().optional(),
          oneShot: z.boolean().optional(),
          cooldownMs: z.number().int().min(0).optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        const id = Identifier.ascending("cron")
        Database.use((db) =>
          db
            .insert(EventJobTable)
            .values({
              id,
              project_id: body.projectId,
              session_id: body.sessionId,
              name: body.name,
              event_type: body.eventType,
              match_json: body.match,
              prompt: body.prompt,
              enabled: true,
              one_shot: body.oneShot ?? false,
              cooldown_ms: body.cooldownMs ?? 0,
            })
            .run(),
        )
        return c.json({ id, name: body.name, eventType: body.eventType })
      },
    )
    .delete(
      "/event-schedule/:id",
      describeRoute({
        summary: "Cancel event-triggered task",
        operationId: "experimental.eventschedule.delete",
        responses: {
          200: {
            description: "Cancelled",
            content: { "application/json": { schema: resolver(z.object({ ok: z.boolean() })) } },
          },
        },
      }),
      validator("query", z.object({ projectId: z.string() })),
      async (c) => {
        const { projectId } = c.req.valid("query")
        const id = c.req.param("id")
        Database.use((db) =>
          db
            .delete(EventJobTable)
            .where(and(eq(EventJobTable.id, id), eq(EventJobTable.project_id, projectId)))
            .run(),
        )
        return c.json({ ok: true })
      },
    )
    // --- Task Plan API ---
    .get(
      "/task-plan",
      describeRoute({
        summary: "List tasks for a session",
        operationId: "experimental.taskplan.list",
        responses: {
          200: {
            description: "Tasks",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      id: z.string(),
                      goal: z.string(),
                      status: z.string(),
                      parentID: z.string().nullable(),
                      progressPct: z.number(),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      validator("query", z.object({ sessionId: z.string() })),
      async (c) => {
        const { sessionId } = c.req.valid("query")
        const tasks = TaskPlan.list(sessionId)
        return c.json(tasks)
      },
    )
    // --- Scratchpad API ---
    .get(
      "/scratchpad",
      describeRoute({
        summary: "Get scratchpad content",
        operationId: "experimental.scratchpad.get",
        responses: {
          200: {
            description: "Scratchpad",
            content: { "application/json": { schema: resolver(z.object({ content: z.string() })) } },
          },
        },
      }),
      validator("query", z.object({ sessionId: z.string() })),
      async (c) => {
        const { sessionId } = c.req.valid("query")
        return c.json({ content: Scratchpad.get(sessionId) })
      },
    )
}
