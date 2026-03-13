/**
 * Enhanced tool set for the PlannerAgent.
 *
 * Extends basic codebase tools (read_file, find_files, search_code, list_directory)
 * with project knowledge tools (memory, preferences) and external research (web search).
 *
 * This gives the planner access to:
 * - Prior work and known patterns via memory
 * - Project conventions and constraints via preferences
 * - External documentation via web search
 * - Full codebase exploration via codebase tools
 */
import { tool, type Tool } from "ai"
import z from "zod"
import { createCodebaseTools } from "@/orchestrator/codebase-tools"
import { Memory } from "@/memory"
import { Preference } from "@/preference"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"

const log = Log.create({ service: "planner-tools" })

const EXA_BASE_URL = "https://mcp.exa.ai"

/**
 * Creates the full tool set for the PlannerAgent.
 *
 * @param taskWorkDir — If provided, overrides Instance.directory for codebase tools.
 *   Critical for eval tasks where the workspace is in a subdirectory.
 *
 * Includes:
 * - 4 codebase tools: read_file, find_files, search_code, list_directory
 * - 2 memory tools: memory_search, memory_get
 * - 1 preference tool: preference_list
 * - 1 web search tool: web_search
 */
export function createPlannerTools(taskWorkDir?: string, options?: { recall?: boolean }) {
  const codebase = createCodebaseTools(taskWorkDir) as Record<string, Tool>
  const recall = options?.recall ?? true
  let projectId: string
  try {
    projectId = Instance.project.id
  } catch {
    projectId = "default"
    log.warn("planner tools: Instance.project.id unavailable, using 'default'")
  }
  const usage = {
    memory: 0,
    memory_nohit: 0,
    preference: 0,
    recall_closed: false,
  }
  const seenQueries = new Set<string>()
  const normalizeQuery = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ")
  const recallComplete = (reason: string) => {
    usage.recall_closed = true
    return `RECALL_COMPLETE: ${reason}. Stop calling memory_search, memory_get, or preference_list. Continue with codebase tools: list_directory, find_files, read_file, search_code.`
  }
  const tools: Record<string, Tool> = {
    ...codebase,
    web_search: tool({
      description:
        "Search the web for current documentation, API references, changelogs, or guides. " +
        "Use when the task involves external APIs, third-party libraries, or unfamiliar systems. " +
        "Do NOT guess what can be looked up. Skip for internal-only tasks.",
      inputSchema: z.object({
        query: z.string().describe("Web search query"),
        num_results: z.number().optional().describe("Number of results (default: 5)"),
      }),
      execute: async ({ query, num_results }) => {
        try {
          const response = await fetch(`${EXA_BASE_URL}/mcp`, {
            method: "POST",
            headers: {
              accept: "application/json, text/event-stream",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "tools/call",
              params: {
                name: "web_search_exa",
                arguments: {
                  query,
                  type: "auto",
                  numResults: num_results ?? 5,
                  livecrawl: "fallback",
                },
              },
            }),
            signal: AbortSignal.timeout(20_000),
          })
          if (!response.ok) return `Web search failed (HTTP ${response.status}).`

          const text = await response.text()
          for (const line of text.split("\n")) {
            if (line.startsWith("data: ")) {
              let data: Record<string, unknown>
              try { data = JSON.parse(line.substring(6)) } catch { continue }
              const content = (data.result as Record<string, unknown> | undefined)
              const items = Array.isArray(content?.content) ? content!.content : undefined
              const first = items?.[0] as Record<string, unknown> | undefined
              if (typeof first?.text === "string") {
                const text = first.text as string
                return text.length > 4000 ? text.slice(0, 4000) + "\n... (truncated)" : text
              }
            }
          }
          return "No search results found."
        } catch (err) {
          log.warn("web search failed in planner", { query, err })
          return "Web search unavailable or timed out."
        }
      },
    }),
  }
  if (!recall) return tools

  tools.memory_search = tool({
    description:
      "Search project memory for prior work, known patterns, gotchas, and architectural decisions. " +
      "ALWAYS search memory before planning to leverage past experience. " +
      "Try 1-2 searches with different phrasings for better coverage.",
    inputSchema: z.object({
      query: z.string().describe("Search query — keywords, phrases, or question about past knowledge"),
      scope: z.enum(["all", "global"]).optional().describe("Memory scope to search (default: all)"),
      max_results: z.number().optional().describe("Max results to return (default: 8)"),
    }),
    execute: async ({ query, scope, max_results }) => {
      if (usage.recall_closed) return recallComplete("recall phase already closed")
      usage.memory += 1
      if (usage.memory > 4) return recallComplete("memory search budget exhausted")
      const normalized = normalizeQuery(query)
      if (!normalized) return recallComplete("empty memory search query")
      if (seenQueries.has(normalized)) return recallComplete("duplicate memory search query")
      seenQueries.add(normalized)
      try {
        const results = Memory.search({
          query,
          projectId,
          scope: scope ?? "all",
          limit: max_results ?? 8,
          minScore: 0.1,
        })
        if (results.length === 0) {
          usage.memory_nohit += 1
          if (usage.memory_nohit >= 2) {
            return recallComplete("no relevant memories found after multiple queries")
          }
          return "No memories found for this query. You may try one alternate phrasing, then continue with codebase tools."
        }
        usage.memory_nohit = 0
        return results
          .map(
            (r, i) =>
              `[${i + 1}] ${r.fileTitle} (${r.kind}/${r.scope}, score: ${r.score.toFixed(2)}, id: ${r.fileId})\n${r.content.slice(0, 600)}`,
          )
          .join("\n\n---\n\n")
      } catch (err) {
        log.warn("memory search failed in planner", { query, err })
        return "Memory search unavailable."
      }
    },
  })
  tools.memory_get = tool({
    description:
      "Read the full content of a specific memory file by ID. " +
      "Use after memory_search when you need complete details of a promising result.",
    inputSchema: z.object({
      file_id: z.string().describe("Memory file ID from memory_search results"),
    }),
    execute: async ({ file_id }) => {
      if (usage.recall_closed) return recallComplete("memory_get blocked because recall phase closed")
      try {
        const file = Memory.getFile(file_id)
        if (!file) return `Memory file ${file_id} not found. Prefer codebase tools if no valid memory IDs are available.`
        const chunks = Memory.getChunks(file_id)
        const text = chunks.map((c) => c.content).join("\n\n")
        return `# ${file.title}\nKind: ${file.kind} | Scope: ${file.scope} | Source: ${file.source}\n\n${text}`
      } catch (err) {
        log.warn("memory get failed in planner", { file_id, err })
        return "Failed to read memory file."
      }
    },
  })
  tools.preference_list = tool({
    description:
      "List all active project preferences and conventions. " +
      "Returns merged view: project-local cwd defaults → global overrides → session overrides. " +
      "Preferences are BINDING — your plan must respect them.",
    inputSchema: z.object({
      scope: z.enum(["all", "global"]).optional().describe("Which scope to list (default: all, merged view)"),
    }),
    execute: async () => {
      if (usage.recall_closed) return recallComplete("preference_list blocked because recall phase closed")
      usage.preference += 1
      if (usage.preference > 1) return recallComplete("preferences already listed once")
      try {
        const prefs = Preference.merged({ projectID: projectId })
        if (prefs.length === 0) {
          return recallComplete("no active preferences configured")
        }
        return prefs.map((p) => `- **${p.key}**: ${p.value} [source: ${p.source}]`).join("\n")
      } catch (err) {
        log.warn("preference list failed in planner", { err })
        return "Preferences unavailable."
      }
    },
  })

  return tools
}

