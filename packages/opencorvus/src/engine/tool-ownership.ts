import { desc, eq, and, sql } from "@/storage/db"
import { Database } from "@/storage/db"
import { EngineArtifactTable, type EngineArtifactKind, type EngineMetadata } from "@/engine/engine.sql"
import { Identifier } from "@/id/id"
import { processOwner } from "./lease"
import { Log } from "@/util/log"

const log = Log.create({ service: "engine.tool-ownership" })

export type OrchestratorToolOwnershipScope = "task" | "goal"
export type OrchestratorToolOwnershipOutcome = "completed" | "failed" | "cancelled"
export type OrchestratorToolOwnershipToolName = "build" | "integrity"

export interface OrchestratorToolOwnershipPayload extends EngineMetadata {
  ownership_id: string
  owner?: string | null
  task_id: string
  orchestrator_session_id: string
  orchestrator_message_id: string
  tool_part_id: string
  tool_call_id: string
  tool_name: OrchestratorToolOwnershipToolName
  child_session_id: string
  scope: OrchestratorToolOwnershipScope
  goal_id?: string
  goal_run_id?: string
  time_started: number
  time_completed?: number | null
  outcome?: OrchestratorToolOwnershipOutcome
  error?: string
}

export interface OrchestratorToolOwnershipRow {
  artifactID: string
  taskID: string
  ownershipID: string
  payload: OrchestratorToolOwnershipPayload
  timeCreated: number
}

type OwnershipArtifactInput = {
  id?: string
  taskID: string
  runID?: string | null
  goalRunID?: string | null
  label?: string
  payload: OrchestratorToolOwnershipPayload
  now?: number
}

export function createOrchestratorToolOwnershipPayload(input: {
  taskID: string
  orchestratorSessionID: string
  orchestratorMessageID: string
  toolPartID: string
  toolCallID: string
  childSessionID: string
  toolName?: OrchestratorToolOwnershipToolName
  scope: OrchestratorToolOwnershipScope
  goalID?: string
  goalRunID?: string
  now?: number
}): OrchestratorToolOwnershipPayload {
  const now = input.now ?? Date.now()
  return {
    ownership_id: Identifier.ascending("artifact"),
    owner: processOwner(),
    task_id: input.taskID,
    orchestrator_session_id: input.orchestratorSessionID,
    orchestrator_message_id: input.orchestratorMessageID,
    tool_part_id: input.toolPartID,
    tool_call_id: input.toolCallID,
    tool_name: input.toolName ?? "build",
    child_session_id: input.childSessionID,
    scope: input.scope,
    ...(input.goalID ? { goal_id: input.goalID } : {}),
    ...(input.goalRunID ? { goal_run_id: input.goalRunID } : {}),
    time_started: now,
    time_completed: null,
  }
}

export function insertOrchestratorToolOwnershipArtifact(input: OwnershipArtifactInput): string {
  const now = input.now ?? Date.now()
  const artifactID = input.id ?? Identifier.ascending("artifact")
  Database.use((db) => {
    db.insert(EngineArtifactTable)
      .values({
        id: artifactID,
        task_id: input.taskID,
        run_id: input.runID ?? null,
        goal_run_id: input.goalRunID ?? null,
        kind: "orchestrator_tool_ownership" as EngineArtifactKind,
        label: input.label ?? "tool-ownership",
        payload: input.payload,
        time_created: now,
        time_updated: now,
      })
      .run()
  })
  return artifactID
}

export function completeOrchestratorToolOwnership(input: {
  taskID: string
  ownershipID: string
  outcome: OrchestratorToolOwnershipOutcome
  error?: string
  now?: number
}): void {
  const current = findLatestOwnershipByID(input.taskID, input.ownershipID)
  if (!current) return
  if (current.payload.time_completed) return
  const now = input.now ?? Date.now()
  insertOrchestratorToolOwnershipArtifact({
    taskID: input.taskID,
    runID: null,
    goalRunID: current.payload.goal_run_id ?? null,
    label: "tool-ownership-terminal",
    now,
    payload: {
      ...current.payload,
      time_completed: now,
      outcome: input.outcome,
      ...(input.error ? { error: input.error } : {}),
    },
  })
  void import("@/engine/queue")
    .then(({ drainQueuedTaskEventIfUnowned }) => {
      drainQueuedTaskEventIfUnowned(input.taskID)
    })
    .catch((error) => {
      log.error("failed to drain queued task event after orchestrator tool ownership completion", {
        taskID: input.taskID,
        error: error instanceof Error ? error.message : String(error),
      })
    })
}

