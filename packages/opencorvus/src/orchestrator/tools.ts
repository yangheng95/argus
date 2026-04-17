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
import { Database, eq, and } from "@/storage/db"
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
import {
  EngineTaskTable,
} from "@/engine/engine.sql"
import {
  markDeliveryPublishing,
  finalizeDeliveryResult,
} from "@/engine/persist"
import {
  findDeliveryByRun,
  findEvaluationByRun,
  findPlan,
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
import { updateTask } from "@/engine/state"

import { findStepByTool, type WorkflowState, type MiniWorkflow } from "@/engine/workflow"
import { Question } from "@/question"
import { renderSpecsAsText, type AcceptanceSpec } from "@/acceptance/types"

const log = Log.create({ service: "task-tools" })

// ---------------------------------------------------------------------------
// Helpers (from pipeline.ts)
// ---------------------------------------------------------------------------

/**
 * Build a GoalContract from DB rows for use by per-goal tools.
 *
 * `dependencies` is filtered down to the goals that THIS goal directly
 * declares in `depends_on` — passing all sibling goals (the previous
 * shape) bloated every executor/planner prompt with N-1 irrelevant
 * contracts and was the single biggest contributor to per-goal token
 * inflation. Sibling exports beyond direct dependencies belong in the
 * Decision Log, not in every contract.
 */
function buildGoalContract(task: any, goal: any, allGoals: any[]): import("@/pipeline/types").GoalContract {
  const dependsOnIds: string[] = Array.isArray(goal.depends_on) ? goal.depends_on : []
  const dependencyRows = dependsOnIds.length > 0
    ? allGoals.filter((g) => dependsOnIds.includes(g.id))
    : []
  return {
    goal: {
      id: goal.id,
      title: goal.title,
      objective: goal.objective,
      acceptance_specs: (goal.acceptance_specs ?? []) as AcceptanceSpec[],
      owned_paths: goal.owned_paths ?? [],
      depends_on: goal.depends_on ?? [],
      exports: goal.exports ?? [],
      imports: goal.imports ?? [],
      priority: goal.priority ?? "blocking",
      kind: goal.kind ?? "feature",
      requirement_ids: goal.requirement_ids ?? [],
    },
    planNode: null,
    run: { id: task.active_run_id ?? "", task_id: task.id } as any,
    task,
    plan: { id: task.active_plan_version_id ?? "" } as any,
    dependencies: dependencyRows.map(g => ({
      id: g.id, title: g.title, objective: g.objective,
      acceptance_specs: (g.acceptance_specs ?? []) as AcceptanceSpec[],
      owned_paths: g.owned_paths ?? [], depends_on: g.depends_on ?? [],
      exports: g.exports ?? [], imports: g.imports ?? [],
      priority: g.priority ?? "blocking", kind: g.kind ?? "feature",
      requirement_ids: g.requirement_ids ?? [],
    })),
  }
}

function stageTimeout(stage: "requirements" | "goal" | "plan"): number {
  const env = { requirements: "OPENCORVUS_REQUIREMENTS_TIMEOUT_MS", goal: "OPENCORVUS_GOAL_TIMEOUT_MS", plan: "OPENCORVUS_PLAN_TIMEOUT_MS" }
  const defaults = { requirements: 300_000, goal: 180_000, plan: 300_000 }
  return parseInt(process.env[env[stage]] || String(defaults[stage]), 10)
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

    if (step.scope === "task") {
      ws.taskSteps[step.id] = { status: "running", startedAt: now }
    } else if (goalID && ws.goalSteps[goalID]) {
      ws.goalSteps[goalID].steps[step.id] = { status: "running", startedAt: now }
    }
    ws.currentStepID = step.id

    // Persist + emit
    try {
      const task = requireTask(taskID)
      const meta = { ...(task.metadata ?? {}), _workflow: ws }
      await updateTask(task, { metadata: meta }, `Workflow step started: ${step.label}`)
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

    if (step.scope === "task") {
      const existing = ws.taskSteps[step.id]
      ws.taskSteps[step.id] = { ...existing, status, completedAt: now }
    } else if (goalID && ws.goalSteps[goalID]) {
      const existing = ws.goalSteps[goalID].steps[step.id]
      ws.goalSteps[goalID].steps[step.id] = { ...existing, status, completedAt: now }
    }

    // Advance currentStepID to next pending step
    const nextStep = input.workflow.steps.find(s => {
      if (s.scope === "task") return ws.taskSteps[s.id]?.status === "pending"
      return false // goal-scope steps don't drive currentStepID
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

      // Emit per-goal progress when a goal-scope step completes
      if (goalID && step.scope === "goal" && ws.goalSteps[goalID]) {
        const goalSteps = ws.goalSteps[goalID].steps
        const totalSteps = Object.keys(goalSteps).length
        const completedSteps = Object.values(goalSteps).filter(s => s.status === "completed" || s.status === "skipped").length
        const currentStep = Object.entries(goalSteps).find(([, s]) => s.status === "running")?.[0]
        EngineProtocol.emit(EngineEvent.GoalWorkflowProgress, {
          taskID,
          goalID,
          completedSteps,
          totalSteps,
          currentStep,
          summary: `Goal ${goalID}: ${completedSteps}/${totalSteps} steps done`,
        })
      }
    } catch { /* best effort */ }
  }

  /** Ensure a goal has initialized step states in workflow tracking */
  function ensureGoalInWorkflow(goalID: string, goalTitle: string): void {
    if (!input.workflow || !input.workflowState) return
    const ws = input.workflowState
    if (ws.goalSteps[goalID]) return
    const steps: Record<string, { status: "pending" }> = {}
    for (const s of input.workflow.steps) {
      if (s.scope === "goal") steps[s.id] = { status: "pending" }
    }
    ws.goalSteps[goalID] = { goalID, goalTitle, goalStatus: "pending", steps }
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
        try {
          const requirementsSession = await Session.createNext({
            kind: "requirements",
            parentID: input.agentSessionID,
            title: `Requirements: ${task.title}`,
            directory: Instance.directory,
          })
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


          // Persist spec snapshot, requirements, and goals
          const { insertGoalRows, insertRequirements } = await import("@/engine/persist")
          const { EngineSpecSnapshotTable } = await import("@/engine/engine.sql")
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
            db.update(EngineTaskTable)
              .set({ active_spec_version_id: specSnapshotID, time_updated: now })
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
          EngineProtocol.emit(
            EngineEvent.RequirementsCompleted,
            {
              taskID,
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
        url: z.string().optional().describe("URL to fetch and analyze (live page or design reference)"),
        figma_url: z.string().optional().describe(
          "Figma file URL to render via the Figma REST API (figma.com/file/... or figma.com/design/...). " +
          "Requires FIGMA_API_TOKEN in env. The frame PNG is added as an in-line vision attachment.",
        ),
      }),
      execute: async ({ reason, url, figma_url }) => {
        const task = requireTask(taskID)

        // Guard: skip if no visual input available. Figma URL counts as visual.
        const hasAttachments = Array.isArray(task.attachments) && task.attachments.length > 0
        // Auto-detect: a `figma.com` URL passed via `url` is treated as figma_url.
        const meta = (task.metadata as Record<string, unknown> | null) ?? {}
        const metaFigma = typeof meta.figma_url === "string" ? meta.figma_url : undefined
        const figmaUrl = figma_url
          ?? metaFigma
          ?? (url && /(^|\.)figma\.com\//i.test(url) ? url : undefined)
        const liveUrl = url && figmaUrl === url ? undefined : url
        if (!hasAttachments && !liveUrl && !figmaUrl) {
          return "No visual references available (no image attachments, no URL, no Figma URL). Skip design_analysis and proceed to requirements."
        }

        await trackStepStart("design_analysis")

        log.info("design_analysis: starting", { taskID, hasAttachments, hasUrl: !!url, hasFigma: !!figmaUrl, reason })

        // Reference materialization: any external visual source (Figma frame
        // / URL screenshot) gets pulled, written to AttachmentStore, and
        // attached to the task with intent="visual_reference". Two wins:
        //   1. design-analyst (and any later vision agent) reads it as a
        //      normal task attachment — no special-cased fetch path.
        //   2. The deliver-time visual SSIM gate picks it up automatically
        //      (it walks task.attachments looking for visual references).
        // Same pattern can be extended to other reference kinds (api
        // contract, test fixture, …) by writing with a different intent.
        if (figmaUrl) {
          try {
            const { fetchFigmaFrame } = await import("@/design-analyst/figma-fetch")
            const { AttachmentStore } = await import("@/storage/attachment-store")
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
          } catch (figmaErr) {
            log.warn("design_analysis: figma materialization failed", {
              taskID,
              figmaUrl,
              error: figmaErr instanceof Error ? figmaErr.message : String(figmaErr),
            })
          }
        }

        // Refresh task to pick up any newly-attached references.
        const enrichedTask = requireTask(taskID)
        const enrichedHasAttachments = Array.isArray(enrichedTask.attachments) && enrichedTask.attachments.length > 0

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
            url: liveUrl,
            // figmaUrl is now materialized into task.attachments above —
            // design-analyst reads it from there like any other reference.
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
        EngineProtocol.emit(
          EngineEvent.ArchitectCompleted,
          {
            taskID,
            contractCount: result.blueprint.contracts.length,
            categories: [...new Set(result.blueprint.contracts.map(c => c.category))],
            blueprintSummary: result.blueprint.summary,
            summary,
          },
          { source: "orchestrator.architect" },
        )

        return summary
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

        // Contract change → reset status to "pending" so the goal is re-executed.
        // This matches the help text contract and is the mechanism by which the
        // orchestrator drives rework after delivery rejection: modifying a passed
        // goal's contract makes it eligible for re-execution via submit_execution.
        const contractFields = ["title", "objective", "acceptance_specs", "owned_paths", "depends_on", "exports", "imports", "priority", "kind"]
        const contractChanged = contractFields.some(f => f in setValues)
        let statusReset = false
        if (contractChanged && (goal.status === "passed" || goal.status === "failed")) {
          setValues.status = "pending"
          statusReset = true
        }

        const { EngineGoalTable } = await import("@/engine/engine.sql")
        Database.use((db) =>
          db.update(EngineGoalTable)
            .set(setValues as any)
            .where(eq(EngineGoalTable.id, goalID))
            .run(),
        )
        const changed = Object.keys(setValues).filter(k => k !== "time_updated")
        const suffix = statusReset ? ` (status reset: ${goal.status} → pending)` : ""
        return `Goal ${goalID} modified: ${changed.join(", ") || "(no changes)"}${suffix}`
      },
    }),

    execute_goal: tool({
      description: "Execute a pending or failed goal in an isolated git worktree. Creates worktree, submits to executor, returns asynchronously. Only valid for goals in pending or failed status — passed goals are terminal (use modify_goal to change the contract and reset to pending). You will be re-triggered when execution completes. STOP after calling this.",
      inputSchema: z.object({
        goalID: z.string().describe("The goal ID to execute (must be pending or failed status)"),
        reason: z.string().optional().describe("Why you decided to execute this goal now"),
      }),
      execute: async ({ goalID }) => {
        const task = requireTask(taskID)
        const dbGoals = listGoals(taskID)
        const goal = dbGoals.find(g => g.id === goalID)
        if (!goal) return `Goal ${goalID} not found.`
        if (goal.status === "running") return `Goal ${goalID} is already running.`
        if (goal.status === "passed") {
          return `Goal ${goalID} is already passed (terminal success state). ` +
                 `To change its contract (acceptance_specs, owned_paths), use modify_goal(${goalID}, ...) which will reset to pending automatically. ` +
                 `execute_goal does not re-run passed goals.`
        }

        // goal.status === "pending" | "failed" — reset failed to pending so infrastructure picks it up
        if (goal.status === "failed") {
          Database.use((db) => {
            const { EngineGoalTable: GT } = require("@/engine/engine.sql")
            db.update(GT)
              .set({ status: "pending", time_updated: Date.now() })
              .where(eq(GT.id, goalID))
              .run()
          })
        }

        ensureGoalInWorkflow(goalID, goal.title)
        await trackStepStart("execute_goal", goalID)

        // Ensure run exists
        let runID = task.active_run_id
        if (!runID) {
          const { EngineRunTable } = await import("@/engine/engine.sql")
          runID = Identifier.ascending("run")
          const now = Date.now()
          Database.use((db) => {
            db.insert(EngineRunTable).values({
              id: runID!,
              task_id: taskID,
              plan_version_id: task.active_plan_version_id ?? null,
              session_id: task.session_id ?? null,
              executor: "opencode",
              status: "running",
              phase: "execute",
              retry_count: 0,
              metadata: {},
              time_created: now,
              time_updated: now,
            }).run()
            db.update(EngineTaskTable)
              .set({ active_run_id: runID, time_updated: now })
              .where(eq(EngineTaskTable.id, taskID))
              .run()
          })
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
        const { listGoalRunsByTask, findDeliveryByGoalRun } = await import("@/engine/store")
        const goalRuns = listGoalRunsByTask(taskID)
        const sections: string[] = [`## Failed Goals (${failed.length})`]
        const ACCEPTANCE_SPEC_CAP = 300
        const DELIVERY_FILES_CAP = 10
        for (const goal of failed) {
          sections.push(`\n### ${goal.id}: ${goal.title}`)
          sections.push(`- acceptance_specs:\n${renderSpecsAsText((goal.acceptance_specs ?? []) as AcceptanceSpec[]).slice(0, ACCEPTANCE_SPEC_CAP)}`)
          if (goal.owned_paths?.length) sections.push(`- owned_paths: ${goal.owned_paths.join(", ")}`)
          // listGoalRunsByTask is desc by time_created; first match is latest.
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

        // ── Per-goal retry budget ──
        // Each goal has its own retry_count. Goals that exceeded max_goal_retries
        // are permanently failed and excluded from retry.
        const orchCfg = await EngineConfig.get()
        const maxGoalRetries = orchCfg.max_goal_retries

        // ── Repeated root cause detection ──
        // If the same failure_class for a goal has been recorded 2+ times in
        // Decision Log, a 3rd retry with the same class will not help. Force
        // the Orchestrator to change strategy instead of looping.
        {
          const { createDecisionLog } = await import("@/decision-log")
          const decisionLog = createDecisionLog(taskID)
          const retryEntries = decisionLog.readByPhase("retry")
          const repeatedGoals: string[] = []

          for (const [goalID, analysis] of Object.entries(per_goal_analysis)) {
            const priorSameClass = retryEntries.filter(e =>
              e.goalID === goalID &&
              typeof e.value === "string" &&
              e.value.startsWith(`[${analysis.failure_class}]`)
            )
            if (priorSameClass.length >= 2) {
              repeatedGoals.push(`"${goalID}" — failure_class="${analysis.failure_class}" repeated ${priorSameClass.length + 1} times`)
            }
          }

          if (repeatedGoals.length > 0) {
            return [
              `ESCALATION REQUIRED: ${repeatedGoals.length} goal(s) have the same failure class repeating 3+ times:`,
              ...repeatedGoals.map(s => `  - ${s}`),
              "",
              "Retry with the same approach will not fix these. Choose a different strategy:",
              "  - modify_goal to change acceptance_specs or owned_paths",
              "  - add_goal to create a prerequisite",
              "  - fail_task if the issue is fundamental",
              "  - retry_failed_goals with a DIFFERENT failure_class + expected_fix (prove you changed approach)",
            ].join("\n")
          }
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

        // Apply DB changes
        Database.use((db) => {
          const { EngineGoalTable: GT, EngineRunTable: RT } = require("@/engine/engine.sql")
          const now = Date.now()

          // Reset retryable goals to pending + increment their per-goal retry_count
          for (const goal of retryable) {
            const goalRetries = (goal as any).retry_count ?? 0
            db.update(GT)
              .set({ status: "pending", retry_count: goalRetries + 1, time_updated: now })
              .where(eq(GT.id, goal.id))
              .run()
          }

          // Mark cascaded pending goals as failed (blocked by permanently failed deps)
          for (const goal of cascaded) {
            db.update(GT)
              .set({ status: "failed", time_updated: now })
              .where(eq(GT.id, goal.id))
              .run()
          }

          // Increment run-level retry_count for global budget tracking
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

    dispatch_ready_goals: tool({
      description: "Compute dependency DAG and dispatch ALL ready goals (no unmet dependencies) in parallel. Each goal gets its own worktree. You will be re-triggered when the batch completes. STOP after calling this.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to dispatch goals now"),
      }),
      execute: async () => {
        const task = requireTask(taskID)
        if (!task.active_run_id) return "No active run. Use create_plan or execute_goal first."
        const run = requireRun(task.active_run_id)
        const plan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
        if (!plan) return "No plan found. Use create_plan first."

        // Check how many goals are ready (without dispatching — task loop handles dispatch via GoalPool)
        const { readyGoalNodes } = await import("@/goal/readiness")
        const { listPlanNodesByPlan, listGoalsByPlan, listGoalRunsByCoordinator } = await import("@/engine/store")
        const nodes = listPlanNodesByPlan(plan.id)
        const goals = listGoalsByPlan(plan.id)
        const goalRuns = listGoalRunsByCoordinator(run.id)
        const ready = readyGoalNodes(nodes, goals, goalRuns)

        if (ready.length === 0) {
          const allGoals = listGoals(taskID)
          const pending = allGoals.filter(g => g.status === "pending").length
          const running = allGoals.filter(g => g.status === "running").length
          return `No goals ready to dispatch. Pending: ${pending}, Running: ${running}. Check dependencies with read_context.`
        }

        // Signal task loop to dispatch via GoalPool (don't dispatch here — let the pool handle it)
        stopAfterDispatch.abort("dispatch_ready_goals")
        return `${ready.length} goal(s) ready for dispatch. STOP HERE — task loop will dispatch via GoalPool and re-trigger you when the batch completes.`
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
          const { findEvaluationsByTask, listGoalRunsByTask } = await import("@/engine/store")
          const evals = findEvaluationsByTask(taskID) // desc by time_created
          if (evals.length > 0) {
            // Dedup to latest eval per underlying goal. Multiple evals for
            // the same goal across retries only clutter — the latest verdict
            // is what drives next decisions. goal_run_id → goal_id lookup
            // avoids a SQL join by walking the task's goal_runs once.
            const runToGoal = new Map<string, string>()
            for (const gr of listGoalRunsByTask(taskID)) runToGoal.set(gr.id, gr.goal_id)
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
          const { listGoalRunsByTask, findDeliveryByGoalRun } = await import("@/engine/store")
          const goalRuns = listGoalRunsByTask(taskID) // desc by time_created
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
      description: "Create a run record for goal execution. Returns the runID needed for submit_execution or dispatch_ready_goals. Use after requirements + architect.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to create a run"),
      }),
      execute: async () => {
        const task = requireTask(taskID)
        const dbGoals = listGoals(taskID)
        if (dbGoals.length === 0) return "No goals found. Run requirements first."

        // Budget enforcement: max_runs
        const totalRuns = findRuns(taskID).length
        const maxRuns = (task.budget as EngineBudget | null)?.max_runs ?? DEFAULT_MAX_RUNS
        if (totalRuns >= maxRuns) {
          return `Budget exhausted: ${totalRuns}/${maxRuns} runs used. Cannot create more runs. Consider delivering current state or failing the task.`
        }

        const runID = Identifier.ascending("run")
        const now = Date.now()
        const executor = (task.metadata?._pipeline as any)?.executor ?? "opencode"
        const sessionID = task.session_id!

        // Create a lightweight plan version (goals as plan nodes, no global planner)
        const planID = Identifier.ascending("plan")
        const { EnginePlanVersionTable, EngineRunTable, EnginePlanNodeTable } = await import("@/engine/engine.sql")

        Database.transaction((db) => {
          // Plan version (minimal — goals ARE the plan)
          db.insert(EnginePlanVersionTable).values({
            id: planID, task_id: taskID, spec_snapshot_id: task.active_spec_version_id ?? null,
            version: 1, status: "active",
            summary: `${dbGoals.length} goals`,
            prompt: task.request,
            metadata: {},
            time_created: now, time_updated: now,
          }).run()

          // Pre-generate plan_node IDs and build goal_id → plan_node_id mapping
          // so depends_on_ids references plan_node IDs (not goal IDs).
          const goalToPlanNode = new Map<string, string>()
          const planNodeIDs: string[] = []
          for (const goal of dbGoals) {
            const pnID = Identifier.ascending("plan_node")
            planNodeIDs.push(pnID)
            goalToPlanNode.set(goal.id, pnID)
          }

          // Each goal becomes a plan node (so scheduler can compute DAG)
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

          // Run record
          db.insert(EngineRunTable).values({
            id: runID, task_id: taskID, plan_version_id: planID,
            session_id: sessionID, executor,
            status: "queued", phase: "dispatch", retry_count: 0,
            metadata: {}, time_created: now, time_updated: now,
          }).run()

          // Link goals to this plan so listGoalsByPlan() finds them during dispatch
          const { EngineGoalTable: GT } = require("@/engine/engine.sql")
          for (const goal of dbGoals) {
            db.update(GT)
              .set({ plan_version_id: planID, time_updated: now })
              .where(eq(GT.id, goal.id))
              .run()
          }

          // Update task
          db.update(EngineTaskTable)
            .set({ active_plan_version_id: planID, active_run_id: runID, status: "active", time_updated: now })
            .where(eq(EngineTaskTable.id, taskID))
            .run()
        })

        return `Run created. runID=${runID}, planID=${planID}, ${dbGoals.length} goals as plan nodes. Call dispatch_ready_goals or submit_execution to start execution.`
      },
    }),

    submit_execution: tool({
      description: "Activate a run and dispatch all dependency-ready goals in parallel. Equivalent to activating the run then calling dispatch_ready_goals. STOP after this call.",
      inputSchema: z.object({
        runID: z.string().describe("The run ID from create_plan output"),
      }),
      execute: async ({ runID }) => {
        const task = requireTask(taskID)
        const run = requireRun(runID)

        // Activate the run
        Database.use((db) => {
          const { EngineRunTable } = require("@/engine/engine.sql")
          db.update(EngineRunTable).set({ status: "running", time_started: Date.now(), time_updated: Date.now() }).where(eq(EngineRunTable.id, runID)).run()
          const { EngineTaskTable: TT } = require("@/engine/engine.sql")
          db.update(TT).set({ status: "active", time_updated: Date.now() }).where(eq(TT.id, taskID)).run()
        })

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
        // All restarts go to "active" — the agent decides what to do next
        await updateTask(task, { status: "active", error: null, blocking_reason: null }, `Restart from ${stage}: ${reason}`)
        return `Task restarted from ${stage} stage. Reason: ${reason}. Continue with the appropriate tool (requirements for requirements, create_plan for plan, submit_execution for executor).`
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
        const notDone = goals.filter(g => g.status === "running" || g.status === "pending")
        if (notDone.length > 0) {
          return `Cannot deliver: ${notDone.length} goal(s) still in progress (${notDone.map(g => `${g.title}:${g.status}`).join(", ")}). Wait for ALL goals to complete before delivering.`
        }

        const blockingFailed = goals.filter(g => g.priority === "blocking" && g.status === "failed")
        if (blockingFailed.length > 0) {
          const summary = blockingFailed.map(g => `[${g.status}] ${g.title}`).join("; ")
          return `Cannot deliver: ${blockingFailed.length} blocking goal(s) failed. Fix them first: ${summary}`
        }

        // Aggregate per-goal deliveries
        const { listGoalRunsByCoordinator, findDeliveryByGoalRun } = await import("@/engine/store")
        const goalRuns = listGoalRunsByCoordinator(run.id)
        const allDiffs: Array<{ file: string; diff?: string; [key: string]: unknown }> = []
        const seenFiles = new Set<string>()
        const summaries: string[] = []
        for (const gr of goalRuns) {
          const d = findDeliveryByGoalRun(gr.id)
          if (!d) continue
          if (d.summary) summaries.push(d.summary)
          const result = d.result as { diffs?: Array<{ file: string; diff?: string; [key: string]: unknown }> } | null
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
        }

        // Visual gate: if the task carried any image attachments, run an
        // SSIM check against the rendered output and record the result on
        // task.metadata.criteria_results so the delivery agent's
        // `query_criteria` tool sees it before it forms a verdict. We do
        // this in-process (no benchmark dependency, no shell) and only when
        // there's an actual reference to compare against.
        try {
          // Re-read task to pick up references materialized during
          // design_analysis (e.g. Figma frames).
          const liveTask = requireTask(taskID)
          const taskAttachments = Array.isArray(liveTask.attachments) ? liveTask.attachments as any[] : []
          // Prefer attachments explicitly tagged as visual_reference. Fall
          // back to any image-MIME attachment for older tasks created
          // before the intent field existed.
          const tagged = taskAttachments.filter((a) =>
            a?.intent === "visual_reference" && typeof a?.url === "string",
          )
          const imageAttachments = tagged.length > 0
            ? tagged
            : taskAttachments.filter((a) =>
                typeof a?.mime === "string" && a.mime.startsWith("image/") && typeof a?.url === "string",
              )
          if (imageAttachments.length > 0) {
            const { findRenderedIndex, runVisualDiff, summarizeVisualReport } = await import("@/delivery/checks/visual")
            const { AttachmentStore } = await import("@/storage/attachment-store")
            const renderedHtml = await findRenderedIndex(Instance.directory)
            if (!renderedHtml) {
              await EngineService.upsertTaskCriteria(taskID, [{
                name: "visual_diff",
                family: "runtime",
                status: "skipped",
                evidence: `no index.html found under ${Instance.directory} — visual gate cannot run`,
              }])
            } else {
              // Reference: first image attachment. Resolve its on-disk path
              // through the attachment store rather than fetching the URL
              // (delivery runs in-process so the file is already local).
              const ref = imageAttachments[0]
              const located = AttachmentStore.nameFromUrl(String(ref.url))
              const refPath = located
                ? AttachmentStore.resolveAbsolute(located.projectID, located.name)
                : undefined
              if (!refPath) {
                await EngineService.upsertTaskCriteria(taskID, [{
                  name: "visual_diff",
                  family: "runtime",
                  status: "skipped",
                  evidence: `attachment ${ref.url} could not be resolved to a local path`,
                }])
              } else {
                const visualOut = path.join(Instance.directory, ".opencorvus", "visual-diff")
                const report = await runVisualDiff({
                  rendered: renderedHtml,
                  reference: refPath,
                  outDir: visualOut,
                })
                await EngineService.upsertTaskCriteria(taskID, [{
                  name: "visual_diff",
                  family: "runtime",
                  status: report.passed ? "passed" : "failed",
                  evidence: `${summarizeVisualReport(report)} | rendered=${renderedHtml} reference=${refPath}`,
                }])
              }
            }
          }
        } catch (visualErr) {
          // Recording the failure is more useful than swallowing it — the
          // delivery agent will see "visual_diff failed" via query_criteria
          // and can decide whether that's a hard fail or an environment
          // issue (e.g. headless Chrome unavailable).
          await EngineService.upsertTaskCriteria(taskID, [{
            name: "visual_diff",
            family: "runtime",
            status: "failed",
            evidence: `visual gate threw: ${visualErr instanceof Error ? visualErr.message : String(visualErr)}`,
          }]).catch(() => undefined)
        }

        // ── Deterministic per-goal evaluator (per specs/new-arch/01-agents.md L111
        //    "Evaluator: 确定性命令 runner（无 LLM）, delivery agent 调用").
        // Runs each goal's acceptance_specs against the merged worktree BEFORE
        // delivery agent sees the diff. Results feed delivery agent as
        // checkResults (so it does not duplicate work) and are sunk into
        // task.metadata.criteria_results under family="goal_eval" so the
        // overlay panel reflects what was actually verified deterministically.
        const evaluatorCheckResults: Array<{ name: string; status: "passed" | "failed" | "skipped"; evidence?: string }> = []
        const evaluatorCriteriaSink: Array<{ name: string; status: "passed" | "failed" | "skipped"; family: string; evidence?: string; label?: string }> = []
        // Track strict-mode failures from per-goal evaluator. If any strict
        // check failed, the delivery agent's verdict MUST be rejected — the
        // LLM is not allowed to override deterministic strict gates.
        const strictFailedChecks: Array<{ name: string; evidence?: string }> = []
        {
          const { evaluateGoal } = await import("@/delivery/checks/per-goal")
          const evaluatorTier = (await EngineConfig.get()).evaluator.tier ?? "standard"
          const evalDelivery = {
            summary: deliveryInfo.summary,
            diffs: deliveryInfo.diffs as Array<{ file: string; [key: string]: unknown }>,
          }
          for (const goal of allGoals) {
            if (input.signal?.aborted) break
            try {
              const contract = buildGoalContract(task, goal, allGoals)
              const verdict = await evaluateGoal({
                contract,
                delivery: evalDelivery,
                signal: input.signal,
                tier: evaluatorTier,
              })
              for (const check of verdict.checks) {
                const namespaced = `${goal.id}.${check.name}`
                evaluatorCheckResults.push({
                  name: namespaced,
                  status: check.passed ? "passed" : "failed",
                  evidence: check.output,
                })
                evaluatorCriteriaSink.push({
                  name: namespaced,
                  status: check.passed ? "passed" : "failed",
                  family: "goal_eval",
                  evidence: check.output,
                  label: `${goal.title} · ${check.name}`,
                })
                if (!check.passed && check.mode === "strict") {
                  strictFailedChecks.push({ name: namespaced, evidence: check.output })
                }
              }
              if (verdict.checks.length === 0) {
                // Goal had no scorers AND no project-discovery fallback. Per the
                // evaluator's own contract this is verdict=rejected with no
                // checks — surface as a single failed criterion so the operator
                // sees the goal_wrong cause in the panel rather than just an
                // empty section.
                evaluatorCheckResults.push({
                  name: `${goal.id}.no_scorers`,
                  status: "failed",
                  evidence: verdict.reasoning,
                })
                evaluatorCriteriaSink.push({
                  name: `${goal.id}.no_scorers`,
                  status: "failed",
                  family: "goal_eval",
                  evidence: verdict.reasoning,
                  label: `${goal.title} · no acceptance scorers`,
                })
              }
            } catch (evalErr) {
              const msg = evalErr instanceof Error ? evalErr.message : String(evalErr)
              log.warn("evaluateGoal threw at delivery time", { goalID: goal.id, error: msg })
              const name = `${goal.id}.evaluator_error`
              evaluatorCheckResults.push({ name, status: "failed", evidence: msg })
              evaluatorCriteriaSink.push({
                name,
                status: "failed",
                family: "goal_eval",
                evidence: msg,
                label: `${goal.title} · evaluator threw`,
              })
            }
          }
          if (evaluatorCriteriaSink.length > 0) {
            await EngineService.upsertTaskCriteria(taskID, evaluatorCriteriaSink)
          }
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
          // Re-read the task row to pick up attachments that may have been
          // materialized during design_analysis (Figma frames, URL screenshots).
          const taskForDelivery = requireTask(taskID)
          const deliveryAttachments = Array.isArray(taskForDelivery.attachments)
            ? (taskForDelivery.attachments as Array<{ sha: string; url: string; mime: string; size: number; filename?: string; intent?: string; source?: string }>).filter(
                (a) => typeof a?.mime === "string" && a.mime.startsWith("image/") && typeof a?.url === "string",
              )
            : []
          const verdict = await DeliveryService.verify({
            task: { id: task.id, title: task.title, request: task.request, sessionID: task.session_id ?? undefined, metadata: task.metadata ?? undefined },
            goals: goalInfos,
            delivery: deliveryInfo,
            checkResults: evaluatorCheckResults.length > 0 ? evaluatorCheckResults : undefined,
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

          // Hard gate: if the per-goal evaluator flagged any strict-mode
          // check as failed, the delivery verdict MUST be rejected regardless
          // of what the LLM decided. Strict checks (visual_diff, build, test)
          // are deterministic — the LLM cannot override them.
          // Applied BEFORE persisting the verdict artifact so all downstream
          // consumers (criteria panel, evaluation record) see the true verdict.
          if (verdict.verdict === "accepted" && strictFailedChecks.length > 0) {
            const names = strictFailedChecks.map(c => c.name).join(", ")
            log.warn("deliver: overriding LLM verdict to rejected — strict evaluator checks failed", {
              taskID, strictFailedCount: strictFailedChecks.length, checks: names,
            })
            verdict.verdict = "rejected"
            verdict.issues_found.push(
              ...strictFailedChecks.map(c => `Strict evaluator check failed: ${c.name}${c.evidence ? ` — ${c.evidence.slice(0, 500)}` : ""}`),
            )
            const rejections = strictFailedChecks.map(c => ({
              category: "quality" as const,
              file: undefined,
              error: `Strict evaluator check ${c.name} failed. The delivery agent accepted but this check is non-overridable.${c.evidence ? ` Evidence: ${c.evidence.slice(0, 500)}` : ""}`,
              suggestion: c.name.includes("visual_diff")
                ? "Read .opencorvus/visual-diff/rendered.png and the reference image to identify specific visual differences (layout, colors, spacing, typography). Fix each difference in the source HTML/CSS."
                : undefined,
            }))
            verdict.rejection_details = [...(verdict.rejection_details ?? []), ...rejections]
          }

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
          if (verdict.verdict === "accepted") {
            await trackStepComplete("deliver")
            log.info("deliver: verdict accepted, auto-publishing", { taskID, runID: run.id, deliveryID })
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
                if (verdictPayload?.verdict && !findEvaluationByRun(run.id)) {
                  const { EngineEvaluationTable } = await import("@/engine/engine.sql")
                  Database.use((db) =>
                    db.insert(EngineEvaluationTable).values({
                      id: Identifier.ascending("evaluation"),
                      task_id: taskID,
                      run_id: run.id,
                      delivery_id: delivery.id,
                      status: verdictPayload.verdict === "accepted" ? "passed" : "failed",
                      verdict: verdictPayload.verdict as any,
                      summary: verdictPayload.summary ?? "Delivery agent verification",
                      checks: (verdictPayload.issues_found ?? []).map((issue: string) => ({
                        name: "delivery-agent",
                        status: "failed" as const,
                        evidence: issue,
                      })),
                      time_completed: completed,
                      time_created: completed,
                      time_updated: completed,
                    }).run(),
                  )
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
                await Plugin.trigger("delivery.ready", { taskID, runID: run.id, deliveryID: delivery.id }, { actions: [] }).catch(() => undefined)
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
          // ── Adversarial rework: delivery rejected → reset goals → continue loop ──
          // Instead of failing the task, record rejection feedback and reset
          // goals to pending so the executor can rework them.
          // The task loop detects the _delivery_rework metadata signal and
          // re-triggers the orchestrator with a delivery_rejected trigger.
          const orchCfg = await EngineConfig.get()
          const taskMeta = (task.metadata ?? {}) as Record<string, unknown>
          const reworkHistory = Array.isArray(taskMeta._delivery_rework_history)
            ? [...(taskMeta._delivery_rework_history as Array<Record<string, unknown>>)]
            : []
          const iterationCount = reworkHistory.length + 1
          const maxIterations = orchCfg.max_delivery_iterations

          if (iterationCount > maxIterations) {
            // Exhausted iteration budget — fail the task (original behavior)
            const failMsg = SubAgentProtocol.yieldResult({
              headline: `Delivery rejected after ${maxIterations} rework iterations: ${verdict.summary}`,
              fields: [["issues_found", verdict.issues_found]],
              pointer: `verdict artifact ${verdictArtifactId} (full evidence + logs)`,
            })
            const currentTaskR = requireTask(taskID)
            if (currentTaskR.status === "active") {
              await updateTask(currentTaskR, { status: "failed", error: failMsg, time_completed: Date.now() }, failMsg)
            }
            stopAfterDispatch.abort("deliver_rejected")
            return failMsg
          }

          // Build structured rejection feedback
          const rejectionFeedback: Record<string, unknown> = {
            iteration: iterationCount,
            max_iterations: maxIterations,
            verdict_summary: verdict.summary,
            issues_found: verdict.issues_found,
            rejection_details: verdict.rejection_details ?? [],
            deferred_checks: verdict.deferred_checks ?? [],
            startup_verification: verdict.startup_verification,
            frontend_check: verdict.frontend_check,
            verdict_artifact_id: verdictArtifactId,
            timestamp: Date.now(),
          }
          reworkHistory.push(rejectionFeedback)

          // Write rework signal + history into task metadata.
          // The assistant (orchestrator) will receive the delivery_rejected trigger
          // and RE-PLAN — it decides whether to modify goals, restart from a stage,
          // or add new goals. The deliver tool does NOT unilaterally reset goal
          // state — that's the assistant's responsibility based on rejection details.
          const currentTaskR = requireTask(taskID)
          await updateTask(currentTaskR, {
            metadata: {
              ...taskMeta,
              _delivery_rework: rejectionFeedback,
              _delivery_rework_history: reworkHistory,
            },
          }, `Delivery rejected (iteration ${iterationCount}/${maxIterations}) — assistant will re-plan`)

          // Record in decision log for executor visibility
          try {
            const { createDecisionLog } = await import("@/decision-log")
            const decisionLog = createDecisionLog(taskID)
            decisionLog.append({
              phase: "delivery",
              key: `delivery_rejection_${iterationCount}`,
              value: verdict.summary,
              reason: verdict.issues_found.join("; "),
            })
          } catch { /* best effort */ }

          log.info("deliver: adversarial rework triggered", {
            taskID,
            iteration: iterationCount,
            maxIterations,
            issues: verdict.issues_found.length,
          })

          stopAfterDispatch.abort("delivery_rework")
          return SubAgentProtocol.yieldResult({
            headline: `Delivery rejected — iteration ${iterationCount}/${maxIterations}, assistant must re-plan`,
            fields: [
              ["issues_found", verdict.issues_found],
              ["iteration", `${iterationCount}/${maxIterations}`],
            ],
            pointer: `verdict artifact ${verdictArtifactId}; task.metadata._delivery_rework for feedback`,
          })
        } catch (err) {
          await trackStepComplete("deliver", undefined, true)

          const msg = err instanceof Error ? err.message : String(err)
          log.error("deliver: verification failed", { taskID, error: msg })
          // Delivery verification threw — enter rework path if within budget,
          // otherwise fail the task.
          const orchCfg = await EngineConfig.get()
          const taskMeta = (task.metadata ?? {}) as Record<string, unknown>
          const reworkHistory = Array.isArray(taskMeta._delivery_rework_history)
            ? [...(taskMeta._delivery_rework_history as Array<Record<string, unknown>>)]
            : []
          const iterationCount = reworkHistory.length + 1

          if (iterationCount > orchCfg.max_delivery_iterations) {
            const failMsg = `Delivery verification failed after ${orchCfg.max_delivery_iterations} iterations: ${msg}`
            const currentTaskE = requireTask(taskID)
            if (currentTaskE.status === "active") {
              await updateTask(currentTaskE, { status: "failed", error: failMsg, time_completed: Date.now() }, failMsg)
            }
            stopAfterDispatch.abort("deliver_rejected")
            return failMsg
          }

          // Treat verification error as a rejection with synthetic feedback
          const syntheticFeedback: Record<string, unknown> = {
            iteration: iterationCount,
            max_iterations: orchCfg.max_delivery_iterations,
            verdict_summary: `Delivery verification threw: ${msg}`,
            issues_found: [`Delivery verification error: ${msg}`],
            rejection_details: [{ category: "runtime", error: msg }],
            timestamp: Date.now(),
          }
          reworkHistory.push(syntheticFeedback)

          const currentTaskE = requireTask(taskID)
          await updateTask(currentTaskE, {
            metadata: {
              ...taskMeta,
              _delivery_rework: syntheticFeedback,
              _delivery_rework_history: reworkHistory,
            },
          }, `Delivery verification error (iteration ${iterationCount}) — assistant will re-plan`)

          stopAfterDispatch.abort("delivery_rework")
          return `Delivery verification failed: ${msg}. Rework iteration ${iterationCount}/${orchCfg.max_delivery_iterations} triggered.`
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

          // Create evaluation record from delivery-agent-verdict so board/quality-gate can read it
          const verdictPayload = verdictArtifact.payload as { verdict?: string; summary?: string; issues_found?: string[] } | null
          if (verdictPayload?.verdict && !findEvaluationByRun(run.id)) {
            const { EngineEvaluationTable } = await import("@/engine/engine.sql")
            Database.use((db) =>
              db.insert(EngineEvaluationTable).values({
                id: Identifier.ascending("evaluation"),
                task_id: task.id,
                run_id: run.id,
                delivery_id: delivery.id,
                status: verdictPayload.verdict === "accepted" ? "passed" : "failed",
                verdict: verdictPayload.verdict as any,
                summary: verdictPayload.summary ?? "Delivery agent verification",
                checks: (verdictPayload.issues_found ?? []).map((issue: string) => ({
                  name: "delivery-agent",
                  status: "failed" as const,
                  evidence: issue,
                })),
                time_completed: completed,
                time_created: completed,
                time_updated: completed,
              }).run(),
            )
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
        const { listGoalRunsByTask, findDeliveryByGoalRun } = await import("@/engine/store")
        const goalRuns = listGoalRunsByTask(taskID)

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
        const model = await resolveAgentModel("orchestrator", { taskID }).catch(() => undefined)
        if (!model) return "No LLM model available for refine analysis."

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
        "until deliver accepts (or max_delivery_iterations exhausts). On rejection, call build again with " +
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
            { permission: "plan_enter", pattern: "*", action: "deny" as const },
            { permission: "spec_enter", pattern: "*", action: "deny" as const },
          ],
        })

        try {
          await SessionPrompt.prompt({
            sessionID: buildSession.id,
            agent: "build",
            parts: [{ type: "text", text: request, kind: "user_content" }],
          })
          await Session.touch(buildSession.id).catch(() => undefined)
          // Build does NOT mark the task complete — it returns control to the
          // orchestrator so it can call `deliver` for adversarial verification.
          // The direct-workflow contract is `build → deliver` (loop on reject),
          // and only deliver's accepted verdict transitions task to completed.
          // Earlier behavior auto-completed the task here, which made the
          // direct path a fire-and-forget escape hatch — incompatible with the
          // workflow's mandatory verification step.
          return `Build agent completed (session ${buildSession.id}). Now call \`deliver\` to verify and accept/reject the result. If deliver rejects, call \`build\` again with the rejection feedback, then deliver again — loop until accepted or max_delivery_iterations exhausts.`
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
