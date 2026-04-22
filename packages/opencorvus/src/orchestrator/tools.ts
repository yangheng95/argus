/**
 * Orchestrator tools — AI SDK tool() definitions wrapping existing services.
 *
 * Created per-task via createOrchestratorTools({ taskID }).
 * The taskID is captured in the closure — no global registry needed.
 */
import { tool } from "ai"
import z from "zod"
import path from "node:path"
import { Session } from "@/session"
import { resolveAgentModel } from "@/agent/model"
import { SessionPrompt } from "@/session/prompt"
import { Database, eq, and, inArray } from "@/storage/db"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { EngineService } from "@/task-api"
import { sessionGoalID } from "@/server/routes/task-event"
import { Publisher } from "@/engine/publisher"
import { EngineGit } from "@/engine/git"
import { EngineMemoryBridge } from "@/engine/memory-bridge"
import { sessionStreamHooks } from "@/agent/runtime"
import { SubAgentProtocol } from "@/agent/sub-agent-protocol"
import { withStageRetry } from "@/util/retry"
import { Event as EngineEvent } from "@/engine/model"
import { EngineConfig } from "@/engine/config"
import { EngineProtocol } from "@/engine/protocol"
import { isDispatchableGoal } from "@/goal/kind"
import {
  EngineGoalTable,
  EngineTaskTable,
} from "@/engine/engine.sql"
import {
  markDeliveryPublishing,
  finalizeDeliveryResult,
  updateGoalRun,
  updateEvaluationFromDeliveryVerdict,
} from "@/engine/persist"
import {
  findDeliveryByRun,
  findEvaluationByRun,
  findPlan,
  findRun,
  findRuns,
  listGoals,
  requireRun,
  requireTask,
} from "@/engine/store"
import { effectiveMaxRuns } from "@/engine/helpers"
import { goalStatusByID } from "@/engine/describe"
import {
  GoalContractAddInputSchema,
  GoalContractUpdateSchema,
} from "@/pipeline/goal-contract.schema"
import type { EngineBudget } from "@/engine/engine.sql"
import { updateRun, updateTask } from "@/engine/state"

import { findStepByTool, type WorkflowState, type MiniWorkflow } from "@/engine/workflow"
import { Question } from "@/question"
import { renderSpecsAsText, type AcceptanceSpec } from "@/acceptance/types"
import { isLiveRunStatus, isRunReadyForGoalDispatch, restartStagePlan } from "./scheduler"

const log = Log.create({ service: "task-tools" })

// ---------------------------------------------------------------------------
// Helpers (from pipeline.ts)
// ---------------------------------------------------------------------------

function stageTimeout(stage: "requirements" | "goal" | "plan"): number {
  const env = { requirements: "OPENCORVUS_REQUIREMENTS_TIMEOUT_MS", goal: "OPENCORVUS_GOAL_TIMEOUT_MS", plan: "OPENCORVUS_PLAN_TIMEOUT_MS" }
  const defaults = { requirements: 300_000, goal: 180_000, plan: 300_000 }
  return parseInt(process.env[env[stage]] || String(defaults[stage]), 10)
}

/**
 * Lightweight MIME guess from filename extension. Covers the design-material
 * spectrum: images (inlined multimodal), PDFs (multimodal), text / markdown /
 * JSON / CSS / YAML (reference-only, read via read_attachment). Falls back to
 * `application/octet-stream` so AttachmentStore.write still accepts the file
 * — the multimodal-vs-reference partition then decides how it's surfaced.
 */
function guessMimeFromFilename(filename: string): string {
  const ext = (filename.split(".").pop() || "").toLowerCase()
  const table: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
    gif: "image/gif", bmp: "image/bmp", svg: "image/svg+xml",
    avif: "image/avif", heic: "image/heic", heif: "image/heif",
    pdf: "application/pdf",
    md: "text/markdown", markdown: "text/markdown",
    txt: "text/plain", log: "text/plain",
    json: "application/json", jsonc: "application/json",
    yaml: "text/yaml", yml: "text/yaml",
    css: "text/css", scss: "text/css", less: "text/css",
    html: "text/html", htm: "text/html",
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
    mp3: "audio/mpeg", wav: "audio/wav",
  }
  return table[ext] ?? "application/octet-stream"
}

// The delivery agent emits a structured DeliveryVerdict with three typed
// surfaces (deferred_checks, rejection_details, the verdict itself). Each is
// already per-check-shaped — flatten all three into engine_task.criteria_results
// so the panel reflects what was actually verified, not just an aggregate bit.
async function sinkDeliveryVerdictToCriteria(
  taskID: string,
  verdict: import("@/delivery/agent").DeliveryVerdictType,
): Promise<void> {
  const checks: Array<{
    name: string
    status: "passed" | "failed" | "skipped"
    family: string
    evidence?: string
    label?: string
  }> = []

  for (const dc of verdict.deferred_checks ?? []) {
    checks.push({
      name: dc.name,
      status: dc.result,
      family: "delivery",
      evidence: dc.evidence,
    })
  }

  for (const rd of verdict.rejection_details ?? []) {
    const fileSuffix = rd.file ? ` @ ${rd.file}` : ""
    const suggestion = rd.suggestion ? ` → ${rd.suggestion}` : ""
    checks.push({
      name: `${rd.category}${fileSuffix}`,
      status: "failed",
      family: rd.category,
      evidence: `${rd.error}${suggestion}`,
    })
  }

  checks.push({
    name: "delivery_verdict",
    status: verdict.verdict === "accepted" ? "passed" : "failed",
    family: "delivery",
    evidence: verdict.summary,
    label: "Delivery agent overall verdict",
  })

  await EngineService.upsertTaskCriteria(taskID, checks)
}

