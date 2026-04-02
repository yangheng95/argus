import z from "zod"
import { Bus } from "@/bus"
import { ExecutorRegistry } from "@/executor/registry"
import { PermissionNext } from "@/permission/next"
import { Question } from "@/question"
import { Database, eq } from "@/storage/db"
import {
  OrchestratorInteractionRequestTable,
  type OrchestratorInteractionStatus,
} from "./orchestrator.sql"
import {
  Event,
  RejectInteractionInput,
  ReplyInteractionInput,
} from "./model"
import { OrchestratorRuntime } from "./runtime"
import { hooks } from "./state"
import {
  listInteractions,
  requireInteraction,
  requireRun,
  requireTask,
  viewInteraction,
  type InteractionRow,
} from "./store"

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
    // Legacy planner clarifications are no longer supported — the Task Agent
    // handles all planning decisions directly.
    if (row.payload?.planner_clarification === true) {
      throw new Error("Planner clarifications are no longer supported in the new architecture")
    }
    await Question.reply({
      requestID: row.external_id,
      answers,
    })
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
    if (row.payload?.planner_clarification === true) {
      throw new Error("Planner clarifications are no longer supported in the new architecture")
    }
    await Question.reject(row.external_id)
  }
  await OrchestratorRuntime.syncTask(row.task_id, hooks())
  return viewInteraction(requireInteraction(interactionID))
}

export async function listTaskInteractions(taskID: string) {
  await OrchestratorRuntime.syncTask(taskID, hooks())
  requireTask(taskID)
  return listInteractions(taskID).map(viewInteraction)
}
