/**
 * Tool set for the DeliveryAgent.
 *
 * Verification tools + write tools for fixing issues found during delivery.
 * The delivery agent CAN modify files to fix runtime/quality issues, then
 * re-verify. If it cannot fix, it rejects with context for replan.
 */
import { tool } from "ai"
import z from "zod"
import { createCodebaseTools } from "@/orchestrator/codebase-tools"
import { Memory } from "@/memory"
import { Preference } from "@/preference"
import { Instance } from "@/project/instance"
import { Shell } from "@/shell/shell"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"

const log = Log.create({ service: "delivery-tools" })

/**
 * Creates the tool set for the DeliveryAgent.
 *
 * Includes:
 * - 4 codebase tools: read_file, find_files, search_code, list_directory
 * - 2 write tools: write_file, edit_file (for fixing issues)
 * - 2 memory tools: memory_search, memory_write
 * - 1 preference tool: preference_list
 * - 1 execution tool: run_command (for builds, startup checks)
 */
export function createDeliveryTools(input?: { sessionID?: string }) {
  const codebase = createCodebaseTools()
  const projectId = Instance.project.id
  const projectDir = Filesystem.resolve(Instance.directory)

  return {
    ...codebase,

    write_file: tool({
      description:
        "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. " +
        "Use for creating new files or completely rewriting small files during fix phases.",
      inputSchema: z.object({
        path: z.string().describe("File path relative to project root"),
        content: z.string().describe("Complete file content to write"),
      }),
      execute: async ({ path: filePath, content }) => {
        try {
          const resolved = Filesystem.resolve(Instance.directory, filePath)
          if (!resolved.startsWith(projectDir)) return "Error: path outside project directory"
          await Filesystem.write(resolved, content)
          return `Written: ${filePath} (${content.length} bytes)`
        } catch (err) {
          log.warn("write_file failed in delivery agent", { path: filePath, err })
          return `Error writing file: ${err instanceof Error ? err.message : String(err)}`
        }
      },
    }),

    edit_file: tool({
      description:
        "Replace a specific string in a file. Use for targeted fixes — replace the exact old text with new text. " +
        "The old_string must match exactly (including whitespace/indentation).",
      inputSchema: z.object({
        path: z.string().describe("File path relative to project root"),
        old_string: z.string().describe("Exact text to find and replace"),
        new_string: z.string().describe("Replacement text"),
      }),
      execute: async ({ path: filePath, old_string, new_string }) => {
        try {
          const resolved = Filesystem.resolve(Instance.directory, filePath)
          if (!resolved.startsWith(projectDir)) return "Error: path outside project directory"
          const content = await Filesystem.read(resolved)
          if (!content.includes(old_string)) return `Error: old_string not found in ${filePath}`
          const updated = content.replace(old_string, new_string)
          await Filesystem.write(resolved, updated)
          return `Edited: ${filePath} (replaced ${old_string.length} chars → ${new_string.length} chars)`
        } catch (err) {
          log.warn("edit_file failed in delivery agent", { path: filePath, err })
          return `Error editing file: ${err instanceof Error ? err.message : String(err)}`
        }
      },
    }),

    memory_search: tool({
      description:
        "Search project memory for prior delivery failures, known runtime issues, or startup problems. " +
        "Use when investigating why the application fails to start or render correctly.",
      inputSchema: z.object({
        query: z.string().describe("Search query — keywords about the failure or pattern"),
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
          log.warn("memory search failed in delivery agent", { query, err })
          return "Memory search unavailable."
        }
      },
    }),

    memory_write: tool({
      description:
        "Write knowledge to project memory. Use to persist delivery findings, runtime failure patterns, " +
        "and verification insights so future deliveries can reference them.",
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
          log.warn("memory write failed in delivery agent", { title, err })
          return "Memory write failed."
        }
      },
    }),

    preference_list: tool({
      description:
        "List active project preferences and conventions. " +
        "Use when checking if fixes follow project standards.",
      inputSchema: z.object({
        scope: z.enum(["all", "global"]).optional().describe("Which scope to list (default: all)"),
      }),
      execute: async () => {
        try {
          const prefs = Preference.merged({ projectID: projectId })
          if (prefs.length === 0) return "No preferences configured."
          return prefs.map((p) => `- **${p.key}**: ${p.value} [source: ${p.source}]`).join("\n")
        } catch (err) {
          log.warn("preference list failed in delivery agent", { err })
          return "Preferences unavailable."
        }
      },
    }),

    run_command: tool({
      description:
        "Run a shell command in the project directory and capture stdout/stderr/exit code. " +
        "Use to build the project, start servers, run smoke tests, or verify frontend rendering. " +
        "For server startup verification, use a short timeout (e.g., 10-15 seconds) to check if " +
        "the server starts without crashing — do NOT keep servers running indefinitely.",
      inputSchema: z.object({
        command: z.string().describe("Shell command to run (runs in project root)"),
        timeout_ms: z.number().optional().describe("Max execution time ms (default: 120000)"),
      }),
      execute: async ({ command, timeout_ms }) => {
        const timeout = timeout_ms ?? 120_000
        try {
          const result = await Shell.run(command, {
            cwd: projectDir,
            env: process.env,
            timeoutMs: timeout,
          })
          const parts = [`exit_code: ${result.exitCode}`]
          if (result.timedOut) parts.push(`timeout_ms: ${timeout}`)
          if (result.stdout.trim()) parts.push(`stdout:\n${result.stdout.slice(0, 8000)}`)
          if (result.stderr.trim()) parts.push(`stderr:\n${result.stderr.slice(0, 5000)}`)
          return parts.join("\n") || `exit_code: ${result.exitCode} (no output)`
        } catch (e) {
          log.warn("run_command failed in delivery agent", { command, err: e })
          return `Error running command: ${e instanceof Error ? e.message : String(e)}`
        }
      },
    }),

  }
}
