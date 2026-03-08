import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { ControlMessage } from "@/control/message"
import { ControlMessageInput, ControlMessageResult } from "@/control/message-schema"

export function PanelRoutes() {
  return new Hono().post(
    "/message",
    describeRoute({
      summary: "Handle desktop panel message",
      description: "Route a desktop panel chat or button intent through the control message service.",
      operationId: "panel.message",
      responses: {
        200: {
          description: "Panel message handled",
          content: {
            "application/json": {
              schema: resolver(ControlMessageResult),
            },
          },
        },
      },
    }),
    validator("json", ControlMessageInput),
    async (c) => {
      return c.json(await ControlMessage.handle(c.req.valid("json")))
    },
  )
}
