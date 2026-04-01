/**
 * Task Agent tools — AI SDK tool() definitions wrapping existing services.
 *
 * Created per-task via createTaskAgentTools({ taskID }).
 * The taskID is captured in the closure — no global registry needed.
 */
import { tool } from "ai"
import z from "zod"
import { SpecService } from "@/spec/service"
import { PlannerService } from "@/planner/service"
import { HeadlessGoalAgent } from "@/goal/agent"
import { GoalFidelityReview, applyGoalCorrections } from "@/goal/fidelity-review"
import { validateGoalGraph } from "@/goal/service"
import { selectorList } from "@/check/policy"
import { EvaluatorService, type EvaluationTier } from "@/evaluator/service"
import { EvaluatorAgent } from "@/evaluator/agent"
import { DeliveryService } from "@/delivery/service"
import { mergeTextHooks } from "@/llm/tool-hooks"
import { Session } from "@/session"
import { Database, eq, and } from "@/storage/db"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { createInactivityGuard } from "@/util/inactivity-guard"
import { registerGoalRunSession } from "@/server/routes/task-event"
import { Publisher } from "./publisher"
import { OrchestratorGit } from "./git"
import { OrchestratorMemoryBridge } from "./memory-bridge"
import { agentStream } from "./agent-stream"
import { sessionStreamHooks } from "./session-stream"
import { withStageRetry } from "./strategy"
import { suppressClarifications, unattendedProject } from "./unattended"
import { plannerClarification } from "./planner-clarification"
import { writeSpec } from "./spec"
import { writeGoalSnapshot, writePlanSnapshot, writePrdSnapshot } from "./docs"
import { Event as OrchestratorEvent } from "./model"
import { OrchestratorConfig } from "./config"
import { OrchestratorProtocol } from "./protocol"
import {
  OrchestratorPlanVersionTable,
  OrchestratorRunTable,
  OrchestratorTaskTable,
  OrchestratorArtifactTable,
} from "./orchestrator.sql"
import {
  createFixRun,
  insertPlanItems,
  markDeliveryPublishing,
  finalizeDeliveryResult,
  persistEvaluation,
  persistGoalSnapshot,
  persistSpecSnapshot,
} from "./persist"
import {
  findDeliveryByRun,
  findEvaluationByRun,
  findPlan,
  findRequirements,
  findRuns,
  findSpecSnapshot,
  listGoals,
  listGoalsForPlan,
  listGoalsByPlan,
  listMilestonesByPlan,
  requireRun,
  requireTask,
} from "./store"
import { updateTask } from "./state"
import { DEFAULT_MAX_RUNS, DEFAULT_MAX_FIX_RUNS, type FixContext } from "./helpers"
import { Plugin } from "@/plugin"

const log = Log.create({ service: "task-tools" })

// ---------------------------------------------------------------------------
// Helpers (from pipeline.ts)
// ---------------------------------------------------------------------------

function stageTimeout(stage: "spec" | "goal" | "plan"): number {
  const env = { spec: "OPENCORVUS_SPEC_TIMEOUT_MS", goal: "OPENCORVUS_GOAL_TIMEOUT_MS", plan: "OPENCORVUS_PLAN_TIMEOUT_MS" }
  const defaults = { spec: 300_000, goal: 180_000, plan: 300_000 }
  return parseInt(process.env[env[stage]] || String(defaults[stage]), 10)
}

function requirementLinks(rows: Array<{ id: string; title: string; priority: string; metadata?: Record<string, unknown> | null }>) {
  return rows.map((row) => ({
    id: row.id,
    sourceRequirementID: row.metadata && typeof row.metadata.source_requirement_id === "string" ? row.metadata.source_requirement_id : row.id,
    title: row.title,
    priority: row.priority as "blocking" | "advisory",
  }))
}

function reconstructSpecFromDB(specSnapshotID: string) {
  const snapshot = findSpecSnapshot(specSnapshotID)
  if (!snapshot) return undefined
  const requirements = findRequirements(specSnapshotID).map((item) => ({
    id: item.metadata && typeof item.metadata.source_requirement_id === "string" ? item.metadata.source_requirement_id : item.id,
    title: item.title,
    description: item.description,
    priority: item.priority as "blocking" | "advisory",
    acceptance: parseAcceptance(item.acceptance, item.description),
    evidence_refs: item.evidence_refs ?? [],
  }))
  return {
    summary: snapshot.summary, content: snapshot.content, requirements,
    assumptions: Array.isArray(snapshot.metadata?.assumptions) ? snapshot.metadata.assumptions : [],
    risks: Array.isArray(snapshot.metadata?.risks) ? snapshot.metadata.risks : [],
    clarifications: [], scope: snapshot.scope,
    out_of_scope: snapshot.out_of_scope ?? undefined,
    evidence_sources: Array.isArray(snapshot.evidence) ? snapshot.evidence : [],
    unresolved_questions: Array.isArray(snapshot.metadata?.unresolved_questions) ? snapshot.metadata.unresolved_questions : [],
  }
}

