/**
 * Async pipeline: spec → goal → plan → dispatch
 *
 * Each stage persists to DB immediately. If a later stage fails, earlier work is preserved.
 * The poll loop drives advancement; crash recovery re-enters from the last completed stage.
 */
import z from "zod"
import { GoalFailureError, HeadlessGoalService, goalInputsFromDraft, validateGoalGraph, type GoalDraft } from "@/goal/service"
import { GoalFidelityReview, applyGoalCorrections } from "@/goal/fidelity-review"
import { Identifier } from "@/id/id"
import { PlannerFailureError, PlannerService, type PlanDraft } from "@/planner/service"
import { SpecFailureError, SpecService } from "@/spec/service"
import { Database, eq, inArray, and } from "@/storage/db"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { budgetRow } from "./helpers"
import { CreateTaskInput, Event } from "./model"
import {
  OrchestratorChannelBindingTable,
  OrchestratorPlanVersionTable,
  OrchestratorProgressSnapshotTable,
  OrchestratorRunTable,
  OrchestratorTaskTable,
} from "./orchestrator.sql"
import { OrchestratorProtocol } from "./protocol"
import { plannerClarification } from "./planner-clarification"
import { suppressClarifications, unattendedProject } from "./unattended"
import { withStageRetry } from "./strategy"
import {
  insertPlanItems,
  persistGoalSnapshot,
  persistSpecSnapshot,
} from "./persist"
import {
  findRequirements,
  findSpecSnapshot,
  requireTask,
  listGoals,
  listGoalsForPlan,
  listMilestonesByPlan,
  findPlan,
  type RunRow,
  type TaskRow,
} from "./store"
import { agentStream } from "./agent-stream"
import { writeGoalSnapshot, writePlanSnapshot, writePrdSnapshot } from "./docs"
import { writeSpec } from "./spec"
import { normalizePlanWaves } from "./wave"
import type { Requirement } from "@/spec/agent"

const log = Log.create({ service: "orchestrator-pipeline" })

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** §3.1 — Each stage is an independent async unit with its own timeout and AbortSignal. */
export interface StageRunner<Input, Output> {
  name: string
  timeout: () => number
  run(input: Input, signal: AbortSignal): Promise<Output>
}

type RoutingInput = z.infer<typeof CreateTaskInput>["routing"]
type BudgetInput = z.infer<typeof CreateTaskInput>["budget"]
type PriorityInput = z.infer<typeof CreateTaskInput>["priority"]
type ChannelBindingInput = z.infer<typeof CreateTaskInput>["channelBinding"]

export type PipelineMetadata = {
  executor: RunRow["executor"]
  goals?: z.infer<typeof CreateTaskInput>["goals"]
  milestones?: z.infer<typeof CreateTaskInput>["milestones"]
  routing?: RoutingInput
  sessionID: string
}

type UpdateTaskFn = (
  row: TaskRow,
  values: Partial<typeof OrchestratorTaskTable.$inferInsert>,
  summary: string,
) => Promise<TaskRow>

// ---------------------------------------------------------------------------
// Stage timeouts (from environment variables)
// ---------------------------------------------------------------------------

function stageTimeout(stage: "spec" | "goal" | "plan"): number {
  const env = {
    spec: "OPENCORVUS_SPEC_TIMEOUT_MS",
    goal: "OPENCORVUS_GOAL_TIMEOUT_MS",
    plan: "OPENCORVUS_PLAN_TIMEOUT_MS",
  }
  const defaults = { spec: 300_000, goal: 180_000, plan: 300_000 }
  return parseInt(process.env[env[stage]] || String(defaults[stage]), 10)
}

// ---------------------------------------------------------------------------
// persistQueuedTask — fast-path for POST /task (<10ms)
// ---------------------------------------------------------------------------

