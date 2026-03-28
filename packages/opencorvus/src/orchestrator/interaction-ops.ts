import z from "zod"
import { Bus } from "@/bus"
import { ExecutorRegistry } from "@/executor/registry"
import { PermissionNext } from "@/permission/next"
import { type ReplanContext } from "@/planner/agent"
import { PlannerService } from "@/planner/service"
import { writeSpec } from "@/orchestrator/spec"
import { Question } from "@/question"
import { Database, eq } from "@/storage/db"
import {
  OrchestratorGoalTable,
  OrchestratorInteractionRequestTable,
  OrchestratorPlanVersionTable,
  OrchestratorProgressSnapshotTable,
  OrchestratorRunTable,
  OrchestratorSpecSnapshotTable,
  OrchestratorTaskTable,
  type OrchestratorInteractionStatus,
} from "./orchestrator.sql"
import {
  CreateTaskInput,
  Event,
  GoalInput,
  RejectInteractionInput,
  ReplyInteractionInput,
} from "./model"
import { OrchestratorRuntime } from "./runtime"
import { hooks } from "./state"
import { insertPlanItems, insertSpecItems } from "./transition"
import {
  findPlan,
  listGoalsByPlan,
  listInteractions,
  requireInteraction,
  requireRun,
  requireTask,
  viewInteraction,
  type InteractionRow,
} from "./store"
import { Identifier } from "@/id/id"

function answersFromMessage(message?: string) {
  const text = message?.trim()
  if (!text) return
  return [[text]]
}

async function resolveProtocolInteraction(row: InteractionRow, input: z.infer<typeof ReplyInteractionInput>) {
  const run = requireRun(row.run_id)
  const executor = ExecutorRegistry.require(run.executor)
  if (!executor.resolve) throw new Error(`executor ${run.executor} does not support interaction resolution`)
  const payload = row.payload ?? {}
  const requestID = typeof payload.request_id === "string" ? payload.request_id : row.external_id
  const now = Date.now()

  if (row.request_type === "permission") {
    await executor.resolve({
      sessionID: run.session_id ?? undefined,
      queueTaskID: run.executor_ref?.queue_task_id,
      requestID,
      kind: "approval",
      response: {
        decision: input.reply === "always" ? "acceptForSession" : "accept",
      },
    })
    markProtocolInteraction(row, "answered", {
      reply: input.reply ?? "once",
      message: input.message,
    }, now)
    return
  }

  const questions = Array.isArray(payload.questions)
    ? payload.questions.flatMap((item) => {
        if (!item || typeof item !== "object") return []
        const next = item as Record<string, unknown>
        if (typeof next.id !== "string" || !next.id) return []
        return [next.id]
      })
    : []
  const answers = input.answers ?? answersFromMessage(input.message)
  if (!answers) throw new Error("answers or message are required for protocol input replies")
  const response = Object.fromEntries(
    questions.map((id, index) => [id, { answers: answers[index] ?? answers[0] ?? [] }]),
  )
  await executor.resolve({
    sessionID: run.session_id ?? undefined,
    queueTaskID: run.executor_ref?.queue_task_id,
    requestID,
    kind: "input",
    response: {
      answers: response,
    },
  })
  markProtocolInteraction(row, "answered", {
    answers: response,
    message: input.message,
  }, now)
}

async function rejectProtocolInteraction(row: InteractionRow, message?: string) {
  const run = requireRun(row.run_id)
  const executor = ExecutorRegistry.require(run.executor)
  if (!executor.resolve) throw new Error(`executor ${run.executor} does not support interaction resolution`)
  const payload = row.payload ?? {}
  const requestID = typeof payload.request_id === "string" ? payload.request_id : row.external_id
  const now = Date.now()
  if (row.request_type === "permission") {
    await executor.resolve({
      sessionID: run.session_id ?? undefined,
      queueTaskID: run.executor_ref?.queue_task_id,
      requestID,
      kind: "approval",
      response: {
        decision: "decline",
      },
    })
    markProtocolInteraction(row, "rejected", { message }, now)
    return
  }
  await executor.resolve({
    sessionID: run.session_id ?? undefined,
    queueTaskID: run.executor_ref?.queue_task_id,
    requestID,
    kind: "input",
    error: {
      code: -32000,
      message: message?.trim() || "Rejected by operator",
    },
  })
  markProtocolInteraction(row, "rejected", { message }, now)
}

