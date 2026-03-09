import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Memory } from "../../memory"

export function ExperimentalMemoryStorageRoutes() {
  return new Hono()
    .get(
      "/memory",
      describeRoute({
        summary: "List memory files",
        operationId: "experimental.memory.list",
        responses: {
          200: {
            description: "Memory file list",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      id: z.string(),
                      title: z.string(),
                      source: z.string(),
                      kind: z.string(),
                      key: z.string().optional(),
                      importance: z.number(),
                      confidence: z.number(),
                      timeCreated: z.number(),
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
        const files = Memory.listFiles({ projectId })
        return c.json(files)
      },
    )
    .post(
      "/memory/search",
      describeRoute({
        summary: "Search memories",
        operationId: "experimental.memory.search",
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
          projectId: z.string(),
          limit: z.number().int().min(1).max(50).optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json")
        const results = Memory.search(body)
        return c.json(results)
      },
    )
    .post(
      "/memory",
      describeRoute({
        summary: "Create memory file",
        operationId: "experimental.memory.create",
        responses: {
          200: {
            description: "Created memory file",
            content: {
              "application/json": {
                schema: resolver(z.object({ id: z.string(), title: z.string() })),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          title: z.string(),
          content: z.string(),
          projectId: z.string(),
          source: z.enum(["agent", "compaction", "user", "reflection"]).optional(),
          kind: z.enum(["note", "episode", "fact", "lesson", "profile"]).optional(),
        }),
      ),
      async (c) => {
        const { title, content, projectId, source, kind } = c.req.valid("json")
        const file = Memory.writeFile({ title, content, source: source ?? "user", projectId, kind })
        return c.json({ id: file.id, title: file.title })
      },
    )
    .delete(
      "/memory/:id",
      describeRoute({
        summary: "Delete memory file",
        operationId: "experimental.memory.delete",
        responses: {
          200: {
            description: "Deleted",
            content: { "application/json": { schema: resolver(z.object({ ok: z.boolean() })) } },
          },
        },
      }),
      async (c) => {
        const id = c.req.param("id")
        Memory.deleteFile(id)
        return c.json({ ok: true })
      },
    )
}
