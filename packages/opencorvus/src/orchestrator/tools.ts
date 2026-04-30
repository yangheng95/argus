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
import { SessionStatus } from "@/session/status"
import { Database, eq, and, inArray, sql } from "@/storage/db"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { EngineService } from "@/task-api"
import { sessionGoalID } from "./task-event"
import { Publisher } from "@/engine/publisher"
import { EngineGit } from "@/engine/git"
import { EngineMemoryBridge } from "@/engine/memory-bridge"
import { SubAgentProtocol } from "@/agent/sub-agent-protocol"
import { Event as EngineEvent } from "@/engine/model"
import { EngineProtocol } from "@/engine/protocol"
import {
  EngineGoalTable,
  EngineTaskTable,
} from "@/engine/engine.sql"
import {
  markDeliveryPublishing,
  finalizeDeliveryResult,
  updateGoalWorkspace,
  updateGoalRun,
  updateEvaluationFromDeliveryVerdict,
} from "@/engine/persist"
import {
  findActivePlanForTask,
  findActiveRunForTask,
  findActiveSpecForTask,
  findDeliveryByRun,
  findEvaluationByRun,
  findLatestDeliveryVerdictArtifact,
  findPlan,
  listGoals,
  requireRun,
  requireTask,
  type TaskRow,
} from "@/engine/store"
import { effectiveMaxFixRuns } from "@/engine/helpers"
import { goalStatusByID } from "@/engine/describe"
import {
  GoalContractUpdateSchema,
} from "@/pipeline/goal-contract.schema"
import type { EngineBudget } from "@/engine/engine.sql"
import { updateRun, updateTask } from "@/engine/state"
import { deriveTaskStatus, isTaskQueued } from "@/engine/task-status"

import { createWorkflowState, findStepByTool, WorkflowRegistry, type WorkflowState, type MiniWorkflow } from "@/engine/workflow"
import { Question } from "@/question"
import { renderSpecsAsText, type AcceptanceSpec } from "@/acceptance/types"
import { isLiveRunStatus, isRunReadyForGoalDispatch, restartStagePlan } from "./scheduler"
import { OrchestratorEventNote } from "./agent"

