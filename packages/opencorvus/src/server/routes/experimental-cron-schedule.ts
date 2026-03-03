import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Database, and, eq } from "../../storage/db"
import { CronJobTable } from "../../scheduler/cron.sql"
import { Cron } from "../../scheduler/cron"
import { Identifier } from "../../id/id"

export function ExperimentalCronScheduleRoutes() {
  return new Hono()
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
}