function markProtocolInteraction(
  row: InteractionRow,
  status: OrchestratorInteractionStatus,
  response: Record<string, unknown>,
  now: number,
) {
  Database.transaction((db) => {
    db.update(OrchestratorInteractionRequestTable)
      .set({
        status,
        response,
        time_resolved: now,
        time_updated: now,
      })
      .where(eq(OrchestratorInteractionRequestTable.id, row.id))
      .run()
    Database.effect(() =>
      Bus.publish(Event.InteractionResolved, {
        taskID: row.task_id,
        runID: row.run_id,
        interactionID: row.id,
        status,
        summary: status === "answered" ? "Interaction answered" : "Interaction rejected",
      }),
    )
  })
}

function isPlannerClarification(row: InteractionRow) {
  return row.payload?.planner_clarification === true
}

async function answerPlannerClarification(row: InteractionRow, answers: string[][]) {
  const task = requireTask(row.task_id)
  const run = requireRun(row.run_id)
  const clarifiedRequest = appendClarification(task.request, row.payload?.questions, answers)
  const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
    ? row.payload as Record<string, unknown>
    : {}
  const provisional = payload.provisional_plan && typeof payload.provisional_plan === "object" && !Array.isArray(payload.provisional_plan)
    ? payload.provisional_plan as Record<string, unknown>
    : {}
  const provisionalMeta = provisional.metadata && typeof provisional.metadata === "object" && !Array.isArray(provisional.metadata)
    ? provisional.metadata as Record<string, unknown>
    : {}
  const routing =
    task.metadata?.routing && typeof task.metadata.routing === "object" && !Array.isArray(task.metadata.routing)
      ? task.metadata.routing as z.infer<typeof CreateTaskInput>["routing"]
      : undefined
  const parsedGoals = GoalInput.array().safeParse(provisional.goals)
  const isReplan = run.phase === "replan" || provisionalMeta.strategy === "replan"
  const previousPlanID = task.active_plan_version_id ?? run.plan_version_id
  const previousPlan = isReplan && previousPlanID ? findPlan(previousPlanID) : undefined
  if (isReplan && !previousPlan) throw new Error(`Previous plan not found for task ${task.id}`)
  const goals =
    parsedGoals.success && parsedGoals.data.length > 0
      ? parsedGoals.data
      : previousPlan
        ? listGoalsByPlan(previousPlan.id).map((goal) => ({
            description: goal.description,
            criteria: goal.criteria,
            priority: goal.priority,
            metadata: goal.metadata ?? undefined,
          }))
        : undefined
  const replanContext =
    provisionalMeta.replan_context && typeof provisionalMeta.replan_context === "object" && !Array.isArray(provisionalMeta.replan_context)
      ? provisionalMeta.replan_context as ReplanContext
      : run.metadata?.replan_context && typeof run.metadata.replan_context === "object" && !Array.isArray(run.metadata.replan_context)
        ? run.metadata.replan_context as ReplanContext
        : undefined
  const failureSummary =
    typeof provisionalMeta.failure_summary === "string"
      ? provisionalMeta.failure_summary
      : typeof run.metadata?.failure_summary === "string"
        ? run.metadata.failure_summary
        : task.error ?? "Replan requested after clarification."
  const planDraft = isReplan
    ? await (() => {
        if (!previousPlan) {
          throw new Error(`Previous plan missing for replan request on task ${task.id}`)
        }
        return PlannerService.replan({
          title: task.title,
          request: clarifiedRequest,
          goals: goals ?? [],
          previousPrompt: previousPlan.prompt,
          previousPlanID: previousPlan.id,
          failureSummary,
          replanContext,
          allowClarification: false,
          executor: run.executor,
          routing,
        })
      })()
    : await PlannerService.initial({
        title: task.title,
        request: clarifiedRequest,
        goals,
        allowClarification: false,
        executor: run.executor,
        routing,
      })
  const planID = Identifier.ascending("plan")
  const now = Date.now()
  const specContent = (planDraft.metadata as Record<string, any>)?.spec_analysis?.expanded_spec
  const specSummary = typeof planDraft.metadata?.spec?.summary === "string" ? planDraft.metadata.spec.summary : planDraft.summary
  const specVersion = isReplan && previousPlan ? previousPlan.version + 1 : 1
  const specItems =
    planDraft.metadata?.spec &&
      typeof planDraft.metadata.spec === "object" &&
      !Array.isArray(planDraft.metadata.spec) &&
      Array.isArray((planDraft.metadata.spec as Record<string, unknown>).spec_items)
      ? (planDraft.metadata.spec as Record<string, unknown>).spec_items as unknown[]
      : []
  const specMeta = typeof specContent === "string"
    ? writeSpec({
        taskID: task.id,
        title: task.title,
        content: specContent,
        summary: specSummary,
        source:
          planDraft.metadata?.spec?.source && typeof planDraft.metadata.spec.source === "object"
            ? planDraft.metadata.spec.source as Record<string, unknown>
            : undefined,
        createdAt: now,
      })
    : undefined
  // Create a DB spec snapshot so the evaluator's spec_check can find it
  const specSnapshotID = typeof specContent === "string" && specContent.trim()
    ? Identifier.ascending("spec")
    : undefined
  const taskMetadata = {
    ...(task.metadata ?? {}),
    ...(planDraft.metadata?.stage_sources ? { stage_sources: planDraft.metadata.stage_sources } : {}),
    ...(specMeta ? { spec: specMeta } : {}),
    planner_clarification: false,
    clarified_request: clarifiedRequest,
  }
  const previousRunID =
    typeof run.metadata?.previous_run_id === "string"
      ? run.metadata.previous_run_id
      : run.id
  const planMetadata = {
    ...(isReplan ? { previous_run_id: previousRunID } : task.metadata ?? {}),
    ...planDraft.metadata,
    clarified_request: clarifiedRequest,
    ...(specMeta
      ? {
          spec: {
            ...specMeta,
            source: specMeta.source ?? planDraft.metadata?.spec?.source,
          },
        }
      : {}),
  }
  Database.transaction((db) => {
    db.update(OrchestratorInteractionRequestTable)
      .set({
        status: "answered",
        response: {
          answers,
          clarified_request: clarifiedRequest,
        },
        time_resolved: now,
        time_updated: now,
      })
      .where(eq(OrchestratorInteractionRequestTable.id, row.id))
      .run()
    if (isReplan) {
      if (!previousPlan) {
        throw new Error(`Previous plan missing for replan request on task ${task.id}`)
      }
      db.update(OrchestratorPlanVersionTable)
        .set({
          status: "superseded",
          time_updated: now,
        })
        .where(eq(OrchestratorPlanVersionTable.id, previousPlan.id))
        .run()
    }
    // Persist spec snapshot in DB so spec_check evaluator can find it
    if (specSnapshotID && typeof specContent === "string") {
      db.insert(OrchestratorSpecSnapshotTable)
        .values({
          id: specSnapshotID,
          task_id: task.id,
          version: specVersion,
          status: "ready",
          summary: specSummary,
          content: specContent,
          scope: "",
          time_created: now,
          time_updated: now,
        })
        .run()
      insertSpecItems(db, {
        taskID: task.id,
        specSnapshotID,
        specItems,
        now,
      })
    }
    db.insert(OrchestratorPlanVersionTable)
      .values({
        id: planID,
        task_id: task.id,
        version: isReplan && previousPlan ? previousPlan.version + 1 : 1,
        status: "active",
        summary: planDraft.summary,
        prompt: planDraft.prompt,
        metadata: planMetadata,
        time_created: now,
        time_updated: now,
      })
      .run()
    insertPlanItems(db, {
      taskID: task.id,
      planID,
      planDraft,
      now,
      milestones: [],
    })
    db.update(OrchestratorRunTable)
      .set({
        plan_version_id: planID,
        status: "queued",
        phase: isReplan ? "replan" : "execute",
        blocking_reason: null,
        metadata: {
          ...(run.metadata ?? {}),
          strategy: "clarification_resolved",
          ...(planDraft.metadata?.stage_sources ? { stage_sources: planDraft.metadata.stage_sources } : {}),
          ...(planDraft.metadata?.spec_analysis ? { spec_analysis: planDraft.metadata.spec_analysis } : {}),
          clarified_request: clarifiedRequest,
          clarification_answers: answers,
        },
        time_updated: now,
      })
      .where(eq(OrchestratorRunTable.id, run.id))
      .run()
    db.update(OrchestratorTaskTable)
      .set({
        active_plan_version_id: planID,
        active_run_id: run.id,
        active_spec_version_id: specSnapshotID ?? task.active_spec_version_id,
        status: "queued",
        blocking_reason: null,
        error: null,
        metadata: taskMetadata,
        time_updated: now,
      })
      .where(eq(OrchestratorTaskTable.id, task.id))
      .run()
    db.insert(OrchestratorProgressSnapshotTable)
      .values({
        id: Identifier.ascending("progress"),
        task_id: task.id,
        status: "running",
        summary: isReplan ? "Clarification answered; replanning resumed" : "Clarification answered; planning resumed",
        payload: {
          clarified_request: clarifiedRequest,
          answers,
        },
        time_created: now,
        time_updated: now,
      })
      .run()
    Database.effect(() =>
      Bus.publish(Event.InteractionResolved, {
        taskID: task.id,
        runID: run.id,
        interactionID: row.id,
        status: "answered",
        summary: "Clarification answered",
      }),
    )
    Database.effect(() => Bus.publish(Event.PlanCreated, { taskID: task.id, planID, summary: planDraft.summary }))
    Database.effect(() =>
      Bus.publish(Event.PlanActivated, {
        taskID: task.id,
        planID,
        summary: isReplan ? "Replanned version activated after clarification" : "Plan activated after clarification",
      }),
    )
    Database.effect(() =>
      Bus.publish(Event.RunUpdated, {
        taskID: task.id,
        runID: run.id,
        status: "queued",
        summary: isReplan ? "Replanned run queued after clarification" : "Run queued after clarification",
      }),
    )
    Database.effect(() =>
      Bus.publish(Event.TaskUpdated, {
        taskID: task.id,
        status: "queued",
        summary: isReplan ? "Clarification resolved; replanned task queued" : "Clarification resolved; task queued",
      }),
    )
  })
  await OrchestratorRuntime.dispatch(run.id, hooks())
}

