import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { TaskPlan } from "../../../memory/task-plan"
import { Scratchpad } from "../../../memory/scratchpad"

export function MemoryViewRoutes() {
  return new Hono()
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
