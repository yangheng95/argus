import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { streamSSE } from "../sse"
import z from "zod"
import { ControlMessage } from "@/control/message"
import { ControlMessageInput, ControlMessageResult } from "@/control/message-schema"
import { PanelCapabilityQuery, PanelCapabilityResponse, panelCapabilities } from "@/panel/capability"
import { Memory } from "@/memory"
import { Instance } from "@/project/instance"
import { sessionIDsForTask } from "@/engine/store"
import { Log } from "@/util/log"

const log = Log.create({ service: "server.routes.panel" })

function projectId() {
  return Instance.project.id
}

const MemoryFile = z.object({
  id: z.string(),
  title: z.string(),
  scope: z.string(),
  source: z.string(),
  kind: z.string(),
  key: z.string().optional(),
  importance: z.number(),
  confidence: z.number(),
  timeCreated: z.number(),
  timeUpdated: z.number(),
})

export function PanelRoutes() {
  return (
    new Hono()
      // === capabilities ===
      .get(
        "/capabilities",
        describeRoute({
          summary: "List panel capabilities",
          description:
            "Return the panel tool actions available on a given surface, including local-action metadata and input schemas.",
          operationId: "panel.capabilities",
          responses: {
            200: {
              description: "Panel capabilities",
              content: { "application/json": { schema: resolver(PanelCapabilityResponse) } },
            },
          },
        }),
        validator("query", PanelCapabilityQuery),
        async (c) => {
          return c.json(panelCapabilities(c.req.valid("query").surface))
        },
      )
      // === message ===
      .post(
        "/message",
        describeRoute({
          summary: "Handle desktop panel message",
          description: "Route a desktop panel chat or button intent through the control message service.",
          operationId: "panel.message",
          responses: {
            200: {
              description: "Panel message handled",
              content: { "application/json": { schema: resolver(ControlMessageResult) } },
            },
          },
        }),
        validator("json", ControlMessageInput),
        async (c) => {
          return c.json(await ControlMessage.handle(c.req.valid("json")))
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
              content: { "text/event-stream": { schema: resolver(ControlMessageResult) } },
            },
          },
        }),
        validator("json", ControlMessageInput),
        async (c) => {
          const input = c.req.valid("json")
          c.header("X-Accel-Buffering", "no")
          c.header("X-Content-Type-Options", "nosniff")
          return streamSSE(c, async (stream) => {
            let closed = false
            let writes = Promise.resolve()
            const writeData = (event: unknown) => {
              writes = writes
                .then(() => {
                  if (closed) return
                  return stream.writeSSE({ data: JSON.stringify(event) })
                })
                .catch((error) => {
                  closed = true
                  log.warn("panel message stream write failed", {
                    error: error instanceof Error ? error.message : String(error),
                  })
                  stream.close()
                })
              return writes
            }
            const result = await ControlMessage.handleStream(input, (event) => {
              void writeData(event)
            })
            await writes
            await writeData({ type: "done", result })
          })
        },
      )
      // === knowledge: memory (was panel-knowledge.ts) ===
      .get(
        "/knowledge/memory",
        describeRoute({
          summary: "List memory files for current project",
          operationId: "panel.knowledge.memory.list",
          responses: {
            200: {
              description: "Memory file list",
              content: { "application/json": { schema: resolver(z.array(MemoryFile)) } },
            },
          },
        }),
        validator(
          "query",
          z.object({
            sessionID: z.string().optional(),
            // taskID — frontend MemoryPanel sends this to scope "Task Context"
            // to the active task. Server resolves the task's session tree and
            // hands the set to Memory.listFiles so memory written by any agent
            // under the task (architect / requirements / build / …) shows up.
            taskID: z.string().optional(),
          }),
        ),
        async (c) => {
          const { sessionID, taskID } = c.req.valid("query")
          const sessionIDs = taskID ? sessionIDsForTask(taskID) : undefined
          const files = Memory.listFiles({ projectId: projectId(), sessionID, sessionIDs })
          return c.json(files)
        },
      )
      .get(
        "/knowledge/memory/:id",
        describeRoute({
          summary: "Get memory file content (all chunks)",
          operationId: "panel.knowledge.memory.get",
          responses: {
            200: {
              description: "Memory file with chunks",
              content: {
                "application/json": {
                  schema: resolver(
                    z.object({
                      file: MemoryFile,
                      content: z.string(),
                    }),
                  ),
                },
              },
            },
          },
        }),
        async (c) => {
          const id = c.req.param("id")
          const file = Memory.getFileInProject({ fileId: id, projectId: projectId() })
          if (!file) return c.json({ error: "not found" }, 404)
          const chunks = Memory.getChunksInProject({ fileId: id, projectId: projectId() })
          const content = chunks.map((ch) => ch.content).join("\n\n")
          return c.json({ file, content })
        },
      )
      .post(
        "/knowledge/memory/search",
        describeRoute({
          summary: "Search memories",
          operationId: "panel.knowledge.memory.search",
          responses: {
            200: {
              description: "Search results",
              content: {
                "application/json": {
                  schema: resolver(
                    z.array(
                      z.object({
                        chunkId: z.string(),
                        fileId: z.string(),
                        fileTitle: z.string(),
                        content: z.string(),
                        scope: z.string(),
                        source: z.string(),
                        kind: z.string(),
                        key: z.string().optional(),
                        importance: z.number(),
                        confidence: z.number(),
                        score: z.number(),
                      }),
                    ),
                  ),
                },
              },
            },
          },
        }),
        validator(
          "json",
          z.object({
            query: z.string(),
            sessionID: z.string().optional(),
            taskID: z.string().optional(),
            limit: z.number().int().min(1).max(50).optional(),
          }),
        ),
        async (c) => {
          const { query, sessionID, taskID, limit } = c.req.valid("json")
          const sessionIDs = taskID ? sessionIDsForTask(taskID) : undefined
          const results = Memory.search({ query, projectId: projectId(), sessionID, sessionIDs, limit })
          return c.json(results)
        },
      )
      .delete(
        "/knowledge/memory/:id",
        describeRoute({
          summary: "Delete memory file",
          operationId: "panel.knowledge.memory.delete",
          responses: {
            200: {
              description: "Deleted",
              content: { "application/json": { schema: resolver(z.object({ ok: z.boolean() })) } },
            },
          },
        }),
        async (c) => {
          const id = c.req.param("id")
          const file = Memory.deleteFileInProject({ fileId: id, projectId: projectId() })
          if (!file) return c.json({ error: "not found" }, 404)
          return c.json({ ok: true })
        },
      )
  )
}