// ---------------------------------------------------------------------------
// Pre-fetch context — gives the LLM a head start before tool calls
// ---------------------------------------------------------------------------

/**
 * Pre-fetch project context for injection into the planner prompt.
 * Auto-recalls relevant memory and active preferences so the LLM doesn't
 * waste tool calls on things we can provide upfront.
 */
export function prefetchContext(taskTitle: string, taskRequest: string): string {
  const sections: string[] = []
  const projectId = Instance.project.id

  // 1. Auto-recall memory with task keywords
  try {
    const keywords = extractKeywords(`${taskTitle} ${taskRequest}`)
    const recalled = keywords
      ? Memory.promptSection({
          query: keywords,
          projectId,
          scope: "all",
          limit: 5,
          minScore: 0.15,
          heading: "Auto-Recalled Memory",
          includeEpisodes: true,
        })
      : null
    sections.push(recalled ?? "## Auto-Recalled Memory\n\nNo relevant memory found for this task.")
  } catch {
    sections.push("## Auto-Recalled Memory\n\nMemory prefetch unavailable.")
  }

  // 2. Inject active preferences
  try {
    const prefs = Preference.merged({ projectID: projectId })
    if (prefs.length > 0) {
      const items = prefs.map((p) => `- **${p.key}**: ${p.value}`).join("\n")
      sections.push(`## Active Preferences (BINDING)\n\n${items}`)
    } else {
      sections.push("## Active Preferences (BINDING)\n\nNo active preferences configured.")
    }
  } catch {
    sections.push("## Active Preferences (BINDING)\n\nPreference prefetch unavailable.")
  }

  return sections.length > 0 ? sections.join("\n\n") : ""
}

function extractKeywords(text: string): string {
  const stopwords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "can", "need", "must", "and", "or", "but",
    "in", "on", "at", "to", "for", "of", "with", "by", "from", "as",
    "into", "through", "during", "before", "after", "above", "below",
    "的", "了", "是", "在", "有", "和", "与", "或", "不", "也",
    "就", "都", "而", "及", "把", "被", "让", "给", "对", "从",
    "到", "这", "那", "我", "你", "他", "她", "它", "们", "要",
    "会", "能", "可以", "已经", "然后", "如果", "因为", "所以",
  ])
  const tokens = text.match(/[\p{L}\p{N}_]+/gu) ?? []
  return tokens
    .filter((t) => t.length > 1 && !stopwords.has(t.toLowerCase()))
    .slice(0, 12)
    .join(" ")
}
