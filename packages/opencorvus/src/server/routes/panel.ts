import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import { ControlMessage } from "@/control/message"
import { PanelMessageInput, PanelMessageResult } from "@/control/message-schema"
import { PanelCapabilityQuery, PanelCapabilityResponse, panelCapabilities } from "@/panel/capability"

export function PanelRoutes() {
  return new Hono()
    .get(
      "/capabilities",
      describeRoute({
        summary: "List panel capabilities",
        description: "Return the panel tool actions available on a given surface, including local-action metadata and input schemas.",
        operationId: "panel.capabilities",
        responses: {
          200: {
            description: "Panel capabilities",
            content: {
              "application/json": {
                schema: resolver(PanelCapabilityResponse),
              },
            },
          },
        },
      }),
      validator("query", PanelCapabilityQuery),
      async (c) => {
        return c.json(panelCapabilities(c.req.valid("query").surface))
      },
    )
    .post(
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
                schema: resolver(PanelMessageResult),
              },
            },
          },
        },
      }),
      validator("json", PanelMessageInput),
      async (c) => {
        return c.json(PanelMessageResult.parse(await ControlMessage.handle(c.req.valid("json"))))
      },
    )
    .post(
      "/message/stream",
      describeRoute({
        summary: "Handle desktop panel message with streaming",
        description: "Route a desktop panel message through the control message service, streaming deltas via SSE.",
        operationId: "panel.message.stream",
        responses: {
          200: {
            description: "Streaming panel message events",
            content: {
              "text/event-stream": {
                schema: resolver(PanelMessageResult),
              },
            },
          },
        },
      }),
      validator("json", PanelMessageInput),
      async (c) => {
        const input = c.req.valid("json")
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")
        return streamSSE(c, async (stream) => {
          const result = await ControlMessage.handleStream(input, (event) => {
            stream.writeSSE({ data: JSON.stringify(event) })
          })
          await stream.writeSSE({
            data: JSON.stringify({ type: "done", result: PanelMessageResult.parse(result) }),
          })
        })
      },
    )
}
