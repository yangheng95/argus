import z from "zod"
import { Bus } from "@/bus"
import { Identifier } from "@/id/id"
import { type EvaluatorAnalysisType } from "@/evaluator/agent"
import { ExecutorPlanner } from "@/planner/executor"
import { type ReplanContext } from "@/planner/agent"
import { PlannerFailureError, PlannerService, type PlanDraft } from "@/planner/service"
import { installRuntimeShims } from "@/runtime/shims"
import { writeSpec } from "@/orchestrator/spec"
import { SpecService } from "@/spec/service"
import { Database, eq } from "@/storage/db"
import { Log } from "@/util/log"
import { budgetRow } from "./helpers"
import { CreateTaskInput, Event } from "./model"
import {
  OrchestratorChannelBindingTable,
  OrchestratorGoalTable,
  OrchestratorMilestoneTable,
  OrchestratorPlanVersionTable,
  OrchestratorProgressSnapshotTable,
  OrchestratorRunTable,
  OrchestratorSpecItemTable,
  OrchestratorSpecSnapshotTable,
  OrchestratorTaskTable,
} from "./orchestrator.sql"
import { plannerClarification } from "./planner-clarification"
import { type GoalRow, type PlanRow, type RunRow, type TaskRow } from "./store"

const log = Log.create({ service: "orchestrator-transition" })

