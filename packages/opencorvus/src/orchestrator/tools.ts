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
import { DEFAULT_MAX_RUNS, DEFAULT_MAX_FIX_RUNS } from "@/engine/helpers"
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
// already per-check-shaped — flatten all three into task.metadata.criteria_results
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

  // Blocking tools (submit_execution, execute_goal, dispatch_ready_goals) signal
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
        const meta = { ...(task.metadata ?? {}), _workflow: ws }
        await updateTask(task, { metadata: meta }, `Workflow step started: ${step.label}`)
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
      const meta = { ...(task.metadata ?? {}), _workflow: ws }
      await updateTask(task, { metadata: meta }, `Workflow step ${status}: ${step.label}`)
      EngineProtocol.emit(EngineEvent.WorkflowStepUpdated, {
        taskID, stepID: step.id, goalID, status,
        summary: `Step "${step.label}" ${status}`,
      })
    } catch { /* best effort */ }
  }

  /** ensureGoalInWorkflow was the _workflow.goalSteps pre-allocator. The
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
      description: "Explore the codebase, analyze the task, extract requirements, and produce executable goal contracts with cross-goal interface declarations.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to analyze requirements"),
      }),
      execute: async () => {
        let task = requireTask(taskID)
        const existingGoals = listGoals(taskID)
        log.info("requirements guard check", { taskID, existingGoals: existingGoals.length, hasSpec: !!task.active_spec_version_id })
        if (existingGoals.length > 0) return `${existingGoals.length} goals already defined. Skipping. Proceed to architect (for multi-goal) or create_run + submit_execution.`
        if (task.active_spec_version_id) return `Requirements analysis already completed (spec=${task.active_spec_version_id}). Proceed to architect or create_run + submit_execution.`

        // Design-analysis gate: if the task has image attachments, block
        // requirements until design_analysis has produced a spec. This is a
        // deterministic precondition, not an LLM hint — the orchestrator prompt
        // already tells the model to call design_analysis first when vision
        // input exists, but reasoning models skip it under load. Gating here
        // keeps the autonomous loop closed: vision→design→requirements, not
        // "LLM decides". Same idea for a Figma URL in task.metadata.
        {
          const attachments = Array.isArray(task.attachments)
            ? task.attachments as Array<{ mime?: string }>
            : []
          const hasVisualAttachment = attachments.some(
            (a) => typeof a?.mime === "string" && a.mime.startsWith("image/"),
          )
          const taskMeta = (task.metadata as Record<string, unknown> | null) ?? {}
          const hasFigmaUrl = typeof taskMeta.figma_url === "string" && taskMeta.figma_url.trim().length > 0
          const hasDesignSpec = typeof taskMeta.design_spec === "string" && taskMeta.design_spec.trim().length > 0
          if ((hasVisualAttachment || hasFigmaUrl) && !hasDesignSpec) {
            const reason = hasVisualAttachment
              ? `${attachments.filter((a) => typeof a.mime === "string" && a.mime.startsWith("image/")).length} image attachment(s)`
              : `figma URL`
            log.info("requirements blocked — design_analysis required first", { taskID, reason })
            return `Task has ${reason} but design_analysis has not produced a spec yet. Call \`design_analysis\` BEFORE \`requirements\` to extract layout / style / component spec from the visual input. Once design_analysis finishes, call \`requirements\` again.`
          }
        }

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

          // Pick up a design spec produced by a prior `design_analysis` call.
          // The spec is stored on task.metadata rather than concatenated into
          // task.request so it only reaches agents that opt in — here, just
          // Requirements (for decomposition accuracy) and nobody else.
          const reqMeta = (task.metadata as Record<string, unknown> | null) ?? {}
          const designSpec = typeof reqMeta.design_spec === "string" ? reqMeta.design_spec : undefined

          const result = await withStageRetry("goal", () =>
            RequirementsService.run({
              title: task.title,
              request: task.request,
              attachments: Array.isArray(task.attachments) ? task.attachments as any : undefined,
              designSpec,
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


          // Persist spec snapshot, requirements, goals, and metric ruler
          const { insertGoalRows, insertRequirements } = await import("@/engine/persist")
          const { EngineSpecSnapshotTable } = await import("@/engine/engine.sql")
          const { persistArchitectMetrics } = await import("@/metrics/store")
          const now = Date.now()
          const specSnapshotID = Identifier.ascending("spec")

          // Build spec content from requirements output
          const specContent = [
            `# ${task.title}`,
            "",
            result.summary,
            "",
            "## Requirements",
            ...result.requirements.map(r => `- **${r.id}** [${r.type}]: ${r.description}`),
            "",
            "## Decisions",
            ...result.decisions.map(d => `- **${d.key}** = ${d.value} — ${d.reason}`),
            "",
            "## Traceability",
            ...result.traceability.map(t => `- ${t.requirementID} → ${t.goalIDs.join(", ")}`),
          ].join("\n")

          // Pre-generate DB IDs and build LLM-ID → DB-ID mapping so
          // depends_on references resolve to actual DB goal IDs.
          // The Requirements agent assigns internal IDs (e.g. "setup-db")
          // in register_goal tool calls; depends_on references those IDs.
          const llmToDBID = new Map<string, string>()
          const dbGoalIDs = result.goals.map((goal) => {
            const dbID = Identifier.ascending("goal")
            if (goal.id) llmToDBID.set(goal.id, dbID)
            return dbID
          })

          try { Database.transaction((db) => {
            // Spec snapshot — makes SPEC section visible in panel
            db.insert(EngineSpecSnapshotTable).values({
              id: specSnapshotID,
              task_id: taskID,
              version: 1,
              status: "ready",
              summary: result.summary,
              content: specContent,
              scope: result.requirements.map(r => r.description).join("; "),
              time_created: now,
              time_updated: now,
            }).run()

            // Persist requirements for traceability
            if (result.requirements.length > 0) {
              insertRequirements(db, {
                taskID,
                specSnapshotID,
                requirements: result.requirements.map(r => ({
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

            insertGoalRows(db, {
              taskID,
              specSnapshotID,
              goals: result.goals.map((goal, index) => ({
                goalID: dbGoalIDs[index],
                title: goal.title,
                objective: goal.objective,
                acceptance_specs: goal.acceptance_specs,
                owned_paths: goal.owned_paths,
                depends_on: goal.depends_on.flatMap(dep => {
                  const dbID = llmToDBID.get(dep)
                  if (!dbID) log.warn("requirements: depends_on references unknown LLM goal ID — dropping", { goalTitle: goal.title, unknownDep: dep })
                  return dbID ? [dbID] : []
                }),
                exports: goal.exports,
                imports: goal.imports,
                kind: goal.kind,
                requirement_ids: goal.requirement_ids,
                priority: goal.priority,
                source: goal.requirement_ids.length > 0 ? "spec" as const : "system" as const,
              })),
              now,
            })

            // Persist Architect-emitted metric ruler as immutable baselines.
            // Must run inside the same transaction so an abort leaves no
            // half-registered ruler behind. Seeds are stashed on task.metadata
            // for Phase 4's Prosecutor to read on first pass.
            persistArchitectMetrics({
              task_id: taskID,
              goal_id_map: llmToDBID,
              goal_metric_specs: result.goalMetricSpecs,
              global_metric_specs: result.globalMetricSpecs,
            })

            const existingMeta = (task.metadata as Record<string, unknown> | null) ?? {}
            const updatedMeta = {
              ...existingMeta,
              _architect_challenge_seeds: result.challengeSeeds,
            }
            db.update(EngineTaskTable)
              .set({
                active_spec_version_id: specSnapshotID,
                metadata: updatedMeta,
                time_updated: now,
              })
              .where(eq(EngineTaskTable.id, taskID))
              .run()
            Database.effect(() =>
              EngineProtocol.emit(EngineEvent.TaskUpdated, { taskID, status: task.status, summary: "Goals defined" }, { source: "orchestrator.requirements" }),
            )
          }) } catch (dbErr) {
            log.error("requirements: failed to persist goals to DB", { taskID, error: dbErr instanceof Error ? dbErr.message : String(dbErr), stack: dbErr instanceof Error ? dbErr.stack : undefined })
            throw dbErr
          }
          // Initialize workflow tracking for newly created goals (use DB IDs)
          for (const [i, g] of result.goals.entries()) {
            ensureGoalInWorkflow(dbGoalIDs[i], g.title)
          }
          await trackStepComplete("requirements")

          // Phase-level completion event — Panel uses this to refresh the
          // Requirements section without tracking individual workflow steps.
          // `sessionID` + `status` drive the overlay's session-card terminal
          // write (see specs/new-arch/07-panel-reactivity.md §session 终态).
          EngineProtocol.emit(
            EngineEvent.RequirementsCompleted,
            {
              taskID,
              sessionID: requirementsSession.id,
              status: "completed",
              requirementCount: result.requirements.length,
              goalCount: result.goals.length,
              decisionCount: result.decisions.length,
              traceabilityCount: result.traceability.length,
              summary: result.summary,
            },
            { source: "orchestrator.requirements" },
          )

          const nextStep = result.goals.length > 1
            ? "NEXT: call architect to coordinate cross-goal contracts, then create_run + submit_execution."
            : "NEXT: call create_run then submit_execution to start goal execution."
          // Sub-agent → caller boundary: yield a structured short conclusion.
          // Full requirements / decisions live in the spec snapshot + decision
          // log; the caller fetches them via read_context when needed.
          return SubAgentProtocol.yieldResult({
            headline: `SUCCESS: ${result.goals.length} goals created. ${nextStep}`,
            summary: result.summary,
            fields: [
              ["decisions", result.decisions.map((d) => `${d.key}=${d.value}`)],
              ["traceability_links", String(result.traceability.length)],
            ],
            pointer: `read_context scope=decisions, scope=goals (spec ${specSnapshotID})`,
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
        // AttachmentStore, and attached to the task with
        // intent="visual_reference". Three wins:
        //   1. design-analyst (and any later vision agent) reads it as a
        //      normal task attachment — no special-cased fetch path.
        //   2. The deliver-time visual SSIM gate picks it up automatically
        //      (it walks task.attachments looking for visual references).
        //   3. Text materials (design tokens JSON, style-guide markdown, …)
        //      flow through the same listing + read_attachment pipeline as
        //      user uploads.
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
              Instance.directory,
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
              Instance.directory,
              shot.png,
              "image/png",
              `url-${slug}-${Date.now()}.png`,
            )
            await EngineService.appendTaskAttachment(taskID, {
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
        const projectRoot = Instance.directory
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
              Instance.directory,
              bytes,
              mime,
              filename,
            )
            await EngineService.appendTaskAttachment(taskID, {
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

        // Refresh task to pick up any newly-attached references.
        const enrichedTask = requireTask(taskID)
        const enrichedHasAttachments = Array.isArray(enrichedTask.attachments) && enrichedTask.attachments.length > 0

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
            attachments: enrichedHasAttachments ? enrichedTask.attachments as any : undefined,
            // Pass the non-Figma URL list so the agent can call webfetch on
            // each for HTML/CSS analysis. Figma URLs are already rendered
            // as PNGs in task.attachments above, so design-analyst reads
            // them through the normal multimodal channel.
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

          // Store the design spec in task.metadata instead of mutating
          // task.request. Rationale: task.request is the user's original
          // intent and is replayed into every downstream sub-agent's prompt
          // (architect, deliver, refine, per-goal runner). Previously
          // appending the full design spec here meant a rich UI analysis
          // (30-50K chars) permanently inflated every downstream prompt
          // even though only the Requirements agent actually needs it.
          // Now the spec lives in task.metadata.design_spec (capped via
          // DesignAnalystAgent.toPromptSection), and the `requirements`
          // tool forwards it as a dedicated `designSpec` arg — scoped to
          // the one consumer that needs it.
          const designSpec = DesignAnalystAgent.toPromptSection(analysis)
          const freshTask = requireTask(taskID)
          const prevMeta = (freshTask.metadata as Record<string, unknown> | null) ?? {}
          const nextMeta = { ...prevMeta, design_spec: designSpec }
          await updateTask(freshTask, { metadata: nextMeta }, "Design spec stored in task.metadata")

          await trackStepComplete("design_analysis")

          log.info("design_analysis: complete", {
            taskID,
            sections: analysis.layout.length,
            tokens: analysis.tokens.length,
            components: analysis.components.length,
            designSpecChars: designSpec.length,
          })

          // Phase-level completion event — drives the overlay's
          // design-analyst session-card terminal status write.
          EngineProtocol.emit(
            EngineEvent.DesignAnalysisCompleted,
            {
              taskID,
              sessionID: designSession.id,
              status: "completed",
              layoutSections: analysis.layout.length,
              styleTokens: analysis.tokens.length,
              componentCount: analysis.components.length,
              interactionCount: analysis.interactions.length,
              summary: `Design analysis complete: ${analysis.layout.length} layout sections, ${analysis.components.length} components.`,
            },
            { source: "orchestrator.design_analysis" },
          )

          return SubAgentProtocol.yieldResult({
            headline:
              "SUCCESS: Design analysis complete. The design spec is stored in task.metadata.design_spec " +
              "and will be forwarded to the requirements agent. " +
              "NEXT: call requirements — it picks up the design spec automatically.",
            fields: [
              ["layout_sections", String(analysis.layout.length)],
              ["style_tokens", String(analysis.tokens.length)],
              ["components", String(analysis.components.length)],
              ["interactions", String(analysis.interactions.length)],
              ["design_system", analysis.designSystem],
              ["recommended_stack", analysis.techStack],
            ],
            pointer: "task.metadata.design_spec (full capped design spec); design analysis artifact for full object",
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
          return `Design analysis failed: ${msg}. Proceeding without design spec — call requirements directly.`
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
            headline: `Architect coordination complete: ${result.entriesWritten} contracts written to Decision Log.`,
            summary: result.blueprint.summary,
            fields: result.blueprint.contracts.length > 0
              ? [["categories", [...new Set(result.blueprint.contracts.map((c) => c.category))]]]
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
              contractCount: result.blueprint.contracts.length,
              categories: [...new Set(result.blueprint.contracts.map(c => c.category))],
              blueprintSummary: result.blueprint.summary,
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
        const statusReset = contractChanged && (goal.status === "passed" || goal.status === "failed")

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
            feedback: { contract_changes: changed },
          })
          supersededTipID = result.supersededTipID
        }

        const resetSuffix = statusReset ? ` (status reset: ${goal.status} → pending via goal_run chain)` : ""
        const abortSuffix = abortedRuns > 0 ? `, ${abortedRuns} prior goal_run(s) marked aborted` : ""
        const supersedeSuffix = supersededTipID ? `, tip ${supersededTipID} superseded` : ""
        return `Goal ${goalID} modified: ${changed.join(", ") || "(no changes)"}${resetSuffix}${abortSuffix}${supersedeSuffix}`
      },
    }),

    execute_goal: tool({
      description: "Dispatch a pending goal for execution in an isolated git worktree. Creates worktree, submits to executor, returns asynchronously. ONLY valid for goals in pending status — passed goals are terminal (use modify_goal to change the contract), failed goals must go through retry_failed_goals (which enforces the per-goal retry budget and writes audit trail). You will be re-triggered when execution completes. STOP after calling this.",
      inputSchema: z.object({
        goalID: z.string().describe("The goal ID to execute (must be in pending status)"),
        reason: z.string().optional().describe("Why you decided to execute this goal now"),
      }),
      execute: async ({ goalID, reason: _reason }) => {
        const task = requireTask(taskID)
        const dbGoals = listGoals(taskID)
        const goal = dbGoals.find(g => g.id === goalID)
        if (!goal) return `Goal ${goalID} not found.`
        if (!isDispatchableGoal(goal)) {
          return `Goal ${goalID} is verification-only and does not dispatch to an executor. Re-run delivery to evaluate it on the merged worktree, or modify_goal to convert it into a dispatchable build goal.`
        }
        if (goal.status === "running") return `Goal ${goalID} is already running.`
        if (goal.status === "passed") {
          return `Goal ${goalID} is already passed (terminal success state). ` +
                 `To change its contract (acceptance_specs, owned_paths), use modify_goal(${goalID}, ...) which will reset to pending automatically. ` +
                 `execute_goal does not re-run passed goals.`
        }
        if (goal.status === "failed") {
          return `Goal ${goalID} is in status=failed. execute_goal is reserved for first-time dispatch of pending goals. ` +
                 `Retry failed goals via retry_failed_goals — that path enforces the per-goal retry budget, writes a retry_analysis_ decision-log entry, ` +
                 `and is the single canonical retry path. ` +
                 `If the contract itself needs changing before another attempt, use modify_goal first (it resets the goal to pending via supersede), then call execute_goal.`
        }

        // goal.status === "pending" — dispatch the first attempt. Retries for
        // failed goals are the exclusive responsibility of retry_failed_goals
        // so the retry budget (engine.max_goal_retries) and escalation gate
        // see every attempt.

        ensureGoalInWorkflow(goalID, goal.title)
        await trackStepStart("execute_goal", goalID)

        // Ensure run exists
        let runID = task.active_run_id
        if (!runID) {
          const { createRun } = await import("@/engine/writer")
          const created = createRun({
            taskID,
            planVersionID: task.active_plan_version_id ?? null,
            sessionID: task.session_id ?? null,
            executor: "opencode",
            status: "running",
            phase: "execute",
            linkAsActive: true,
            summary: `execute_goal(${goalID}): ad-hoc run created`,
          })
          runID = created.id
        }

        // Signal task loop to dispatch via GoalPool (goal is now "pending", pool will pick it up)
        stopAfterDispatch.abort("execute_goal")
        return `Goal "${goal.title}" (${goalID}) queued for execution. STOP HERE — task loop will dispatch via GoalPool and re-trigger you when it completes.`
      },
    }),

    query_failed_goals: tool({
      description: "Query all currently failed goals with their latest delivery info. Returns one block per failed goal (acceptance_specs truncated, only latest run). Use BEFORE retry_failed_goals to understand per-goal failure reasons.",
      inputSchema: z.object({}),
      execute: async () => {
        const dbGoals = listGoals(taskID)
        const failed = dbGoals.filter(g => g.status === "failed")
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

    retry_failed_goals: tool({
      description: "Retry ALL currently failed goals in parallel. Each goal is reset to pending. You MUST first call query_failed_goals to understand each failure, then articulate per-goal root cause analysis in this tool's input. Schema enforces you demonstrate understanding before retry — reflexive retry without analysis is impossible. STOP after calling this.",
      inputSchema: z.object({
        reason: z.string().min(20).describe("Overall reason for batch retry (min 20 chars, e.g. 'eval caught integration bugs, retrying with fresh context + failure evidence appended')"),
        per_goal_analysis: z.record(
          z.string(),
          z.object({
            root_cause: z.string().min(30).describe("What went wrong in this specific goal (min 30 chars). Cite specific eval evidence."),
            failure_class: z.string().describe(
              "Short snake_case category of failure. Decision-log groups retries " +
              "by this value — pick a stable label so repeated failures of the " +
              "same kind get detected (2+ same class triggers a 'change strategy' " +
              "gate). Recommended values: " +
              "`code_bug` (executor finished but the code is wrong), " +
              "`test_failure` (build passed but tests failed), " +
              "`missing_dependency` (import/package resolution), " +
              "`wrong_approach` (goal contract needs revision), " +
              "`cross_goal_integration` (conflict with sibling goal's output), " +
              "`flaky_environment` (transient network/disk/api), " +
              "`executor_incomplete` (session ended without producing a " +
              "deliverable — interrupted, stall, never finalized). " +
              "Coin a new snake_case label only when none of the above fit.",
            ),
            expected_fix: z.string().min(20).describe("What should retry do differently (min 20 chars)"),
          }),
        ).describe("Per-goal analysis keyed by goalID. MUST include an entry for each currently-failed goal."),
      }),
      execute: async ({ reason, per_goal_analysis }) => {
        const task = requireTask(taskID)
        if (!task.active_run_id) return "No active run. Nothing to retry."

        const run = requireRun(task.active_run_id)

        const dbGoals = listGoals(taskID)
        const failed = dbGoals.filter(g => g.status === "failed")
        if (failed.length === 0) return "No failed goals to retry."

        // Enforce: per_goal_analysis MUST cover every failed goal
        const analyzedIDs = new Set(Object.keys(per_goal_analysis))
        const missing = failed.filter(g => !analyzedIDs.has(g.id)).map(g => g.id)
        if (missing.length > 0) {
          return `Missing per_goal_analysis for failed goal(s): ${missing.join(", ")}. Call query_failed_goals first, then provide analysis for EVERY failed goal before retry. Retry rejected.`
        }

        // ── Per-goal retry budget + escalation gate ──
        // Two independent knobs, both on total failure count (NOT on LLM-chosen
        // failure_class strings, which prior art showed the LLM re-labels the
        // same root cause across retries and silently bypasses string-match
        // gates):
        //
        //   escalation_threshold (advisory, fires first): when a goal has
        //     failed this many times, retry_failed_goals returns an escalation
        //     message instead of superseding. The orchestrator is forced to
        //     change strategy (modify_goal / add_goal / fail_task) rather than
        //     loop the same contract.
        //
        //   max_goal_retries (hard ceiling): absolute cap. Goals past this
        //     are marked exhausted and cascade-propagate to pending deps.
        //
        // Invariant: escalation_threshold ≤ max_goal_retries. Config merge
        // clamps the threshold, so we can read both here without re-validating.
        const orchCfg = await EngineConfig.get()
        const maxGoalRetries = orchCfg.max_goal_retries
        const escalationThreshold = orchCfg.goal_escalation_threshold

        // retry_count is the number of prior retries (so the very first
        // failure has retry_count = 0). A call to retry_failed_goals is a
        // request to schedule attempt (retry_count + 2) — the +1 for the
        // failure we're reacting to, +1 for the next attempt. Compare against
        // escalationThreshold in terms of attempt count, NOT retry count.
        const forceEscalate: typeof failed = []
        for (const goal of failed) {
          const attemptsSoFar = ((goal as any).retry_count ?? 0) + 1
          if (attemptsSoFar >= escalationThreshold) {
            forceEscalate.push(goal)
          }
        }

        if (forceEscalate.length > 0) {
          const lines = [
            `ESCALATION REQUIRED: ${forceEscalate.length} goal(s) have failed ${escalationThreshold}+ times and cannot be retried with the current contract:`,
          ]
          for (const goal of forceEscalate) {
            const attempts = ((goal as any).retry_count ?? 0) + 1
            lines.push(`  - ${goal.id} "${goal.title}" — ${attempts} failed attempts`)
          }
          lines.push(
            "",
            "Further retry_failed_goals on the same contract will not converge. Choose a different strategy:",
            "  - modify_goal to change acceptance_specs / owned_paths (resets the goal to pending)",
            "  - add_goal to insert a prerequisite goal",
            "  - fail_task if the issue is fundamental and cannot be resolved",
          )
          return lines.join("\n")
        }

        const retryable: typeof failed = []
        const exhausted: typeof failed = []

        for (const goal of failed) {
          const goalRetries = (goal as any).retry_count ?? 0
          if (goalRetries >= maxGoalRetries) {
            exhausted.push(goal)
          } else {
            retryable.push(goal)
          }
        }

        // ── Cascade: mark pending goals whose deps are all permanently failed ──
        const permanentlyFailedIDs = new Set(exhausted.map(g => g.id))
        const cascaded: typeof failed = []
        let changed = true
        while (changed) {
          changed = false
          for (const goal of dbGoals) {
            if (goal.status !== "pending") continue
            if (permanentlyFailedIDs.has(goal.id)) continue
            const deps = goal.depends_on ?? []
            if (deps.length === 0) continue
            const allDepsFailed = deps.every(depID => {
              const dep = dbGoals.find(g => g.id === depID)
              if (!dep) return true // missing dep treated as failed
              return permanentlyFailedIDs.has(depID) || (dep.status === "failed" && ((dep as any).retry_count ?? 0) >= maxGoalRetries)
            })
            if (allDepsFailed) {
              permanentlyFailedIDs.add(goal.id)
              cascaded.push(goal)
              changed = true
            }
          }
        }

        // Retry via Goal.startNewAttempt(reason="manual_retry"). Internally
        // it supersedes the prior terminal tip (set superseded_reason column),
        // syncs goal.status → pending via deriveGoalStatus, and emits
        // GoalAttemptOpened with this handler's per-goal analysis as feedback.
        // GoalPool then picks the goal up on the next task-loop iteration via
        // pool.submit → readyGoalNodes → pool.dispatchGoal — pool is the only
        // authoritative creator of dispatchable goal_runs, so we deliberately
        // do NOT createGoalRun here (a stray `queued` row would leak as a
        // live-tip that readyGoalNodes filters out yet pool never picks up,
        // which historically caused alive-stall hangs).
        const { findLatestTipGoalRun } = await import("@/engine/store")
        const { startNewAttempt } = await import("@/engine/persist")
        const now = Date.now()
        for (const goal of retryable) {
          const analysis = per_goal_analysis[goal.id]
          const detail = analysis
            ? `[${analysis.failure_class}] ${analysis.expected_fix}`
            : "retry_failed_goals"
          const priorTip = findLatestTipGoalRun(goal.id)
          if (!priorTip) {
            // No prior goal_run but the goal is marked failed — data shape the
            // rest of the pipeline does not produce. Surface instead of silent
            // no-op so the bug source is visible.
            throw new Error(
              `retry_failed_goals: goal ${goal.id} is in status=failed but has no prior goal_run; ` +
              `cannot retry without a row to supersede. This is a data inconsistency upstream of retry.`,
            )
          }
          startNewAttempt({
            goalID: goal.id,
            reason: "manual_retry",
            now,
            feedback: { detail, analysis },
          })
          // Increment engine_goal.retry_count so the per-goal budget check at
          // the top of this handler observes the retry. The column existed
          // with a documented "incremented each time retry_failed_goals resets
          // this goal" comment but nothing wrote it, which made goalRetries
          // always 0 and exhausted[] always empty — goals were infinitely
          // retryable on paper, and in the aborted-loop case this compounded
          // into a wedged task that never terminated.
          Database.use((db) =>
            db.update(EngineGoalTable)
              .set({
                retry_count: ((goal as any).retry_count ?? 0) + 1,
                time_updated: now,
              })
              .where(eq(EngineGoalTable.id, goal.id))
              .run(),
          )
        }

        // Cascade: goals blocked by permanently-failed deps never get a
        // goal_run — route through updateGoalCascadeFailed, the only
        // canonical writer for no-goal_run cascades. This keeps
        // engine_goal.status authored by exactly two entry points.
        const { updateGoalCascadeFailed } = await import("@/engine/persist")
        const { cleanupGoalWorkspaceForGoal } = await import("@/engine/writer")
        for (const goal of exhausted) {
          await cleanupGoalWorkspaceForGoal(goal.id)
        }
        for (const goal of cascaded) {
          await cleanupGoalWorkspaceForGoal(goal.id)
          updateGoalCascadeFailed({
            goalID: goal.id,
            reason: "cascade: dependency permanently failed",
            now,
          })
        }
        Database.use((db) => {
          const { EngineRunTable: RT } = require("@/engine/engine.sql")
          // Run-level retry budget — unchanged.
          db.update(RT)
            .set({ retry_count: (run.retry_count ?? 0) + 1, time_updated: now })
            .where(eq(RT.id, run.id))
            .run()
        })

        // Record analysis in decision log for future retry context
        try {
          const { createDecisionLog } = await import("@/decision-log")
          const log = createDecisionLog(taskID)
          for (const [goalID, analysis] of Object.entries(per_goal_analysis)) {
            log.append({
              goalID,
              phase: "retry",
              key: `retry_analysis_${goalID}`,
              value: `[${analysis.failure_class}] ${analysis.expected_fix}`,
              reason: analysis.root_cause,
            })
          }
        } catch { /* best effort */ }

        for (const goal of retryable) {
          ensureGoalInWorkflow(goal.id, goal.title)
          await trackStepStart("retry_failed_goals", goal.id)
        }

        // Build response
        const lines: string[] = []

        if (retryable.length > 0) {
          stopAfterDispatch.abort("retry_failed_goals")
          lines.push(`Retrying ${retryable.length} goal(s):`)
          for (const g of retryable) {
            const a = per_goal_analysis[g.id]
            const retries = ((g as any).retry_count ?? 0) + 1
            lines.push(`  - ${g.title} [${a?.failure_class}] (retry ${retries}/${maxGoalRetries}): ${a?.expected_fix.slice(0, 80)}`)
          }
        }

        if (exhausted.length > 0) {
          lines.push(`\nPermanently failed (${exhausted.length} goal(s) exhausted ${maxGoalRetries} retries):`)
          for (const g of exhausted) {
            lines.push(`  - ${g.title} (${(g as any).retry_count ?? 0}/${maxGoalRetries} retries used)`)
          }
        }

        if (cascaded.length > 0) {
          lines.push(`\nCascade-failed (${cascaded.length} pending goal(s) blocked by permanently failed deps):`)
          for (const g of cascaded) {
            lines.push(`  - ${g.title}`)
          }
        }

        if (retryable.length === 0) {
          lines.push(`\nNo goals left to retry. Consider delivering current state or calling fail_task.`)
          return lines.join("\n")
        }

        lines.push(`\nReason: ${reason}`)
        lines.push("STOP HERE — task loop dispatches via GoalPool and re-triggers you when batch completes.")
        return lines.join("\n")
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
            sections.push(`- [${g.status}] ${g.id}: ${g.title} [${g.priority}]`)
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
              `Use dispatch_ready_goals (to continue with the current run's pending goals) or execute_goal (to kick off a specific goal). ` +
              `If you need rework, first modify_goal to update contracts, then this tool will permit a new run after the active one reaches terminal status.`
            )
          }
        }

        // Budget enforcement: max_runs
        const totalRuns = findRuns(taskID).length
        const maxRuns = (task.budget as EngineBudget | null)?.max_runs ?? DEFAULT_MAX_RUNS
        if (totalRuns >= maxRuns) {
          return `Budget exhausted: ${totalRuns}/${maxRuns} runs used. Cannot create more runs. Consider delivering current state or failing the task.`
        }

        const now = Date.now()
        const executor = (task.metadata?._pipeline as any)?.executor ?? "opencode"
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
      description: "Activate a run and dispatch all dependency-ready goals in parallel. Equivalent to activating the run then calling dispatch_ready_goals. STOP after this call.",
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

        // Signal task loop to dispatch via GoalPool (don't dispatch here)
        stopAfterDispatch.abort("submit_execution")
        return `Run ${runID} activated. STOP HERE — task loop will dispatch goals via GoalPool and re-trigger you when the batch completes.`
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
      description: "Restart the task from a specific stage. Use when the current approach is fundamentally wrong, the user requests a restart, or you need to redo requirements/plan from scratch.",
      inputSchema: z.object({
        stage: z.enum(["requirements", "plan", "executor"]).describe("Which stage to restart from"),
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
          const executor = (task.metadata?._pipeline as any)?.executor ?? "opencode"
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
        const notDone = goals.filter(g => isDispatchableGoal(g) && (g.status === "running" || g.status === "pending"))
        if (notDone.length > 0) {
          return `Cannot deliver: ${notDone.length} goal(s) still in progress (${notDone.map(g => `${g.title}:${g.status}`).join(", ")}). Wait for ALL goals to complete before delivering.`
        }

        const blockingFailed = goals.filter(g => g.priority === "blocking" && g.status === "failed")
        if (blockingFailed.length > 0) {
          const summary = blockingFailed.map(g => `[${g.status}] ${g.title}`).join("; ")
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

        // Persist aggregated delivery
        const { persistDelivery } = await import("@/engine/persist")
        const deliveryID = Identifier.ascending("delivery")
        persistDelivery({
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
          const taskAttachments = Array.isArray(liveTask.attachments) ? liveTask.attachments as any[] : []
          const tagged = taskAttachments.filter((a) =>
            a?.intent === "visual_reference" && typeof a?.url === "string",
          )
          const imageAttachments = tagged.length > 0
            ? tagged
            : taskAttachments.filter((a) =>
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
                Instance.directory,
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
              // Register it on the task so the overlay / downstream
              // code path sees it alongside the reference attachments.
              const nextAttachments = Array.isArray(liveTask.attachments)
                ? [...(liveTask.attachments as any[]), renderedAttachment]
                : [renderedAttachment]
              // Strip any stale prior rendered_output before appending so
              // reworks don't accumulate N rendered PNGs.
              const deduped = nextAttachments.filter(
                (a) => !(a?.intent === "rendered_output" && a.sha !== renderedAttachment!.sha),
              )
              await updateTask(liveTask, { attachments: deduped }, "delivery render produced rendered.png")
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
          // Re-read the task row to pick up attachments that may have been
          // materialized during design_analysis (Figma frames, URL screenshots).
          const taskForDelivery = requireTask(taskID)
          const deliveryAttachments = Array.isArray(taskForDelivery.attachments)
            ? (taskForDelivery.attachments as Array<{ sha: string; url: string; mime: string; size: number; filename?: string; intent?: string; source?: string }>).filter(
                (a) => typeof a?.mime === "string" && a.mime.startsWith("image/") && typeof a?.url === "string",
              )
            : []

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
              task: { id: task.id, title: task.title, request: task.request, sessionID: task.session_id ?? undefined, metadata: task.metadata ?? undefined },
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

          // Sink delivery agent's structured verdict into task.metadata.criteria_results.
          // The verdict carries three distinct typed surfaces — flatten them into the
          // unified criteria stream so the overlay's Quality Gates panel reflects what
          // the agent actually verified, not just a single pass/fail bit.
          await sinkDeliveryVerdictToCriteria(taskID, verdict)

          const passedCount = goals.filter(g => g.status === "passed").length
          const failedCount = goals.filter(g => g.status === "failed").length
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
            const taskMetaRaw = (task.metadata as Record<string, unknown> | null) ?? {}
            const rawSeeds = Array.isArray(taskMetaRaw._architect_challenge_seeds)
              ? (taskMetaRaw._architect_challenge_seeds as Array<Record<string, unknown>>)
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
          const rejectFeedback = {
            iteration,
            arbiter_verdict: decision.verdict,
            arbiter_reason: decision.reason,
            verdict_summary: verdict.summary,
            issues_found: verdict.issues_found,
            rejection_details: verdict.rejection_details ?? [],
            verdict_artifact_id: verdictArtifactId,
          }
          // Attempt attribution: map each rejection_detail.file to a goal
          // via owned_paths prefix match. When every detail resolves to a
          // known goal we reset only those goals — the passed goals outside
          // the affected set keep their success and redispatch is scoped.
          // If attribution is empty (no file info, or no owned_paths match)
          // we fall through to the conservative default of resetting every
          // passed goal, since a delivery rejection means the aggregate is
          // unacceptable and we cannot prove any single goal is still valid.
          // This is NOT a fallback in the rule-1 sense — it is the baseline
          // correctness policy; attribution is an optimization on top.
          const passedGoals = goals.filter((g) => g.status === "passed")
          const affectedGoalIDs = new Set<string>()
          const rejectionFiles: string[] = []
          for (const d of (verdict.rejection_details ?? [])) {
            if (d.file && typeof d.file === "string") rejectionFiles.push(d.file)
          }
          for (const file of rejectionFiles) {
            for (const g of passedGoals) {
              const owned = (g.owned_paths ?? []) as string[]
              if (owned.some((op) => file === op || file.startsWith(op.endsWith("/") ? op : op + "/"))) {
                affectedGoalIDs.add(g.id)
              }
            }
          }
          const attributed = affectedGoalIDs.size > 0 && affectedGoalIDs.size < passedGoals.length
          const toReset = attributed
            ? passedGoals.filter((g) => affectedGoalIDs.has(g.id))
            : passedGoals
          for (const g of toReset) {
            startNewAttempt({
              goalID: g.id,
              reason: "delivery_rework",
              feedback: rejectFeedback,
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
            attribution: attributed ? "precise" : "blanket",
            passed_total: passedGoals.length,
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

          const errFeedback = {
            iteration: iterationErr,
            arbiter_verdict: decisionErr.verdict,
            arbiter_reason: decisionErr.reason,
            verdict_summary: `Delivery verification threw: ${msg}`,
            issues_found: [`Delivery verification error: ${msg}`],
            rejection_details: [{ category: "runtime", error: msg }],
          }
          // Synthetic-failure path: the deliver agent itself threw, so we
          // have no structured rejection_details to attribute to specific
          // goals. Blanket reset of every passed goal is correct here —
          // the aggregate is unverifiable, so we treat it as invalid.
          const { startNewAttempt: startNewAttemptErr } = await import("@/engine/persist")
          const goalsErr = listGoals(taskID)
          const passedOrCompletedErr = goalsErr.filter((g) => g.status === "passed")
          for (const g of passedOrCompletedErr) {
            startNewAttemptErr({
              goalID: g.id,
              reason: "delivery_rework",
              feedback: errFeedback,
            })
          }

          stopAfterDispatch.abort("delivery_rework")
          return `Delivery verification failed: ${msg}. Iteration ${iterationErr}, arbiter=${decisionErr.verdict} triggered.`
        }
      },
    }),

    publish_delivery: tool({
      description: "Publish the accepted delivery to git and mark the task as completed. Only call after delivery verification has passed.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Confirmation that both verifications passed"),
      }),
      execute: async () => {
        const task = requireTask(taskID)
        const run = task.active_run_id ? requireRun(task.active_run_id) : undefined
        if (!run) return "No active run."

        // Gate: no blocking goals in "failed" state
        const goals = listGoals(taskID)
        const blockingFailed = goals.filter(g => g.priority === "blocking" && g.status === "failed")
        if (blockingFailed.length > 0) {
          return `Cannot publish: ${blockingFailed.length} blocking goal(s) failed. Fix them first.`
        }

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

          // Update the evaluation row persistDelivery() created for this delivery.
          // 1:1 delivery↔evaluation invariant: the row always exists here.
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
          goalSummaries.push(`- [${goal.status}] ${goal.title}: ${renderSpecsAsText((goal.acceptance_specs ?? []) as AcceptanceSpec[]).slice(0, 300)}`)
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
          await SessionPrompt.prompt({
            sessionID: buildSession.id,
            agent: "build",
            parts: [{ type: "text", text: request, kind: "user_content" }],
          })
          await Session.touch(buildSession.id).catch(err => log.warn("Session.touch failed (non-fatal metadata update)", { sessionID: buildSession.id, error: String(err) }))
          // Build does NOT mark the task complete — it returns control to the
          // orchestrator so it can call `deliver` for adversarial verification.
          // The direct-workflow contract is `build → deliver` (loop on reject),
          // and only deliver's accepted verdict transitions task to completed.
          // Earlier behavior auto-completed the task here, which made the
          // direct path a fire-and-forget escape hatch — incompatible with the
          // workflow's mandatory verification step.
          return `Build agent completed (session ${buildSession.id}). Now call \`deliver\` to run the metric executor + Arbiter. If the Arbiter returns \`continue\`, call \`build\` again with the rejection feedback, then deliver again — loop until accepted / stalled / aborted.`
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
