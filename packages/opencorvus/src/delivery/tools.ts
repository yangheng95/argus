/**
 * Tool set for the DeliveryAgent.
 *
 * Includes exploration tools, execution tools, write tools, and memory tools.
 * The delivery agent verifies runtime behavior, fixes issues found during
 * verification, and makes the final acceptance decision.
 */
import { tool } from "ai"
import z from "zod"
import fs from "fs/promises"
import path from "path"
import { createCodebaseTools } from "@/orchestrator/codebase-tools"
import { Memory } from "@/memory"
import { Instance } from "@/project/instance"
import { Shell } from "@/shell/shell"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"
import { OrchestratorService } from "@/orchestrator/service"
import { findTask } from "@/orchestrator/store"

const FIX_CHAIN_DEPTH_LIMIT = 3

const log = Log.create({ service: "delivery-tools" })

/**
 * Creates the tool set for the DeliveryAgent.
 *
 * Includes:
 * - 4 codebase read tools: read_file, find_files, search_code, list_directory
 * - 2 write tools: write_file, edit_file (for rework during verification)
 * - 2 memory tools: memory_search, memory_write
 * - 1 execution tool: run_command (for builds, startup checks)
 */
export function createDeliveryTools(input?: { sessionID?: string; taskID?: string }) {
  const codebase = createCodebaseTools()
  const projectId = Instance.project.id
  const projectDir = Filesystem.resolve(Instance.directory)
  const taskID = input?.taskID

  return {
    ...codebase,

    query_criteria: tool({
      description:
        "Read every quality criterion that has been recorded for the current task — " +
        "per-goal evaluator outcomes, delivery checks already submitted, and external " +
        "quality gates such as visual-diff. Call this BEFORE deciding the verdict so " +
        "you have a full picture of which criteria passed, failed, or were skipped, " +
        "with their evidence.",
      inputSchema: z.object({}),
      execute: async () => {
        if (!taskID) return "query_criteria: no task context available"
        const task = findTask(taskID)
        if (!task) return `query_criteria: task ${taskID} not found`
        const meta = (task.metadata as Record<string, unknown> | null) ?? {}
        const list = Array.isArray(meta.criteria_results) ? (meta.criteria_results as any[]) : []
        if (list.length === 0) {
          return "query_criteria: no criteria recorded yet for this task"
        }
        const counts = list.reduce(
          (acc, c) => {
            const s = String(c?.status ?? "unknown")
            acc[s] = (acc[s] ?? 0) + 1
            return acc
          },
          {} as Record<string, number>,
        )
        const lines = list.map((c) => {
          const family = c?.family ? `[${c.family}] ` : ""
          const ev = c?.evidence ? ` — ${String(c.evidence).slice(0, 400)}` : ""
          return `${family}${c?.name ?? "?"} = ${c?.status ?? "?"}${ev}`
        })
        return `criteria summary: ${JSON.stringify(counts)}\n${lines.join("\n")}`
      },
    }),

    submit_fix_task: tool({
      description:
        "Spawn a new fix task in the same project to repair the issues found by " +
        "this verification round. Use this when query_criteria shows failed " +
        "criteria that the executor needs another pass to fix. The new task is " +
        "created with priority=critical so it jumps the project's serial queue " +
        "ahead of normal/high work, but it never preempts the currently active " +
        "task. A `metadata.fix_for` link points back to this task; the task " +
        "agent will see the fix context and the failed criteria evidence in its " +
        "next prompt. Limit applies — the chain stops at depth " + FIX_CHAIN_DEPTH_LIMIT +
        " to prevent infinite repair loops.",
      inputSchema: z.object({
        summary: z.string().describe(
          "Short title describing the fix task, e.g. 'Repair sidebar layout to match design'.",
        ),
        failed_criteria: z.array(z.string()).describe(
          "Names of the criteria that failed — must match `name` from query_criteria. Evidence is auto-attached.",
        ),
        scope_files: z.array(z.string()).optional().describe(
          "Optional list of files the fix should focus on (relative to project root).",
        ),
      }),
      execute: async ({ summary, failed_criteria, scope_files }) => {
        if (!taskID) return "submit_fix_task: no task context available"
        const original = findTask(taskID)
        if (!original) return `submit_fix_task: original task ${taskID} not found`
        const meta = (original.metadata as Record<string, unknown> | null) ?? {}
        const depth = typeof meta.fix_chain_depth === "number" ? meta.fix_chain_depth : 0
        if (depth >= FIX_CHAIN_DEPTH_LIMIT) {
          return `submit_fix_task: fix chain depth ${depth} reached limit ${FIX_CHAIN_DEPTH_LIMIT}; refusing to spawn another fix task`
        }
        const allCriteria = Array.isArray(meta.criteria_results) ? (meta.criteria_results as any[]) : []
        const wantedNames = new Set(failed_criteria)
        const matched = allCriteria.filter((c) => wantedNames.has(String(c?.name ?? "")))
        const evidenceBlock = matched.length > 0
          ? matched
              .map((c) => `- **${c.name}** (${c.family ?? "custom"}): ${c.status}\n  evidence: ${String(c.evidence ?? "(none)").slice(0, 600)}`)
              .join("\n")
          : failed_criteria.map((n) => `- **${n}**: (no recorded evidence — query_criteria first)`).join("\n")
        const scopeBlock = scope_files && scope_files.length > 0
          ? `\n\n## Scope (focus area)\n${scope_files.map((f) => `- ${f}`).join("\n")}`
          : ""
        const request = [
          `# Fix task — derived from \`${original.id}\` ("${original.title}")`,
          ``,
          summary,
          ``,
          `## Original request`,
          original.request,
          ``,
          `## Failed criteria from previous verification`,
          evidenceBlock,
          scopeBlock,
          ``,
          `Address every failed criterion above. Do not regress passing criteria.`,
        ].join("\n")
        // We don't carry an executor field on the original task row; the new
        // task picks the configured default at create time, which matches how
        // user-initiated tasks are dispatched.
        const newTaskID = await OrchestratorService.createTask({
          title: `Fix: ${summary.slice(0, 80)}`,
          request,
          priority: "critical",
          metadata: {
            ...meta,
            fix_for: original.id,
            fix_chain_depth: depth + 1,
            failed_criteria,
            ...(scope_files ? { fix_scope_files: scope_files } : {}),
          },
        })
        return `submit_fix_task: created new fix task ${newTaskID} (priority=critical, fix_chain_depth=${depth + 1}). It will run after the currently active task finishes.`
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

    write_file: tool({
      description:
        "Write content to a file in the project directory. Creates the file if it does not exist, " +
        "overwrites it if it does. Use to fix issues found during verification — apply minimal targeted " +
        "edits only. Always re-run the relevant check after writing to confirm the fix.",
      inputSchema: z.object({
        file_path: z.string().describe("Path relative to project root (e.g. src/app.ts)"),
        content: z.string().describe("Full file content to write"),
      }),
      execute: async ({ file_path, content }) => {
        const abs = path.resolve(projectDir, file_path)
        if (!Filesystem.contains(projectDir, abs)) {
          return `Error: path escapes project root — ${file_path}`
        }
        try {
          await fs.mkdir(path.dirname(abs), { recursive: true })
          await fs.writeFile(abs, content, "utf8")
          log.info("delivery agent wrote file", { file_path })
          return `Written: ${file_path} (${content.length} chars)`
        } catch (e) {
          log.warn("write_file failed in delivery agent", { file_path, err: e })
          return `Error writing ${file_path}: ${e instanceof Error ? e.message : String(e)}`
        }
      },
    }),

    edit_file: tool({
      description:
        "Replace an exact string in a file. The old_string must match exactly (including whitespace). " +
        "Use for surgical fixes — prefer this over write_file when changing a small section. " +
        "Always re-run the relevant check after editing to confirm the fix.",
      inputSchema: z.object({
        file_path: z.string().describe("Path relative to project root"),
        old_string: z.string().describe("Exact text to find and replace"),
        new_string: z.string().describe("Replacement text"),
      }),
      execute: async ({ file_path, old_string, new_string }) => {
        const abs = path.resolve(projectDir, file_path)
        if (!Filesystem.contains(projectDir, abs)) {
          return `Error: path escapes project root — ${file_path}`
        }
        try {
          const original = await fs.readFile(abs, "utf8")
          if (!original.includes(old_string)) {
            return `Error: old_string not found in ${file_path} — verify whitespace and content match exactly`
          }
          const updated = original.replace(old_string, new_string)
          await fs.writeFile(abs, updated, "utf8")
          log.info("delivery agent edited file", { file_path })
          return `Edited: ${file_path}`
        } catch (e) {
          log.warn("edit_file failed in delivery agent", { file_path, err: e })
          return `Error editing ${file_path}: ${e instanceof Error ? e.message : String(e)}`
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