type GoalInput = {
  description: string
  criteria: string
  priority?: "blocking" | "advisory"
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

type SpecDraft = Awaited<ReturnType<typeof SpecService.initial>>

export type TransitionMode = "initial" | "replan"

type CompileInitialInput = {
  mode: "initial"
  taskID: string
  now: number
  title: string
  request: string
  goals?: GoalInput[]
  executor: RunRow["executor"]
  routing?: RoutingInput
  metadata: Record<string, unknown>
}

type CompileReplanInput = {
  mode: "replan"
  taskID: string
  now: number
  title: string
  request: string
  goals: GoalInput[]
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
  specDraft?: SpecDraft
  planDraft: PlanDraft
  specMeta?: ReturnType<typeof writeSpec>
  taskMetadata: Record<string, unknown>
  planMetadata: Record<string, unknown>
}

type PlannerFailureWithSpec = PlannerFailureError & {
  specDraft?: SpecDraft
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

export async function compileTransition(input: CompileTransitionInput): Promise<CompileTransitionResult> {
  installRuntimeShims()
  const specDraft = await compileSpec(input)
  const planDraft = await (
    input.mode === "initial"
      ? PlannerService.initial({
          title: input.title,
          request: input.request,
          spec: specDraft,
          goals: input.goals,
          executor: input.executor,
          routing: input.routing,
        })
      : PlannerService.replan({
          title: input.title,
          request: input.request,
          spec: specDraft,
          goals: input.goals,
          previousPrompt: input.previousPlan.prompt,
          previousPlanID: input.previousPlan.id,
          failureSummary: input.failureSummary,
          replanContext: input.replanContext,
          executor: input.executor,
          routing: input.routing,
        })
  ).catch((error) => {
    if (!(error instanceof PlannerFailureError)) throw error
    const next = error as PlannerFailureWithSpec
    next.specDraft = specDraft
    throw next
  })
  const clarification = plannerClarification(planDraft)
  if (clarification) {
    log.info(`${input.mode}: planner requested clarification, auto-skipping`, {
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
    planDraft,
    specMeta,
    taskMetadata,
    planMetadata,
  }
}

export function specDraftFromFailure(error: unknown) {
  if (!(error instanceof PlannerFailureError)) return
  return (error as PlannerFailureWithSpec).specDraft
}

export function persistInitialTransition(input: PersistInitialInput) {
  const specSnapshotID = input.compiled.specDraft ? Identifier.ascending("spec") : undefined
  Database.transaction((db) => {
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
        status: "queued",
        priority: input.priority ?? "normal",
        budget: budgetRow(input.budget),
        metadata: input.compiled.taskMetadata,
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    persistSpecSnapshot(db, {
      taskID: input.taskID,
      specSnapshotID,
      version: 1,
      specDraft: input.compiled.specDraft,
      now: input.now,
    })
    db.insert(OrchestratorPlanVersionTable)
      .values({
        id: input.planID,
        task_id: input.taskID,
        version: 1,
        status: "active",
        summary: input.compiled.planDraft.summary,
        prompt: input.compiled.planDraft.prompt,
        metadata: input.compiled.planMetadata,
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    insertPlanItems(db, {
      taskID: input.taskID,
      planID: input.planID,
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
        status: "queued",
        phase: "execute",
        retry_count: 0,
        metadata: {
          ...(input.compiled.planDraft.metadata?.stage_sources
            ? { stage_sources: input.compiled.planDraft.metadata.stage_sources }
            : {}),
        },
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
        summary: "Task created",
        payload: { sessionID: input.sessionID },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    Database.effect(() => Bus.publish(Event.TaskCreated, { taskID: input.taskID, status: "queued", summary: "Task created" }))
    if (specSnapshotID && input.compiled.specDraft) {
      Database.effect(() =>
        Bus.publish(Event.SpecCreated, {
          taskID: input.taskID,
          specID: specSnapshotID,
          summary: input.compiled.specDraft!.summary,
        }),
      )
    }
    Database.effect(() =>
      Bus.publish(Event.PlanCreated, {
        taskID: input.taskID,
        planID: input.planID,
        summary: input.compiled.planDraft.summary,
      }),
    )
    Database.effect(() =>
      Bus.publish(Event.PlanActivated, {
        taskID: input.taskID,
        planID: input.planID,
        summary: "Initial plan activated",
      }),
    )
    Database.effect(() =>
      Bus.publish(Event.RunCreated, {
        taskID: input.taskID,
        runID: input.runID,
        status: "queued",
        summary: "Run queued",
      }),
    )
  })
  return {
    queued: true,
    runID: input.runID,
  }
}

export function persistInitialTransitionFailure(input: PersistInitialFailureInput) {
  const specSnapshotID = input.specDraft ? Identifier.ascending("spec") : undefined
  Database.transaction((db) => {
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
    persistSpecSnapshot(db, {
      taskID: input.taskID,
      specSnapshotID,
      version: 1,
      specDraft: input.specDraft,
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
    Database.effect(() => Bus.publish(Event.TaskCreated, { taskID: input.taskID, status: "failed", summary: "Task created" }))
    if (specSnapshotID && input.specDraft) {
      Database.effect(() =>
        Bus.publish(Event.SpecCreated, {
          taskID: input.taskID,
          specID: specSnapshotID,
          summary: input.specDraft!.summary,
        }),
      )
    }
    Database.effect(() =>
      Bus.publish(Event.RunCreated, {
        taskID: input.taskID,
        runID: input.runID,
        status: "failed",
        summary: "Planning failed",
      }),
    )
    Database.effect(() =>
      Bus.publish(Event.TaskUpdated, {
        taskID: input.taskID,
        status: "failed",
        summary: "Planning failed before execution",
      }),
    )
  })
}

export function persistReplanTransition(input: PersistReplanInput): ReplanQueueResult {
  const specSnapshotID = input.compiled.specDraft ? Identifier.ascending("spec") : undefined
  const nextVersion = input.previousPlan.version + 1
  Database.transaction((db) => {
    persistSpecSnapshot(db, {
      taskID: input.task.id,
      specSnapshotID,
      version: nextVersion,
      specDraft: input.compiled.specDraft,
      now: input.now,
    })
    db.update(OrchestratorPlanVersionTable)
      .set({
        status: "superseded",
        time_updated: input.now,
      })
      .where(eq(OrchestratorPlanVersionTable.id, input.previousPlan.id))
      .run()
    db.insert(OrchestratorPlanVersionTable)
      .values({
        id: input.nextPlanID,
        task_id: input.task.id,
        version: nextVersion,
        status: "active",
        summary: input.compiled.planDraft.summary,
        prompt: input.compiled.planDraft.prompt,
        metadata: input.compiled.planMetadata,
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    insertPlanItems(db, {
      taskID: input.task.id,
      planID: input.nextPlanID,
      planDraft: input.compiled.planDraft,
      now: input.now,
      milestones: [],
    })
    db.insert(OrchestratorRunTable)
      .values({
        id: input.nextRunID,
        task_id: input.task.id,
        plan_version_id: input.nextPlanID,
        session_id: input.previousRun.session_id,
        executor: input.previousRun.executor,
        status: "queued",
        phase: "replan",
        retry_count: 0,
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
        active_spec_version_id: specSnapshotID ?? input.task.active_spec_version_id,
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
    if (specSnapshotID && input.compiled.specDraft) {
      Database.effect(() =>
        Bus.publish(Event.SpecCreated, {
          taskID: input.task.id,
          specID: specSnapshotID,
          summary: input.compiled.specDraft!.summary,
        }),
      )
    }
    Database.effect(() =>
      Bus.publish(Event.PlanCreated, {
        taskID: input.task.id,
        planID: input.nextPlanID,
        summary: input.compiled.planDraft.summary,
      }),
    )
    Database.effect(() =>
      Bus.publish(Event.PlanActivated, {
        taskID: input.task.id,
        planID: input.nextPlanID,
        summary: "Replanned version activated",
      }),
    )
    Database.effect(() =>
      Bus.publish(Event.RunCreated, {
        taskID: input.task.id,
        runID: input.nextRunID,
        status: "queued",
        summary: "Run queued after replan",
      }),
    )
    Database.effect(() =>
      Bus.publish(Event.TaskUpdated, {
        taskID: input.task.id,
        status: "running",
        summary: "Replanning after evaluation failure",
      }),
    )
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
      Bus.publish(Event.TaskUpdated, {
        taskID: input.task.id,
        status: "failed",
        summary: input.error,
      }),
    )
  })
  return {
    queued: false,
    runID: undefined,
    error: input.error,
  }
}

export function buildReplanContext(input: {
  analysis?: EvaluatorAnalysisType
  goals: GoalRow[]
  summary: string
  previousSummary: string
}) {
  if (!input.analysis) return
  return {
    previousSummary: input.previousSummary,
    failureAnalysis: {
      classification: input.analysis.classification,
      summary: input.analysis.summary,
      rootCause: input.analysis.replan_guidance?.root_cause ?? input.summary,
      suggestedStrategy: input.analysis.replan_guidance?.suggested_strategy ?? "",
      avoidApproaches: input.analysis.replan_guidance?.avoid_approaches ?? [],
    },
    previousGoalStatuses: (Array.isArray(input.analysis.goal_statuses) ? input.analysis.goal_statuses : []).map((item) => {
      const goal = input.goals[item.goal_index]
      return {
        description: goal?.description ?? `Goal ${item.goal_index}`,
        status: item.status,
        evidence: item.evidence,
      }
    }),
  } satisfies ReplanContext
}

export function insertPlanItems(
  db: Database.TxOrDb,
  input: {
    taskID: string
    planID: string
    planDraft: {
      goals: GoalInput[]
      metadata?: Record<string, unknown>
    }
    now: number
    milestones: MilestoneInput[]
  },
) {
  let goalIndex = 0
  for (const [msIndex, ms] of input.milestones.entries()) {
    const msID = Identifier.ascending("milestone")
    db.insert(OrchestratorMilestoneTable)
      .values({
        id: msID,
        task_id: input.taskID,
        plan_version_id: input.planID,
        title: ms.title,
        description: ms.description ?? "",
        status: "pending",
        order_index: msIndex,
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    for (const goal of ms.goals) {
      db.insert(OrchestratorGoalTable)
        .values({
          id: Identifier.ascending("goal"),
          task_id: input.taskID,
          plan_version_id: input.planID,
          milestone_id: msID,
          description: goal.description,
          criteria: goal.criteria,
          metadata: goal.metadata ?? inferGoalMetadata(goal.description, goal.criteria),
          priority: goal.priority ?? "blocking",
          status: "pending",
          order_index: goalIndex++,
          time_created: input.now,
          time_updated: input.now,
        })
        .run()
    }
  }
  const agentMilestones = Array.isArray(input.planDraft.metadata?.milestones)
    ? input.planDraft.metadata.milestones as Array<{ title: string; description?: string; goal_indices: number[] }>
    : undefined
  const goalToMilestoneID = new Map<number, string>()
  if (agentMilestones && agentMilestones.length > 0 && input.milestones.length === 0) {
    for (const [msIndex, ms] of agentMilestones.entries()) {
      const msID = Identifier.ascending("milestone")
      db.insert(OrchestratorMilestoneTable)
        .values({
          id: msID,
          task_id: input.taskID,
          plan_version_id: input.planID,
          title: ms.title,
          description: ms.description ?? "",
          status: "pending",
          order_index: msIndex,
          time_created: input.now,
          time_updated: input.now,
        })
        .run()
      for (const goalIndex of (Array.isArray(ms.goal_indices) ? ms.goal_indices : [])) {
        goalToMilestoneID.set(goalIndex, msID)
      }
    }
  }
  for (const [index, goal] of input.planDraft.goals.entries()) {
    db.insert(OrchestratorGoalTable)
      .values({
        id: Identifier.ascending("goal"),
        task_id: input.taskID,
        plan_version_id: input.planID,
        milestone_id: goalToMilestoneID.get(index) ?? null,
        description: goal.description,
        criteria: goal.criteria,
        metadata: goal.metadata ?? inferGoalMetadata(goal.description, goal.criteria),
        priority: goal.priority ?? "blocking",
        status: "pending",
        order_index: input.milestones.length > 0 ? goalIndex + index : index,
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
  }
}

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

async function compileSpec(input: CompileTransitionInput) {
  try {
    const specRoute = input.routing?.spec ?? "opencorvus"
    if (specRoute === "executor" && input.executor !== "opencode" && ExecutorPlanner.supports(input.executor, "spec")) {
      const raw = await ExecutorPlanner.spec({
        executor: input.executor,
        title: input.title,
        request: input.request,
        goals: input.goals,
        ...(input.mode === "replan" ? { replanContext: input.replanContext } : {}),
      })
      return { ...raw, spec_items: [], evidence_sources: [], unresolved_questions: [] }
    }
    if (input.mode === "replan" && input.replanContext) {
      return SpecService.rewrite({
        title: input.title,
        request: input.request,
        goals: input.goals,
        rewriteContext: {
          previousSpec: input.replanContext.previousSummary,
          failureAnalysis: input.replanContext.failureAnalysis,
          previousGoalStatuses: input.replanContext.previousGoalStatuses,
        },
      })
    }
    return SpecService.initial({
      title: input.title,
      request: input.request,
      goals: input.goals,
    })
  } catch (error) {
    log.warn(input.mode === "initial" ? "spec agent failed, proceeding to plan without spec" : "spec rewrite failed during replan, proceeding without spec", {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function persistSpecSnapshot(
  db: Database.TxOrDb,
  input: {
    taskID: string
    specSnapshotID?: string
    version: number
    specDraft?: SpecDraft
    now: number
  },
) {
  if (!input.specSnapshotID || !input.specDraft) return
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
  insertSpecItems(db, {
    taskID: input.taskID,
    specSnapshotID: input.specSnapshotID,
    specItems: input.specDraft.spec_items ?? [],
    now: input.now,
  })
}

function inferGoalMetadata(description: string, criteria: string) {
  const text = `${description} ${criteria}`.toLowerCase()
  const selectors = new Set<string>()
  if (text.includes("build")) selectors.add("build")
  if (text.includes("test")) selectors.add("test")
  if (text.includes("lint")) selectors.add("lint")
  if (text.includes("verify")) selectors.add("verify_cmd")
  if (/(ui|ux|design|layout|页面|界面|交互|体验|accessibility)/.test(text)) selectors.add("ui_review")
  if (/(code quality|maintain|readab|review|refactor|代码质量|可维护|可读)/.test(text)) selectors.add("code_quality")
  if (/\bcr\b|code review|审查|代码评审|review finding|review comment/.test(text)) selectors.add("code_review")
  if (/(dead code|unused code|unused export|obsolete|stale branch|死代码|无用代码|废弃分支|清理旧代码)/.test(text)) selectors.add("dead_code_review")
  if (/(startup|start normally|starts normally|boot|launch|serve|server|启动|运行起来|正常启动)/.test(text)) selectors.add("startup")
  if (selectors.size === 0) return undefined
  return {
    check_selector: [...selectors],
  }
}
