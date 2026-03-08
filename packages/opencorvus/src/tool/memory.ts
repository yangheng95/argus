import z from "zod"
import { Tool } from "./tool"
import { Memory } from "@/memory"
import { Instance } from "@/project/instance"

const DESCRIPTION = `Scoped memory store for project knowledge.

**Mandatory recall**: Before answering about prior work, decisions, dates, preferences, or project history, ALWAYS recall memory and preferences first.

Actions:
- **search**: Search session memory, global memory, or both. Use BEFORE answering from memory.
- **get**: Retrieve full content of a memory file by ID. Use after search to read detailed content.
- **write**: Save important knowledge. Defaults to global so it survives across all sessions in this project.
- **list**: Browse saved memory files by scope.
- **delete**: Remove outdated or incorrect memory by file ID.`

export const MemoryTool = Tool.define("memory", {
  description: DESCRIPTION,
  parameters: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("search"),
      query: z.string().describe("Search query — keywords, phrases, or a question about past knowledge"),
      scope: z
        .enum(["all", "global", "session"])
        .optional()
        .describe("Which memory scope to search (default: all)"),
      maxResults: z
        .preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().int().min(1).max(50).optional())
        .describe("Max results (default: 6)"),
      minScore: z
        .preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().min(0).max(1).optional())
        .describe("Min relevance score 0-1 (default: 0.1)"),
    }),
    z.object({
      action: z.literal("get"),
      fileId: z.string().describe("Memory file ID to retrieve"),
    }),
    z.object({
      action: z.literal("write"),
      title: z.string().describe("Short descriptive title (e.g. 'Project architecture decisions')"),
      content: z.string().describe("Markdown content to save. Use ## headings to organize sections."),
      scope: z
        .enum(["global", "session"])
        .optional()
        .describe("Storage scope (default: global)"),
    }),
    z.object({
      action: z.literal("list"),
      scope: z
        .enum(["all", "global", "session"])
        .optional()
        .describe("Which memory scope to list (default: all)"),
    }),
    z.object({
      action: z.literal("delete"),
      fileId: z.string().describe("Memory file ID to delete"),
    }),
  ]),
  async execute(params, ctx) {
    const projectId = Instance.project.id
    const planMode = ctx.extra?.planMode === true || ctx.agent === "plan"

    await ctx.ask({
      permission: "memory",
      patterns: ["*"],
      always: ["*"],
      metadata: { action: params.action },
    })

    switch (params.action) {
      case "search": {
        const results = Memory.search({
          query: params.query,
          projectId,
          sessionID: ctx.sessionID,
          scope: params.scope,
          limit: params.maxResults,
          minScore: params.minScore,
        })
        if (results.length === 0) {
          return {
            title: "No memories found",
            output: JSON.stringify({ results: [], query: params.query }),
            metadata: {},
          }
        }
        // Format results with citations for downstream prompts.
        const formatted = results.map((r) => ({
          fileId: r.fileId,
          fileTitle: r.fileTitle,
          scope: r.scope,
          score: Number(r.score.toFixed(4)),
          snippet: r.content.slice(0, 700),
          citation: `memory:${r.fileId}`,
        }))
        return {
          title: `${results.length} memories found`,
          output: JSON.stringify({ results: formatted, query: params.query }),
          metadata: {},
        }
      }

      case "get": {
        const file = Memory.getFile(params.fileId)
        if (!file) {
          return {
            title: "Not found",
            output: JSON.stringify({ error: `Memory file ${params.fileId} not found` }),
            metadata: {},
          }
        }
        const chunks = Memory.getChunks(params.fileId)
        const text = chunks.map((c) => c.content).join("\n\n")
        return {
          title: file.title,
          output: JSON.stringify({
            fileId: file.id,
            title: file.title,
            source: file.source,
            scope: file.scope,
            sessionID: file.sessionID,
            text,
          }),
          metadata: {},
        }
      }

      case "write": {
        if (planMode) {
          throw new Error("memory.write is disabled in plan mode. Only read-only memory actions are allowed.")
        }
        const scope = params.scope ?? "global"
        const file = Memory.createFile({
          title: params.title,
          source: "agent",
          projectId,
          scope,
          sessionID: scope === "session" ? ctx.sessionID : undefined,
        })
        const chunks = Memory.writeChunks(file.id, projectId, params.content)
        return {
          title: `Saved: ${params.title}`,
          output: JSON.stringify({
            fileId: file.id,
            title: params.title,
            scope,
            sessionID: file.sessionID,
            chunks: chunks.length,
          }),
          metadata: {},
        }
      }

      case "list": {
        const files = Memory.listFiles({
          projectId,
          sessionID: ctx.sessionID,
          scope: params.scope,
        })
        const formatted = files.map((f) => ({
          id: f.id,
          title: f.title,
          source: f.source,
          scope: f.scope,
          sessionID: f.sessionID,
          created: new Date(f.timeCreated).toISOString(),
        }))
        return {
          title: `${files.length} memory files`,
          output: JSON.stringify({ files: formatted }),
          metadata: {},
        }
      }

      case "delete": {
        if (planMode) {
          throw new Error("memory.delete is disabled in plan mode. Only read-only memory actions are allowed.")
        }
        const file = Memory.getFile(params.fileId)
        if (!file) {
          return {
            title: "Not found",
            output: JSON.stringify({ error: `Memory file ${params.fileId} not found` }),
            metadata: {},
          }
        }
        Memory.deleteFile(params.fileId)
        return {
          title: `Deleted: ${file.title}`,
          output: JSON.stringify({
            deleted: true,
            fileId: params.fileId,
            title: file.title,
            scope: file.scope,
            sessionID: file.sessionID,
          }),
          metadata: {},
        }
      }
    }
  },
})
