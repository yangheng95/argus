/**
 * Shared context tools for stage agents.
 *
 * Extends basic codebase tools (read_file, find_files, search_code, list_directory)
 * with project knowledge tools (memory) and external research (web search).
 *
 * This gives requirements / architect / frontend-design style agents access to:
 * - Prior work and known patterns via memory
 * - External documentation via web search
 * - Full codebase exploration via codebase tools
 */
import { tool } from "ai"
import z from "zod"
import { createCodebaseTools } from "@/engine/codebase-tools"
import { Memory } from "@/memory"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { exaMcpCall } from "@/tool/exa-mcp"

const log = Log.create({ service: "agent-context-tools" })

/**
 * Creates the full shared context tool set for read-only stage agents.
 *
 * @param taskWorkDir — If provided, overrides Instance.directory for codebase tools.
 *   Critical for eval tasks where the workspace is in a subdirectory.
 *
 * Includes:
 * - 4 codebase tools: read_file, find_files, search_code, list_directory
 * - 2 memory tools: memory_search, memory_get
 * - 1 web search tool: websearch (same canonical name as the registry tool;
 *   each stage agent must still list `websearch` in its tools.include — the
 *   shared set offers the capability, the agent contract opts in)
 */
export function createAgentContextTools(taskWorkDir?: string) {
  const codebase = createCodebaseTools(taskWorkDir)
  let projectId: string
  try {
    projectId = Instance.project.id
  } catch {
    projectId = "default"
    log.warn("context tools: Instance.project.id unavailable, using 'default'")
  }

  return {
    // --- Codebase exploration (inherited) ---
    ...codebase,

    // --- Project memory ---
    memory_search: tool({
      description:
        "Search project memory for prior work, known patterns, gotchas, and architectural decisions. " +
        "ALWAYS search memory before planning to leverage past experience. " +
        "Try 1-2 searches with different phrasings for better coverage.",
      inputSchema: z.object({
        query: z.string().describe("Search query — keywords, phrases, or question about past knowledge"),
        scope: z.enum(["all", "global"]).default("all").describe("Memory scope to search"),
        max_results: z.number().default(8).describe("Max results to return"),
      }),
      execute: async ({ query, scope, max_results }) => {
        try {
          const results = Memory.search({
            query,
            projectId,
            scope,
            limit: max_results,
            minScore: 0.1,
          })
          if (results.length === 0) return "No memories found for this query."
          return results
            .map(
              (r, i) =>
                `[${i + 1}] ${r.fileTitle} (${r.kind}/${r.scope}, score: ${r.score.toFixed(2)}, id: ${r.fileId})\n${r.content.slice(0, 600)}`,
            )
            .join("\n\n---\n\n")
        } catch (err) {
          log.warn("memory search failed in context tools", { query, err })
          return "Memory search unavailable."
        }
      },
    }),

    memory_get: tool({
      description:
        "Read the full content of a specific memory file by ID. " +
        "Use after memory_search when you need complete details of a promising result.",
      inputSchema: z.object({
        file_id: z.string().describe("Memory file ID from memory_search results"),
      }),
      execute: async ({ file_id }) => {
        try {
          const file = Memory.getFile(file_id)
          if (!file) return `Memory file ${file_id} not found.`
          const chunks = Memory.getChunks(file_id)
          const text = chunks.map((c) => c.content).join("\n\n")
          return `# ${file.title}\nKind: ${file.kind} | Scope: ${file.scope} | Source: ${file.source}\n\n${text}`
        } catch (err) {
          log.warn("memory get failed in context tools", { file_id, err })
          return "Failed to read memory file."
        }
      },
    }),

    // --- Web search (Exa) — single source via exaMcpCall, canonical name
    // `websearch` (matches the registry WebSearchTool). Always offered here;
    // per-agent opt-in is the tools.include whitelist in agent.ts. There is
    // intentionally no enable/disable env switch — disabling websearch for an
    // agent is done by leaving it out of that agent's include list (rule 7/10:
    // one mechanism, no dead parallel switch).
    websearch: tool({
      description:
        "Search the web for current documentation, API references, changelogs, best practices, " +
        "framework comparisons, and recommended tooling. USE PROACTIVELY for any greenfield project " +
        "or when choosing frameworks/libraries. Do NOT assume — verify what is current and recommended.",
      inputSchema: z.object({
        query: z.string().describe("Web search query"),
        num_results: z.number().default(5).describe("Number of results"),
      }),
      execute: async ({ query, num_results }, options) => {
        const text = await exaMcpCall({
          name: "web_search_exa",
          arguments: {
            query,
            type: "auto",
            numResults: num_results,
            livecrawl: "fallback",
          },
          timeoutMs: 20_000,
          signal: options?.abortSignal,
          label: "Web search",
        })
        if (!text) throw new Error("Web search returned no results")
        return text.length > 4000 ? text.slice(0, 4000) + "\n... (truncated)" : text
      },
    }),
  }
}

// ---------------------------------------------------------------------------
// Pre-fetch context — gives the LLM a head start before tool calls
// ---------------------------------------------------------------------------

/**
 * Pre-fetch project context for injection into a stage-agent prompt.
 * Auto-recalls relevant memory so the LLM doesn't waste tool calls
 * on things we can provide upfront.
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
    if (recalled) sections.push(recalled)
  } catch {
    // best-effort
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
