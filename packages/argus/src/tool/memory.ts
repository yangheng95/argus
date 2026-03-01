import z from "zod"
import { Tool } from "./tool"
import { Memory } from "@/memory"
import { Instance } from "@/project/instance"

/**
 * Memory tool — persistent knowledge store across sessions.
 *
 * Architecture reference: OpenClaw memory_search + memory_get tools
 * - "search": mandatory recall step — semantically search past knowledge
 * - "get": retrieve full content of a specific memory file
 * - "write": persist new knowledge
 * - "list": browse saved memory files
 * - "delete": remove outdated memories
 */
const DESCRIPTION = `Persistent memory store for knowledge across sessions.

**Mandatory recall**: Before answering about prior work, decisions, dates, preferences, or project history, ALWAYS search memory first.

Actions:
- **search**: Semantically search past knowledge. Returns top snippets with scores. Use BEFORE answering from memory.
- **get**: Retrieve full content of a memory file by ID. Use after search to read detailed content.
- **write**: Save important knowledge (decisions, patterns, preferences, discoveries). Use ## headings to organize.
- **list**: Browse all saved memory files for this project.
- **delete**: Remove outdated or incorrect memory by file ID.`

export const MemoryTool = Tool.define("memory", {
  description: DESCRIPTION,
  parameters: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("search"),
      query: z.string().describe("Search query — keywords, phrases, or a question about past knowledge"),
      maxResults: z.number().int().min(1).max(50).optional().describe("Max results (default: 6)"),
      minScore: z.number().min(0).max(1).optional().describe("Min relevance score 0-1 (default: 0.1)"),
    }),
    z.object({
      action: z.literal("get"),
      fileId: z.string().describe("Memory file ID to retrieve"),
    }),
    z.object({
      action: z.literal("write"),
      title: z.string().describe("Short descriptive title (e.g. 'Project architecture decisions')"),
      content: z.string().describe("Markdown content to save. Use ## headings to organize sections."),
    }),
    z.object({
      action: z.literal("list"),
    }),
    z.object({
      action: z.literal("delete"),
      fileId: z.string().describe("Memory file ID to delete"),
    }),
  ]),
  async execute(params, ctx) {
    const projectId = Instance.project.id

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
        // Format results with citations (OpenClaw pattern)
        const formatted = results.map((r) => ({
          fileId: r.fileId,
          fileTitle: r.fileTitle,
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
          output: JSON.stringify({ fileId: file.id, title: file.title, source: file.source, text }),
          metadata: {},
        }
      }

      case "write": {
        const file = Memory.createFile({
          title: params.title,
          source: "agent",
          projectId,
        })
        const chunks = Memory.writeChunks(file.id, projectId, params.content)
        return {
          title: `Saved: ${params.title}`,
          output: JSON.stringify({ fileId: file.id, title: params.title, chunks: chunks.length }),
          metadata: {},
        }
      }

      case "list": {
        const files = Memory.listFiles(projectId)
        const formatted = files.map((f) => ({
          id: f.id,
          title: f.title,
          source: f.source,
          created: new Date(f.timeCreated).toISOString(),
        }))
        return {
          title: `${files.length} memory files`,
          output: JSON.stringify({ files: formatted }),
          metadata: {},
        }
      }

      case "delete": {
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
          output: JSON.stringify({ deleted: true, fileId: params.fileId, title: file.title }),
          metadata: {},
        }
      }
    }
  },
})
