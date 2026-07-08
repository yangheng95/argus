import { Identifier } from "@/id/id"
import { Database, eq } from "@/storage/db"
import {
  EngineInteractionRequestTable,
  type EngineInteractionStatus,
  type EngineInteractionType,
  type EngineMetadata,
} from "./engine.sql"
import { Event } from "./model"
import { EngineProtocol } from "./protocol"
import type { InteractionRow } from "./store"

export interface InsertEngineInteractionRequestInput {
  taskID: string
  runID?: string | null
  sessionID: string
  externalID: string
  requestType: EngineInteractionType
  title: string
  body: string
  payload: EngineMetadata
  eventSource: string
  eventSummary: string
  timeCreated?: number
}

export function insertEngineInteractionRequest(
  db: Database.TxOrDb,
  input: InsertEngineInteractionRequestInput,
): string {
  const id = Identifier.ascending("interaction")
  const timeCreated = input.timeCreated ?? Date.now()
  const runID = input.runID ?? null
  db.insert(EngineInteractionRequestTable)
    .values({
      id,
      task_id: input.taskID,
      run_id: runID,
      session_id: input.sessionID,
      external_id: input.externalID,
      request_type: input.requestType,
      status: "pending",
      title: input.title,
      body: input.body,
      payload: input.payload,
      time_created: timeCreated,
      time_updated: timeCreated,
    })
    .run()
  Database.effect(() =>
    EngineProtocol.emit(
      Event.InteractionRequested,
      {
        taskID: input.taskID,
        ...(runID ? { runID } : {}),
        interactionID: id,
        requestType: input.requestType,
        summary: input.eventSummary,
      },
      { taskID: input.taskID, ...(runID ? { runID } : {}), interactionID: id, source: input.eventSource },
    ),
  )
  return id
}

export interface ResolveEngineInteractionRequestInput {
  row: InteractionRow
  status: EngineInteractionStatus
  response: EngineMetadata
  eventSource: string
  resolvedEventScope: "task" | "run"
  timeResolved?: number
}

export function resolveEngineInteractionRequest(
  db: Database.TxOrDb,
  input: ResolveEngineInteractionRequestInput,
): void {
  const timeResolved = input.timeResolved ?? Date.now()
  db.update(EngineInteractionRequestTable)
    .set({
      status: input.status,
      response: input.response,
      time_resolved: timeResolved,
      time_updated: timeResolved,
    })
    .where(eq(EngineInteractionRequestTable.id, input.row.id))
    .run()
  const runID = input.row.run_id
  if (input.resolvedEventScope === "run" && !runID) return
  Database.effect(() =>
    EngineProtocol.emit(
      Event.InteractionResolved,
      {
        taskID: input.row.task_id,
        ...(runID ? { runID } : {}),
        interactionID: input.row.id,
        status: input.status,
        summary: input.status === "answered" ? "Interaction answered" : "Interaction rejected",
      },
      {
        taskID: input.row.task_id,
        ...(runID ? { runID } : {}),
        interactionID: input.row.id,
        source: input.eventSource,
      },
    ),
  )
}
