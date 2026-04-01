/**
 * Tool set for the EvaluatorAgent.
 *
 * Includes codebase exploration, memory, and preference tools.
 * The evaluator uses these to investigate deliveries and verify goal completion.
 */
import { tool } from "ai"
import z from "zod"
import { createCodebaseTools } from "@/orchestrator/codebase-tools"
import { Memory } from "@/memory"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"

const log = Log.create({ service: "evaluator-tools" })

/**
 * Creates the tool set for the EvaluatorAgent.
 *
 * Includes:
 * - 4 codebase tools: read_file, find_files, search_code, list_directory
 * - 2 memory tools: memory_search, memory_write
 * - 1 preference tool: preference_list
 */
export function createEvaluatorTools(input?: { sessionID?: string }) {
  const codebase = createCodebaseTools()
  const projectId = Instance.project.id

  return {
    ...codebase,

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
            sessionID: input?.sessionID,
            scope: "all",
            limit: max_results ?? 5,
            minScore: 0.1,
          })
          if (results.length === 0) return "No relevant memories found."
          return results
            .map(
              (r, i) =>
                `[${i + 1}] ${r.fileTitle} (${r.kind}/${r.scope}, score: ${r.score.toFixed(2)})\n${r.content.slice(0, 500)}`,
            )
            .join("\n\n---\n\n")
        } catch (err) {
          log.warn("memory search failed in evaluator", { query, err })
          return "Memory search unavailable."
        }
      },
    }),

    memory_write: tool({
      description:
        "Write knowledge to project memory. Use to persist failure patterns, root causes, " +
        "and evaluation insights so future evaluations can reference them.",
      inputSchema: z.object({
        title: z.string().describe("Short descriptive title"),
        content: z.string().describe("Markdown content to save"),
        kind: z.enum(["fact", "lesson", "episode"]).optional().describe("Memory kind (default: lesson)"),
      }),
      execute: async ({ title, content, kind }) => {
        try {
          const file = Memory.writeFile({
            title,
            content,
            source: "agent",
            projectId,
            scope: "global",
            kind: kind ?? "lesson",
          })
          return `Saved: ${title} (id: ${file.id})`
        } catch (err) {
          log.warn("memory write failed in evaluator", { title, err })
          return "Memory write failed."
        }
      },
    }),

  }
}
