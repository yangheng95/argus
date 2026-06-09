import z from "zod"
import { type BusEvent } from "@/bus/bus-event"
import { Database, eq } from "@/storage/db"
import { ProtocolStore } from "@/protocol/store"
import { EngineTaskTable } from "./engine.sql"

type Meta = {
  kind?: "event" | "command" | "reply"
  taskID?: string
  runID?: string
  goalRunID?: string
  sessionID?: string
  interactionID?: string
  executorSessionID?: string
  source?: string
  target?: string
  correlationID?: string
  causationID?: string
}

function text(input: Record<string, unknown>, key: string) {
  const value = input[key]
  return typeof value === "string" && value ? value : undefined
}

function payload<Definition extends BusEvent.Definition>(properties: z.output<Definition["properties"]>) {
  return structuredClone(properties) as Record<string, unknown>
}

export namespace EngineProtocol {
  export async function emit<Definition extends BusEvent.Definition>(
    def: Definition,
    properties: z.output<Definition["properties"]>,
    meta: Meta = {},
  ) {
    const data = payload(properties)
    const taskID = meta.taskID ?? text(data, "taskID")
    if (!taskID) throw new Error(`protocol event ${def.type} is missing taskID`)
    const task = Database.use((db) =>
      db.select({ id: EngineTaskTable.id }).from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get(),
    )
    if (!task) return
    const now = Date.now()

    return ProtocolStore.appendEvent({
      kind: meta.kind ?? "event",
      type: def.type,
      aggregate: "task",
      aggregate_id: taskID,
      task_id: taskID,
      run_id: meta.runID ?? text(data, "runID") ?? null,
      goal_run_id: meta.goalRunID ?? text(data, "goalRunID") ?? null,
      session_id: meta.sessionID ?? text(data, "sessionID") ?? null,
      interaction_id: meta.interactionID ?? text(data, "interactionID") ?? null,
      stream_id: null,
      source: meta.source ?? "assistant",
      target: meta.target ?? null,
      correlation_id: meta.correlationID ?? null,
      causation_id: meta.causationID ?? null,
      reply_to: null,
      emitted_at: now,
      payload: data,
    }).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error)
      if (!detail.includes("FOREIGN KEY constraint failed")) throw error
    })
  }
}
