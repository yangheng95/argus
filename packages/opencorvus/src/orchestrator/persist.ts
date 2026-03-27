import z from "zod"
import { selectorList, selectorsSatisfied } from "@/check/policy"
import { GoalFailureError, goalInputsFromDraft, type GoalDraft } from "@/goal/service"
import { HeadlessGoalAgent } from "@/goal/agent"
import { Identifier } from "@/id/id"
import { executorLeaseAvailable, executorLeaseHeldByOther, executorLeaseOwner, executorLeaseUntil } from "./lease"
import { type GoalJudgmentType } from "@/evaluator/agent"
import { type CheckReport } from "@/evaluator/shared"
import { ExecutorPlanner } from "@/planner/executor"
import { protocolInfo, type ProtocolCapabilitiesInfo, type ProtocolRefsInfo, type ProtocolSettingsInfo, ProtocolTransport } from "@/executor/protocol"
import { type ReplanContext, type WaveStatus } from "@/planner/agent"
import { PlannerFailureError, PlannerService, type PlanDraft } from "@/planner/service"
import { writeEvaluationSnapshot, writeGoalSnapshot, writePlanSnapshot, writePrdSnapshot } from "@/orchestrator/docs"
import { writeSpec } from "@/orchestrator/spec"
import { type Requirement } from "@/spec/agent"
import { SpecFailureError, SpecService } from "@/spec/service"
import { Database, and, desc, eq, inArray, isNull, lte, ne, or } from "@/storage/db"
import { Log } from "@/util/log"
import { budgetRow, buildRetryPrompt, type RetryContext } from "./helpers"
import { CreateTaskInput, Event } from "./model"
import {
  OrchestratorArtifactTable,
  OrchestratorChannelBindingTable,
  OrchestratorDeliveryTable,
  OrchestratorEvaluationTable,
  OrchestratorExecutorEventTable,
  OrchestratorExecutorSessionTable,
  OrchestratorGoalTable,
  OrchestratorGoalSnapshotTable,
  OrchestratorGoalRunTable,
  OrchestratorInteractionRequestTable,
  OrchestratorPlanNodeTable,
  OrchestratorMilestoneTable,
  OrchestratorPlanVersionTable,
  OrchestratorProgressSnapshotTable,
  OrchestratorRequirementTable,
  OrchestratorRunTable,
  OrchestratorSpecItemTable,
  OrchestratorSpecSnapshotTable,
  OrchestratorTaskTable,
  type OrchestratorMilestoneStatus,
  type OrchestratorDeliveryStatus,
  type OrchestratorArtifactKind,
} from "./orchestrator.sql"
import { plannerClarification } from "./planner-clarification"
import { OrchestratorProtocol } from "./protocol"
import { suppressClarifications, unattendedProject } from "./unattended"
import { buildSpecReplanInput } from "./spec-goal-service"
import { withStageRetry } from "./strategy"
import { findGoalSnapshot, findPlan, findRequirements, findSpecSnapshot, findTask, goalSnapshotIDOfPlan, listGoalsForPlan, listMilestonesByPlan, listPlanNodesByPlan, type GoalRow, type PlanRow, type RequirementRow, type RunRow, type TaskRow } from "./store"
import { agentStream } from "./agent-stream"
import { sessionStreamHooks } from "./session-stream"
import { Session } from "@/session"
import { Instance } from "@/project/instance"
import { registerGoalRunSession } from "@/server/routes/task-event"
import { type TextHooks } from "@/llm/api"
import { normalizePlanWaves } from "./wave"

const log = Log.create({ service: "orchestrator-transition" })

type GoalInput = {
  description: string
  criteria: string
  priority?: "blocking" | "advisory"
  source?: "spec" | "system"
  metadata?: Record<string, unknown>
}

type MilestoneInput = {
  title: string
  description?: string
  goals: GoalInput[]
}

type RoutingInput = z.infer<typeof CreateTaskInput>["routing"]
type BudgetInput = z.infer<typeof CreateTaskInput>["budget"]
type PriorityInput = z.infer<typeof CreateTaskInput>["priority"]
type ChannelBindingInput = z.infer<typeof CreateTaskInput>["channelBinding"]

type SpecDraft = NonNullable<Awaited<ReturnType<typeof SpecService.initial>>>

export type TransitionMode = "initial" | "replan"

type CompileInitialInput = {
  mode: "initial"
  taskID: string
  sessionID?: string
  now: number
  title: string
  request: string
  goals?: GoalInput[]
  executor: RunRow["executor"]
  routing?: RoutingInput
  budget?: BudgetInput
  metadata: Record<string, unknown>
}

type CompileReplanInput = {
  mode: "replan"
  taskID: string
  now: number
  title: string
  request: string
  goals: GoalInput[]
  rewriteSpec?: boolean
  executor: RunRow["executor"]
  routing?: RoutingInput
  task: TaskRow
  previousPlan: PlanRow
  previousRun: RunRow
  failureSummary: string
  replanContext?: ReplanContext
}

export type CompileTransitionInput = CompileInitialInput | CompileReplanInput

export type CompileTransitionResult = {
  specDraft: SpecDraft
  goalDraft?: GoalDraft
  planDraft: PlanDraft
  specMeta?: ReturnType<typeof writeSpec>
  specStrategy: "generated" | "rewritten" | "reused"
  taskMetadata: Record<string, unknown>
  planMetadata: Record<string, unknown>
}

type PlannerFailureWithSpec = PlannerFailureError & {
  specDraft?: SpecDraft
}

function stageTimeouts(input: CompileTransitionInput) {
  const totalMs = input.mode === "initial"
    ? input.budget?.maxWallTimeMs
    : input.task.budget?.max_wall_time_ms
  if (!totalMs || totalMs <= 0) return {}
  const complex = input.request.length >= 2_000 || input.request.split(/\r?\n/).length >= 40
  const specFloor = complex ? 150_000 : 120_000
  const goalFloor = complex ? 180_000 : 120_000
  const plannerFloor = complex ? 240_000 : 180_000
  const minimum = specFloor + goalFloor + plannerFloor
  if (totalMs <= minimum) {
    const specMs = Math.max(45_000, Math.floor(totalMs * 0.3))
    const goalMs = Math.max(45_000, Math.floor(totalMs * 0.25))
    return {
      specMs,
      goalMs,
      plannerMs: Math.max(60_000, totalMs - specMs - goalMs),
    }
  }
  const extra = totalMs - minimum
  const specBonus = Math.floor(extra * (complex ? 0.25 : 0.2))
  const goalBonus = Math.floor(extra * (complex ? 0.3 : 0.25))
  return {
    specMs: specFloor + specBonus,
    goalMs: goalFloor + goalBonus,
    plannerMs: plannerFloor + (extra - specBonus - goalBonus),
  }
}

function requirementsFromSpecDraft(specDraft: Pick<SpecDraft, "requirements">): Requirement[] {
  return Array.isArray(specDraft.requirements) ? specDraft.requirements : []
}

function reuseSpecDraft(input: CompileReplanInput): SpecDraft {
  const specSnapshotID = input.previousPlan.spec_snapshot_id ?? ""
  const snapshot = findSpecSnapshot(specSnapshotID)
  if (!snapshot) throw new PlannerFailureError(`Spec not found for replan: ${input.previousPlan.spec_snapshot_id}`)
  const assumptions = Array.isArray(snapshot.metadata?.assumptions)
    ? snapshot.metadata.assumptions
      .filter((item): item is { question: string; assumption: string } =>
        !!item
        && typeof item === "object"
        && "question" in item
        && typeof item.question === "string"
        && "assumption" in item
        && typeof item.assumption === "string",
      )
    : []
  const risks = Array.isArray(snapshot.metadata?.risks)
    ? snapshot.metadata.risks.filter((item): item is string => typeof item === "string")
    : []
  const unresolved = Array.isArray(snapshot.metadata?.unresolved_questions)
    ? snapshot.metadata.unresolved_questions.filter((item): item is string => typeof item === "string")
    : []
  const evidence = Array.isArray(snapshot.evidence) ? snapshot.evidence : []
  const requirements = findRequirements(specSnapshotID).map((item) => ({
    id:
      item.metadata && typeof item.metadata.source_requirement_id === "string"
        ? item.metadata.source_requirement_id
        : item.id,
    title: item.title,
    description: item.description,
    priority: item.priority,
    acceptance: item.acceptance ? [item.acceptance] : [item.description],
    evidence_refs: item.evidence_refs ?? evidence,
    non_goals: item.non_goals ?? undefined,
    metadata: item.metadata ?? undefined,
  }))
  return {
    summary: snapshot.summary,
    content: snapshot.content,
    requirements,
    assumptions,
    risks,
    clarifications: undefined,
    evidence_sources: evidence,
    unresolved_questions: unresolved,
    spec_items: [],
  }
}

export function resetPlanGoals(db: Database.TxOrDb, goals: GoalRow[], now: number) {
  for (const goal of goals) {
    if (goal.status === "pending") continue
    db.update(OrchestratorGoalTable)
      .set({
        status: "pending",
        time_updated: now,
      })
      .where(eq(OrchestratorGoalTable.id, goal.id))
      .run()
  }
}

type PersistInitialInput = {
  taskID: string
  planID: string
  runID: string
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
  milestones?: MilestoneInput[]
  compiled: CompileTransitionResult
  projectID: string
  promptOverride?: string
}

type PlannerClarificationInput = {
  taskID: string
  runID: string
  sessionID?: string
  now: number
  source: "planner" | "spec"
  reason: string
  questions: Array<{
    header: string
    question: string
    context?: string
    default_assumption?: string
  }>
  provisionalPlan: {
    summary: string
    prompt: string
    metadata?: Record<string, unknown>
  }
}

type PersistInitialFailureInput = {
  taskID: string
  runID: string
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
  projectID: string
  error: PlannerFailureError
  specDraft?: SpecDraft
}

type PersistReplanInput = {
  task: TaskRow
  previousPlan: PlanRow
  previousRun: RunRow
  nextPlanID: string
  nextRunID: string
  now: number
  summary: string
  replanContext?: ReplanContext
  compiled: CompileTransitionResult
}

type PersistReplanFailureInput = {
  task: TaskRow
  now: number
  error: string
}

export type ReplanQueueResult =
  | {
      queued: true
      runID: string
      error?: undefined
    }
  | {
      queued: false
      runID?: undefined
      error: string
    }

function specClarification(specDraft: SpecDraft) {
  const questions = Array.isArray(specDraft.clarifications)
    ? specDraft.clarifications.flatMap((item) => {
        if (!item || typeof item !== "object") return []
        if (typeof item.question !== "string" || !item.question.trim()) return []
        return [{
          header: typeof item.header === "string" && item.header.trim() ? item.header : "Clarification",
          question: item.question,
          context: typeof item.context === "string" && item.context.trim() ? item.context : undefined,
          default_assumption:
            typeof item.default_assumption === "string" && item.default_assumption.trim()
              ? item.default_assumption
              : undefined,
        }]
      })
    : []
  if (questions.length === 0) return
  return {
    reason: questions[0]?.context ?? "Specification requires clarification before planning.",
    questions,
  }
}

function blockedPlanDraft(input: {
  mode: TransitionMode
  title: string
  request: string
  specDraft: SpecDraft
  goals?: GoalInput[]
  clarification: NonNullable<ReturnType<typeof specClarification>>
  failureSummary?: string
  previousPlanID?: string
  replanContext?: ReplanContext
}): PlanDraft {
  const assumptions = Array.isArray(input.specDraft.assumptions) ? input.specDraft.assumptions : []
  const goals = (Array.isArray(input.goals) ? input.goals : []).map((g) => ({
    description: g.description,
    criteria: g.criteria,
    priority: g.priority ?? ("blocking" as const),
  }))
  const risks = Array.isArray(input.specDraft.risks) ? [...new Set(input.specDraft.risks)] : []
  return {
    summary: "Clarification required before planning",
    prompt: [
      "Planning is blocked pending specification clarification.",
      `Task: ${input.title}`,
      `Original request:\n${input.request.trim()}`,
      `Current specification:\n${input.specDraft.content.trim()}`,
    ].join("\n\n"),
    goals,
    metadata: {
      strategy: input.mode,
      steps: ["Clarify the specification before generating a plan"],
      failure_summary: input.failureSummary,
      previous_plan_id: input.previousPlanID,
      risks,
      planner: {
        role: "headless_compiler" as const,
        quality: "compiled" as const,
        source: "spec_stage" as const,
        clarification_source: "model" as const,
      },
      spec: {
        summary: input.specDraft.summary,
        source: undefined,
      },
      stage_sources: undefined,
      ...(input.replanContext ? { replan_context: input.replanContext } : {}),
      clarification: input.clarification,
      spec_analysis: {
        expanded_spec: input.specDraft.content,
        goals,
        ambiguities: input.clarification.questions.map((item) => item.question),
        questions: input.clarification.questions.map((item) => ({
          question: item.question,
          context: item.context ?? input.clarification.reason,
          default_assumption: item.default_assumption ?? "",
        })),
        risk_areas: risks,
        assumptions,
        confidence: 0.35,
      },
    },
  }
}