export function listLatestOrchestratorToolOwnership(taskID: string): OrchestratorToolOwnershipRow[] {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "orchestrator_tool_ownership")))
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .all(),
  )
  const seen = new Set<string>()
  const latest: OrchestratorToolOwnershipRow[] = []
  for (const row of rows) {
    const payload = normalizeOwnershipPayload(row.payload)
    if (!payload) continue
    if (seen.has(payload.ownership_id)) continue
    seen.add(payload.ownership_id)
    latest.push({
      artifactID: row.id,
      taskID: row.task_id,
      ownershipID: payload.ownership_id,
      payload,
      timeCreated: row.time_created,
    })
  }
  return latest
}

export function listLiveOrchestratorToolOwnership(taskID: string): OrchestratorToolOwnershipRow[] {
  const owner = processOwner()
  return listLatestOrchestratorToolOwnership(taskID).filter(
    (row) => !row.payload.time_completed && (!row.payload.owner || row.payload.owner === owner),
  )
}

export function findLiveBuildOwnershipByGoal(input: {
  taskID: string
  goalID: string
}): OrchestratorToolOwnershipRow | undefined {
  return listLiveOrchestratorToolOwnership(input.taskID).find(
    (row) => row.payload.tool_name === "build" && row.payload.goal_id === input.goalID,
  )
}

export function findLiveBuildOwnershipBySession(input: {
  taskID: string
  sessionID: string
}): OrchestratorToolOwnershipRow | undefined {
  return listLiveOrchestratorToolOwnership(input.taskID).find(
    (row) => row.payload.tool_name === "build" && row.payload.child_session_id === input.sessionID,
  )
}

export function findLiveBuildOwnershipByGoalRun(input: {
  taskID: string
  goalRunID: string
}): OrchestratorToolOwnershipRow | undefined {
  return listLiveOrchestratorToolOwnership(input.taskID).find(
    (row) => row.payload.tool_name === "build" && row.payload.goal_run_id === input.goalRunID,
  )
}

export function findLatestOwnershipByID(taskID: string, ownershipID: string): OrchestratorToolOwnershipRow | undefined {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, taskID),
          eq(EngineArtifactTable.kind, "orchestrator_tool_ownership"),
          sql`json_extract(${EngineArtifactTable.payload}, '$.ownership_id') = ${ownershipID}`,
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_created), desc(EngineArtifactTable.id))
      .limit(1)
      .all(),
  )
  const row = rows[0]
  if (!row) return undefined
  const payload = normalizeOwnershipPayload(row.payload)
  if (!payload) return undefined
  return {
    artifactID: row.id,
    taskID: row.task_id,
    ownershipID: payload.ownership_id,
    payload,
    timeCreated: row.time_created,
  }
}

function normalizeOwnershipPayload(payload: unknown): OrchestratorToolOwnershipPayload | undefined {
  if (!payload || typeof payload !== "object") return undefined
  const value = payload as Record<string, unknown>
  if (typeof value.ownership_id !== "string" || value.ownership_id.length === 0) return undefined
  if (typeof value.task_id !== "string" || value.task_id.length === 0) return undefined
  if (value.tool_name !== "build" && value.tool_name !== "integrity") return undefined
  if (typeof value.child_session_id !== "string" || value.child_session_id.length === 0) return undefined
  if (typeof value.orchestrator_session_id !== "string" || value.orchestrator_session_id.length === 0) return undefined
  if (typeof value.orchestrator_message_id !== "string" || value.orchestrator_message_id.length === 0) return undefined
  if (typeof value.tool_part_id !== "string" || value.tool_part_id.length === 0) return undefined
  if (typeof value.tool_call_id !== "string" || value.tool_call_id.length === 0) return undefined
  if (value.scope !== "task" && value.scope !== "goal") return undefined
  const timeStarted = Number(value.time_started)
  if (!(timeStarted > 0)) return undefined
  return value as unknown as OrchestratorToolOwnershipPayload
}
