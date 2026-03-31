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
import { goalInputsFromDraft, validateGoalGraph } from "@/goal/service"
import { Session } from "@/session"
import { Database, eq } from "@/storage/db"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { createInactivityGuard } from "@/util/inactivity-guard"
import { registerGoalRunSession } from "@/server/routes/task-event"
import { agentStream } from "./agent-stream"
import { sessionStreamHooks } from "./session-stream"
import { withStageRetry } from "./strategy"
import { suppressClarifications, unattendedProject } from "./unattended"
import { plannerClarification } from "./planner-clarification"
import { writeSpec } from "./spec"
import { writeGoalSnapshot, writePlanSnapshot, writePrdSnapshot } from "./docs"
import { Event as OrchestratorEvent } from "./model"
import { OrchestratorProtocol } from "./protocol"
import {
  OrchestratorPlanVersionTable,
  OrchestratorRunTable,
  OrchestratorTaskTable,
} from "./orchestrator.sql"
import {
  insertPlanItems,
  persistGoalSnapshot,
  persistSpecSnapshot,
} from "./persist"
import {
  findDeliveryByRun,
  findEvaluationByRun,
  findPlan,
  findRequirements,
  findSpecSnapshot,
  listGoals,
  listGoalsForPlan,
  listMilestonesByPlan,
  requireRun,
  requireTask,
} from "./store"
import { updateTask } from "./state"

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

export function createTaskAgentTools(input: { taskID: string; signal?: AbortSignal }) {
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
            parentID: task.session_id ?? undefined,
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
          const goalSession = await Session.createNext({ parentID: task.session_id ?? undefined, title: `Goals: ${task.title}`, directory: Instance.directory })
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
          Database.transaction((db) => {
            persistGoalSnapshot(db, { taskID, specSnapshotID, goalSnapshotID, version: 1, goalDraft: reviewed, requirements: requirementLinks(findRequirements(specSnapshotID)), now: Date.now() })
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
        const pipeline = task.metadata?._pipeline as any
        let specDraft: any = task.active_spec_version_id ? reconstructSpecFromDB(task.active_spec_version_id) : undefined
        const dbGoals = listGoals(taskID)
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
          const planSession = await Session.createNext({ parentID: task.session_id ?? undefined, title: `Plan: ${task.title}`, directory: Instance.directory })
          registerGoalRunSession(planSession.id, taskID)
          const hooks = sessionStreamHooks({ sessionID: planSession.id, taskID, stage: "planner" })
          await planLive.start("Planner started")

          let planDraft = await withStageRetry("plan", () =>
            PlannerService.initial({
              title: task.title, request: task.request, spec: specDraft, goals: plannerGoals,
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

    check_run_result: tool({
      description: "Check evaluation and delivery results for a completed run. Use to decide whether to complete or retry the task.",
      inputSchema: z.object({
        runID: z.string().describe("The run ID to check"),
      }),
      execute: async ({ runID }) => {
        const run = requireRun(runID)
        const evaluation = findEvaluationByRun(runID)
        const delivery = findDeliveryByRun(runID)
        const lines = [`Run status: ${run.status}`, `Phase: ${run.phase ?? "unknown"}`]
        if (evaluation) {
          lines.push(`Evaluation: ${evaluation.verdict} (${evaluation.status})`, `Summary: ${evaluation.summary}`)
          if (Array.isArray(evaluation.checks)) {
            for (const c of evaluation.checks as any[]) lines.push(`  - ${c.name}: ${c.status}${c.evidence ? ` — ${c.evidence}` : ""}`)
          }
        } else lines.push("Evaluation: not yet available")
        if (delivery) {
          lines.push(`Delivery: ${(delivery.result as any)?.verdict ?? delivery.status} (${delivery.status})`, `Delivery summary: ${delivery.summary}`)
        } else lines.push("Delivery: not yet available")
        if (run.error) lines.push(`Error: ${run.error}`)
        return lines.join("\n")
      },
    }),

    complete_task: tool({
      description: "Mark the task as successfully completed. Only call after checking run results.",
      inputSchema: z.object({
        summary: z.string().describe("Brief summary of what was accomplished"),
      }),
      execute: async ({ summary }) => {
        const task = requireTask(taskID)
        await updateTask(task, { status: "completed", time_completed: Date.now() }, summary)
        return `Task ${taskID} completed. ${summary}`
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
  }
}
