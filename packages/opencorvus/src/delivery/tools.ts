/**
 * Tool set for the DeliveryAgent.
 *
 * Extends codebase exploration tools with write capabilities, memory/preference
 * awareness, and command execution. Unlike the evaluator's read-only tools,
 * the delivery agent can write and edit files to fix bugs discovered during
 * end-to-end verification.
 */
import { tool } from "ai"
import z from "zod"
import path from "path"
import fs from "fs"
import { createCodebaseTools } from "@/orchestrator/codebase-tools"
import { Memory } from "@/memory"
import { Preference } from "@/preference"
import { Instance } from "@/project/instance"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"

const log = Log.create({ service: "delivery-tools" })

/**
 * Creates the full tool set for the DeliveryAgent.
 *
 * Includes:
 * - 4 codebase tools: read_file, find_files, search_code, list_directory
 * - 1 memory tool: memory_search
 * - 1 preference tool: preference_list
 * - 1 execution tool: run_command (for starting servers, running builds)
 * - 1 write tool: write_file (create or overwrite files)
 * - 1 edit tool: edit_file (search-and-replace edits)
 */
export function createDeliveryTools(input?: { sessionID?: string }) {
  const codebase = createCodebaseTools()
  const projectId = Instance.project.id
  const projectDir = Filesystem.resolve(Instance.directory)

  function safePath(input: string): string | null {
    const value = Filesystem.windowsPath(input)
    const abs = path.isAbsolute(value) ? Filesystem.resolve(value) : Filesystem.resolve(path.resolve(projectDir, value))
    return Filesystem.contains(projectDir, abs) ? abs : null
  }

  return {
    ...codebase,

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
          if (stdout.trim()) parts.push(`stdout:\n${stdout.slice(0, 8000)}`)
          if (stderr.trim()) parts.push(`stderr:\n${stderr.slice(0, 5000)}`)
          return parts.join("\n") || `exit_code: ${exitCode} (no output)`
        } catch (e) {
          log.warn("run_command failed in delivery agent", { command, err: e })
          return `Error running command: ${e instanceof Error ? e.message : String(e)}`
        }
      },
    }),

    write_file: tool({
      description:
        "Create or overwrite a file in the project directory. " +
        "Use to create missing files, fix configuration, or write new code needed for the application to run. " +
        "The file path must be within the project boundary.",
      inputSchema: z.object({
        path: z.string().describe("File path relative to project root"),
        content: z.string().describe("Full file content to write"),
      }),
      execute: async ({ path: filePath, content }) => {
        const abs = safePath(filePath)
        if (!abs) return "Error: path is outside the project boundary."
        try {
          const dir = path.dirname(abs)
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true })
          }
          fs.writeFileSync(abs, content, "utf-8")
          const bytes = Buffer.byteLength(content, "utf-8")
          log.info("delivery agent wrote file", { path: filePath, bytes })
          return `File written: ${filePath} (${bytes} bytes)`
        } catch (e) {
          log.warn("write_file failed in delivery agent", { path: filePath, err: e })
          return `Error writing file: ${e instanceof Error ? e.message : String(e)}`
        }
      },
    }),

    edit_file: tool({
      description:
        "Apply a search-and-replace edit to an existing file. " +
        "Reads the file, finds the exact old_text, replaces it with new_text, and writes back. " +
        "Use for targeted bug fixes — changing a line, fixing an import, correcting a typo. " +
        "The old_text must appear exactly once in the file.",
      inputSchema: z.object({
        path: z.string().describe("File path relative to project root"),
        old_text: z.string().describe("Exact text to find (must appear exactly once)"),
        new_text: z.string().describe("Replacement text"),
      }),
      execute: async ({ path: filePath, old_text, new_text }) => {
        const abs = safePath(filePath)
        if (!abs) return "Error: path is outside the project boundary."
        try {
          const content = fs.readFileSync(abs, "utf-8")
          const count = content.split(old_text).length - 1
          if (count === 0) return `Error: old_text not found in ${filePath}. Check the exact text.`
          if (count > 1) return `Error: old_text found ${count} times in ${filePath}. It must appear exactly once. Provide more context to make it unique.`
          const updated = content.replace(old_text, new_text)
          fs.writeFileSync(abs, updated, "utf-8")
          log.info("delivery agent edited file", { path: filePath, oldLen: old_text.length, newLen: new_text.length })
          return `File edited: ${filePath} (replaced ${old_text.length} chars with ${new_text.length} chars)`
        } catch (e) {
          log.warn("edit_file failed in delivery agent", { path: filePath, err: e })
          return `Error editing file: ${e instanceof Error ? e.message : String(e)}`
        }
      },
    }),
  }
}
