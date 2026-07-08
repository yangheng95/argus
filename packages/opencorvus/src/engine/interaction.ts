import { Bus } from "@/bus"
import { PermissionNext } from "@/permission/next"
import { Question } from "@/question"
import { Database } from "@/storage/db"
import { type EngineMetadata, type EngineInteractionStatus } from "./engine.sql"
import { insertEngineInteractionRequest, resolveEngineInteractionRequest } from "./interaction-request"
import { activeRunBySession, findActiveRunForTask, findInteractionByExternal, type InteractionRow } from "./store"
import { taskIDForSession } from "@/orchestrator/task-event"
import { EngineRuntime } from "./runtime"
import type { RuntimeHooks } from "./runtime-hooks"

export namespace EngineInteraction {
  export function subscribe(hooks: RuntimeHooks) {
    const uses = () => hooks
    Bus.subscribe(PermissionNext.Event.Asked, ({ properties }) => upsertPermission(properties, uses()))
    Bus.subscribe(PermissionNext.Event.Replied, ({ properties }) => resolvePermission(properties, uses()))
    Bus.subscribe(Question.Event.Asked, ({ properties }) => upsertQuestion(properties, uses()))
    Bus.subscribe(Question.Event.Replied, ({ properties }) => resolveQuestion(properties, uses()))
    Bus.subscribe(Question.Event.Rejected, ({ properties }) => rejectQuestion(properties, uses()))
  }
}

async function upsertPermission(request: PermissionNext.Request, hooks: RuntimeHooks) {
  const owner = resolveOwner(request.sessionID)
  if (!owner) return
  if (findInteractionByExternal(request.id)) return
  const now = Date.now()
  const runID = owner.run?.id ?? null
  Database.transaction((db) => {
    insertEngineInteractionRequest(db, {
      taskID: owner.taskID,
      runID,
      sessionID: request.sessionID,
      externalID: request.id,
      requestType: "permission",
      title: `Permission: ${request.permission}`,
      body: request.patterns.join("\n") || request.permission,
      payload: {
        permission: request.permission,
        patterns: request.patterns,
        metadata: request.metadata,
        always: request.always,
        tool: request.tool,
      },
      eventSource: "interaction.permission",
      eventSummary: `Permission requested: ${request.permission}`,
      timeCreated: now,
    })
  })
  if (runID) await EngineRuntime.syncRun(runID, hooks)
  else await EngineRuntime.syncTask(owner.taskID, hooks)
}

async function resolvePermission(
  input: { sessionID: string; requestID: string; reply: PermissionNext.Reply; autoReply?: boolean },
  hooks: RuntimeHooks,
) {
  const interaction = findInteractionByExternal(input.requestID)
  if (!interaction) return
  const response: EngineMetadata = {
    reply: input.reply,
    ...(input.autoReply ? { auto_reply: true } : {}),
  }
  await resolveInteraction(interaction, input.reply === "reject" ? "rejected" : "answered", response, hooks)
}

async function upsertQuestion(request: Question.Request, hooks: RuntimeHooks) {
  const owner = resolveOwner(request.sessionID)
  if (!owner) return
  if (findInteractionByExternal(request.id)) return
  const now = Date.now()
  const title = request.questions.map((item) => item.header).join(" / ") || "Question"
  const body = request.questions.map((item) => item.question).join("\n\n")
  const runID = owner.run?.id ?? null
  Database.transaction((db) => {
    // Always emit — overlay only filters by taskID, and a Task-Agent clarification
    // before any run has started still needs to surface in the InteractionPanel.
    insertEngineInteractionRequest(db, {
      taskID: owner.taskID,
      runID,
      sessionID: request.sessionID,
      externalID: request.id,
      requestType: "question",
      title,
      body,
      payload: {
        questions: request.questions,
        tool: request.tool,
      },
      eventSource: "interaction.question",
      eventSummary: title,
      timeCreated: now,
    })
  })
  if (runID) await EngineRuntime.syncRun(runID, hooks)
  else await EngineRuntime.syncTask(owner.taskID, hooks)
}

function resolveOwner(sessionID: string) {
  const directRun = activeRunBySession(sessionID)
  if (directRun) return { taskID: directRun.task_id, run: directRun }
  const taskID = taskIDForSession(sessionID)
  if (!taskID) return undefined
  return { taskID, run: findActiveRunForTask(taskID) }
}

async function resolveQuestion(
  input: { sessionID: string; requestID: string; answers: Question.Answer[] },
  hooks: RuntimeHooks,
) {
  const interaction = findInteractionByExternal(input.requestID)
  if (!interaction) return
  await resolveInteraction(interaction, "answered", { answers: input.answers }, hooks)
}

async function rejectQuestion(input: { sessionID: string; requestID: string }, hooks: RuntimeHooks) {
  const interaction = findInteractionByExternal(input.requestID)
  if (!interaction) return
  await resolveInteraction(interaction, "rejected", {}, hooks)
}

async function resolveInteraction(
  interaction: InteractionRow,
  status: EngineInteractionStatus,
  response: EngineMetadata,
  hooks: RuntimeHooks,
) {
  const now = Date.now()
  Database.transaction((db) => {
    resolveEngineInteractionRequest(db, {
      row: interaction,
      status,
      response,
      eventSource: "interaction.resolve",
      resolvedEventScope: "task",
      timeResolved: now,
    })
  })
  if (interaction.run_id) await EngineRuntime.syncRun(interaction.run_id, hooks)
  else await EngineRuntime.syncTask(interaction.task_id, hooks)
}
