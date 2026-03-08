/**
 * Enhanced tool set for the EvaluatorAgent.
 *
 * Extends basic codebase tools with memory search and preference awareness,
 * giving the evaluator deeper context for failure analysis and goal assessment.
 */
import { tool } from "ai"
import z from "zod"
import { createCodebaseTools } from "@/orchestrator/codebase-tools"
import { Memory } from "@/memory"
import { Preference } from "@/preference"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"

const log = Log.create({ service: "evaluator-tools" })

/**
 * Creates the tool set for the EvaluatorAgent.
 *
 * Includes:
 * - 4 codebase tools: read_file, find_files, search_code, list_directory
 * - 1 memory tool: memory_search (for checking historical failure patterns)
 * - 1 preference tool: preference_list (for checking convention compliance)
 */
export function createEvaluatorTools() {
  const codebase = createCodebaseTools()
  const projectId = Instance.project.id

  return {
    // All 4 codebase tools (evaluator needs full exploration for deep analysis)
    ...codebase,

    // Memory search — check if similar failures happened before
    memory_search: tool({
      description:
        "Search project memory for prior failures, known issues, or historical context. " +
        "Use when investigating failures to check if a similar issue was encountered before.",
      inputSchema: z.object({
        query: z.string().describe("Search query — keywords about the failure, error, or pattern"),
        max_results: z.number().optional().describe("Max results (default: 5)"),
      }),
      execute: async ({ query, max_results }) => {
        try {
          const results = Memory.search({
            query,
            projectId,
            scope: "all",
            limit: max_results ?? 5,
            minScore: 0.1,
          })
          if (results.length === 0) return "No relevant memories found."
          return results
            .map(
              (r, i) =>
                `[${i + 1}] ${r.fileTitle} (${r.scope}, score: ${r.score.toFixed(2)})\n${r.content.slice(0, 500)}`,
            )
            .join("\n\n---\n\n")
        } catch (err) {
          log.warn("memory search failed in evaluator", { query, err })
          return "Memory search unavailable."
        }
      },
    }),

    // Preference check — verify code follows project conventions
    preference_list: tool({
      description:
        "List active project preferences and conventions. " +
        "Use when checking if the delivered code follows established project standards.",
      inputSchema: z.object({
        scope: z.enum(["all", "global"]).optional().describe("Which scope to list (default: all)"),
      }),
      execute: async () => {
        try {
          const prefs = Preference.merged({ projectID: projectId })
          if (prefs.length === 0) return "No preferences configured."
          return prefs.map((p) => `- **${p.key}**: ${p.value} [source: ${p.source}]`).join("\n")
        } catch (err) {
          log.warn("preference list failed in evaluator", { err })
          return "Preferences unavailable."
        }
      },
    }),
  }
}