const log = Log.create({ service: "task-tools" })

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

  for (const dc of verdict.deferred_checks) {
    checks.push({
      name: dc.name,
      status: dc.result,
      family: "delivery",
      evidence: dc.evidence,
    })
  }

  // rejection_details only exists on RejectedVerdict (discriminated union).
  // Accepted verdicts have nothing to flatten here.
  if (verdict.verdict === "rejected") {
    for (const rd of verdict.rejection_details) {
      const fileSuffix = rd.file ? ` @ ${rd.file}` : ""
      const suggestion = rd.suggestion ? ` → ${rd.suggestion}` : ""
      checks.push({
        name: `${rd.category}${fileSuffix}`,
        status: "failed",
        family: rd.category,
        evidence: `${rd.error}${suggestion}`,
      })
    }
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
  operatorMessage?: {
    text: string
    attachmentSummary?: string
  }
}) {
  const { taskID } = input

  // Some tools intentionally end the current orchestrator turn. Do not abort
  // the provider stream from inside the tool body itself — that races the AI
  // SDK's tool-result persistence and makes a successful tool look interrupted.
  // Instead record a deferred stop reason here and let the caller abort after
  // the current step has finished cleanly.
  const stopAfterDispatch = new AbortController()
  let pendingStopReason: string | undefined

  function requestStopAfterCurrentStep(reason: string) {
    if (!pendingStopReason) pendingStopReason = reason
  }

  function finalizeDeferredStop(): string | undefined {
    if (!pendingStopReason) return undefined
    const reason = pendingStopReason
    pendingStopReason = undefined
    if (!stopAfterDispatch.signal.aborted) {
      stopAfterDispatch.abort(reason)
    }
    return reason
  }

  async function cleanupTerminalGoalWorkspaces(reason: string): Promise<number> {
    const { cleanupGoalWorkspaceForGoal } = await import("@/engine/writer")
    let cleaned = 0
    const errors: string[] = []
    for (const goal of listGoals(taskID)) {
      try {
        if (await cleanupGoalWorkspaceForGoal(goal.id)) cleaned += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        errors.push(`${goal.id}: ${message}`)
      }
    }
    if (errors.length > 0) {
      const message = `${reason}: failed to clean ${errors.length} goal worktree(s): ${errors.join("; ")}`
      log.error("goal workspace terminal cleanup failed", { taskID, reason, errors })
      throw new Error(message)
    }
    return cleaned
  }

  function taskLevelBuildEligibility(task: TaskRow): { allowed: true } | { allowed: false; reason: string } {
    if (task.kind === "build") return { allowed: true }
    const latestDelivery = findLatestDeliveryVerdictArtifact(task.id)
    const latestPayload = (latestDelivery?.payload ?? {}) as Record<string, unknown>
    if (latestPayload.verdict === "rejected") return { allowed: true }
    return {
      allowed: false,
      reason:
        "task-level build without goalID is only valid for explicit kind=build tasks " +
        "or whole-task rework after a rejected delivery verdict. This task is kind=workflow " +
        "and has not reached a rejected delivery cycle; continue through requirements, " +
        "architect, and per-goal build({ goalID }) instead.",
    }
  }

  async function switchExplicitBuildTaskToDirectWorkflow(attachedGoalID?: string): Promise<void> {
    if (attachedGoalID) return
    if (!input.workflowState) return
    if (input.workflow?.id !== "pipeline") return

    const task = requireTask(taskID)
    if (task.kind !== "build") return
    if (findActivePlanForTask(task.id) || findActiveRunForTask(task.id)) return
    if (listGoals(taskID).length > 0) return

    const direct = WorkflowRegistry.resolveSync("direct")
    if (!direct) return

    const nextState = createWorkflowState(direct)
    input.workflow = direct
    input.workflowState = nextState

    // Phase-6-f-3-bis-b: workflow selection is no longer persisted on
    // engine_task. Explicit kind=build tasks resolve to the direct workflow
    // on each wake, so this in-memory switch only keeps the current prompt
    // and overlay event aligned when a custom default started as pipeline.
    void task
    EngineProtocol.emit(EngineEvent.WorkflowSelected, {
      taskID,
      workflowID: direct.id,
      workflowName: direct.name,
      summary: `Workflow "${direct.name}" selected`,
    })
  }

  // ── Workflow step tracking — event-emit only (rule 23) ──
  //
  // History: trackStepStart/Complete used to mutate ws.taskSteps[].status
  // and walk ws.currentStepID forward — a coded FSM. Step status is now
  // projected from artifacts (workflow.ts::projectTaskSteps reads decision
  // log / spec snapshot / goals / runs / deliveries), so the cells were
  // pure duplication. Both functions are now thin event emitters: overlay
  // still gets live `running` / `completed` / `failed` transitions via
  // WorkflowStepUpdated, but no parallel state is maintained server-side.

  async function trackStepStart(toolName: string, goalID?: string): Promise<void> {
    if (!input.workflow) return
    const step = findStepByTool(input.workflow, toolName)
    if (!step) return
    try {
      EngineProtocol.emit(EngineEvent.WorkflowStepUpdated, {
        taskID, stepID: step.id, goalID, status: "running",
        summary: `Step "${step.label}" started`,
      })
    } catch { /* best effort */ }
  }

  async function trackStepComplete(toolName: string, goalID?: string, failed = false): Promise<void> {
    if (!input.workflow) return
    const step = findStepByTool(input.workflow, toolName)
    if (!step) return
    const status = failed ? "failed" as const : "completed" as const
    try {
      EngineProtocol.emit(EngineEvent.WorkflowStepUpdated, {
        taskID, stepID: step.id, goalID, status,
        summary: `Step "${step.label}" ${status}`,
      })
    } catch { /* best effort */ }
  }

  async function createExecutionRunRecord() {
    const task = requireTask(taskID)
    const dbGoals = listGoals(taskID)
    if (dbGoals.length === 0) return { error: "No goals found. Run requirements first." } as const

    const now = Date.now()
    const executor = task.executor
    const sessionID = task.session_id!
    const planID = Identifier.ascending("plan")
    const { EnginePlanVersionTable, EnginePlanNodeTable, EngineGoalTable } =
      await import("@/engine/engine.sql")

    Database.transaction((db) => {
      db.insert(EnginePlanVersionTable).values({
        id: planID,
        task_id: taskID,
        spec_snapshot_id: findActiveSpecForTask(taskID)?.id ?? null,
        version: 1,
        status: "active",
        summary: `${dbGoals.length} goals`,
        prompt: task.request,
        metadata: {},
        time_created: now,
        time_updated: now,
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
          if (!pnID) {
            log.warn("create_run: goal.depends_on references unknown goal ID — dropping", {
              goalID: goal.id,
              goalTitle: goal.title,
              unknownDep: depGoalID,
            })
          }
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
          time_created: now,
          time_updated: now,
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

    await updateTask(
      requireTask(taskID),
      {
        status: "active",
      },
      `create_run: planID=${planID} runID=${runID}`,
    )

    return { runID, planID, goalsCount: dbGoals.length } as const
  }

  async function ensureDispatchableRunForSingleGoal() {
    let task = requireTask(taskID)
    let createdRun = false
    let activatedRun = false

    if (!findActiveRunForTask(task.id)) {
      const created = await createExecutionRunRecord()
      if ("error" in created) return { error: created.error } as const
      createdRun = true
      task = requireTask(taskID)
    }

    let run = findActiveRunForTask(task.id)
    if (!run || !run.plan_version_id || !isLiveRunStatus(run.status)) {
      const created = await createExecutionRunRecord()
      if ("error" in created) return { error: created.error } as const
      createdRun = true
      task = requireTask(taskID)
      run = requireRun(created.runID)
    }

    const planVersionID = run.plan_version_id
    if (!planVersionID) {
      return { error: `Run ${run.id} has no plan_version_id. Create a fresh run before dispatching goals.` } as const
    }

    let plan = findPlan(planVersionID)
    if (!plan) {
      return { error: `No plan found for run ${run.id}. Create a fresh run before dispatching goals.` } as const
    }

    if (run.status === "queued") {
      await updateTask(task, { status: "active", error: null }, "Execution submitted")
      await updateRun(run, { status: "running" }, "Execution submitted")
      activatedRun = true
      task = requireTask(taskID)
      run = requireRun(run.id)
      plan = findPlan(planVersionID) ?? plan
    }

    if (!isRunReadyForGoalDispatch({ status: run.status, planVersionID: run.plan_version_id })) {
      return {
        error: `Run ${run.id} is ${run.status}. Only accepted/running/blocked runs may dispatch goals. Create a fresh run if this one is terminal.`,
      } as const
    }

    return { task, run, plan, createdRun, activatedRun } as const
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
        "OPTIONAL stage agent. Parse the user's task into REQ-N requirements plus " +
        "foundational technical decisions (runtime, framework, test strategy, " +
        "package_manager, communication_protocol). Goal decomposition / metric specs / " +
        "challenge seeds / traceability / cross-goal contracts are all produced by " +
        "the Architect — do NOT expect them from this step.\n\n" +
        "USE WHEN: the work is multi-file with implicit acceptance criteria, OR you " +
        "intend to call `architect` next (architect needs the REQ-N rows), OR " +
        "foundational decisions are ambiguous and the build agent would otherwise " +
        "guess.\n" +
        "SKIP WHEN: trivial direct edit (single-file bug fix, typo / config tweak); " +
        "build agent can run against the user's text alone and `deliver` has enough " +
        "signal in the request to verify.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to analyze requirements"),
      }),
      execute: async () => {
        let task = requireTask(taskID)
        log.info("requirements guard check", { taskID, hasSpec: !!findActiveSpecForTask(task.id) })
        // Rule 23: no status gate. LLM may choose to re-parse requirements
        // (supersedes the prior spec and inserts a new v1 snapshot).

        // No design-analysis gate here: per rule 23, phase ordering is an LLM
        // decision (the orchestrator prompt explains when to call
        // design_analysis). Visual specs live on task.design_specs; when
        // present they are injected into requirements / architect / planner /
        // build prompts from that single source of truth.
        await trackStepStart("requirements")
        task = await updateTask(task, { status: "active" }, "Requirements analysis started")
        // Single session per sub-agent (rule 22). RequirementsAgent.run
        // creates the runner session internally; the orchestrator captures
        // its id via onSessionCreated so SSE completion events attribute
        // to the same session the overlay already shows. The previous
        // wrapper session here was a second card with no content, just to
        // give the catch block an id to emit on — replaced by `runnerSessionID`
        // captured below.
        let runnerSessionID: string | undefined
        try {
          const { RequirementsAgent } = await import("@/requirements")
          const { createDecisionLog } = await import("@/decision-log")
          const decisionLog = createDecisionLog(taskID)

          // Stage-level retry was removed in step 5/7 (rule 8 — single
          // source). Transient LLM-call failures are now retried inside
          // withLLMActivity per the LLMActivityPolicy on the processor's
          // session. A stage-level "rerun the whole agent from scratch"
          // wrapper on top duplicated the responsibility and silently
          // turned activity-level retry budgets into multiplied attempts
          // (a 5-retry policy under a 2-retry stage wrapper meant up to
          // 18 actual provider hits per logical requirements run).
          const result = await RequirementsAgent.run({
            title: task.title,
            request: task.request,
            attachments: Array.isArray(task.attachments) ? task.attachments as any : undefined,
            designSpecs: Array.isArray(task.design_specs) ? task.design_specs as any : undefined,
            taskID,
            parentSessionID: input.agentSessionID,
            signal: input.signal,
            decisionLog,
            onStatus: () => {},
            onSessionCreated: (id) => { runnerSessionID = id },
          })
          if (result.requirements.length === 0) {
            // Same contract the old RequirementsService enforced: an empty
            // REQ-N list means requirements did not converge. Surface it as
            // a hard error so the orchestrator can re-run / fail the task.
            throw new Error("requirements agent produced no REQ-N entries")
          }


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
            // Phase-6-f-5: maintain the "at most one non-superseded spec per
            // task" invariant explicitly. Previously this was tracked via
            // task.active_spec_version_id; now findActiveSpecForTask derives
            // from spec.status != 'superseded', so writers must supersede
            // prior specs before inserting a new one.
            db.update(EngineSpecSnapshotTable)
              .set({ status: "superseded", time_updated: now })
              .where(
                and(
                  eq(EngineSpecSnapshotTable.task_id, taskID),
                  sql`${EngineSpecSnapshotTable.status} != 'superseded'`,
                ),
              )
              .run()
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
                time_updated: now,
              })
              .where(eq(EngineTaskTable.id, taskID))
              .run()
            Database.effect(() =>
              EngineProtocol.emit(
                EngineEvent.TaskUpdated,
                { taskID, status: deriveTaskStatus(task), summary: "Requirements parsed" },
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

          // Card terminal status flows through session.status from
          // session/prompt.ts; counts on the Panel are derived from
          // boardStore. No phase-completed bus event needed.

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
          // Card terminal flows through session.status (the runner session's
          // actor close path emits {type:"terminal", reason:"error"}); the
          // error message itself surfaces via the thrown error in the
          // orchestrator's tool result. No phase-completed bus event needed.
          throw err
        } finally {
          // No caller-level guard: the pre-migration runtime enforces progress/absolute timeouts.
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
        "The design specification is persisted on task.design_specs and injected into",
        "requirements, architect, planner, and build prompts from that single source of truth.",
        "This enables downstream stages to derive more accurate pixel-level requirements and implementation plans.",
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
            "Figma URLs use the REST API path. design-analyst receives those PNGs directly and does not use webfetch.",
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
          throw new Error(
            "Design analysis requires at least one real visual reference: image attachment, URL, Figma URL, or local material path.",
          )
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
        //
        // P0-A: 每张 reference PNG 都必须通过 captureReferenceManifest + gate。
        // 伪造 / 空白 / 阈值不达标的图直接抛 CaptureGateError，向上冒泡让
        // design_analysis 失败——禁止"网页访问不到就退回 visual contract 文本"
        // （spec rule 1）。浏览器/网络异常（非 gate violation）仍 warn+continue
        // 因为那是外部资源问题不是 reference 真实性问题。
        for (const liveUrl of liveUrls) {
          try {
            const { captureReferenceManifest, enforceCaptureGate, summarizeCaptureViolations, CaptureGateError } =
              await import("@/design-analyst/capture-gate")
            const osMod = await import("node:os")
            const outDir = pathMod.join(
              osMod.tmpdir(),
              "opencorvus-capture",
              `${taskID}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            )
            const capture = await captureReferenceManifest({ url: liveUrl, outDir })
            const gate = enforceCaptureGate(capture.manifest)
            if (!gate.ok) {
              // 真实性闸拒收 ⇒ task 级失败；调用方通过 CaptureGateError 区分于普通抓图错误。
              throw new CaptureGateError(
                `reference authenticity gate rejected ${liveUrl}: ${summarizeCaptureViolations(gate.violations)}`,
                "gate",
              )
            }
            const hostname = (() => { try { return new URL(capture.manifest.url).hostname } catch { return "url" } })()
            const slug = hostname.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 60) || "url"
            const ref = await AttachmentStore.write(
              Instance.project.id,
              capture.screenshotPng,
              "image/png",
              `url-${slug}-${Date.now()}.png`,
            )
            await EngineService.appendTaskSystemArtifact(taskID, {
              ...ref,
              intent: "visual_reference",
              source: "url-screenshot",
            })
            log.info("design_analysis: url screenshot materialized (gate passed)", {
              taskID,
              url: liveUrl,
              sha: ref.sha,
              size: ref.size,
              non_white: capture.manifest.non_white_pixel_ratio,
              unique_colors: capture.manifest.unique_color_count,
            })
            materializedCount++
          } catch (shotErr) {
            const { CaptureGateError } = await import("@/design-analyst/capture-gate")
            if (shotErr instanceof CaptureGateError && shotErr.stage === "gate") {
              // 真实性闸拒收：向上抛，让 design_analysis 工具调用整体 fail。
              throw shotErr
            }
            log.warn("design_analysis: url screenshot failed (non-gate)", {
              taskID,
              url: liveUrl,
              stage: shotErr instanceof CaptureGateError ? shotErr.stage : "unknown",
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
          throw new Error(message)
        }

        // Single session per sub-agent (rule 22). DesignAnalystAgent.analyze
        // creates the runner session internally; the orchestrator captures
        // its id via onSessionCreated for downstream emit attribution.
        let runnerSessionID: string | undefined
        try {
          const { DesignAnalystAgent } = await import("@/design-analyst")

          const analysis = await DesignAnalystAgent.analyze({
            title: task.title,
            request: task.request,
            // Single-source visual input: every URL / Figma frame / local
            // material the orchestrator resolved has already been turned
            // into a PNG in `designVisuals`. Prefer those pixels; design-analyst
            // does not use webfetch, though it may capture an additional live
            // webpage screenshot with its dedicated `url_screenshot` tool.
            attachments: enrichedHasAttachments ? designVisuals : undefined,
            taskID,
            parentSessionID: input.agentSessionID,
            signal: input.signal,
            onStatus: () => {},
            onSessionCreated: (id) => { runnerSessionID = id },
          })

          // Persist the visual contract on task.design_specs (dedicated JSON
          // column, not metadata). Delivery reads it directly as a visual
          // review contract. We also write a compact phase summary into the
          // Decision Log so architect / planner / build prompts can see the
          // design-system and recommended-stack conclusions without trying to
          // inline the full spec list.
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

          const { createDecisionLog } = await import("@/decision-log")
          const decisionLog = createDecisionLog(taskID)
          decisionLog.append({
            phase: "design_analysis",
            key: "visual_contract_summary",
            value:
              `Total specs: ${analysis.specs.length}. ` +
              `Color ${countByCategory.color ?? 0}, typography ${countByCategory.typography ?? 0}, ` +
              `spacing ${countByCategory.spacing ?? 0}, layout ${countByCategory.layout ?? 0}, ` +
              `component ${countByCategory.component ?? 0}, interaction ${countByCategory.interaction ?? 0}, ` +
              `responsive ${countByCategory.responsive ?? 0}.`,
            reason: "Design-analyst summary for downstream architect, planner, and build prompts.",
          })
          if (analysis.designSystem.trim()) {
            decisionLog.append({
              phase: "design_analysis",
              key: "design_system",
              value: analysis.designSystem,
              reason: "Design-analyst identified the dominant design system / visual language.",
            })
          }
          if (analysis.techStack.length > 0) {
            decisionLog.append({
              phase: "design_analysis",
              key: "recommended_frontend_stack",
              value: analysis.techStack.join(", "),
              reason: "Design-analyst's FRONTEND-only stack hints (UI framework / CSS / component library / fonts). Backend / runtime / data-layer choices are out-of-lane and remain architect's call.",
            })
          }

          log.info("design_analysis: complete", {
            taskID,
            total: analysis.specs.length,
            byCategory: countByCategory,
          })

          // Card terminal status flows through session.status; counts on
          // the Panel come from boardStore. No phase-completed bus event.

          return SubAgentProtocol.yieldResult({
            headline:
              "SUCCESS: Visual contract persisted on task.design_specs. Subsequent stages will inject " +
              "it from that single source of truth. NEXT: call requirements for functional decomposition.",
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
          await trackStepComplete("design_analysis", undefined, true)
          const msg = err instanceof Error ? err.message : String(err)
          log.error("design_analysis: failed", { taskID, error: msg })
          throw err instanceof Error ? err : new Error(msg)
        }
      },
    }),

    // -----------------------------------------------------------------------
    // Cross-goal coordination — Architect Agent
    // -----------------------------------------------------------------------

    architect: tool({
      description:
        "OPTIONAL stage agent. Decompose the task into goals. The Architect reads the " +
        "REQ-N list + foundational decisions produced by requirements, explores the " +
        "codebase, and registers the final goal set (metric specs, challenge seeds, " +
        "traceability, cross-goal contracts).\n\n" +
        "USE WHEN: the work fans into multiple parallel goals (independent " +
        "owned_paths, cross-goal contracts), OR you need explicit acceptance specs " +
        "per goal so per-goal builds and `deliver` have something concrete to verify " +
        "against. Requires a `requirements` spec snapshot to run against — call " +
        "`requirements` first.\n" +
        "SKIP WHEN: the work fits one goal (the build agent's own todo list is " +
        "enough); every fix lives inside one file or one symbol's call sites.\n" +
        "Re-run on delivery rejection when the rejection points at structural / " +
        "coverage problems; for contract-level point fixes prefer `modify_goal`.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to run architect"),
      }),
      execute: async () => {
        const task = requireTask(taskID)
        // Rule 23: no precondition gate. Architect runs even without a spec
        // snapshot — findRequirements() returns [] and the LLM decides
        // whether it has enough context or needs to bail out.
        const existingGoals = listGoals(taskID)

        await trackStepStart("architect")

        // Single session per sub-agent (rule 22). ArchitectAgent.coordinate
        // creates the runner session internally.
        let runnerSessionID: string | undefined
        try {
          const { createDecisionLog } = await import("@/decision-log")
          const decisionLog = createDecisionLog(taskID)

          // Load Requirements output straight from the DB so the Architect
          // sees the same REQ-N list the overlay does. Decisions come from
          // the decision log phase=requirements section the Requirements
          // agent already seeded.
          const { findRequirements } = await import("@/engine/store")
          const activeSpec = findActiveSpecForTask(task.id)
          const reqRows = activeSpec ? findRequirements(activeSpec.id) : []
          const requirements = reqRows.map((r) => {
            const meta = (r.metadata ?? {}) as Record<string, unknown>
            const sourceID = typeof meta.source_requirement_id === "string" ? meta.source_requirement_id : r.id
            return {
              id: sourceID,
              type: (r.priority === "advisory" ? "implicit" : "explicit") as "explicit" | "implicit",
              description: r.description,
            }
          })
          const requirementDecisions = decisionLog.readByPhase("requirements").map((d) => ({
            key: d.key,
            value: d.value,
            reason: d.reason,
          }))

          const { ArchitectAgent } = await import("@/architect/agent")
          const { upsertGoalsFromArchitect } = await import("@/engine/persist")
          const { EngineSpecSnapshotTable } = await import("@/engine/engine.sql")
          const { persistArchitectMetrics } = await import("@/metrics/store")

          const result = await ArchitectAgent.coordinate({
            goals: existingGoals.map((g) => ({
              id: g.id,
              title: g.title,
              objective: g.objective,
              acceptance_specs: (typeof g.acceptance_specs === "string"
                ? JSON.parse(g.acceptance_specs)
                : g.acceptance_specs ?? []) as AcceptanceSpec[],
              owned_paths: typeof g.owned_paths === "string" ? JSON.parse(g.owned_paths) : g.owned_paths ?? [],
              depends_on: typeof g.depends_on === "string" ? JSON.parse(g.depends_on) : g.depends_on ?? [],
              exports: typeof g.exports === "string" ? JSON.parse(g.exports) : g.exports ?? [],
              imports: typeof g.imports === "string" ? JSON.parse(g.imports) : g.imports ?? [],
              priority: g.priority as "blocking" | "advisory",
              kind: g.kind,
              requirement_ids: typeof g.requirement_ids === "string" ? JSON.parse(g.requirement_ids) : g.requirement_ids ?? [],
              order_index: g.order_index,
              retry_count: g.retry_count,
            })),
            taskRequest: task.request,
            taskTitle: task.title,
            taskID,
            decisionLog,
            requirements,
            requirementDecisions,
            designSpecs: Array.isArray(task.design_specs) ? task.design_specs as any : undefined,
            attachments: Array.isArray(task.attachments) ? task.attachments as any : undefined,
            signal: input.signal,
            parentSessionID: input.agentSessionID,
            onStatus: () => {},
            onSessionCreated: (id) => { runnerSessionID = id },
          })

          // Single-pass persist. Architect's goal set is the authoritative
          // result of this tool call. Integrity (multi-dimension review) is a
          // SEPARATE orchestrator tool (`integrity`) that re-upserts the
          // corrected set against the same spec snapshot. No dual-write, no
          // readiness gate keyed on a second LLM call (rule 22 / 23).
          const newSpecSnapshotID = Identifier.ascending("spec")
          const priorSpecSnapshotID = findActiveSpecForTask(task.id)?.id
          const reqLines = requirements.map((r) => `- **${r.id}** [${r.type}]: ${r.description}`)
          const decisionLines = requirementDecisions.map((d) => `- **${d.key}** = ${d.value} — ${d.reason}`)
          const goalLines = result.goals.map((g) => `- **${g.id}** (${g.kind}, ${g.priority}): ${g.title}`)
          const traceLines = result.traceability.map((t) => `- ${t.requirementID} → ${t.goalIDs.join(", ")}`)
          const contractLines = result.contracts.map((c) => `- **${c.category}** — ${c.title} (goals: ${c.goalIDs.join(", ") || "task-wide"})`)
          const specContent = [
            `# ${task.title}`,
            "",
            result.summary,
            "",
            "## Requirements",
            ...(reqLines.length > 0 ? reqLines : ["_(none — Requirements produced an empty REQ-N list)_"]),
            "",
            "## Decisions",
            ...(decisionLines.length > 0 ? decisionLines : ["_(none)_"]),
            "",
            "## Goals",
            ...(goalLines.length > 0 ? goalLines : ["_(none)_"]),
            "",
            "## Traceability",
            ...(traceLines.length > 0 ? traceLines : ["_(none)_"]),
            "",
            "## Architect Contracts",
            ...(contractLines.length > 0 ? contractLines : ["_(none)_"]),
          ].join("\n")

          let persisted: Array<{ id: string; title: string; llmID: string }> = []
          let llmToDBID = new Map<string, string>()
          let deletedIDs: string[] = []
          try { Database.transaction((db) => {
            const now = Date.now()
            db.insert(EngineSpecSnapshotTable).values({
              id: newSpecSnapshotID,
              task_id: taskID,
              version: 2,
              status: "ready",
              summary: result.summary,
              content: specContent,
              scope: requirements.map((r) => r.description).join("; "),
              time_created: now,
              time_updated: now,
            }).run()

            if (priorSpecSnapshotID) {
              db.update(EngineSpecSnapshotTable)
                .set({ status: "superseded", time_updated: now })
                .where(eq(EngineSpecSnapshotTable.id, priorSpecSnapshotID))
                .run()
            }

            const out = upsertGoalsFromArchitect(db, {
              taskID,
              specSnapshotID: newSpecSnapshotID,
              architectGoals: result.goals.map((g) => ({
                llmID: g.id,
                title: g.title,
                objective: g.objective,
                acceptance_specs: g.acceptance_specs,
                owned_paths: g.owned_paths,
                depends_on: g.depends_on,
                exports: g.exports,
                imports: g.imports,
                kind: g.kind,
                requirement_ids: g.requirement_ids,
                priority: g.priority,
                source: g.requirement_ids.length > 0 ? "spec" as const : "system" as const,
              })),
              removedLLMIDs: result.removedGoalIDs,
              now,
            })
            persisted = out.persisted
            llmToDBID = out.llmToDBID
            deletedIDs = out.deletedIDs

            persistArchitectMetrics({
              task_id: taskID,
              goal_id_map: llmToDBID,
              goal_metric_specs: result.goalMetricSpecs,
              global_metric_specs: result.globalMetricSpecs,
            })

            db.update(EngineTaskTable)
              .set({
                architect_challenge_seeds: result.challengeSeeds as unknown as Record<string, unknown>[],
                time_updated: now,
              })
              .where(eq(EngineTaskTable.id, taskID))
              .run()

            Database.effect(() =>
              EngineProtocol.emit(
                EngineEvent.TaskUpdated,
                { taskID, status: deriveTaskStatus(task), summary: "Goals decomposed by Architect" },
                { source: "orchestrator.architect" },
              ),
            )
          }) } catch (dbErr) {
            log.error("architect: failed to persist goals to DB", {
              taskID,
              error: dbErr instanceof Error ? dbErr.message : String(dbErr),
              stack: dbErr instanceof Error ? dbErr.stack : undefined,
            })
            throw dbErr
          }

          for (const g of persisted) ensureGoalInWorkflow(g.id, g.title)

          await trackStepComplete("architect")

          const summary = SubAgentProtocol.yieldResult({
            headline:
              `Architect decomposition complete: ${persisted.length} goals, ${result.goalMetricSpecs.length} goal metrics, ` +
              `${result.globalMetricSpecs.length} global metrics, ${result.challengeSeeds.length} challenge seeds, ` +
              `${result.contracts.length} contracts.` +
              (deletedIDs.length > 0 ? ` Removed ${deletedIDs.length} prior goal(s).` : "") +
              ` NEXT: call \`integrity\` to verify goal_fidelity / technical_feasibility / hallucination / solution_quality, then proceed to per-goal \`build\`.`,
            summary: result.summary,
            fields: [
              ["goals", persisted.map((g) => `${g.id} ${g.title}`)],
              ["contract_categories", [...new Set(result.contracts.map((c) => c.category))]],
              ["spec_snapshot_id", newSpecSnapshotID],
            ],
            pointer: `read_context scope=decisions (spec ${newSpecSnapshotID})`,
          })

          return summary
        } catch (err) {
          throw err
        }
      },
    }),

    // -----------------------------------------------------------------------
    // Integrity — orchestrator-driven multi-dimension review of architect output.
    //
    // Lifted out of architect/agent.ts (audit 2026-04-25): per the agent
    // boundary rule (agents do not call agents; only the orchestrator
    // routes messages between agents), the integrity reviewer must be a
    // sibling of architect at the orchestrator level, not a nested call
    // inside architect's run(). This tool reads the persisted goal set,
    // invokes the integrity reviewer, and on `needs_correction` re-upserts
    // the corrected goal set against the same active spec snapshot.
    // -----------------------------------------------------------------------

    integrity: tool({
      description:
        "OPTIONAL audit agent. Multi-dimension review of architect output along four " +
        "axes: goal_fidelity (coverage of the original user request), " +
        "technical_feasibility (imports / exports / owned_paths / dep graph viability), " +
        "hallucination (ungrounded REQs / specs / contracts — DIAGNOSTIC: findings " +
        "trigger upstream rework, never goal mutations), solution_quality " +
        "(granularity, acceptance-spec strength, ownership, ordering). Returns a " +
        "per-dimension verdict (pass / concerns / needs_correction) plus an aggregate " +
        "(worst-of). On aggregate `needs_correction` the orchestrator re-upserts the " +
        "corrected goal set against the same spec snapshot.\n\n" +
        "USE WHEN: architect just produced a non-trivial goal graph (≥3 goals, OR " +
        "cross-goal contracts, OR foundational decisions architect derived rather " +
        "than user-stated), OR delivery feedback hints the decomposition has drifted " +
        "from user intent.\n" +
        "SKIP WHEN: architect produced exactly one goal whose contract trivially " +
        "matches the user request, OR you already ran integrity for this spec " +
        "snapshot and have no new signal. Requires architect goals on the active " +
        "spec snapshot.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to run integrity review"),
      }),
      execute: async () => {
        const task = requireTask(taskID)
        const activeSpec = findActiveSpecForTask(task.id)
        if (!activeSpec) {
          return SubAgentProtocol.yieldResult({
            headline: "integrity: no active spec snapshot — call `architect` first.",
            pointer: `task ${taskID}`,
          })
        }
        const dbGoals = listGoals(taskID).filter((g) => g.spec_snapshot_id === activeSpec.id)
        if (dbGoals.length === 0) {
          return SubAgentProtocol.yieldResult({
            headline: "integrity: no goals on the active spec snapshot — call `architect` first.",
            pointer: `spec ${activeSpec.id}`,
          })
        }

        // Single session per sub-agent (rule 22). reviewIntegrity creates the
        // runner session internally and returns its id on `verdict.sessionID`.

        const { findRequirements } = await import("@/engine/store")
        const reqRows = findRequirements(activeSpec.id)
        const requirements = reqRows.map((r) => {
          const meta = (r.metadata ?? {}) as Record<string, unknown>
          const sourceID = typeof meta.source_requirement_id === "string" ? meta.source_requirement_id : r.id
          return {
            id: sourceID,
            type: (r.priority === "advisory" ? "implicit" : "explicit") as "explicit" | "implicit",
            description: r.description,
          }
        })
        const { createDecisionLog } = await import("@/decision-log")
        const decisionLog = createDecisionLog(taskID)
        const requirementDecisions = decisionLog.readByPhase("requirements").map((d) => ({
          key: d.key,
          value: d.value,
          reason: d.reason,
        }))

        const goalsForReview = dbGoals.map((g) => ({
          id: g.id,
          title: g.title,
          objective: g.objective,
          acceptance_specs: (typeof g.acceptance_specs === "string"
            ? JSON.parse(g.acceptance_specs)
            : g.acceptance_specs ?? []) as AcceptanceSpec[],
          owned_paths: typeof g.owned_paths === "string" ? JSON.parse(g.owned_paths) : g.owned_paths ?? [],
          depends_on: typeof g.depends_on === "string" ? JSON.parse(g.depends_on) : g.depends_on ?? [],
          exports: typeof g.exports === "string" ? JSON.parse(g.exports) : g.exports ?? [],
          imports: typeof g.imports === "string" ? JSON.parse(g.imports) : g.imports ?? [],
          priority: g.priority as "blocking" | "advisory",
          kind: g.kind,
          requirement_ids: typeof g.requirement_ids === "string" ? JSON.parse(g.requirement_ids) : g.requirement_ids ?? [],
        }))

        const { reviewIntegrity, applyIntegrityCorrections } = await import("@/integrity")
        const verdict = await reviewIntegrity({
          userRequest: task.request,
          taskTitle: task.title,
          goals: goalsForReview,
          requirements,
          requirementDecisions,
          designSpecs: Array.isArray(task.design_specs) ? task.design_specs as any : undefined,
          decisionLog,
          attachments: Array.isArray(task.attachments) ? task.attachments as any : undefined,
          signal: input.signal,
          taskID,
          parentSessionID: input.agentSessionID,
        })

        const perDimensionLabels = verdict.dimensions.map((d) => `${d.id}=${d.verdict}`).join(", ")
        const { recordIntegrityAttempt } = await import("@/engine/persist")
        const perDimensionRollup = verdict.dimensions.map((d) => ({ id: d.id, verdict: d.verdict }))

        if (verdict.verdict !== "needs_correction") {
          try {
            recordIntegrityAttempt({
              taskID,
              sessionID: verdict.sessionID,
              specSnapshotID: activeSpec.id,
              verdict: verdict.verdict,
              perDimension: perDimensionRollup,
              issuesCount: verdict.issues.length,
              correctionsCount: 0,
              missingCount: 0,
              reason: verdict.summary,
            })
          } catch (err) {
            log.error("integrity: recordIntegrityAttempt failed", {
              taskID,
              error: err instanceof Error ? err.message : String(err),
            })
          }
          const headline =
            verdict.verdict === "pass"
              ? `Integrity verdict: pass — ${perDimensionLabels}. NEXT: dispatch \`build({ goalID })\` per goal.`
              : `Integrity verdict: concerns — ${perDimensionLabels}. ${verdict.summary} ` +
                `Goal set is executable; surface the concerns above to the operator if relevant. ` +
                `NEXT: dispatch \`build({ goalID })\` per goal, OR re-run \`architect\` / upstream agents if a hallucination dimension flagged ungrounded REQs.`
          return SubAgentProtocol.yieldResult({
            headline,
            fields: [
              ["goal_count", String(goalsForReview.length)],
              ["spec_snapshot_id", activeSpec.id],
              ["per_dimension", verdict.dimensions.map((d) => `${d.id}=${d.verdict}(${d.issues.length}issues)`)],
              ["summary", verdict.summary],
            ],
            pointer: `integrity session ${verdict.sessionID}`,
          })
        }

        const corrected = applyIntegrityCorrections(goalsForReview, verdict)
        const beforeIDs = new Set(goalsForReview.map((g) => g.id))
        const afterIDs = new Set(corrected.map((g) => g.id))
        const removedByIntegrity = [...beforeIDs].filter((id) => !afterIDs.has(id))
        const addedByIntegrity = [...afterIDs].filter((id) => !beforeIDs.has(id))

        const { upsertGoalsFromArchitect } = await import("@/engine/persist")
        const { persistArchitectMetrics } = await import("@/metrics/store")

        let persisted: Array<{ id: string; title: string; llmID: string }> = []
        let llmToDBID = new Map<string, string>()
        let deletedIDs: string[] = []
        try { Database.transaction((db) => {
          const out = upsertGoalsFromArchitect(db, {
            taskID,
            specSnapshotID: activeSpec.id,
            architectGoals: corrected.map((g) => ({
              llmID: g.id,
              title: g.title,
              objective: g.objective,
              acceptance_specs: g.acceptance_specs,
              owned_paths: g.owned_paths,
              depends_on: g.depends_on,
              exports: g.exports,
              imports: g.imports,
              kind: g.kind,
              requirement_ids: g.requirement_ids,
              priority: g.priority,
              source: g.requirement_ids.length > 0 ? "spec" as const : "system" as const,
            })),
            removedLLMIDs: removedByIntegrity,
            now: Date.now(),
          })
          persisted = out.persisted
          llmToDBID = out.llmToDBID
          deletedIDs = out.deletedIDs

          // Re-baseline goal metric specs against the corrected goal id map
          // so newly-added integrity goals are picked up by the metric layer
          // and removed goals stop accumulating metric_results. The global
          // specs are unchanged (they are not goal-scoped).
          persistArchitectMetrics({
            task_id: taskID,
            goal_id_map: llmToDBID,
            goal_metric_specs: [],
            global_metric_specs: [],
          })

          Database.effect(() =>
            EngineProtocol.emit(
              EngineEvent.TaskUpdated,
              { taskID, status: deriveTaskStatus(task), summary: `Integrity corrected goal set: -${deletedIDs.length} +${addedByIntegrity.length}` },
              { source: "orchestrator.integrity" },
            ),
          )
        }) } catch (dbErr) {
          log.error("integrity: failed to persist corrections", {
            taskID,
            error: dbErr instanceof Error ? dbErr.message : String(dbErr),
          })
          throw dbErr
        }

        for (const g of persisted) ensureGoalInWorkflow(g.id, g.title)

        try {
          recordIntegrityAttempt({
            taskID,
            sessionID: verdict.sessionID,
            specSnapshotID: activeSpec.id,
            verdict: "needs_correction",
            perDimension: perDimensionRollup,
            issuesCount: verdict.issues.length,
            correctionsCount: verdict.corrections.length,
            missingCount: verdict.missingGoals.length,
            reason: verdict.summary,
          })
        } catch (err) {
          log.error("integrity: recordIntegrityAttempt failed", {
            taskID,
            error: err instanceof Error ? err.message : String(err),
          })
        }

        return SubAgentProtocol.yieldResult({
          headline:
            `Integrity verdict: needs_correction (${perDimensionLabels}). ` +
            `${verdict.summary} ` +
            `Goal set re-upserted against spec ${activeSpec.id}: ` +
            `${verdict.corrections.length} corrections, ${verdict.missingGoals.length} new goals, ${deletedIDs.length} removed. ` +
            `NEXT: dispatch \`build({ goalID })\` on the corrected set.`,
          fields: [
            ["issues", verdict.issues.map((i) => `[${i.type}] ${i.description}`)],
            ["added_goals", addedByIntegrity],
            ["removed_goals", removedByIntegrity],
            ["spec_snapshot_id", activeSpec.id],
            ["per_dimension", verdict.dimensions.map((d) => `${d.id}=${d.verdict}(${d.issues.length}issues)`)],
          ],
          pointer: `integrity session ${verdict.sessionID}`,
        })
      },
    }),

    // -----------------------------------------------------------------------
    // Prosecute — orchestrator-driven adversarial probe.
    //
    // Lifted out of the deliver tool (audit 2026-04-25): the prosecutor
    // (kind: "evaluator") was previously called inside `deliver` between
    // metric execution and snapshot writing. Per the agent boundary rule
    // it must be the orchestrator that decides when to run the adversarial
    // pass and consumes its yield. The orchestrator now drives the order
    // explicitly: deliver → prosecute → publish_delivery / next iteration.
    // -----------------------------------------------------------------------

    prosecute: tool({
      description:
        "Run the adversarial Prosecutor against the most recent delivery " +
        "iteration: file concrete counterexamples for failure modes the " +
        "delivery agent missed, or propose at most one diagnostic challenge " +
        "metric per iteration (capped at 3 per task). Call AFTER every " +
        "`deliver` invocation and BEFORE `publish_delivery` so the iteration " +
        "snapshot reflects the adversarial pass. Side-effects land in DB " +
        "(engine_counterexample, engine_metric_spec) and feed the next " +
        "deliver iteration's trajectory query.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to run the prosecutor now"),
      }),
      execute: async () => {
        const task = requireTask(taskID)
        // Stateless / unconditional — physical preconditions only (a delivery
        // row to prosecute against). The "No active run" message was a
        // state-machine cache gate; same lazy-bootstrap as deliver/publish.
        let run = findActiveRunForTask(taskID)
        if (!run && listGoals(taskID).length > 0) {
          const ensured = await ensureDispatchableRunForSingleGoal()
          if (!("error" in ensured)) run = ensured.run
        }
        const delivery = run ? findDeliveryByRun(run.id) : undefined
        if (!delivery) {
          return SubAgentProtocol.yieldResult({
            headline: "prosecute: no delivery row to prosecute against — call `deliver` first to produce one.",
            pointer: run ? `run ${run.id}` : `task ${taskID}`,
          })
        }
        const { EngineArtifactTable } = await import("@/engine/engine.sql")
        const { desc } = await import("@/storage/db")
        const verdictArtifact = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(
              and(
                eq(EngineArtifactTable.delivery_id, delivery.id),
                eq(EngineArtifactTable.kind, "verdict"),
              ),
            )
            .orderBy(desc(EngineArtifactTable.time_created))
            .limit(1)
            .get(),
        )
        if (!verdictArtifact) {
          return SubAgentProtocol.yieldResult({
            headline: "prosecute: no delivery verdict artifact — call `deliver` first.",
            pointer: `delivery ${delivery.id}`,
          })
        }
        const verdict = verdictArtifact.payload as unknown as import("@/delivery/agent").DeliveryVerdictType

        const { readIterationHistory } = await import("@/metrics/store")
        const priorIterations = readIterationHistory(taskID)
        // The deliver tool advances the iteration counter when it writes the
        // snapshot. Prosecute targets the most recently written snapshot —
        // i.e. the LAST entry in the trajectory.
        const iteration = Math.max(0, priorIterations.length - 1)

        const rawSeeds = Array.isArray(task.architect_challenge_seeds)
          ? (task.architect_challenge_seeds as Array<Record<string, unknown>>)
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

        const { runProsecutor } = await import("@/prosecutor")
        const pRes = await runProsecutor({
          task: {
            id: task.id,
            title: task.title,
            request: task.request,
            sessionID: input.agentSessionID,
          },
          iteration,
          defenderVerdict: verdict,
          architectSeeds,
          signal: input.signal,
        })

        log.info("prosecute: done", {
          taskID,
          iteration,
          filed: pRes.counterexamples_filed,
          proposed: pRes.challenges_proposed,
          resolved: pRes.counterexamples_resolved,
        })

        try {
          const { recordProsecutorAttempt } = await import("@/engine/persist")
          recordProsecutorAttempt({
            taskID,
            deliveryID: delivery.id,
            sessionID: input.agentSessionID,
            iteration,
            counterexamplesFiled: pRes.counterexamples_filed,
            challengesProposed: pRes.challenges_proposed,
            counterexamplesResolved: pRes.counterexamples_resolved,
            rationale: pRes.rationale,
          })
        } catch (err) {
          log.error("prosecute: recordProsecutorAttempt failed", {
            taskID,
            error: err instanceof Error ? err.message : String(err),
          })
        }

        return SubAgentProtocol.yieldResult({
          headline:
            `Prosecutor iter ${iteration}: filed ${pRes.counterexamples_filed} counterexample(s), ` +
            `proposed ${pRes.challenges_proposed} challenge(s), resolved ${pRes.counterexamples_resolved}. ` +
            `NEXT: ${verdict.verdict === "accepted" ? "call `publish_delivery`" : "address feedback then call `build`/`deliver` again"}.`,
          summary: pRes.rationale,
          fields: [
            ["iteration", String(iteration)],
            ["delivery_verdict", verdict.verdict],
          ],
          pointer: `delivery ${delivery.id}`,
        })
      },
    }),

    // -----------------------------------------------------------------------
    // Analyze intent — front-of-pipeline disambiguation.
    //
    // Lifted out of an unused free-floating IntentAnalysisAgent.analyze
    // module (audit 2026-04-25). The agent runs at the very front of the
    // pipeline (before requirements / architect) to reconstruct the user's
    // real intent from a typically-terse request, the surrounding work
    // record (decision log + prior delivery feedback when re-entering a
    // task), and a read-only tour of the repository.
    // -----------------------------------------------------------------------

    analyze_intent: tool({
      description:
        "OPTIONAL stage agent. Reconstruct the user's real intent from a (typically " +
        "terse) request. Reads the request, the existing work record on this task " +
        "(decision log, prior delivery rejections, refine notes when present), and " +
        "uses read-only codebase tools (read/find/search/list) to ground complexity " +
        "and scope estimates in the repo's actual shape. Output: an " +
        "IntentAnalysisResult (intent class, complexity band, extracted slots, " +
        "missing-info keys, blocker / nice clarifications, overall confidence, " +
        "one-sentence summary).\n\n" +
        "USE WHEN: terse request, ambiguous scope, multiple plausible intent classes " +
        "(feature vs refactor vs bug-fix), the user's intent might silently mislead " +
        "downstream stages, OR re-entering after operator_message / refine / " +
        "restart_from_stage that may have shifted scope. If it returns blocker " +
        "clarifications, call `question` with them BEFORE spending budget on " +
        "requirements / architect / build.\n" +
        "SKIP WHEN: the request is already explicit (concrete file path + concrete " +
        "change), OR a previous analyze_intent on this task is still valid, OR the " +
        "work is a clear single-edit fix where downstream agents have nothing to " +
        "misread.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to run intent analysis (first-wake / re-entry / scope change)"),
      }),
      execute: async () => {
        const task = requireTask(taskID)
        await trackStepStart("analyze_intent")
        let out
        try {
          const { IntentAnalysisAgent } = await import("@/intent-analysis/agent")
          out = await IntentAnalysisAgent.analyze({
            request: task.request,
            title: task.title,
            taskID,
            attachments: Array.isArray(task.attachments) ? task.attachments as any : undefined,
            parentSessionID: input.agentSessionID,
            signal: input.signal,
            onStatus: () => {},
          })
        } catch (err) {
          await trackStepComplete("analyze_intent", undefined, true)
          throw err
        }
        const r = out.result
        const blockers = r.clarifications.filter((c) => c.priority === "blocker")
        const nices = r.clarifications.filter((c) => c.priority === "nice")

        // Persist intent reading into the Decision Log so downstream agents
        // (requirements / architect / integrity / build) see the upstream
        // scope_boundary / complexity / slots / clarifications via the
        // TaskContext.snapshot block. Without this the agent runs but its
        // output never reaches any downstream prompt — pure token waste.
        // Same pattern as design_analysis (rule 22, single source).
        const { createDecisionLog } = await import("@/decision-log")
        const decisionLog = createDecisionLog(taskID)
        decisionLog.append({
          phase: "intent_analysis",
          key: "intent_summary",
          value: `${r.intent_class} / ${r.complexity} / confidence=${r.confidence.toFixed(2)}. ${r.summary}`,
          reason: "Intent-analysis terminal classification for downstream stage agents.",
        })
        if (r.extracted_slots.length > 0) {
          decisionLog.append({
            phase: "intent_analysis",
            key: "intent_slots",
            value: r.extracted_slots
              .map((s) => `${s.key}=${s.value} (conf=${s.confidence.toFixed(2)})`)
              .join("; "),
            reason: "Slots extracted from the user request — downstream REQ-N + goal decomposition should reflect these explicitly.",
          })
        }
        if (r.missing_info.length > 0) {
          decisionLog.append({
            phase: "intent_analysis",
            key: "intent_missing_info",
            value: r.missing_info.join(", "),
            reason: "Information judged missing from the request — downstream agents must infer from repo / decisions or flag explicitly.",
          })
        }
        if (blockers.length > 0) {
          decisionLog.append({
            phase: "intent_analysis",
            key: "intent_blocker_clarifications",
            value: blockers.map((c) => c.question).join(" | "),
            reason: "Blocker clarifications — orchestrator already surfaced or auto-resolved; downstream should not re-ask.",
          })
        }
        if (nices.length > 0) {
          decisionLog.append({
            phase: "intent_analysis",
            key: "intent_nice_clarifications",
            value: nices.map((c) => c.question).join(" | "),
            reason: "Nice-to-have clarifications — downstream picks the most reasonable answer if a decision hinges on one.",
          })
        }

        await trackStepComplete("analyze_intent")

        return SubAgentProtocol.yieldResult({
          headline:
            `Intent: ${r.intent_class} / complexity=${r.complexity} / confidence=${r.confidence.toFixed(2)}. ` +
            (blockers.length > 0
              ? `${blockers.length} blocker clarification(s) — call \`question\` BEFORE \`requirements\`.`
              : `NEXT: call \`requirements\` (or \`design_analysis\` first if visual references exist).`),
          summary: r.summary,
          fields: [
            ["slots", r.extracted_slots.map((s) => `${s.key}=${s.value}`)],
            ["missing_info", r.missing_info],
            ["blocker_questions", blockers.map((c) => c.question)],
            ["nice_questions", nices.map((c) => c.question)],
          ],
          pointer: `intent session ${out.sessionID}; decision log keys: intent_summary${r.extracted_slots.length>0?" + intent_slots":""}${r.missing_info.length>0?" + intent_missing_info":""}${blockers.length>0?" + intent_blocker_clarifications":""}${nices.length>0?" + intent_nice_clarifications":""}`,
        })
      },
    }),

    // -----------------------------------------------------------------------
    // Per-goal tools — Orchestrator decides when to call each
    // -----------------------------------------------------------------------


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

        // When a contract change triggered status reset, the prior attempt's
        // worktree is stale (built against the old contract). Cleanup so the
        // next build starts from a fresh primary checkout and doesn't carry
        // forward the old tree's state. Cleanup failure is surfaced so the
        // DB pointer remains available for diagnosis.
        let cleanupSuffix = ""
        if (statusReset) {
          const { cleanupGoalWorkspaceForGoal } = await import("@/engine/writer")
          const cleaned = await cleanupGoalWorkspaceForGoal(goalID)
          if (cleaned) cleanupSuffix = ", stale worktree cleaned"
        }

        return `Goal ${goalID} modified: ${changed.join(", ") || "(no changes)"}${resetSuffix}${abortSuffix}${supersedeSuffix}${cleanupSuffix}`
      },
    }),

    query_failed_goals: tool({
      description: "Query all currently failed goals with their latest delivery info. Returns one block per failed goal (acceptance_specs truncated, only latest run). Use BEFORE re-running build on a failed goal to understand per-goal failure reasons.",
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
          const label = `#G${goal.order_index + 1}V${goal.retry_count + 1}`
          sections.push(`\n### ${label} ${goal.id}: ${goal.title}`)
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
            sections.push(`- current implementation version: ${label}`)
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

    read_context: tool({
      description: "Read current task context: goal states, delivery verdicts, Decision Log, delivery summaries, integrity/prosecutor attempts. Use this to gather information before making decisions. Returns only the latest state per goal / per spec snapshot / per delivery — historical entries older than the latest are omitted to keep prompts bounded.",
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
            const label = `#G${g.order_index + 1}V${g.retry_count + 1}`
            sections.push(`- [${goalStatusByID(g.id)}] ${label} ${g.id}: ${g.title} [${g.priority}]`)
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

        if (scope === "all") {
          // Integrity / prosecutor attempts: surface the FACT that these stages
          // ran for the current spec snapshot / delivery. Without this the
          // orchestrator-LLM cannot tell "integrity returned pass (no goal
          // change)" from "integrity never called" — same death-loop shape that
          // commit 7acb5f17f addressed for build via begin/finalizeBuildAttempt.
          const { EngineArtifactTable } = await import("@/engine/engine.sql")
          const { desc } = await import("@/storage/db")
          const activeSpec = findActiveSpecForTask(taskID)
          if (activeSpec) {
            const integrityRow = Database.use((db) =>
              db
                .select()
                .from(EngineArtifactTable)
                .where(
                  and(
                    eq(EngineArtifactTable.task_id, taskID),
                    eq(EngineArtifactTable.kind, "integrity_attempt"),
                  ),
                )
                .orderBy(desc(EngineArtifactTable.time_created))
                .limit(1)
                .get(),
            )
            if (integrityRow) {
              const p = (integrityRow.payload ?? {}) as Record<string, unknown>
              const matchesSnapshot = p.spec_snapshot_id === activeSpec.id
              const perDim = Array.isArray(p.per_dimension)
                ? (p.per_dimension as Array<{ id: string; verdict: string }>)
                  .map((d) => `${d.id}=${d.verdict}`)
                  .join(", ")
                : ""
              sections.push(
                `\n## Integrity (latest)`,
                `- verdict: ${String(p.verdict ?? "unknown")}` +
                  (perDim ? ` — per-dimension: ${perDim}` : "") +
                  ` — issues=${Number(p.issues_count ?? 0)} corrections=${Number(p.corrections_count ?? 0)} missing=${Number(p.missing_count ?? 0)}` +
                  (matchesSnapshot ? " (current spec snapshot)" : " (STALE — newer spec snapshot exists; re-run integrity)"),
              )
            }
          }
          const lastDeliveryRow = Database.use((db) =>
            db
              .select()
              .from(EngineArtifactTable)
              .where(
                and(
                  eq(EngineArtifactTable.task_id, taskID),
                  eq(EngineArtifactTable.kind, "delivery"),
                ),
              )
              .orderBy(desc(EngineArtifactTable.time_created))
              .limit(1)
              .get(),
          )
          const lastDeliveryID: string | null = lastDeliveryRow?.delivery_id ?? null
          if (lastDeliveryID) {
            const prosecutorRow = Database.use((db) =>
              db
                .select()
                .from(EngineArtifactTable)
                .where(
                  and(
                    eq(EngineArtifactTable.task_id, taskID),
                    eq(EngineArtifactTable.kind, "prosecutor_attempt"),
                    eq(EngineArtifactTable.delivery_id, lastDeliveryID),
                  ),
                )
                .orderBy(desc(EngineArtifactTable.time_created))
                .limit(1)
                .get(),
            )
            if (prosecutorRow) {
              const p = (prosecutorRow.payload ?? {}) as Record<string, unknown>
              sections.push(
                `\n## Prosecutor (latest, delivery ${lastDeliveryID})`,
                `- iteration=${Number(p.iteration ?? 0)}` +
                  ` filed=${Number(p.counterexamples_filed ?? 0)}` +
                  ` proposed=${Number(p.challenges_proposed ?? 0)}` +
                  ` resolved=${Number(p.counterexamples_resolved ?? 0)}`,
              )
            } else {
              sections.push(
                `\n## Prosecutor (latest, delivery ${lastDeliveryID})`,
                `- not run for this delivery — call \`prosecute\` after \`deliver\` and before \`publish_delivery\`.`,
              )
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

    fail_task: tool({
      description: "Mark the task as failed. Use when the task cannot be completed.",
      inputSchema: z.object({
        error: z.string().describe("Why the task failed"),
      }),
      execute: async ({ error }) => {
        const task = requireTask(taskID)
        await updateTask(task, { status: "failed", error, time_completed: Date.now() }, `Failed: ${error}`)

        // Task is dead — every goal's worktree is now garbage. Clean
        // proactively here rather than waiting for the engine/writer
        // task-terminal sweep so disk usage drops at the moment of
        // decision (rule 22: orchestrator owns worktree lifecycle).
        const cleaned = await cleanupTerminalGoalWorkspaces("fail_task")
        return `Task ${taskID} failed: ${error}${cleaned > 0 ? ` (${cleaned} goal worktree(s) cleaned)` : ""}`
      },
    }),

    cancel_task: tool({
      description: "Cancel the task immediately. Use when the user explicitly asks to stop or abandon the current work.",
      inputSchema: z.object({
        reason: z.string().describe("Why you are cancelling the task"),
      }),
      execute: async ({ reason }) => {
        await EngineService.cancelTask(taskID)
        return `Task ${taskID} cancelled. Reason: ${reason}`
      },
    }),

    retry_task: tool({
      description: "Retry a failed or cancelled task when the user wants to continue from the latest state.",
      inputSchema: z.object({
        reason: z.string().describe("Why you are retrying the task"),
      }),
      execute: async ({ reason }) => {
        await EngineService.retryTask(taskID)
        return `Task ${taskID} retried. Reason: ${reason}`
      },
    }),

    inject_operator_message: tool({
      description: "Forward the latest operator message into the currently running executor session. Use only when the task should continue under the same active execution, not when strategy must change.",
      inputSchema: z.object({
        reason: z.string().describe("Why this operator message should be injected into the current execution"),
      }),
      execute: async ({ reason }) => {
        const latest = input.operatorMessage?.text?.trim()
        if (!latest) {
          return "No operator message is available on this trigger."
        }
        const payload = input.operatorMessage?.attachmentSummary
          ? `${latest}\n\n${input.operatorMessage.attachmentSummary}`
          : latest
        const result = await EngineService.injectMessage(taskID, payload)
        return `Operator message injected. Reason: ${reason}. resumed=${result.resumed} status=${result.status}`
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
        const activePlanAtStart = findActivePlanForTask(task.id)
        const activeSpecAtStart = findActiveSpecForTask(task.id)
        const plan = restartStagePlan(stage, Boolean(activePlanAtStart))
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

          if (plan.clearPlan && activePlanAtStart) {
            db.update(EnginePlanVersionTable)
              .set({ status: "superseded", time_updated: now })
              .where(eq(EnginePlanVersionTable.id, activePlanAtStart.id))
              .run()
          }

          if (plan.clearSpec && activeSpecAtStart) {
            db.update(EngineSpecSnapshotTable)
              .set({ status: "superseded", time_updated: now })
              .where(eq(EngineSpecSnapshotTable.id, activeSpecAtStart.id))
              .run()
          }
        })

        if (plan.queueFreshRun && activePlanAtStart) {
          const executor = task.executor
          freshRun = createRun({
            taskID,
            planVersionID: activePlanAtStart.id,
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
      description: "FINAL acceptance gate — call ONLY after every dispatchable goal is terminal (passed/failed) and no eligible wave remains uncalled. Aggregates goal deliveries and runs DeliveryAgent for build/test/startup verification. NEVER call while goals are pending/dispatched/running, NEVER call as a progress check, NEVER call before any build has produced material in direct mode. Always read_context first to verify the goal graph is fully resolved.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to deliver now"),
      }),
      execute: async () => {
        const task = requireTask(taskID)

        // Stateless / unconditional deliver (rule 23): every task ends through
        // this agent regardless of upstream state. No "execute goals first"
        // gate. If no coordinator run exists yet (e.g. direct request-only
        // path, or LLM chose to deliver before any build) we lazy-bootstrap
        // one when there are goals to anchor it; otherwise we proceed with a
        // null run id and let the delivery agent decide on the available state.
        let activeRun = findActiveRunForTask(task.id)
        if (!activeRun && listGoals(taskID).length > 0) {
          const ensured = await ensureDispatchableRunForSingleGoal()
          if (!("error" in ensured)) activeRun = ensured.run
        }
        const run = activeRun

        await trackStepStart("deliver")

        const goals = listGoals(taskID)

        // Aggregate per-goal deliveries — query by task so deliver still works
        // when no coordinator run exists (e.g. tasks that bypassed the
        // pipeline). When a run exists every goal_run_attempt also carries
        // its run_id; the task-scoped query returns the same set.
        const { listGoalRunsForTask, findDeliveryByGoalRun } = await import("@/engine/store")
        const goalRuns = listGoalRunsForTask(task.id)
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

        // Direct-workflow material collection: when the task is explicit
        // kind=build (build → deliver, no per-goal dispatch), there are zero
        // goal_runs and therefore zero aggregated diffs — but the build
        // agent still wrote files to the main worktree. Without material
        // here the delivery agent sees an empty workspace and rubber-stamps
        // "accepted", which defeats the "build mode also undergoes delivery
        // acceptance" contract. Read the working-tree diff directly so the
        // delivery agent judges the actual changes.
        if (allDiffs.length === 0 && goalRuns.length === 0) {
          try {
            const { $: $bun } = await import("bun")
            const cwd = Instance.directory
            const statusResult = await $bun`git status --porcelain=v1 -uall`.cwd(cwd).quiet().nothrow()
            const statusLines = statusResult.stdout.toString().split("\n").filter((line) => line.trim().length > 0)
            for (const raw of statusLines) {
              // Porcelain format: "XY file" (X=index status, Y=worktree status). Extract the path.
              const file = raw.slice(3).trim().replace(/^"(.+)"$/, "$1")
              if (!file || seenFiles.has(file)) continue
              let diff = ""
              const diffResult = await $bun`git diff HEAD -- ${file}`.cwd(cwd).quiet().nothrow()
              if (diffResult.exitCode === 0) diff = diffResult.stdout.toString()
              if (!diff) {
                // New / untracked — read raw contents so the delivery agent
                // has real bytes instead of an empty diff.
                const fs = await import("node:fs/promises")
                const path = await import("node:path")
                const full = path.join(cwd, file)
                const content = await fs.readFile(full, "utf8").catch(() => "")
                if (content) diff = `New file:\n${content}`
              }
              seenFiles.add(file)
              allDiffs.push({ file, diff })
            }
            if (allDiffs.length > 0) {
              summaries.push(
                `Direct build produced ${allDiffs.length} changed file(s) in the main worktree.`,
              )
              log.info("deliver: direct-mode diff captured from main worktree", {
                taskID, fileCount: allDiffs.length,
              })
            } else {
              log.warn("deliver: direct mode with no per-goal deliveries AND empty working tree", {
                taskID, cwd,
              })
            }
          } catch (err) {
            log.warn("deliver: direct-mode diff capture failed (non-fatal)", {
              taskID, error: err instanceof Error ? err.message : String(err),
            })
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
          requirement_ids: Array.isArray(g.requirement_ids) ? g.requirement_ids as string[] : [],
          depends_on: Array.isArray(g.depends_on) ? g.depends_on as string[] : [],
          imports: Array.isArray(g.imports) ? g.imports as string[] : [],
          exports: Array.isArray(g.exports) ? g.exports as string[] : [],
          owned_paths: Array.isArray(g.owned_paths) ? g.owned_paths as string[] : [],
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
        // P0-0.B — for any task that ships visual references (user attachments
        // or design-analysis screenshots), rendering the merged worktree to a
        // PNG is a HARD prerequisite, not a best-effort. Failure to render a
        // visual deliverable means the delivery agent can never see what was
        // built — judging only against the reference is the exact "LLM only
        // sees reference" downgrade path the spec forbids (rule 1, no
        // fallback). We surface the failure as a structured reject signal and
        // skip the agent run entirely.
        let renderFailure: { kind: "no_index" | "render_threw"; detail: string } | undefined
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
              renderFailure = {
                kind: "no_index",
                detail: `merged worktree at ${Instance.directory} has no index.html — visual deliverable cannot be rendered`,
              }
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
          renderFailure = {
            kind: "render_threw",
            detail: renderErr instanceof Error ? renderErr.message : String(renderErr),
          }
        }

        // P0-0.B — short-circuit on render failure. Constructs a rejected
        // verdict locally (no LLM call), opens a fresh attempt on every goal
        // (visual failures cross-cut), and returns. Goes through the SAME
        // engine_iteration / startNewAttempt / yieldResult plumbing the
        // normal rejected path uses, so the orchestrator's next turn reads
        // identical signals — the only difference is `summary` cites the
        // render failure instead of LLM-authored issues.
        if (renderFailure) {
          await trackStepComplete("deliver", undefined, true)
          const { computeIterationSnapshot } = await import("@/metrics/score")
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
          const snapshot = computeIterationSnapshot({
            task_id: taskID,
            iteration,
            specs: readSpecsForTask(taskID),
            currentResults: readResultsForIteration(taskID, iteration),
            previousResults: iteration > 0 ? readResultsForIteration(taskID, iteration - 1) : [],
            counterexamples: readCounterexamplesForTask(taskID),
            previousAggregateScore: readPreviousAggregateScore(taskID, iteration),
          })
          writeIterationSnapshot({ ...snapshot, arbiter_verdict: "continue" as const })

          const summary =
            renderFailure.kind === "no_index"
              ? `Delivery rejected: ${renderFailure.detail}. Build a runnable index.html in the merged worktree before re-attempting delivery.`
              : `Delivery rejected: render of merged worktree failed (${renderFailure.detail}). Visual deliverables require a working puppeteer render before the delivery agent can see what was built.`

          const { EngineArtifactTable } = await import("@/engine/engine.sql")
          const verdictArtifactId = Identifier.ascending("artifact")
          // Synthetic short-circuit verdict: render preconditions failed
          // before the delivery agent ran. Conforms to the new RejectedVerdict
          // schema (rule 22 — single source of truth: rejection_details
          // carries every per-goal attribution; no shadow `issues_found` /
          // `affected_goal_ids` fields). `tool_call_evidence` records the
          // synthetic gate that produced this verdict so downstream readers
          // see the same audit shape as an LLM-emitted rejection.
          const renderRejectVerdict: import("@/delivery/agent").DeliveryVerdictType = {
            verdict: "rejected",
            summary,
            startup_verification: { attempted: false, success: false, output: renderFailure.detail },
            frontend_check: { attempted: false, renders_correctly: false, issues: [renderFailure.detail] },
            deferred_checks: [],
            tool_call_evidence: [
              {
                tool: "render_prerequisite_gate",
                passed: false,
                detail: `${renderFailure.kind}: ${renderFailure.detail}`,
              },
            ],
            rejection_details: goals.map((g) => ({
              goal_id: g.id,
              category: "visual" as const,
              error: renderFailure!.detail,
              suggestion:
                renderFailure!.kind === "no_index"
                  ? "Produce a runnable index.html under the project root (or a path findRenderedIndex can locate)."
                  : "Fix the build so puppeteer can load and render the merged worktree.",
            })),
          }
          Database.use((db) =>
            db
              .insert(EngineArtifactTable)
              .values({
                id: verdictArtifactId,
                task_id: taskID,
                run_id: run?.id ?? null,
                delivery_id: deliveryID,
                kind: "verdict",
                label: "delivery-agent-verdict",
                payload: renderRejectVerdict,
                time_created: Date.now(),
                time_updated: Date.now(),
              })
              .run(),
          )

          updateEvaluationFromDeliveryVerdict({
            deliveryID,
            verdict: "rejected",
            summary,
            checks: [
              {
                name: "render_prerequisite",
                status: "failed" as const,
                evidence: renderFailure.detail,
                scorer_kind: "delivery_verdict" as const,
              },
            ],
            now: Date.now(),
          })

          const { startNewAttempt } = await import("@/engine/persist")
          for (const g of goals) {
            startNewAttempt({
              goalID: g.id,
              reason: "delivery_rework",
              feedback: {
                value: `Delivery rejected before agent run (iteration ${iteration}): ${summary}`,
                reason: `render_prerequisite_failed:${renderFailure.kind}`,
              },
            })
          }

          try {
            const { createDecisionLog } = await import("@/decision-log")
            createDecisionLog(taskID).append({
              phase: "delivery",
              key: `delivery_render_rejected_${iteration}`,
              value: summary,
              reason: renderFailure.kind,
            })
          } catch {
            /* best effort */
          }

          log.info("deliver: render prerequisite failed — short-circuit reject", {
            taskID, iteration, kind: renderFailure.kind,
            reset_goals: goals.length,
          })

          requestStopAfterCurrentStep("delivery_render_rejected")
          // Wake the orchestrator-loop after the deferred stop finalizes —
          // without this, the loop exits and pending goals never get
          // re-dispatched (see project_orchestrator_wake_wedge memory).
          {
            const { dispatchTaskLoop } = await import("@/engine/queue")
            void dispatchTaskLoop({
              taskID,
              event: {
                note: OrchestratorEventNote.deliveryRework({
                  reason: `render_prerequisite_failed:${renderFailure.kind}`,
                  iteration,
                  summary,
                }),
              },
            })
          }
          return SubAgentProtocol.yieldResult({
            headline: `Delivery rejected — render prerequisite failed (${renderFailure.kind})`,
            fields: [
              ["render_failure_kind", renderFailure.kind],
              ["iteration", String(iteration)],
              ["affected_goals", String(goals.length)],
            ],
            pointer: `verdict artifact ${verdictArtifactId}; render must succeed before next deliver`,
          })
        }

        // Single session per sub-agent (rule 22). DeliveryService.verify
        // creates the runner session internally under the orchestrator parent.
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

          // Compute current iteration up-front so DeliveryService.verify can
          // namespace its deterministic-gate rejection card by iteration. The
          // metrics block below recomputes the same thing for its own use; both
          // read from the same readIterationHistory source so the value is
          // identical (no double-source — metrics still owns the snapshot
          // write, this just shares the read).
          const { readIterationHistory: readIterHistForVerify } = await import("@/metrics/store")
          const deliverIteration = readIterHistForVerify(taskID).length

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
              iteration: deliverIteration,
              parentSessionID: input.agentSessionID,
            })

          // Persist verdict as artifact
          const { EngineArtifactTable } = await import("@/engine/engine.sql")
          const verdictArtifactId = Identifier.ascending("artifact")
          Database.use((db) =>
            db.insert(EngineArtifactTable).values({
              id: verdictArtifactId,
              task_id: taskID,
              run_id: run?.id ?? null,
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
          // ── Run metric executor + record trajectory snapshot ───────────
          // The delivery agent's verdict is the AUTHORITATIVE decision. The
          // old deterministic Arbiter (`metrics/arbiter.ts::arbitrate`) that
          // used to re-derive accept/continue/stalled/abort from snapshot
          // counts was a coded FSM (CLAUDE.md rule 23) — it silently
          // overrode the agent's verdict and caused the benchmark deadlock
          // on skipped metrics. The snapshot is still written for
          // observability (LLM reads it via query_metric_trajectory).
          const {
            executeMetrics,
          } = await import("@/metrics/executor")
          const { computeIterationSnapshot } = await import("@/metrics/score")
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

          // Prosecutor is no longer invoked here (audit 2026-04-25). The
          // adversarial pass is a sibling agent call driven by the
          // orchestrator via the `prosecute` tool, which the orchestrator
          // calls AFTER `deliver` returns. Counterexamples filed in the
          // prosecute step land before the next deliver iteration's
          // trajectory query reads them, which is the only ordering
          // requirement; the iteration snapshot below is recomputed by the
          // next `deliver` run without needing the prosecutor's output to
          // be present in this snapshot.
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
          // Project agent verdict onto the legacy snapshot column so prompts
          // that already cite "arbiter_verdict" (delivery/tools, prosecutor,
          // orchestrator summary) keep rendering without churn. accepted →
          // "accept"; anything else → "continue" (rework).
          const projectedVerdict = verdict.verdict === "accepted" ? "accept" as const : "continue" as const
          writeIterationSnapshot({ ...snapshot, arbiter_verdict: projectedVerdict })
          log.info("deliver: agent verdict recorded", {
            taskID,
            iteration,
            agentVerdict: verdict.verdict,
            aggregate_score: snapshot.aggregate_score.toFixed(3),
            blocking_unmet: snapshot.blocking_unmet_count,
          })

          // P0-C.1 — anchor every delivery picky-loop iteration in git so
          // (a) the LKG rollback (P0-C.4) has commits to reset to, (b) the
          // publisher computes changedFiles from git history (P0-C.3), and
          // (c) `git log --grep="delivery round"` reads the round timeline.
          // Allow-empty so a "no edits this round" verdict still anchors.
          log.info("deliver: round commit START", { taskID, iteration })
          const roundCommitTask = requireTask(taskID)
          log.info("deliver: round commit, requireTask done", { taskID })
          const roundCommitVerdict = {
            verdict: verdict.verdict,
            summary: verdict.summary,
            rejection_count: verdict.verdict === "rejected" ? verdict.rejection_details.length : 0,
          }
          log.info("deliver: round commit, verdict shape built", { taskID, verdict: roundCommitVerdict.verdict, rejection_count: roundCommitVerdict.rejection_count })
          const roundCommit = await EngineGit.commitDeliveryRound({
            task: roundCommitTask,
            iteration,
            verdict: roundCommitVerdict,
          })
          log.info("deliver: round commit", {
            taskID, iteration, mode: roundCommit.mode,
            commit: roundCommit.commit, error: roundCommit.error,
          })

          // P0-C.4 — Last-Known-Good rollback. Compute the visual score for
          // this round, compare against task.metadata.git.delivery_lkg, and
          // either advance the LKG anchor (improvement) or reset --hard back
          // to it (regression past tolerance). Skipped silently for tasks
          // that have no rendered_output + reference pair (lib/api projects
          // do not have a meaningful visual score). Score / outcome flow
          // into the verdict artifact + decision log so Stream G's replay
          // reads them without a separate table.
          let lkgOutcome: import("@/engine/git").LKGOutcome | undefined
          let lkgMetric: import("@/delivery/visual-metric").VisualMetricResult | undefined
          let lkgRenderedPath: string | undefined
          try {
            const taskAfterRound = requireTask(taskID)
            const renderedRef = (taskAfterRound.system_artifacts ?? [])
              .find((a: any) => a?.intent === "rendered_output" && typeof a?.url === "string") as
                | { url: string } | undefined
            const referencePool = [
              ...((taskAfterRound.attachments ?? []) as any[]),
              ...((taskAfterRound.system_artifacts ?? []) as any[]),
            ].filter((a) => a?.intent !== "rendered_output" && typeof a?.mime === "string"
              && a.mime.startsWith("image/") && typeof a?.url === "string")
            const tagged = referencePool.filter((a) => a?.intent === "visual_reference")
            const referenceRef = (tagged[0] ?? referencePool[0]) as { url: string } | undefined

            if (renderedRef && referenceRef) {
              const { AttachmentStore } = await import("@/storage/attachment-store")
              const { computeVisualMetric, loadVisualThresholds } = await import("@/delivery/visual-metric")
              const renderedLoc = AttachmentStore.nameFromUrl(renderedRef.url)
              const referenceLoc = AttachmentStore.nameFromUrl(referenceRef.url)
              const renderedPath = renderedLoc ? AttachmentStore.resolveAbsolute(renderedLoc.projectID, renderedLoc.name) : undefined
              const referencePath = referenceLoc ? AttachmentStore.resolveAbsolute(referenceLoc.projectID, referenceLoc.name) : undefined
              if (renderedPath && referencePath) {
                const metric = await computeVisualMetric({
                  renderedPath,
                  referencePath,
                  thresholds: loadVisualThresholds(),
                })
                lkgMetric = metric
                lkgRenderedPath = renderedPath
                const lkg = await EngineGit.evaluateAndApplyLKG({
                  task: taskAfterRound,
                  iteration,
                  score: metric.score,
                  roundCommitSha: roundCommit.commit,
                })
                lkgOutcome = lkg.outcome
                log.info("deliver: LKG outcome", {
                  taskID, iteration, kind: lkg.outcome.kind,
                  score: metric.score.toFixed(3),
                  best_score: "previous" in lkg.outcome ? lkg.outcome.previous.best_score.toFixed(3) : undefined,
                  rolledBackTo: "rolledBackTo" in lkg.outcome ? lkg.outcome.rolledBackTo : undefined,
                })
                try {
                  const { createDecisionLog } = await import("@/decision-log")
                  createDecisionLog(taskID).append({
                    phase: "delivery",
                    key: `delivery_lkg_${iteration}`,
                    value: `score=${metric.score.toFixed(3)} outcome=${lkg.outcome.kind}`,
                    reason: "rolledBackTo" in lkg.outcome ? `rollback_to=${lkg.outcome.rolledBackTo}` : "",
                  })
                } catch { /* best effort */ }
              }
            }
          } catch (lkgErr) {
            // Rollback failure is structural — surface loudly but do NOT
            // silently swallow it. The next iteration would compound the bad
            // state. Log error and continue: verdict still records the
            // (untrustworthy) state, and the orchestrator LLM sees the
            // rollback failure in the decision log on its next turn.
            log.error("deliver: LKG evaluation/rollback failed", {
              taskID, iteration,
              error: lkgErr instanceof Error ? lkgErr.message : String(lkgErr),
            })
            try {
              const { createDecisionLog } = await import("@/decision-log")
              createDecisionLog(taskID).append({
                phase: "delivery",
                key: `delivery_lkg_failed_${iteration}`,
                value: lkgErr instanceof Error ? lkgErr.message : String(lkgErr),
                reason: "lkg_evaluation_threw",
              })
            } catch { /* best effort */ }
          }

          // Phase-6-c: engine_delivery_round was an observability side-channel
          // (writer: this site; reader: script/delivery/replay.ts). Per
          // specs/new-arch/16-unified-teardown.md §7-6-c + rule 22 (禁双源),
          // picky-loop verdict signal lives in decision_log + artifact stream
          // (`changed_file` / `report` / `verdict` kinds), so the parallel
          // delivery_round table was removed. Rolled-back / regressed outcomes
          // still get surfaced via the decision log appended above.
          void lkgOutcome

          if (verdict.verdict === "accepted") {
            await trackStepComplete("deliver")
            log.info("deliver: agent accepted, auto-publishing", { taskID, runID: run?.id ?? null, deliveryID })
            // Auto-publish: delivery agent accepted → immediately complete task.
            // No second LLM turn needed — avoids infinite loop where LLM ends turn
            // without calling publish_delivery.
            //
            // Stateless deliver path (run-less tasks): if no coordinator run
            // exists, there is no Publisher pipeline to drive — the task has
            // no goals/plan to merge. The verdict is already recorded above;
            // surface the accept to the LLM so it can fail-task or complete
            // by other means. This path is rare (most tasks now lazy-create
            // a run via build), but covered for unconditional deliver intent.
            if (!run) {
              return `Delivery verified and ACCEPTED, but no coordinator run exists for this task — nothing for Publisher to merge. Verdict artifact ${verdictArtifactId} recorded; call modify_goal/build to materialise a goal-bearing run if you need to publish a deliverable.`
            }
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
                const verdictPayload = verdictArtifact?.payload as
                  | (import("@/delivery/agent").DeliveryVerdictType & { verdict: "accepted" | "rejected" })
                  | null
                if (verdictPayload?.verdict) {
                  // The persisted verdict carries rejection_details for
                  // rejected verdicts; derive the issues list here so the
                  // schema stays single-source-of-truth (rule 22).
                  const issues = verdictPayload.verdict === "rejected"
                    ? verdictPayload.rejection_details.map((d) => d.error)
                    : []
                  updateEvaluationFromDeliveryVerdict({
                    deliveryID: delivery.id,
                    verdict: verdictPayload.verdict,
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
                  await updateTask(current, { status: "failed", error: finalized.error, time_completed: completed }, finalized.error)
                  return `Git finalization failed: ${finalized.error}`
                }
                const cleanedGoalWorkspaces = await cleanupTerminalGoalWorkspaces("deliver auto-publish")
                // Ensure task is in "active" before completing (recovery may have reset to "queued")
                const preComplete = requireTask(taskID)
                if (isTaskQueued(preComplete)) {
                  await updateTask(preComplete, { status: "active" }, "Activating for completion")
                }
                const readyTask = requireTask(taskID)
                await updateTask(readyTask, { status: "completed", error: null, time_completed: completed }, "Task completed")
                const { Plugin } = await import("@/plugin")
                await Plugin.trigger("delivery.ready", { taskID, runID: run.id, deliveryID: delivery.id }, { actions: [] }).catch(err => log.warn("plugin 'delivery.ready' trigger failed (non-fatal)", { error: String(err) }))
                Promise.race([
                  EngineMemoryBridge.flushTaskLearnings({ task: currentTask, run, delivery, evaluation: findEvaluationByRun(run.id), plan: currentPlan }),
                  new Promise<void>((_, reject) => setTimeout(() => reject(new Error("flushTaskLearnings timeout (30s)")), 30_000)),
                ]).catch(err => log.warn("failed to flush task learnings", { error: String(err) }))
                const cleanupNote = cleanedGoalWorkspaces > 0 ? ` ${cleanedGoalWorkspaces} goal worktree(s) cleaned.` : ""
                return `Delivery published and task completed successfully.${cleanupNote} You can call refine to analyze the project and suggest improvements for the next iteration.`
              }
              await updateTask(currentTask, { status: "failed", error: publishResult.summary, time_completed: completed }, publishResult.summary)
              return `Publish returned non-delivered status: ${publishResult.summary}`
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              log.error("deliver: auto-publish failed", { taskID, error: msg, stack: err instanceof Error ? err.stack : undefined })
              return `Delivery verified and ACCEPTED but publish failed: ${msg}. Call publish_delivery to retry.`
            }
          }
          await trackStepComplete("deliver", undefined, true)

          // Schema invariant: at this point `verdict.verdict === "rejected"`,
          // so `rejection_details` is the discriminated-union branch with
          // `.min(1)` non-empty. Derive the aggregate views from it (rule 22 —
          // single source of truth: `rejection_details` is canonical, the
          // older `affected_goal_ids` / `issues_found` shadow fields are gone).
          const { affectedGoalIDs, issuesFound } = await import("@/delivery/verdict")
          const rejectionAffectedGoalIDs = affectedGoalIDs(verdict)
          const rejectionIssues = issuesFound(verdict)

          // Persist the delivery-agent's advisory verdict into the evaluation
          // row for operator-facing drill-down. Convergence lives in
          // engine_iteration — this row is for audit only.
          updateEvaluationFromDeliveryVerdict({
            deliveryID,
            verdict: verdict.verdict,
            summary: verdict.summary,
            checks: rejectionIssues.map((evidence, i) => ({
              name: `issue-${i + 1}`,
              status: "failed" as const,
              evidence,
              scorer_kind: "delivery_verdict" as const,
            })),
            now: Date.now(),
          })

          // Agent verdict is "rejected" — open a fresh attempt on every
          // goal the delivery agent attributed the rejection to (the
          // distinct `rejection_details[].goal_id` set). The orchestrator's
          // next turn reads engine_iteration + the verdict artifact and
          // chooses strategy (modify_goal / re-run architect / fail_task);
          // the old deterministic "stalled/abort" branches were an FSM over
          // metric counts (CLAUDE.md rule 23) and are gone — give-up decisions
          // belong to the orchestrator LLM.
          //
          // engine_iteration + the verdict artifact persisted above are the
          // canonical source of truth for the rejection details — the
          // orchestrator reads them via query_metric_trajectory and the
          // task loop watermarks the verdict artifact to synthesize a
          // rejection wake note for the next orchestrator decision.
          // No task.metadata signal.
          const { startNewAttempt } = await import("@/engine/persist")
          // Attribution is the delivery agent's job. The schema's
          // discriminated-union `RejectedVerdict` makes `rejection_details`
          // .min(1) required, so a rejection always carries ≥1 attributed
          // goal. We open a fresh attempt on exactly those goals — no
          // string-matching of rejection_details[].file vs owned_paths here,
          // and no "if attribution is empty, reset every passed goal"
          // blanket policy. That blanket reset was dressed up as
          // "baseline correctness" but it reset goals the rejection never
          // cited and wiped valid work on every ambiguous rejection —
          // violating rule 1 (no fallback) and rule 23 (no hardcoded state
          // machine; let the LLM — here, the delivery agent — decide).
          const goalByID = new Map(goals.map((g) => [g.id, g]))
          const unknownAffected: string[] = []
          const toReset: typeof goals = []
          for (const gid of rejectionAffectedGoalIDs) {
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
              `Delivery verdict cites unknown goal_ids in rejection_details: ${unknownAffected.join(", ")}. ` +
              `Known goals for this task: ${[...goalByID.keys()].join(", ") || "(none)"}.`,
            )
          }

          // Fix-runs budget gate. `iteration` counts prior delivery rounds —
          // every delivery_rework cycle increments it by one. Without this
          // check the loop is unbounded: `--max-fix-runs` was rendered into
          // the orchestrator describe context but never enforced, so the
          // benchmark could spin indefinitely on the same rework prompt
          // (observed in 2026-04-27 ainvest run: 4+ consecutive fix-build
          // attempts all forgot `merge_back`, evaluator kept rejecting on
          // the unchanged primary, and `startNewAttempt` happily opened a
          // fresh attempt every time). When the budget is exhausted, refuse
          // to dispatch yet another `delivery_rework` and yield a sharp
          // signal so the orchestrator LLM must escalate (modify_goal /
          // restart_from_stage) or call `fail_task`. Compare with `>=` so a
          // budget of N permits N fix runs (iterations 0..N-1 open new
          // attempts; iteration N is the cutoff).
          const fixBudget = await effectiveMaxFixRuns(task)
          if (iteration >= fixBudget) {
            log.info("deliver: fix-runs budget exhausted — refusing delivery_rework", {
              taskID,
              iteration,
              maxFixRuns: fixBudget,
              issues: rejectionIssues.length,
            })
            try {
              const { createDecisionLog } = await import("@/decision-log")
              createDecisionLog(taskID).append({
                phase: "delivery",
                key: `delivery_budget_exhausted_${iteration}`,
                value: `Fix-runs budget exhausted: iteration=${iteration} >= max_fix_runs=${fixBudget}. No more delivery_rework attempts will be opened.`,
                reason: rejectionIssues.join("; "),
              })
            } catch {
              /* best effort */
            }
            await trackStepComplete("deliver", undefined, true)
            requestStopAfterCurrentStep("delivery_budget_exhausted")
            return SubAgentProtocol.yieldResult({
              headline: `Delivery rejected and fix-runs budget exhausted (iteration=${iteration}, max_fix_runs=${fixBudget}). No more delivery_rework attempts; orchestrator MUST either: (a) call restart_from_stage(plan|executor) to change strategy, OR (b) call fail_task with a final summary explaining what went wrong.`,
              fields: [
                ["issues_found", rejectionIssues],
                ["iteration", String(iteration)],
                ["max_fix_runs", String(fixBudget)],
                ["agent_summary", verdict.summary],
              ],
              pointer: `verdict artifact ${verdictArtifactId}; budget exhausted, escalate or fail`,
            })
          }
          // Per-goal rejection slice: the delivery agent already attributed
          // each rejection_details[] entry to a specific goal_id; feed that
          // subset (plus the task-level summary) into startNewAttempt so the
          // executor's next prompt shows exactly what this goal must fix.
          // Without this, delivery_rework reworks ran against an unchanged
          // prompt (the root cause we're fixing here).
          for (const g of toReset) {
            const ownDetails = verdict.rejection_details.filter(
              (d) => d.goal_id === g.id,
            )
            const detailLines = ownDetails.map((d) => {
              const parts: string[] = [`[${d.category}] ${d.error}`]
              if (d.file) parts.push(`(file: ${d.file})`)
              if (d.suggestion) parts.push(`suggestion: ${d.suggestion}`)
              if (d.visual_spec_id) parts.push(`visual_spec: ${d.visual_spec_id}`)
              return `- ${parts.join(" ")}`
            })
            const value = [
              `Delivery agent rejected the integrated deliverable (iteration ${iteration}, agent_verdict=${verdict.verdict}).`,
              `Task-level summary: ${verdict.summary}`,
              `Issues attributed to this goal:`,
              ...detailLines,
            ].join("\n")
            const reason = `Delivery rejection; ${rejectionIssues.length} issue(s): ${rejectionIssues.slice(0, 3).join("; ")}`
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
              reason: rejectionIssues.join("; "),
            })
          } catch {
            /* best effort */
          }

          log.info("deliver: rejection opened new attempts", {
            taskID,
            iteration,
            issues: rejectionIssues.length,
            reset_goals: toReset.length,
            affected_goal_ids: rejectionAffectedGoalIDs,
          })

          requestStopAfterCurrentStep("delivery_rework")
          {
            const { dispatchTaskLoop } = await import("@/engine/queue")
            void dispatchTaskLoop({
              taskID,
              event: {
                note: OrchestratorEventNote.deliveryRework({
                  reason: "agent_verdict_rejected",
                  iteration,
                  summary: verdict.summary,
                }),
              },
            })
          }
          return SubAgentProtocol.yieldResult({
            headline: `Delivery rejected — iteration ${iteration}, agent_verdict=${verdict.verdict}, assistant must re-plan`,
            fields: [
              ["issues_found", rejectionIssues],
              ["iteration", String(iteration)],
              ["agent_summary", verdict.summary],
            ],
            pointer: `verdict artifact ${verdictArtifactId}; call query_metric_trajectory for full trajectory`,
          })
        } catch (err) {
          await trackStepComplete("deliver", undefined, true)

          const msg = err instanceof Error ? err.message : String(err)
          log.error("deliver: verification failed", { taskID, error: msg })
          // Delivery verification threw — infrastructure fault (network /
          // parse-retry exhaustion / tool crash). Write a snapshot for
          // trajectory visibility; do NOT run any deterministic arbiter
          // here. Give-up decisions belong to the orchestrator LLM — the
          // old `decisionErr.verdict === "abort" | "stalled"` branch was an
          // FSM over metric counts (CLAUDE.md rule 23) and is retired.
          const {
            computeIterationSnapshot: computeSnapshotErr,
          } = await import("@/metrics/score")
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
          writeSnapshotErr({ ...snapshotErr, arbiter_verdict: "continue" })

          // A throw carries no per-goal attribution — do NOT open new
          // attempts. Record the failure in the decision log and hand back
          // to the orchestrator LLM: it reads the trajectory on the next
          // turn and chooses build({ goalID }) / modify_goal / fail_task.
          try {
            const { createDecisionLog } = await import("@/decision-log")
            const decisionLog = createDecisionLog(taskID)
            decisionLog.append({
              phase: "delivery",
              key: `delivery_verification_threw_${iterationErr}`,
              value: `Delivery agent threw: ${msg}`,
              reason: `infrastructure fault (no verdict produced); iteration ${iterationErr}`,
            })
          } catch {
            /* best effort */
          }

          requestStopAfterCurrentStep("delivery_threw")
          return (
            `Delivery verification threw (not a structured rejection): ${msg}. ` +
            `Iteration ${iterationErr}. No goals were reset — the throw is an ` +
            `infrastructure fault and carries no per-goal attribution. Read the ` +
            `decision log entry delivery_verification_threw_${iterationErr} and ` +
            `decide: build({ goalID }) on a suspect goal, modify_goal if the contract ` +
            `looks wrong, or fail_task if the failure is fundamental.`
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

        // Stateless / unconditional — same intent as `deliver`. publish_delivery
        // has TWO physical preconditions (delivery row exists; verdict artifact
        // exists) — those stay because "you cannot publish what was never built
        // / never verified" is a physical fact, not a state-machine cache. The
        // "No active run" gate WAS state-machine-ish; lazy-bootstrap a run if
        // one is missing (the deliver call that produced the verdict already
        // does this, so in practice it always exists at this point).
        let run = findActiveRunForTask(task.id)
        if (!run && listGoals(task.id).length > 0) {
          const ensured = await ensureDispatchableRunForSingleGoal()
          if (!("error" in ensured)) run = ensured.run
        }
        if (!run) return "publish_delivery: no coordinator run for this task — call build (with a goal) or deliver first to materialise one."

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
          const verdictPayload = verdictArtifact.payload as
            | (import("@/delivery/agent").DeliveryVerdictType & { verdict: "accepted" | "rejected" })
            | null
          if (verdictPayload?.verdict) {
            updateEvaluationFromDeliveryVerdict({
              deliveryID: delivery.id,
              verdict: verdictPayload.verdict,
              summary: verdictPayload.summary ?? "Delivery agent verification",
              now: completed,
            })
          }

          const finalized = await EngineGit.complete(current, currentPlan, published)
          if (finalized.error) {
            await updateTask(current, { status: "failed", error: finalized.error, time_completed: completed }, finalized.error)
            return `Git finalization failed: ${finalized.error}`
          }
          const cleanedGoalWorkspaces = await cleanupTerminalGoalWorkspaces("publish_delivery")
          const cleanupNote = cleanedGoalWorkspaces > 0 ? ` ${cleanedGoalWorkspaces} goal worktree(s) cleaned.` : ""
          await updateTask(finalized.task, { status: "completed", error: null, time_completed: completed }, "Task completed")
          const { Plugin } = await import("@/plugin")
          await Plugin.trigger("delivery.ready", { taskID: task.id, runID: run.id, deliveryID: delivery.id }, { actions: [] }).catch(() => undefined)
          // Flush task learnings to memory (fire-and-forget). Bound by a
          // 30s timeout so a stuck Memory.write or LLM-backed digestor
          // can't keep the bun event loop busy after the task itself
          // finished publishing — observed leak when the parent process
          // was killed force-style and these orphan promises kept
          // running.
          const evaluation = findEvaluationByRun(run.id)
          Promise.race([
            EngineMemoryBridge.flushTaskLearnings({ task, run, delivery, evaluation, plan: currentPlan }),
            new Promise<void>((_, reject) => setTimeout(() => reject(new Error("flushTaskLearnings timeout (30s)")), 30_000)),
          ]).catch(err => log.warn("failed to flush task learnings", { error: String(err) }))

          // Auto-launch the deliverable if the delivery agent recorded a
          // launch command. `launch_command` exists only on AcceptedVerdict
          // (the discriminated-union accepted branch); a published delivery
          // is always accepted, but the verdict could nominally be malformed
          // — narrow defensively without coercion.
          const launchCmd = verdictPayload?.verdict === "accepted"
            ? verdictPayload.launch_command
            : undefined
          if (launchCmd) {
            try {
              const { Shell } = await import("@/shell/shell")
              const { Filesystem } = await import("@/util/filesystem")
              const projectDir = Filesystem.resolve(Instance.directory)
              const launched = await Shell.launch(launchCmd, { cwd: projectDir })
              const addrNote = launched.address ? ` — running at ${launched.address}` : ` (PID ${launched.pid})`
              log.info("deliverable launched", { pid: launched.pid, address: launched.address, command: launchCmd })
              return `Delivery published and task completed successfully.${cleanupNote} Deliverable launched${addrNote}.`
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              log.warn("auto-launch failed after publish", { error: msg, command: launchCmd })
              return `Delivery published and task completed successfully.${cleanupNote} Auto-launch failed: ${msg}. Launch manually with: ${launchCmd}`
            }
          }

          return `Delivery published and task completed successfully.${cleanupNote} You can call refine to analyze the project and suggest improvements for the next iteration.`
        }

        await updateTask(task, { status: "failed", error: result.summary, time_completed: completed }, result.summary)
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

        // Run refine analysis via SessionPrompt. No tools, plain text
        // generation driven by system + user prompts; the child session
        // persists transcript for the overlay.
        const model = await resolveAgentModel("orchestrator", { taskID })

        const refineSession = await Session.createNext({
          kind: "assistant",
          parentID: input.agentSessionID,
          title: `Refine: ${task.title}`,
          directory: Instance.directory,
        })

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

        let finalMessage: Awaited<ReturnType<typeof SessionPrompt.prompt>>
        try {
          finalMessage = await SessionPrompt.prompt({
            sessionID: refineSession.id,
            model: { providerID: model.providerID, modelID: model.api.id },
            agent: "assistant",
            system: systemPrompt,
            parts: [{ type: "text", text: userPrompt, id: Identifier.ascending("part") }],
          })
        } catch (err) {
          // Refine dispatch boundary — surface terminal to overlay so the
          // refine card flips out of `running` when this single dispatch
          // ends, mirroring agent/runner.ts.
          SessionStatus.set(refineSession.id, {
            type: "terminal",
            reason: "error",
            error: err instanceof Error ? err.message : String(err),
          })
          throw err
        }
        SessionStatus.set(refineSession.id, { type: "terminal", reason: "completed" })
        const resultText = (finalMessage?.parts ?? [])
          .filter((p) => p.type === "text" && typeof (p as any).text === "string")
          .map((p) => (p as any).text as string)
          .join("\n\n")

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
        "Timeout: 5 minutes; rejected questions throw an error you must handle.",
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
        "Implementation dispatcher. Runs the build agent (read / write / edit / bash) in-process to apply " +
        "one scoped change. Two valid shapes exist. `build({ goalID, request })` is the normal workflow " +
        "shape after architect has registered goals. `build({ request })` without goalID is valid only " +
        "when the task itself is explicit `kind=build`, or after a rejected delivery verdict when the " +
        "whole integrated tree needs rework. Fresh `kind=workflow` tasks MUST go through requirements / " +
        "architect before build, even if the request looks simple. " +
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
            "The prompt to feed the build agent. For kind=build tasks this can be the user's original request. For workflow rework calls, include the user's request PLUS a concise summary of the rejected delivery details the build agent must address.",
          ),
        reason: z
          .string()
          .describe(
            "One sentence explaining why this build is valid now: either explicit kind=build, per-goal pipeline execution, or post-delivery whole-task rework.",
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
        const isTaskLevelBuild = !attachedGoalID

        if (isTaskLevelBuild) {
          const eligibility = taskLevelBuildEligibility(task)
          if (!eligibility.allowed) {
            log.warn("build: task-level build rejected by task kind contract", {
              taskID,
              taskKind: task.kind,
              reason: eligibility.reason,
            })
            return `build: rejected task-level build. ${eligibility.reason}`
          }
          await switchExplicitBuildTaskToDirectWorkflow(attachedGoalID)
          await trackStepStart("build")
        }

        // Bootstrap-first gate: when the architect registered any
        // `kind: "bootstrap"` goal, that goal must reach `passed` (build +
        // deliver merged into primary) before any non-bootstrap goal may
        // dispatch. Rationale: bootstrap goals own scaffold files
        // (package.json / tsconfig / vite.config / src/main.* / src/App.*)
        // that every other goal would inevitably touch on a fresh worktree.
        // Running them in parallel produces guaranteed merge_back conflicts
        // on those scaffold files because each goal's worktree starts from
        // an un-scaffolded primary. Serialising bootstrap → fan-out is the
        // only architecture that avoids the conflict class.
        if (attachedGoalID) {
          const { findGoal: findGoalNow, listGoals: listGoalsNow } = await import("@/engine/store")
          const { goalStatusByID } = await import("@/engine/describe")
          const target = findGoalNow(attachedGoalID)
          if (target && target.kind !== "bootstrap") {
            const allGoals = listGoalsNow(taskID)
            const blocker = allGoals.find((g) => g.kind === "bootstrap" && goalStatusByID(g.id) !== "passed")
            if (blocker) {
              log.warn("build: bootstrap-first gate rejected non-bootstrap dispatch", {
                taskID,
                requestedGoal: attachedGoalID,
                requestedKind: target.kind,
                pendingBootstrap: blocker.id,
                pendingBootstrapStatus: goalStatusByID(blocker.id),
              })
              return (
                `build: rejected — goal ${attachedGoalID} (kind=${target.kind}) cannot dispatch ` +
                `while bootstrap goal ${blocker.id} (${blocker.title}) is in status ` +
                `"${goalStatusByID(blocker.id)}". Bootstrap goals own scaffold-level files ` +
                `(package.json / tsconfig / vite.config / src/main.* / src/App.*) that every ` +
                `other goal would re-scaffold on its own worktree. Run the bootstrap goal first ` +
                `(build → deliver → merged to primary), THEN dispatch feature / system / ` +
                `verification goals in parallel.`
              )
            }
          }
        }

        // Phase 5-c: delegate to BuildAgent.run. It owns the child session
        // (kind=build), creates an isolated worktree (parallel-safe for
        // multi-goal fan-out), gates concurrency via BuildSemaphore, and
        // returns a structured BuildResult the orchestrator can judge.
        //
        // For goalID path, build the structured BuildTarget from the DB row
        // so the agent receives acceptance_specs / owned_paths / depends_on
        // directly. For pure request path, the LLM-supplied `request` is
        // the user message.
        //
        // Coordinator Run lazy-create: the unified-teardown spec collapsed
        // dispatch_goal/create_run/exec_goal into this single `build` tool,
        // but stripped the run-creation step that dispatch_goal used to do.
        // Without a parent kind="run" artifact, deliver's
        // `findActiveRunForTask` short-circuits with "No active run", and
        // `listGoalRunsForRun` finds no goal_run_attempts (they were being
        // written with run_id=null). Restore the invariant: when build is
        // dispatched against a goal, ensure a coordinator Run exists for
        // this task so the goal_run_attempt + per-goal delivery artifacts
        // anchor to it (rule 22 — single source: build is the dispatcher,
        // build owns the run). Task-level (request-only) builds skip this;
        // they have no goal to bind to and deliver isn't part of that path.
        let coordinatorRunID: string | undefined
        if (attachedGoalID) {
          const ensured = await ensureDispatchableRunForSingleGoal()
          if ("error" in ensured) {
            if (isTaskLevelBuild) await trackStepComplete("build", undefined, true)
            return `build: cannot ensure coordinator run for goal ${attachedGoalID} — ${ensured.error}`
          }
          coordinatorRunID = ensured.run.id
        }

        try {
          const { BuildAgent } = await import("@/build/agent")
          const { Worktree } = await import("@/worktree")
          let target: import("@/build/types").BuildTarget
          let context: import("@/build/agent").BuildAgent.BuildContext | undefined
          let managedWorktree: import("@/build/agent").BuildAgent.RunInput["managedWorktree"] | undefined
          if (attachedGoalID) {
            const { findGoal, findRequirements, listGoals } = await import("@/engine/store")
            const goal = findGoal(attachedGoalID)
            if (!goal) {
              if (isTaskLevelBuild) await trackStepComplete("build", undefined, true)
              return `build: goal ${attachedGoalID} not found; register via architect first.`
            }
            const recordedWorkspaceDir = goal.workspace_dir?.trim()
            const recordedWorkspaceBranch = goal.workspace_branch?.trim()
            if (recordedWorkspaceDir || recordedWorkspaceBranch) {
              if (!recordedWorkspaceDir || !recordedWorkspaceBranch) {
                return (
                  `build: goal ${attachedGoalID} has inconsistent workspace metadata ` +
                  `(workspace_dir=${recordedWorkspaceDir || "null"}, ` +
                  `workspace_branch=${recordedWorkspaceBranch || "null"}). ` +
                  `This is a structural error; clean or reset the goal workspace explicitly.`
                )
              }
              const valid = await Worktree.isValid(recordedWorkspaceDir)
              if (!valid.valid) {
                return (
                  `build: recorded workspace for goal ${attachedGoalID} is invalid: ` +
                  `${recordedWorkspaceDir} (${valid.reason ?? "unknown reason"}). ` +
                  `No replacement worktree was created; reset the goal workspace explicitly.`
                )
              }
              managedWorktree = {
                directory: recordedWorkspaceDir,
                branch: recordedWorkspaceBranch,
                baseRef: goal.workspace_base_ref,
              }
            } else {
              const info = await Worktree.create({
                name: `goal-${goal.id.slice(-8)}`,
              })
              managedWorktree = {
                directory: info.directory,
                branch: info.branch,
                baseRef: null,
              }
              updateGoalWorkspace({
                goalID: goal.id,
                workspaceDir: info.directory,
                workspaceBranch: info.branch,
              })
            }
            const dependsOn = Array.isArray(goal.depends_on) ? (goal.depends_on as string[]) : []
            target = {
              kind: "goal",
              id: goal.id,
              title: goal.title,
              objective: request.trim().length > 0 ? request : goal.objective,
              acceptance_specs: Array.isArray(goal.acceptance_specs)
                ? (goal.acceptance_specs as Array<string | { description?: string }>).map((spec) =>
                    typeof spec === "string" ? spec : (spec.description ?? JSON.stringify(spec)),
                  )
                : [],
              owned_paths: Array.isArray(goal.owned_paths) ? (goal.owned_paths as string[]) : [],
              exports: Array.isArray(goal.exports) ? (goal.exports as string[]) : [],
              imports: Array.isArray(goal.imports) ? (goal.imports as string[]) : [],
              depends_on: dependsOn,
            }

            // ── Compose upstream context for the goal-path build (rule 23):
            //    requirements + architect contracts + dependency siblings +
            //    design specs + retry feedback. Each query is independent so
            //    a missing source (e.g. no active spec) gracefully degrades
            //    the corresponding section to undefined; the prompt renderer
            //    only emits the populated ones. ──────────────────────────
            const activeSpec = findActiveSpecForTask(task.id)
            const reqRows = activeSpec ? findRequirements(activeSpec.id) : []
            const requirements = reqRows.map((r) => {
              const meta = (r.metadata ?? {}) as Record<string, unknown>
              const sourceID = typeof meta.source_requirement_id === "string" ? meta.source_requirement_id : r.id
              return {
                id: sourceID,
                type: (r.priority === "advisory" ? "implicit" : "explicit") as "explicit" | "implicit",
                description: r.description,
              }
            })

            const { createDecisionLog } = await import("@/decision-log")
            const decisionLog = createDecisionLog(taskID)
            const archEntries = decisionLog.readByPhase("architect")
            const architectContracts = archEntries.map((e) => {
              const goalIDs = e.goalID ? [e.goalID] : []
              const titleMatch = e.value.match(/^##\s+(.+?)(?:\n|$)/)
              const title = titleMatch ? titleMatch[1].trim() : e.key
              const spec = titleMatch ? e.value.slice(titleMatch[0].length).trimStart() : e.value
              return { category: e.key, title, spec, goalIDs }
            })

            const dependencies = dependsOn.length > 0
              ? listGoals(taskID)
                  .filter((g) => dependsOn.includes(g.id))
                  .map((g) => ({
                    id: g.id,
                    title: g.title,
                    objective: g.objective,
                  }))
              : []

            const designSpecs = Array.isArray(task.design_specs)
              ? (task.design_specs as any)
              : undefined

            // Retry feedback from decision log (per-goal "retry" entries the
            // orchestrator wrote on prior delivery rejection).
            const retryEntries = decisionLog.readByPhase("retry").filter((e) => e.goalID === goal.id)
            const retryFeedback = retryEntries.length > 0
              ? [
                  "## Prior Attempt Failed — Read This Before Implementing",
                  "",
                  "The previous attempt was rejected. The worktree still has those files; edit in place rather than start from scratch unless the failure forces a structural rewrite.",
                  "",
                  "### Coordinator Root-Cause + Delivery Rejection",
                  ...retryEntries.map((e) => `- ${e.value}${e.reason ? ` — _why: ${e.reason}_` : ""}`),
                  "",
                  "### Required For This Retry",
                  "- Address each rejection above before changing anything else.",
                  "- Do NOT repeat an approach that was already tried and rejected.",
                  "- If the root cause sits outside owned_paths, surface it as a SCOPE BLOCKER instead of widening scope.",
                ].join("\n")
              : undefined

            // Visual feedback closure-loop: when delivery rejected on visual
            // grounds, attach the previous rendered.png so the build LLM
            // physically compares its output to the user reference instead of
            // re-painting from text alone. The path is the same one the
            // delivery service writes via runtime-evidence.
            let retryAttachments: import("@/build/agent").BuildAgent.BuildContext["retryAttachments"]
            if (retryEntries.length > 0) {
              try {
                const fsMod = await import("node:fs/promises")
                const pathMod = await import("node:path")
                const renderedPath = pathMod.join(
                  Instance.directory,
                  ".opencorvus",
                  "delivery-hard-gate",
                  taskID,
                  "rendered.png",
                )
                const stat = await fsMod.stat(renderedPath).catch(() => undefined)
                if (stat?.isFile()) {
                  const bytes = await fsMod.readFile(renderedPath)
                  retryAttachments = [{
                    url: `data:image/png;base64,${bytes.toString("base64")}`,
                    mime: "image/png",
                    filename: "previous-attempt-rendered.png",
                  }]
                }
              } catch {
                /* best-effort: missing rendered.png is not fatal — retry feedback text still drives the rework */
              }
            }

            context = {
              requirements: requirements.length > 0 ? requirements : undefined,
              architectContracts: architectContracts.length > 0 ? architectContracts : undefined,
              dependencies: dependencies.length > 0 ? dependencies : undefined,
              designSpecs,
              retryFeedback,
              retryAttachments,
            }
          } else {
            target = { kind: "request", text: request }
          }

          // Open the goal_run BEFORE handing off to BuildAgent.run so the
          // overlay's goal step card materializes at dispatch time (lazy
          // gate: `goalWorkflows[i].steps[build].startedAt > 0`). Without
          // this, the row only existed post-completion (single insert with
          // time_started == time_completed), so the card spawned already-
          // finished. Goal-path only — direct/request builds have no goal
          // row to attach an attempt to.
          let goalRunID: string | undefined
          if (attachedGoalID) {
            try {
              const { beginBuildAttempt } = await import("@/engine/persist")
              goalRunID = beginBuildAttempt({
                taskID,
                goalID: attachedGoalID,
                runID: coordinatorRunID,
                workspaceDir: managedWorktree?.directory,
              })
            } catch (beginErr) {
              // A failure here is structural — overlay won't get the
              // running card and finalizeBuildAttempt has nothing to
              // update. Surface and let the dispatch fail rather than
              // silently degrade to the old "appear at completion" UX.
              log.error("build: beginBuildAttempt failed", {
                taskID, goalID: attachedGoalID,
                error: beginErr instanceof Error ? beginErr.message : String(beginErr),
              })
              throw beginErr
            }
          }

          // BuildAgent.run reserves thrown errors for infrastructure faults
          // (model unavailable, worktree creation failed, session stream
          // error — the G4 TLS-mid-stream class). Before this try/finally,
          // a thrown error skipped finalizeBuildAttempt entirely, leaving
          // the goal_run in attempt-running forever (see incident report
          // tsk_ddc529dfd0011ajJTgBqdlroyk G4 in
          // specs/new-arch/2026-04-30-llm-activity-redesign.md). Step 4
          // closes that gap by ALWAYS finalising the goal_run when one
          // was opened, with status derived from the BuildAgent outcome
          // or, on throw, from the underlying error class.
          let buildOutcome:
            | { kind: "ok"; result: Awaited<ReturnType<typeof BuildAgent.run>> }
            | { kind: "throw"; error: unknown }
          try {
            const ok = await BuildAgent.run({
              target,
              task,
              context,
              parentSessionID: input.agentSessionID,
              signal: input.signal,
              managedWorktree,
            })
            buildOutcome = { kind: "ok", result: ok }
          } catch (runErr) {
            buildOutcome = { kind: "throw", error: runErr }
          }

          if (buildOutcome.kind === "ok") {
            const { worktreeDir, worktreeBranch, worktreeBaseRef } = buildOutcome.result
            if (attachedGoalID && worktreeDir && worktreeBranch) {
              updateGoalWorkspace({
                goalID: attachedGoalID,
                workspaceDir: worktreeDir,
                workspaceBranch: worktreeBranch,
                workspaceBaseRef: worktreeBaseRef,
              })
            }
          }

          // Finalize the goal_run opened above. updateGoalRun writes a new
          // append-only artifact with the terminal status + time_completed,
          // and finalizeBuildAttempt also lays down the per-goal delivery
          // artifact when the build passed with concrete diffs (overlay's
          // right-side Files panel reads it via findDeliveryByGoalRun).
          // For the throw branch we synthesise a failed finalisation from
          // the underlying error message — diffs/commit/summary are absent
          // by definition, but the goal_run row reaches a clean terminal
          // state instead of orphaning at attempt-running.
          if (attachedGoalID && goalRunID) {
            try {
              const { finalizeBuildAttempt } = await import("@/engine/persist")
              if (buildOutcome.kind === "ok") {
                const { result, sessionID, worktreeDir, diffs } = buildOutcome.result
                finalizeBuildAttempt({
                  goalRunID,
                  taskID,
                  goalID: attachedGoalID,
                  runID: coordinatorRunID,
                  status: result.status === "passed" ? "completed" : "failed",
                  commitRef: result.commit_ref,
                  workspaceDir: worktreeDir,
                  error: result.status === "failed" ? result.error : undefined,
                  diffs,
                  summary: result.summary,
                })
                // Backfill session_id on the goal_run now that BuildAgent.run
                // has assigned one. Routing keys on goalID, but downstream
                // tracing (orphan detection, audit) expects session_id on the
                // tip artifact. updateGoalRun's append model handles this.
                if (sessionID) {
                  const { updateGoalRun } = await import("@/engine/persist")
                  updateGoalRun(goalRunID, { session_id: sessionID })
                }
              } else {
                const errMsg =
                  buildOutcome.error instanceof Error
                    ? `${buildOutcome.error.name}: ${buildOutcome.error.message}`
                    : String(buildOutcome.error)
                finalizeBuildAttempt({
                  goalRunID,
                  taskID,
                  goalID: attachedGoalID,
                  runID: coordinatorRunID,
                  status: "failed",
                  workspaceDir: managedWorktree?.directory,
                  error: errMsg,
                  summary: `BuildAgent.run threw before producing a verdict: ${errMsg.slice(0, 240)}`,
                })
              }
            } catch (persistErr) {
              // Failing to record the attempt does NOT abort the build —
              // the LLM still gets the tool_result text. Log loudly so
              // it's visible during benchmarks; if persists are silently
              // dropped the orchestrator will see the goal as still pending
              // on its next wake and decide what to do.
              log.error("build: finalizeBuildAttempt failed", {
                taskID, goalID: attachedGoalID,
                error: persistErr instanceof Error ? persistErr.message : String(persistErr),
              })
            }
          }

          // If BuildAgent.run threw, surface the original error to the caller
          // AFTER the goal_run is finalised. The throw shape is preserved so
          // the orchestrator's existing tool-error / wake-loop logic isn't
          // disturbed — only the persistent state was previously orphaned.
          if (buildOutcome.kind === "throw") {
            throw buildOutcome.error
          }
          const { result, sessionID, worktreeDir } = buildOutcome.result
          // diffs is captured by the surrounding scope's destructure for the
          // ok-branch report rendering below; pull it back out for clarity.
          const diffs = buildOutcome.result.diffs

          if (isTaskLevelBuild) await trackStepComplete("build")

          // Build session terminal flows through session.status when
          // BuildAgent.run's underlying actor closes. The structured build
          // report below is the orchestrator-facing tool result.

          // Build does NOT mark the task complete — deliver must accept.
          // Return the structured payload so the orchestrator can judge
          // whether build actually addressed the prior rejection before
          // re-dispatching (avoids the build/deliver death spiral).
          const testLines = result.tests.length > 0
            ? result.tests.map((t) => `  - ${t.passed ? "✓" : "✗"} ${t.name}${t.detail ? `: ${t.detail}` : ""}`).join("\n")
            : "  (none reported)"
          const commitLine = result.commit_ref ? `- commit_ref: ${result.commit_ref}` : "- commit_ref: (none)"
          const errorLine = result.status === "failed" ? `\n- error: ${result.error}` : ""
          const worktreeLine = worktreeDir ? `\n- worktreeDir: ${worktreeDir}` : ""
          return (
            `Build agent finished (status=${result.status}, session ${sessionID}).\n\n` +
            `### Build report\n` +
            `- summary: ${result.summary}\n` +
            `- patch_summary: ${result.patch_summary || "(empty)"}\n` +
            `${commitLine}${errorLine}${worktreeLine}\n` +
            `- tests:\n${testLines}\n\n` +
            `### Next step\n` +
            `Call \`deliver\` to run the adversarial verification + Arbiter.\n` +
            `If the Arbiter rejects, compare this report against the rejection_details — ` +
            `did build actually address the cited issues? If yes but deliver still rejects, ` +
            `the goal contract may need modify_goal. If no, call build again with more specific ` +
            `instructions citing what was missed (re-invoking build with the same prompt is a ` +
            `deadlock; iteration budget will terminate the task).`
          )
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log.error("build tool failed", { taskID, error: msg })
          if (isTaskLevelBuild) await trackStepComplete("build", undefined, true)
          // Build itself failed (LLM error, tool guard fault, worktree
          // creation failed, etc.) — distinct from deliver-rejection.
          // Surface the error so the orchestrator decides (retry / fail_task).
          // Card terminal flows through session.status from the build
          // agent's actor close path.
          throw err
        }
      },
    }),
  }

  // Phase 5-g: the deprecated dispatch tools (dispatch_goal / exec_goal /
  // submit_execution / retry_goal / create_run) that the 5-c filter hid
  // from the LLM are now fully deleted. Build is the single dispatch tool.
  return {
    tools,
    stopSignal: stopAfterDispatch.signal,
    finalizeDeferredStop,
  }
}
