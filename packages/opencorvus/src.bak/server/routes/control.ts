import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { ControlTimeline, TimelineMessage, TimelineQuery } from "@/control/timeline"

export function ControlRoutes() {
  return new Hono().get(
    "/timeline",
    describeRoute({
      summary: "Get control timeline",
      description: "Retrieve the persisted control-plane conversation for a task, session, or the current surface.",
      operationId: "control.timeline",
      responses: {
        200: {
          description: "Control timeline",
          content: {
            "application/json": {
              schema: resolver(TimelineMessage.array()),
            },
          },
        },
      },
    }),
    validator("query", TimelineQuery),
    async (c) => {
      return c.json(ControlTimeline.list(c.req.valid("query")))
    },
  )
}
