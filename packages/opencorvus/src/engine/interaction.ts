import { Bus } from "@/bus"
import { PermissionNext } from "@/permission/next"
import { Question } from "@/question"
import { Database, eq } from "@/storage/db"
import { EngineInteractionRequestTable, type EngineMetadata, type EngineInteractionStatus } from "./engine.sql"
import { Event } from "./model"
import { EngineProtocol } from "./protocol"
import { activeRunBySession, findActiveRunForTask, findInteractionByExternal, type InteractionRow } from "./store"
import { taskIDForSession } from "@/orchestrator/task-event"
import { Identifier } from "@/id/id"
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
  const interactionID = Identifier.ascending("interaction")
  const runID = owner.run?.id ?? null
  Database.transaction((db) => {
    db.insert(EngineInteractionRequestTable)
      .values({
        id: interactionID,
        task_id: owner.taskID,
        run_id: runID,
        session_id: request.sessionID,
        external_id: request.id,
        request_type: "permission",
        status: "pending",
        title: `Permission: ${request.permission}`,
        body: request.patterns.join("\n") || request.permission,
        payload: {
          permission: request.permission,
          patterns: request.patterns,
          metadata: request.metadata,
          always: request.always,
          tool: request.tool,
        },
        time_created: now,
        time_updated: now,
      })
      .run()
    Database.effect(() =>
      EngineProtocol.emit(
        Event.InteractionRequested,
        {
          taskID: owner.taskID,
          ...(runID ? { runID } : {}),
          interactionID,
          requestType: "permission",
          summary: `Permission requested: ${request.permission}`,
        },
        { taskID: owner.taskID, ...(runID ? { runID } : {}), interactionID, source: "interaction.permission" },
      ),
    )
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
  const interactionID = Identifier.ascending("interaction")
  const title = request.questions.map((item) => item.header).join(" / ") || "Question"
  const body = request.questions.map((item) => item.question).join("\n\n")
  const runID = owner.run?.id ?? null
  Database.transaction((db) => {
    db.insert(EngineInteractionRequestTable)
      .values({
        id: interactionID,
        task_id: owner.taskID,
        run_id: runID,
        session_id: request.sessionID,
        external_id: request.id,
        request_type: "question",
        status: "pending",
        title,
        body,
        payload: {
          questions: request.questions,
          tool: request.tool,
        },
        time_created: now,
        time_updated: now,
      })
      .run()
    // Always emit — overlay only filters by taskID, and a Task-Agent clarification
    // before any run has started still needs to surface in the InteractionPanel.
    Database.effect(() =>
      EngineProtocol.emit(
        Event.InteractionRequested,
        {
          taskID: owner.taskID,
          ...(runID ? { runID } : {}),
          interactionID,
          requestType: "question",
          summary: title,
        },
        { taskID: owner.taskID, ...(runID ? { runID } : {}), interactionID, source: "interaction.question" },
      ),
    )
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
    db.update(EngineInteractionRequestTable)
      .set({
        status,
        response,
        time_resolved: now,
        time_updated: now,
      })
      .where(eq(EngineInteractionRequestTable.id, interaction.id))
      .run()
    const runID = interaction.run_id ?? undefined
    Database.effect(() =>
      EngineProtocol.emit(
        Event.InteractionResolved,
        {
          taskID: interaction.task_id,
          ...(runID ? { runID } : {}),
          interactionID: interaction.id,
          status,
          summary: status === "answered" ? "Interaction answered" : "Interaction rejected",
        },
        {
          taskID: interaction.task_id,
          ...(runID ? { runID } : {}),
          interactionID: interaction.id,
          source: "interaction.resolve",
        },
      ),
    )
  })
  if (interaction.run_id) await EngineRuntime.syncRun(interaction.run_id, hooks)
  else await EngineRuntime.syncTask(interaction.task_id, hooks)
}