export async function compileTransition(input: CompileTransitionInput): Promise<CompileTransitionResult> {
  const unattended = await unattendedProject()
  const timeouts = stageTimeouts(input)
  const specLive = agentStream({ taskID: input.taskID, stage: "spec" })

  // Create child session for spec stage content persistence
  const taskSessionID = input.mode === "replan" ? input.task.session_id : input.sessionID
  const specSession = taskSessionID
    ? await Session.createNext({
        parentID: taskSessionID,
        title: `Spec: ${input.title}`,
        directory: Instance.directory,
      })
    : undefined
  if (specSession) registerGoalRunSession(specSession.id, input.taskID)
  const specContentHooks = specSession
    ? sessionStreamHooks({ sessionID: specSession.id, taskID: input.taskID, stage: "spec" })
    : undefined

  function combineHooks(content?: TextHooks, status?: TextHooks): TextHooks {
    if (!content) return status ?? {}
    if (!status) return content
    return {
      onChunk: async (arg) => { await content.onChunk?.(arg); await status.onChunk?.(arg) },
      onError: async (arg) => { await content.onError?.(arg); await status.onError?.(arg) },
    }
  }

  const [rawSpecDraft, specStrategy] = await (async () => {
    if (input.mode === "replan" && !input.rewriteSpec) {
      await specLive.start("Spec locked; reusing active specification")
      const result = reuseSpecDraft(input)
      await specLive.finish("Active specification preserved for replanning")
      return [result, "reused"] as const
    }
    await specLive.start(input.mode === "replan" ? "Spec rewrite started" : "Spec generation started")
    return compileSpec(input, combineHooks(specContentHooks, specLive.hooks), timeouts.specMs, specLive.statusHook.bind(specLive), specSession?.id).then(async (result) => {
      await specContentHooks?.flush()
      await specLive.finish(input.mode === "replan" ? "Spec rewrite finished" : "Spec generation finished")
      return [result, input.mode === "replan" ? "rewritten" : "generated"] as const
    }).catch(async (error) => {
      await specLive.error(error)
      if (!(error instanceof SpecFailureError)) throw error
      throw new PlannerFailureError(error.message, { cause: error })
    })
  })()
  const initialSpecClarification = specClarification(rawSpecDraft)
  if (unattended && initialSpecClarification) {
    log.info(`${input.mode}: auto-assuming specification clarification for unattended project`, {
      taskID: input.taskID,
      reason: initialSpecClarification.reason,
      questionCount: initialSpecClarification.questions.length,
    })
  }
  const specDraft = unattended ? suppressClarifications(rawSpecDraft) : rawSpecDraft
  const specBlock = unattended ? undefined : specClarification(specDraft)
  let goalDraft: GoalDraft | undefined
  const plannerSpec = specDraft
  let planDraft = await (async () => {
    if (specBlock) {
      return blockedPlanDraft({
        mode: input.mode,
        title: input.title,
        request: input.request,
        specDraft,
        goals: input.goals,
        clarification: specBlock,
        ...(input.mode === "replan"
          ? {
              failureSummary: input.failureSummary,
              previousPlanID: input.previousPlan.id,
              replanContext: input.replanContext,
            }
          : {}),
      })
    }

    const goalLive = agentStream({ taskID: input.taskID, stage: "goal" })
    const goalSession = taskSessionID
      ? await Session.createNext({
          parentID: taskSessionID,
          title: `Goals: ${input.title}`,
          directory: Instance.directory,
        })
      : undefined
    if (goalSession) registerGoalRunSession(goalSession.id, input.taskID)
    const goalContentHooks = goalSession
      ? sessionStreamHooks({ sessionID: goalSession.id, taskID: input.taskID, stage: "goal" })
      : undefined
    await goalLive.start(input.mode === "replan" ? "Goal decomposition recompile started" : "Goal decomposition started")
    goalDraft = await (
      input.mode === "initial"
        ? HeadlessGoalAgent.initial({
            title: input.title,
            request: input.request,
            spec: specDraft,
            goalHints: input.goals,
            sessionID: goalSession?.id,
            stream: combineHooks(goalContentHooks, goalLive.hooks),
            onStatus: goalLive.statusHook.bind(goalLive),
          })
        : HeadlessGoalAgent.recompile({
            title: input.title,
            request: input.request,
            spec: specDraft,
            goalHints: input.goals,
            sessionID: goalSession?.id,
            stream: combineHooks(goalContentHooks, goalLive.hooks),
            onStatus: goalLive.statusHook.bind(goalLive),
          })
    ).then(async (result) => {
      await goalContentHooks?.flush()
      await goalLive.finish(input.mode === "replan" ? "Goal decomposition recompile finished" : "Goal decomposition finished")
      return result
    }).catch(async (error) => {
      await goalContentHooks?.flush().catch(() => undefined)
      await goalLive.error(error)
      throw error
    })
    if (!goalDraft) {
      throw new PlannerFailureError("Goal decomposition did not produce a goal graph")
    }
    const plannerGoals = goalInputsFromDraft(goalDraft)

    const planLive = agentStream({ taskID: input.taskID, stage: "planner" })
    // Create a child session so planner output is persisted and streamed via message events
    const planSession = await Session.createNext({
      parentID: taskSessionID ?? undefined,
      title: `Plan: ${input.title}`,
      directory: Instance.directory,
    })
    registerGoalRunSession(planSession.id, input.taskID)
    const planContentHooks = sessionStreamHooks({ sessionID: planSession.id, taskID: input.taskID, stage: "planner" })
    const planStream = combineHooks(planContentHooks, planLive.hooks)
    await planLive.start(input.mode === "replan" ? "Planner replan started" : "Planner started")
    const plan = await (
      input.mode === "initial"
        ? PlannerService.initial({
            title: input.title,
            request: input.request,
            spec: plannerSpec,
            goals: plannerGoals,
            allowClarification: !unattended,
            executor: input.executor,
            routing: input.routing,
            sessionID: planSession.id,
            stream: planStream,
          })
        : PlannerService.replan({
            title: input.title,
            request: input.request,
            spec: plannerSpec,
            goals: plannerGoals,
            previousPrompt: input.previousPlan.prompt,
            previousPlanID: input.previousPlan.id,
            failureSummary: input.failureSummary,
            replanContext: input.replanContext,
            allowClarification: !unattended,
            executor: input.executor,
            routing: input.routing,
            sessionID: planSession.id,
            stream: planStream,
          })
    ).then(async (result) => {
      await planContentHooks.flush()
      await planLive.finish(input.mode === "replan" ? "Planner replan finished" : "Planner finished")
      return result
    }).catch(async (error) => {
      await planContentHooks.flush().catch(() => undefined)
      await planLive.error(error)
      throw error
    })
    return plan
  })().catch((error) => {
    if (error instanceof GoalFailureError) {
      const next = new PlannerFailureError(error.message, { cause: error }) as PlannerFailureWithSpec
      next.specDraft = specDraft
      throw next
    }
    if (!(error instanceof PlannerFailureError)) throw error
    const next = error as PlannerFailureWithSpec
    next.specDraft = specDraft
    throw next
  })
  let clarification = plannerClarification(planDraft)
  if (unattended && clarification) {
    const planner = planDraft.metadata?.planner
    log.info(`${input.mode}: auto-suppressing planner clarification for unattended project`, {
      taskID: input.taskID,
      reason: clarification.reason,
      questionCount: clarification.questions.length,
    })
    planDraft = {
      ...planDraft,
      metadata: {
        ...planDraft.metadata,
        clarification: undefined,
        planner: planner
          ? {
              ...planner,
              clarification_source: "suppressed" as const,
            }
          : {
              role: "headless_compiler" as const,
              quality: "compiled" as const,
              source: "planner_agent" as const,
              clarification_source: "suppressed" as const,
            },
      },
    }
    clarification = undefined
  }
  if (clarification) {
    const source = planDraft.metadata?.planner?.source === "spec_stage" ? "spec" : "planner"
    log.info(`${input.mode}: ${source} clarification required`, {
      taskID: input.taskID,
      reason: clarification.reason,
      questionCount: clarification.questions.length,
    })
  }
  const content = specDraft?.content
  const specMeta = typeof content === "string"
    ? writeSpec({
        taskID: input.taskID,
        title: input.title,
        content,
        summary: specDraft?.summary ?? planDraft.summary,
        source:
          planDraft.metadata?.spec?.source && typeof planDraft.metadata.spec.source === "object"
            ? planDraft.metadata.spec.source as Record<string, unknown>
            : undefined,
        createdAt: input.now,
      })
    : undefined
  const taskMetadata =
    input.mode === "initial"
      ? {
          ...input.metadata,
          ...(planDraft.metadata?.stage_sources ? { stage_sources: planDraft.metadata.stage_sources } : {}),
          ...(specMeta ? { spec: specMeta } : {}),
        }
      : {
          ...(input.task.metadata ?? {}),
          ...(planDraft.metadata?.stage_sources ? { stage_sources: planDraft.metadata.stage_sources } : {}),
          ...(specMeta ? { spec: specMeta } : {}),
        }
  const planMetadata =
    input.mode === "initial"
      ? {
          ...input.metadata,
          ...planDraft.metadata,
          ...(specMeta
            ? {
                spec: {
                  ...specMeta,
                  source: specMeta.source ?? planDraft.metadata?.spec?.source,
                },
              }
            : {}),
        }
      : {
          previous_run_id: input.previousRun.id,
          ...planDraft.metadata,
          ...(!specMeta && input.previousPlan.metadata?.spec ? { spec: input.previousPlan.metadata.spec } : {}),
          ...(specMeta
            ? {
                spec: {
                  ...specMeta,
                  source: specMeta.source ?? planDraft.metadata?.spec?.source,
                },
              }
            : {}),
        }
  return {
    specDraft,
    goalDraft,
    planDraft,
    specMeta,
    specStrategy,
    taskMetadata,
    planMetadata,
  }
}

export function specDraftFromFailure(error: unknown) {
  if (!(error instanceof PlannerFailureError)) return
  return (error as PlannerFailureWithSpec).specDraft
}

function persistPlannerClarification(
  db: Database.TxOrDb,
  input: PlannerClarificationInput,
) {
  db.insert(OrchestratorInteractionRequestTable)
    .values({
      id: Identifier.ascending("interaction"),
      task_id: input.taskID,
      run_id: input.runID,
      session_id: input.sessionID,
      external_id: Identifier.ascending("question"),
      request_type: "question",
      status: "pending",
      title: input.questions[0]?.header ?? "Clarification",
      body: [
        input.reason,
        ...input.questions.map((item) => `${item.header}: ${item.question}`),
      ].join("\n\n"),
      payload: {
        planner_clarification: true,
        clarification_source: input.source,
        questions: input.questions,
        provisional_plan: {
          summary: input.provisionalPlan.summary,
          prompt: input.provisionalPlan.prompt,
          metadata: input.provisionalPlan.metadata,
        },
      },
      time_created: input.now,
      time_updated: input.now,
    })
    .run()
}

