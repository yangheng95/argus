import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Memory } from "@/memory"
import { Preference } from "@/preference"
import { Instance } from "@/project/instance"

function projectId() {
  return Instance.project.id
}

export function PanelKnowledgeRoutes() {
  return new Hono()
    // ── Memory ──
    .get(
      "/memory",
      describeRoute({
        summary: "List memory files for current project",
        operationId: "panel.knowledge.memory.list",
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
                      scope: z.string(),
                      source: z.string(),
                      kind: z.string(),
                      key: z.string().optional(),
                      importance: z.number(),
                      confidence: z.number(),
                      timeCreated: z.number(),
                      timeUpdated: z.number(),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      validator("query", z.object({ sessionID: z.string().optional() })),
      async (c) => {
        const { sessionID } = c.req.valid("query")
        const files = Memory.listFiles({ projectId: projectId(), sessionID })
        return c.json(files)
      },
    )
    .get(
      "/memory/:id",
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
                    file: z.object({
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
                    }),
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
        const file = Memory.getFile(id)
        if (!file) return c.json({ error: "not found" }, 404)
        const chunks = Memory.getChunks(id)
        const content = chunks.map((ch) => ch.content).join("\n\n")
        return c.json({ file, content })
      },
    )
    .post(
      "/memory/search",
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
          limit: z.number().int().min(1).max(50).optional(),
        }),
      ),
      async (c) => {
        const { query, sessionID, limit } = c.req.valid("json")
        const results = Memory.search({ query, projectId: projectId(), sessionID, limit })
        return c.json(results)
      },
    )
    .delete(
      "/memory/:id",
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
        Memory.deleteFile(id)
        return c.json({ ok: true })
      },
    )
    // ── Preferences ──
    .get(
      "/preference",
      describeRoute({
        summary: "List manageable preferences for current project",
        operationId: "panel.knowledge.preference.list",
        responses: {
          200: {
            description: "Preference list (project-local cwd + custom overrides)",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      id: z.string(),
                      key: z.string(),
                      value: z.string(),
                      scope: z.string(),
                      source: z.string(),
                      confidence: z.number(),
                      timeUpdated: z.number(),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const prefs = Preference.manageable({ projectID: projectId() })
        return c.json(prefs)
      },
    )
    .post(
      "/preference",
      describeRoute({
        summary: "Create or update a preference",
        operationId: "panel.knowledge.preference.set",
        responses: {
          200: {
            description: "Preference entry",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    id: z.string(),
                    key: z.string(),
                    value: z.string(),
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
          key: z.string(),
          value: z.string(),
        }),
      ),
      async (c) => {
        const { key, value } = c.req.valid("json")
        const entry = Preference.set({ projectID: projectId(), key, value, source: "overlay" })
        return c.json(entry)
      },
    )
    .patch(
      "/preference/:id",
      describeRoute({
        summary: "Update a preference",
        operationId: "panel.knowledge.preference.update",
        responses: {
          200: {
            description: "Updated",
            content: { "application/json": { schema: resolver(z.object({ ok: z.boolean() })) } },
          },
        },
      }),
      validator(
        "json",
        z.object({
          key: z.string(),
          value: z.string(),
        }),
      ),
      async (c) => {
        const id = c.req.param("id")
        const { key, value } = c.req.valid("json")
        Preference.update({ preferenceID: id, key, value })
        return c.json({ ok: true })
      },
    )
    .delete(
      "/preference/:id",
      describeRoute({
        summary: "Delete a preference",
        operationId: "panel.knowledge.preference.delete",
        responses: {
          200: {
            description: "Deleted",
            content: { "application/json": { schema: resolver(z.object({ ok: z.boolean() })) } },
          },
        },
      }),
      async (c) => {
        const id = c.req.param("id")
        Preference.remove(id)
        return c.json({ ok: true })
      },
    )
}
