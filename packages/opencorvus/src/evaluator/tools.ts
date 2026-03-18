/**
 * Enhanced tool set for the GoalJudge.
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
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"

const log = Log.create({ service: "evaluator-tools" })

/**
 * Creates the tool set for the GoalJudge.
 *
 * Includes:
 * - 4 codebase tools: read_file, find_files, search_code, list_directory
 * - 1 memory tool: memory_search (for checking historical failure patterns)
 * - 1 preference tool: preference_list (for checking convention compliance)
 * - 1 execution tool: run_command (for mechanical verification — runs tsc/bun test when required by goal criteria)
 */
export function createEvaluatorTools(input?: { sessionID?: string }) {
  const codebase = createCodebaseTools()
  const projectId = Instance.project.id
  const projectDir = Filesystem.resolve(Instance.directory)

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

    // Preference check — verify code follows project conventions
    preference_list: tool({
      description:
        "List active project preferences and conventions. " +
        "Use when checking if the delivered code follows project-local cwd preferences and user-defined standards.",
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

    // Mechanical verification — run a shell command and capture actual output
    run_command: tool({
      description:
        "Run a shell command in the project directory and capture stdout/stderr/exit code. " +
        "Use ONLY when goal criteria explicitly require verifying that a command passes " +
        "(e.g., 'bunx tsc --noEmit', 'bun test', 'bun run build'). " +
        "Do NOT use for exploration — use read_file/search_code/find_files for that.",
      inputSchema: z.object({
        command: z.string().describe("Shell command to run (runs in project root)"),
        timeout_ms: z.number().optional().describe("Max execution time ms (default: 90000)"),
      }),
      execute: async ({ command, timeout_ms }) => {
        const timeout = timeout_ms ?? 90_000
        try {
          const isWin = process.platform === "win32"
          const shell = isWin ? ["cmd", "/c", command] : ["bash", "-c", command]
          const proc = Bun.spawn(shell, {
            cwd: projectDir,
            stdout: "pipe",
            stderr: "pipe",
          })
          const timer = setTimeout(() => {
            try { proc.kill() } catch { /* ignore */ }
          }, timeout)
          const [stdout, stderr, exitCode] = await Promise.all([
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
            proc.exited,
          ])
          clearTimeout(timer)
          const parts = [`exit_code: ${exitCode}`]
          if (stdout.trim()) parts.push(`stdout:\n${stdout.slice(0, 5000)}`)
          if (stderr.trim()) parts.push(`stderr:\n${stderr.slice(0, 3000)}`)
          return parts.join("\n") || `exit_code: ${exitCode} (no output)`
        } catch (e) {
          log.warn("run_command failed in evaluator", { command, err: e })
          return `Error running command: ${e instanceof Error ? e.message : String(e)}`
        }
      },
    }),
  }
}
