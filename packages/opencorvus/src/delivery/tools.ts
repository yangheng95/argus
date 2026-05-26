/**
 * Legacy delivery evidence tool set.
 *
 * Integrity acceptance review reuses the evidence-gathering subset through
 * `integrity/acceptance-tools.ts`. The retired legacy runtime no longer owns
 * these tools.
 */
import { tool } from "ai"
import z from "zod"
import fs from "fs/promises"
import path from "path"
import { createTwoFilesPatch, diffLines } from "diff"
import { createCodebaseTools } from "@/engine/codebase-tools"
import { Memory } from "@/memory"
import { Instance } from "@/project/instance"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { Shell } from "@/shell/shell"
import { DEFAULT_BASH_TIMEOUT_MS } from "@/shell/timeout"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"
import {
  findActiveSpecForTask,
  findDeliveriesForTask,
  findRequirements,
  findTask,
  listGoalRunsForTask,
  listGoals,
} from "@/engine/store"
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
import type { AcceptanceSpec } from "@/acceptance/types"
import { createDecisionLog } from "@/decision-log"
import { renderIntegrityMarkdown } from "@/integrity/render-markdown"
import { parsedRequirementFromRow } from "@/requirements/row"

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

export type DeliveryToolContext = {
  sessionID?: string
  taskID?: string
  deliveryID?: string
  goals?: GoalInfo[]
  delivery?: DeliveryInfo
  attachments?: DeliveryToolAttachment[]
  signal?: AbortSignal
  readOnlyCommandGuard?: boolean
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

async function runDeliveryIntegrityReview(input: { taskID?: string; parentSessionID?: string; signal?: AbortSignal }) {
  if (!input.taskID) {
    throw new Error("run_integrity_review requires taskID in the delivery tool context")
  }
  if (!input.parentSessionID) {
    throw new Error("run_integrity_review requires delivery session context so the integrity card has a parent session")
  }

  const task = findTask(input.taskID)
  if (!task) throw new Error(`run_integrity_review: task ${input.taskID} not found`)
  const activeSpec = findActiveSpecForTask(task.id)
  if (!activeSpec) throw new Error(`run_integrity_review: task ${task.id} has no active spec snapshot`)
  const dbGoals = listGoals(task.id).filter((goal) => goal.spec_snapshot_id === activeSpec.id)
  if (dbGoals.length === 0) throw new Error(`run_integrity_review: spec ${activeSpec.id} has no goals`)

  if (task.attachments !== null && task.attachments !== undefined && !Array.isArray(task.attachments)) {
    throw new Error(`run_integrity_review: task ${task.id} has malformed attachments`)
  }
  const taskAttachments: AttachmentStore.Reference[] | undefined =
    task.attachments && task.attachments.length > 0 ? task.attachments : undefined

  const reqRows = findRequirements(activeSpec.id)
  const requirements = reqRows.map(parsedRequirementFromRow)
  const decisionLog = createDecisionLog(task.id)
  const goalsForReview = dbGoals.map((goal) => ({
    id: goal.id,
    title: goal.title,
    objective: goal.objective,
    acceptance_specs: (typeof goal.acceptance_specs === "string"
      ? JSON.parse(goal.acceptance_specs)
      : (goal.acceptance_specs ?? [])) as AcceptanceSpec[],
    owned_paths: typeof goal.owned_paths === "string" ? JSON.parse(goal.owned_paths) : (goal.owned_paths ?? []),
    depends_on: typeof goal.depends_on === "string" ? JSON.parse(goal.depends_on) : (goal.depends_on ?? []),
    priority: goal.priority as "blocking" | "advisory",
    kind: goal.kind,
    requirement_ids:
      typeof goal.requirement_ids === "string" ? JSON.parse(goal.requirement_ids) : (goal.requirement_ids ?? []),
  }))

  const { reviewIntegrity, computeRequirementStatusSnapshot, buildIntegrityReplayContext, buildSpecSnapshotLineage } =
    await import("@/integrity")
  const requirementStatus = computeRequirementStatusSnapshot({
    taskID: task.id,
    specSnapshotID: activeSpec.id,
  })
  const terminalRunStatuses = new Set<string>(["completed", "failed", "aborted"])
  const phase: "pre_build" | "post_build" = requirementStatus.some((requirement) =>
    requirement.claimingGoals.some((goal) => terminalRunStatuses.has(goal.runStatus)),
  )
    ? "post_build"
    : "pre_build"
  const lineage = buildSpecSnapshotLineage({
    taskID: task.id,
    activeSpecSnapshotID: activeSpec.id,
  })
  const replayContext = buildIntegrityReplayContext({
    taskID: task.id,
    lineage,
    phase,
    goals: goalsForReview,
    requirements,
    buildRecords: findDeliveriesForTask(task.id),
    goalRuns: listGoalRunsForTask(task.id),
  })

  const verdict = await reviewIntegrity({
    userRequest: task.request,
    taskTitle: task.title,
    goals: goalsForReview,
    requirements,
    requirementStatus,
    attachments: taskAttachments,
    replayContext,
    signal: input.signal,
    taskID: task.id,
    parentSessionID: input.parentSessionID,
  })

  const markdown = renderIntegrityMarkdown({ verdict, sessionID: verdict.sessionID })
  const { recordIntegrityAttempt } = await import("@/engine/persist")
  recordIntegrityAttempt({
    taskID: task.id,
    sessionID: verdict.sessionID,
    lineage,
    verdict: verdict.verdict,
    phase,
    reviewers: verdict.reviewers,
    findingsCount: verdict.findings.length,
    requiredRepairsCount: verdict.requiredRepairs.length,
    unresolvedDisagreementsCount: verdict.unresolvedDisagreements.length,
    reason: verdict.summary,
    teamReportMarkdown: markdown,
    findings: verdict.findings,
    rounds: verdict.rounds,
    requiredRepairs: verdict.requiredRepairs,
    unresolvedDisagreements: verdict.unresolvedDisagreements,
  })

  decisionLog.append({
    phase: "review",
    key: `delivery_integrity_${verdict.verdict}_${verdict.sessionID}`,
    value:
      `verdict=${verdict.verdict} | reviewers=${verdict.reviewers.length} | findings=${verdict.findings.length}` +
      ` | required_repairs=${verdict.requiredRepairs.length} | unresolved=${verdict.unresolvedDisagreements.length}` +
      (verdict.summary ? ` | summary=${verdict.summary}` : ""),
    reason: "delivery-triggered integrity review",
  })

  return {
    verdict: verdict.verdict,
    summary: verdict.summary,
    sessionID: verdict.sessionID,
    specSnapshotID: activeSpec.id,
    phase,
    reviewersCount: verdict.reviewers.length,
    findingsCount: verdict.findings.length,
    requiredRepairsCount: verdict.requiredRepairs.length,
    unresolvedDisagreementsCount: verdict.unresolvedDisagreements.length,
    teamReportMarkdown: markdown,
  }
}

/**
 * Creates the legacy delivery evidence tool set.
 *
 * Includes:
 * - 4 codebase read tools: read_file, find_files, search_code, list_directory
 * - 2 bounded repair tools: edit_file, write_file
 * - 2 memory tools: memory_search, memory_write
 * - 1 execution tool: run_command (for builds, startup checks)
 */
export function createDeliveryTools(input?: DeliveryToolContext) {
  const codebase = createCodebaseTools()
  const projectId = Instance.project.id
  const projectDir = Filesystem.resolve(Instance.directory)
  const taskID = input?.taskID
  const deliveryID = input?.deliveryID
  const deliveryContext = {
    taskID,
    goals: input?.goals ?? [],
    delivery: input?.delivery,
    attachments: input?.attachments ?? [],
  }

  return {
    ...codebase,

    edit_file: tool({
      description:
        "Apply a small, targeted text replacement inside the project. Use only for simple delivery repairs " +
        "that are clearly localized and immediately verifiable in this delivery run. For broad rewrites, " +
        "cross-goal contract changes, missing features, or uncertain fixes, reject instead of editing.",
      inputSchema: z.object({
        path: z.string().describe("File path relative to the project root."),
        old_text: z.string().min(1).describe("Exact text to replace."),
        new_text: z.string().describe("Replacement text. Must differ from old_text."),
        replace_all: z.boolean().default(false).describe("Replace every occurrence instead of requiring one match."),
      }),
      execute: async ({ path: filePath, old_text, new_text, replace_all }) => {
        if (old_text === new_text) return "edit_file: no-op rejected because old_text and new_text are identical."
        const abs = resolveDeliveryEditPath(projectDir, filePath)
        const before = await readDeliveryTextFile(abs)
        const occurrences = countOccurrences(before, old_text)
        if (occurrences === 0) return `edit_file: old_text not found in ${filePath}.`
        if (!replace_all && occurrences > 1) {
          return `edit_file: old_text matched ${occurrences} times in ${filePath}; provide more context or set replace_all=true.`
        }
        const after = replace_all ? before.replaceAll(old_text, new_text) : before.replace(old_text, new_text)
        await fs.writeFile(abs, after, "utf-8")
        return renderDeliveryEditResult({ filePath, before, after })
      },
    }),

    write_file: tool({
      description:
        "Write full text content to a project file for a simple delivery repair. Prefer edit_file for " +
        "existing files. Do not use for broad rewrites, generated artifacts, vendored dependencies, or " +
        "repairs that should go back through Build.",
      inputSchema: z.object({
        path: z.string().describe("File path relative to the project root."),
        content: z.string().describe("Full replacement content."),
      }),
      execute: async ({ path: filePath, content }) => {
        const abs = resolveDeliveryEditPath(projectDir, filePath)
        const before = await fs.readFile(abs, "utf-8").catch((err) => {
          if ((err as NodeJS.ErrnoException).code === "ENOENT") return ""
          throw err
        })
        await fs.mkdir(path.dirname(abs), { recursive: true })
        await fs.writeFile(abs, content, "utf-8")
        return renderDeliveryEditResult({ filePath, before, after: content })
      },
    }),

    inspect_delivery_context: tool({
      description:
        "Fetch detailed delivery context on demand. The startup prompt is intentionally compact to avoid " +
        "provider input overflow; use this tool when you need full goal acceptance details, upstream contracts, " +
        "executor claims, changed files, diffs, or attachment inventory. " +
        "Do not ask for sections you do not need.",
      inputSchema: z.object({
        section: z.enum([
          "overview",
          "goals",
          "upstream_context",
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

    run_integrity_review: tool({
      description:
        "Run the task semantic integrity reviewer from inside delivery when the integrated evidence raises a real " +
        "question about original-request mining, REQ coverage, hallucinated scope, or goal semantic integrity. " +
        "This is review-only: it records an integrity_attempt and returns the full markdown; it never edits goals, " +
        "starts build work, creates tasks, or replaces delivery runtime/visual verification.",
      inputSchema: z.object({
        reason: z.string().min(10).describe("Concrete delivery evidence that justifies running integrity review now."),
      }),
      execute: async ({ reason }) => {
        const review = await runDeliveryIntegrityReview({
          taskID,
          parentSessionID: input?.sessionID,
          signal: input?.signal,
        })
        return JSON.stringify(
          {
            reason,
            ...review,
          },
          null,
          2,
        )
      },
    }),

    compare_visual_artifacts: tool({
      description:
        "Load visual artifacts only when visual comparison is needed. Returns the selected rendered output " +
        "and reference image(s) as multimodal tool-result attachments plus a small JSON inventory. This is " +
        "the only delivery path that loads task image bytes; the startup prompt deliberately does not inline screenshots.",
      inputSchema: z.object({
        rendered: z
          .string()
          .optional()
          .describe("Optional rendered output filename or sha. Defaults to the first rendered_output attachment."),
        reference: z
          .string()
          .optional()
          .describe("Optional reference filename or sha. Defaults to the first non-rendered image attachment."),
        include_all_references: z
          .boolean()
          .default(false)
          .describe("Attach every reference image instead of one selected reference."),
      }),
      execute: async ({ rendered, reference, include_all_references }) => {
        const images = deliveryContext.attachments.filter((item) => item.mime.startsWith("image/"))
        if (images.length === 0) return "compare_visual_artifacts: no image artifacts are available for this delivery."

        const renderedImages = images.filter((item) => item.intent === "rendered_output")
        const referenceImages = images.filter((item) => item.intent !== "rendered_output")
        const renderedMatch = selectVisualArtifact(renderedImages, rendered) ?? renderedImages[0]
        const referenceMatches = include_all_references
          ? referenceImages
          : [selectVisualArtifact(referenceImages, reference) ?? referenceImages[0]].filter(
              (item): item is DeliveryToolAttachment => Boolean(item),
            )

        const selected = [renderedMatch, ...referenceMatches].filter((item): item is DeliveryToolAttachment =>
          Boolean(item),
        )
        if (selected.length === 0) {
          return [
            "compare_visual_artifacts: no selectable visual pair.",
            `rendered_outputs=${renderedImages.length}`,
            `references=${referenceImages.length}`,
          ].join("\n")
        }

        const imageFiles = selected.map((item) => {
          const located = AttachmentStore.nameFromUrl(item.url)
          if (!located)
            throw new Error(`compare_visual_artifacts: attachment ${item.filename ?? item.sha} has no resolvable url`)
          const absPath = AttachmentStore.resolveAbsolute(located.projectID, located.name)
          if (!absPath)
            throw new Error(
              `compare_visual_artifacts: attachment ${located.projectID}/${located.name} is not resolvable on disk`,
            )
          return {
            path: absPath,
            mime: item.mime,
            filename: item.filename ?? `${item.intent ?? "visual"}-${item.sha.slice(0, 12)}`,
          }
        })

        return await buildMultimodalToolResult({
          projectID: projectId,
          text: JSON.stringify(
            {
              rendered_output: renderedMatch ? describeVisualArtifact(renderedMatch) : null,
              references: referenceMatches.map(describeVisualArtifact),
              instructions: [
                "Compare rendered output against the reference image(s) directly.",
                "Reject obvious blank/error/mismatched layouts with category='visual'.",
                "Cite concrete layout, spacing, color, typography, component, or text differences in rejection_details.",
              ],
            },
            null,
            2,
          ),
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
        const { readIterationHistory, readResultsForIteration, readSpecsForTask, readCounterexamplesForTask } =
          await import("@/metrics/store")
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
        goal_id: z.string().optional().describe('Required when scope="goal_run". Ignored for "delivery".'),
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
          log.warn("memory search failed in legacy delivery evidence tool", { query, err })
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
          log.warn("memory write failed in legacy delivery evidence tool", { title, err })
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
        "If you background a process (`cmd &`) and it keeps the port alive past this call, " +
        "note the returned `pid` line — that is the PID of the SHELL that spawned " +
        "your backgrounded child, and you can target its whole tree on a later turn with " +
        "`taskkill /F /T /PID <pid>` (Windows) or `kill -TERM -- -<pid>` (Unix). Prefer " +
        "that over `netstat | findstr :3000` guessing — the shell's own PID is deterministic.",
      inputSchema: z.object({
        command: z.string().describe("Shell command to run (runs in project root)"),
        timeout_ms: z.number().default(DEFAULT_BASH_TIMEOUT_MS).describe("Max execution time ms"),
      }),
      execute: async ({ command, timeout_ms }) => {
        try {
          const beforeStatus = input?.readOnlyCommandGuard
            ? await Shell.run("git status --short --untracked-files=all", {
                cwd: projectDir,
                env: process.env,
                timeoutMs: 10_000,
              })
            : undefined
          const result = await Shell.run(command, {
            cwd: projectDir,
            env: process.env,
            timeoutMs: timeout_ms,
          })
          const afterStatus = input?.readOnlyCommandGuard
            ? await Shell.run("git status --short --untracked-files=all", {
                cwd: projectDir,
                env: process.env,
                timeoutMs: 10_000,
              })
            : undefined
          const parts = [`exit_code: ${result.exitCode}`]
          if (typeof result.pid === "number") parts.push(`pid: ${result.pid}`)
          if (result.timedOut) parts.push(`timeout_ms: ${timeout_ms}`)
          if (result.stdout.trim()) parts.push(`stdout:\n${result.stdout.slice(0, 8000)}`)
          if (result.stderr.trim()) parts.push(`stderr:\n${result.stderr.slice(0, 5000)}`)
          if (
            input?.readOnlyCommandGuard &&
            beforeStatus &&
            afterStatus &&
            beforeStatus.stdout.trim() !== afterStatus.stdout.trim()
          ) {
            parts.push(
              [
                "readonly_guard: worktree changed during reviewer command; treat this as unsafe verification, not an implementation fix.",
                "before_status:",
                beforeStatus.stdout.trim() || "(clean)",
                "after_status:",
                afterStatus.stdout.trim() || "(clean)",
              ].join("\n"),
            )
          }
          return parts.join("\n") || `exit_code: ${result.exitCode} (no output)`
        } catch (e) {
          log.warn("run_command failed in legacy delivery evidence tool", { command, err: e })
          return `Error running command: ${e instanceof Error ? e.message : String(e)}`
        }
      },
    }),

    screenshot: tool({
      description:
        "Capture a PNG screenshot of an already running app URL via the delivery runtime capture engine and write it to the " +
        "task's .opencorvus/runtime delivery screenshot directory. Use this to produce visual evidence " +
        "that the running application actually renders, or to capture before/after images around a " +
        "fix. The screenshot is saved to disk; reference the returned absolute path and sha when " +
        "citing this call in acceptance tool_call_evidence. The tool returns the shot's size " +
        "(bytes + dimensions) and a pixel-variance signal — a near-zero variance means the page " +
        "rendered blank/uniform (JSON error, pre-hydration stub, loading state) and the capture " +
        "itself does NOT count as a passed check. Capture viewport is capped at 1440x1080 " +
        "inside Puppeteer only; it never changes the host display resolution. The PNG bytes are not attached to the delivery " +
        "context; use compare_visual_artifacts when a visual comparison needs image bytes.",
      inputSchema: z.object({
        url: z
          .string()
          .describe(
            "Absolute http(s) URL for an already running app. Start the dev server yourself via run_command (or point at an already running one) before calling this; this tool never starts servers or serves static files.",
          ),
        viewport_width: z.number().int().min(100).max(4096).default(1440).describe("Viewport width in CSS pixels."),
        viewport_height: z.number().int().min(100).max(4096).default(1080).describe("Viewport height in CSS pixels."),
        label: z
          .string()
          .optional()
          .describe(
            "Short label used in the output filename, e.g. 'after-fix-1' or 'chart-area'. Alphanum / dash only.",
          ),
      }),
      execute: async ({ url, viewport_width, viewport_height, label }) => {
        const safeLabel = (label ?? "shot").replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 40) || "shot"
        if (!taskID) return "screenshot: no task context available"
        const outDir = ProjectRuntimePaths.deliveryPaths(projectDir, taskID).screenshots
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
              note:
                variance < 25
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
        "JSON in acceptance tool_call_evidence with detail=the failure list (or the key numbers " +
        "when passed).",
      inputSchema: z.object({
        url: z
          .string()
          .describe(
            "http(s):// URL the app is listening on. Start the dev server yourself via run_command (or point at an already running one) before calling this; this tool does not start servers.",
          ),
        viewport_width: z.number().int().min(100).max(4096).default(1440),
        viewport_height: z.number().int().min(100).max(4096).default(1080),
        min_dom_descendants: z
          .number()
          .int()
          .min(1)
          .max(10000)
          .default(20)
          .describe(
            "Minimum descendant count under document.body. 20 is a reasonable floor for any non-trivial app shell.",
          ),
        expect_selectors: z
          .array(z.string())
          .default([])
          .describe("CSS selectors that MUST resolve to at least one element. Cite ids/classes from your spec."),
        expect_texts: z
          .array(z.string())
          .default([])
          .describe(
            "Substrings that MUST appear in document.body.textContent (case-sensitive). Use for headers, visible labels, data markers.",
          ),
        wait_for_selector: z
          .string()
          .optional()
          .describe(
            "Optional CSS selector to wait for before assertions run (e.g. '.chart canvas'). Default: load + settle without selector wait.",
          ),
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
      ].join("\n")

    case "goals":
      return "# Goals\n\n" + input.goals.map(renderGoalDetail).join("\n\n---\n\n")

    case "upstream_context":
      if (!input.taskID) return "No task_id is available; upstream context cannot be loaded."
      const sections = buildTaskUpstreamAgentContextSections(input.taskID)
      if (sections.length === 0) {
        throw new Error(
          `Cannot inspect delivery upstream context for task ${input.taskID}: no upstream context sections.`,
        )
      }
      return sections.join("\n\n---\n\n")

    case "executor_reports":
      return renderExecutorReports(delivery)

    case "changed_files":
      return "# Changed Files\n\n" + ((delivery?.changedFiles ?? []).map((file) => `- ${file}`).join("\n") || "(none)")

    case "diffs":
      return (
        "# Code Diffs\n\n" +
        ((delivery?.diffs ?? [])
          .map(
            (item) =>
              `--- ${item.file} (+${item.additions}/-${item.deletions}) ---\n` +
              `[before]\n${item.before || "(empty)"}\n` +
              `[after]\n${item.after || "(empty)"}`,
          )
          .join("\n\n") || "(none)")
      )

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
    `acceptance_scenarios=${goal.acceptance_scenarios?.length ?? 0}`,
    goal.requirement_ids.length > 0 ? `requirement_ids=${goal.requirement_ids.join(", ")}` : "requirement_ids=(none)",
    goal.depends_on.length > 0 ? `depends_on=${goal.depends_on.join(", ")}` : "depends_on=(none)",
    goal.owned_paths.length > 0 ? `owned_paths=${goal.owned_paths.join(", ")}` : "owned_paths=(none)",
    "",
    "Objective:",
    goal.description,
    "",
    "Acceptance specs:",
    goal.criteria,
  ].join("\n")
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
  return (
    "# Attachments\n\n" +
    attachments
      .map((item, index) => {
        const sizeKb = `${Math.max(1, Math.round(item.size / 1024))} KB`
        const name = AttachmentStore.displayFilename({ filename: item.filename, mime: item.mime, sha: item.sha, index })
        return `- ${name} mime=${item.mime} intent=${item.intent ?? "(none)"} size=${sizeKb} sha=${item.sha} url=${item.url}`
      })
      .join("\n")
  )
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

function resolveDeliveryEditPath(projectDir: string, relPath: string): string {
  if (path.isAbsolute(relPath)) {
    throw new Error("delivery repair paths must be relative to the project root")
  }
  const abs = path.resolve(projectDir, relPath)
  const root = path.resolve(projectDir)
  const relative = path.relative(root, abs)
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`delivery repair path escapes the project root: ${relPath}`)
  }
  const normalized = relative.replaceAll("\\", "/")
  if (
    normalized.startsWith(".git/") ||
    normalized.includes("/.git/") ||
    normalized.startsWith("node_modules/") ||
    normalized.includes("/node_modules/")
  ) {
    throw new Error(`delivery repair path is not editable: ${relPath}`)
  }
  return abs
}

async function readDeliveryTextFile(abs: string): Promise<string> {
  const buf = await fs.readFile(abs)
  if (buf.subarray(0, Math.min(buf.length, 4096)).includes(0)) {
    throw new Error(`delivery repair refused binary/NUL-containing file: ${abs}`)
  }
  return buf.toString("utf-8")
}

function countOccurrences(text: string, needle: string): number {
  if (needle.length === 0) return 0
  let count = 0
  let index = 0
  while (true) {
    const found = text.indexOf(needle, index)
    if (found === -1) return count
    count++
    index = found + needle.length
  }
}

function renderDeliveryEditResult(input: { filePath: string; before: string; after: string }): string {
  const diff = createTwoFilesPatch(input.filePath, input.filePath, input.before, input.after)
  let additions = 0
  let deletions = 0
  for (const change of diffLines(input.before, input.after)) {
    if (change.added) additions += change.count || 0
    if (change.removed) deletions += change.count || 0
  }
  return [
    `delivery repair updated ${input.filePath}`,
    `additions=${additions} deletions=${deletions}`,
    "Run a focused verification command or runtime probe before submitting the acceptance verdict. " +
      "If the issue is not fully fixed, submit verdict='rejected'.",
    "diff:",
    diff.slice(0, 8000),
  ].join("\n")
}

function truncateToolText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return (
    text.slice(0, maxChars) +
    `\n... (truncated by inspect_delivery_context at ${maxChars} chars; request a narrower section for more detail)`
  )
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
  if (/^(?:grep|egrep|fgrep|rg|ripgrep)\b/.test(stripped))
    return "self-keyword grep on own artifacts is not acceptance evidence"
  if (/^find\b[^|;&]*-name\b/.test(stripped)) return "find -name / file-discovery is not acceptance evidence"
  if (/^ls\b\s+(-[a-zA-Z]+\s+)?\S+/.test(stripped) && !/[|;&]/.test(stripped))
    return "ls / file-listing is not acceptance evidence"
  if (/^cat\b/.test(stripped) && !/[|;&]/.test(stripped)) return "cat of own artifact is not acceptance evidence"
  return
}
