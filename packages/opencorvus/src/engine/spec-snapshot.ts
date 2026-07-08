import { Identifier } from "@/id/id"
import { and, Database, eq, sql } from "@/storage/db"
import { EngineSpecSnapshotTable, type EngineMetadata, type EngineSpecSnapshotStatus } from "./engine.sql"

export interface InsertEngineSpecSnapshotInput {
  taskID: string
  version: number
  status: EngineSpecSnapshotStatus
  summary: string
  content: string
  scope: string
  outOfScope?: string | null
  evidence?: string[]
  metadata?: EngineMetadata
  timeCreated?: number
}

export function insertEngineSpecSnapshot(db: Database.TxOrDb, input: InsertEngineSpecSnapshotInput): string {
  const id = Identifier.ascending("spec")
  const timeCreated = input.timeCreated ?? Date.now()
  db.insert(EngineSpecSnapshotTable)
    .values({
      id,
      task_id: input.taskID,
      version: input.version,
      status: input.status,
      summary: input.summary,
      content: input.content,
      scope: input.scope,
      out_of_scope: input.outOfScope ?? null,
      evidence: input.evidence,
      metadata: input.metadata,
      time_created: timeCreated,
      time_updated: timeCreated,
    })
    .run()
  return id
}

export function supersedeEngineSpecSnapshot(db: Database.TxOrDb, input: { id: string; timeUpdated?: number }): void {
  const timeUpdated = input.timeUpdated ?? Date.now()
  db.update(EngineSpecSnapshotTable)
    .set({ status: "superseded", time_updated: timeUpdated })
    .where(eq(EngineSpecSnapshotTable.id, input.id))
    .run()
}

export function supersedeActiveEngineSpecSnapshotsForTask(
  db: Database.TxOrDb,
  input: { taskID: string; timeUpdated?: number },
): void {
  const timeUpdated = input.timeUpdated ?? Date.now()
  db.update(EngineSpecSnapshotTable)
    .set({ status: "superseded", time_updated: timeUpdated })
    .where(
      and(eq(EngineSpecSnapshotTable.task_id, input.taskID), sql`${EngineSpecSnapshotTable.status} != 'superseded'`),
    )
    .run()
}

export function updateEngineSpecSnapshotContent(
  db: Database.TxOrDb,
  input: { id: string; content: string; timeUpdated?: number },
): void {
  const timeUpdated = input.timeUpdated ?? Date.now()
  db.update(EngineSpecSnapshotTable)
    .set({ content: input.content, time_updated: timeUpdated })
    .where(eq(EngineSpecSnapshotTable.id, input.id))
    .run()
}
