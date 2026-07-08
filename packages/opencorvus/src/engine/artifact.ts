import { Identifier } from "@/id/id"
import { Database, eq, type SQL } from "@/storage/db"
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

export interface EngineArtifactWhereUpdateInput {
  where: SQL
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

function artifactPatchValues(input: { label?: string; payload?: EngineMetadata; timeUpdated?: number }) {
  const set: Partial<typeof EngineArtifactTable.$inferInsert> = {
    time_updated: input.timeUpdated ?? Date.now(),
  }
  if (input.label !== undefined) set.label = input.label
  if (input.payload !== undefined) set.payload = input.payload
  return set
}

export function insertEngineArtifact(db: Database.TxOrDb, input: EngineArtifactInput): string {
  const values = artifactValues(input)
  db.insert(EngineArtifactTable).values(values).run()
  return values.id
}

export function recordEngineArtifact(input: EngineArtifactInput): string {
  return Database.use((db) => insertEngineArtifact(db, input))
}

export function patchEngineArtifact(db: Database.TxOrDb, input: EngineArtifactUpdateInput): void {
  db.update(EngineArtifactTable).set(artifactPatchValues(input)).where(eq(EngineArtifactTable.id, input.id)).run()
}

export function updateEngineArtifact(input: EngineArtifactUpdateInput): void {
  Database.use((db) => patchEngineArtifact(db, input))
}

export function updateEngineArtifactsWhere(db: Database.TxOrDb, input: EngineArtifactWhereUpdateInput): void {
  db.update(EngineArtifactTable).set(artifactPatchValues(input)).where(input.where).run()
}

export function updateEngineArtifactWhereReturning(
  db: Database.TxOrDb,
  input: EngineArtifactWhereUpdateInput,
): EngineArtifactRow | undefined {
  return db.update(EngineArtifactTable).set(artifactPatchValues(input)).where(input.where).returning().get()
}
