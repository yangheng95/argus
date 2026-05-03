/**
 * Tool set for the DeliveryAgent.
 *
 * Includes exploration tools, execution tools, screenshot tools, follow-up
 * task tools, and memory tools. Delivery is review-only: it verifies runtime
 * behavior and makes the final acceptance decision, while repair belongs to
 * orchestrator retry/replan and build agents.
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
import {
  captureRuntimePage,
  normalizeRuntimeCaptureRequest,
  normalizeRuntimeCaptureViewport,
  type RuntimeCaptureRequest,
} from "@/delivery/runtime-capture"
import { buildMultimodalToolResult } from "@/delivery/tool-result"
import { AttachmentStore } from "@/storage/attachment-store"
import { buildTaskUpstreamAgentContextSections } from "@/prompt/upstream-context"
import type { DeliveryInfo, GoalInfo } from "@/delivery/checks"

const TASK_CHAIN_DEPTH_LIMIT = 3
const log = Log.create({ service: "delivery-tools" })

type DeliveryToolAttachment = {
  sha: string
  url: string
  mime: string
  size: number
  filename?: string
  intent?: string
  source?: string
}

type DeliveryToolContext = {
  sessionID?: string
  taskID?: string
  goals?: GoalInfo[]
  delivery?: DeliveryInfo
  attachments?: DeliveryToolAttachment[]
}

export function normalizeDeliveryScreenshotViewport(input: { width: number; height: number }): {
  width: number
  height: number
  capped: boolean
} {
  return normalizeRuntimeCaptureViewport(input)
}

export function normalizeVerifyPageIntegrityInput(args: RuntimeCaptureRequest) {
  return normalizeRuntimeCaptureRequest(args)
}

/**
 * Creates the tool set for the DeliveryAgent.
 *
 * Includes:
 * - 4 codebase read tools: read_file, find_files, search_code, list_directory
 * - 2 memory tools: memory_search, memory_write
 * - 1 execution tool: run_command (for builds, startup checks)
 */
