import { Database, and, eq, inArray } from "@/storage/db"
import { EngineTaskTable, type EngineMetadata } from "./engine.sql"

type EngineTaskInsert = typeof EngineTaskTable.$inferInsert

export function insertEngineTask(
  db: Database.TxOrDb,
  input: {
    taskID: string
    projectID: string
    sessionID: string
    requestID?: string
    source: EngineTaskInsert["source"]
    title: string
    request: string
    attachments?: EngineTaskInsert["attachments"]
    executor: EngineTaskInsert["executor"]
    kind: EngineTaskInsert["kind"]
    priority: EngineTaskInsert["priority"]
    queueOrder: number
    budget?: EngineTaskInsert["budget"]
    metadata: EngineMetadata
    timeStarted?: number | null
    timeCreated: number
    timeUpdated: number
  },
): void {
  db.insert(EngineTaskTable)
    .values({
      id: input.taskID,
      project_id: input.projectID,
      session_id: input.sessionID,
      request_id: input.requestID,
      source: input.source,
      title: input.title,
      request: input.request,
      attachments: input.attachments,
      executor: input.executor,
      kind: input.kind,
      priority: input.priority,
      queue_order: input.queueOrder,
      budget: input.budget,
      metadata: input.metadata,
      time_started: input.timeStarted ?? null,
      time_created: input.timeCreated,
      time_updated: input.timeUpdated,
    })
    .run()
}

export function touchEngineTask(db: Database.TxOrDb, input: { taskID: string; timeUpdated?: number }): void {
  db.update(EngineTaskTable)
    .set({ time_updated: input.timeUpdated ?? Date.now() })
    .where(eq(EngineTaskTable.id, input.taskID))
    .run()
}

export function setEngineTaskBudget(
  db: Database.TxOrDb,
  input: { taskID: string; budget: EngineTaskInsert["budget"] | null },
): void {
  db.update(EngineTaskTable).set({ budget: input.budget }).where(eq(EngineTaskTable.id, input.taskID)).run()
}

export function setEngineTaskTitle(db: Database.TxOrDb, input: { taskID: string; title: string }): void {
  db.update(EngineTaskTable).set({ title: input.title }).where(eq(EngineTaskTable.id, input.taskID)).run()
}

export function deleteEngineTask(db: Database.TxOrDb, input: { taskID: string }): void {
  db.delete(EngineTaskTable).where(eq(EngineTaskTable.id, input.taskID)).run()
}

export function deleteEngineTasksForProjectSessions(
  db: Database.TxOrDb,
  input: { projectID: string; sessionIDs: string[] },
): void {
  db.delete(EngineTaskTable)
    .where(and(eq(EngineTaskTable.project_id, input.projectID), inArray(EngineTaskTable.session_id, input.sessionIDs)))
    .run()
}

export function setEngineTaskMetadata(
  db: Database.TxOrDb,
  input: { taskID: string; metadata: EngineMetadata; timeUpdated?: number },
): void {
  db.update(EngineTaskTable)
    .set({
      metadata: input.metadata,
      time_updated: input.timeUpdated ?? Date.now(),
    })
    .where(eq(EngineTaskTable.id, input.taskID))
    .run()
}

export function mergeEngineTaskMetadata(
  db: Database.TxOrDb,
  input: { taskID: string; metadata: EngineMetadata; timeUpdated?: number },
): EngineMetadata {
  const row = db
    .select({ metadata: EngineTaskTable.metadata })
    .from(EngineTaskTable)
    .where(eq(EngineTaskTable.id, input.taskID))
    .get()
  if (!row) throw new Error(`mergeEngineTaskMetadata: task ${input.taskID} not found`)
  const current =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as EngineMetadata)
      : {}
  const metadata = {
    ...current,
    ...input.metadata,
  }
  db.update(EngineTaskTable)
    .set({
      metadata,
      time_updated: input.timeUpdated ?? Date.now(),
    })
    .where(eq(EngineTaskTable.id, input.taskID))
    .run()
  return metadata
}
