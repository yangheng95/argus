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
import { createCodebaseTools } from "@/engine/codebase-tools"
import { Memory } from "@/memory"
import { Instance } from "@/project/instance"
import { Shell } from "@/shell/shell"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"
import { EngineService } from "@/task-api"
import { findTask } from "@/engine/store"

const TASK_CHAIN_DEPTH_LIMIT = 3

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

    query_metric_trajectory: tool({
      description:
        "Read the adversarial metric trajectory and the current iteration's metric results. " +
        "Use this BEFORE deciding the verdict so you see which blocking metrics are unmet, " +
        "which counterexamples are open, and whether the loop is making progress. The output " +
        "lists per-iteration aggregate scores, deltas, open counterexample counts, and the " +
        "current iteration's per-metric results with freshness flags. There is no strict/soft " +
        "gating here — the Arbiter consumes this same data to choose continue / accept / " +
        "stalled / abort. Your job is to ground your verdict in this signal rather than " +
        "guessing from the diff alone.",
      inputSchema: z.object({
        window: z.number().int().min(1).max(20).default(5).describe("Number of recent iterations to surface."),
      }),
      execute: async ({ window }) => {
        if (!taskID) return "query_metric_trajectory: no task context available"
        const {
          readIterationHistory,
          readResultsForIteration,
          readSpecsForTask,
          readCounterexamplesForTask,
        } = await import("@/metrics/store")
        const history = readIterationHistory(taskID)
        const tail = history.slice(-window)
        const currentIter = history.length > 0 ? history[history.length - 1].iteration : 0
        const results = readResultsForIteration(taskID, currentIter)
        const specs = new Map(readSpecsForTask(taskID).map((s) => [s.id, s]))
        const ces = readCounterexamplesForTask(taskID)
        const open = ces.filter((c) => c.iteration_resolved === null)

        const lines: string[] = []
        lines.push(`## Trajectory (last ${tail.length} iterations)`)
        if (tail.length === 0) {
          lines.push("(no iterations recorded yet)")
        }
        for (const it of tail) {
          lines.push(
            `iter=${it.iteration} verdict=${it.arbiter_verdict} S_k=${it.aggregate_score.toFixed(3)} ΔS=${it.delta_vs_prev.toFixed(3)} blocking_unmet=${it.blocking_unmet_count} open_ce=${it.open_counterexamples} novelty=${it.novelty_score} regressed=${it.regressed_blocking}`,
          )
        }
        lines.push("")
        lines.push(`## Current iteration (${currentIter}) metric results`)
        if (results.length === 0) {
          lines.push("(no metric results for this iteration — executor may not have run yet)")
        }
        for (const r of results) {
          const spec = specs.get(r.metric_spec_id)
          if (!spec) continue
          const scope = spec.scope === "goal" ? `goal=${spec.goal_id}` : "global"
          lines.push(
            `- ${spec.name} [${scope}, ${spec.gate_class}, ${spec.evaluator_kind}] raw=${r.raw_value.toFixed(3)} norm=${r.normalized_value.toFixed(3)} met_target=${r.met_target} met_floor=${r.met_floor} fresh=${r.evidence_fresh}`,
          )
        }
        if (open.length > 0) {
          lines.push("")
          lines.push(`## Open counterexamples (${open.length})`)
          for (const c of open) {
            lines.push(`- ${c.id} [${c.target_scope}/${c.target_ref}, ${c.severity}] ${c.claim.slice(0, 140)}`)
          }
        }
        void findTask
        return lines.join("\n")
      },
    }),

    /** Drill-down into a single evaluation-evidence row. Use when
     *  query_metric_trajectory flags a stuck metric or open counterexample
     *  and you need the raw scorer detail for rejection_details. */
    query_evidence: tool({
      description:
        "Drill down into a single verification-evidence row — raw scorer detail " +
        "(spec_id, scorer_kind, exit_code, output digest) for one goal's latest " +
        "goal_run evidence, a specific goal_run, or the latest delivery-scope " +
        "evidence. Use this after query_metric_trajectory when you need to cite " +
        "a specific failing scorer in rejection_details.",
      inputSchema: z.object({
        scope: z
          .enum(["goal_run", "delivery"])
          .describe(
            'Which evidence scope to read. "goal_run" for a specific goal\'s latest at-exit evaluation; "delivery" for the merged-worktree result.',
          ),
        goal_id: z
          .string()
          .optional()
          .describe('Required when scope="goal_run". Ignored for "delivery".'),
        goal_run_id: z
          .string()
          .optional()
          .describe(
            'Optional: when set with scope="goal_run", returns evidence for THAT specific run rather than the latest for the goal.',
          ),
      }),
      execute: async ({ scope, goal_id, goal_run_id }) => {
        if (!taskID) return "query_evidence: no task context available"
        try {
          const { queryEvidence, renderEvidence } = await import("@/verification")
          const evidence = queryEvidence({
            scope,
            goalID: goal_id,
            goalRunID: goal_run_id,
            taskID,
          })
          if (!evidence) {
            return `query_evidence: no ${scope} evidence found yet${goal_id ? ` for goal ${goal_id}` : ""}${goal_run_id ? ` (goal_run=${goal_run_id})` : ""}.`
          }
          return renderEvidence(evidence)
        } catch (err) {
          return `query_evidence error: ${err instanceof Error ? err.message : String(err)}`
        }
      },
    }),

    submit_next_task: tool({
      description:
        "Spawn a follow-up task in the same project. Use this whenever what " +
        "needs to happen next belongs in a fresh task rather than inside this " +
        "one. Common shapes:\n" +
        "  - Fix: repair failed acceptance criteria that need another executor " +
        "pass. Pick priority='critical' so it jumps the queue ahead of new " +
        "user work (but never preempts an already-active task).\n" +
        "  - Iterate: continue the project's work — next milestone, hardening " +
        "pass, follow-up feature surfaced during this round. Normal priority.\n" +
        "  - Recommend: surface a suggested next step to the user. Low " +
        "priority; it waits for the user (or queue) to promote it.\n" +
        "The new task links back via `metadata.parent_task`, and chain depth " +
        "is bounded to " + TASK_CHAIN_DEPTH_LIMIT + " to prevent runaway chains. " +
        "When `failing_metrics` is provided, the latest iteration's metric " +
        "results for those names are auto-attached to the new task's request.",
      inputSchema: z.object({
        title: z.string().describe(
          "Short task title, e.g. 'Repair sidebar layout' or 'Add filter chip to feed'.",
        ),
        request: z.string().describe(
          "Full task description — what the new task should accomplish, with " +
          "enough context that a fresh agent run (not this one) can act on it.",
        ),
        priority: z.enum(["critical", "high", "normal", "low"]).describe(
          "Queue priority. 'critical' jumps ahead of all user-submitted work — " +
          "reserve it for repairing verification failures. 'high'/'normal'/'low' " +
          "for iteration and recommendation tasks, matching urgency.",
        ),
        failing_metrics: z.array(z.string()).optional().describe(
          "Optional: canonical names of metrics currently failing (e.g. " +
          "'functional_correctness', 'user_intent_fidelity'). The latest " +
          "iteration's result rows are attached to the new task request.",
        ),
        scope_files: z.array(z.string()).optional().describe(
          "Optional list of files the next task should focus on (relative to project root).",
        ),
      }),
      execute: async ({ title, request, priority, failing_metrics, scope_files }) => {
        if (!taskID) return "submit_next_task: no task context available"
        const original = findTask(taskID)
        if (!original) return `submit_next_task: original task ${taskID} not found`
        const meta = (original.metadata as Record<string, unknown> | null) ?? {}
        const depth = typeof meta.task_chain_depth === "number" ? meta.task_chain_depth : 0
        if (depth >= TASK_CHAIN_DEPTH_LIMIT) {
          return `submit_next_task: task chain depth ${depth} reached limit ${TASK_CHAIN_DEPTH_LIMIT}; refusing to spawn another follow-up task`
        }
        let evidenceBlock = ""
        if (failing_metrics && failing_metrics.length > 0) {
          const {
            readIterationHistory,
            readResultsForIteration,
            readSpecsForTask,
          } = await import("@/metrics/store")
          const history = readIterationHistory(taskID)
          const currentIter = history.length > 0 ? history[history.length - 1].iteration : 0
          const results = readResultsForIteration(taskID, currentIter)
          const specs = new Map(readSpecsForTask(taskID).map((s) => [s.id, s]))
          const wanted = new Set(failing_metrics)
          const matched = results
            .map((r) => ({ r, spec: specs.get(r.metric_spec_id) }))
            .filter((x) => x.spec && wanted.has(x.spec.name))
          evidenceBlock = matched.length > 0
            ? "\n\n## Failing metrics from previous iteration\n" + matched
                .map(({ r, spec }) =>
                  `- **${spec!.name}** [${spec!.gate_class}]: raw=${r.raw_value.toFixed(3)} met_target=${r.met_target} met_floor=${r.met_floor} fresh=${r.evidence_fresh}\n  evidence_ref: ${String(r.evidence_ref).slice(0, 400)}`,
                )
                .join("\n") + "\n\nAddress every failing metric above. Do not regress metrics that currently pass."
            : "\n\n## Failing metrics (no matching results in current iteration — query_metric_trajectory first)\n" +
              failing_metrics.map((n) => `- **${n}**`).join("\n")
        }
        const scopeBlock = scope_files && scope_files.length > 0
          ? `\n\n## Scope (focus area)\n${scope_files.map((f) => `- ${f}`).join("\n")}`
          : ""
        const fullRequest = [
          `# Follow-up task — derived from \`${original.id}\` ("${original.title}")`,
          ``,
          request,
          ``,
          `## Original request`,
          original.request,
          evidenceBlock,
          scopeBlock,
        ].join("\n")
        const newTaskID = await EngineService.createTask({
          title: title.slice(0, 80),
          request: fullRequest,
          priority,
          metadata: {
            ...meta,
            parent_task: original.id,
            task_chain_depth: depth + 1,
            ...(failing_metrics && failing_metrics.length > 0 ? { failing_metrics } : {}),
            ...(scope_files && scope_files.length > 0 ? { next_task_scope_files: scope_files } : {}),
          },
        })
        return `submit_next_task: created new task ${newTaskID} (priority=${priority}, task_chain_depth=${depth + 1}). It enters the queue at the requested priority.`
      },
    }),

    memory_search: tool({
      description:
        "Search project memory for prior delivery failures, known runtime issues, or startup problems. " +
        "Use when investigating why the application fails to start or render correctly.",
      inputSchema: z.object({
        query: z.string().describe("Search query — keywords about the failure or pattern"),
        max_results: z.number().default(5).describe("Max results"),
      }),
      execute: async ({ query, max_results }) => {
        try {
          const results = Memory.search({
            query,
            projectId,
            sessionID: input?.sessionID,
            scope: "all",
            limit: max_results,
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
        kind: z.enum(["fact", "lesson", "episode"]).default("lesson").describe("Memory kind"),
      }),
      execute: async ({ title, content, kind }) => {
        try {
          const file = Memory.writeFile({
            title,
            content,
            source: "agent",
            projectId,
            scope: "global",
            kind,
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
        "the server starts without crashing — do NOT keep servers running indefinitely.\n\n" +
        "If you background a process (`cmd &`) and it keeps the port alive past this call's " +
        "timeout, note the returned `pid` line — that is the PID of the SHELL that spawned " +
        "your backgrounded child, and you can target its whole tree on a later turn with " +
        "`taskkill /F /T /PID <pid>` (Windows) or `kill -TERM -- -<pid>` (Unix). Prefer " +
        "that over `netstat | findstr :3000` guessing — the shell's own PID is deterministic.",
      inputSchema: z.object({
        command: z.string().describe("Shell command to run (runs in project root)"),
        timeout_ms: z.number().default(120_000).describe("Max execution time ms"),
      }),
      execute: async ({ command, timeout_ms }) => {
        try {
          const result = await Shell.run(command, {
            cwd: projectDir,
            env: process.env,
            timeoutMs: timeout_ms,
          })
          const parts = [`exit_code: ${result.exitCode}`]
          if (typeof result.pid === "number") parts.push(`pid: ${result.pid}`)
          if (result.timedOut) parts.push(`timeout_ms: ${timeout_ms}`)
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