async function rejectPlannerClarification(row: InteractionRow, message?: string) {
  const task = requireTask(row.task_id)
  const run = requireRun(row.run_id)
  const now = Date.now()
  const error = message?.trim() || "Planning clarification was rejected"
  Database.transaction((db) => {
    db.update(OrchestratorInteractionRequestTable)
      .set({
        status: "rejected",
        response: message?.trim() ? { message: message.trim() } : {},
        time_resolved: now,
        time_updated: now,
      })
      .where(eq(OrchestratorInteractionRequestTable.id, row.id))
      .run()
    db.update(OrchestratorRunTable)
      .set({
        status: "failed",
        blocking_reason: null,
        error,
        time_completed: now,
        time_updated: now,
      })
      .where(eq(OrchestratorRunTable.id, run.id))
      .run()
    db.update(OrchestratorTaskTable)
      .set({
        status: "failed",
        blocking_reason: null,
        error,
        time_completed: now,
        time_updated: now,
      })
      .where(eq(OrchestratorTaskTable.id, task.id))
      .run()
    db.insert(OrchestratorProgressSnapshotTable)
      .values({
        id: Identifier.ascending("progress"),
        task_id: task.id,
        status: "failed",
        summary: "Clarification rejected; task stopped",
        payload: {
          message: message?.trim() || undefined,
        },
        time_created: now,
        time_updated: now,
      })
      .run()
    Database.effect(() =>
      Bus.publish(Event.InteractionResolved, {
        taskID: task.id,
        runID: run.id,
        interactionID: row.id,
        status: "rejected",
        summary: "Clarification rejected",
      }),
    )
    Database.effect(() => Bus.publish(Event.RunUpdated, { taskID: task.id, runID: run.id, status: "failed", summary: error }))
    Database.effect(() => Bus.publish(Event.TaskUpdated, { taskID: task.id, status: "failed", summary: error }))
  })
}

