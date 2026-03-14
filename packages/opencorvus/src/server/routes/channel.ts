import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import { Bus } from "@/bus"
import { ChannelIngress } from "@/channel/ingress"
import {
  ChannelEgressEnvelope,
  ChannelIngressEnvelope,
  ChannelProtocol,
  ChannelTaskList,
  ChannelTaskListQuery,
  ChannelThreadEvent,
  ChannelThreadSelectInput,
  ChannelThreadState,
  ChannelThreadStateQuery,
} from "@/channel/protocol"
import { ChannelRegistry } from "@/channel/registry"
import { ChannelSupervisor } from "@/channel/supervisor"
import { ChannelAttachment } from "@/channel/attachment"
import { OrchestratorTaskTable } from "@/orchestrator/orchestrator.sql"
import { Database, eq } from "@/storage/db"
import { lazy } from "../../util/lazy"
import { errors } from "../error"
import z from "zod"

export const ChannelRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List channels",
        description: "Get available channel integrations, configuration status, and runtime status.",
        operationId: "channel.list",
        responses: {
          200: {
            description: "List of channels",
            content: {
              "application/json": {
                schema: resolver(ChannelRegistry.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await ChannelRegistry.list())
      },
    )
    .post(
      "/v1/ingress",
      describeRoute({
        summary: "Handle channel.v1 ingress",
        description: "Handle a versioned channel ingress envelope and return a versioned egress envelope.",
        operationId: "channel.v1.ingress",
        responses: {
          200: {
            description: "Ingress handled",
            content: {
              "application/json": {
                schema: resolver(ChannelEgressEnvelope),
              },
            },
          },
        },
      }),
      validator("json", ChannelIngressEnvelope),
      async (c) => {
        return c.json(await ChannelProtocol.ingress(c.req.valid("json")))
      },
    )
    .get(
      "/v1/thread",
      describeRoute({
        summary: "Get channel thread state",
        description: "Resolve the bound task for a channel thread and return its current board snapshot.",
        operationId: "channel.v1.thread",
        responses: {
          200: {
            description: "Channel thread state",
            content: {
              "application/json": {
                schema: resolver(ChannelThreadState),
              },
            },
          },
        },
      }),
      validator("query", ChannelThreadStateQuery),
      async (c) => {
        return c.json(await ChannelProtocol.state(c.req.valid("query")))
      },
    )
    .post(
      "/v1/thread/select",
      describeRoute({
        summary: "Select task for channel thread",
        description: "Bind a channel thread to an existing task and return the current thread state.",
        operationId: "channel.v1.thread.select",
        responses: {
          200: {
            description: "Channel thread state",
            content: {
              "application/json": {
                schema: resolver(ChannelThreadState),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("json", ChannelThreadSelectInput),
      async (c) => {
        return c.json(await ChannelProtocol.select(c.req.valid("json")))
      },
    )
    .get(
      "/v1/tasks",
      describeRoute({
        summary: "List tasks for channel clients",
        description: "Return recent project tasks and, when provided, the current binding for a channel thread.",
        operationId: "channel.v1.tasks",
        responses: {
          200: {
            description: "Channel task list",
            content: {
              "application/json": {
                schema: resolver(ChannelTaskList),
              },
            },
          },
        },
      }),
      validator("query", ChannelTaskListQuery),
      async (c) => {
        return c.json(await ChannelProtocol.tasks(c.req.valid("query")))
      },
    )
    .get(
      "/v1/thread/events",
      describeRoute({
        summary: "Subscribe to channel thread events",
        description: "Subscribe to task events for the task bound to a channel thread.",
        operationId: "channel.v1.thread.events",
        responses: {
          200: {
            description: "Channel thread event stream",
            content: {
              "text/event-stream": {
                schema: resolver(ChannelThreadEvent),
              },
            },
          },
        },
      }),
      validator("query", ChannelThreadStateQuery.omit({ sync: true })),
      async (c) => {
        const input = c.req.valid("query")
        const binding = ChannelIngress.findBinding(input.platform, input.channel, input.thread)
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")
        return streamSSE(c, async (stream) => {
          await stream.writeSSE({
            data: JSON.stringify(ChannelProtocol.event(input, event(binding?.task_id, {
              type: "channel.connected",
              properties: {
                ...(binding?.task_id ? { taskID: binding.task_id } : {}),
                summary: "Channel thread event stream connected",
              },
            }))),
          })
          if (!binding) {
            await stream.writeSSE({
              data: JSON.stringify(ChannelProtocol.event(input, event(undefined, {
                type: "channel.unbound",
                properties: {
                  summary: "No task is bound to this channel thread",
                },
              }))),
            })
            return
          }
          const sessionID = taskSession(binding.task_id)
          const unsub = Bus.subscribeAll(async (item) => {
            if (!matchesTaskEvent(item, binding.task_id, sessionID)) return
            await stream.writeSSE({
              data: JSON.stringify(ChannelProtocol.event(input, event(binding.task_id, item))),
            })
          })
          const heartbeat = setInterval(() => {
            stream.writeSSE({
              data: JSON.stringify(ChannelProtocol.event(input, event(binding.task_id, {
                type: "channel.heartbeat",
                properties: {
                  taskID: binding.task_id,
                  summary: "Channel thread event stream heartbeat",
                },
              }))),
            })
          }, 10_000)
          await new Promise<void>((resolve) => {
            stream.onAbort(() => {
              clearInterval(heartbeat)
              unsub()
              resolve()
            })
          })
        })
      },
    )
    .post(
      "/attachment",
      describeRoute({
        summary: "Create a temporary channel attachment URL",
        description: "Store a temporary attachment and return a signed public URL for channels that require remote image URLs.",
        operationId: "channel.attachment.create",
        responses: {
          200: {
            description: "Attachment created",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    id: z.string(),
                    url: z.string(),
                    mime: z.string(),
                    filename: z.string(),
                    expires_at: z.number(),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", ChannelAttachment.Input),
      async (c) => {
        return c.json(await ChannelAttachment.create(c.req.valid("json")))
      },
    )
    .get(
      "/attachment/:id",
      describeRoute({
        summary: "Read a temporary channel attachment",
        description: "Read a previously created temporary channel attachment by signed URL.",
        operationId: "channel.attachment.get",
        responses: {
          200: {
            description: "Attachment content",
            content: {
              "application/octet-stream": {
                schema: resolver(z.string()),
              },
            },
          },
          ...errors(404),
        },
      }),
      async (c) => {
        const file = await ChannelAttachment.get(c.req.param("id"))
        if (!file) return c.json({ error: "not found" }, 404)
        return new Response(Bun.file(file.path), {
          headers: {
            "content-type": file.mime,
            "content-disposition": `inline; filename="${file.filename.replace(/"/g, "")}"`,
            "cache-control": "public, max-age=86400",
          },
        })
      },
    )
    .get(
      "/runtime",
      describeRoute({
        summary: "Get managed channel runtime",
        description: "Get managed channel runtime status for configured channel integrations.",
        operationId: "channel.runtime",
        responses: {
          200: {
            description: "Channel runtime status",
            content: {
              "application/json": {
                schema: resolver(
                  ChannelRegistry.Info.pick({ id: true }).omit({ id: true }).extend({
                    status: ChannelRegistry.Info.shape.runtime_status,
                    detail: ChannelRegistry.Info.shape.runtime_detail,
                    channels: ChannelRegistry.Info.shape.id.array(),
                    logs: ChannelRegistry.Info.shape.runtime_detail.array(),
                    running: ChannelRegistry.Info.shape.runtime_status.transform((item) => item === "running"),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const current = await ChannelSupervisor.status()
        return c.json(current)
      },
    )
    .post(
      "/runtime/restart",
      describeRoute({
        summary: "Restart managed channel runtime",
        description: "Restart the managed channel runtime with the current config.",
        operationId: "channel.runtime.restart",
        responses: {
          200: {
            description: "Restarted channel runtime",
            content: {
              "application/json": {
                schema: resolver(
                  ChannelRegistry.Info.pick({ id: true }).omit({ id: true }).extend({
                    status: ChannelRegistry.Info.shape.runtime_status,
                    detail: ChannelRegistry.Info.shape.runtime_detail,
                    channels: ChannelRegistry.Info.shape.id.array(),
                    logs: ChannelRegistry.Info.shape.runtime_detail.array(),
                    running: ChannelRegistry.Info.shape.runtime_status.transform((item) => item === "running"),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await ChannelSupervisor.restart())
      },
    ),
)

function event(taskID: string | undefined, input: { type: string; properties: Record<string, unknown> }) {
  return {
    event_id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    ...(taskID ? { task_id: taskID } : {}),
    run_id: typeof input.properties.runID === "string" ? input.properties.runID : undefined,
    type: input.type.replace("orchestrator.", ""),
    timestamp: Date.now(),
    summary: typeof input.properties.summary === "string" ? input.properties.summary : input.type,
    payload: input.properties,
  }
}

function taskSession(taskID: string) {
  const row = Database.use((db) =>
    db
      .select({ sessionID: OrchestratorTaskTable.session_id })
      .from(OrchestratorTaskTable)
      .where(eq(OrchestratorTaskTable.id, taskID))
      .get(),
  )
  return row?.sessionID ?? undefined
}

function matchesTaskEvent(
  input: { type: string; properties: Record<string, unknown> },
  taskID: string,
  sessionID?: string,
) {
  if (input.properties?.taskID === taskID) return true
  if (!sessionID) return false
  return eventSession(input.properties) === sessionID
}

function eventSession(properties: Record<string, unknown>) {
  if (typeof properties.sessionID === "string") return properties.sessionID
  const info = properties.info
  if (info && typeof info === "object" && "sessionID" in info && typeof info.sessionID === "string") {
    return info.sessionID
  }
  const part = properties.part
  if (part && typeof part === "object" && "sessionID" in part && typeof part.sessionID === "string") {
    return part.sessionID
  }
  return undefined
}
