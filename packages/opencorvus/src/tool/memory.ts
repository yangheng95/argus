import z from "zod"
import { Tool } from "./tool"
import { Memory } from "@/memory"
import { Instance } from "@/project/instance"

const MemoryKinds = ["note", "episode", "fact", "lesson", "profile"] as const

const DESCRIPTION = `Scoped memory store for project knowledge.

**Mandatory recall**: Before answering about prior work, decisions, dates, or project history, ALWAYS recall memory first.

**Proactive writing**: Write memory whenever you discover useful knowledge — do not wait until task end. Write test commands, build steps, deployment procedures, environment configs, non-obvious gotchas, root causes, effective patterns, task summaries, historical decisions, inspirations, and ideas.

**Always-save categories** — when you observe any of these, save immediately (do not batch, do not defer):
- **Credentials / API keys / tokens**: the concrete value if seen, plus where it loads from (env var name, .env path, credential-manager entry, vault ID). Use \`kind: "fact"\`, \`key: "credential:<name>"\`.
- **Tool / CLI invocation quirks**: non-default flags, required env vars, path workarounds, platform-specific overrides (e.g. Windows-only PowerShell replacements for taskkill). Use \`kind: "fact"\`, \`key: "tool:<name>"\`.
- **High-frequency errors**: any error you see more than once or that costs noticeable time — capture the symptom, the trigger, the root cause, and the fix. Use \`kind: "lesson"\`, \`key: "error:<short-id>"\`.

Using the \`key\` field for these three categories enables idempotent updates (same key → overwrite) instead of accumulating duplicates.

Actions:
- **search**: Search session memory, global memory, or both. Use BEFORE answering from memory.
- **get**: Retrieve full content of a memory file by ID. Use after search to read detailed content.
- **write**: Save important knowledge. Prefer typed memory: lesson (gotchas, patterns, inspirations, recurring errors), fact (setup, config, env, test/deploy commands, credentials, tool quirks), episode (task summaries, history), profile (stable constraints).
- **list**: Browse saved memory files by scope.
- **delete**: Remove outdated or incorrect memory by file ID.`

export const MemoryTool = Tool.define("memory", {
  description: DESCRIPTION,
  parameters: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("search"),
      query: z.string().describe("Search query — keywords, phrases, or a question about past knowledge"),
      scope: z.enum(["all", "global", "session"]).optional().describe("Which memory scope to search"),
      maxResults: z
        .preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().int().min(1).max(50).optional())
        .describe("Max results"),
      minScore: z
        .preprocess((v) => (typeof v === "string" ? Number(v) : v), z.number().min(0).max(1).optional())
        .describe("Min relevance score 0-1"),
    }),
    z.object({
      action: z.literal("get"),
      fileId: z.string().describe("Memory file ID to retrieve"),
    }),
    z.object({
      action: z.literal("write"),
      title: z.string().describe("Short descriptive title (e.g. 'Project architecture decisions')"),
      content: z.string().describe("Markdown content to save. Use ## headings to organize sections."),
      kind: z
        .enum(MemoryKinds)
        .optional()
        .describe("Memory kind. Use lesson/fact/profile for atomic long-term memory and episode for summaries."),
      scope: z.enum(["global", "session"]).optional().describe("Storage scope"),
      key: z
        .string()
        .optional()
        .describe(
          "Stable identifier for idempotent upserts (same key + scope + kind → overwrite existing entry). Use 'credential:<name>', 'tool:<name>', 'error:<short-id>' for the always-save categories.",
        ),
    }),
    z.object({
      action: z.literal("list"),
      scope: z.enum(["all", "global", "session"]).optional().describe("Which memory scope to list"),
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
          kind: r.kind,
          source: r.source,
          importance: r.importance,
          confidence: r.confidence,
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
            kind: file.kind,
            key: file.key,
            importance: file.importance,
            confidence: file.confidence,
            text,
          }),
          metadata: {},
        }
      }

      case "write": {
        const scope = params.scope ?? "global"
        const file = Memory.writeFile({
          title: params.title,
          content: params.content,
          source: "agent",
          projectId,
          scope,
          sessionID: scope === "session" ? ctx.sessionID : undefined,
          kind: params.kind,
          key: params.key,
        })
        return {
          title: `Saved: ${params.title}`,
          output: JSON.stringify({
            fileId: file.id,
            title: params.title,
            scope,
            sessionID: file.sessionID,
            kind: file.kind,
            key: file.key,
            importance: file.importance,
            confidence: file.confidence,
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
          kind: f.kind,
          key: f.key,
          importance: f.importance,
          confidence: f.confidence,
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
