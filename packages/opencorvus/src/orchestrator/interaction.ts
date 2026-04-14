import { Bus } from "@/bus"
import { PermissionNext } from "@/permission/next"
import { Question } from "@/question"
import { Database, eq } from "@/storage/db"
import { OrchestratorInteractionRequestTable, type OrchestratorMetadata, type OrchestratorInteractionStatus } from "./orchestrator.sql"
import { Event } from "./model"
import { OrchestratorProtocol } from "./protocol"
import { activeRunBySession, findInteractionByExternal, type InteractionRow } from "./store"
import { taskIDForSession } from "@/server/routes/task-event"
import { Identifier } from "@/id/id"
import { OrchestratorRuntime } from "./runtime"

export namespace OrchestratorInteraction {
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
  const run = activeRunBySession(request.sessionID)
  if (!run) return
  if (findInteractionByExternal(request.id)) return
  const now = Date.now()
  const interactionID = Identifier.ascending("interaction")
  Database.transaction((db) => {
    db.insert(OrchestratorInteractionRequestTable)
      .values({
        id: interactionID,
        task_id: run.task_id,
        run_id: run.id,
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
      OrchestratorProtocol.emit(Event.InteractionRequested, {
        taskID: run.task_id,
        runID: run.id,
        interactionID,
        requestType: "permission",
        summary: `Permission requested: ${request.permission}`,
      }, { taskID: run.task_id, runID: run.id, interactionID, source: "interaction.permission" }),
    )
  })
  await OrchestratorRuntime.syncRun(run.id, hooks)
}

async function resolvePermission(input: { sessionID: string; requestID: string; reply: PermissionNext.Reply }, hooks: RuntimeHooks) {
  const interaction = findInteractionByExternal(input.requestID)
  if (!interaction) return
  await resolveInteraction(interaction, "answered", { reply: input.reply }, hooks)
}

async function upsertQuestion(request: Question.Request, hooks: RuntimeHooks) {
  // Resolve owning task: prefer the active run's task (executor session path),
  // fall back to parent-chain / task.session_id lookup so Task Agent coordinator
  // sessions (which have no own run) can still surface questions.
  const run = activeRunBySession(request.sessionID)
  let taskID: string | undefined = run?.task_id
  if (!taskID) taskID = taskIDForSession(request.sessionID)
  if (!taskID) return
  if (findInteractionByExternal(request.id)) return
  const now = Date.now()
  const interactionID = Identifier.ascending("interaction")
  const title = request.questions.map((item) => item.header).join(" / ") || "Question"
  const body = request.questions.map((item) => item.question).join("\n\n")
  const runID = run?.id ?? null
  Database.transaction((db) => {
    db.insert(OrchestratorInteractionRequestTable)
      .values({
        id: interactionID,
        task_id: taskID!,
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
    // Protocol envelope requires runID — skip persistence when Task Agent asks
    // without an active run (the interaction row itself still drives UI).
    if (runID) {
      Database.effect(() =>
        OrchestratorProtocol.emit(Event.InteractionRequested, {
          taskID: taskID!,
          runID,
          interactionID,
          requestType: "question",
          summary: title,
        }, { taskID: taskID!, runID, interactionID, source: "interaction.question" }),
      )
    }
  })
  if (runID) await OrchestratorRuntime.syncRun(runID, hooks)
  else await OrchestratorRuntime.syncTask(taskID!, hooks)
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
  status: OrchestratorInteractionStatus,
  response: OrchestratorMetadata,
  hooks: RuntimeHooks,
) {
  const now = Date.now()
  Database.transaction((db) => {
    db.update(OrchestratorInteractionRequestTable)
      .set({
        status,
        response,
        time_resolved: now,
        time_updated: now,
      })
      .where(eq(OrchestratorInteractionRequestTable.id, interaction.id))
      .run()
    if (interaction.run_id) {
      const runID = interaction.run_id
      Database.effect(() =>
        OrchestratorProtocol.emit(Event.InteractionResolved, {
          taskID: interaction.task_id,
          runID,
          interactionID: interaction.id,
          status,
          summary: status === "answered" ? "Interaction answered" : "Interaction rejected",
        }, { taskID: interaction.task_id, runID, interactionID: interaction.id, source: "interaction.resolve" }),
      )
    }
  })
  if (interaction.run_id) await OrchestratorRuntime.syncRun(interaction.run_id, hooks)
  else await OrchestratorRuntime.syncTask(interaction.task_id, hooks)
}

type RuntimeHooks = {
  updateTask: Parameters<typeof OrchestratorRuntime.monitorRuns>[0]["updateTask"]
  updateRun: Parameters<typeof OrchestratorRuntime.monitorRuns>[0]["updateRun"]
}