export function persistQueuedTask(input: {
  taskID: string
  sessionID: string
  now: number
  executor: RunRow["executor"]
  title: string
  request: string
  requestID?: string
  source?: z.infer<typeof CreateTaskInput>["source"]
  priority?: PriorityInput
  budget?: BudgetInput
  metadata: Record<string, unknown>
  channelBinding?: ChannelBindingInput
  milestones?: z.infer<typeof CreateTaskInput>["milestones"]
  goals?: z.infer<typeof CreateTaskInput>["goals"]
  routing?: RoutingInput
  projectID: string
}) {
  const pipeline: PipelineMetadata = {
    executor: input.executor,
    goals: input.goals,
    milestones: input.milestones,
    routing: input.routing,
    sessionID: input.sessionID,
  }
  Database.transaction((db) => {
    db.insert(OrchestratorTaskTable)
      .values({
        id: input.taskID,
        project_id: input.projectID,
        session_id: input.sessionID,
        request_id: input.requestID,
        source: input.source ?? "api",
        title: input.title,
        request: input.request,
        status: "queued",
        priority: input.priority ?? "normal",
        budget: budgetRow(input.budget),
        metadata: { ...input.metadata, _pipeline: pipeline },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    if (input.channelBinding) {
      db.insert(OrchestratorChannelBindingTable)
        .values({
          id: Identifier.ascending("binding"),
          task_id: input.taskID,
          platform: input.channelBinding.platform,
          channel: input.channelBinding.channel,
          thread: input.channelBinding.thread,
          payload: input.channelBinding.payload ?? {},
          time_created: input.now,
          time_updated: input.now,
        })
        .run()
    }
    db.insert(OrchestratorProgressSnapshotTable)
      .values({
        id: Identifier.ascending("progress"),
        task_id: input.taskID,
        status: "created",
        summary: "Task queued for pipeline processing",
        payload: { sessionID: input.sessionID },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    Database.effect(() =>
      OrchestratorProtocol.emit(Event.TaskCreated, {
        taskID: input.taskID,
        status: "queued",
        summary: "Task queued for pipeline processing",
      }, { source: "pipeline.queued" }),
    )
  })
}

// ---------------------------------------------------------------------------
// advanceTaskStage — per-stage advancement, called by poll loop
// ---------------------------------------------------------------------------

export async function advanceTaskStage(
  taskID: string,
  updateTask: UpdateTaskFn,
  recovery = false,
): Promise<{ runID: string } | undefined> {
  const task = requireTask(taskID)
  const pipeline = task.metadata?._pipeline as PipelineMetadata | undefined

  switch (task.status) {
    case "queued":
      if (!pipeline) {
        log.error("advanceTaskStage: no _pipeline metadata", { taskID })
        await updateTask(task, { status: "failed", error: "Missing pipeline metadata", time_completed: Date.now() }, "No pipeline metadata")
        return
      }
      return runSpecStage(task, pipeline, updateTask)
    case "spec_generating":
      if (!recovery) return // In progress — skip
      // Recovery: re-run spec (previous attempt was interrupted)
      if (!pipeline) return
      return runSpecStage(task, pipeline, updateTask)
    case "goal_decomposing":
      if (!recovery) return
      // Recovery: start goal from DB-persisted spec
      if (!pipeline) return
      return runGoalStage(task, pipeline, updateTask)
    case "planning":
      if (!recovery) return
      // Recovery: start plan from DB-persisted spec+goals
      if (!pipeline) return
      return runPlanStage(task, pipeline, updateTask)
    case "planned":
      return runDispatch(task, updateTask)
    default:
      return // Not a pipeline state
  }
}

// ---------------------------------------------------------------------------
// Stage functions — each persists immediately, then chain-calls the next
// ---------------------------------------------------------------------------

async function runSpecStage(
  task: TaskRow,
  pipeline: PipelineMetadata,
  updateTask: UpdateTaskFn,
): Promise<{ runID: string } | undefined> {
  task = await updateTask(task, { status: "spec_generating" }, "Spec generation started")

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort("spec stage timeout"), stageTimeout("spec"))
  try {
    const unattended = await unattendedProject()
    const specLive = agentStream({ taskID: task.id, stage: "spec" })
    await specLive.start("Spec generation started")

    const rawSpecDraft = await withStageRetry("spec", () =>
      SpecService.initial({
        title: task.title,
        request: task.request,
        goals: pipeline.goals as any,
        sessionID: pipeline.sessionID,
        metadata: task.metadata ?? {},
        signal: ctrl.signal,
      }),
      { signal: ctrl.signal },
    )
    await specLive.finish("Spec generation finished")

    const specDraft = ensureRequirements(unattended ? suppressClarifications(rawSpecDraft) : rawSpecDraft)

    // Persist spec snapshot immediately
    const specSnapshotID = Identifier.ascending("spec")
    Database.transaction((db) => {
      persistSpecSnapshot(db, { taskID: task.id, specSnapshotID, version: 1, specDraft, now: Date.now() })
      db.update(OrchestratorTaskTable)
        .set({ active_spec_version_id: specSnapshotID, time_updated: Date.now() })
        .where(eq(OrchestratorTaskTable.id, task.id))
        .run()
      Database.effect(() =>
        OrchestratorProtocol.emit(Event.SpecCreated, { taskID: task.id, specID: specSnapshotID, summary: specDraft.summary }, { source: "pipeline.spec" }),
      )
    })
    task = requireTask(task.id)

    // Check cancellation before chaining
    const freshAfterSpec = requireTask(task.id)
    if (freshAfterSpec.status === "cancelled" || freshAfterSpec.status === "failed") {
      log.info("pipeline halted after spec", { taskID: task.id, status: freshAfterSpec.status })
      return
    }

    // Chain to next stage
    return runGoalStage(task, pipeline, updateTask, specDraft)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    log.error("spec stage failed", { taskID: task.id, error: msg })
    await updateTask(task, { status: "failed", error: `Spec failed: ${msg}`, time_completed: Date.now() }, `Spec failed: ${msg}`)
    return
  } finally {
    clearTimeout(timer)
  }
}

async function runGoalStage(
  task: TaskRow,
  pipeline: PipelineMetadata,
  updateTask: UpdateTaskFn,
  specDraft?: any,
): Promise<{ runID: string } | undefined> {
  // Dedup: if goals already exist for this task (previous run was interrupted after goal persist),
  // skip goal LLM call and chain directly to plan stage.
  const existingGoals = listGoals(task.id)
  if (existingGoals.length > 0 && !specDraft) {
    log.info("goal stage: skipping — goals already persisted (recovery)", { taskID: task.id, goalCount: existingGoals.length })
    const recoveredSpec = reconstructSpecFromDB(task.active_spec_version_id!)
    if (!recoveredSpec) {
      await updateTask(task, { status: "failed", error: "Spec not found for goal recovery", time_completed: Date.now() }, "Goal recovery failed")
      return
    }
    const persistedGoals = existingGoals.map(g => ({
      id: g.id, description: g.description, criteria: g.criteria,
      priority: g.priority, metadata: g.metadata ?? undefined,
    }))
    return runPlanStage(task, pipeline, updateTask, recoveredSpec, undefined, persistedGoals)
  }

  task = await updateTask(task, { status: "goal_decomposing" }, "Goal decomposition started")

  // Recovery: if specDraft not provided, reconstruct from DB
  if (!specDraft) {
    const specSnapshotID = task.active_spec_version_id
    if (!specSnapshotID) {
      await updateTask(task, { status: "failed", error: "No spec for goal stage", time_completed: Date.now() }, "No spec for goal stage")
      return
    }
    specDraft = reconstructSpecFromDB(specSnapshotID)
    if (!specDraft) {
      await updateTask(task, { status: "failed", error: "Spec snapshot not found", time_completed: Date.now() }, "Spec recovery failed")
      return
    }
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort("goal stage timeout"), stageTimeout("goal"))
  try {
    const goalLive = agentStream({ taskID: task.id, stage: "goal" })
    await goalLive.start("Goal decomposition started")

    const goalDraft = await withStageRetry("goal", () =>
      HeadlessGoalService.initial({
        title: task.title,
        request: task.request,
        spec: specDraft,
        sessionID: pipeline.sessionID,
        metadata: task.metadata ?? undefined,
        goalHints: pipeline.goals as any,
        timeoutMs: stageTimeout("goal"),
        signal: ctrl.signal,
        stream: goalLive.hooks,
        onStatus: goalLive.statusHook.bind(goalLive),
      }),
      { signal: ctrl.signal },
    )
    await goalLive.finish("Goal decomposition finished")

    if (!goalDraft) throw new GoalFailureError("Goal decomposition produced no result")

    // Fidelity review: LLM verifies goals cover spec requirements
    let reviewedGoalDraft = goalDraft
    if (goalDraft.goals.length > 0 && Array.isArray(specDraft.requirements) && specDraft.requirements.length > 0) {
      log.info("running goal fidelity review", { taskID: task.id, goals: goalDraft.goals.length, requirements: specDraft.requirements.length })
      const review = await GoalFidelityReview.run({
        request: task.request,
        spec: specDraft,
        goalDraft,
        sessionID: pipeline.sessionID,
        metadata: task.metadata ?? undefined,
        timeoutMs: 120_000,
        signal: ctrl.signal,
      })
      if (review.verdict === "needs_correction") {
        reviewedGoalDraft = applyGoalCorrections(goalDraft, review)
        validateGoalGraph(reviewedGoalDraft, specDraft)
        log.info("fidelity review applied corrections", {
          taskID: task.id,
          originalGoals: goalDraft.goals.length,
          reviewedGoals: reviewedGoalDraft.goals.length,
        })
      }
    }

    // Persist goal snapshot immediately
    const specSnapshotID = task.active_spec_version_id!
    const goalSnapshotID = Identifier.ascending("goal_snapshot")
    const specRequirements = requirementLinks(findRequirements(specSnapshotID))
    let persistedGoals: ReturnType<typeof persistGoalSnapshot> = []
    Database.transaction((db) => {
      persistedGoals = persistGoalSnapshot(db, {
        taskID: task.id,
        specSnapshotID,
        goalSnapshotID,
        version: 1,
        goalDraft: reviewedGoalDraft,
        requirements: specRequirements,
        now: Date.now(),
      })
    })

    // Check cancellation before chaining
    const freshAfterGoal = requireTask(task.id)
    if (freshAfterGoal.status === "cancelled" || freshAfterGoal.status === "failed") {
      log.info("pipeline halted after goal", { taskID: task.id, status: freshAfterGoal.status })
      return
    }

    // Chain to next stage
    return runPlanStage(task, pipeline, updateTask, specDraft, reviewedGoalDraft, persistedGoals, goalSnapshotID)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    log.error("goal stage failed", { taskID: task.id, error: msg })
    await updateTask(task, { status: "failed", error: `Goal failed: ${msg}`, time_completed: Date.now() }, `Goal failed: ${msg}`)
    return
  } finally {
    clearTimeout(timer)
  }
}

async function runPlanStage(
  task: TaskRow,
  pipeline: PipelineMetadata,
  updateTask: UpdateTaskFn,
  specDraft?: any,
  goalDraft?: GoalDraft,
  persistedGoals?: Array<{ id: string; description: string; criteria: string; priority?: string; metadata?: Record<string, unknown> }>,
  goalSnapshotID?: string,
): Promise<{ runID: string } | undefined> {
  task = await updateTask(task, { status: "planning" }, "Planning started")

  // Recovery: reconstruct inputs from DB if not provided (crash recovery path)
  if (!specDraft) {
    const specSnapshotID = task.active_spec_version_id
    if (!specSnapshotID) {
      await updateTask(task, { status: "failed", error: "No spec for plan stage", time_completed: Date.now() }, "No spec for plan stage")
      return
    }
    specDraft = reconstructSpecFromDB(specSnapshotID)
    if (!specDraft) {
      await updateTask(task, { status: "failed", error: "Spec snapshot not found", time_completed: Date.now() }, "Plan recovery failed")
      return
    }
  }
  if (!goalDraft && !persistedGoals) {
    // Recovery: read persisted goals from DB (written by goal stage)
    const dbGoals = listGoals(task.id)
    if (dbGoals.length > 0) {
      persistedGoals = dbGoals.map(g => ({
        id: g.id,
        description: g.description,
        criteria: g.criteria,
        priority: g.priority,
        metadata: g.metadata ?? undefined,
      }))
    }
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort("plan stage timeout"), stageTimeout("plan"))
  try {
    const unattended = await unattendedProject()
    const plannerGoals = goalDraft ? goalInputsFromDraft(goalDraft) : (persistedGoals ?? []).map(g => ({
      description: g.description,
      criteria: g.criteria,
      priority: g.priority as "blocking" | "advisory" | undefined,
    }))
    const planLive = agentStream({ taskID: task.id, stage: "planner" })
    await planLive.start("Planner started")

    let planDraft = await withStageRetry("plan", () =>
      PlannerService.initial({
        title: task.title,
        request: task.request,
        spec: specDraft,
        goals: plannerGoals,
        allowClarification: !unattended,
        executor: pipeline.executor as any,
        routing: pipeline.routing,
        signal: ctrl.signal,
      }),
      { signal: ctrl.signal },
    )
    await planLive.finish("Planner finished")

    // Suppress clarifications in unattended mode
    if (unattended) {
      const clarification = plannerClarification(planDraft)
      if (clarification) {
        planDraft = {
          ...planDraft,
          metadata: {
            ...planDraft.metadata,
            clarification: undefined,
            planner: planDraft.metadata?.planner
              ? { ...planDraft.metadata.planner, clarification_source: "suppressed" as const }
              : { role: "headless_compiler" as const, quality: "compiled" as const, source: "planner_agent" as const, clarification_source: "suppressed" as const },
          },
        }
      }
    }

    // Build metadata
    const specSnapshotID = task.active_spec_version_id!
    const content = specDraft?.content
    const specMeta = typeof content === "string"
      ? writeSpec({ taskID: task.id, title: task.title, content, summary: specDraft?.summary ?? planDraft.summary, createdAt: Date.now() })
      : undefined
    const planMetadata = {
      ...(task.metadata ?? {}),
      ...planDraft.metadata,
      ...(goalSnapshotID ? { goal_snapshot_id: goalSnapshotID } : {}),
      ...(specMeta ? { spec: { ...specMeta, source: specMeta.source ?? planDraft.metadata?.spec?.source } } : {}),
    }

    // Persist plan + run
    const planID = Identifier.ascending("plan")
    const runID = Identifier.ascending("run")
    const now = Date.now()
    const clarification = plannerClarification(planDraft)

    Database.transaction((db) => {
      db.update(OrchestratorTaskTable)
        .set({ active_plan_version_id: planID, active_run_id: runID, status: "planned", time_updated: now })
        .where(eq(OrchestratorTaskTable.id, task.id))
        .run()
      db.insert(OrchestratorPlanVersionTable)
        .values({
          id: planID, task_id: task.id, spec_snapshot_id: specSnapshotID,
          version: 1, status: "active", summary: planDraft.summary,
          prompt: planDraft.prompt, metadata: planMetadata,
          time_created: now, time_updated: now,
        })
        .run()
      insertPlanItems(db, {
        taskID: task.id, planID, goals: persistedGoals as any,
        planDraft, now, milestones: (pipeline.milestones ?? []) as any,
      })
      db.insert(OrchestratorRunTable)
        .values({
          id: runID, task_id: task.id, plan_version_id: planID,
          session_id: pipeline.sessionID, executor: pipeline.executor,
          status: clarification ? "blocked" : "queued", phase: "dispatch",
          retry_count: 0, metadata: {},
          time_created: now, time_updated: now,
        })
        .run()
      Database.effect(() => OrchestratorProtocol.emit(Event.PlanCreated, { taskID: task.id, planID, summary: planDraft.summary }, { source: "pipeline.plan" }))
      Database.effect(() => OrchestratorProtocol.emit(Event.PlanActivated, { taskID: task.id, planID, summary: "Plan activated" }, { source: "pipeline.plan" }))
      Database.effect(() => OrchestratorProtocol.emit(Event.RunCreated, { taskID: task.id, runID, status: "queued", summary: "Run queued" }, { source: "pipeline.plan" }))
    })

    // Write markdown snapshots (non-critical)
    try {
      writePrdSnapshot({ task: { id: task.id, title: task.title, request: task.request }, plan: { id: planID, version: 1, summary: planDraft.summary, metadata: planMetadata }, createdAt: now })
      writePlanSnapshot({ task: { id: task.id, title: task.title, request: task.request }, plan: { id: planID, version: 1, summary: planDraft.summary, prompt: planDraft.prompt, metadata: planMetadata }, createdAt: now })
      const p = findPlan(planID)
      writeGoalSnapshot({ task: { id: task.id, title: task.title, request: task.request }, plan: { id: planID, version: 1, summary: planDraft.summary }, goals: p ? listGoalsForPlan(p) : [], milestones: listMilestonesByPlan(planID), createdAt: now })
    } catch { /* non-critical */ }

    // status already set to "planned" inside the transaction above
    log.info("pipeline complete", { taskID: task.id, runID, planID })
    return { runID }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    log.error("plan stage failed", { taskID: task.id, error: msg })
    await updateTask(task, { status: "failed", error: `Plan failed: ${msg}`, time_completed: Date.now() }, `Plan failed: ${msg}`)
    return
  } finally {
    clearTimeout(timer)
  }
}

/** §1.3 — planned → dispatch: verify run exists and return runID for OrchestratorRuntime.dispatch(). */
async function runDispatch(
  task: TaskRow,
  updateTask: UpdateTaskFn,
): Promise<{ runID: string } | undefined> {
  const runID = task.active_run_id
  if (!runID) {
    await updateTask(task, { status: "failed", error: "No run for dispatch", time_completed: Date.now() }, "Planned task has no run")
    return
  }
  log.info("pipeline dispatch ready", { taskID: task.id, runID })
  return { runID }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type PersistedRequirement = { id: string; sourceRequirementID: string; title: string; priority: "blocking" | "advisory" }

function requirementLinks(rows: Array<{ id: string; title: string; priority: string; metadata?: Record<string, unknown> | null }>): PersistedRequirement[] {
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
    summary: snapshot.summary,
    content: snapshot.content,
    requirements,
    assumptions: Array.isArray(snapshot.metadata?.assumptions) ? snapshot.metadata.assumptions : [],
    risks: Array.isArray(snapshot.metadata?.risks) ? snapshot.metadata.risks : [],
    clarifications: [],
    scope: snapshot.scope,
    out_of_scope: snapshot.out_of_scope ?? undefined,
    evidence_sources: Array.isArray(snapshot.evidence) ? snapshot.evidence : [],
    unresolved_questions: Array.isArray(snapshot.metadata?.unresolved_questions) ? snapshot.metadata.unresolved_questions : [],
  }
}

function parseAcceptance(raw: unknown, fallback: string): string[] {
  if (Array.isArray(raw)) return raw
  if (typeof raw === "string") {
    if (raw.trimStart().startsWith("[")) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed
    }
    return [raw]
  }
  return [fallback]
}

type SpecDraft = NonNullable<Awaited<ReturnType<typeof SpecService.initial>>>

function ensureRequirements(specDraft: SpecDraft): SpecDraft {
  if (Array.isArray(specDraft.requirements) && specDraft.requirements.length > 0) return specDraft
  const specItems = (specDraft as Record<string, unknown>).spec_items
  if (Array.isArray(specItems) && specItems.length > 0) {
    const requirements = specItems.flatMap((item, i) => {
      if (!item || typeof item !== "object") return []
      const raw = item as Record<string, unknown>
      const title = typeof raw.title === "string" ? raw.title : ""
      const description = typeof raw.description === "string" ? raw.description : ""
      if (!title && !description) return []
      const checkSelector = Array.isArray(raw.check_selector)
        ? (raw.check_selector as unknown[]).filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        : undefined
      return [{
        id: `req_${i + 1}`,
        title: title || `Requirement ${i + 1}`,
        description: description || title,
        acceptance: [description || title],
        evidence_refs: [] as string[],
        priority: (raw.priority === "advisory" ? "advisory" : "blocking") as "blocking" | "advisory",
        ...(checkSelector && checkSelector.length > 0 ? { metadata: { check_selector: checkSelector } } : {}),
      }]
    })
    if (requirements.length > 0) return { ...specDraft, requirements }
  }
  if (specDraft.content && specDraft.summary) {
    return {
      ...specDraft,
      requirements: [{
        id: "req_1",
        title: specDraft.summary,
        description: specDraft.content.slice(0, 500),
        acceptance: [specDraft.summary],
        evidence_refs: [],
        priority: "blocking" as const,
      }],
    }
  }
  return specDraft
}
