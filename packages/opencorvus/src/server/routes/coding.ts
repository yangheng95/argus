import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import z from "zod"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus, Message } from "@/session"
import { Log } from "@/util/log"

const log = Log.create({ service: "coding" })

const CodingInput = z.object({
  text: z.string().min(1),
  sessionID: z.string().optional(),
  parts: z
    .array(
      z.object({
        type: z.literal("text"),
        text: z.string(),
      }),
    )
    .optional(),
})

export function CodingRoutes() {
  return new Hono()
    .post(
      "/message/stream",
      describeRoute({
        summary: "Send coding assistant message with streaming",
        description:
          "Send a message to the build agent for direct coding assistance. Streams text deltas, tool calls, and results via SSE.",
        operationId: "coding.message.stream",
        responses: {
          200: {
            description: "Streaming coding assistant events",
            content: {
              "text/event-stream": {
                schema: resolver(z.any()),
              },
            },
          },
        },
      }),
      validator("json", CodingInput),
      async (c) => {
        const input = c.req.valid("json")
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")

        return streamSSE(c, async (stream) => {
          let sessionID = input.sessionID

          // Create or reuse session
          if (!sessionID) {
            const session = await Session.create({ kind: "assistant", title: "Coding assistant" })
            sessionID = session.id
          }

          log.info("coding message", { sessionID, text: input.text.slice(0, 80) })

          await stream.writeSSE({
            data: JSON.stringify({ type: "session", sessionID }),
          })

          const unsubs: (() => void)[] = []

          try {
            // Subscribe to part deltas (text streaming chunks)
            unsubs.push(
              Bus.subscribe(Message.Event.PartDelta, (event) => {
                if (event.properties.sessionID !== sessionID) return
                stream.writeSSE({
                  data: JSON.stringify({
                    type: "delta",
                    partID: event.properties.partID,
                    messageID: event.properties.messageID,
                    field: event.properties.field,
                    delta: event.properties.delta,
                  }),
                })
              }),
            )

            // Subscribe to part updates (tool calls, results, step markers)
            unsubs.push(
              Bus.subscribe(Message.Event.PartUpdated, (event) => {
                const part = event.properties.part as Record<string, unknown>
                if (part.sessionID !== sessionID) return
                stream.writeSSE({
                  data: JSON.stringify({
                    type: "part",
                    part,
                  }),
                })
              }),
            )

            // Subscribe to message updates (completion, tokens)
            unsubs.push(
              Bus.subscribe(Message.Event.Updated, (event) => {
                const info = event.properties.info as Record<string, unknown>
                if (info.sessionID !== sessionID) return
                if (info.role !== "assistant") return
                stream.writeSSE({
                  data: JSON.stringify({
                    type: "message",
                    info,
                  }),
                })
              }),
            )

            // Subscribe to session status (busy/idle/retry)
            unsubs.push(
              Bus.subscribe(SessionStatus.Event.Status, (event) => {
                if (event.properties.sessionID !== sessionID) return
                stream.writeSSE({
                  data: JSON.stringify({
                    type: "status",
                    status: event.properties.status,
                  }),
                })
              }),
            )

            // Subscribe to errors
            unsubs.push(
              Bus.subscribe(Session.Event.Error, (event) => {
                if (event.properties.sessionID !== sessionID) return
                stream.writeSSE({
                  data: JSON.stringify({
                    type: "error",
                    error: event.properties.error,
                  }),
                })
              }),
            )

            // Send the prompt to the build agent
            const agent = await Agent.defaultAgent()
            const parts = input.parts ?? [{ type: "text" as const, text: input.text }]

            await SessionPrompt.prompt({
              sessionID,
              agent,
              parts,
            })

            await stream.writeSSE({
              data: JSON.stringify({ type: "done", sessionID }),
            })
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            log.error("coding message failed", { sessionID, error: message })
            await stream.writeSSE({
              data: JSON.stringify({ type: "error", error: { message } }),
            })
          } finally {
            for (const unsub of unsubs) unsub()
          }
        })
      },
    )
    .get(
      "/session/:sessionID/messages",
      describeRoute({
        summary: "Get coding session messages",
        description: "Retrieve message history for a coding assistant session.",
        operationId: "coding.session.messages",
        responses: {
          200: {
            description: "Session messages",
            content: {
              "application/json": {
                schema: resolver(z.any()),
              },
            },
          },
        },
      }),
      async (c) => {
        const sessionID = c.req.param("sessionID")
        const messages = await Session.messages({ sessionID, limit: 200 })
        return c.json(messages)
      },
    )
}
