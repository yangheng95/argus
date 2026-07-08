import { Identifier } from "@/id/id"
import { Database, eq } from "@/storage/db"
import { EngineArtifactTable, type EngineArtifactKind, type EngineMetadata } from "./engine.sql"

export type EngineArtifactRow = typeof EngineArtifactTable.$inferSelect

export interface EngineArtifactInput {
  id?: string
  taskID: string
  runID?: string | null
  goalRunID?: string | null
  acceptanceID?: string | null
  kind: EngineArtifactKind
  label: string
  payload?: EngineMetadata
  timeCreated?: number
  timeUpdated?: number
}

export interface EngineArtifactUpdateInput {
  id: string
  label?: string
  payload?: EngineMetadata
  timeUpdated?: number
}

function artifactValues(input: EngineArtifactInput) {
  const id = input.id ?? Identifier.ascending("artifact")
  const timeCreated = input.timeCreated ?? Date.now()
  return {
    id,
    task_id: input.taskID,
    run_id: input.runID ?? null,
    goal_run_id: input.goalRunID ?? null,
    acceptance_id: input.acceptanceID ?? null,
    kind: input.kind,
    label: input.label,
    payload: input.payload,
    time_created: timeCreated,
    time_updated: input.timeUpdated ?? timeCreated,
  }
}

export function insertEngineArtifact(db: Database.TxOrDb, input: EngineArtifactInput): string {
  const values = artifactValues(input)
  db.insert(EngineArtifactTable).values(values).run()
  return values.id
}

export function recordEngineArtifact(input: EngineArtifactInput): string {
  return Database.use((db) => insertEngineArtifact(db, input))
}

export function updateEngineArtifact(input: EngineArtifactUpdateInput): void {
  const set: Partial<typeof EngineArtifactTable.$inferInsert> = {
    time_updated: input.timeUpdated ?? Date.now(),
  }
  if (input.label !== undefined) set.label = input.label
  if (input.payload !== undefined) set.payload = input.payload
  Database.use((db) => db.update(EngineArtifactTable).set(set).where(eq(EngineArtifactTable.id, input.id)).run())
}