// Re-export the stateful-tool registry (defined in a dependency-free module
// so `session/message.ts` can import it without creating a circular graph
// through `@/session`). Surfacing it from this module keeps it visible to
// developers reading tool definitions.
export { STATEFUL_SNAPSHOT_TOOL_NAMES, type StatefulSnapshotToolName } from "./stateful-tool-names"

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createOrchestratorTools(input: {
  taskID: string
  agentSessionID: string
  signal?: AbortSignal
  workflow?: import("@/engine/workflow").MiniWorkflow
  workflowState?: import("@/engine/workflow").WorkflowState
}) {
  const { taskID } = input

  // Blocking tools (submit_execution, dispatch_goal) signal
  // this controller on success. The agent loop is then forcefully terminated so
  // the model can't spin-wait with read_context calls. The agent gets re-triggered
  // when execution completes.
  const stopAfterDispatch = new AbortController()

  // ── Workflow step tracking (passive observation) ──

  async function trackStepStart(toolName: string, goalID?: string): Promise<void> {
    if (!input.workflow || !input.workflowState) return
    const step = findStepByTool(input.workflow, toolName)
    if (!step) return
    const now = Date.now()
    const ws = input.workflowState

    // Only task-scope steps track state here. Goal-scope step status is
    // projected from engine_goal_run on read (see workflow.ts::projectGoalSteps);
    // there is no longer a shadow table to write into.
    if (step.scope === "task") {
      ws.taskSteps[step.id] = { status: "running", startedAt: now }
      ws.currentStepID = step.id
      try {
        const task = requireTask(taskID)
        await updateTask(task, { workflow_state: ws }, `Workflow step started: ${step.label}`)
        EngineProtocol.emit(EngineEvent.WorkflowStepUpdated, {
          taskID, stepID: step.id, goalID, status: "running",
          summary: `Step "${step.label}" started`,
        })
      } catch { /* best effort */ }
      return
    }
    // goal-scope: nothing to persist — goal_run creation/update downstream
    // drives the derived state. Emit an event so the overlay still sees the
    // tool-level transition without needing to poll the board.
    try {
      EngineProtocol.emit(EngineEvent.WorkflowStepUpdated, {
        taskID, stepID: step.id, goalID, status: "running",
        summary: `Step "${step.label}" started`,
      })
    } catch { /* best effort */ }
  }

  async function trackStepComplete(toolName: string, goalID?: string, failed = false): Promise<void> {
    if (!input.workflow || !input.workflowState) return
    const step = findStepByTool(input.workflow, toolName)
    if (!step) return
    const now = Date.now()
    const ws = input.workflowState
    const status = failed ? "failed" as const : "completed" as const

    if (step.scope !== "task") {
      // Goal-scope step completion is derived from engine_goal_run transitions.
      // Emit-only here.
      try {
        EngineProtocol.emit(EngineEvent.WorkflowStepUpdated, {
          taskID, stepID: step.id, goalID, status,
          summary: `Step "${step.label}" ${status}`,
        })
      } catch { /* best effort */ }
      return
    }

    const existing = ws.taskSteps[step.id]
    ws.taskSteps[step.id] = { ...existing, status, completedAt: now }

    // Advance currentStepID to next pending task-scope step
    const nextStep = input.workflow.steps.find(s => {
      if (s.scope === "task") return ws.taskSteps[s.id]?.status === "pending"
      return false
    })
    ws.currentStepID = nextStep?.id ?? null

    try {
      const task = requireTask(taskID)
      await updateTask(task, { workflow_state: ws }, `Workflow step ${status}: ${step.label}`)
      EngineProtocol.emit(EngineEvent.WorkflowStepUpdated, {
        taskID, stepID: step.id, goalID, status,
        summary: `Step "${step.label}" ${status}`,
      })
    } catch { /* best effort */ }
  }

  /** ensureGoalInWorkflow was the workflow_state.goalSteps pre-allocator. The
   *  shadow table is gone — goal step status is derived from engine_goal_run
   *  at read time. This remains as a no-op for callers still referencing it;
   *  those call sites will be removed as the architecture settles. */
  function ensureGoalInWorkflow(_goalID: string, _goalTitle: string): void {
    // intentional no-op: see workflow.ts::projectGoalSteps
  }

  // Agents that need to ask the user a question do so directly via
  // `Question.ask`. Workflow steps never pause for input here.

  const tools = {
    requirements: tool({
      description:
        "Parse the user's task into REQ-N requirements plus foundational " +
        "technical decisions (runtime, framework, test strategy). Goal " +
        "decomposition, metric specs, challenge seeds, traceability, and " +
        "cross-goal contracts are all produced by the Architect — do NOT " +
        "expect them from this step.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to analyze requirements"),
      }),
      execute: async () => {
        let task = requireTask(taskID)
        log.info("requirements guard check", { taskID, hasSpec: !!task.active_spec_version_id })
        if (task.active_spec_version_id) return `Requirements analysis already completed (spec=${task.active_spec_version_id}). Proceed to architect.`

        // No design-analysis gate here: per rule 23, phase ordering is an LLM
        // decision (the orchestrator prompt explains when to call
        // design_analysis). Requirements and design-analyst are decoupled —
        // visual specs live on task.design_specs and are consumed by delivery
        // directly as advisory guidance, not forwarded into requirements.
        await trackStepStart("requirements")
        task = await updateTask(task, { status: "active" }, "Requirements analysis started")
        // The RequirementsService runs inside AgentRuntime which owns its own
        // ProgressGuard (alive/progress/absolute tiers). No caller-level
        // inactivity guard here — that was the same "delta = activity"
        // hazard we just eliminated.
        // Hoisted so the catch below can reference requirementsSession.id
        // when emitting the error-path terminal event.
        const requirementsSession = await Session.createNext({
          kind: "requirements",
          parentID: input.agentSessionID,
          title: `Requirements: ${task.title}`,
          directory: Instance.directory,
        })
        try {
          const hooks = sessionStreamHooks({ sessionID: requirementsSession.id, taskID, stage: "requirements" })


          const { RequirementsService } = await import("@/requirements")
          const { createDecisionLog } = await import("@/decision-log")
          const decisionLog = createDecisionLog(taskID)

          const result = await withStageRetry("goal", () =>
            RequirementsService.run({
              title: task.title,
              request: task.request,
              attachments: Array.isArray(task.attachments) ? task.attachments as any : undefined,
              taskID,
              sessionID: requirementsSession.id,
              signal: input.signal,
              decisionLog,
              stream: {
                onChunk: async (arg: any) => {
                  const chunk = (arg as any)?.chunk
                  // Re-emit text-delta as reasoning-delta so it renders in a collapsible
                  // thinking block, visually separated from tool calls.
                  if (chunk?.type === "text-delta") {
                    if (hooks.onChunk) await hooks.onChunk({ chunk: { ...chunk, type: "reasoning-delta" } })
                  } else {
                    if (hooks.onChunk) await hooks.onChunk(arg)
                  }
                },
                onError: async (arg: any) => { if (hooks.onError) await hooks.onError(arg) },
              },
              onStatus: () => {},
            }),
            { signal: input.signal },
          )
          await hooks.flush()


          // Persist spec snapshot v1 (requirements + decisions only; the
          // Architect produces v2 with goals/traceability/contracts).
          const { insertRequirements } = await import("@/engine/persist")
          const { EngineSpecSnapshotTable } = await import("@/engine/engine.sql")
          const now = Date.now()
          const specSnapshotID = Identifier.ascending("spec")

          const specContent = [
            `# ${task.title}`,
            "",
            result.summary,
            "",
            "## Requirements",
            ...result.requirements.map((r) => `- **${r.id}** [${r.type}]: ${r.description}`),
            "",
            "## Decisions",
            ...result.decisions.map((d) => `- **${d.key}** = ${d.value} — ${d.reason}`),
          ].join("\n")

          try { Database.transaction((db) => {
            db.insert(EngineSpecSnapshotTable).values({
              id: specSnapshotID,
              task_id: taskID,
              version: 1,
              status: "ready",
              summary: result.summary,
              content: specContent,
              scope: result.requirements.map((r) => r.description).join("; "),
              time_created: now,
              time_updated: now,
            }).run()

            if (result.requirements.length > 0) {
              insertRequirements(db, {
                taskID,
                specSnapshotID,
                requirements: result.requirements.map((r) => ({
                  id: r.id,
                  title: r.description,
                  description: r.description,
                  acceptance: [] as string[],
                  evidence_refs: [] as string[],
                  priority: r.type === "explicit" ? "blocking" as const : "advisory" as const,
                })),
                now,
              })
            }

            db.update(EngineTaskTable)
              .set({
                active_spec_version_id: specSnapshotID,
                time_updated: now,
              })
              .where(eq(EngineTaskTable.id, taskID))
              .run()
            Database.effect(() =>
              EngineProtocol.emit(
                EngineEvent.TaskUpdated,
                { taskID, status: task.status, summary: "Requirements parsed" },
                { source: "orchestrator.requirements" },
              ),
            )
          }) } catch (dbErr) {
            log.error("requirements: failed to persist to DB", {
              taskID,
              error: dbErr instanceof Error ? dbErr.message : String(dbErr),
              stack: dbErr instanceof Error ? dbErr.stack : undefined,
            })
            throw dbErr
          }
          await trackStepComplete("requirements")

          // Phase-level completion event — Panel uses this to refresh the
          // Requirements section. goalCount/traceabilityCount are dropped
          // (Architect emits those on its own completion event).
          EngineProtocol.emit(
            EngineEvent.RequirementsCompleted,
            {
              taskID,
              sessionID: requirementsSession.id,
              status: "completed",
              requirementCount: result.requirements.length,
              goalCount: 0,
              decisionCount: result.decisions.length,
              traceabilityCount: 0,
              summary: result.summary,
            },
            { source: "orchestrator.requirements" },
          )

          return SubAgentProtocol.yieldResult({
            headline: `SUCCESS: ${result.requirements.length} requirements, ${result.decisions.length} decisions parsed. NEXT: call architect to decompose into goals.`,
            summary: result.summary,
            fields: [
              ["decisions", result.decisions.map((d) => `${d.key}=${d.value}`)],
              ["requirements", String(result.requirements.length)],
            ],
            pointer: `read_context scope=decisions (spec ${specSnapshotID})`,
          })
        } catch (err) {
          // Error-path terminal emission so the overlay's requirements
          // session card flips out of `running`. Without this the card
          // spins forever on any failure (LLM error, persistence error,
          // signal abort). Re-throw preserves existing error propagation.
          EngineProtocol.emit(
            EngineEvent.RequirementsCompleted,
            {
              taskID,
              sessionID: requirementsSession.id,
              status: "error",
              error: err instanceof Error ? err.message : String(err),
              summary: "Requirements failed",
            },
            { source: "orchestrator.requirements" },
          )
          throw err
        } finally {
          // No caller-level guard: AgentRuntime enforces progress/absolute timeouts.
        }
      },
    }),

    // -----------------------------------------------------------------------
    // Design Analysis — visual reference analysis before decomposition
    // -----------------------------------------------------------------------

    design_analysis: tool({
      description: [
        "Analyze visual references (images, URLs) to produce a structured design specification.",
        "Call this BEFORE requirements when the task involves frontend/UI development AND:",
        "  - Image attachments are provided (screenshots, mockups, design files)",
        "  - The request mentions a URL to replicate or analyze",
        "  - The request explicitly asks for layout/design analysis",
        "",
        "The design specification is appended to the task request, enriching it with",
        "exact layout structure, style tokens, component inventory, and interaction patterns.",
        "This enables the requirements agent to produce more accurate, pixel-level goals.",
        "",
        "SKIP this step when:",
        "  - No visual references are available",
        "  - The task is purely backend/API/infrastructure",
        "  - The request already contains detailed design specifications",
      ].join("\n"),
      inputSchema: z.object({
        reason: z.string().describe("Why design analysis is needed for this task"),
        url: z
          .string()
          .optional()
          .describe("Deprecated — use `urls`. Single URL for back-compat; merged into `urls`."),
        urls: z
          .array(z.string())
          .optional()
          .describe(
            "Any number of design-reference URLs: live pages, design-tool share links " +
            "(Sketch Cloud / Adobe XD / Framer / InVision / Zeplin / Penpot), docs, etc. " +
            "Non-Figma URLs are screenshot-rendered via headless Chromium and attached as visual_reference; " +
            "Figma URLs use the REST API path. The LLM can also call `webfetch` on them for HTML/CSS analysis.",
          ),
        figma_url: z.string().optional().describe(
          "Figma file URL rendered via the Figma REST API (figma.com/file/... or figma.com/design/...). " +
          "Requires FIGMA_API_TOKEN in env.",
        ),
        materials: z
          .array(z.string())
          .optional()
          .describe(
            "Local design-material paths (relative to project root, or absolute under it). " +
            "Supported: images, PDFs, markdown/text style guides, design-tokens JSON, CSS. " +
            "Each is read from disk and materialized into the attachment store as a visual_reference " +
            "so it flows through the same multimodal / read_attachment pipeline as user uploads.",
          ),
      }),
      execute: async ({ reason, url, urls, figma_url, materials }) => {
        const task = requireTask(taskID)

        // Guard: skip if no visual input available. Figma URL counts as visual.
        const hasAttachments = Array.isArray(task.attachments) && task.attachments.length > 0
        // Auto-detect: any `figma.com` URL passed via `url` / `urls` is
        // treated as a Figma URL (uses REST API path instead of screenshot).
        const meta = (task.metadata as Record<string, unknown> | null) ?? {}
        const metaFigma = typeof meta.figma_url === "string" ? meta.figma_url : undefined
        const inputUrls = [
          ...(url ? [url] : []),
          ...(Array.isArray(urls) ? urls : []),
        ].filter((u) => typeof u === "string" && u.length > 0)
        const figmaUrls = [
          ...(figma_url ? [figma_url] : []),
          ...(metaFigma ? [metaFigma] : []),
          ...inputUrls.filter((u) => /(^|\.)figma\.com\//i.test(u)),
        ]
        const liveUrls = inputUrls.filter((u) => !/(^|\.)figma\.com\//i.test(u))
        const materialPaths = Array.isArray(materials) ? materials.filter((m) => typeof m === "string" && m.length > 0) : []
        if (!hasAttachments && liveUrls.length === 0 && figmaUrls.length === 0 && materialPaths.length === 0) {
          return "No visual references available (no image attachments, no URLs, no Figma URL, no local materials). Skip design_analysis and proceed to requirements."
        }

        await trackStepStart("design_analysis")

        log.info("design_analysis: starting", {
          taskID,
          hasAttachments,
          liveUrlCount: liveUrls.length,
          figmaUrlCount: figmaUrls.length,
          materialCount: materialPaths.length,
          reason,
        })

        // Reference materialization: every external design source (Figma
        // frame, URL-screenshot, local file) gets pulled, written to
        // AttachmentStore, and registered on the task. Two destination
        // columns:
        //   • Figma frames → attachments (figma URL is part of the user
        //     contract — the user pointed us at it).
        //   • URL screenshots / local materials → system_artifacts (we
        //     captured them ourselves to feed design-analyst; not user
        //     intent — keeping them out of attachments prevents requirements
        //     from treating system-generated PNGs as user input).
        //
        // design-analyst combines both columns when assembling its visual
        // input. The deliver-time visual diff also reads both. Requirements
        // reads only attachments — it must see user intent, not internal
        // captures.
        const { AttachmentStore } = await import("@/storage/attachment-store")
        const fsMod = await import("node:fs/promises")
        const pathMod = await import("node:path")

        // Track how many external sources actually produced visual bytes. If
        // every Figma fetch, URL screenshot, and local material fails to
        // materialize AND the task had no pre-existing attachments, we must
        // abort before calling design-analyst — otherwise the agent runs
        // blind, registers nothing, and the orchestrator hangs waiting for
        // a design spec that cannot exist. See benchmark run on
        // usage-replica-vague: assistant hallucinated ./image-N.png paths,
        // all 3 ENOENT'd, design-analyst still ran for 45s producing
        // nothing, and the pipeline stalled on the empty verdict.
        let materializedCount = 0

        // --- Figma frames -----------------------------------------------------
        for (const figmaUrl of figmaUrls) {
          try {
            const { fetchFigmaFrame } = await import("@/design-analyst/figma-fetch")
            const frame = await fetchFigmaFrame({ url: figmaUrl })
            const ref = await AttachmentStore.write(
              Instance.project.id,
              frame.png,
              "image/png",
              `figma-${frame.fileKey}-${frame.nodeId.replace(/[^a-zA-Z0-9]/g, "_")}.png`,
            )
            await EngineService.appendTaskAttachment(taskID, {
              ...ref,
              intent: "visual_reference",
              source: "figma",
            })
            log.info("design_analysis: figma frame materialized", {
              taskID, fileKey: frame.fileKey, nodeId: frame.nodeId, sha: ref.sha, size: ref.size,
            })
            materializedCount++
          } catch (figmaErr) {
            log.warn("design_analysis: figma materialization failed", {
              taskID,
              figmaUrl,
              error: figmaErr instanceof Error ? figmaErr.message : String(figmaErr),
            })
          }
        }

        // --- Generic URL screenshots -----------------------------------------
        // Any non-Figma URL is rendered via headless Chromium so design-tool
        // share links (Sketch Cloud, Adobe XD, Framer, InVision, Zeplin, …)
        // and plain live pages contribute pixel references, not just markup.
        for (const liveUrl of liveUrls) {
          try {
            const { fetchUrlScreenshot } = await import("@/design-analyst/url-screenshot")
            const shot = await fetchUrlScreenshot({ url: liveUrl })
            const hostname = (() => { try { return new URL(shot.finalUrl).hostname } catch { return "url" } })()
            const slug = hostname.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 60) || "url"
            const ref = await AttachmentStore.write(
              Instance.project.id,
              shot.png,
              "image/png",
              `url-${slug}-${Date.now()}.png`,
            )
            await EngineService.appendTaskSystemArtifact(taskID, {
              ...ref,
              intent: "visual_reference",
              source: "url-screenshot",
            })
            log.info("design_analysis: url screenshot materialized", {
              taskID, url: liveUrl, finalUrl: shot.finalUrl, sha: ref.sha, size: ref.size,
            })
            materializedCount++
          } catch (shotErr) {
            log.warn("design_analysis: url screenshot failed", {
              taskID,
              url: liveUrl,
              error: shotErr instanceof Error ? shotErr.message : String(shotErr),
            })
          }
        }

        // --- Local material files --------------------------------------------
        // Paths are resolved against the project root and must stay inside
        // it — refusing traversal matches the codebase-tools boundary rule.
        const projectRoot = Instance.project.worktree
        for (const rawPath of materialPaths) {
          try {
            const abs = pathMod.isAbsolute(rawPath)
              ? pathMod.normalize(rawPath)
              : pathMod.normalize(pathMod.resolve(projectRoot, rawPath))
            if (!abs.startsWith(pathMod.normalize(projectRoot))) {
              log.warn("design_analysis: material path escapes project root — skipped", {
                taskID, rawPath, projectRoot,
              })
              continue
            }
            const bytes = await fsMod.readFile(abs)
            const filename = pathMod.basename(abs)
            const mime = guessMimeFromFilename(filename)
            const ref = await AttachmentStore.write(
              Instance.project.id,
              bytes,
              mime,
              filename,
            )
            await EngineService.appendTaskSystemArtifact(taskID, {
              ...ref,
              intent: "visual_reference",
              source: "material",
            })
            log.info("design_analysis: material materialized", {
              taskID, path: rawPath, sha: ref.sha, size: ref.size, mime,
            })
            materializedCount++
          } catch (matErr) {
            log.warn("design_analysis: material materialization failed", {
              taskID,
              path: rawPath,
              error: matErr instanceof Error ? matErr.message : String(matErr),
            })
          }
        }

        // Refresh task to pick up any newly-attached references. design-analyst
        // sees the union of user attachments (figma + user uploads) and
        // system_artifacts (URL screenshots + materials we just captured).
        const enrichedTask = requireTask(taskID)
        const designVisuals = [
          ...(Array.isArray(enrichedTask.attachments) ? (enrichedTask.attachments as any[]) : []),
          ...(Array.isArray(enrichedTask.system_artifacts) ? (enrichedTask.system_artifacts as any[]) : []),
        ]
        const enrichedHasAttachments = designVisuals.length > 0

        // Fail-fast if design_analysis was invoked on the strength of URLs /
        // materials but every source failed to materialize. Running
        // design-analyst blind produces zero output tools, which the caller
        // turns into "Design analysis failed" — we surface the real root
        // cause (no usable visual input) back to the orchestrator instead
        // of letting the downstream agent run for 45s and emit nothing.
        if (!enrichedHasAttachments && materializedCount === 0) {
          await trackStepComplete("design_analysis", undefined, true)
          const providedCount = liveUrls.length + figmaUrls.length + materialPaths.length
          const message =
            `Design analysis aborted: all ${providedCount} provided visual source(s) ` +
            `failed to materialize (URLs unreachable, Figma fetch failed, or local material ` +
            `paths did not exist). Check that the paths/URLs in the 'materials' / 'url' / ` +
            `'urls' / 'figma_url' arguments actually exist. If no real visual reference is ` +
            `available, skip design_analysis and call requirements directly.`
          log.warn("design_analysis: no visual input materialized — aborting before agent call", {
            taskID,
            liveUrlCount: liveUrls.length,
            figmaUrlCount: figmaUrls.length,
            materialCount: materialPaths.length,
          })
          return message
        }

        const designSession = await Session.createNext({
          kind: "design-analyst",
          parentID: input.agentSessionID,
          title: `Design Analysis: ${task.title}`,
          directory: Instance.directory,
        })
        const hooks = sessionStreamHooks({ sessionID: designSession.id, taskID, stage: "design-analyst" })

        // DesignAnalystAgent runs inside AgentRuntime which owns its own
        // alive/progress/absolute timers. No caller inactivity guard.
        try {
          const { DesignAnalystAgent } = await import("@/design-analyst")

          const analysis = await DesignAnalystAgent.analyze({
            title: task.title,
            request: task.request,
            attachments: enrichedHasAttachments ? designVisuals : undefined,
            // Pass the non-Figma URL list so the agent can call webfetch on
            // each for HTML/CSS analysis. Figma URLs are already rendered
            // as PNGs in attachments, and URL screenshots / materials are in
            // system_artifacts above — design-analyst sees the union via
            // `designVisuals` and reads them through the normal multimodal
            // channel.
            urls: liveUrls,
            taskID,
            sessionID: designSession.id,
            signal: input.signal,
            stream: {
              onChunk: async (arg: any) => {
                const chunk = (arg as any)?.chunk
                if (chunk?.type === "text-delta") {
                  if (hooks.onChunk) await hooks.onChunk({ chunk: { ...chunk, type: "reasoning-delta" } })
                } else {
                  if (hooks.onChunk) await hooks.onChunk(arg)
                }
              },
              onError: async (arg: any) => { if (hooks.onError) await hooks.onError(arg) },
            },
            onStatus: () => {},
          })

          await hooks.flush()

          // Persist the visual contract on task.design_specs (dedicated JSON
          // column, not metadata). Delivery reads it directly as advisory
          // guidance — no other consumer, no forwarding, no markdown.
          const freshTask = requireTask(taskID)
          await updateTask(
            freshTask,
            { design_specs: analysis.specs },
            `Visual contract stored (${analysis.specs.length} specs)`,
          )

          await trackStepComplete("design_analysis")

          const countByCategory = analysis.specs.reduce<Record<string, number>>((acc, s) => {
            acc[s.category] = (acc[s.category] ?? 0) + 1
            return acc
          }, {})

          log.info("design_analysis: complete", {
            taskID,
            total: analysis.specs.length,
            byCategory: countByCategory,
          })

          // Phase-level completion event — drives the overlay's
          // design-analyst session-card terminal status write.
          EngineProtocol.emit(
            EngineEvent.DesignAnalysisCompleted,
            {
              taskID,
              sessionID: designSession.id,
              status: "completed",
              layoutSections: countByCategory.layout ?? 0,
              styleTokens: (countByCategory.color ?? 0) + (countByCategory.typography ?? 0) + (countByCategory.spacing ?? 0),
              componentCount: countByCategory.component ?? 0,
              interactionCount: countByCategory.interaction ?? 0,
              summary: `Visual contract ready: ${analysis.specs.length} specs (${(countByCategory.color ?? 0)}c/${(countByCategory.typography ?? 0)}t/${(countByCategory.layout ?? 0)}l/${(countByCategory.component ?? 0)}cp).`,
            },
            { source: "orchestrator.design_analysis" },
          )

          return SubAgentProtocol.yieldResult({
            headline:
              "SUCCESS: Visual contract persisted on task.design_specs. Delivery will consume " +
              "it as advisory checklist. NEXT: call requirements for functional decomposition.",
            fields: [
              ["total_specs", String(analysis.specs.length)],
              ["color", String(countByCategory.color ?? 0)],
              ["typography", String(countByCategory.typography ?? 0)],
              ["spacing", String(countByCategory.spacing ?? 0)],
              ["layout", String(countByCategory.layout ?? 0)],
              ["component", String(countByCategory.component ?? 0)],
              ["interaction", String(countByCategory.interaction ?? 0)],
              ["responsive", String(countByCategory.responsive ?? 0)],
              ["design_system", analysis.designSystem],
              ["recommended_stack", analysis.techStack],
            ],
            pointer: "task.design_specs (JSON column on engine_task)",
          })
        } catch (err) {
          await hooks.flush()
          await trackStepComplete("design_analysis", undefined, true)
          const msg = err instanceof Error ? err.message : String(err)
          log.error("design_analysis: failed", { taskID, error: msg })
          EngineProtocol.emit(
            EngineEvent.DesignAnalysisCompleted,
            {
              taskID,
              sessionID: designSession.id,
              status: "error",
              error: msg,
              summary: "Design analysis failed",
            },
            { source: "orchestrator.design_analysis" },
          )
          return `Design analysis failed: ${msg}. Proceeding without a visual contract — call requirements directly if appropriate.`
        }
      },
    }),

    // -----------------------------------------------------------------------
    // Cross-goal coordination — Architect Agent
    // -----------------------------------------------------------------------

    architect: tool({
      description: "Coordinate cross-goal contracts. Call after requirements when multiple goals have exports/imports dependencies. Writes precise interface contracts, directory blueprints, and shared type definitions to the Decision Log so parallel goals don't conflict. Skip for single-goal or trivial tasks. Always coordinates ALL goals — goal selection is automatic.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to run architect"),
      }),
      execute: async () => {
        const allGoals = listGoals(taskID)
        if (allGoals.length === 0) return "No goals to coordinate. Run requirements first."
        if (allGoals.length === 1) return "Single goal — architect coordination not needed."

        await trackStepStart("architect")

        const targetGoals = allGoals

        const task = requireTask(taskID)

        const architectSession = await Session.createNext({
          kind: "architect",
          parentID: input.agentSessionID,
          title: `Architect: ${task.title}`,
          directory: Instance.directory,
        })
        const hooks = sessionStreamHooks({ sessionID: architectSession.id, taskID, stage: "architect" })

        // try/catch around the agent call so the overlay receives a
        // terminal status event even when ArchitectAgent throws. Without
        // this the architect session card spins forever on failure.
        try {
          const { createDecisionLog } = await import("@/decision-log")
          const decisionLog = createDecisionLog(taskID)

          const { ArchitectAgent } = await import("@/architect/agent")

          const result = await ArchitectAgent.coordinate({
            goals: targetGoals.map(g => ({
              id: g.id,
              title: g.title,
              objective: g.objective,
              acceptance_specs: (typeof g.acceptance_specs === "string" ? JSON.parse(g.acceptance_specs) : (g.acceptance_specs ?? [])) as AcceptanceSpec[],
              owned_paths: typeof g.owned_paths === "string" ? JSON.parse(g.owned_paths) : (g.owned_paths ?? []),
              depends_on: typeof g.depends_on === "string" ? JSON.parse(g.depends_on) : (g.depends_on ?? []),
              exports: typeof g.exports === "string" ? JSON.parse(g.exports) : (g.exports ?? []),
              imports: typeof g.imports === "string" ? JSON.parse(g.imports) : (g.imports ?? []),
              priority: g.priority as "blocking" | "advisory",
              kind: g.kind,
              requirement_ids: typeof g.requirement_ids === "string" ? JSON.parse(g.requirement_ids) : (g.requirement_ids ?? []),
            })),
            taskRequest: task.request,
            taskTitle: task.title,
            taskID,
            decisionLog,
            signal: input.signal,
            stream: {
              onChunk: async (arg: any) => {
                const chunk = (arg as any)?.chunk
                if (chunk?.type === "text-delta") {
                  if (hooks.onChunk) await hooks.onChunk({ chunk: { ...chunk, type: "reasoning-delta" } })
                } else {
                  if (hooks.onChunk) await hooks.onChunk(arg)
                }
              },
              onError: async (arg: any) => { if (hooks.onError) await hooks.onError(arg) },
            },
            onStatus: () => {},
          })

          await hooks.flush()


          // Sub-agent → caller boundary. Full blueprint prose is already
          // persisted under the Decision Log (architect phase) and surfaces
          // to per-goal executors via phasePromptSectionForGoal. The
          // orchestrator only needs a structured short ack.
          const summary = SubAgentProtocol.yieldResult({
            headline: `Architect coordination complete: ${result.contracts.length} contracts written to Decision Log.`,
            summary: result.summary,
            fields: result.contracts.length > 0
              ? [["categories", [...new Set(result.contracts.map((c) => c.category))]]]
              : [],
            pointer: "read_context scope=decisions (architect phase entries)",
          })

          await trackStepComplete("architect")

          // Phase-level completion event — Panel uses this to refresh the
          // Architect section without tracking individual workflow steps.
          // `sessionID` + `status` drive the overlay's session-card terminal
          // write.
          EngineProtocol.emit(
            EngineEvent.ArchitectCompleted,
            {
              taskID,
              sessionID: architectSession.id,
              status: "completed",
              contractCount: result.contracts.length,
              categories: [...new Set(result.contracts.map(c => c.category))],
              blueprintSummary: result.summary,
              summary,
            },
            { source: "orchestrator.architect" },
          )

          return summary
        } catch (err) {
          await hooks.flush().catch(() => {})
          EngineProtocol.emit(
            EngineEvent.ArchitectCompleted,
            {
              taskID,
              sessionID: architectSession.id,
              status: "error",
              error: err instanceof Error ? err.message : String(err),
              summary: "Architect failed",
            },
            { source: "orchestrator.architect" },
          )
          throw err
        }
      },
    }),

    // -----------------------------------------------------------------------
    // Per-goal tools — Orchestrator decides when to call each
    // -----------------------------------------------------------------------


    add_goal: tool({
      description:
        "Dynamically add a new goal to the task. Use when you discover missing " +
        "requirements, infrastructure needs, or integration gaps during execution. " +
        "All fields are validated by the same Zod schema as register_goal — invalid " +
        "input returns an error without inserting.",
      inputSchema: GoalContractAddInputSchema.extend({
        reason: z.string().describe("Why you decided to add this goal"),
      }),
      execute: async (input) => {
        const task = requireTask(taskID)
        const { insertGoalRows } = await import("@/engine/persist")
        const now = Date.now()
        const specSnapshotID = task.active_spec_version_id ?? Identifier.ascending("spec")
        const goals = Database.use((db) => insertGoalRows(db, {
          taskID,
          specSnapshotID,
          goals: [{
            goalID: Identifier.ascending("goal"),
            title: input.title,
            objective: input.objective,
            acceptance_specs: input.acceptance_specs,
            owned_paths: input.owned_paths,
            depends_on: input.depends_on,
            exports: input.exports,
            imports: input.imports,
            kind: input.kind,
            requirement_ids: [],
            priority: input.priority,
            source: "system" as const,
          }],
          now,
        }))
        return `Goal added: ${goals[0].id} — "${input.title}"`
      },
    }),

    modify_goal: tool({
      description:
        "Modify an existing goal's contract. Use when eval feedback suggests " +
        "acceptance_specs need refinement, or owned_paths need adjustment. " +
        "Updates are validated by the same Zod schema as register_goal — any " +
        "field that violates min-length / enum constraints is rejected.",
      inputSchema: z.object({
        goalID: z.string().describe("The goal ID to modify"),
        updates: GoalContractUpdateSchema.describe(
          "Fields to update — id is immutable; all other fields optional but validated when present",
        ),
        reason: z.string().describe("Why you decided to modify this goal"),
      }),
      execute: async ({ goalID, updates }) => {
        requireTask(taskID)
        const dbGoals = listGoals(taskID)
        const goal = dbGoals.find(g => g.id === goalID)
        if (!goal) return `Goal ${goalID} not found.`

        const setValues: Record<string, unknown> = { time_updated: Date.now() }
        if (updates.title !== undefined) setValues.title = updates.title
        if (updates.objective !== undefined) setValues.objective = updates.objective
        if (updates.acceptance_specs !== undefined) setValues.acceptance_specs = updates.acceptance_specs
        if (updates.owned_paths !== undefined) setValues.owned_paths = updates.owned_paths
        if (updates.depends_on !== undefined) setValues.depends_on = updates.depends_on
        if (updates.exports !== undefined) setValues.exports = updates.exports
        if (updates.imports !== undefined) setValues.imports = updates.imports
        if (updates.priority !== undefined) setValues.priority = updates.priority
        if (updates.kind !== undefined) setValues.kind = updates.kind

        // Contract change → drive the goal back to "pending" so it re-executes.
        // We do NOT write engine_goal.status directly: every path goes through
        // the goal_run chain so syncGoalStatus() projects the new status. This
        // keeps engine_goal.status authored by exactly two writers
        // (syncGoalStatus via updateGoalRun / Goal.startNewAttempt, and
        // updateGoalCascadeFailed for no-goal_run cascades).
        const contractFields = ["title", "objective", "acceptance_specs", "owned_paths", "depends_on", "exports", "imports", "priority", "kind"]
        const contractChanged = contractFields.some(f => f in setValues)
        const statusReset = contractChanged && (goalStatusByID(goal.id) === "passed" || goalStatusByID(goal.id) === "failed")

        const { EngineGoalTable } = await import("@/engine/engine.sql")
        Database.use((db) => {
          db.update(EngineGoalTable)
            .set(setValues as any)
            .where(eq(EngineGoalTable.id, goalID))
            .run()
        })

        const changed = Object.keys(setValues).filter(k => k !== "time_updated")

        let abortedRuns = 0
        let supersededTipID: string | undefined
        if (statusReset) {
          const { listGoalRunsForTask } = await import("@/engine/store")
          const { startNewAttempt } = await import("@/engine/persist")
          const { LIVE_GOAL_RUN_STATUSES } = await import("@/engine/catalog")
          // 1. Abort only LIVE goal_runs (queued/accepted/planning/running/
          //    evaluating/blocked). `completed` is never reset — its
          //    verification evidence is load-bearing, and the parent goal
          //    should not regress from passed → pending via a
          //    completed→aborted flip. The new attempt (step 2) supersedes
          //    the tip so dispatchability kicks in; GoalPool is the
          //    authoritative creator of the new goal_run.
          const toAbort = listGoalRunsForTask(taskID)
            .filter((row) => row.goal_id === goalID && LIVE_GOAL_RUN_STATUSES.includes(row.status))
          for (const row of toAbort) {
            updateGoalRun(row.id, { status: "aborted", error: "contract modified" })
          }
          abortedRuns = toAbort.length
          // 2. Open a new attempt under reason=modify_contract. Internally:
          //    supersedes any terminal tip → deriveGoalStatus projects
          //    pending → loop routes through pool.submit → pool.dispatchGoal
          //    → fresh goal_run under the new contract. Idempotent if the
          //    tip is already superseded. Emits GoalAttemptOpened so the
          //    overlay / decision-log observe the boundary.
          const result = startNewAttempt({
            goalID,
            reason: "modify_contract",
            feedback: {
              value:
                `Goal contract changed by modify_goal. Fields updated: ${changed.join(", ")}. ` +
                `The prior attempt ran against an outdated contract — re-read acceptance_specs, ` +
                `owned_paths, exports/imports, and the dependency context before re-implementing. ` +
                `Do not assume prior code satisfies the new contract.`,
              reason: `modify_goal: ${changed.length} contract field(s) updated (${changed.join(", ")})`,
            },
          })
          supersededTipID = result.supersededTipID
        }

        const resetSuffix = statusReset ? ` (status reset: ${goalStatusByID(goal.id)} → pending via goal_run chain)` : ""
        const abortSuffix = abortedRuns > 0 ? `, ${abortedRuns} prior goal_run(s) marked aborted` : ""
        const supersedeSuffix = supersededTipID ? `, tip ${supersededTipID} superseded` : ""
        return `Goal ${goalID} modified: ${changed.join(", ") || "(no changes)"}${resetSuffix}${abortSuffix}${supersedeSuffix}`
      },
    }),

    query_failed_goals: tool({
      description: "Query all currently failed goals with their latest delivery info. Returns one block per failed goal (acceptance_specs truncated, only latest run). Use BEFORE retry_goal to understand per-goal failure reasons.",
      inputSchema: z.object({}),
      execute: async () => {
        const dbGoals = listGoals(taskID)
        const failed = dbGoals.filter(g => goalStatusByID(g.id) === "failed")
        if (failed.length === 0) return "No failed goals."
        const { listGoalRunsForTask, findDeliveryByGoalRun } = await import("@/engine/store")
        const goalRuns = listGoalRunsForTask(taskID)
        const sections: string[] = [`## Failed Goals (${failed.length})`]
        const ACCEPTANCE_SPEC_CAP = 300
        const DELIVERY_FILES_CAP = 10
        for (const goal of failed) {
          sections.push(`\n### ${goal.id}: ${goal.title}`)
          sections.push(`- acceptance_specs:\n${renderSpecsAsText((goal.acceptance_specs ?? []) as AcceptanceSpec[]).slice(0, ACCEPTANCE_SPEC_CAP)}`)
          if (goal.owned_paths?.length) sections.push(`- owned_paths: ${goal.owned_paths.join(", ")}`)
          // listGoalRunsForTask is desc by time_created; first match is latest.
          const latestGr = goalRuns.find(gr => gr.goal_id === goal.id)
          if (latestGr) {
            const delivery = findDeliveryByGoalRun(latestGr.id)
            if (delivery) {
              sections.push(`- delivery summary: ${delivery.summary}`)
              const diffs = (delivery.result as any)?.diffs as Array<{ file: string }> | undefined
              if (diffs?.length) {
                const shown = diffs.slice(0, DELIVERY_FILES_CAP).map(f => f.file).join(", ")
                const more = diffs.length > DELIVERY_FILES_CAP ? ` (+${diffs.length - DELIVERY_FILES_CAP} more)` : ""
                sections.push(`- delivery files: ${shown}${more}`)
              }
            } else {
              sections.push(`- delivery: none`)
            }
            sections.push(`- goal_run status: ${latestGr.status}`)
            if (latestGr.error) sections.push(`- goal_run error: ${latestGr.error}`)
          } else {
            sections.push(`- no goal_run found`)
          }
        }
        const result = sections.join("\n")
        SubAgentProtocol.report(result, "tool:query_failed_goals")
        return result
      },
    }),

    retry_goal: tool({
      description:
        "Retry a single failed goal by opening a new attempt cycle (superseded_reason=manual_retry). " +
        "The old terminal goal_run stays immutable; the next dispatch_goal on this ID creates a fresh run. " +
        "Call query_failed_goals first to understand the failure; the schema requires root-cause analysis " +
        "so reflexive retry without understanding is impossible. " +
        "Per-goal retry budget (max_goal_retries) is enforced as a hard ceiling — once exhausted, change " +
        "strategy (modify_goal, add_goal, fail_task).",
      inputSchema: z.object({
        goalID: z.string().describe("The goal to retry. Must be currently failed or aborted."),
        reason: z
          .string()
          .min(20)
          .describe("Why you're retrying (min 20 chars, human-readable — shown in decision log)"),
        analysis: z.object({
          root_cause: z
            .string()
            .min(30)
            .describe("What went wrong in this goal (min 30 chars). Cite specific eval / delivery evidence."),
          failure_class: z
            .string()
            .describe(
              "Short snake_case failure category (code_bug / test_failure / missing_dependency / " +
                "wrong_approach / cross_goal_integration / flaky_environment / executor_incomplete). " +
                "Used to group retries in the decision log — stable labels let repeated failures of " +
                "the same kind become visible.",
            ),
          expected_fix: z.string().min(20).describe("What the retry should do differently (min 20 chars)."),
        }),
      }),
      execute: async ({ goalID, reason, analysis }) => {
        const task = requireTask(taskID)
        if (!task.active_run_id) return "No active run. Nothing to retry."

        const dbGoals = listGoals(taskID)
        const goal = dbGoals.find((g) => g.id === goalID)
        if (!goal) return `Goal ${goalID} not found.`
        if (goalStatusByID(goal.id) !== "failed") {
          return (
            `Goal ${goalID} is in status=${goalStatusByID(goal.id)}; retry_goal only applies to failed goals. ` +
            `To change the contract of a passed goal use modify_goal.`
          )
        }

        // Hard per-goal retry budget. Not a status-machine gate — a runaway
        // budget guardrail so a stuck LLM can't burn infinite iterations on
        // the same contract. Once exhausted the LLM must change strategy
        // (modify_goal / add_goal / fail_task) — the describe layer shows
        // retry_count / max_goal_retries so it can see this coming.
        const orchCfg = await EngineConfig.get()
        const maxGoalRetries = orchCfg.max_goal_retries
        const priorRetries = (goal as any).retry_count ?? 0
        if (priorRetries >= maxGoalRetries) {
          return (
            `Goal ${goalID} "${goal.title}" has exhausted its retry budget ` +
            `(${priorRetries}/${maxGoalRetries}). Change strategy:\n` +
            `  - modify_goal to change acceptance_specs / owned_paths\n` +
            `  - add_goal to insert a prerequisite\n` +
            `  - fail_task if the issue is fundamental`
          )
        }

        const { findLatestTipGoalRun } = await import("@/engine/store")
        const { startNewAttempt } = await import("@/engine/persist")
        const priorTip = findLatestTipGoalRun(goalID)
        if (!priorTip) {
          throw new Error(
            `retry_goal: goal ${goalID} is in status=${goalStatusByID(goal.id)} but has no prior goal_run; ` +
              `cannot retry without a row to supersede. This is a data inconsistency upstream of retry.`,
          )
        }

        const now = Date.now()
        // startNewAttempt is the single writer of `decision_log.phase="retry"`;
        // the executor reads that on its next dispatch. No parallel append here.
        startNewAttempt({
          goalID,
          reason: "manual_retry",
          now,
          feedback: {
            value: `[${analysis.failure_class}] ${analysis.expected_fix}`,
            reason: analysis.root_cause,
          },
        })

        Database.use((db) =>
          db.update(EngineGoalTable)
            .set({
              retry_count: priorRetries + 1,
              time_updated: now,
            })
            .where(eq(EngineGoalTable.id, goalID))
            .run(),
        )

        ensureGoalInWorkflow(goalID, goal.title)
        await trackStepStart("retry_goal", goalID)

        return (
          `Opened new attempt for goal "${goal.title}" (${goalID}) — ` +
          `retry ${priorRetries + 1}/${maxGoalRetries}, reason=manual_retry. ` +
          `Call dispatch_goal(["${goalID}"]) next to actually run it.\n` +
          `Analysis: [${analysis.failure_class}] ${analysis.expected_fix.slice(0, 120)}\n` +
          `Context: ${reason}`
        )
      },
    }),

    dispatch_goal: tool({
      description:
        "Dispatch specific goals for parallel execution in isolated worktrees. " +
        "Pool enforces idempotency — IDs that are already running or already satisfied " +
        "(completed tip with no superseded_reason) are silently skipped. You are responsible " +
        "for sequencing dependencies: read each goal's `depends_on` and `Attempts` in the " +
        "task description and call this tool in the right order (e.g. dispatch the dep " +
        "first, then the dependents once it lands). " +
        "STOP after calling this; you will be re-triggered when the pool drains.",
      inputSchema: z.object({
        goalIDs: z
          .array(z.string())
          .min(1)
          .describe(
            "Goal IDs to dispatch. The pool runs them in parallel up to the configured " +
              "concurrency; dependency ordering is your responsibility.",
          ),
        reason: z.string().optional().describe("Why you decided to dispatch these goals now"),
      }),
      execute: async ({ goalIDs, reason }) => {
        const task = requireTask(taskID)
        if (!task.active_run_id) return "No active run. Create one with create_run first."
        const run = requireRun(task.active_run_id)
        const plan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
        if (!plan) return "No plan found. Use create_run first."
        if (!isRunReadyForGoalDispatch({ status: run.status, planVersionID: run.plan_version_id })) {
          if (run.status === "queued") {
            return `Run ${run.id} is queued. Call submit_execution(runID=${run.id}) first so the task loop can activate and dispatch it.`
          }
          return `Run ${run.id} is ${run.status}. Only accepted/running/blocked runs may dispatch goals. Create a fresh run if this one is terminal.`
        }

        // Push the IDs onto the in-memory dispatch queue. The task loop
        // pulls this queue and calls pool.submit(ids) — the LLM's decision
        // is authoritative. Idempotency in the pool silently skips IDs
        // that are already live/satisfied, so re-listing a goal does no
        // harm, but without this tool the loop no longer auto-submits
        // anything.
        const { pushDispatch } = await import("./dispatch-queue")
        pushDispatch(taskID, goalIDs)

        stopAfterDispatch.abort("dispatch_goal")
        return (
          `Dispatched ${goalIDs.length} goal(s): ${goalIDs.join(", ")}. ` +
          `STOP HERE — task loop will run the pool and re-trigger you when the batch drains.` +
          (reason ? `\nReason: ${reason}` : "")
        )
      },
    }),

    read_context: tool({
      description: "Read current task context: goal states, delivery verdicts, Decision Log, delivery summaries. Use this to gather information before making decisions. Returns only the latest state per goal — historical evaluations/deliveries older than the latest per-goal entry are omitted to keep prompts bounded.",
      inputSchema: z.object({
        scope: z.enum(["goals", "evaluations", "decisions", "deliveries", "all"]).default("all").describe("What to read"),
      }),
      execute: async ({ scope }) => {
        const task = requireTask(taskID)
        const sections: string[] = []
        // Source-level caps on read_context output. Rationale: this tool is
        // called every orchestrator turn; tool results live forever in session
        // history. Unbounded accumulation (every historical eval, every run's
        // delivery, every decision) was the dominant contributor to the
        // orchestrator session growing from ~10K to 125K tokens across 16 turns.
        // Caps below preserve the LATEST state per goal rather than history.
        const DECISIONS_LIMIT = 20
        const EVAL_CHECK_EVIDENCE_CAP = 200

        if (scope === "goals" || scope === "all") {
          const goals = listGoals(taskID)
          sections.push(`## Goals (${goals.length})`)
          for (const g of goals) {
            sections.push(`- [${goalStatusByID(g.id)}] ${g.id}: ${g.title} [${g.priority}]`)
            sections.push(`  objective: ${g.objective.slice(0, 200)}`)
            sections.push(`  acceptance_specs:\n${renderSpecsAsText((g.acceptance_specs ?? []) as AcceptanceSpec[]).slice(0, 400)}`)
            if (g.owned_paths?.length) sections.push(`  owned_paths: ${g.owned_paths.join(", ")}`)
            if (g.depends_on?.length) sections.push(`  depends_on: ${g.depends_on.join(", ")}`)
          }
        }

        if (scope === "evaluations" || scope === "all") {
          const { findEvaluationsByTask, listGoalRunsForTask } = await import("@/engine/store")
          const evals = findEvaluationsByTask(taskID) // desc by time_created
          if (evals.length > 0) {
            // Dedup to latest eval per underlying goal. Multiple evals for
            // the same goal across retries only clutter — the latest verdict
            // is what drives next decisions. goal_run_id → goal_id lookup
            // avoids a SQL join by walking the task's goal_runs once.
            const runToGoal = new Map<string, string>()
            for (const gr of listGoalRunsForTask(taskID)) runToGoal.set(gr.id, gr.goal_id)
            const seenGoals = new Set<string>()
            const latestPerGoal: typeof evals = []
            for (const e of evals) {
              const goalID = e.goal_run_id ? runToGoal.get(e.goal_run_id) : undefined
              const key = goalID ?? `__run:${e.goal_run_id ?? e.id}`
              if (seenGoals.has(key)) continue
              seenGoals.add(key)
              latestPerGoal.push(e)
            }
            const omitted = evals.length - latestPerGoal.length
            const header = omitted > 0
              ? `\n## Evaluations (latest ${latestPerGoal.length} of ${evals.length}; ${omitted} superseded omitted)`
              : `\n## Evaluations (${latestPerGoal.length})`
            sections.push(header)
            for (const e of latestPerGoal) {
              sections.push(`- [${e.verdict}] ${e.summary}`)
              const checks = e.checks as Array<{ name: string; status: string; evidence?: string }> | undefined
              if (checks) {
                for (const c of checks.slice(0, 5)) {
                  const evidence = c.evidence ? c.evidence.slice(0, EVAL_CHECK_EVIDENCE_CAP) : ""
                  sections.push(`  - ${c.name}: ${c.status}${evidence ? ` — ${evidence}` : ""}`)
                }
              }
            }
          }
        }

        if (scope === "decisions" || scope === "all") {
          const { createDecisionLog } = await import("@/decision-log")
          const log = createDecisionLog(taskID)
          const section = log.toPromptSection({ limit: DECISIONS_LIMIT })
          if (section) sections.push(`\n${section}`)
        }

        if (scope === "deliveries" || scope === "all") {
          const { listGoalRunsForTask, findDeliveryByGoalRun } = await import("@/engine/store")
          const goalRuns = listGoalRunsForTask(taskID) // desc by time_created
          // Keep only the latest delivery per goal. Previous runs' deliveries
          // are historical noise once superseded; the orchestrator decides from
          // current state, not delivery history.
          const seenGoals = new Set<string>()
          const deliveries: Array<{ goalRunID: string; goalID: string; status: string; delivery: ReturnType<typeof findDeliveryByGoalRun> }> = []
          for (const gr of goalRuns) {
            if (seenGoals.has(gr.goal_id)) continue
            const delivery = findDeliveryByGoalRun(gr.id)
            if (!delivery) continue
            seenGoals.add(gr.goal_id)
            deliveries.push({ goalRunID: gr.id, goalID: gr.goal_id, status: gr.status, delivery })
          }
          if (deliveries.length > 0) {
            sections.push(`\n## Deliveries (${deliveries.length} — latest per goal)`)
            for (const d of deliveries) {
              const diffs = (d.delivery!.result as any)?.diffs as Array<{ file: string }> | undefined
              sections.push(`- goal_run ${d.goalRunID} [${d.status}]: ${d.delivery!.summary}`)
              if (diffs?.length) sections.push(`  files: ${diffs.map(f => f.file).join(", ")}`)
            }
          }
        }

        const result = sections.length > 0 ? sections.join("\n") : "No context available yet."
        // Telemetry: read_context is structurally bounded by the per-section
        // caps above, but if a future change blows through the budget the
        // protocol layer surfaces it instead of letting it slip silently.
        SubAgentProtocol.report(result, "tool:read_context")
        return result
      },
    }),

    create_run: tool({
      description: "Create a run record for goal execution. Returns the runID needed for submit_execution. Use after requirements + architect.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to create a run"),
      }),
      execute: async () => {
        const task = requireTask(taskID)
        const dbGoals = listGoals(taskID)
        if (dbGoals.length === 0) return "No goals found. Run requirements first."

        // Idempotency guard: refuse create_run while a prior run is still in
        // a non-terminal state. Creating a second run while the first is
        // running is the bug on tsk_d9bc59062001xuMSbxYap8hY5t — the new run
        // re-dispatched the already-passed bootstrap goal instead of moving
        // on to the pending batch-2 goals. After a run finishes (terminal
        // status: completed / failed / aborted), orchestrator may create a
        // new run for post-delivery rework.
        if (task.active_run_id) {
          const existing = findRun(task.active_run_id)
          if (existing && isLiveRunStatus(existing.status)) {
            return (
              `Run ${existing.id} is still ${existing.status}. Cannot create a new run while a prior one is live. ` +
              `Use dispatch_goal(goalIDs: [...]) to run specific goals. ` +
              `If you need rework, first modify_goal to update contracts, then this tool will permit a new run after the active one reaches terminal status.`
            )
          }
        }

        // Budget enforcement: max_runs
        const totalRuns = findRuns(taskID).length
        const maxRuns = await effectiveMaxRuns(task)
        if (totalRuns >= maxRuns) {
          return `Budget exhausted: ${totalRuns}/${maxRuns} runs used. Cannot create more runs. Consider delivering current state or failing the task.`
        }

        const now = Date.now()
        const executor = task.executor
        const sessionID = task.session_id!

        // Create a lightweight plan version (goals as plan nodes, no global planner)
        const planID = Identifier.ascending("plan")
        const { EnginePlanVersionTable, EnginePlanNodeTable, EngineGoalTable } =
          await import("@/engine/engine.sql")

        // Plan + plan_nodes + goal linkage go in one transaction (they're
        // domain-local to the plan snapshot). The run insert goes through
        // the writer layer afterwards so RunCreated is emitted and the
        // writer is the single insertion site.
        Database.transaction((db) => {
          db.insert(EnginePlanVersionTable).values({
            id: planID, task_id: taskID, spec_snapshot_id: task.active_spec_version_id ?? null,
            version: 1, status: "active",
            summary: `${dbGoals.length} goals`,
            prompt: task.request,
            metadata: {},
            time_created: now, time_updated: now,
          }).run()

          const goalToPlanNode = new Map<string, string>()
          const planNodeIDs: string[] = []
          for (const goal of dbGoals) {
            const pnID = Identifier.ascending("plan_node")
            planNodeIDs.push(pnID)
            goalToPlanNode.set(goal.id, pnID)
          }

          for (const [index, goal] of dbGoals.entries()) {
            const resolvedDeps = (goal.depends_on ?? []).flatMap((depGoalID: string) => {
              const pnID = goalToPlanNode.get(depGoalID)
              if (!pnID) log.warn("create_run: goal.depends_on references unknown goal ID — dropping", { goalID: goal.id, goalTitle: goal.title, unknownDep: depGoalID })
              return pnID ? [pnID] : []
            })

            db.insert(EnginePlanNodeTable).values({
              id: planNodeIDs[index],
              task_id: taskID,
              plan_version_id: planID,
              kind: "goal",
              goal_id: goal.id,
              title: goal.title,
              brief: renderSpecsAsText((goal.acceptance_specs ?? []) as AcceptanceSpec[]),
              depends_on_ids: resolvedDeps.length > 0 ? resolvedDeps : undefined,
              order_index: index,
              metadata: {},
              time_created: now, time_updated: now,
            }).run()
          }

          for (const goal of dbGoals) {
            db.update(EngineGoalTable)
              .set({ plan_version_id: planID, time_updated: now })
              .where(eq(EngineGoalTable.id, goal.id))
              .run()
          }
        })

        const { createRun } = await import("@/engine/writer")
        const created = createRun({
          taskID,
          planVersionID: planID,
          sessionID,
          executor,
          status: "queued",
          phase: "dispatch",
          summary: `create_run: ${dbGoals.length} goals queued`,
          now,
        })
        const runID = created.id

        // Link task to the new run/plan via updateTask so the transition is
        // CAS-guarded and emits TaskUpdated.
        await updateTask(
          requireTask(taskID),
          {
            active_plan_version_id: planID,
            active_run_id: runID,
            status: "active",
          },
          `create_run: planID=${planID} runID=${runID}`,
        )

        return `Run created. runID=${runID}, planID=${planID}, ${dbGoals.length} goals as plan nodes. Call submit_execution(runID=${runID}) to activate dispatch.`
      },
    }),

    submit_execution: tool({
      description: "Activate a run and dispatch all dependency-ready goals in parallel. Equivalent to activating the run then calling dispatch_goal. STOP after this call.",
      inputSchema: z.object({
        runID: z.string().describe("The run ID from create_run output"),
      }),
      execute: async ({ runID }) => {
        const task = requireTask(taskID)
        const run = requireRun(runID)
        if (task.active_run_id && task.active_run_id !== runID) {
          return `Run ${runID} is not the task's active run (active_run_id=${task.active_run_id}). Submit the active run or create a fresh run.`
        }
        if (!run.plan_version_id) {
          return `Run ${runID} has no plan_version_id. Create a fresh run before submitting execution.`
        }
        if (run.status === "completed" || run.status === "failed" || run.status === "aborted") {
          return `Run ${runID} is already ${run.status}. Create a fresh run before submitting execution again.`
        }
        if (run.status === "running" || run.status === "blocked") {
          stopAfterDispatch.abort("submit_execution")
          return `Run ${runID} is already ${run.status}. STOP HERE — task loop will continue dispatch via GoalPool.`
        }

        await updateTask(task, { status: "active", error: null, blocking_reason: null }, "Execution submitted")
        await updateRun(run, { status: "running" }, "Execution submitted")

        // The tool description promises "equivalent to activating the run then
        // calling dispatch_goal". Deliver on that: push every pending goal onto
        // the dispatch queue so the loop's `pullDispatch` has work. Without
        // this the loop sees no pending IDs, reaches "no dispatchable goals",
        // and the stale-state circuit breaker fails the task after 5 cycles.
        // GoalPool enforces its own dependency ordering + idempotency, so
        // "dependency-ready" is resolved inside the pool — we just enumerate
        // pending candidates here (the single projection consumers use for
        // dispatchability, per goal-status.ts::deriveGoalStatus).
        const readyIDs = listGoals(taskID)
          .filter((g) => goalStatusByID(g.id) === "pending")
          .map((g) => g.id)
        if (readyIDs.length === 0) {
          stopAfterDispatch.abort("submit_execution")
          return `Run ${runID} activated but no pending goals to dispatch. STOP HERE.`
        }
        const { pushDispatch } = await import("./dispatch-queue")
        pushDispatch(taskID, readyIDs)

        stopAfterDispatch.abort("submit_execution")
        return (
          `Run ${runID} activated; ${readyIDs.length} pending goal(s) pushed to dispatch queue: ` +
          `${readyIDs.join(", ")}. STOP HERE — task loop will run the pool and re-trigger you ` +
          `when the batch drains.`
        )
      },
    }),

    fail_task: tool({
      description: "Mark the task as failed. Use when the task cannot be completed.",
      inputSchema: z.object({
        error: z.string().describe("Why the task failed"),
      }),
      execute: async ({ error }) => {
        const task = requireTask(taskID)
        await updateTask(task, { status: "failed", error, time_completed: Date.now() }, `Failed: ${error}`)
        return `Task ${taskID} failed: ${error}`
      },
    }),

    restart_from_stage: tool({
      description: "Restart the task from a specific stage. Use when the current approach is fundamentally wrong, the user requests a restart, or you need to redo requirements/plan from scratch. `plan` fully regenerates the goal decomposition while keeping requirements intact — use it after repeated per-goal retry has failed to converge.",
      inputSchema: z.object({
        stage: z.enum(["requirements", "plan", "executor"]).describe(
          "`requirements`: re-elicit requirements; deletes spec + plan + goals. " +
          "`plan`: keep requirements; delete plan + goals so the architect fully re-decomposes from scratch. " +
          "`executor`: keep requirements + plan + goals; reset goal statuses so the executor re-runs each goal.",
        ),
        reason: z.string().describe("Why restarting from this stage"),
      }),
      execute: async ({ stage, reason }) => {
        const task = requireTask(taskID)
        const plan = restartStagePlan(stage, Boolean(task.active_plan_version_id))
        const now = Date.now()
        const runError = `restart_from_stage(${stage}): ${reason}`
        const {
          EngineGoalTable,
          EnginePlanVersionTable,
          EngineSpecSnapshotTable,
        } = await import("@/engine/engine.sql")
        const { abortLiveExecutionForTask, createRun } = await import("@/engine/writer")

        // Abort live execution state (goal_runs + coordinator runs) through
        // the shared writer primitive so restart and startup recovery share
        // the same termination semantics (CAS + state-machine + events).
        const aborted = await abortLiveExecutionForTask({
          taskID,
          reason: runError,
          includeGoalRuns: plan.retireGoalRuns,
        })
        const retiredGoalRuns = aborted.goalRuns
        const retiredRuns = aborted.runs

        let resetGoals = 0
        let deletedGoals = 0
        let freshRun: { id: string } | null = null

        if (plan.resetGoalStatuses) {
          const { resetTaskGoalsToPending } = await import("@/engine/persist")
          const result = resetTaskGoalsToPending({
            taskID,
            reason: runError,
            now,
          })
          resetGoals = result.total
        }

        Database.transaction((db) => {

          if (plan.deleteGoals) {
            const rows = db
              .select({ id: EngineGoalTable.id })
              .from(EngineGoalTable)
              .where(eq(EngineGoalTable.task_id, taskID))
              .all()
            deletedGoals = rows.length
            if (deletedGoals > 0) {
              db.delete(EngineGoalTable)
                .where(eq(EngineGoalTable.task_id, taskID))
                .run()
            }
          }

          if (plan.clearPlan && task.active_plan_version_id) {
            db.update(EnginePlanVersionTable)
              .set({ status: "superseded", time_updated: now })
              .where(eq(EnginePlanVersionTable.id, task.active_plan_version_id))
              .run()
          }

          if (plan.clearSpec && task.active_spec_version_id) {
            db.update(EngineSpecSnapshotTable)
              .set({ status: "superseded", time_updated: now })
              .where(eq(EngineSpecSnapshotTable.id, task.active_spec_version_id))
              .run()
          }
        })

        if (plan.queueFreshRun && task.active_plan_version_id) {
          const executor = task.executor
          freshRun = createRun({
            taskID,
            planVersionID: task.active_plan_version_id,
            sessionID: task.session_id ?? null,
            executor,
            status: "queued",
            phase: "dispatch",
            metadata: { restart_stage: stage },
            summary: `restart_from_stage(${stage}): fresh run queued`,
            now,
          })
        }

        // Route task status reset through updateTask so the restart emits
        // TaskUpdated + records a progress snapshot — same invariants every
        // other task status change goes through.
        const currentTask = requireTask(taskID)
        await updateTask(
          currentTask,
          {
            status: "active",
            error: null,
            blocking_reason: null,
            active_spec_version_id: plan.clearSpec ? null : currentTask.active_spec_version_id,
            active_plan_version_id: plan.clearPlan ? null : currentTask.active_plan_version_id,
            active_run_id: freshRun?.id ?? null,
          },
          `restart_from_stage(${stage})`,
        )
        const freshRunID = freshRun?.id ?? null

        const detail = [
          deletedGoals > 0 ? `${deletedGoals} goal(s) deleted` : null,
          resetGoals > 0 ? `${resetGoals} goal(s) reset to pending` : null,
          retiredGoalRuns > 0 ? `${retiredGoalRuns} goal_run(s) aborted` : null,
          retiredRuns > 0 ? `${retiredRuns} run(s) aborted` : null,
          freshRunID ? `fresh queued run=${freshRunID}` : null,
        ].filter(Boolean).join(", ")

        return `Task restarted from ${stage}. Reason: ${reason}. ${detail || "State cleared."} NEXT: ${plan.nextAction}${freshRunID ? `(${freshRunID})` : ""}.`
      },
    }),

    deliver: tool({
      description: "Aggregate all goal deliveries, then run the DeliveryAgent to verify build/test/startup, fix issues, and make final acceptance decision before publication. Delivery agent is the single verification gate. Check goal statuses via read_context before calling.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to deliver now"),
      }),
      execute: async () => {
        const task = requireTask(taskID)
        if (!task.active_run_id) return "No active run. Execute goals first."

        await trackStepStart("deliver")
        const run = requireRun(task.active_run_id)

        const goals = listGoals(taskID)

        // Hard lock: refuse delivery while any goals are still running/pending
        const notDone = goals.filter(g => isDispatchableGoal(g) && (goalStatusByID(g.id) === "running" || goalStatusByID(g.id) === "pending"))
        if (notDone.length > 0) {
          return `Cannot deliver: ${notDone.length} goal(s) still in progress (${notDone.map(g => `${g.title}:${goalStatusByID(g.id)}`).join(", ")}). Wait for ALL goals to complete before delivering.`
        }

        const blockingFailed = goals.filter(g => g.priority === "blocking" && goalStatusByID(g.id) === "failed")
        if (blockingFailed.length > 0) {
          const summary = blockingFailed.map(g => `[${goalStatusByID(g.id)}] ${g.title}`).join("; ")
          return `Cannot deliver: ${blockingFailed.length} blocking goal(s) failed. Fix them first: ${summary}`
        }

        // Aggregate per-goal deliveries
        const { listGoalRunsForRun, findDeliveryByGoalRun } = await import("@/engine/store")
        const goalRuns = listGoalRunsForRun(run.id)
        const allDiffs: Array<{ file: string; diff?: string; [key: string]: unknown }> = []
        const seenFiles = new Set<string>()
        const summaries: string[] = []
        const aggregatedGoalReports: Array<{ goalTitle: string; report: import("@/delivery/checks").GoalReportClaim }> = []
        for (const gr of goalRuns) {
          const d = findDeliveryByGoalRun(gr.id)
          if (!d) continue
          if (d.summary) summaries.push(d.summary)
          const result = d.result as {
            diffs?: Array<{ file: string; diff?: string; [key: string]: unknown }>
            report?: import("@/delivery/checks").GoalReportClaim
          } | null
          if (result?.report) {
            const goalRow = gr.goal_id
              ? Database.use((db) => db.select().from(EngineGoalTable).where(eq(EngineGoalTable.id, gr.goal_id!)).get())
              : undefined
            aggregatedGoalReports.push({
              goalTitle: goalRow?.title ?? gr.goal_id ?? gr.id,
              report: result.report,
            })
          }
          if (!result?.diffs) continue
          for (const diff of result.diffs) {
            if (!seenFiles.has(diff.file)) {
              seenFiles.add(diff.file)
              allDiffs.push(diff)
            }
          }
        }

        // Persist aggregated delivery — task-scoped variant, which is the
        // only path that creates the `scope='delivery'` evaluation row the
        // delivery-agent later settles via updateEvaluationFromDeliveryVerdict.
        const { persistTaskDelivery } = await import("@/engine/persist")
        const deliveryID = Identifier.ascending("delivery")
        persistTaskDelivery({
          task: task as any,
          run: run as any,
          deliveryID,
          delivery: {
            summary: summaries.length > 0 ? summaries.join("\n") : "Aggregated delivery",
            diffs: allDiffs,
          },
          now: Date.now(),
        })

        // Run DeliveryAgent to verify build/test/startup
        const allGoals = listGoals(taskID)
        const goalInfos = allGoals.map(g => ({
          id: g.id,
          title: g.title,
          description: g.objective,
          criteria: renderSpecsAsText((g.acceptance_specs ?? []) as AcceptanceSpec[]),
          priority: g.priority as "blocking" | "advisory",
        }))
        const deliveryInfo = {
          summary: summaries.join("\n"),
          changedFiles: allDiffs.map(d => d.file),
          diffs: allDiffs.map(d => ({ file: d.file, diff: d.diff })),
          goalReports: aggregatedGoalReports,
        }

        // Render the merged delivery output to a screenshot and register it
        // as a task attachment with intent="rendered_output". The delivery
        // agent consumes both the reference image(s) AND this rendered PNG
        // as multimodal attachments, and produces actionable spatial
        // feedback ("sidebar 20px wider than reference, primary color too
        // dark, hero CTA missing") that the executor can act on during
        // rework. No SSIM gate: a single similarity number told the
        // executor "different" but never "different where" — the metric
        // also made delivery lazy, rubber-stamping "visual_diff passed"
        // without really comparing. Rendering lives here rather than in
        // per-goal evaluator because only the merged worktree represents
        // the final artifact users see.
        let renderedAttachment:
          | { sha: string; url: string; mime: string; size: number; filename?: string; intent: "rendered_output"; source: "puppeteer" }
          | undefined
        try {
          const liveTask = requireTask(taskID)
          // Visual references for sizing the render viewport: union of user
          // attachments (figma/user-upload) and system_artifacts (URL
          // screenshots). The previous rendered_output (if any) is excluded —
          // the new render is what sets the comparison baseline this round.
          const visualPool = [
            ...(Array.isArray(liveTask.attachments) ? (liveTask.attachments as any[]) : []),
            ...(Array.isArray(liveTask.system_artifacts) ? (liveTask.system_artifacts as any[]) : []),
          ].filter((a) => a?.intent !== "rendered_output")
          const tagged = visualPool.filter((a) =>
            a?.intent === "visual_reference" && typeof a?.url === "string",
          )
          const imageAttachments = tagged.length > 0
            ? tagged
            : visualPool.filter((a) =>
                typeof a?.mime === "string" && a.mime.startsWith("image/") && typeof a?.url === "string",
              )
          if (imageAttachments.length > 0) {
            const { findRenderedIndex, renderPage } = await import("@/delivery/checks/visual")
            const { AttachmentStore } = await import("@/storage/attachment-store")
            const renderedHtml = await findRenderedIndex(Instance.directory)
            if (!renderedHtml) {
              log.warn("deliver: no index.html found under merged worktree — skipping render", {
                taskID, dir: Instance.directory,
              })
            } else {
              // Pick the first image attachment to size the viewport. All
              // references are later shown to the delivery LLM multimodally
              // so the choice here is purely about matching the rendered
              // viewport to the primary reference's native size.
              const ref = imageAttachments[0]
              const located = AttachmentStore.nameFromUrl(String(ref.url))
              const refPath = located
                ? AttachmentStore.resolveAbsolute(located.projectID, located.name)
                : undefined
              if (!refPath) {
                log.warn("deliver: reference attachment could not be resolved — rendering at default viewport", {
                  taskID, url: ref.url,
                })
              }
              const visualOut = path.join(Instance.directory, ".opencorvus", "visual-diff")
              const { renderedPath, size } = await renderPage({
                rendered: renderedHtml,
                outDir: visualOut,
                referenceForViewport: refPath,
                viewport: refPath ? undefined : { width: 1440, height: 900 },
              })
              // Persist the rendered screenshot to the attachment store so
              // the delivery agent's multimodal prompt can inline it the
              // same way it inlines user-provided references.
              const bytes = await (await import("node:fs/promises")).readFile(renderedPath)
              const written = await AttachmentStore.write(
                liveTask.project_id,
                bytes,
                "image/png",
                "rendered.png",
              )
              renderedAttachment = {
                sha: written.sha,
                url: written.url,
                mime: written.mime,
                size: written.size,
                filename: written.filename,
                intent: "rendered_output",
                source: "puppeteer",
              }
              // System-generated visual evidence — lives in system_artifacts,
              // not the user-contract attachments column. Replace-by-intent so
              // reruns don't accumulate stale rendered PNGs.
              await EngineService.replaceTaskSystemArtifactByIntent(
                taskID,
                "rendered_output",
                renderedAttachment,
              )
              log.info("deliver: rendered merged worktree", {
                taskID, renderedPath, size, sha: renderedAttachment.sha,
              })
            }
          }
        } catch (renderErr) {
          log.warn("deliver: render step failed — delivery agent will see reference only", {
            taskID, error: renderErr instanceof Error ? renderErr.message : String(renderErr),
          })
        }

        const deliverySession = await Session.createNext({
          kind: "delivery",
          parentID: input.agentSessionID,
          title: `Delivery verification: ${task.title}`,
          directory: Instance.directory,
        })
        const hooks = sessionStreamHooks({ sessionID: deliverySession.id, taskID, stage: "delivery" })


        try {
          const { DeliveryService } = await import("@/delivery/service")
          const { DeliveryVerdict } = await import("@/delivery/agent")
          // Re-read the task row to pick up references materialized during
          // design_analysis. Delivery sees BOTH columns: user-contract
          // attachments (figma frames, user uploads) AND system_artifacts
          // (URL screenshots from design_analysis, plus the just-rendered
          // PNG of the merged worktree). The visual-comparison loop needs
          // both to diff "what we built" against "what the user asked for".
          const taskForDelivery = requireTask(taskID)
          type AttachmentRef = { sha: string; url: string; mime: string; size: number; filename?: string; intent?: string; source?: string }
          const deliveryAttachments = [
            ...(Array.isArray(taskForDelivery.attachments) ? (taskForDelivery.attachments as AttachmentRef[]) : []),
            ...(Array.isArray(taskForDelivery.system_artifacts) ? (taskForDelivery.system_artifacts as AttachmentRef[]) : []),
          ].filter((a) => typeof a?.mime === "string" && a.mime.startsWith("image/") && typeof a?.url === "string")

          // Short-circuit: if the per-goal evaluator already flagged strict
          // checks as failed, the delivery LLM cannot rescue the outcome —
          // the post-hoc hard gate below would force-reject anyway. Skipping
          // Delivery agent runs unconditionally — no pre-flight evaluator gate,
          // no strict-check short-circuit, no post-hoc verdict override. The
          // agent reads acceptance_specs as INFORMATION and verifies them
          // itself (Phase 2 / 2.5 in DELIVERY_AGENT_SYSTEM), including per-goal
          // subagent dispatch for adversarial review at scale.
          const verdict: import("@/delivery/agent").DeliveryVerdictType =
            await DeliveryService.verify({
              task: {
                id: task.id,
                title: task.title,
                request: task.request,
                sessionID: task.session_id ?? undefined,
                metadata: task.metadata ?? undefined,
                design_specs: Array.isArray(task.design_specs) ? task.design_specs as any : undefined,
              },
              goals: goalInfos,
              delivery: deliveryInfo,
              attachments: deliveryAttachments,
              signal: input.signal,
              stream: {
                onChunk: async (arg: any) => {
                  const chunk = (arg as any)?.chunk
                  if (chunk?.type === "text-delta") {
                    if (hooks.onChunk) await hooks.onChunk({ chunk: { ...chunk, type: "reasoning-delta" } })
                  } else {
                    if (hooks.onChunk) await hooks.onChunk(arg)
                  }
                },
                onError: async (arg: any) => { if (hooks.onError) await hooks.onError(arg) },
              },
            })
          await hooks.flush()

          // Persist verdict as artifact
          const { EngineArtifactTable } = await import("@/engine/engine.sql")
          const verdictArtifactId = Identifier.ascending("artifact")
          Database.use((db) =>
            db.insert(EngineArtifactTable).values({
              id: verdictArtifactId,
              task_id: taskID,
              run_id: run.id,
              delivery_id: deliveryID,
              kind: "verdict",
              label: "delivery-agent-verdict",
              payload: verdict,
              time_created: Date.now(),
              time_updated: Date.now(),
            }).run()
          )

          // Sink delivery agent's structured verdict into engine_task.criteria_results.
          // The verdict carries three distinct typed surfaces — flatten them into the
          // unified criteria stream so the overlay's Quality Gates panel reflects what
          // the agent actually verified, not just a single pass/fail bit.
          await sinkDeliveryVerdictToCriteria(taskID, verdict)

          const passedCount = goals.filter(g => goalStatusByID(g.id) === "passed").length
          const failedCount = goals.filter(g => goalStatusByID(g.id) === "failed").length
          // ── DAM: run metric executor + Arbiter ─────────────────────────
          // The delivery-agent's verdict is an advisory signal; the Arbiter
          // is the authoritative verdict source. Even an "accepted" agent
          // verdict must pass the Arbiter's blocking-metric gate.
          const {
            executeMetrics,
          } = await import("@/metrics/executor")
          const { computeIterationSnapshot } = await import("@/metrics/score")
          const {
            arbitrate,
            ARBITER_DEFAULTS,
          } = await import("@/metrics/arbiter")
          const {
            readCounterexamplesForTask,
            readIterationHistory,
            readPreviousAggregateScore,
            readResultsForIteration,
            readSpecsForTask,
            writeIterationSnapshot,
          } = await import("@/metrics/store")

          const priorIterations = readIterationHistory(taskID)
          const iteration = priorIterations.length
          await executeMetrics({
            task_id: taskID,
            iteration,
            delivery: {
              summary: verdict.summary,
              changed_files: Array.isArray((deliveryInfo as any)?.changed_files)
                ? ((deliveryInfo as any).changed_files as string[])
                : undefined,
              requirement_text: task.request,
            },
          })

          // Prosecutor — adversarial probe AFTER metrics, BEFORE snapshot.
          // Its tool calls (mark_counterexample, propose_challenge_metric)
          // write directly to DB, so the snapshot we build next sees the new
          // counterexamples and challenges.
          try {
            const { runProsecutor } = await import("@/delivery/prosecutor")
            const rawSeeds = Array.isArray(task.architect_challenge_seeds)
              ? task.architect_challenge_seeds
              : []
            const architectSeeds = rawSeeds
              .filter(
                (s) =>
                  typeof s.id === "string" &&
                  (s.scope === "goal" || s.scope === "global") &&
                  typeof s.target_ref === "string" &&
                  typeof s.claim === "string" &&
                  typeof s.rationale === "string" &&
                  (s.priority_hint === "high" ||
                    s.priority_hint === "medium" ||
                    s.priority_hint === "low"),
              )
              .map((s) => ({
                id: s.id as string,
                scope: s.scope as "goal" | "global",
                target_ref: s.target_ref as string,
                claim: s.claim as string,
                rationale: s.rationale as string,
                priority_hint: s.priority_hint as "high" | "medium" | "low",
              }))
            const pRes = await runProsecutor({
              task: {
                id: task.id,
                title: task.title,
                request: task.request,
                sessionID: task.session_id ?? undefined,
              },
              iteration,
              defenderVerdict: verdict,
              architectSeeds,
              signal: input.signal,
            })
            log.info("deliver: prosecutor done", {
              taskID,
              iteration,
              filed: pRes.counterexamples_filed,
              proposed: pRes.challenges_proposed,
              resolved: pRes.counterexamples_resolved,
            })
          } catch (err) {
            log.warn("deliver: prosecutor failed — continuing without adversarial pass", {
              taskID,
              iteration,
              err: err instanceof Error ? err.message : String(err),
            })
          }

          const specs = readSpecsForTask(taskID)
          const currentResults = readResultsForIteration(taskID, iteration)
          const previousResults =
            iteration > 0 ? readResultsForIteration(taskID, iteration - 1) : []
          const counterexamples = readCounterexamplesForTask(taskID)
          const previousAggregateScore = readPreviousAggregateScore(taskID, iteration)
          const snapshot = computeIterationSnapshot({
            task_id: taskID,
            iteration,
            specs,
            currentResults,
            previousResults,
            counterexamples,
            previousAggregateScore,
          })
          const orchCfgForArbiter = await EngineConfig.get()
          const arbiterConfig = {
            ...ARBITER_DEFAULTS,
            maxIterations: orchCfgForArbiter.max_delivery_iterations,
          }
          const decision = arbitrate([...priorIterations, snapshot], arbiterConfig)
          writeIterationSnapshot({ ...snapshot, arbiter_verdict: decision.verdict })
          log.info("deliver: arbiter decided", {
            taskID,
            iteration,
            agentVerdict: verdict.verdict,
            arbiterVerdict: decision.verdict,
            reason: decision.reason,
            aggregate_score: snapshot.aggregate_score.toFixed(3),
            blocking_unmet: snapshot.blocking_unmet_count,
          })

          if (decision.verdict === "accept") {
            await trackStepComplete("deliver")
            log.info("deliver: arbiter accepted, auto-publishing", { taskID, runID: run.id, deliveryID })
            // Auto-publish: verification passed → immediately complete task.
            // No second LLM turn needed — avoids infinite loop where LLM ends turn
            // without calling publish_delivery.
            try {
              const delivery = findDeliveryByRun(run.id)
              if (!delivery) return `Delivery verified and ACCEPTED but no delivery record found.`
              const verdictArtifact = Database.use((db) =>
                db.select().from(EngineArtifactTable)
                  .where(eq(EngineArtifactTable.id, verdictArtifactId))
                  .get()
              )
              markDeliveryPublishing(delivery.id, Date.now())
              const PUBLISH_TIMEOUT_MS = 60_000
              const currentTask = requireTask(taskID)
              const publishResult = await Promise.race([
                Publisher.deliver({ task: currentTask, run, delivery }),
                new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Publisher.deliver() timeout")), PUBLISH_TIMEOUT_MS)),
              ])
              const completed = Date.now()
              finalizeDeliveryResult({ deliveryId: delivery.id, taskId: taskID, runId: run.id, delivery, result: publishResult, now: completed })
              if (publishResult.status === "delivered") {
                const current = requireTask(taskID)
                const currentPlan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
                const published = findDeliveryByRun(run.id) ?? delivery
                const verdictPayload = verdictArtifact?.payload as { verdict?: string; summary?: string; issues_found?: string[] } | null
                if (verdictPayload?.verdict) {
                  const issues = Array.isArray(verdictPayload.issues_found)
                    ? verdictPayload.issues_found
                    : []
                  updateEvaluationFromDeliveryVerdict({
                    deliveryID: delivery.id,
                    verdict: verdictPayload.verdict as "accepted" | "rejected" | "inconclusive",
                    summary: verdictPayload.summary ?? "Delivery agent verification",
                    // Record agent-reported issues as structured failed-check
                    // rows for operator-facing drill-down. Convergence lives
                    // in engine_iteration, not these rows.
                    checks: issues.map((evidence, i) => ({
                      name: `issue-${i + 1}`,
                      status: "failed" as const,
                      evidence,
                      scorer_kind: "delivery_verdict" as const,
                    })),
                    now: completed,
                  })
                }
                const finalized = await EngineGit.complete(current, currentPlan, published)
                if (finalized.error) {
                  await updateTask(current, { status: "failed", blocking_reason: null, error: finalized.error, time_completed: completed }, finalized.error)
                  return `Git finalization failed: ${finalized.error}`
                }
                // Ensure task is in "active" before completing (recovery may have reset to "queued")
                const preComplete = requireTask(taskID)
                if (preComplete.status === "queued") {
                  await updateTask(preComplete, { status: "active" }, "Activating for completion")
                }
                const readyTask = requireTask(taskID)
                await updateTask(readyTask, { status: "completed", blocking_reason: null, error: null, time_completed: completed }, "Task completed")
                const { Plugin } = await import("@/plugin")
                await Plugin.trigger("delivery.ready", { taskID, runID: run.id, deliveryID: delivery.id }, { actions: [] }).catch(err => log.warn("plugin 'delivery.ready' trigger failed (non-fatal)", { error: String(err) }))
                EngineMemoryBridge.flushTaskLearnings({ task: currentTask, run, delivery, evaluation: findEvaluationByRun(run.id), plan: currentPlan })
                  .catch(err => log.warn("failed to flush task learnings", { error: String(err) }))
                return `Delivery published and task completed successfully. You can call refine to analyze the project and suggest improvements for the next iteration.`
              }
              await updateTask(currentTask, { status: "failed", blocking_reason: null, error: publishResult.summary, time_completed: completed }, publishResult.summary)
              return `Publish returned non-delivered status: ${publishResult.summary}`
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              log.error("deliver: auto-publish failed", { taskID, error: msg, stack: err instanceof Error ? err.stack : undefined })
              return `Delivery verified and ACCEPTED but publish failed: ${msg}. Call publish_delivery to retry.`
            }
          }
          await trackStepComplete("deliver", undefined, true)

          // Persist the delivery-agent's advisory verdict into the evaluation
          // row for operator-facing drill-down. Convergence lives in
          // engine_iteration — this row is for audit only.
          updateEvaluationFromDeliveryVerdict({
            deliveryID,
            verdict: verdict.verdict,
            summary: verdict.summary,
            checks: verdict.issues_found.map((evidence, i) => ({
              name: `issue-${i + 1}`,
              status: "failed" as const,
              evidence,
              scorer_kind: "delivery_verdict" as const,
            })),
            now: Date.now(),
          })

          // Arbiter verdict routing. The metric trajectory lives in
          // engine_iteration — the assistant reads it via query_metric_trajectory
          // on the next turn. On `continue` we open a fresh attempt cycle
          // for every passed/completed goal under reason=delivery_rework
          // so the dispatch loop picks them up without LLM intervention.
          if (decision.verdict === "stalled") {
            const failMsg = SubAgentProtocol.yieldResult({
              headline: `Delivery stalled — ${decision.reason}. Agent summary: ${verdict.summary}`,
              fields: [
                ["issues_found", verdict.issues_found],
                ["iteration", String(iteration)],
                ["aggregate_score", snapshot.aggregate_score.toFixed(3)],
              ],
              pointer: `verdict artifact ${verdictArtifactId}`,
            })
            const currentTaskR = requireTask(taskID)
            if (currentTaskR.status === "active") {
              await updateTask(
                currentTaskR,
                { status: "failed", error: failMsg, time_completed: Date.now() },
                failMsg,
              )
            }
            stopAfterDispatch.abort("deliver_stalled")
            return failMsg
          }

          if (decision.verdict === "abort") {
            const failMsg = SubAgentProtocol.yieldResult({
              headline: `Delivery aborted — ${decision.reason}`,
              fields: [
                ["issues_found", verdict.issues_found],
                ["iteration", String(iteration)],
                ["aggregate_score", snapshot.aggregate_score.toFixed(3)],
              ],
              pointer: `verdict artifact ${verdictArtifactId}`,
            })
            const currentTaskR = requireTask(taskID)
            if (currentTaskR.status === "active") {
              await updateTask(
                currentTaskR,
                { status: "failed", error: failMsg, time_completed: Date.now() },
                failMsg,
              )
            }
            stopAfterDispatch.abort("deliver_abort")
            return failMsg
          }

          // decision.verdict === "continue": rejection within the iteration
          // budget. Open a fresh attempt cycle on every goal whose tip is
          // currently passed/completed — Goal.startNewAttempt(reason=
          // "delivery_rework") sets superseded_reason on the old terminal tip,
          // syncGoalStatus projects pending, and the dispatch loop re-runs
          // the goal under the new attempt. Mechanism is decoupled from LLM
          // decision: state flips unconditionally; the orchestrator only
          // chooses *strategy* (modify_goal / add_goal / let-it-redispatch)
          // when it next runs.
          //
          // engine_iteration + the verdict artifact persisted above are the
          // canonical source of truth for the rejection details — the
          // orchestrator reads them via query_metric_trajectory and the
          // loop reads the verdict artifact directly to populate the
          // delivery_rejected trigger.feedback. No task.metadata signal.
          const { startNewAttempt } = await import("@/engine/persist")
          // Attribution is the delivery agent's job. `verdict.affected_goal_ids`
          // is a contract-required non-empty array on rejection (enforced in
          // DeliveryAgent.normalizeVerdict). We open a fresh attempt on exactly
          // those goals — no string-matching of rejection_details[].file vs
          // owned_paths here, and no "if attribution is empty, reset every
          // passed goal" blanket policy. That blanket reset was dressed up as
          // "baseline correctness" but it reset goals the rejection never
          // cited and wiped valid work on every ambiguous rejection —
          // violating rule 1 (no fallback) and rule 23 (no hardcoded state
          // machine; let the LLM — here, the delivery agent — decide).
          const goalByID = new Map(goals.map((g) => [g.id, g]))
          const unknownAffected: string[] = []
          const toReset: typeof goals = []
          for (const gid of verdict.affected_goal_ids) {
            const g = goalByID.get(gid)
            if (!g) { unknownAffected.push(gid); continue }
            toReset.push(g)
          }
          if (unknownAffected.length > 0) {
            // Delivery agent cited a goal id that is not in this task's goal
            // set. Surface loud — either the agent hallucinated an id, or the
            // prompt forgot to list a real goal. Either way the rejection is
            // not actionable as-is; fail the delivery so the orchestrator
            // re-runs instead of silently dropping those ids.
            throw new Error(
              `Delivery verdict cites unknown affected_goal_ids: ${unknownAffected.join(", ")}. ` +
              `Known goals for this task: ${[...goalByID.keys()].join(", ") || "(none)"}.`,
            )
          }
          // Per-goal rejection slice: the delivery agent already attributed
          // each rejection_details[] entry to a specific goal_id; feed that
          // subset (plus the task-level summary) into startNewAttempt so the
          // executor's next prompt shows exactly what this goal must fix.
          // Without this, delivery_rework reworks ran against an unchanged
          // prompt (the root cause we're fixing here).
          for (const g of toReset) {
            const ownDetails = (verdict.rejection_details ?? []).filter(
              (d) => d.goal_id === g.id,
            )
            const detailLines = ownDetails.length > 0
              ? ownDetails.map((d) => {
                  const parts: string[] = [`[${d.category}] ${d.error}`]
                  if (d.file) parts.push(`(file: ${d.file})`)
                  if (d.suggestion) parts.push(`suggestion: ${d.suggestion}`)
                  if (d.visual_spec_id) parts.push(`visual_spec: ${d.visual_spec_id}`)
                  return `- ${parts.join(" ")}`
                })
              : [`- (delivery agent attributed this goal but wrote no per-goal details)`]
            const value = [
              `Delivery agent rejected the integrated deliverable (iteration ${iteration}, arbiter=${decision.verdict}).`,
              `Task-level summary: ${verdict.summary}`,
              `Issues attributed to this goal:`,
              ...detailLines,
            ].join("\n")
            const reason = verdict.issues_found.length > 0
              ? `Delivery rejection; ${verdict.issues_found.length} issue(s): ${verdict.issues_found.slice(0, 3).join("; ")}`
              : `Delivery rejection; arbiter_verdict=${decision.verdict}; arbiter_reason=${decision.reason}`
            startNewAttempt({
              goalID: g.id,
              reason: "delivery_rework",
              feedback: { value, reason },
            })
          }

          try {
            const { createDecisionLog } = await import("@/decision-log")
            const decisionLog = createDecisionLog(taskID)
            decisionLog.append({
              phase: "delivery",
              key: `delivery_rejection_${iteration}`,
              value: verdict.summary,
              reason: verdict.issues_found.join("; "),
            })
          } catch {
            /* best effort */
          }

          log.info("deliver: rejection opened new attempts", {
            taskID,
            iteration,
            issues: verdict.issues_found.length,
            reset_goals: toReset.length,
            affected_goal_ids: verdict.affected_goal_ids,
          })

          stopAfterDispatch.abort("delivery_rework")
          return SubAgentProtocol.yieldResult({
            headline: `Delivery rejected — iteration ${iteration}, arbiter=${decision.verdict}, assistant must re-plan`,
            fields: [
              ["issues_found", verdict.issues_found],
              ["iteration", String(iteration)],
              ["arbiter_reason", decision.reason],
            ],
            pointer: `verdict artifact ${verdictArtifactId}; call query_metric_trajectory for full trajectory`,
          })
        } catch (err) {
          await trackStepComplete("deliver", undefined, true)

          const msg = err instanceof Error ? err.message : String(err)
          log.error("deliver: verification failed", { taskID, error: msg })
          // Delivery verification threw. Write a stale-result iteration snapshot
          // so the Arbiter can see the attempt, then let the arbiter decide
          // whether this is an abort (e.g. two consecutive failures).
          const {
            computeIterationSnapshot: computeSnapshotErr,
          } = await import("@/metrics/score")
          const {
            arbitrate: arbitrateErr,
            ARBITER_DEFAULTS: ARBITER_DEFAULTS_ERR,
          } = await import("@/metrics/arbiter")
          const {
            readCounterexamplesForTask: readCeErr,
            readIterationHistory: readHistErr,
            readPreviousAggregateScore: readPrevErr,
            readResultsForIteration: readResErr,
            readSpecsForTask: readSpecsErr,
            writeIterationSnapshot: writeSnapshotErr,
          } = await import("@/metrics/store")
          const priorItersErr = readHistErr(taskID)
          const iterationErr = priorItersErr.length
          const snapshotErr = computeSnapshotErr({
            task_id: taskID,
            iteration: iterationErr,
            specs: readSpecsErr(taskID),
            currentResults: readResErr(taskID, iterationErr),
            previousResults:
              iterationErr > 0 ? readResErr(taskID, iterationErr - 1) : [],
            counterexamples: readCeErr(taskID),
            previousAggregateScore: readPrevErr(taskID, iterationErr),
          })
          const orchCfgErr = await EngineConfig.get()
          const decisionErr = arbitrateErr([...priorItersErr, snapshotErr], {
            ...ARBITER_DEFAULTS_ERR,
            maxIterations: orchCfgErr.max_delivery_iterations,
          })
          writeSnapshotErr({ ...snapshotErr, arbiter_verdict: decisionErr.verdict })

          if (decisionErr.verdict === "abort" || decisionErr.verdict === "stalled") {
            const failMsg = `Delivery verification threw (${msg}). Arbiter verdict=${decisionErr.verdict}: ${decisionErr.reason}`
            const currentTaskE = requireTask(taskID)
            if (currentTaskE.status === "active") {
              await updateTask(
                currentTaskE,
                { status: "failed", error: failMsg, time_completed: Date.now() },
                failMsg,
              )
            }
            stopAfterDispatch.abort("deliver_rejected")
            return failMsg
          }

          // Delivery agent THREW — this is an infrastructure fault
          // (network, LLM parse retry exhaustion, tool crash), NOT a
          // verdict that goals are unacceptable. Do NOT open new attempts
          // on passed goals: a throw carries zero evidence that any
          // specific goal is at fault. That was rule-1 / rule-23 violation
          // — the same blanket-reset pattern we removed from the rejected
          // path. Instead: record the failure, let the orchestrator (LLM)
          // read it and decide on the next turn whether to retry_goal,
          // fail_task, or modify a goal.
          try {
            const { createDecisionLog } = await import("@/decision-log")
            const decisionLog = createDecisionLog(taskID)
            decisionLog.append({
              phase: "delivery",
              key: `delivery_verification_threw_${iterationErr}`,
              value: `Delivery agent threw: ${msg}`,
              reason: `arbiter_verdict=${decisionErr.verdict}; arbiter_reason=${decisionErr.reason}`,
            })
          } catch {
            /* best effort */
          }

          stopAfterDispatch.abort("delivery_threw")
          return (
            `Delivery verification threw (not a structured rejection): ${msg}. ` +
            `Iteration ${iterationErr}, arbiter=${decisionErr.verdict} (reason: ${decisionErr.reason}). ` +
            `No goals were reset — the throw is an infrastructure fault and carries no per-goal ` +
            `attribution. Read the decision log entry delivery_verification_threw_${iterationErr} and ` +
            `decide: retry_goal on a suspect goal, modify_goal if the contract looks wrong, or fail_task ` +
            `if the failure is fundamental.`
          )
        }
      },
    }),

    publish_delivery: tool({
      description:
        "Publish the accepted delivery to git and mark the task as completed. " +
        "You decide when it is safe to publish — the describe layer shows every goal's " +
        "`is_terminal_ok` / `is_terminal_fail` / `needs_redispatch` flags and the latest " +
        "delivery verdict. If a blocking goal is failing you must fix it first; no tool " +
        "gate blocks a knowingly-incomplete publish, the decision is yours.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Confirmation that both verifications passed"),
      }),
      execute: async () => {
        const task = requireTask(taskID)
        const run = task.active_run_id ? requireRun(task.active_run_id) : undefined
        if (!run) return "No active run."

        // No blocking-failed gate here — the LLM reads the describe layer and
        // decides. Delivery existence is still required (we cannot publish
        // what was never built); that's a physical precondition, not a status
        // cache check.
        const delivery = findDeliveryByRun(run.id)
        if (!delivery) return "No delivery found."

        // Require delivery to exist before publishing
        const { EngineArtifactTable } = await import("@/engine/engine.sql")
        const verdictArtifact = Database.use((db) =>
          db.select().from(EngineArtifactTable)
            .where(and(eq(EngineArtifactTable.run_id, run.id), eq(EngineArtifactTable.label, "delivery-agent-verdict")))
            .limit(1).get()
        )
        if (!verdictArtifact) return "Delivery not verified. Run deliver first to aggregate and verify goal deliveries."

        markDeliveryPublishing(delivery.id, Date.now())

        const PUBLISH_TIMEOUT_MS = 60_000
        let result: Awaited<ReturnType<typeof Publisher.deliver>>
        try {
          result = await Promise.race([
            Publisher.deliver({ task, run, delivery }),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Publisher.deliver() timeout")), PUBLISH_TIMEOUT_MS)),
          ])
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log.error("publish_delivery failed", { taskID: task.id, runID: run.id, error: msg })
          return `Publish failed: ${msg}. Decide whether to retry or fail the task.`
        }

        const completed = Date.now()
        finalizeDeliveryResult({ deliveryId: delivery.id, taskId: task.id, runId: run.id, delivery, result, now: completed })

        if (result.status === "delivered") {
          const current = requireTask(task.id)
          const currentPlan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
          const published = findDeliveryByRun(run.id) ?? delivery

          // Update the evaluation row persistTaskDelivery() created for this
          // delivery. 1:1 task-delivery↔evaluation invariant: the row always
          // exists here (per-goal deliveries never touch this path).
          // No `checks` argument: the `deliver` tool already wrote the full
          // structured check set; updateEvaluationFromDeliveryVerdict
          // preserves existing checks when none are supplied.
          const verdictPayload = verdictArtifact.payload as { verdict?: string; summary?: string; issues_found?: string[] } | null
          if (verdictPayload?.verdict) {
            updateEvaluationFromDeliveryVerdict({
              deliveryID: delivery.id,
              verdict: verdictPayload.verdict as "accepted" | "rejected" | "inconclusive",
              summary: verdictPayload.summary ?? "Delivery agent verification",
              now: completed,
            })
          }

          const finalized = await EngineGit.complete(current, currentPlan, published)
          if (finalized.error) {
            await updateTask(current, { status: "failed", blocking_reason: null, error: finalized.error, time_completed: completed }, finalized.error)
            return `Git finalization failed: ${finalized.error}`
          }
          await updateTask(finalized.task, { status: "completed", blocking_reason: null, error: null, time_completed: completed }, "Task completed")
          const { Plugin } = await import("@/plugin")
          await Plugin.trigger("delivery.ready", { taskID: task.id, runID: run.id, deliveryID: delivery.id }, { actions: [] }).catch(() => undefined)
          // Flush task learnings to memory (fire-and-forget)
          const evaluation = findEvaluationByRun(run.id)
          EngineMemoryBridge.flushTaskLearnings({ task, run, delivery, evaluation, plan: currentPlan })
            .catch(err => log.warn("failed to flush task learnings", { error: String(err) }))

          // Auto-launch the deliverable if the delivery agent recorded a launch command
          const launchCmd = (verdictPayload as any)?.launch_command as string | undefined
          if (launchCmd) {
            try {
              const { Shell } = await import("@/shell/shell")
              const { Filesystem } = await import("@/util/filesystem")
              const projectDir = Filesystem.resolve(Instance.directory)
              const launched = await Shell.launch(launchCmd, { cwd: projectDir })
              const addrNote = launched.address ? ` — running at ${launched.address}` : ` (PID ${launched.pid})`
              log.info("deliverable launched", { pid: launched.pid, address: launched.address, command: launchCmd })
              return `Delivery published and task completed successfully. Deliverable launched${addrNote}.`
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              log.warn("auto-launch failed after publish", { error: msg, command: launchCmd })
              return `Delivery published and task completed successfully. Auto-launch failed: ${msg}. Launch manually with: ${launchCmd}`
            }
          }

          return `Delivery published and task completed successfully. You can call refine to analyze the project and suggest improvements for the next iteration.`
        }

        await updateTask(task, { status: "failed", blocking_reason: null, error: result.summary, time_completed: completed }, result.summary)
        return `Publish returned non-delivered status: ${result.summary}`
      },
    }),

    refine: tool({
      description: [
        "Explore the completed project, analyze what was built, and suggest improvements for the next iteration.",
        "Use after task completion (or user re-trigger) to start a new development cycle.",
        "Reads all goal deliveries, explores the codebase, and produces structured suggestions.",
        "After receiving suggestions, surface them in your reply for the user.",
      ].join("\n"),
      inputSchema: z.object({
        focus: z.enum(["features", "quality", "tests", "performance", "all"]).default("all")
          .describe("What aspect to focus the analysis on"),
        reason: z.string().optional().describe("Why you decided to refine"),
      }),
      execute: async ({ focus }) => {
        await trackStepStart("refine")
        const task = requireTask(taskID)

        // Gather delivery context
        const goals = listGoals(taskID)
        const { listGoalRunsForTask, findDeliveryByGoalRun } = await import("@/engine/store")
        const goalRuns = listGoalRunsForTask(taskID)

        const goalSummaries: string[] = []
        const allChangedFiles: string[] = []
        for (const goal of goals) {
          const gr = goalRuns.find(r => r.goal_id === goal.id)
          const delivery = gr ? findDeliveryByGoalRun(gr.id) : undefined
          const files = (delivery?.result as any)?.diffs?.map((d: any) => d.file) ?? []
          allChangedFiles.push(...files)
          goalSummaries.push(`- [${goalStatusByID(goal.id)}] ${goal.title}: ${renderSpecsAsText((goal.acceptance_specs ?? []) as AcceptanceSpec[]).slice(0, 300)}`)
          if (files.length > 0) goalSummaries.push(`  files: ${files.join(", ")}`)
        }

        // Read Decision Log for architectural context. Refine runs once per
        // task (not per turn), but an unbounded decision log can still push
        // this prompt past the model context; cap matches read_context.
        const { createDecisionLog } = await import("@/decision-log")
        const decisionLog = createDecisionLog(taskID)
        const decisionSection = decisionLog.toPromptSection({ limit: 30 }) ?? ""

        // Run refine analysis via LLM
        const { ProviderLLM } = await import("@/provider/llm")
        const model = await resolveAgentModel("orchestrator", { taskID })

        const refineSession = await Session.createNext({
          kind: "assistant",
          parentID: input.agentSessionID,
          title: `Refine: ${task.title}`,
          directory: Instance.directory,
        })
        const hooks = sessionStreamHooks({ sessionID: refineSession.id, taskID, stage: "assistant" })

        const systemPrompt = [
          "You are a project analyst reviewing a completed software project.",
          "Analyze the delivered code and suggest concrete improvements for the next iteration.",
          "",
          "Output a JSON object with this structure:",
          "{",
          '  "summary": "one paragraph assessment of current project state",',
          '  "suggestions": [',
          "    {",
          '      "category": "feature|quality|test|performance|refactor",',
          '      "title": "short title",',
          '      "description": "what to do and why",',
          '      "priority": "high|medium|low",',
          '      "effort": "small|medium|large"',
          "    }",
          "  ]",
          "}",
          "",
          `Focus: ${focus}`,
          "Respond in the same language as the original task request.",
          "Return ONLY the JSON object, no markdown fences.",
        ].join("\n")

        const userPrompt = [
          `## Original Task`,
          task.request.slice(0, 2000),
          "",
          `## Completed Goals (${goals.length})`,
          ...goalSummaries,
          "",
          `## Changed Files (${allChangedFiles.length})`,
          allChangedFiles.join(", "),
          "",
          decisionSection,
        ].join("\n")

        const stream = await ProviderLLM.stream({
          model,
          system: systemPrompt,
          messages: [{ role: "user" as const, content: userPrompt }],
          cacheKey: `task-${taskID}-refine`,
          ...(hooks.onChunk ? { onChunk: hooks.onChunk as any } : {}),
          ...(hooks.onError ? { onError: hooks.onError } : {}),
        })

        const resultText = await stream.text
        await hooks.flush()

        await trackStepComplete("refine")

        // Parse the structured suggestions. Refine's contract with the LLM
        // is a JSON object {summary, suggestions[]}; anything else is an
        // upstream model failure. Returning the raw prose here was a silent
        // fallback that piped unbounded text into the orchestrator session —
        // forbidden per project rules. Throwing surfaces the failure so the
        // orchestrator can retry or fail_task based on its own policy.
        let parsed: { summary?: unknown; suggestions?: unknown }
        try {
          parsed = JSON.parse(resultText.trim())
        } catch (parseErr) {
          const preview = resultText.slice(0, 200)
          throw new Error(
            `refine: LLM did not return valid JSON for {summary, suggestions}. ` +
            `Parse error: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}. ` +
            `Output preview: ${preview}${resultText.length > 200 ? "…" : ""}`,
          )
        }
        if (!Array.isArray(parsed.suggestions)) {
          throw new Error(
            `refine: LLM output missing or invalid "suggestions" array (got ${typeof parsed.suggestions}).`,
          )
        }
        const suggestions = parsed.suggestions as Array<{
          priority?: string; title?: string; category?: string; effort?: string; description?: string
        }>
        const summaryRaw = typeof parsed.summary === "string" ? parsed.summary : ""
        const suggestionLines = suggestions.map((s) =>
          `[${s.priority ?? "?"}] ${s.title ?? "(untitled)"} (${s.category ?? "?"}, ${s.effort ?? "?"}): ${s.description ?? ""}`,
        )
        return SubAgentProtocol.yieldResult({
          headline:
            "Project Analysis complete. To start the next iteration: surface these suggestions to the user " +
            "and let them pick which to roll into a new task.",
          summary: summaryRaw,
          fields: [["suggestions", suggestionLines]],
          pointer: "refine session id (full LLM output) — narrow focus param and re-run to see filtered subsets",
        })
      },
    }),

    question: tool({
      description:
        "Ask the user one or more clarification questions and block until they answer. " +
        "The questions appear in the task's InteractionPanel (with option buttons + free-text input). " +
        "Use SPARINGLY — only when you genuinely cannot proceed without a human decision. " +
        "Valid triggers: (1) incoming request is too vague for requirements decomposition, " +
        "(2) mid-execute missing critical info (tech stack, data source, conflicting goals), " +
        "(3) pre-deliver you have multiple viable approaches and need the user to pick, " +
        "(4) post-refine suggestions — let the user select which improvements to roll in. " +
        "Each question may provide options for click-selection; omit options for free-text. " +
        "Set multiple=true to allow multi-select. Returns the answers in the same order as questions. " +
        "Timeout: 30 minutes; rejected questions throw an error you must handle.",
      inputSchema: z.object({
        questions: z
          .array(
            z.object({
              question: z.string().describe("The complete question text to show the user."),
              header: z.string().describe("Short label (≤30 chars) used as a chip/title."),
              options: z
                .array(
                  z.object({
                    label: z.string().describe("Display text (1-5 words)."),
                    description: z.string().describe("Explanation of this choice."),
                  }),
                )
                .default([])
                .describe("Click-selectable options. Leave empty for free-text-only answers."),
              multiple: z.boolean().optional().describe("Allow multi-select (default false)."),
              custom: z.boolean().optional().describe("Allow a custom typed answer (default true)."),
            }),
          )
          .min(1)
          .max(4)
          .describe("1-4 questions to ask in a single turn."),
        reason: z
          .string()
          .optional()
          .describe("Why you're asking (short, shown in logs — not to the user)."),
      }),
      execute: async ({ questions, reason }) => {
        log.info("question", { taskID, count: questions.length, reason })
        const { output } = await Question.askAndFormat({
          sessionID: input.agentSessionID,
          questions: questions.map((q) => ({
            question: q.question,
            header: q.header,
            options: q.options ?? [],
            multiple: q.multiple,
            custom: q.custom,
          })),
        })
        return output
      },
    }),

    build: tool({
      description:
        "Direct-path implementer. Runs the build agent (read / write / edit / bash) in-process to apply " +
        "the requested change. USE WHEN: single-file edit, bug fix, small refactor in place, typo/comment " +
        "fix, config tweak, short debug-and-fix, lookup-and-edit. NO requirements, NO goals, NO architect — " +
        "build does the work end-to-end. " +
        "After build returns, you MUST call `deliver` next: build does NOT auto-complete the task; the only " +
        "way to mark a task accepted is through delivery's adversarial verification. Build → deliver loops " +
        "until Arbiter accepts (or hits stalled/abort). On rejection, call build again with " +
        "the rejection feedback in the prompt, then deliver again. " +
        "DO NOT USE FOR: multi-file features, UI replication from designs, anything with explicit acceptance " +
        "criteria, cross-module refactors, new subsystems — those go through requirements → architect → " +
        "per-goal build → deliver (the pipeline workflow).",
      inputSchema: z.object({
        request: z
          .string()
          .describe(
            "The prompt to feed the build agent. On the first call this is usually the user's original request verbatim. On rework calls (after delivery rejection), include the user's request PLUS a concise summary of the rejection_details the build agent must address.",
          ),
        reason: z
          .string()
          .describe(
            "One sentence explaining why this qualifies as a direct build (not pipeline) task. Shown in the Route Decision card.",
          ),
        goalID: z
          .string()
          .optional()
          .describe(
            "Optional goal id this build is scoped to. Set when build is invoked as a per-goal worker inside the pipeline workflow. Omit for task-level direct builds.",
          ),
      }),
      execute: async ({ request, reason, goalID }) => {
        const task = requireTask(taskID)
        log.info("build tool invoked", { taskID, reason, requestLen: request.length, goalID: goalID || "" })

        // Inherit goalID from the parent agent session if one isn't explicitly
        // passed — this nests the build card under the originating goal in the
        // overlay instead of floating at the conversation root.
        const inheritedGoalID = sessionGoalID(input.agentSessionID)
        const attachedGoalID = goalID || inheritedGoalID
        const buildSession = await Session.createNext({
          kind: "build",
          goalID: attachedGoalID,
          parentID: input.agentSessionID,
          title: `Build: ${task.title}`,
          directory: Instance.directory,
          // Build is a worker, not an orchestrator. Deny orchestration tools so
          // the build agent codes directly instead of dispatching to sub-agents
          // via the task tool.
          permission: [
            { permission: "task", pattern: "*", action: "deny" as const },
          ],
        })

        try {
          // CRITICAL: capture the build agent's final message. Without this,
          // the orchestrator sees only a hardcoded "Build agent completed"
          // string and re-invokes build on the same broken state after each
          // delivery rejection — the classic build/deliver death spiral
          // ("助手 delivery 拒绝后试图用 build 解决问题，死循环"). The build
          // agent's own summary lives in the last text part of its session
          // reply; we forward it (capped) so the orchestrator can judge
          // whether build actually addressed the prior rejection before
          // re-dispatching.
          const result = await SessionPrompt.prompt({
            sessionID: buildSession.id,
            agent: "build",
            parts: [{ type: "text", text: request, kind: "user_content" }],
          })
          await Session.touch(buildSession.id).catch(err => log.warn("Session.touch failed (non-fatal metadata update)", { sessionID: buildSession.id, error: String(err) }))

          const resultParts = Array.isArray((result as any)?.parts) ? (result as any).parts : []
          const lastText = [...resultParts].reverse().find((p) => p?.type === "text")?.text ?? ""
          const toolCallCount = resultParts.filter((p: any) => p?.type === "tool" || p?.type === "tool_call").length
          const summary = lastText.length > 0
            ? (lastText.length > 2000 ? lastText.slice(0, 2000) + "…(truncated)" : lastText)
            : "(build agent produced no text summary — check session for raw tool calls)"

          // Build does NOT mark the task complete — deliver must accept.
          // Returning the actual build output (not a hardcoded string) is
          // what lets the orchestrator detect "build looped without fixing
          // the rejected thing" and call fail_task or modify_goal instead
          // of re-dispatching build indefinitely.
          return (
            `Build agent finished (session ${buildSession.id}, ${toolCallCount} tool calls).\n\n` +
            `### Build agent's final summary\n${summary}\n\n` +
            `### Next step\n` +
            `Call \`deliver\` to run the metric executor + Arbiter.\n` +
            `If the Arbiter rejects, COMPARE this summary against the rejection details — ` +
            `did build actually address the cited issues? If yes but deliver still rejects, ` +
            `the goal contract may need modify_goal. If no, call build again with *more specific* ` +
            `instructions citing what was missed (re-invoking build with the same prompt is a ` +
            `deadlock; iteration budget will terminate the task).`
          )
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log.error("build tool failed", { taskID, error: msg })
          // Build itself failed (LLM error, tool guard fault, etc.) — distinct
          // from deliver-rejection. Surface the error and let the orchestrator
          // decide (retry build vs fail_task).
          throw err
        }
      },
    }),
  }

  return { tools, stopSignal: stopAfterDispatch.signal }
}