export function createDeliveryTools(input?: DeliveryToolContext) {
  const codebase = createCodebaseTools()
  const projectId = Instance.project.id
  const projectDir = Filesystem.resolve(Instance.directory)
  const taskID = input?.taskID
  const deliveryContext = {
    taskID,
    goals: input?.goals ?? [],
    delivery: input?.delivery,
    attachments: input?.attachments ?? [],
  }

  return {
    ...codebase,

    inspect_delivery_context: tool({
      description:
        "Fetch detailed delivery context on demand. The startup prompt is intentionally compact to avoid " +
        "provider input overflow; use this tool when you need full goal acceptance details, upstream contracts, " +
        "manifest failures, host gate evidence, executor claims, changed files, diffs, or attachment inventory. " +
        "Do not ask for sections you do not need.",
      inputSchema: z.object({
        section: z.enum([
          "overview",
          "goals",
          "upstream_context",
          "manifest",
          "host_gate_failures",
          "runtime_failures",
          "visual_failures",
          "executor_reports",
          "changed_files",
          "diffs",
          "attachments",
        ]),
        max_chars: z.number().int().min(1_000).max(40_000).default(12_000),
      }),
      execute: async ({ section, max_chars }) => {
        const text = renderDeliveryContextSection(deliveryContext, section)
        return truncateToolText(text, max_chars)
      },
    }),

    compare_visual_artifacts: tool({
      description:
        "Load visual artifacts only when visual comparison is needed. Returns the selected rendered output " +
        "and reference image(s) as multimodal tool-result attachments plus a small JSON inventory. This is " +
        "the only delivery path that loads task image bytes; the startup prompt deliberately does not inline screenshots.",
      inputSchema: z.object({
        rendered: z.string().optional().describe("Optional rendered output filename or sha. Defaults to the first rendered_output attachment."),
        reference: z.string().optional().describe("Optional reference filename or sha. Defaults to the first non-rendered image attachment."),
        include_all_references: z.boolean().default(false).describe("Attach every reference image instead of one selected reference."),
      }),
      execute: async ({ rendered, reference, include_all_references }) => {
        const images = deliveryContext.attachments.filter((item) => item.mime.startsWith("image/"))
        if (images.length === 0) return "compare_visual_artifacts: no image artifacts are available for this delivery."

        const renderedImages = images.filter((item) => item.intent === "rendered_output")
        const referenceImages = images.filter((item) => item.intent !== "rendered_output")
        const renderedMatch = selectVisualArtifact(renderedImages, rendered) ?? renderedImages[0]
        const referenceMatches = include_all_references
          ? referenceImages
          : [selectVisualArtifact(referenceImages, reference) ?? referenceImages[0]].filter((item): item is DeliveryToolAttachment => Boolean(item))

        const selected = [renderedMatch, ...referenceMatches].filter((item): item is DeliveryToolAttachment => Boolean(item))
        if (selected.length === 0) {
          return [
            "compare_visual_artifacts: no selectable visual pair.",
            `rendered_outputs=${renderedImages.length}`,
            `references=${referenceImages.length}`,
          ].join("\n")
        }

        const imageFiles = selected.map((item) => {
          const located = AttachmentStore.nameFromUrl(item.url)
          if (!located) throw new Error(`compare_visual_artifacts: attachment ${item.filename ?? item.sha} has no resolvable url`)
          const absPath = AttachmentStore.resolveAbsolute(located.projectID, located.name)
          if (!absPath) throw new Error(`compare_visual_artifacts: attachment ${located.projectID}/${located.name} is not resolvable on disk`)
          return {
            path: absPath,
            mime: item.mime,
            filename: item.filename ?? `${item.intent ?? "visual"}-${item.sha.slice(0, 12)}`,
          }
        })

        return await buildMultimodalToolResult({
          text: JSON.stringify({
            rendered_output: renderedMatch ? describeVisualArtifact(renderedMatch) : null,
            references: referenceMatches.map(describeVisualArtifact),
            instructions: [
              "Compare rendered output against the reference image(s) directly.",
              "Reject obvious blank/error/mismatched layouts with category='visual'.",
              "Cite concrete layout, spacing, color, typography, component, or text differences in rejection_details.",
            ],
          }, null, 2),
          images: imageFiles,
        })
      },
    }),

    query_metric_trajectory: tool({
      description:
        "Read the adversarial metric trajectory and the current iteration's metric results. " +
        "Use this BEFORE deciding the verdict so you see which blocking metrics are unmet, " +
        "which counterexamples are open, and whether the loop is making progress. The output " +
        "lists per-iteration aggregate scores, deltas, open counterexample counts, and the " +
        "current iteration's per-metric results with freshness flags. This trajectory is " +
        "supporting evidence for delivery and orchestrator rework decisions — ground your " +
        "verdict in this signal rather than guessing from the diff alone.",
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
            `iter=${it.iteration} trajectory=${it.arbiter_verdict} S_k=${it.aggregate_score.toFixed(3)} ΔS=${it.delta_vs_prev.toFixed(3)} blocking_unmet=${it.blocking_unmet_count} open_ce=${it.open_counterexamples} novelty=${it.novelty_score} regressed=${it.regressed_blocking}`,
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

    run_command: tool({
      description:
        "Run a shell command in the project directory and capture stdout/stderr/exit code. " +
        "Use to build the project, start servers, run smoke tests, or verify the requested runtime/output surface. " +
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

    screenshot: tool({
      description:
        "Capture a PNG screenshot of an already running app URL via the delivery runtime capture engine and write it to the " +
        "project's .opencorvus/delivery-screenshots/ directory. Use this to produce visual evidence " +
        "that the running application actually renders, or to capture before/after images around a " +
        "fix. The screenshot is saved to disk; reference the returned absolute path and sha when " +
        "citing this call in submit_verdict.tool_call_evidence. The tool returns the shot's size " +
        "(bytes + dimensions) and a pixel-variance signal — a near-zero variance means the page " +
        "rendered blank/uniform (JSON error, pre-hydration stub, loading state) and the capture " +
        "itself does NOT count as a passed check. Capture viewport is capped at 1440x1080 " +
        "inside Puppeteer only; it never changes the host display resolution. The PNG bytes are not attached to the delivery " +
        "context; use compare_visual_artifacts when a visual comparison needs image bytes.",
      inputSchema: z.object({
        url: z.string().describe("Absolute http(s) URL for an already running app. If you only have files, start the app with run_command or use the frontend preview resolver first; this tool never starts servers or serves static files."),
        viewport_width: z.number().int().min(100).max(4096).default(1440).describe("Viewport width in CSS pixels."),
        viewport_height: z.number().int().min(100).max(4096).default(1080).describe("Viewport height in CSS pixels."),
        label: z.string().optional().describe("Short label used in the output filename, e.g. 'after-fix-1' or 'chart-area'. Alphanum / dash only."),
      }),
      execute: async ({ url, viewport_width, viewport_height, label }) => {
        const safeLabel = (label ?? "shot").replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 40) || "shot"
        const outDir = path.join(projectDir, ".opencorvus", "delivery-screenshots")
        await fs.mkdir(outDir, { recursive: true })
        const stamp = new Date().toISOString().replace(/[:.]/g, "-")
        const captureDir = path.join(outDir, `${stamp}-${safeLabel}`)
        try {
          const capture = await captureRuntimePage({
            url,
            outDir: captureDir,
            viewport_width,
            viewport_height,
            fileLabel: safeLabel,
          })
          if (!capture.captured) {
            return JSON.stringify(capture, null, 2)
          }
          const variance = capture.layers.pixel.variance
          return JSON.stringify(
            {
              ok: true,
              path: capture.path,
              sha: capture.sha,
              bytes: capture.bytes,
              width: capture.size.width,
              height: capture.size.height,
              requested_viewport: capture.requested_viewport,
              viewport: capture.viewport,
              viewport_capped: capture.viewport.capped,
              pixel_variance: Number(variance.toFixed(2)),
              degenerate: variance < 25,
              note: variance < 25
                ? "Pixel variance < 25 — the screenshot is near-uniform (blank page, JSON error body, or unhydrated shell). Do NOT count as a passed visual check."
                : undefined,
            },
            null,
            2,
          )
        } catch (err) {
          log.warn("screenshot failed", { url, err })
          // P0-0: failures stay text-only — there is no PNG to attach. Do NOT
          // return a stale prior-run image (rule 1: no fallback that lies
          // about what was captured this turn).
          return `screenshot failed: ${err instanceof Error ? err.message : String(err)}`
        }
      },
    }),

    verify_page_integrity: tool({
      description:
        "Hard verification that a URL actually serves a live, interactive application — NOT a curl " +
        "bypass. One runtime capture session attaches 5 observers (request failures, response bodies, " +
        "console errors, page errors, unhandled rejections) and runs six checks simultaneously:\n" +
        "  1. HTTP: status 2xx + content-type text/html + body ≥ 200B at the page URL.\n" +
        "  2. Asset: every <script src>/<link href>/<img src> loads with status 2xx (no 404/blocked).\n" +
        "  3. DOM: the root element has ≥ min_dom_descendants subtree nodes (hydration check).\n" +
        "  4. JS: zero pageerror events + zero console.error events during load.\n" +
        "  5. Pixel: rendered screenshot pixel-variance ≥ 25 (rejects blank / JSON error pages).\n" +
        "  6. Expected: every expect_selectors entry present and every expect_texts entry found in " +
        "     the body's textContent.\n" +
        "Returns a structured report per layer. The call PASSES only when every layer with an " +
        "assertion passes — any single layer failure marks the whole call failed. Cite the returned " +
        "JSON in submit_verdict.tool_call_evidence with detail=the failure list (or the key numbers " +
        "when passed).",
      inputSchema: z.object({
        url: z.string().describe("http(s):// URL the app is listening on. If you only have a local file path, run the project's server first via run_command and target the listening URL."),
        viewport_width: z.number().int().min(100).max(4096).default(1440),
        viewport_height: z.number().int().min(100).max(4096).default(1080),
        min_dom_descendants: z.number().int().min(1).max(10000).default(20).describe("Minimum descendant count under document.body. 20 is a reasonable floor for any non-trivial app shell."),
        expect_selectors: z.array(z.string()).default([]).describe("CSS selectors that MUST resolve to at least one element. Cite ids/classes from your spec."),
        expect_texts: z.array(z.string()).default([]).describe("Substrings that MUST appear in document.body.textContent (case-sensitive). Use for headers, visible labels, data markers."),
        wait_for_selector: z.string().optional().describe("Optional CSS selector to wait for before assertions run (e.g. '.chart canvas'). Default: load + settle without selector wait."),
        wait_timeout_ms: z.number().int().min(1000).max(120000).default(30000),
      }),
      execute: async (rawArgs) => {
        const args = normalizeVerifyPageIntegrityInput(rawArgs)
        const outDir = path.join(
          projectDir,
          ".opencorvus",
          "delivery-screenshots",
          `verify-${new Date().toISOString().replace(/[:.]/g, "-")}`,
        )
        const capture = await captureRuntimePage({
          url: args.url,
          outDir,
          viewport_width: args.viewport_width,
          viewport_height: args.viewport_height,
          min_dom_descendants: args.min_dom_descendants,
          expect_selectors: args.expect_selectors,
          expect_texts: args.expect_texts,
          wait_for_selector: args.wait_for_selector,
          wait_timeout_ms: args.wait_timeout_ms,
          settle_ms: args.settle_ms,
          fileLabel: "verify",
        })
        const report = capture.captured
          ? {
              url: capture.url,
              passed: capture.passed,
              requested_viewport: capture.requested_viewport,
              viewport: capture.viewport,
              layers: capture.layers,
              summary: capture.summary,
            }
          : capture
        return JSON.stringify(report, null, 2)
      },
    }),

  }
}

type DeliveryContextSection =
  | "overview"
  | "goals"
  | "upstream_context"
  | "manifest"
  | "host_gate_failures"
  | "runtime_failures"
  | "visual_failures"
  | "executor_reports"
  | "changed_files"
  | "diffs"
  | "attachments"

function renderDeliveryContextSection(
  input: {
    taskID?: string
    goals: GoalInfo[]
    delivery?: DeliveryInfo
    attachments: DeliveryToolAttachment[]
  },
  section: DeliveryContextSection,
): string {
  const delivery = input.delivery
  switch (section) {
    case "overview":
      return [
        "# Delivery Context Overview",
        `task_id=${input.taskID ?? "(none)"}`,
        `goals=${input.goals.length}`,
        `changed_files=${delivery?.changedFiles.length ?? 0}`,
        `executor_reports=${delivery?.goalReports?.length ?? 0}`,
        `diffs=${delivery?.diffs?.length ?? 0}`,
        `attachments=${input.attachments.length}`,
        `manifest_status=${delivery?.manifestGate?.status ?? "(none)"}`,
      ].join("\n")

    case "goals":
      return "# Goals\n\n" + input.goals.map(renderGoalDetail).join("\n\n---\n\n")

    case "upstream_context":
      if (!input.taskID) return "No task_id is available; upstream context cannot be loaded."
      return buildTaskUpstreamAgentContextSections(input.taskID).join("\n\n---\n\n") || "No upstream context found."

    case "manifest":
      return renderManifestContext(delivery)

    case "host_gate_failures":
      return renderHostGateFailures(delivery)

    case "runtime_failures":
      return "# Runtime Evidence Failures\n\n" + ((delivery?.runtimeEvidenceFailures ?? []).map((item) => `- ${item}`).join("\n") || "(none)")

    case "visual_failures":
      return "# Visual Metric Failures\n\n" + ((delivery?.visualMetricFailures ?? []).map((item) => `- ${item}`).join("\n") || "(none)")

    case "executor_reports":
      return renderExecutorReports(delivery)

    case "changed_files":
      return "# Changed Files\n\n" + ((delivery?.changedFiles ?? []).map((file) => `- ${file}`).join("\n") || "(none)")

    case "diffs":
      return "# Code Diffs\n\n" + ((delivery?.diffs ?? [])
        .filter((item) => item.diff)
        .map((item) => `--- ${item.file} ---\n${item.diff}`)
        .join("\n\n") || "(none)")

    case "attachments":
      return renderAttachmentToolInventory(input.attachments)
  }
}

function renderGoalDetail(goal: GoalInfo): string {
  return [
    `## ${goal.title}`,
    `id=${goal.id}`,
    `priority=${goal.priority}`,
    `acceptance_spec_count=${goal.acceptance_spec_count ?? 0}`,
    `runtime_scenario_count=${goal.runtime_scenario_count ?? 0}`,
    goal.requirement_ids.length > 0 ? `requirement_ids=${goal.requirement_ids.join(", ")}` : "requirement_ids=(none)",
    goal.depends_on.length > 0 ? `depends_on=${goal.depends_on.join(", ")}` : "depends_on=(none)",
    goal.imports.length > 0 ? `imports=${goal.imports.join(", ")}` : "imports=(none)",
    goal.exports.length > 0 ? `exports=${goal.exports.join(", ")}` : "exports=(none)",
    goal.owned_paths.length > 0 ? `owned_paths=${goal.owned_paths.join(", ")}` : "owned_paths=(none)",
    "",
    "Objective:",
    goal.description,
    "",
    "Acceptance specs:",
    goal.criteria,
  ].join("\n")
}

function renderManifestContext(delivery: DeliveryInfo | undefined): string {
  if (!delivery?.manifestGate) return "No DeliveryEvidenceManifest gate is available."
  const gate = delivery.manifestGate
  const lines = [
    "# DeliveryEvidenceManifest Gate",
    `finalGate.status=${gate.status}`,
    `summary=${gate.summary}`,
    `failedCheckIds=${gate.failedCheckIds.join(", ") || "(none)"}`,
    `failedCoverageIds=${gate.failedCoverageIds.join(", ") || "(none)"}`,
    `failedRuntimeFlowIds=${gate.failedRuntimeFlowIds.join(", ") || "(none)"}`,
    `failedReviewIds=${gate.failedReviewIds.join(", ") || "(none)"}`,
  ]
  const details = delivery.manifestFailureDetails ?? []
  if (details.length > 0) {
    lines.push("", "Failure details:")
    for (const item of details) {
      const status = item.status ? ` status=${item.status}` : ""
      const exitCode = item.exitCode === undefined ? "" : ` exit=${item.exitCode}`
      const command = item.command ? ` command=${item.command}` : ""
      lines.push(`- [${item.kind}] ${item.id} ${item.name}${status}${exitCode}${command}: ${item.evidence}`)
    }
  }
  return lines.join("\n")
}

function renderHostGateFailures(delivery: DeliveryInfo | undefined): string {
  const failures = delivery?.hostGateFailures ?? []
  if (failures.length === 0) return "No host gate findings."
  // These are advisory by default — only `kind: "manifest"` when finalGate
  // failed represents a true blocker (functional completion / required-check
  // primary failure). Runtime and visual entries are warnings the agent may
  // surface in deferred_checks but does not need to reject on by themselves.
  const lines = ["# Host Gate Findings (manifest entries are blockers; runtime/visual are advisory)"]
  for (const failure of failures) {
    lines.push("", `## ${failure.kind}:${failure.id}`, `Summary: ${failure.summary}`)
    if (failure.evidence.length > 0) {
      lines.push("Evidence:")
      for (const item of failure.evidence) lines.push(`- ${item}`)
    }
  }
  return lines.join("\n")
}

function renderExecutorReports(delivery: DeliveryInfo | undefined): string {
  const reports = delivery?.goalReports ?? []
  if (reports.length === 0) return "No executor reports."
  const blocks: string[] = []
  for (const entry of reports) {
    const r = entry.report
    const parts: string[] = []
    parts.push(`## Goal: ${entry.goalTitle}`)
    parts.push("")
    parts.push("### Implementation Approach")
    parts.push(r.implementation_approach.trim())
    if (r.design_decisions.length > 0) {
      parts.push("", "### Design Decisions")
      for (const d of r.design_decisions) {
        parts.push(`- ${d.choice}`)
        if (d.alternatives.length > 0) parts.push(`  - Alternatives considered: ${d.alternatives.join(", ")}`)
        parts.push(`  - Reason: ${d.reason}`)
      }
    }
    if (r.files_changed.length > 0) {
      parts.push("", "### Files Claimed Changed")
      for (const f of r.files_changed) parts.push(`- ${f.path} — ${f.summary}`)
    }
    if (r.checks_run.length > 0) {
      parts.push("", "### Checks the Executor Ran")
      for (const c of r.checks_run) {
        const forbidden = forbiddenCheckReason(c.command)
        const suffix = forbidden ? ` [FORBIDDEN: ${forbidden}; not acceptance evidence]` : ""
        const output = c.output_excerpt ? `\n  output_excerpt: ${c.output_excerpt}` : ""
        parts.push(`- ${c.name} \`${c.command}\` -> exit ${c.exit_code}${suffix}${output}`)
      }
    }
    if (r.blockers.length > 0) {
      parts.push("", "### Blockers Reported")
      for (const b of r.blockers) parts.push(`- ${b}`)
    }
    blocks.push(parts.join("\n"))
  }
  return "# Executor Reports\n\n" + blocks.join("\n\n---\n\n")
}

function renderAttachmentToolInventory(attachments: DeliveryToolAttachment[]): string {
  if (attachments.length === 0) return "No attachments."
  return "# Attachments\n\n" + attachments.map((item) => {
    const sizeKb = `${Math.max(1, Math.round(item.size / 1024))} KB`
    return `- ${item.filename ?? item.sha} mime=${item.mime} intent=${item.intent ?? "(none)"} size=${sizeKb} sha=${item.sha} url=${item.url}`
  }).join("\n")
}

function selectVisualArtifact(
  artifacts: DeliveryToolAttachment[],
  selector: string | undefined,
): DeliveryToolAttachment | undefined {
  if (!selector) return undefined
  const wanted = selector.trim()
  if (!wanted) return undefined
  return artifacts.find((item) => item.sha === wanted || item.sha.startsWith(wanted) || item.filename === wanted)
}

function describeVisualArtifact(item: DeliveryToolAttachment) {
  return {
    filename: item.filename,
    sha: item.sha,
    mime: item.mime,
    size: item.size,
    intent: item.intent,
    source: item.source,
  }
}

function truncateToolText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + `\n... (truncated by inspect_delivery_context at ${maxChars} chars; request a narrower section for more detail)`
}

function forbiddenCheckReason(rawCommand: string): string | undefined {
  const command = rawCommand.trim()
  if (!command) return
  const stripped = command
    .replace(/^bash\s+-c\s+(['"])(.+)\1\s*$/, "$2")
    .replace(/^sh\s+-c\s+(['"])(.+)\1\s*$/, "$2")
    .trim()
  if (/^\[?\s*test\s+-[fdeLhsr]\b/.test(stripped)) return "test -f / file-existence is not acceptance evidence"
  if (/^\[\s+-[fdeLhsr]\b/.test(stripped)) return "[ -f ] / file-existence is not acceptance evidence"
  if (/^(?:grep|egrep|fgrep|rg|ripgrep)\b/.test(stripped)) return "self-keyword grep on own artifacts is not acceptance evidence"
  if (/^find\b[^|;&]*-name\b/.test(stripped)) return "find -name / file-discovery is not acceptance evidence"
  if (/^ls\b\s+(-[a-zA-Z]+\s+)?\S+/.test(stripped) && !/[|;&]/.test(stripped)) return "ls / file-listing is not acceptance evidence"
  if (/^cat\b/.test(stripped) && !/[|;&]/.test(stripped)) return "cat of own artifact is not acceptance evidence"
  return
}