function persistChannelBinding(
  db: Database.TxOrDb,
  input: {
    taskID: string
    channelBinding?: ChannelBindingInput
    now: number
  },
) {
  if (!input.channelBinding) return
  const existing = db
    .select({ task_id: OrchestratorChannelBindingTable.task_id })
    .from(OrchestratorChannelBindingTable)
    .where(and(
      eq(OrchestratorChannelBindingTable.platform, input.channelBinding.platform),
      eq(OrchestratorChannelBindingTable.channel, input.channelBinding.channel),
      eq(OrchestratorChannelBindingTable.thread, input.channelBinding.thread),
    ))
    .get()
  if (existing?.task_id === input.taskID) return
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

export function persistInitialTransition(input: PersistInitialInput) {
  const specSnapshotID = Identifier.ascending("spec")
  const goalSnapshotID = input.compiled.goalDraft ? Identifier.ascending("goal_snapshot") : undefined
  const clarification = plannerClarification(input.compiled.planDraft)
  const planMetadata = {
    ...input.compiled.planMetadata,
    ...(goalSnapshotID ? { goal_snapshot_id: goalSnapshotID } : {}),
  }
  Database.transaction((db) => {
    const existing = db
      .select({ id: OrchestratorTaskTable.id })
      .from(OrchestratorTaskTable)
      .where(eq(OrchestratorTaskTable.id, input.taskID))
      .get()
    if (existing) {
      db.update(OrchestratorTaskTable)
        .set({
          project_id: input.projectID,
          session_id: input.sessionID,
          active_spec_version_id: specSnapshotID,
          active_plan_version_id: input.planID,
          active_run_id: input.runID,
          request_id: input.requestID,
          source: input.source ?? "api",
          title: input.title,
          request: input.request,
          status: clarification ? "blocked" : "queued",
          priority: input.priority ?? "normal",
          blocking_reason: clarification ? "clarification" : null,
          budget: budgetRow(input.budget),
          metadata: input.compiled.taskMetadata,
          error: null,
          time_completed: null,
          time_updated: input.now,
        })
        .where(eq(OrchestratorTaskTable.id, input.taskID))
        .run()
    }
    if (!existing) {
      db.insert(OrchestratorTaskTable)
        .values({
          id: input.taskID,
          project_id: input.projectID,
          session_id: input.sessionID,
          active_spec_version_id: specSnapshotID,
          active_plan_version_id: input.planID,
          active_run_id: input.runID,
          request_id: input.requestID,
          source: input.source ?? "api",
          title: input.title,
          request: input.request,
          status: clarification ? "blocked" : "queued",
          priority: input.priority ?? "normal",
          blocking_reason: clarification ? "clarification" : null,
          budget: budgetRow(input.budget),
          metadata: input.compiled.taskMetadata,
          time_created: input.now,
          time_updated: input.now,
        })
        .run()
    }
    const goals = persistSpecSnapshot(db, {
      taskID: input.taskID,
      specSnapshotID,
      version: 1,
      specDraft: input.compiled.specDraft,
      now: input.now,
    })
    const persistedGoals =
      goalSnapshotID && input.compiled.goalDraft
        ? persistGoalSnapshot(db, {
            taskID: input.taskID,
            specSnapshotID,
            goalSnapshotID,
            version: 1,
            goalDraft: input.compiled.goalDraft,
            requirements: goals.requirements,
            now: input.now,
          })
        : []
    db.insert(OrchestratorPlanVersionTable)
      .values({
        id: input.planID,
        task_id: input.taskID,
        spec_snapshot_id: specSnapshotID,
        version: 1,
        status: "active",
        summary: input.compiled.planDraft.summary,
        prompt: input.compiled.planDraft.prompt,
        metadata: planMetadata,
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    insertPlanItems(db, {
      taskID: input.taskID,
      planID: input.planID,
      goals: persistedGoals,
      planDraft: input.compiled.planDraft,
      now: input.now,
      milestones: input.milestones ?? [],
    })
    db.insert(OrchestratorRunTable)
      .values({
        id: input.runID,
        task_id: input.taskID,
        plan_version_id: input.planID,
        session_id: input.sessionID,
        executor: input.executor,
        status: clarification ? "blocked" : "queued",
        phase: "dispatch",
        retry_count: 0,
        blocking_reason: clarification ? "clarification" : null,
        metadata: {
          ...(input.compiled.planDraft.metadata?.stage_sources
            ? { stage_sources: input.compiled.planDraft.metadata.stage_sources }
            : {}),
          ...(input.promptOverride?.trim() ? { prompt_override: input.promptOverride.trim() } : {}),
        },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    if (clarification) {
      persistPlannerClarification(db, {
        taskID: input.taskID,
        runID: input.runID,
        sessionID: input.sessionID,
        now: input.now,
        source: input.compiled.planDraft.metadata?.planner?.source === "spec_stage" ? "spec" : "planner",
        reason: clarification.reason,
        questions: clarification.questions,
        provisionalPlan: {
          summary: input.compiled.planDraft.summary,
          prompt: input.compiled.planDraft.prompt,
          metadata: input.compiled.planDraft.metadata,
        },
      })
    }
    persistChannelBinding(db, input)
    db.insert(OrchestratorProgressSnapshotTable)
      .values({
        id: Identifier.ascending("progress"),
        task_id: input.taskID,
        status: clarification ? "blocked" : "created",
        summary: clarification ? "Planning blocked pending clarification" : "Task created",
        payload: {
          sessionID: input.sessionID,
          ...(clarification ? { reason: clarification.reason, questionCount: clarification.questions.length } : {}),
        },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    Database.effect(() =>
      OrchestratorProtocol.emit(existing ? Event.TaskUpdated : Event.TaskCreated, {
        taskID: input.taskID,
        status: clarification ? "blocked" : "queued",
        summary: clarification ? "Planning blocked pending clarification" : "Task created",
      }, { source: "persist.initial" }),
    )
    Database.effect(() =>
      OrchestratorProtocol.emit(Event.SpecCreated, {
        taskID: input.taskID,
        specID: specSnapshotID,
        summary: input.compiled.specDraft.summary,
      }, { source: "persist.initial" }),
    )
    Database.effect(() =>
      OrchestratorProtocol.emit(Event.PlanCreated, {
        taskID: input.taskID,
        planID: input.planID,
        summary: input.compiled.planDraft.summary,
      }, { source: "persist.initial" }),
    )
    Database.effect(() =>
      OrchestratorProtocol.emit(Event.PlanActivated, {
        taskID: input.taskID,
        planID: input.planID,
        summary: "Initial plan activated",
      }, { source: "persist.initial" }),
    )
    Database.effect(() =>
      OrchestratorProtocol.emit(Event.RunCreated, {
        taskID: input.taskID,
        runID: input.runID,
        status: clarification ? "blocked" : "queued",
        summary: clarification ? "Run blocked pending clarification" : "Run queued",
      }, { source: "persist.initial" }),
    )
  })
  writePrdSnapshot({
    task: {
      id: input.taskID,
      title: input.title,
      request: input.request,
    },
    plan: {
      id: input.planID,
      version: 1,
      summary: input.compiled.planDraft.summary,
      metadata: planMetadata,
    },
    createdAt: input.now,
  })
  writePlanSnapshot({
    task: {
      id: input.taskID,
      title: input.title,
      request: input.request,
    },
    plan: {
      id: input.planID,
      version: 1,
      summary: input.compiled.planDraft.summary,
      prompt: input.compiled.planDraft.prompt,
      metadata: planMetadata,
    },
    createdAt: input.now,
  })
  const persistedPlan = findPlan(input.planID)
  writeGoalSnapshot({
    task: {
      id: input.taskID,
      title: input.title,
      request: input.request,
    },
    plan: {
      id: input.planID,
      version: 1,
      summary: input.compiled.planDraft.summary,
    },
    goals: persistedPlan ? listGoalsForPlan(persistedPlan) : [],
    milestones: listMilestonesByPlan(input.planID),
    createdAt: input.now,
  })
  return {
    queued: true,
    runID: input.runID,
  }
}

export function persistInitialTransitionFailure(input: PersistInitialFailureInput) {
  const specDraft = input.specDraft ?? {
    summary: "Specification capture failed before planning completed.",
    content: input.request,
    assumptions: [] as Array<{ question: string; assumption: string }>,
    risks: [input.error.message],
    clarifications: [],
    requirements: [] as Requirement[],
    evidence_sources: [] as string[],
    unresolved_questions: [] as string[],
    spec_items: [],
  }
  const specSnapshotID = Identifier.ascending("spec")
  Database.transaction((db) => {
    const existing = db
      .select({ id: OrchestratorTaskTable.id })
      .from(OrchestratorTaskTable)
      .where(eq(OrchestratorTaskTable.id, input.taskID))
      .get()
    if (existing) {
      db.update(OrchestratorTaskTable)
        .set({
          project_id: input.projectID,
          session_id: input.sessionID,
          active_run_id: input.runID,
          active_spec_version_id: specSnapshotID,
          request_id: input.requestID,
          source: input.source ?? "api",
          title: input.title,
          request: input.request,
          status: "failed",
          priority: input.priority ?? "normal",
          blocking_reason: null,
          budget: budgetRow(input.budget),
          metadata: {
            ...input.metadata,
            planner_failure: true,
          },
          error: input.error.message,
          time_completed: input.now,
          time_updated: input.now,
        })
        .where(eq(OrchestratorTaskTable.id, input.taskID))
        .run()
    }
    if (!existing) {
      db.insert(OrchestratorTaskTable)
        .values({
          id: input.taskID,
          project_id: input.projectID,
          session_id: input.sessionID,
          active_run_id: input.runID,
          active_spec_version_id: specSnapshotID,
          request_id: input.requestID,
          source: input.source ?? "api",
          title: input.title,
          request: input.request,
          status: "failed",
          priority: input.priority ?? "normal",
          budget: budgetRow(input.budget),
          metadata: {
            ...input.metadata,
            planner_failure: true,
          },
          error: input.error.message,
          time_created: input.now,
          time_updated: input.now,
          time_completed: input.now,
        })
        .run()
    }
    persistSpecSnapshot(db, {
      taskID: input.taskID,
      specSnapshotID,
      version: 1,
      specDraft,
      now: input.now,
    })
    db.insert(OrchestratorRunTable)
      .values({
        id: input.runID,
        task_id: input.taskID,
        session_id: input.sessionID,
        executor: input.executor,
        status: "failed",
        phase: "plan",
        retry_count: 0,
        error: input.error.message,
        metadata: {
          strategy: "planning_failed",
        },
        time_created: input.now,
        time_updated: input.now,
        time_completed: input.now,
      })
      .run()
    persistChannelBinding(db, input)
    db.insert(OrchestratorProgressSnapshotTable)
      .values({
        id: Identifier.ascending("progress"),
        task_id: input.taskID,
        status: "failed",
        summary: "Planning failed before execution",
        payload: {
          error: input.error.message,
          sessionID: input.sessionID,
        },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    Database.effect(() => {
      if (!existing) {
        OrchestratorProtocol.emit(Event.TaskCreated, { taskID: input.taskID, status: "failed", summary: "Task created" }, { source: "persist.initial_failure" })
      }
    })
    Database.effect(() =>
      OrchestratorProtocol.emit(Event.SpecCreated, {
        taskID: input.taskID,
        specID: specSnapshotID,
        summary: specDraft.summary,
      }, { source: "persist.initial_failure" }),
    )
    Database.effect(() =>
      OrchestratorProtocol.emit(Event.RunCreated, {
        taskID: input.taskID,
        runID: input.runID,
        status: "failed",
        summary: "Planning failed",
      }, { source: "persist.initial_failure" }),
    )
    Database.effect(() =>
      OrchestratorProtocol.emit(Event.TaskUpdated, {
        taskID: input.taskID,
        status: "failed",
        summary: "Planning failed before execution",
      }, { source: "persist.initial_failure" }),
    )
  })
}

export function persistReplanTransition(input: PersistReplanInput): ReplanQueueResult {
  const previousSpecSnapshotID = input.previousPlan.spec_snapshot_id ?? ""
  const previousSpecSnapshot = findSpecSnapshot(previousSpecSnapshotID)
  const specRewrite = input.compiled.specStrategy === "rewritten"
  const specSnapshotID: string = specRewrite ? Identifier.ascending("spec") : previousSpecSnapshotID
  const specVersion = specRewrite ? (previousSpecSnapshot?.version ?? 0) + 1 : (previousSpecSnapshot?.version ?? 1)
  const nextVersion = input.previousPlan.version + 1
  const previousGoalSnapshotID = goalSnapshotIDOfPlan(input.previousPlan)
  const previousGoalSnapshot = previousGoalSnapshotID ? findGoalSnapshot(previousGoalSnapshotID) : undefined
  const nextGoalSnapshotID = input.compiled.goalDraft ? Identifier.ascending("goal_snapshot") : undefined
  const nextGoalSnapshotVersion = previousGoalSnapshot ? previousGoalSnapshot.version + 1 : 1
  const clarification = plannerClarification(input.compiled.planDraft)
  const planMetadata = {
    ...input.compiled.planMetadata,
    ...(nextGoalSnapshotID ? { goal_snapshot_id: nextGoalSnapshotID } : {}),
  }
  if (clarification) {
    Database.transaction((db) => {
      if (specRewrite) {
        db.update(OrchestratorSpecSnapshotTable)
          .set({
            status: "superseded",
            time_updated: input.now,
          })
          .where(eq(OrchestratorSpecSnapshotTable.id, previousSpecSnapshotID))
          .run()
        persistSpecSnapshot(db, {
          taskID: input.task.id,
          specSnapshotID,
          version: specVersion,
          specDraft: input.compiled.specDraft,
          now: input.now,
        })
      }
      db.insert(OrchestratorRunTable)
        .values({
          id: input.nextRunID,
          task_id: input.task.id,
          plan_version_id: input.previousPlan.id,
          session_id: input.task.session_id,
          executor: input.previousRun.executor,
          status: "blocked",
          phase: "replan",
          retry_count: 0,
          blocking_reason: "clarification",
          metadata: {
            previous_run_id: input.previousRun.id,
            strategy: "replan",
            failure_summary: input.summary,
            ...(input.replanContext ? { replan_context: input.replanContext } : {}),
            ...(input.compiled.planDraft.metadata?.stage_sources
              ? { stage_sources: input.compiled.planDraft.metadata.stage_sources }
              : {}),
          },
          time_created: input.now,
          time_updated: input.now,
        })
        .run()
      db.update(OrchestratorTaskTable)
        .set({
          active_spec_version_id: specSnapshotID,
          active_run_id: input.nextRunID,
          status: "blocked",
          error: null,
          blocking_reason: "clarification",
          metadata: input.compiled.taskMetadata,
          time_completed: null,
          time_updated: input.now,
        })
        .where(eq(OrchestratorTaskTable.id, input.task.id))
        .run()
      persistPlannerClarification(db, {
        taskID: input.task.id,
        runID: input.nextRunID,
        sessionID: input.previousRun.session_id ?? undefined,
        now: input.now,
        source: input.compiled.planDraft.metadata?.planner?.source === "spec_stage" ? "spec" : "planner",
        reason: clarification.reason,
        questions: clarification.questions,
        provisionalPlan: {
          summary: input.compiled.planDraft.summary,
          prompt: input.compiled.planDraft.prompt,
          metadata: input.compiled.planDraft.metadata,
        },
      })
      db.insert(OrchestratorProgressSnapshotTable)
        .values({
          id: Identifier.ascending("progress"),
          task_id: input.task.id,
          status: "blocked",
          summary: "Replanning blocked pending clarification",
          payload: {
            previousPlanID: input.previousPlan.id,
            nextRunID: input.nextRunID,
            reason: input.summary,
            clarification_reason: clarification.reason,
            questionCount: clarification.questions.length,
          },
          time_created: input.now,
          time_updated: input.now,
        })
        .run()
      Database.effect(() =>
        OrchestratorProtocol.emit(Event.RunCreated, {
          taskID: input.task.id,
          runID: input.nextRunID,
          status: "blocked",
          summary: "Run blocked pending clarification",
        }, { source: "persist.replan_clarification" }),
      )
      Database.effect(() =>
        OrchestratorProtocol.emit(Event.TaskUpdated, {
          taskID: input.task.id,
          status: "blocked",
          summary: "Replanning blocked pending clarification",
        }, { source: "persist.replan_clarification" }),
      )
    })
    return {
      queued: true,
      runID: input.nextRunID,
    }
  }
  Database.transaction((db) => {
    db.update(OrchestratorPlanVersionTable)
      .set({
        status: "superseded",
        time_updated: input.now,
      })
      .where(eq(OrchestratorPlanVersionTable.id, input.previousPlan.id))
      .run()
    const persistedSpec = specRewrite
      ? (() => {
          db.update(OrchestratorSpecSnapshotTable)
            .set({
              status: "superseded",
              time_updated: input.now,
            })
            .where(eq(OrchestratorSpecSnapshotTable.id, previousSpecSnapshotID))
            .run()
          return persistSpecSnapshot(db, {
            taskID: input.task.id,
            specSnapshotID,
            version: specVersion,
            specDraft: input.compiled.specDraft,
            now: input.now,
          })
        })()
      : undefined
    if (previousGoalSnapshotID) {
      db.update(OrchestratorGoalSnapshotTable)
        .set({
          status: "superseded",
          time_updated: input.now,
        })
        .where(eq(OrchestratorGoalSnapshotTable.id, previousGoalSnapshotID))
        .run()
    }
    const persistedGoals =
      nextGoalSnapshotID && input.compiled.goalDraft
        ? persistGoalSnapshot(db, {
            taskID: input.task.id,
            specSnapshotID,
            goalSnapshotID: nextGoalSnapshotID,
            version: nextGoalSnapshotVersion,
            goalDraft: input.compiled.goalDraft,
            requirements: persistedSpec?.requirements ?? requirementLinks(findRequirements(specSnapshotID)),
            now: input.now,
          })
        : []
    db.insert(OrchestratorPlanVersionTable)
      .values({
        id: input.nextPlanID,
        task_id: input.task.id,
        spec_snapshot_id: specSnapshotID,
        version: nextVersion,
        status: "active",
        summary: input.compiled.planDraft.summary,
        prompt: input.compiled.planDraft.prompt,
        metadata: planMetadata,
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    insertPlanItems(db, {
      taskID: input.task.id,
      planID: input.nextPlanID,
      goals: persistedGoals,
      planDraft: input.compiled.planDraft,
      now: input.now,
      milestones: [],
    })
    db.insert(OrchestratorRunTable)
      .values({
        id: input.nextRunID,
        task_id: input.task.id,
        plan_version_id: input.nextPlanID,
        session_id: input.task.session_id,
        executor: input.previousRun.executor,
        status: clarification ? "blocked" : "queued",
        phase: "replan",
        retry_count: 0,
        blocking_reason: clarification ? "clarification" : null,
        metadata: {
          previous_run_id: input.previousRun.id,
          strategy: "replan",
          failure_summary: input.summary,
          ...(input.replanContext ? { replan_context: input.replanContext } : {}),
          ...(input.compiled.planDraft.metadata?.stage_sources
            ? { stage_sources: input.compiled.planDraft.metadata.stage_sources }
            : {}),
        },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    db.update(OrchestratorTaskTable)
      .set({
        active_spec_version_id: specSnapshotID,
        active_plan_version_id: input.nextPlanID,
        active_run_id: input.nextRunID,
        status: "running",
        error: null,
        blocking_reason: null,
        time_completed: null,
        metadata: input.compiled.taskMetadata,
        time_updated: input.now,
      })
      .where(eq(OrchestratorTaskTable.id, input.task.id))
      .run()
    db.insert(OrchestratorProgressSnapshotTable)
      .values({
        id: Identifier.ascending("progress"),
        task_id: input.task.id,
        status: "running",
        summary: "Replanning after evaluation failure",
        payload: {
          previousPlanID: input.previousPlan.id,
          nextPlanID: input.nextPlanID,
          previousRunID: input.previousRun.id,
          nextRunID: input.nextRunID,
          reason: input.summary,
        },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    Database.effect(() =>
      specRewrite
        ? OrchestratorProtocol.emit(Event.SpecCreated, {
            taskID: input.task.id,
            specID: specSnapshotID,
            summary: input.compiled.specDraft.summary,
          }, { source: "persist.replan" })
        : undefined,
    )
    Database.effect(() =>
      OrchestratorProtocol.emit(Event.PlanCreated, {
        taskID: input.task.id,
        planID: input.nextPlanID,
        summary: input.compiled.planDraft.summary,
      }, { source: "persist.replan" }),
    )
    Database.effect(() =>
      OrchestratorProtocol.emit(Event.PlanActivated, {
        taskID: input.task.id,
        planID: input.nextPlanID,
        summary: "Replanned version activated",
      }, { source: "persist.replan" }),
    )
    Database.effect(() =>
      OrchestratorProtocol.emit(Event.RunCreated, {
        taskID: input.task.id,
        runID: input.nextRunID,
        status: clarification ? "blocked" : "queued",
        summary: clarification ? "Run blocked pending clarification" : "Run queued after replan",
      }, { source: "persist.replan" }),
    )
    Database.effect(() =>
      OrchestratorProtocol.emit(Event.TaskUpdated, {
        taskID: input.task.id,
        status: clarification ? "blocked" : "running",
        summary: clarification ? "Replanning blocked pending clarification" : "Replanning after evaluation failure",
      }, { source: "persist.replan" }),
    )
  })
  writePrdSnapshot({
    task: input.task,
    plan: {
      id: input.nextPlanID,
      version: nextVersion,
      summary: input.compiled.planDraft.summary,
      metadata: planMetadata,
    },
    createdAt: input.now,
  })
  writePlanSnapshot({
    task: input.task,
    plan: {
      id: input.nextPlanID,
      version: nextVersion,
      summary: input.compiled.planDraft.summary,
      prompt: input.compiled.planDraft.prompt,
      metadata: planMetadata,
    },
    createdAt: input.now,
  })
  const persistedPlan = findPlan(input.nextPlanID)
  writeGoalSnapshot({
    task: input.task,
    plan: {
      id: input.nextPlanID,
      version: nextVersion,
      summary: input.compiled.planDraft.summary,
    },
    goals: persistedPlan ? listGoalsForPlan(persistedPlan) : [],
    milestones: listMilestonesByPlan(input.nextPlanID),
    createdAt: input.now,
  })
  return {
    queued: true,
    runID: input.nextRunID,
    error: undefined,
  }
}

export function persistReplanTransitionFailure(input: PersistReplanFailureInput): ReplanQueueResult {
  Database.transaction((db) => {
    db.update(OrchestratorTaskTable)
      .set({
        status: "failed",
        blocking_reason: null,
        error: input.error,
        time_completed: input.now,
        time_updated: input.now,
      })
      .where(eq(OrchestratorTaskTable.id, input.task.id))
      .run()
    db.insert(OrchestratorProgressSnapshotTable)
      .values({
        id: Identifier.ascending("progress"),
        task_id: input.task.id,
        status: "failed",
        summary: input.error,
        payload: {
          error: input.error,
        },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    Database.effect(() =>
      OrchestratorProtocol.emit(Event.TaskUpdated, {
        taskID: input.task.id,
        status: "failed",
        summary: input.error,
      }, { source: "persist.replan_failure" }),
    )
  })
  return {
    queued: false,
    runID: undefined,
    error: input.error,
  }
}

function buildPreviousWaves(planID: string, goals: GoalRow[]): WaveStatus[] {
  const nodes = listPlanNodesByPlan(planID)
  const goalNodes = nodes.filter((n) => n.kind === "goal" && n.goal_id)
  if (goalNodes.length === 0) return []

  // Group goal nodes by wave_index
  const waveMap = new Map<number, Array<{ title: string; goalID: string }>>()
  const waveTitles = new Map<number, string>()
  for (const node of goalNodes) {
    const meta = node.metadata && typeof node.metadata === "object" && !Array.isArray(node.metadata)
      ? node.metadata as Record<string, unknown>
      : {}
    const waveIndex = typeof meta.wave_index === "number" ? meta.wave_index : 0
    const waveTitle = typeof meta.wave_title === "string" ? meta.wave_title : `Wave ${waveIndex + 1}`
    if (!waveTitles.has(waveIndex)) waveTitles.set(waveIndex, waveTitle)
    const entries = waveMap.get(waveIndex) ?? []
    entries.push({ title: node.title, goalID: node.goal_id! })
    waveMap.set(waveIndex, entries)
  }

  const goalByID = new Map(goals.map((g) => [g.id, g]))
  const sorted = [...waveMap.entries()].sort((a, b) => a[0] - b[0])

  return sorted.map(([waveIndex, entries]) => {
    const waveGoals = entries.map((entry) => {
      const goal = goalByID.get(entry.goalID)
      return {
        description: goal?.description ?? entry.title,
        status: goal?.status ?? "pending",
      }
    })
    const passedCount = waveGoals.filter((g) => g.status === "passed").length
    const failedCount = waveGoals.filter((g) => g.status === "failed").length
    const status: WaveStatus["status"] =
      passedCount === waveGoals.length ? "passed"
        : failedCount > 0 ? (passedCount > 0 ? "partial" : "failed")
          : "pending"
    return {
      title: waveTitles.get(waveIndex) ?? `Wave ${waveIndex + 1}`,
      waveIndex,
      status,
      goals: waveGoals,
    }
  })
}

export function buildReplanContext(input: {
  analysis?: GoalJudgmentType
  goals: GoalRow[]
  planID: string
  summary: string
  previousSummary: string
  taskID?: string
  specSnapshotID?: string
}) {
  if (!input.analysis) return
  const previousWaves = buildPreviousWaves(input.planID, input.goals)
  const goalStatuses = Array.isArray(input.analysis.goal_statuses) ? input.analysis.goal_statuses : []
  const previousGoalStatuses = goalStatuses.map((item) => {
    const goal = input.goals[item.goal_index]
    const meta = goal?.metadata && typeof goal.metadata === "object" && !Array.isArray(goal.metadata)
      ? goal.metadata as Record<string, unknown>
      : undefined
    return {
      description: goal?.description ?? `Goal ${item.goal_index}`,
      status: item.status,
      evidence: item.evidence,
      requirement_ids: Array.isArray(meta?.requirement_ids)
        ? (meta.requirement_ids as unknown[]).filter((id): id is string => typeof id === "string")
        : undefined,
    }
  })

  // Derive failed requirements from goal→requirement mapping
  const failedRequirements: Array<{ id: string; title: string; reason: string }> = []
  if (input.specSnapshotID) {
    const requirements = findRequirements(input.specSnapshotID)
    // Build map: requirement DB ID → covering goal indices
    const goalIndicesByReq = new Map<string, number[]>()
    for (let gi = 0; gi < input.goals.length; gi++) {
      const meta = input.goals[gi]?.metadata
      const reqIDs = meta && typeof meta === "object" && !Array.isArray(meta)
        ? (Array.isArray((meta as Record<string, unknown>).requirement_ids)
          ? ((meta as Record<string, unknown>).requirement_ids as unknown[]).filter((id): id is string => typeof id === "string")
          : [])
        : []
      for (const reqID of reqIDs) {
        const list = goalIndicesByReq.get(reqID) ?? []
        list.push(gi)
        goalIndicesByReq.set(reqID, list)
      }
    }
    for (const requirement of requirements) {
      if (requirement.priority !== "blocking") continue
      const coveringIndices = goalIndicesByReq.get(requirement.id) ?? []
      const failedGoals = coveringIndices
        .map((gi) => goalStatuses.find((gs) => gs.goal_index === gi))
        .filter((gs) => gs?.status === "failed")
      if (failedGoals.length > 0) {
        const evidence = failedGoals.map((gs) => gs!.evidence).filter(Boolean).join("; ")
        failedRequirements.push({
          id: sourceRequirementIDOfRow(requirement),
          title: requirement.title,
          reason: evidence || "Covering goal(s) failed",
        })
      }
    }
  }

  return {
    previousSummary: input.previousSummary,
    failureAnalysis: {
      classification: input.analysis.classification,
      summary: input.analysis.summary,
      rootCause: input.analysis.replan_guidance?.root_cause ?? input.summary,
      suggestedStrategy: input.analysis.replan_guidance?.suggested_strategy ?? "",
      avoidApproaches: input.analysis.replan_guidance?.avoid_approaches ?? [],
    },
    previousGoalStatuses,
    ...(failedRequirements.length > 0 ? { failedRequirements } : {}),
    ...(previousWaves.length > 0 ? { previousWaves } : {}),
  } satisfies ReplanContext
}

export function insertPlanItems(
  db: Database.TxOrDb,
  input: {
    taskID: string
    planID: string
    goals: Array<{ id: string; description: string; criteria: string; priority?: "blocking" | "advisory"; metadata?: Record<string, unknown> }>
    planDraft: {
      metadata?: Record<string, unknown>
    }
    now: number
    milestones: MilestoneInput[]
  },
) {
  const byDescription = new Map<string, number[]>()
  input.goals.forEach((goal, index) => {
    const key = goal.description.trim()
    if (!key) return
    const indices = byDescription.get(key) ?? []
    indices.push(index)
    byDescription.set(key, indices)
  })
  const manualWaves = input.milestones.map((milestone) => ({
    title: milestone.title,
    objective: milestone.description,
    goal_indices: milestone.goals.flatMap((goal) => {
      const key = goal.description.trim()
      const indices = key ? byDescription.get(key) : undefined
      const next = indices?.shift()
      return next === undefined ? [] : [next]
    }),
  }))
  const metadataWaves = Array.isArray(input.planDraft.metadata?.waves) ? input.planDraft.metadata.waves : undefined
  const waves = normalizePlanWaves({
    waves: metadataWaves?.length ? metadataWaves : manualWaves,
    goals: input.goals,
  })

  // Pre-generate plan node IDs for sequential dependency resolution (each stage depends on all prior stages)
  const goalNodeIDs = input.goals.map(() => Identifier.ascending("plan_node"))
  const milestoneNodeIDs = waves.map(() => Identifier.ascending("plan_node"))
  const goalWaveIndex = new Map<number, number>()
  for (const [waveIndex, wave] of waves.entries()) {
    for (const goalIndex of wave.goal_indices) {
      goalWaveIndex.set(goalIndex, waveIndex)
    }
  }

  // Pre-compute depends_on_ids per goal and validate acyclicity
  const goalDeps = input.goals.map((_, index) => {
    const waveIndex = goalWaveIndex.get(index) ?? 0
    return waveIndex > 0
      ? waves.slice(0, waveIndex).flatMap((entry) => entry.goal_indices)
      : []
  })
  const inDegree = new Map<number, number>()
  for (let i = 0; i < input.goals.length; i++) inDegree.set(i, 0)
  for (const [i, deps] of goalDeps.entries()) {
    for (const dep of deps) {
      inDegree.set(i, (inDegree.get(i) ?? 0) + 1)
    }
  }
  const queue = [...inDegree.entries()].filter(([, deg]) => deg === 0).map(([i]) => i)
  let visited = 0
  while (queue.length > 0) {
    const node = queue.shift()!
    visited++
    for (let i = 0; i < input.goals.length; i++) {
      if (goalDeps[i].includes(node)) {
        const next = (inDegree.get(i) ?? 1) - 1
        inDegree.set(i, next)
        if (next === 0) queue.push(i)
      }
    }
  }
  if (visited < input.goals.length) {
    log.warn("cycle detected in goal dependency graph, falling back to linear ordering", {
      taskID: input.taskID,
      goalCount: input.goals.length,
      visited,
    })
    // Reset to strict linear chain: each goal depends on all prior goals
    for (let i = 0; i < goalDeps.length; i++) {
      goalDeps[i] = Array.from({ length: i }, (_, j) => j)
    }
  }

  for (const [index, goal] of input.goals.entries()) {
    const waveIndex = goalWaveIndex.get(index) ?? 0
    const wave = waves[waveIndex]
    const dependsOnIds = goalDeps[index].length > 0
      ? goalDeps[index].map((depIndex) => goalNodeIDs[depIndex])
      : undefined
    db.insert(OrchestratorPlanNodeTable)
      .values({
        id: goalNodeIDs[index],
        task_id: input.taskID,
        plan_version_id: input.planID,
        kind: "goal",
        goal_id: goal.id,
        title: goal.description,
        brief: goal.criteria,
        depends_on_ids: dependsOnIds?.length ? dependsOnIds : undefined,
        order_index: index,
        metadata: {
          ...(goal.metadata ?? {}),
          wave_index: waveIndex,
          wave_title: wave?.title,
          wave_objective: wave?.objective,
          wave_goal_indices: wave?.goal_indices ?? [index],
        },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
  }
  for (const [waveIndex, wave] of waves.entries()) {
    const milestoneID = Identifier.ascending("milestone")
    db.insert(OrchestratorMilestoneTable)
      .values({
        id: milestoneID,
        task_id: input.taskID,
        plan_version_id: input.planID,
        title: wave.title,
        description: wave.objective ?? "",
        status: "pending",
        order_index: waveIndex,
        metadata: {
          kind: "wave",
          goal_indices: wave.goal_indices,
        },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    db.insert(OrchestratorPlanNodeTable)
      .values({
        id: milestoneNodeIDs[waveIndex],
        task_id: input.taskID,
        plan_version_id: input.planID,
        kind: "milestone",
        title: wave.title,
        brief: wave.objective ?? "",
        depends_on_ids: waveIndex > 0 ? [milestoneNodeIDs[waveIndex - 1]] : undefined,
        order_index: input.goals.length + waveIndex,
        metadata: {
          kind: "wave",
          milestone_id: milestoneID,
          goal_indices: wave.goal_indices,
        },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
  }
  const steps = Array.isArray(input.planDraft.metadata?.steps)
    ? input.planDraft.metadata.steps.filter((step): step is string => typeof step === "string" && step.trim().length > 0)
    : []
  const baseOrder = input.goals.length + waves.length
  for (const [index, step] of steps.entries()) {
    db.insert(OrchestratorPlanNodeTable)
      .values({
        id: Identifier.ascending("plan_node"),
        task_id: input.taskID,
        plan_version_id: input.planID,
        kind: "step",
        title: step,
        brief: step,
        order_index: baseOrder + index,
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
  }

  // Link goals to this plan version so listGoalsByPlan() works.
  // Goals are created in the goal stage (before plan exists), so we back-fill here.
  const goalIDs = input.goals.map((g) => g.id).filter(Boolean)
  if (goalIDs.length > 0) {
    db.update(OrchestratorGoalTable)
      .set({ plan_version_id: input.planID, time_updated: input.now })
      .where(and(
        eq(OrchestratorGoalTable.task_id, input.taskID),
        inArray(OrchestratorGoalTable.id, goalIDs),
      ))
      .run()
  }
}

export function insertGoalRows(
  db: Database.TxOrDb,
  input: {
    taskID: string
    specSnapshotID: string
    planVersionID?: string
    goals: Array<{
      goalID?: string
      description: string
      criteria: string
      priority?: "blocking" | "advisory"
      source?: "spec" | "system"
      metadata?: Record<string, unknown>
    }>
    now: number
  },
) {
  return input.goals.map((goal, index) => {
    const goalID = goal.goalID ?? Identifier.ascending("goal")
    const metadata =
      goal.metadata && typeof goal.metadata === "object" && !Array.isArray(goal.metadata)
        ? goal.metadata
        : undefined
    db.insert(OrchestratorGoalTable)
      .values({
        id: goalID,
        task_id: input.taskID,
        plan_version_id: input.planVersionID ?? null,
        spec_snapshot_id: input.specSnapshotID,
        description: goal.description,
        criteria: goal.criteria,
        metadata,
        priority: goal.priority ?? "blocking",
        source: goal.source ?? "spec",
        status: "pending",
        order_index: index,
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    return {
      id: goalID,
      description: goal.description,
      criteria: goal.criteria,
      priority: goal.priority,
      metadata,
    }
  })
}

export function insertRequirements(
  db: Database.TxOrDb,
  input: {
    taskID: string
    specSnapshotID: string
    requirements: Requirement[]
    now: number
  },
) {
  return input.requirements.map((requirement, index) => {
    const requestedID = typeof requirement.id === "string" ? requirement.id.trim() : ""
    const requirementID = Identifier.ascending("requirement")
    db.insert(OrchestratorRequirementTable)
      .values({
        id: requirementID,
        task_id: input.taskID,
        spec_snapshot_id: input.specSnapshotID,
        title: requirement.title,
        description: requirement.description,
        status: "pending",
        priority: requirement.priority === "advisory" ? "advisory" : "blocking",
        acceptance: Array.isArray(requirement.acceptance) ? JSON.stringify(requirement.acceptance) : requirement.acceptance,
        evidence_refs: requirement.evidence_refs.length > 0 ? requirement.evidence_refs : null,
        non_goals: requirement.non_goals && requirement.non_goals.length > 0 ? requirement.non_goals : null,
        metadata: {
          ...(requirement.metadata ?? {}),
          ...(requestedID ? { source_requirement_id: requestedID } : {}),
        },
        order_index: index,
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    return {
      id: requirementID,
      sourceRequirementID: requestedID || requirementID,
      title: requirement.title,
      priority: requirement.priority === "advisory" ? "advisory" as const : "blocking" as const,
    }
  })
}

async function compileSpec(
  input: CompileTransitionInput,
  stream?: TextHooks,
  timeoutMs?: number,
  onStatus?: (summary: string) => void | Promise<void>,
  sessionID?: string,
) {
  const specRoute = input.routing?.spec ?? "opencorvus"
  if (specRoute === "executor" && input.executor !== "opencode" && ExecutorPlanner.supports(input.executor, "spec")) {
    const raw = await ExecutorPlanner.spec({
      executor: input.executor,
      title: input.title,
      request: input.request,
      goals: input.goals,
      ...(input.mode === "replan" ? { replanContext: input.replanContext } : {}),
    })
    const specDraft = raw as Partial<SpecDraft> & Record<string, unknown>
    return {
      summary: typeof specDraft.summary === "string" ? specDraft.summary : input.title,
      content: typeof specDraft.content === "string" ? specDraft.content : input.request,
      requirements: Array.isArray(specDraft.requirements) ? specDraft.requirements as Requirement[] : [],
      assumptions: Array.isArray(specDraft.assumptions) ? specDraft.assumptions as Array<{ question: string; assumption: string }> : [],
      risks: Array.isArray(specDraft.risks) ? specDraft.risks as string[] : [],
      clarifications: Array.isArray(specDraft.clarifications) ? specDraft.clarifications as SpecDraft["clarifications"] : [],
      out_of_scope: typeof specDraft.out_of_scope === "string" ? specDraft.out_of_scope : undefined,
      evidence_sources: Array.isArray(specDraft.evidence_sources) ? specDraft.evidence_sources as string[] : [],
      unresolved_questions: Array.isArray(specDraft.unresolved_questions) ? specDraft.unresolved_questions as string[] : [],
      spec_items: Array.isArray(specDraft.spec_items) ? specDraft.spec_items : [],
    }
  }
  if (input.mode === "replan") {
    return SpecService.rewrite({
      title: input.title,
      request: input.request,
      goals: input.goals,
      sessionID,
      rewriteContext: {
        previousSpec: input.replanContext?.previousSummary ?? input.previousPlan.summary,
        failureAnalysis: input.replanContext?.failureAnalysis ?? {
          classification: "clarification",
          summary: input.failureSummary,
          rootCause: input.failureSummary,
          suggestedStrategy: "Clarify the request and produce an updated specification.",
          avoidApproaches: [],
        },
        previousGoalStatuses: input.replanContext?.previousGoalStatuses ?? input.goals.map((goal) => ({
          description: goal.description,
          status: "pending",
          evidence: "Awaiting clarified replanning context.",
        })),
      },
    })
  }
  return SpecService.initial({
    title: input.title,
    request: input.request,
    goals: input.goals,
    sessionID,
    stream,
  })
}

type PersistedRequirement = {
  id: string
  sourceRequirementID: string
  title: string
  priority: "blocking" | "advisory"
}

function sourceRequirementIDOfRow(row: Pick<RequirementRow, "id" | "metadata">) {
  return row.metadata && typeof row.metadata.source_requirement_id === "string" && row.metadata.source_requirement_id.trim()
    ? row.metadata.source_requirement_id
    : row.id
}

function requirementLinks(rows: RequirementRow[]): PersistedRequirement[] {
  return rows.map((row) => ({
    id: row.id,
    sourceRequirementID: sourceRequirementIDOfRow(row),
    title: row.title,
    priority: row.priority,
  }))
}

export function persistSpecSnapshot(
  db: Database.TxOrDb,
  input: {
    taskID: string
    specSnapshotID: string
    version: number
    specDraft: SpecDraft
    now: number
  },
) {
  const scope = typeof (input.specDraft as { scope?: unknown }).scope === "string"
    ? (input.specDraft as { scope?: string }).scope
    : ""
  const outOfScope = typeof (input.specDraft as { out_of_scope?: unknown }).out_of_scope === "string"
    ? (input.specDraft as { out_of_scope?: string }).out_of_scope
    : undefined
  db.insert(OrchestratorSpecSnapshotTable)
    .values({
      id: input.specSnapshotID,
      task_id: input.taskID,
      version: input.version,
      status: "ready",
      summary: input.specDraft.summary,
      content: input.specDraft.content,
      scope,
      out_of_scope: outOfScope,
      evidence: input.specDraft.evidence_sources.length > 0 ? input.specDraft.evidence_sources : undefined,
      metadata: {
        assumptions: input.specDraft.assumptions,
        risks: input.specDraft.risks,
        unresolved_questions: input.specDraft.unresolved_questions,
      },
      time_created: input.now,
      time_updated: input.now,
    })
    .run()
  const requirements = insertRequirements(db, {
    taskID: input.taskID,
    specSnapshotID: input.specSnapshotID,
    requirements: requirementsFromSpecDraft(input.specDraft),
    now: input.now,
  })
  return { requirements }
}

export function persistGoalSnapshot(
  db: Database.TxOrDb,
  input: {
    taskID: string
    specSnapshotID: string
    goalSnapshotID: string
    version: number
    goalDraft: GoalDraft
    requirements: PersistedRequirement[]
    now: number
  },
) {
  db.insert(OrchestratorGoalSnapshotTable)
    .values({
      id: input.goalSnapshotID,
      task_id: input.taskID,
      spec_snapshot_id: input.specSnapshotID,
      version: input.version,
      status: "ready",
      summary: input.goalDraft.summary,
      metadata: {
        goal_count: input.goalDraft.goals.length,
      },
      time_created: input.now,
      time_updated: input.now,
    })
    .run()

  const goalInputs = goalInputsFromDraft(input.goalDraft)
  const requirementIDBySource = new Map(input.requirements.map((item) => [item.sourceRequirementID, item.id]))
  const goalIDBySource = new Map(input.goalDraft.goals.map((goal) => [goal.id, Identifier.ascending("goal")]))

  const goals = input.goalDraft.goals.map((goal, index) => {
    const goalInput = goalInputs[index]
    const persistedRequirementIDs = goal.requirement_ids
      .filter((requirementID) => !requirementID.startsWith("_implicit:"))
      .map((requirementID) => {
        const next = requirementIDBySource.get(requirementID)
        if (!next) {
          throw new PlannerFailureError(`Goal ${goal.id} references unmapped requirement id: ${requirementID}`)
        }
        return next
      })
    const persistedDependencyIDs = goal.depends_on_goal_ids.map((dependencyID) => {
      const next = goalIDBySource.get(dependencyID)
      if (!next) {
        throw new PlannerFailureError(`Goal ${goal.id} references unmapped dependency id: ${dependencyID}`)
      }
      return next
    })
    const metadata = goalInput.metadata && typeof goalInput.metadata === "object" && !Array.isArray(goalInput.metadata)
      ? goalInput.metadata
      : {}
    return {
      goalID: goalIDBySource.get(goal.id)!,
      description: goalInput.description,
      criteria: goalInput.criteria,
      priority: goalInput.priority,
      source: goalInput.source as "spec" | "system" | undefined,
      metadata: {
        ...metadata,
        goal_snapshot_id: input.goalSnapshotID,
        title: goal.title,
        objective: goal.objective,
        requirement_ids: persistedRequirementIDs,
        source_requirement_ids: goal.requirement_ids,
        depends_on_goal_ids: persistedDependencyIDs,
        source_depends_on_goal_ids: goal.depends_on_goal_ids,
        owned_paths: goal.owned_paths,
        done_definition: goal.done_definition,
        qa_profile: {
          rule_selectors: goal.qa_profile.rule_selectors,
          ...(goal.qa_profile.goal_check_prompt ? { goal_check_prompt: goal.qa_profile.goal_check_prompt } : {}),
          spec_scope: "mapped_requirements",
        },
        kind: goal.kind,
        check_selector: goal.qa_profile.rule_selectors,
        source_goal_id: goal.id,
      },
    }
  })

  return insertGoalRows(db, {
    taskID: input.taskID,
    specSnapshotID: input.specSnapshotID,
    goals,
    now: input.now,
  })
}

export function createRetryRun(task: TaskRow, run: RunRow, summary: string, retryContext?: RetryContext) {
  const existing = Database.use((db) =>
    db
      .select()
      .from(OrchestratorRunTable)
      .where(and(
        eq(OrchestratorRunTable.task_id, task.id),
        run.plan_version_id
          ? eq(OrchestratorRunTable.plan_version_id, run.plan_version_id)
          : isNull(OrchestratorRunTable.plan_version_id),
        inArray(OrchestratorRunTable.status, ["queued", "accepted", "running", "blocked"]),
      ))
      .orderBy(desc(OrchestratorRunTable.time_created), desc(OrchestratorRunTable.id))
      .all()
      .find((item) => item.metadata?.previous_run_id === run.id && item.metadata?.strategy === "retry_same_plan"),
  )
  if (existing) return existing.id
  const nextRunID = Identifier.ascending("run")
  const now = Date.now()
  Database.transaction((db) => {
    const plan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
    if (plan) {
      const failedGoalIDs = listGoalsForPlan(plan)
        .filter((goal) => goal.status === "failed")
        .map((goal) => goal.id)
      if (failedGoalIDs.length > 0) {
        db.update(OrchestratorGoalTable)
          .set({
            status: "pending",
            time_updated: now,
          })
          .where(inArray(OrchestratorGoalTable.id, failedGoalIDs))
          .run()
      }
    }
    db.insert(OrchestratorRunTable)
      .values({
        id: nextRunID,
        task_id: task.id,
        plan_version_id: run.plan_version_id,
        session_id: task.session_id,
        executor: run.executor,
        status: "queued",
        phase: "dispatch",
        retry_count: run.retry_count + 1,
        metadata: {
          previous_run_id: run.id,
          strategy: "retry_same_plan",
          prompt_override: buildRetryPrompt(summary, retryContext),
          retry_context: retryContext,
        },
        time_created: now,
        time_updated: now,
      })
      .run()
    db.update(OrchestratorTaskTable)
      .set({
        active_run_id: nextRunID,
        status: "running",
        error: null,
        blocking_reason: null,
        time_completed: null,
        time_updated: now,
      })
      .where(eq(OrchestratorTaskTable.id, task.id))
      .run()
    db.insert(OrchestratorProgressSnapshotTable)
      .values({
        id: Identifier.ascending("progress"),
        task_id: task.id,
        status: "running",
        summary: "Retrying current plan after evaluation failure",
        payload: {
          previousRunID: run.id,
          nextRunID,
          reason: summary,
        },
        time_created: now,
        time_updated: now,
      })
      .run()
    Database.effect(() =>
      OrchestratorProtocol.emit(Event.RunCreated, {
        taskID: task.id,
        runID: nextRunID,
        status: "queued",
        summary: "Retrying current plan after evaluation failure",
      }, { source: "persist.retry" }),
    )
    Database.effect(() =>
      OrchestratorProtocol.emit(Event.TaskUpdated, {
        taskID: task.id,
        status: "running",
        summary: "Retrying current plan after evaluation failure",
      }, { source: "persist.retry" }),
    )
  })
  return nextRunID
}

export function createGoalRun(input: {
  taskID: string
  goalID: string
  planNodeID?: string
  coordinatorRunID: string
  sessionID?: string
  executor: RunRow["executor"]
  retryCount?: number
  blockingReason?: string | null
  error?: string | null
  workspaceDir?: string
  baseRef?: string
  mergeRef?: string
  metadata?: Record<string, unknown>
  now?: number
}) {
  const existing = Database.use((db) =>
    db
      .select()
      .from(OrchestratorGoalRunTable)
      .where(and(
        eq(OrchestratorGoalRunTable.coordinator_run_id, input.coordinatorRunID),
        eq(OrchestratorGoalRunTable.goal_id, input.goalID),
        input.planNodeID
          ? eq(OrchestratorGoalRunTable.plan_node_id, input.planNodeID)
          : isNull(OrchestratorGoalRunTable.plan_node_id),
        inArray(OrchestratorGoalRunTable.status, ["queued", "accepted", "running", "blocked"]),
      ))
      .orderBy(desc(OrchestratorGoalRunTable.time_created))
      .get(),
  )
  if (existing) return existing
  const id = Identifier.ascending("goal_run")
  const now = input.now ?? Date.now()
  Database.use((db) =>
    db
      .insert(OrchestratorGoalRunTable)
      .values({
        id,
        task_id: input.taskID,
        goal_id: input.goalID,
        plan_node_id: input.planNodeID,
        coordinator_run_id: input.coordinatorRunID,
        session_id: input.sessionID,
        executor: input.executor,
        status: "queued",
        retry_count: input.retryCount ?? 0,
        blocking_reason: input.blockingReason ?? null,
        error: input.error ?? null,
        workspace_dir: input.workspaceDir,
        base_ref: input.baseRef,
        merge_ref: input.mergeRef,
        metadata:
          input.metadata || input.sessionID
            ? {
                ...(input.metadata ?? {}),
                ...(input.sessionID ? { local_session_id: input.sessionID } : {}),
              }
            : undefined,
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
  const row = Database.use((db) =>
    db
      .select()
      .from(OrchestratorGoalRunTable)
      .where(eq(OrchestratorGoalRunTable.id, id))
      .get(),
  )
  if (!row) throw new Error(`createGoalRun: inserted goal run ${id} not found after insert`)
  return row
}

export function updateGoalRun(
  goalRunID: string,
  values: Partial<typeof OrchestratorGoalRunTable.$inferInsert>,
) {
  Database.use((db) =>
    db
      .update(OrchestratorGoalRunTable)
      .set({
        ...values,
        time_updated: Date.now(),
      })
      .where(eq(OrchestratorGoalRunTable.id, goalRunID))
      .run(),
  )
  return Database.use((db) =>
    db
      .select()
      .from(OrchestratorGoalRunTable)
      .where(eq(OrchestratorGoalRunTable.id, goalRunID))
      .get(),
  )
}

export async function createReplanRun(task: TaskRow, plan: PlanRow, run: RunRow, summary: string, analysis?: GoalJudgmentType) {
  const rewrite = buildSpecReplanInput(task, plan, analysis)
  const goals = listGoalsForPlan(plan)
  const routing =
    task.metadata?.routing && typeof task.metadata.routing === "object" && !Array.isArray(task.metadata.routing)
      ? (task.metadata.routing as RoutingInput)
      : undefined
  const replanContext = buildReplanContext({
    analysis,
    goals,
    planID: plan.id,
    summary,
    previousSummary: plan.summary,
    specSnapshotID: task.active_spec_version_id ?? undefined,
  })
  const now = Date.now()
  try {
    const compiled = await withStageRetry("plan", () => compileTransition({
      mode: "replan",
      taskID: task.id,
      now,
      title: task.title,
      request: rewrite.request,
      goals: rewrite.goals,
      rewriteSpec: rewrite.rewriteSpec,
      executor: run.executor,
      routing,
      task,
      previousPlan: plan,
      previousRun: run,
      failureSummary: summary,
      replanContext,
    }), {
      onRetry: (attempt, error) => {
        log.info("retrying replan compilation", { attempt, taskID: task.id, error: String(error) })
      },
    })
    return persistReplanTransition({
      task,
      previousPlan: plan,
      previousRun: run,
      nextPlanID: Identifier.ascending("plan"),
      nextRunID: Identifier.ascending("run"),
      now,
      summary,
      replanContext,
      compiled,
    })
  } catch (error) {
    if (!(error instanceof PlannerFailureError)) throw error
    return persistReplanTransitionFailure({
      task,
      now,
      error: `Planner failure: ${error.message}`,
    })
  }
}

type EvaluationStatus = "passed" | "failed" | "pending"
type EvaluationVerdict = "accepted" | "rejected"

export function beginEvaluation(input: {
  task: TaskRow
  run: RunRow
  goalRunID?: string
  deliveryID: string
  evaluationID: string
  now: number
  summary: string
}) {
  const existing = Database.use((db) =>
    db
      .select()
      .from(OrchestratorEvaluationTable)
      .where(eq(OrchestratorEvaluationTable.id, input.evaluationID))
      .get(),
  )
  if (existing) return existing
  Database.use((db) =>
    db
      .insert(OrchestratorEvaluationTable)
      .values({
        id: input.evaluationID,
        task_id: input.task.id,
        run_id: input.run.id,
        goal_run_id: input.goalRunID,
        delivery_id: input.deliveryID,
        status: "pending",
        verdict: "rejected",
        summary: input.summary,
        checks: [],
        time_created: input.now,
        time_updated: input.now,
      })
      .run(),
  )
  const row = Database.use((db) =>
    db
      .select()
      .from(OrchestratorEvaluationTable)
      .where(eq(OrchestratorEvaluationTable.id, input.evaluationID))
      .get(),
  )
  if (!row) throw new Error(`beginEvaluation: evaluation ${input.evaluationID} not found after insert`)
  return row
}

export function persistEvaluation(input: {
  task: TaskRow
  run: RunRow
  goalRunID?: string
  deliveryID: string
  evaluationID: string
  delivery: {
    summary: string
    diffs: Array<{ file: string; [key: string]: unknown }>
  }
  result: CheckReport
  analysis?: GoalJudgmentType
  analysisError?: string
  finalVerdict: string
  finalStatus: string
  finalSummary: string
  goals: GoalRow[]
  finalizeSpec?: boolean
}) {
  const now = Date.now()
  const evaluation = {
    id: input.evaluationID,
    status: input.finalStatus as EvaluationStatus,
    verdict: input.finalVerdict as EvaluationVerdict,
    summary: input.finalSummary,
    checks: input.result.checks.map((item) => ({
      name: item.name,
      status: item.status,
      evidence: item.evidence,
      label: item.label,
      family: item.family,
    })),
  }
  Database.transaction((db) => {
    const existing = db
      .select()
      .from(OrchestratorEvaluationTable)
      .where(eq(OrchestratorEvaluationTable.id, input.evaluationID))
      .get()
    if (existing) {
      db.update(OrchestratorEvaluationTable)
        .set({
          task_id: input.task.id,
          run_id: input.run.id,
          goal_run_id: input.goalRunID,
          delivery_id: input.deliveryID,
          status: input.finalStatus as EvaluationStatus,
          verdict: input.finalVerdict as EvaluationVerdict,
          summary: input.finalSummary,
          checks: input.result.checks,
          time_completed: now,
          time_updated: now,
        })
        .where(eq(OrchestratorEvaluationTable.id, input.evaluationID))
        .run()
    } else {
      db.insert(OrchestratorEvaluationTable)
        .values({
          id: input.evaluationID,
          task_id: input.task.id,
          run_id: input.run.id,
          goal_run_id: input.goalRunID,
          delivery_id: input.deliveryID,
          status: input.finalStatus as EvaluationStatus,
          verdict: input.finalVerdict as EvaluationVerdict,
          summary: input.finalSummary,
          checks: input.result.checks,
          time_completed: now,
          time_created: now,
          time_updated: now,
        })
        .run()
    }
    for (const artifact of input.result.artifacts) {
      db.insert(OrchestratorArtifactTable)
        .values({
          id: Identifier.ascending("artifact"),
          task_id: input.task.id,
          run_id: input.run.id,
          goal_run_id: input.goalRunID,
          delivery_id: input.deliveryID,
          kind: artifact.kind as typeof OrchestratorArtifactTable.$inferInsert.kind,
          label: artifact.label,
          payload: artifact.payload,
          time_created: now,
          time_updated: now,
        })
        .run()
    }
    if (input.analysisError) {
      db.insert(OrchestratorArtifactTable)
        .values({
          id: Identifier.ascending("artifact"),
          task_id: input.task.id,
          run_id: input.run.id,
          goal_run_id: input.goalRunID,
          delivery_id: input.deliveryID,
          kind: "report",
          label: "evaluator-agent-error",
          payload: { error: input.analysisError, analysis_failed: true },
          time_created: now,
          time_updated: now,
        })
        .run()
    }
    if (input.analysis) {
      db.insert(OrchestratorArtifactTable)
        .values({
          id: Identifier.ascending("artifact"),
          task_id: input.task.id,
          run_id: input.run.id,
          goal_run_id: input.goalRunID,
          delivery_id: input.deliveryID,
          kind: "report",
          label: "evaluator-agent-analysis",
          payload: input.analysis as unknown as Record<string, unknown>,
          time_created: now,
          time_updated: now,
        })
        .run()
    }
    if (input.goals.length > 0) {
      const now2 = Date.now()
      const analysisGoals = Array.isArray(input.analysis?.goal_statuses) ? input.analysis.goal_statuses : []
      const goalStatuses =
        input.goalRunID && input.goals.length === 1 && analysisGoals.length === 0
          ? [{
              goal_index: 0,
              status: input.finalStatus === "passed" ? "passed" as const : "failed" as const,
              evidence: input.finalSummary,
            }]
          : analysisGoals
      for (const gs of goalStatuses) {
        const goal =
          input.goalRunID && input.goals.length === 1
            ? input.goals[0]
            : input.goals[gs.goal_index]
        if (!goal) continue
        let goalStatus =
          input.goalRunID && input.goals.length === 1
            ? input.finalStatus === "passed"
              ? "passed" as const
              : input.finalStatus === "failed"
                ? "failed" as const
                : undefined
            : gs.status === "passed"
              ? "passed" as const
              : gs.status === "failed"
                ? "failed" as const
                : undefined
        if (!goalStatus && input.goalRunID && input.goals.length === 1 && input.finalStatus === "failed") {
          goalStatus = "failed"
        }
        if (goalStatus === "passed" && !(input.goalRunID && input.goals.length === 1)) {
          const selectors = selectorList(goal.metadata)
          if (selectors.length > 0) {
            const allSelectorsPassed = selectorsSatisfied(selectors, input.result.checks)
            if (!allSelectorsPassed) {
              goalStatus = undefined
            }
          }
        }
        if (!goalStatus || goal.status === goalStatus) continue
        db.update(OrchestratorGoalTable)
          .set({ status: goalStatus, time_updated: now2 })
          .where(eq(OrchestratorGoalTable.id, goal.id))
          .run()
        if (goalStatus === "passed") {
          Database.effect(() =>
            OrchestratorProtocol.emit(Event.GoalPassed, { taskID: input.task.id, goalID: goal.id, summary: goal.description }, { source: "persist.evaluation" }),
          )
        } else if (goalStatus === "failed") {
          Database.effect(() =>
            OrchestratorProtocol.emit(Event.GoalFailed, { taskID: input.task.id, goalID: goal.id, summary: `${goal.description}: ${gs.evidence}` }, { source: "persist.evaluation" }),
          )
        }
      }
      if (input.run.plan_version_id) {
        deriveMilestoneStatuses(db, input.task.id, input.run.plan_version_id, now2)
      }
    }
    if (input.finalizeSpec !== false && input.task.active_spec_version_id) {
      const requirements = findRequirements(input.task.active_spec_version_id)
      const now3 = Date.now()
      const blockingRequirements = requirements.filter((item) => item.priority === "blocking")
      const scopedRequirements = blockingRequirements.length > 0 ? blockingRequirements : requirements
      if (scopedRequirements.length > 0) {
        // Per-requirement status: derive from covering goals' assessment
        const analysisGoals = Array.isArray(input.analysis?.goal_statuses) ? input.analysis.goal_statuses : []
        // Map: requirement DB ID → goal indices that cover it
        const goalIndicesByRequirement = new Map<string, number[]>()
        for (let gi = 0; gi < input.goals.length; gi++) {
          const meta = input.goals[gi]?.metadata
          const reqIDs = meta && typeof meta === "object" && !Array.isArray(meta)
            ? (Array.isArray((meta as Record<string, unknown>).requirement_ids)
              ? ((meta as Record<string, unknown>).requirement_ids as unknown[]).filter((id): id is string => typeof id === "string")
              : [])
            : []
          for (const reqID of reqIDs) {
            const list = goalIndicesByRequirement.get(reqID) ?? []
            list.push(gi)
            goalIndicesByRequirement.set(reqID, list)
          }
        }
        for (const requirement of scopedRequirements) {
          const coveringIndices = goalIndicesByRequirement.get(requirement.id) ?? []
          let requirementStatus: "pending" | "passed" | "failed" | undefined
          if (coveringIndices.length > 0 && analysisGoals.length > 0) {
            // Derive from covering goals' statuses
            const goalStatuses = coveringIndices.map((gi) => {
              const gs = analysisGoals.find((a) => a.goal_index === gi)
              return gs?.status ?? "inconclusive"
            })
            if (goalStatuses.every((s) => s === "passed")) {
              requirementStatus = "passed"
            } else if (goalStatuses.some((s) => s === "failed")) {
              requirementStatus = "failed"
            }
          } else {
            // No goal→requirement mapping: fall back to verdict-level status
            requirementStatus = input.finalVerdict === "accepted" ? "passed" : "failed"
          }
          if (requirementStatus && requirement.status !== requirementStatus) {
            db.update(OrchestratorRequirementTable)
              .set({ status: requirementStatus, time_updated: now3 })
              .where(eq(OrchestratorRequirementTable.id, requirement.id))
              .run()
          }
        }
        if (input.finalVerdict === "accepted") {
          db.update(OrchestratorSpecSnapshotTable)
            .set({ status: "completed", time_updated: now3 })
            .where(eq(OrchestratorSpecSnapshotTable.id, input.task.active_spec_version_id))
            .run()
        }
      }
    }
    Database.effect(() =>
      OrchestratorProtocol.emit(Event.EvaluationCompleted, {
        taskID: input.task.id,
        runID: input.run.id,
        evaluationID: input.evaluationID,
        status: input.finalStatus as EvaluationStatus,
        verdict: input.finalVerdict as EvaluationVerdict,
        summary: input.finalSummary,
      }, { source: "persist.evaluation" }),
    )
  })
  const plan = input.run.plan_version_id ? findPlan(input.run.plan_version_id) : undefined
  writeEvaluationSnapshot({
    task: input.task,
    run: input.run,
    goalRunID: input.goalRunID,
    evaluation,
    goals: input.goals,
    analysis: input.analysis,
    delivery: input.delivery,
    createdAt: now,
  })
  if (plan) {
    writeGoalSnapshot({
      task: input.task,
      plan,
      goals: listGoalsForPlan(plan),
      milestones: listMilestonesByPlan(plan.id),
      createdAt: now,
    })
  }
}

export function persistDelivery(input: {
  task: TaskRow
  run: RunRow
  goalRunID?: string
  deliveryID: string
  delivery: {
    summary: string
    diffs: Array<{ file: string; [key: string]: unknown }>
  }
  now: number
}) {
  Database.transaction((db) => {
    db.insert(OrchestratorDeliveryTable)
      .values({
        id: input.deliveryID,
        task_id: input.task.id,
        run_id: input.run.id,
        goal_run_id: input.goalRunID,
        status: "candidate",
        summary: input.delivery.summary,
        result: {
          summary: input.delivery.summary,
          changed_files: input.delivery.diffs.map((item) => item.file),
          diffs: input.delivery.diffs,
        },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    db.insert(OrchestratorArtifactTable)
      .values({
        id: Identifier.ascending("artifact"),
        task_id: input.task.id,
        run_id: input.run.id,
        goal_run_id: input.goalRunID,
        delivery_id: input.deliveryID,
        kind: "report",
        label: "assistant-summary",
        payload: { summary: input.delivery.summary },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    if (input.delivery.diffs.length > 0) {
      db.insert(OrchestratorArtifactTable)
        .values({
          id: Identifier.ascending("artifact"),
          task_id: input.task.id,
          run_id: input.run.id,
          goal_run_id: input.goalRunID,
          delivery_id: input.deliveryID,
          kind: "diff",
          label: "workspace-diff",
          payload: { diffs: input.delivery.diffs },
          time_created: input.now,
          time_updated: input.now,
        })
        .run()
    }
    for (const item of input.delivery.diffs) {
      db.insert(OrchestratorArtifactTable)
        .values({
          id: Identifier.ascending("artifact"),
          task_id: input.task.id,
          run_id: input.run.id,
          goal_run_id: input.goalRunID,
          delivery_id: input.deliveryID,
          kind: "changed_file",
          label: item.file,
          payload: item,
          time_created: input.now,
          time_updated: input.now,
        })
        .run()
    }
    Database.effect(() =>
      OrchestratorProtocol.emit(Event.DeliveryReady, { taskID: input.task.id, runID: input.run.id, deliveryID: input.deliveryID, summary: input.delivery.summary }, { source: "persist.delivery" }),
    )
  })
}

export function persistFailedRunEvaluation(input: {
  task: TaskRow
  run: RunRow
  goalRunID?: string
  error: string
  now: number
}) {
  const evaluationID = Identifier.ascending("evaluation")
  Database.use((db) =>
    db
      .insert(OrchestratorEvaluationTable)
      .values({
        id: evaluationID,
        task_id: input.task.id,
        run_id: input.run.id,
        goal_run_id: input.goalRunID,
        status: "failed",
        verdict: "rejected",
        summary: input.error,
        checks: [
          {
            name: "executor_completion",
            status: "failed",
            evidence: input.error,
          },
        ],
        time_completed: input.now,
        time_created: input.now,
        time_updated: input.now,
      })
      .run(),
  )
  writeEvaluationSnapshot({
    task: input.task,
    run: input.run,
    goalRunID: input.goalRunID,
    evaluation: {
      id: evaluationID,
      status: "failed",
      verdict: "rejected",
      summary: input.error,
      checks: [
        {
          name: "executor_completion",
          status: "failed",
          evidence: input.error,
        },
      ],
    },
    goals: (() => {
      const plan = input.run.plan_version_id ? findPlan(input.run.plan_version_id) : undefined
      return plan ? listGoalsForPlan(plan) : []
    })(),
    createdAt: input.now,
  })
}

export function failGoals(run: RunRow, summary: string) {
  const planVersionID = run.plan_version_id
  if (!planVersionID) return
  const plan = findPlan(planVersionID)
  if (!plan) return
  const goals = listGoalsForPlan(plan)
  if (goals.length === 0) return
  const now = Date.now()
  Database.use((db) =>
    db
      .update(OrchestratorGoalTable)
      .set({
        status: "failed",
        time_updated: now,
      })
      .where(and(
        inArray(OrchestratorGoalTable.id, goals.map((goal) => goal.id)),
        ne(OrchestratorGoalTable.status, "passed"),
      ))
      .run(),
  )
  const task = findTask(run.task_id)
  if (task && plan) {
    writeGoalSnapshot({
      task,
      plan,
      goals: listGoalsForPlan(plan),
      milestones: listMilestonesByPlan(planVersionID),
      createdAt: now,
    })
  }
  for (const goal of goals) {
    OrchestratorProtocol.emit(Event.GoalFailed, {
      taskID: run.task_id,
      goalID: goal.id,
      summary: `${goal.description}: ${summary}`,
    }, { source: "persist.failed_run" })
  }
}

function claimExecutorSessionLeaseWhere(id: string, now: number) {
  const owner = executorLeaseOwner()
  return and(
    eq(OrchestratorExecutorSessionTable.id, id),
    eq(OrchestratorExecutorSessionTable.status, "active"),
    or(
      eq(OrchestratorExecutorSessionTable.lease_owner, owner),
      isNull(OrchestratorExecutorSessionTable.lease_owner),
      lte(OrchestratorExecutorSessionTable.lease_until, now),
    ),
  )
}

function leaseWindow(now: number) {
  return {
    lease_owner: executorLeaseOwner(),
    lease_until: executorLeaseUntil(now),
    time_updated: now,
  }
}

function executorLeaseConflict(row: typeof OrchestratorExecutorSessionTable.$inferSelect | undefined, now: number) {
  if (!row) return ""
  if (executorLeaseHeldByOther(row, now)) {
    return `executor session ${row.id} is leased by ${row.lease_owner} until ${row.lease_until}`
  }
  if (row.status !== "active") {
    return `executor session ${row.id} is not active (${row.status})`
  }
  if (!executorLeaseAvailable(row, now) && row.lease_owner !== executorLeaseOwner()) {
    return `executor session ${row.id} lease is unavailable`
  }
  return `executor session ${row.id} could not be claimed`
}

export function claimExecutorSessionLease(input: { executorSessionID: string; now?: number }) {
  const now = input.now ?? Date.now()
  return Database.use((db) =>
    db
      .update(OrchestratorExecutorSessionTable)
      .set(leaseWindow(now))
      .where(claimExecutorSessionLeaseWhere(input.executorSessionID, now))
      .returning()
      .get(),
  )
}

export function ensureExecutorSession(input: {
  taskID: string
  runID: string
  goalRunID?: string
  provider: RunRow["executor"]
  refs?: ProtocolRefsInfo
  capabilities?: ProtocolCapabilitiesInfo
  settings?: ProtocolSettingsInfo
  started?: number
}) {
  const existing = Database.use((db) =>
    db
      .select()
      .from(OrchestratorExecutorSessionTable)
      .where(
        input.goalRunID
          ? eq(OrchestratorExecutorSessionTable.goal_run_id, input.goalRunID)
          : and(eq(OrchestratorExecutorSessionTable.run_id, input.runID), isNull(OrchestratorExecutorSessionTable.goal_run_id)),
      )
      .orderBy(desc(OrchestratorExecutorSessionTable.time_created))
      .get(),
  )
  const info = protocolInfo(input.provider)
  const now = Date.now()
  const refs = mergeRefs(existing?.refs ?? undefined, input.refs)
  const capabilities = input.capabilities ?? info.capabilities
  const settings = {
    ...(existing?.settings ?? {}),
    ...(input.settings ?? {}),
  }
  if (existing) {
    const updated = Database.use((db) =>
      db
        .update(OrchestratorExecutorSessionTable)
        .set({
          provider: input.provider,
          protocol: info.protocol,
          protocol_version: info.version,
          transport: ProtocolTransport.parse(info.transport).kind,
          status: "active",
          refs,
          capabilities,
          settings,
          lease_owner: executorLeaseOwner(),
          lease_until: executorLeaseUntil(now),
          time_started: existing.time_started ?? input.started ?? now,
          time_updated: now,
        })
        .where(claimExecutorSessionLeaseWhere(existing.id, now))
        .returning()
        .get(),
    )
    if (updated) return updated
    const blocked = Database.use((db) =>
      db
        .select()
        .from(OrchestratorExecutorSessionTable)
        .where(eq(OrchestratorExecutorSessionTable.id, existing.id))
        .get(),
    )
    throw new Error(`ensureExecutorSession: ${executorLeaseConflict(blocked, now)}`)
  }
  const id = Identifier.ascending("executor_session")
  Database.use((db) =>
    db
      .insert(OrchestratorExecutorSessionTable)
      .values({
        id,
        task_id: input.taskID,
        run_id: input.runID,
        goal_run_id: input.goalRunID,
        provider: input.provider,
        protocol: info.protocol,
        protocol_version: info.version,
        transport: ProtocolTransport.parse(info.transport).kind,
        status: "active",
        refs,
        capabilities,
        settings,
        lease_owner: executorLeaseOwner(),
        lease_until: executorLeaseUntil(now),
        time_started: input.started ?? now,
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
  const inserted = Database.use((db) =>
    db
      .select()
      .from(OrchestratorExecutorSessionTable)
      .where(eq(OrchestratorExecutorSessionTable.id, id))
      .get(),
  )
  if (!inserted) throw new Error(`ensureExecutorSession: executor session ${id} not found after insert`)
  return inserted
}

export function updateExecutorSessionStatus(runID: string, status: typeof OrchestratorExecutorSessionTable.$inferInsert.status) {
  const row = Database.use((db) =>
    db
      .select()
      .from(OrchestratorExecutorSessionTable)
      .where(eq(OrchestratorExecutorSessionTable.run_id, runID))
      .orderBy(desc(OrchestratorExecutorSessionTable.time_created))
      .get(),
  )
  if (!row) return
  Database.use((db) =>
    db
      .update(OrchestratorExecutorSessionTable)
      .set({
        status,
        lease_owner: null,
        lease_until: 0,
        time_completed: Date.now(),
        time_updated: Date.now(),
      })
      .where(eq(OrchestratorExecutorSessionTable.id, row.id))
      .run(),
  )
}

export function updateGoalRunExecutorSessionStatus(
  goalRunID: string,
  status: typeof OrchestratorExecutorSessionTable.$inferInsert.status,
) {
  const row = Database.use((db) =>
    db
      .select()
      .from(OrchestratorExecutorSessionTable)
      .where(eq(OrchestratorExecutorSessionTable.goal_run_id, goalRunID))
      .orderBy(desc(OrchestratorExecutorSessionTable.time_created))
      .get(),
  )
  if (!row) return
  Database.use((db) =>
    db
      .update(OrchestratorExecutorSessionTable)
      .set({
        status,
        lease_owner: null,
        lease_until: 0,
        time_completed: Date.now(),
        time_updated: Date.now(),
      })
      .where(eq(OrchestratorExecutorSessionTable.id, row.id))
      .run(),
  )
}

export function appendExecutorEvent(
  executorSessionID: string,
  taskID: string,
  runID: string,
  provider: RunRow["executor"],
  goalRunID: string | undefined,
  event: {
    provider: RunRow["executor"]
    kind: string
    summary?: string
    refs?: ProtocolRefsInfo
    payload?: Record<string, unknown>
    raw?: Record<string, unknown>
  },
) {
  const now = Date.now()
  const lease = claimExecutorSessionLease({
    executorSessionID,
    now,
  })
  if (!lease) {
    log.info("skipping executor event append because lease is owned by another runtime", {
      executorSessionID,
      runID,
      taskID,
    })
    return
  }
  const last = Database.use((db) =>
    db
      .select()
      .from(OrchestratorExecutorEventTable)
      .where(eq(OrchestratorExecutorEventTable.executor_session_id, executorSessionID))
      .orderBy(desc(OrchestratorExecutorEventTable.sequence))
      .get(),
  )
  const sequence = (last?.sequence ?? 0) + 1
  Database.use((db) =>
    db
      .insert(OrchestratorExecutorEventTable)
      .values({
        id: Identifier.ascending("executor_event"),
        executor_session_id: executorSessionID,
        task_id: taskID,
        run_id: runID,
        goal_run_id: goalRunID,
        sequence,
        kind: event.kind,
        summary: event.summary ?? null,
        refs: event.refs,
        payload: {
          provider,
          ...(event.payload ?? {}),
        },
        raw: event.raw,
        time_observed: now,
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}

export function renewExecutorSessionLease(input: { executorSessionID: string; now?: number }) {
  const now = input.now ?? Date.now()
  return Database.use((db) =>
    db
      .update(OrchestratorExecutorSessionTable)
      .set(leaseWindow(now))
      .where(
        and(
          eq(OrchestratorExecutorSessionTable.id, input.executorSessionID),
          eq(OrchestratorExecutorSessionTable.status, "active"),
          eq(OrchestratorExecutorSessionTable.lease_owner, executorLeaseOwner()),
        ),
      )
      .returning()
      .get(),
  )
}


export function markDeliveryPublishing(deliveryId: string, now: number) {
  Database.use((db) =>
    db
      .update(OrchestratorDeliveryTable)
      .set({
        status: "publishing",
        time_updated: now,
      })
      .where(eq(OrchestratorDeliveryTable.id, deliveryId))
      .run(),
  )
}

export function finalizeDeliveryResult(input: {
  deliveryId: string
  taskId: string
  runId: string
  delivery: { result?: Record<string, unknown> | null }
  result: {
    status: OrchestratorDeliveryStatus
    summary: string
    artifacts: Array<{ kind: OrchestratorArtifactKind; label: string; payload: Record<string, unknown> }>
    publish: unknown
  }
  now: number
}) {
  Database.transaction((db) => {
    db.update(OrchestratorDeliveryTable)
      .set({
        status: input.result.status,
        summary: input.result.summary,
        result: {
          ...(input.delivery.result ?? {}),
          summary: input.result.summary,
          artifacts: input.result.artifacts.map((item) => ({
            kind: item.kind,
            label: item.label,
          })),
          publish: input.result.publish,
        },
        time_updated: input.now,
      })
      .where(eq(OrchestratorDeliveryTable.id, input.deliveryId))
      .run()
    for (const artifact of input.result.artifacts) {
      db.insert(OrchestratorArtifactTable)
        .values({
          id: Identifier.ascending("artifact"),
          task_id: input.taskId,
          run_id: input.runId,
          delivery_id: input.deliveryId,
          kind: artifact.kind,
          label: artifact.label,
          payload: artifact.payload,
          time_created: input.now,
          time_updated: input.now,
        })
        .run()
    }
  })
}

function deriveMilestoneStatuses(db: Parameters<Parameters<typeof Database.transaction>[0]>[0], taskID: string, planVersionID: string, now: number) {
  const milestones = listMilestonesByPlan(planVersionID)
  if (milestones.length === 0) return
  const plan = findPlan(planVersionID)
  if (!plan) return
  const goals = listGoalsForPlan(plan)
  for (const ms of milestones) {
    const indices = Array.isArray(ms.metadata?.goal_indices)
      ? ms.metadata.goal_indices.filter((item): item is number => typeof item === "number")
      : []
    const msGoals = indices.length > 0
      ? indices.map((index) => goals[index]).filter((goal): goal is GoalRow => !!goal)
      : []
    const next = deriveMilestoneStatus(msGoals)
    if (next === ms.status) continue
    db.update(OrchestratorMilestoneTable)
      .set({ status: next, time_updated: now })
      .where(eq(OrchestratorMilestoneTable.id, ms.id))
      .run()
    if (next === "passed") {
      Database.effect(() => OrchestratorProtocol.emit(Event.MilestonePassed, { taskID, milestoneID: ms.id, summary: ms.title }, { source: "persist.milestone" }))
    } else if (next === "failed") {
      Database.effect(() => OrchestratorProtocol.emit(Event.MilestoneFailed, { taskID, milestoneID: ms.id, summary: ms.title }, { source: "persist.milestone" }))
    } else if (next === "active") {
      Database.effect(() => OrchestratorProtocol.emit(Event.MilestoneActivated, { taskID, milestoneID: ms.id, summary: ms.title }, { source: "persist.milestone" }))
    }
  }
}

function deriveMilestoneStatus(goals: GoalRow[]): OrchestratorMilestoneStatus {
  if (goals.length === 0) return "passed"
  const blocking = goals.filter((g) => g.priority === "blocking")
  if (blocking.some((g) => g.status === "failed")) return "failed"
  if (blocking.every((g) => g.status === "passed")) return "passed"
  if (goals.some((g) => g.status === "passed")) return "active"
  return "pending"
}

function mergeRefs(current?: ProtocolRefsInfo, next?: ProtocolRefsInfo) {
  if (!current && !next) return undefined
  const result = {
    ...(current ?? {}),
    ...(next ?? {}),
  }
  return Object.keys(result).length > 0 ? result : undefined
}

// ---------------------------------------------------------------------------
// Legacy compat: insertSpecItems (used by executor-planner flow in service.ts)
// ---------------------------------------------------------------------------

export function insertSpecItems(
  db: Database.TxOrDb,
  input: {
    taskID: string
    specSnapshotID: string
    specItems: unknown[]
    now: number
  },
) {
  for (const raw of input.specItems) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue
    const item = raw as Record<string, unknown>
    if (typeof item.title !== "string" || typeof item.description !== "string") continue
    const checks = Array.isArray(item.check_selector)
      ? item.check_selector.filter((value): value is string => typeof value === "string")
      : undefined
    db.insert(OrchestratorSpecItemTable)
      .values({
        id: Identifier.ascending("specitem"),
        task_id: input.taskID,
        spec_snapshot_id: input.specSnapshotID,
        title: item.title,
        description: item.description,
        status: "pending",
        priority: item.priority === "advisory" ? "advisory" : "blocking",
        check_selector: checks && checks.length > 0 ? checks : null,
        metadata: {},
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
  }
}
