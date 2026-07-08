import { Database, eq } from "@/storage/db"
import { EngineTaskTable, type EngineMetadata } from "./engine.sql"

export function touchEngineTask(db: Database.TxOrDb, input: { taskID: string; timeUpdated?: number }): void {
  db.update(EngineTaskTable)
    .set({ time_updated: input.timeUpdated ?? Date.now() })
    .where(eq(EngineTaskTable.id, input.taskID))
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