function parseAcceptance(raw: unknown, fallback: string): string[] {
  if (Array.isArray(raw)) return raw
  if (typeof raw === "string") {
    if (raw.trimStart().startsWith("[")) {
      try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) return parsed } catch { /* malformed */ }
    }
    return [raw]
  }
  return [fallback]
}

function ensureRequirements(specDraft: any): any {
  if (Array.isArray(specDraft.requirements) && specDraft.requirements.length > 0) return specDraft
  const specItems = specDraft.spec_items
  if (Array.isArray(specItems) && specItems.length > 0) {
    const requirements = specItems.flatMap((item: any, i: number) => {
      if (!item || typeof item !== "object") return []
      const title = typeof item.title === "string" ? item.title : ""
      const description = typeof item.description === "string" ? item.description : ""
      if (!title && !description) return []
      return [{
        id: `req_${i + 1}`, title: title || `Requirement ${i + 1}`,
        description: description || title, acceptance: [description || title],
        evidence_refs: [] as string[],
        priority: (item.priority === "advisory" ? "advisory" : "blocking") as "blocking" | "advisory",
      }]
    })
    if (requirements.length > 0) return { ...specDraft, requirements }
  }
  throw new Error("Spec agent produced no requirements and no spec_items.")
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createTaskAgentTools(input: { taskID: string; agentSessionID: string; signal?: AbortSignal }) {
  const { taskID } = input

  return {
    analyze_requirements: tool({
      description: "Deep-analyze the task requirements against the codebase using the Spec Agent. Creates a structured specification with requirements, scope, and acceptance criteria. Use for complex or ambiguous tasks.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to analyze requirements"),
      }),
      execute: async () => {
        let task = requireTask(taskID)
        task = await updateTask(task, { status: "spec_generating" }, "Spec generation started")
        const guard = createInactivityGuard(stageTimeout("spec"), () => {
          log.warn("spec stage inactivity timeout", { taskID })
        })
        try {
          const unattended = await unattendedProject()
          const specLive = agentStream({ taskID, stage: "spec" })
          const specSession = await Session.createNext({
            parentID: input.agentSessionID,
            title: `Spec: ${task.title}`,
            directory: Instance.directory,
          })
          registerGoalRunSession(specSession.id, taskID)
          const hooks = sessionStreamHooks({ sessionID: specSession.id, taskID, stage: "spec" })
          await specLive.start("Spec generation started")

          const rawSpecDraft = await withStageRetry("spec", () =>
            SpecService.initial({
              title: task.title,
              request: task.request,
              goals: (task.metadata?._pipeline as any)?.goals,
              sessionID: specSession.id,
              signal: input.signal,
              stream: {
                onChunk: async (arg: any) => { guard.bump(); if (hooks.onChunk) await hooks.onChunk(arg); if (specLive.hooks.onChunk) await specLive.hooks.onChunk(arg) },
                onError: async (arg: any) => { if (hooks.onError) await hooks.onError(arg); if (specLive.hooks.onError) await specLive.hooks.onError(arg) },
              },
            }),
            { signal: input.signal },
          )
          await hooks.flush()
          await specLive.finish("Spec generation finished")

          const specDraft = ensureRequirements(unattended ? suppressClarifications(rawSpecDraft) : rawSpecDraft)
          const specSnapshotID = Identifier.ascending("spec")
          Database.transaction((db) => {
            persistSpecSnapshot(db, { taskID, specSnapshotID, version: 1, specDraft, now: Date.now() })
            db.update(OrchestratorTaskTable)
              .set({ active_spec_version_id: specSnapshotID, time_updated: Date.now() })
              .where(eq(OrchestratorTaskTable.id, taskID))
              .run()
            Database.effect(() =>
              OrchestratorProtocol.emit(OrchestratorEvent.SpecCreated, { taskID, specID: specSnapshotID, summary: specDraft.summary }, { source: "task-agent.spec" }),
            )
          })
          const reqCount = specDraft.requirements?.length ?? 0
          return `Spec created (${reqCount} requirements). Summary: ${specDraft.summary}`
        } finally {
          guard.clear()
        }
      },
    }),

    decompose_goals: tool({
      description: "Decompose the task specification into concrete, verifiable goals with dependencies. Requires spec to exist (run analyze_requirements first).",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to decompose goals"),
      }),
      execute: async () => {
        let task = requireTask(taskID)
        const existingGoals = listGoals(taskID)
        if (existingGoals.length > 0) return `${existingGoals.length} goals already defined. Skipping.`
        if (!task.active_spec_version_id) return "No spec found. Run analyze_requirements first."
        const specDraft = reconstructSpecFromDB(task.active_spec_version_id)
        if (!specDraft) return "Failed to load spec from DB."

        task = await updateTask(task, { status: "goal_decomposing" }, "Goal decomposition started")
        const pipeline = task.metadata?._pipeline as any
        const guard = createInactivityGuard(stageTimeout("goal"), () => { log.warn("goal stage timeout", { taskID }) })
        try {
          const goalLive = agentStream({ taskID, stage: "goal" })
          const goalSession = await Session.createNext({ parentID: input.agentSessionID, title: `Goals: ${task.title}`, directory: Instance.directory })
          registerGoalRunSession(goalSession.id, taskID)
          const hooks = sessionStreamHooks({ sessionID: goalSession.id, taskID, stage: "goal" })
          await goalLive.start("Goal decomposition started")

          const reviewed = await withStageRetry("goal", async () => {
            const draft = await HeadlessGoalAgent.initial({
              title: task.title, request: task.request, spec: specDraft,
              goalHints: pipeline?.goals, sessionID: goalSession.id, signal: input.signal,
              stream: {
                onChunk: async (arg: any) => { guard.bump(); if (hooks.onChunk) await hooks.onChunk(arg); if (goalLive.hooks.onChunk) await goalLive.hooks.onChunk(arg) },
                onError: async (arg: any) => { if (hooks.onError) await hooks.onError(arg); if (goalLive.hooks.onError) await goalLive.hooks.onError(arg) },
              },
              onStatus: goalLive.statusHook.bind(goalLive),
            })
            if (!draft) throw new Error("Goal decomposition produced no result")
            let result = draft
            if (draft.goals.length > 0 && Array.isArray(specDraft.requirements) && specDraft.requirements.length > 0) {
              const review = await GoalFidelityReview.run({ request: task.request, spec: specDraft, goalDraft: draft, sessionID: pipeline?.sessionID ?? task.session_id!, metadata: task.metadata ?? undefined, timeoutMs: 120_000, signal: input.signal })
              if (review.verdict === "needs_correction") result = applyGoalCorrections(draft, review)
            }
            validateGoalGraph(result, specDraft)
            return result
          }, { signal: input.signal })
          await hooks.flush()
          await goalLive.finish("Goal decomposition finished")

          const specSnapshotID = task.active_spec_version_id!
          const goalSnapshotID = Identifier.ascending("goal_snapshot")
          const goalNow = Date.now()
          Database.transaction((db) => {
            persistGoalSnapshot(db, { taskID, specSnapshotID, goalSnapshotID, version: 1, goalDraft: reviewed, requirements: requirementLinks(findRequirements(specSnapshotID)), now: goalNow })
            // Update task.time_updated to invalidate board cache + emit event for overlay refresh
            db.update(OrchestratorTaskTable).set({ time_updated: goalNow }).where(eq(OrchestratorTaskTable.id, taskID)).run()
            Database.effect(() =>
              OrchestratorProtocol.emit(OrchestratorEvent.TaskUpdated, { taskID, status: task.status, summary: "Goals defined" }, { source: "task-agent.goal" }),
            )
          })
          return `${reviewed.goals?.length ?? 0} goals created from spec.`
        } finally {
          guard.clear()
        }
      },
    }),

    create_plan: tool({
      description: "Create an execution plan from spec and goals, then create a run record. Returns the runID needed for submit_execution.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to create a plan"),
      }),
      execute: async () => {
        let task = requireTask(taskID)
        if (!task.active_spec_version_id) return "No spec found. Run analyze_requirements first."
        const dbGoals = listGoals(taskID)
        if (dbGoals.length === 0) return "No goals found. Run decompose_goals first."
        const pipeline = task.metadata?._pipeline as any
        let specDraft: any = reconstructSpecFromDB(task.active_spec_version_id)
        const persistedGoals = dbGoals.map(g => ({ id: g.id, description: g.description, criteria: g.criteria, priority: g.priority, metadata: g.metadata ?? undefined }))
        task = await updateTask(task, { status: "planning" }, "Planning started")

        const guard = createInactivityGuard(stageTimeout("plan"), () => { log.warn("plan stage timeout", { taskID }) })
        try {
          const unattended = await unattendedProject()
          const plannerGoals = persistedGoals.map(g => ({
            description: g.description, criteria: g.criteria, priority: g.priority as "blocking" | "advisory" | undefined,
            ...(g.metadata?.title ? { title: g.metadata.title as string } : {}),
            ...(g.metadata?.objective ? { objective: g.metadata.objective as string } : {}),
            ...(g.metadata?.requirement_ids ? { requirement_ids: g.metadata.requirement_ids as string[] } : {}),
            ...(g.metadata?.depends_on_goal_ids ? { depends_on_goal_ids: g.metadata.depends_on_goal_ids as string[] } : {}),
            ...(g.metadata?.owned_paths ? { owned_paths: g.metadata.owned_paths as string[] } : {}),
            ...(g.metadata?.done_definition ? { done_definition: g.metadata.done_definition as string } : {}),
            ...(g.metadata?.qa_profile ? { qa_profile: g.metadata.qa_profile as any } : {}),
            ...(g.metadata?.kind ? { kind: g.metadata.kind as any } : {}),
          }))
          const planLive = agentStream({ taskID, stage: "planner" })
          const planSession = await Session.createNext({ parentID: input.agentSessionID, title: `Plan: ${task.title}`, directory: Instance.directory })
          registerGoalRunSession(planSession.id, taskID)
          const hooks = sessionStreamHooks({ sessionID: planSession.id, taskID, stage: "planner" })
          await planLive.start("Planner started")

          const orchCfg = await OrchestratorConfig.get()
          const adaptiveMaxSteps = orchCfg.adaptive.enabled && plannerGoals.length > 0
            ? orchCfg.adaptive.planner_shortcut_max_steps
            : undefined

          let planDraft = await withStageRetry("plan", () =>
            PlannerService.initial({
              title: task.title, request: task.request, spec: specDraft, goals: plannerGoals,
              goalsFromGoalAgent: true,
              maxSteps: adaptiveMaxSteps,
              allowClarification: !unattended, executor: pipeline?.executor as any, routing: pipeline?.routing,
              sessionID: planSession.id, signal: input.signal,
              stream: {
                onChunk: async (arg: any) => { guard.bump(); if (hooks.onChunk) await hooks.onChunk(arg); if (planLive.hooks.onChunk) await planLive.hooks.onChunk(arg) },
                onError: async (arg: any) => { if (hooks.onError) await hooks.onError(arg); if (planLive.hooks.onError) await planLive.hooks.onError(arg) },
              },
            }),
            { signal: input.signal },
          )
          await hooks.flush()
          await planLive.finish("Planner finished")

          if (unattended) {
            const c = plannerClarification(planDraft)
            if (c) planDraft = { ...planDraft, metadata: { ...planDraft.metadata, clarification: undefined, planner: planDraft.metadata?.planner ? { ...planDraft.metadata.planner, clarification_source: "suppressed" as const } : { role: "headless_compiler" as const, quality: "compiled" as const, source: "planner_agent" as const, clarification_source: "suppressed" as const } } }
          }

          const specSnapshotID = task.active_spec_version_id!
          const content = specDraft?.content
          const specMeta = typeof content === "string" ? writeSpec({ taskID, title: task.title, content, summary: specDraft?.summary ?? planDraft.summary, createdAt: Date.now() }) : undefined
          const planMetadata = { ...(task.metadata ?? {}), ...planDraft.metadata, ...(specMeta ? { spec: { ...specMeta, source: specMeta.source ?? planDraft.metadata?.spec?.source } } : {}) }

          const planID = Identifier.ascending("plan")
          const runID = Identifier.ascending("run")
          const now = Date.now()
          const clarification = plannerClarification(planDraft)
          const executor = pipeline?.executor ?? "opencode"
          const sessionID = pipeline?.sessionID ?? task.session_id!

          Database.transaction((db) => {
            db.update(OrchestratorTaskTable).set({ active_plan_version_id: planID, active_run_id: runID, status: "planned", time_updated: now }).where(eq(OrchestratorTaskTable.id, taskID)).run()
            db.insert(OrchestratorPlanVersionTable).values({ id: planID, task_id: taskID, spec_snapshot_id: specSnapshotID || null, version: 1, status: "active", summary: planDraft.summary, prompt: planDraft.prompt, metadata: planMetadata, time_created: now, time_updated: now }).run()
            insertPlanItems(db, { taskID, planID, goals: persistedGoals as any, planDraft, now, milestones: (pipeline?.milestones ?? []) as any })
            db.insert(OrchestratorRunTable).values({ id: runID, task_id: taskID, plan_version_id: planID, session_id: sessionID, executor, status: clarification ? "blocked" : "queued", phase: "dispatch", retry_count: 0, metadata: {}, time_created: now, time_updated: now }).run()
            Database.effect(() => OrchestratorProtocol.emit(OrchestratorEvent.PlanCreated, { taskID, planID, summary: planDraft.summary }, { source: "task-agent.plan" }))
            Database.effect(() => OrchestratorProtocol.emit(OrchestratorEvent.PlanActivated, { taskID, planID, summary: "Plan activated" }, { source: "task-agent.plan" }))
            Database.effect(() => OrchestratorProtocol.emit(OrchestratorEvent.RunCreated, { taskID, runID, status: "queued", summary: "Run queued" }, { source: "task-agent.plan" }))
          })

          try {
            writePrdSnapshot({ task: { id: taskID, title: task.title, request: task.request }, plan: { id: planID, version: 1, summary: planDraft.summary, metadata: planMetadata }, createdAt: now })
            writePlanSnapshot({ task: { id: taskID, title: task.title, request: task.request }, plan: { id: planID, version: 1, summary: planDraft.summary, prompt: planDraft.prompt, metadata: planMetadata }, createdAt: now })
            const p = findPlan(planID)
            writeGoalSnapshot({ task: { id: taskID, title: task.title, request: task.request }, plan: { id: planID, version: 1, summary: planDraft.summary }, goals: p ? listGoalsForPlan(p) : [], milestones: listMilestonesByPlan(planID), createdAt: now })
          } catch { /* non-critical */ }

          return `Plan created. runID=${runID}. Summary: ${planDraft.summary}. Call submit_execution with this runID.`
        } finally {
          guard.clear()
        }
      },
    }),

    submit_execution: tool({
      description: "Submit the planned run to an executor. After this, the executor works asynchronously. You MUST stop after this call — you will be re-triggered when execution completes.",
      inputSchema: z.object({
        runID: z.string().describe("The run ID from create_plan output"),
      }),
      execute: async ({ runID }) => {
        const { OrchestratorRuntime } = await import("./runtime")
        const { hooks } = await import("./state")
        await OrchestratorRuntime.dispatch(runID, hooks())
        return `Run ${runID} submitted to executor. Execution running asynchronously. STOP HERE.`
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

    create_fix_run: tool({
      description: "Create a new executor run to fix issues found by eval or delivery. Provide a clear error summary and fix guidance so the executor knows exactly what to fix. After calling this, STOP — the executor runs asynchronously.",
      inputSchema: z.object({
        error_summary: z.string().describe("What failed and why — be specific about which checks failed or what the delivery agent rejected"),
        fix_guidance: z.string().describe("Specific guidance for the executor on how to fix the issues"),
      }),
      execute: async ({ error_summary, fix_guidance }) => {
        const task = requireTask(taskID)
        const run = task.active_run_id ? requireRun(task.active_run_id) : undefined
        if (!run) return "No active run to fix. Use create_plan + submit_execution instead."

        // Budget check
        const totalRuns = findRuns(task.id).length
        const maxRuns = task.budget?.max_runs ?? DEFAULT_MAX_RUNS
        if (totalRuns >= maxRuns) {
          return `Run budget exhausted (${totalRuns}/${maxRuns}). Call fail_task instead.`
        }
        const maxFixRuns = task.budget?.max_fix_runs ?? DEFAULT_MAX_FIX_RUNS
        if (run.retry_count >= maxFixRuns) {
          return `Fix run budget exhausted (${run.retry_count}/${maxFixRuns}). Call fail_task instead.`
        }

        // Build fix context from eval/delivery results + agent guidance
        const delivery = findDeliveryByRun(run.id)
        const evaluation = findEvaluationByRun(run.id)
        const fixContext: FixContext = {
          source: "eval_failure",
          rootCause: error_summary,
          suggestedStrategy: fix_guidance,
          deliverySummary: delivery?.summary ?? undefined,
          changedFiles: delivery?.result?.changed_files as string[] | undefined,
          checks: (evaluation?.checks as Array<{ name: string; status: string; evidence: string }>) ?? undefined,
        }
        const nextRunID = createFixRun(task, run, error_summary, fixContext)
        const { OrchestratorRuntime } = await import("./runtime")
        const { hooks } = await import("./state")
        await OrchestratorRuntime.dispatch(nextRunID, hooks())
        return `Fix run ${nextRunID} created and dispatched. STOP HERE — the executor is now running.`
      },
    }),

    restart_from_stage: tool({
      description: "Restart the task from a specific stage. Use when the current approach is fundamentally wrong, the user requests a restart, or you need to redo spec/goal/plan from scratch.",
      inputSchema: z.object({
        stage: z.enum(["spec", "goal", "plan", "executor"]).describe("Which stage to restart from"),
        reason: z.string().describe("Why restarting from this stage"),
      }),
      execute: async ({ stage, reason }) => {
        const task = requireTask(taskID)
        const statusMap: Record<string, string> = {
          spec: "queued",
          goal: "queued",
          plan: "queued",
          executor: "planned",
        }
        const targetStatus = statusMap[stage] as any
        await updateTask(task, { status: targetStatus, error: null, blocking_reason: null }, `Restart from ${stage}: ${reason}`)
        return `Task restarted from ${stage} stage. Reason: ${reason}. Continue with the appropriate tool (analyze_requirements for spec, decompose_goals for goal, create_plan for plan, submit_execution for executor).`
      },
    }),

    // -----------------------------------------------------------------------
    // Agent Team tools — Task Agent controls eval, delivery verify, publish
    // -----------------------------------------------------------------------

    run_eval: tool({
      description: "Run evaluation checks on the active run's delivery. Returns structured check results so you can decide whether to proceed, create a fix run, or fail the task.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to run eval now"),
      }),
      execute: async () => {
        const task = requireTask(taskID)
        const run = task.active_run_id ? requireRun(task.active_run_id) : undefined
        if (!run) return "No active run. Create a plan and submit execution first."
        const delivery = findDeliveryByRun(run.id)
        if (!delivery) return "No delivery found for this run. The executor may not have completed yet."

        // Check if evaluation already exists
        const existing = findEvaluationByRun(run.id)
        if (existing) {
          const checks = Array.isArray(existing.checks) ? (existing.checks as Array<{ name: string; status: string; evidence?: string }>) : []
          const lines = [`Evaluation already exists: ${existing.verdict} (${existing.status})`, `Summary: ${existing.summary}`]
          for (const c of checks) lines.push(`  - ${c.name}: ${c.status}${c.evidence ? ` — ${c.evidence}` : ""}`)
          return lines.join("\n")
        }

        await updateTask(task, { status: "evaluating", blocking_reason: null, error: null }, "Running evaluation")

        // Create streaming session so eval progress is visible in UI
        const evalLive = agentStream({ taskID: task.id, runID: run.id, stage: "evaluator" })
        const evalSession = await Session.createNext({
          parentID: input.agentSessionID,
          title: `Eval: ${task.title}`,
          directory: Instance.directory,
        })
        registerGoalRunSession(evalSession.id, task.id)
        await evalLive.start("Evaluation started")

        // Run core + standard checks
        const evalCfg = await OrchestratorConfig.get()
        const evalTier: EvaluationTier = evalCfg.evaluator.tier ?? "standard"
        const deliveryResult = delivery.result ?? {}
        const diffs = Array.isArray(deliveryResult.diffs) ? deliveryResult.diffs as Array<{ file: string; [k: string]: unknown }> : []
        const changedFiles = diffs.map(d => d.file).filter(Boolean) as string[]

        let result: Awaited<ReturnType<typeof EvaluatorService.evaluate>>
        try {
          result = await Promise.race([
            EvaluatorService.evaluate(
              {
                taskID: task.id,
                activeSpecVersionID: task.active_spec_version_id ?? undefined,
                request: task.request,
                metadata: { ...(task.metadata ?? {}), delivery_changed_files: changedFiles },
              },
              { summary: delivery.summary, diffs: diffs as any, changedFiles },
              evalTier,
            ),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("evaluation timeout (10min)")), 10 * 60 * 1000)),
          ])
          await evalLive.finish(`Evaluation ${result.status}`)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log.error("run_eval failed", { taskID: task.id, runID: run.id, error: msg })
          evalLive.error(err)
          return `Evaluation failed: ${msg}. Decide whether to retry or fail the task.`
        }

        // Persist evaluation
        const goals = run.plan_version_id ? listGoalsByPlan(run.plan_version_id) : []
        const evalPassed = result.status === "passed"
        const checkSummary = `Core checks: ${result.checks.map(c => `${c.name}:${c.status}`).join(", ") || "none"}`
        const deliveryID = delivery.id
        const evaluationID = Identifier.ascending("evaluation")

        persistEvaluation({
          task, run, deliveryID, evaluationID,
          delivery: { summary: delivery.summary, diffs },
          result,
          analysis: {
            verdict: evalPassed ? "accepted" : "rejected",
            classification: "transient",
            summary: checkSummary,
            goal_statuses: goals.map((g, i) => ({
              goal_index: i,
              status: (evalPassed ? "passed" : "failed") as "passed" | "failed",
              evidence: checkSummary,
              reasoning: result.summary,
            })),
            replan_guidance: null,
          },
          finalVerdict: evalPassed ? "accepted" : "rejected",
          finalStatus: evalPassed ? "passed" : "failed",
          finalSummary: checkSummary,
          goals,
        })

        // Return structured result for Task Agent decision
        const lines = [
          `Evaluation ${evalPassed ? "PASSED" : "FAILED"}`,
          `Summary: ${checkSummary}`,
        ]
        for (const c of result.checks) {
          lines.push(`  - ${c.name}: ${c.status}${typeof c.evidence === "string" ? ` — ${c.evidence}` : ""}`)
        }
        if (evalPassed) {
          lines.push("", "Eval passed. Next step: call run_delivery_verify to verify the delivery.")
        } else {
          lines.push("", "Eval failed. Decide: call create_fix_run with guidance, or fail_task if unrecoverable.")
        }
        return lines.join("\n")
      },
    }),

    run_delivery_verify: tool({
      description: "Run delivery agent verification on the active run. The delivery agent is a read-only verifier that checks code quality, runtime behavior, and goal satisfaction. Returns a structured verdict.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Why you decided to verify delivery now"),
      }),
      execute: async () => {
        const task = requireTask(taskID)
        const run = task.active_run_id ? requireRun(task.active_run_id) : undefined
        if (!run) return "No active run."
        const delivery = findDeliveryByRun(run.id)
        if (!delivery) return "No delivery found for this run."
        const evaluation = findEvaluationByRun(run.id)
        if (!evaluation || evaluation.status !== "passed") {
          return `Evaluation has not passed yet (status: ${evaluation?.status ?? "none"}). Run run_eval first.`
        }

        await updateTask(task, { status: "delivering", blocking_reason: null, error: null }, "Running delivery verification")

        const goals = run.plan_version_id ? listGoalsByPlan(run.plan_version_id) : []
        const deliveryResult = delivery.result ?? {}
        const diffs = Array.isArray(deliveryResult.diffs) ? deliveryResult.diffs : []
        const changedFiles = Array.isArray(deliveryResult.changed_files)
          ? (deliveryResult.changed_files as unknown[]).filter((f): f is string => typeof f === "string")
          : diffs.map((d: any) => d.file).filter(Boolean) as string[]
        const checkResults = Array.isArray(evaluation.checks)
          ? (evaluation.checks as Array<{ name: string; status: string; evidence?: string }>)
          : []

        // Load prior evaluator analysis if available
        const analysisArtifact = Database.use((db) =>
          db.select().from(OrchestratorArtifactTable)
            .where(and(eq(OrchestratorArtifactTable.run_id, run.id), eq(OrchestratorArtifactTable.label, "evaluator-agent-analysis")))
            .limit(1).get(),
        )
        const analysis = analysisArtifact?.payload as any | undefined

        // Create delivery verification session for streaming
        const deliveryLive = agentStream({ taskID: task.id, runID: run.id, stage: "delivery" })
        const deliverySession = await Session.createNext({
          parentID: input.agentSessionID,
          title: `Delivery: ${task.title}`,
          directory: Instance.directory,
        })
        registerGoalRunSession(deliverySession.id, task.id)
        const deliveryContentHooks = sessionStreamHooks({ sessionID: deliverySession.id, taskID: task.id, stage: "delivery" })
        const deliveryStream = mergeTextHooks(deliveryContentHooks, deliveryLive.hooks)
        await deliveryLive.start("Delivery verification started")

        let verdict: Awaited<ReturnType<typeof DeliveryService.verify>>
        try {
          // DeliveryService.verify has its own inactivity guard (createInactivityGuard)
          // which correctly times out on idle, not on total elapsed. No outer hard timeout.
          verdict = await DeliveryService.verify({
            task: { title: task.title, request: task.request, sessionID: task.session_id ?? undefined, metadata: task.metadata ?? undefined },
            goals: goals.map(g => ({
              description: g.description,
              criteria: g.criteria,
              priority: g.priority as "blocking" | "advisory",
              check_selector: selectorList(g.metadata) as string[],
            })),
            delivery: { summary: delivery.summary, changedFiles, diffs: diffs as any },
            checkResults,
            analysis,
            stream: deliveryStream,
            signal: input.signal,
          })
          await deliveryContentHooks.flush()
          await deliveryLive.finish(`Delivery: ${verdict.verdict}`)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          await deliveryContentHooks.flush().catch(() => undefined)
          deliveryLive.error(err)
          return `Delivery verification failed: ${msg}. Decide whether to retry or fail the task.`
        }

        // Persist verdict artifact
        try {
          Database.use((db) =>
            db.insert(OrchestratorArtifactTable).values({
              id: Identifier.ascending("artifact"),
              task_id: task.id, run_id: run.id, delivery_id: delivery.id,
              kind: "report", label: "delivery-agent-verdict",
              payload: verdict as unknown as Record<string, unknown>,
              time_created: Date.now(), time_updated: Date.now(),
            }).run(),
          )
        } catch { /* non-critical */ }

        // Run independent evaluator agent analysis
        let agentVerdict: Awaited<ReturnType<typeof EvaluatorAgent.analyze>> | undefined
        try {
          agentVerdict = await Promise.race([
            EvaluatorAgent.analyze({
              task: { title: task.title, request: task.request, sessionID: task.session_id ?? undefined, taskID: task.id },
              goals: goals.map(g => ({
                description: g.description, criteria: g.criteria,
                priority: g.priority as "blocking" | "advisory",
                check_selector: selectorList(g.metadata) as string[],
              })),
              delivery: { summary: delivery.summary, changedFiles, diffs: diffs as any },
              checkResults: checkResults.map(c => ({
                name: c.name, status: c.status as "passed" | "failed" | "skipped",
                evidence: typeof c.evidence === "string" ? c.evidence : undefined,
              })),
            }),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("evaluator agent timeout")), 10 * 60 * 1000)),
          ])
          // Persist evaluator agent verdict
          try {
            Database.use((db) =>
              db.insert(OrchestratorArtifactTable).values({
                id: Identifier.ascending("artifact"),
                task_id: task.id, run_id: run.id, delivery_id: delivery.id,
                kind: "report", label: "evaluator-agent-analysis",
                payload: agentVerdict as unknown as Record<string, unknown>,
                time_created: Date.now(), time_updated: Date.now(),
              }).run(),
            )
          } catch { /* non-critical */ }
        } catch (err) {
          log.warn("evaluator agent failed, proceeding with delivery verdict only", { error: String(err) })
        }

        // Return combined results
        const lines = [`Delivery verdict: ${verdict.verdict}`, `Summary: ${verdict.summary}`]
        if (verdict.issues_found.length > 0) {
          lines.push("Issues found:")
          for (const issue of verdict.issues_found) lines.push(`  - ${issue}`)
        }
        if (verdict.rejection_details && verdict.rejection_details.length > 0) {
          lines.push("Rejection details:")
          for (const d of verdict.rejection_details) {
            lines.push(`  - [${d.category}]${d.file ? ` ${d.file}` : ""}: ${d.error}${d.suggestion ? ` → ${d.suggestion}` : ""}`)
          }
        }
        if (agentVerdict) {
          lines.push(`Evaluator agent verdict: ${agentVerdict.verdict}`)
          if (agentVerdict.verdict !== "accepted") {
            lines.push(`Evaluator agent summary: ${agentVerdict.summary}`)
          }
        }

        const bothAccepted = verdict.verdict === "accepted" && (!agentVerdict || agentVerdict.verdict === "accepted")
        if (bothAccepted) {
          lines.push("", "Both verifiers accepted. Next step: call publish_delivery to publish.")
        } else {
          const rejectReasons: string[] = []
          if (verdict.verdict === "rejected") rejectReasons.push("delivery agent")
          if (agentVerdict && agentVerdict.verdict !== "accepted") rejectReasons.push("evaluator agent")
          lines.push("", `Rejected by: ${rejectReasons.join(" and ")}. Decide: call create_fix_run with guidance, or fail_task if unrecoverable.`)
        }
        return lines.join("\n")
      },
    }),

    publish_delivery: tool({
      description: "Publish the accepted delivery to git and mark the task as completed. Only call after both eval and delivery verification have passed.",
      inputSchema: z.object({
        reason: z.string().optional().describe("Confirmation that both verifications passed"),
      }),
      execute: async () => {
        const task = requireTask(taskID)
        const run = task.active_run_id ? requireRun(task.active_run_id) : undefined
        if (!run) return "No active run."
        const delivery = findDeliveryByRun(run.id)
        if (!delivery) return "No delivery found."

        // Require delivery verification before publishing
        const verdictArtifact = Database.use((db) =>
          db.select().from(OrchestratorArtifactTable)
            .where(and(eq(OrchestratorArtifactTable.run_id, run.id), eq(OrchestratorArtifactTable.label, "delivery-agent-verdict")))
            .limit(1).get()
        )
        if (!verdictArtifact) return "Delivery not verified. Run run_delivery_verify first."

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
          const finalized = await OrchestratorGit.complete(current, currentPlan, published)
          if (finalized.error) {
            await updateTask(current, { status: "failed", blocking_reason: null, error: finalized.error, time_completed: completed }, finalized.error)
            return `Git finalization failed: ${finalized.error}`
          }
          await updateTask(finalized.task, { status: "completed", blocking_reason: null, error: null, time_completed: completed }, "Task completed")
          await Plugin.trigger("delivery.ready", { taskID: task.id, runID: run.id, deliveryID: delivery.id }, { actions: [] }).catch(() => undefined)
          // Flush task learnings to memory (fire-and-forget)
          const evaluation = findEvaluationByRun(run.id)
          OrchestratorMemoryBridge.flushTaskLearnings({ task, run, delivery, evaluation, plan: currentPlan })
            .catch(err => log.warn("failed to flush task learnings", { error: String(err) }))
          return `Delivery published and task completed successfully.`
        }

        await updateTask(task, { status: "failed", blocking_reason: null, error: result.summary, time_completed: completed }, result.summary)
        return `Publish returned non-delivered status: ${result.summary}`
      },
    }),
  }
}