function appendClarification(request: string, rawQuestions: unknown, answers: string[][]) {
  const questions = Array.isArray(rawQuestions)
    ? rawQuestions.flatMap((item) => {
        if (!item || typeof item !== "object") return []
        const row = item as Record<string, unknown>
        if (typeof row.question !== "string" || !row.question.trim()) return []
        return [{
          question: row.question,
          default_assumption:
            typeof row.default_assumption === "string" && row.default_assumption.trim()
              ? row.default_assumption
              : undefined,
        }]
      })
    : []
  const sections = [request.trim(), "", "Clarifications:"]
  if (questions.length === 0) {
    sections.push(...answers.map((item, index) => `Answer ${index + 1}: ${item.join(", ")}`))
    return sections.join("\n")
  }
  for (const [index, question] of questions.entries()) {
    sections.push(`Q${index + 1}: ${question.question}`)
    sections.push(`A${index + 1}: ${answers[index]?.join(", ") || question.default_assumption || "No answer provided"}`)
  }
  return sections.join("\n")
}

export async function replyInteraction(interactionID: string, raw: z.input<typeof ReplyInteractionInput>) {
  const input = ReplyInteractionInput.parse(raw)
  const row = requireInteraction(interactionID)
  if (row.payload?.protocol_request === true) {
    await resolveProtocolInteraction(row, input)
    await OrchestratorRuntime.syncTask(row.task_id, hooks())
    return viewInteraction(requireInteraction(interactionID))
  }
  if (row.request_type === "permission") {
    await PermissionNext.reply({
      requestID: row.external_id,
      reply: input.reply ?? "once",
      message: input.message,
    })
  }
  if (row.request_type === "question") {
    const answers = input.answers ?? answersFromMessage(input.message)
    if (!answers) throw new Error("answers or message are required for question replies")
    if (isPlannerClarification(row)) {
      await answerPlannerClarification(row, answers)
    } else {
      await Question.reply({
        requestID: row.external_id,
        answers,
      })
    }
  }
  await OrchestratorRuntime.syncTask(row.task_id, hooks())
  return viewInteraction(requireInteraction(interactionID))
}

export async function rejectInteraction(interactionID: string, raw?: z.input<typeof RejectInteractionInput>) {
  const input = RejectInteractionInput.parse(raw ?? {})
  const row = requireInteraction(interactionID)
  if (row.payload?.protocol_request === true) {
    await rejectProtocolInteraction(row, input.message)
    await OrchestratorRuntime.syncTask(row.task_id, hooks())
    return viewInteraction(requireInteraction(interactionID))
  }
  if (row.request_type === "permission") {
    await PermissionNext.reply({
      requestID: row.external_id,
      reply: "reject",
      message: input.message,
    })
  }
  if (row.request_type === "question") {
    if (isPlannerClarification(row)) {
      await rejectPlannerClarification(row, input.message)
    } else {
      await Question.reject(row.external_id)
    }
  }
  await OrchestratorRuntime.syncTask(row.task_id, hooks())
  return viewInteraction(requireInteraction(interactionID))
}

export async function listTaskInteractions(taskID: string) {
  await OrchestratorRuntime.syncTask(taskID, hooks())
  requireTask(taskID)
  return listInteractions(taskID).map(viewInteraction)
}
