import { AgentRoleContract, type AgentRoleID } from "@/agent/role-contract"
import { EngineArtifactTable, type EngineArtifactKind, type EngineMetadata } from "@/engine/engine.sql"
import { insertEngineArtifact, updateEngineArtifactsWhere } from "@/engine/artifact"
import { Database, and, desc, eq } from "@/storage/db"
import { Identifier } from "@/id/id"
import { processOwner } from "@/engine/lease"

export type StageContinuationFailureName = "TerminalToolMissingError" | "StructuredOutputError"
export type StageContinuationKind = "protocol-finalizer-miss"
export type StageContinuationStage = AgentRoleID

export interface StageContinuationRequestPayload extends EngineMetadata {
  continuation_id: string
  task_id: string
  stage: StageContinuationStage
  session_id: string
  parent_session_id?: string
  normalized_stage_input?: unknown
  input_digest: string
  kind: StageContinuationKind
  reason: string
  failure_name: StageContinuationFailureName
  failure_message: string
  finalizer_name: string
  failed_assistant_message_id?: string
  created_at: number
  claimed_at?: number
  claim_id?: string
  claim_owner?: string
  claim_failed_at?: number
  claim_error?: string
  consumed_at?: number
  continuation_message_id?: string
}

export interface StageContinuationRequestRow {
  artifactID: string
  taskID: string
  payload: StageContinuationRequestPayload
  timeCreated: number
  timeUpdated: number
}

export interface AgentSessionContinuation {
  sessionID: string
  artifactID: string
  reason: string
  kind: StageContinuationKind
  finalizerName: string
  failedAssistantMessageID?: string
}

export interface ClaimedStageContinuation extends AgentSessionContinuation {
  claimID: string
  messageID: string
}

export function createStageContinuationRequest(input: {
  taskID: string
  stage: StageContinuationStage
  sessionID: string
  parentSessionID?: string
  normalizedStageInput?: unknown
  inputDigest: string
  failureName: StageContinuationFailureName
  failureMessage: string
  finalizerName: string
  failedAssistantMessageID?: string
  reason?: string
  now?: number
}): StageContinuationRequestRow {
  if (!AgentRoleContract.isProtocolStageContinuationID(input.stage)) {
    throw new Error(`stage continuation is not enabled for agent role: ${input.stage}`)
  }
  const now = input.now ?? Date.now()
  const artifactID = Identifier.ascending("artifact")
  const payload: StageContinuationRequestPayload = {
    continuation_id: artifactID,
    task_id: input.taskID,
    stage: input.stage,
    session_id: input.sessionID,
    ...(input.parentSessionID ? { parent_session_id: input.parentSessionID } : {}),
    ...(input.normalizedStageInput !== undefined ? { normalized_stage_input: input.normalizedStageInput } : {}),
    input_digest: input.inputDigest,
    kind: "protocol-finalizer-miss",
    reason:
      input.reason ??
      `${input.stage} ended with ${input.failureName} before ${input.finalizerName}; continue the same child session.`,
    failure_name: input.failureName,
    failure_message: input.failureMessage,
    finalizer_name: input.finalizerName,
    ...(input.failedAssistantMessageID ? { failed_assistant_message_id: input.failedAssistantMessageID } : {}),
    created_at: now,
  }
  Database.use((db) => {
    insertEngineArtifact(db, {
      id: artifactID,
      taskID: input.taskID,
      kind: "stage_continuation_request" as EngineArtifactKind,
      label: "pending",
      payload,
      timeCreated: now,
    })
  })
  return { artifactID, taskID: input.taskID, payload, timeCreated: now, timeUpdated: now }
}

export function findStageContinuationRequest(input: {
  taskID: string
  artifactID: string
}): StageContinuationRequestRow | undefined {
  const row = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, input.taskID),
          eq(EngineArtifactTable.id, input.artifactID),
          eq(EngineArtifactTable.kind, "stage_continuation_request" as EngineArtifactKind),
        ),
      )
      .orderBy(desc(EngineArtifactTable.time_updated), desc(EngineArtifactTable.id))
      .limit(1)
      .get(),
  )
  if (!row) return undefined
  const payload = normalizeStageContinuationPayload(row.payload)
  if (!payload) return undefined
  return {
    artifactID: row.id,
    taskID: row.task_id,
    payload,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

export function claimStageContinuationRequest(input: {
  taskID: string
  artifactID: string
  sessionID: string
  finalizerName: string
  now?: number
}): ClaimedStageContinuation {
  const current = findStageContinuationRequest({ taskID: input.taskID, artifactID: input.artifactID })
  if (!current) throw new Error(`stage continuation request not found: ${input.artifactID}`)
  const payload = current.payload
  if (payload.session_id !== input.sessionID) {
    throw new Error(
      `stage continuation ${input.artifactID} targets session ${payload.session_id}, not ${input.sessionID}`,
    )
  }
  if (payload.finalizer_name !== input.finalizerName) {
    throw new Error(
      `stage continuation ${input.artifactID} targets finalizer ${payload.finalizer_name}, not ${input.finalizerName}`,
    )
  }
  if (payload.consumed_at) {
    throw new Error(
      `stage continuation ${input.artifactID} already consumed by message ${payload.continuation_message_id ?? "n/a"}`,
    )
  }
  if (payload.claim_failed_at) {
    throw new Error(`stage continuation ${input.artifactID} has failed claim state: ${payload.claim_error ?? "n/a"}`)
  }
  if (payload.claimed_at) {
    throw new Error(`stage continuation ${input.artifactID} already claimed by ${payload.claim_id ?? "unknown"}`)
  }
  const now = input.now ?? Date.now()
  const claimID = Identifier.ascending("artifact")
  const messageID = Identifier.ascending("message")
  const next: StageContinuationRequestPayload = {
    ...payload,
    claimed_at: now,
    claim_id: claimID,
    claim_owner: processOwner(),
  }
  updateStageContinuationPayload({
    taskID: input.taskID,
    artifactID: input.artifactID,
    payload: next,
    label: "claimed",
    now,
  })
  return {
    sessionID: payload.session_id,
    artifactID: input.artifactID,
    reason: payload.reason,
    kind: payload.kind,
    finalizerName: payload.finalizer_name,
    failedAssistantMessageID: payload.failed_assistant_message_id,
    claimID,
    messageID,
  }
}

export function failNonCurrentOwnerStageContinuationClaim(input: {
  taskID: string
  artifactID: string
  now?: number
}): StageContinuationRequestRow | undefined {
  const current = findStageContinuationRequest({ taskID: input.taskID, artifactID: input.artifactID })
  if (!current) return undefined
  const payload = current.payload
  if (!payload.claimed_at || payload.consumed_at || payload.claim_failed_at) return current
  if (payload.claim_owner === processOwner()) return current
  const now = input.now ?? Date.now()
  const claimID = payload.claim_id ?? "unknown"
  updateStageContinuationPayload({
    taskID: input.taskID,
    artifactID: input.artifactID,
    label: "claim-failed",
    now,
    payload: {
      ...payload,
      claim_failed_at: now,
      claim_error:
        `claim ${claimID} was owned by ${payload.claim_owner ?? "an unstamped previous process"} ` +
        "but no continuation message was consumed before this process observed it.",
    },
  })
  return findStageContinuationRequest({ taskID: input.taskID, artifactID: input.artifactID })
}

export function markStageContinuationClaimFailed(input: {
  taskID: string
  artifactID: string
  claimID: string
  error: string
  now?: number
}): void {
  const current = requireStageContinuationRequest(input.taskID, input.artifactID)
  if (current.payload.claim_id !== input.claimID) return
  const now = input.now ?? Date.now()
  updateStageContinuationPayload({
    taskID: input.taskID,
    artifactID: input.artifactID,
    label: "claim-failed",
    now,
    payload: {
      ...current.payload,
      claim_failed_at: now,
      claim_error: input.error,
    },
  })
}

export function markStageContinuationConsumed(input: {
  taskID: string
  artifactID: string
  claimID: string
  messageID: string
  now?: number
}): void {
  const current = requireStageContinuationRequest(input.taskID, input.artifactID)
  if (current.payload.claim_id !== input.claimID) {
    throw new Error(
      `stage continuation ${input.artifactID} claim mismatch: ${current.payload.claim_id ?? "n/a"} != ${input.claimID}`,
    )
  }
  if (current.payload.consumed_at) return
  const now = input.now ?? Date.now()
  updateStageContinuationPayload({
    taskID: input.taskID,
    artifactID: input.artifactID,
    label: "consumed",
    now,
    payload: {
      ...current.payload,
      consumed_at: now,
      continuation_message_id: input.messageID,
    },
  })
}

function requireStageContinuationRequest(taskID: string, artifactID: string): StageContinuationRequestRow {
  const row = findStageContinuationRequest({ taskID, artifactID })
  if (!row) throw new Error(`stage continuation request not found: ${artifactID}`)
  return row
}

function updateStageContinuationPayload(input: {
  taskID: string
  artifactID: string
  payload: StageContinuationRequestPayload
  label: string
  now: number
}): void {
  Database.use((db) => {
    updateEngineArtifactsWhere(db, {
      payload: input.payload,
      label: input.label,
      timeUpdated: input.now,
      where: and(
        eq(EngineArtifactTable.task_id, input.taskID),
        eq(EngineArtifactTable.id, input.artifactID),
        eq(EngineArtifactTable.kind, "stage_continuation_request" as EngineArtifactKind),
      )!,
    })
  })
}

function normalizeStageContinuationPayload(payload: unknown): StageContinuationRequestPayload | undefined {
  if (!payload || typeof payload !== "object") return undefined
  const value = payload as Record<string, unknown>
  if (typeof value.continuation_id !== "string" || value.continuation_id.length === 0) return undefined
  if (typeof value.task_id !== "string" || value.task_id.length === 0) return undefined
  if (!isStageContinuationStage(value.stage)) return undefined
  if (typeof value.session_id !== "string" || value.session_id.length === 0) return undefined
  if (value.kind !== "protocol-finalizer-miss") return undefined
  if (value.failure_name !== "TerminalToolMissingError" && value.failure_name !== "StructuredOutputError") {
    return undefined
  }
  if (typeof value.failure_message !== "string" || value.failure_message.length === 0) return undefined
  if (typeof value.finalizer_name !== "string" || value.finalizer_name.length === 0) return undefined
  if (typeof value.input_digest !== "string" || value.input_digest.length === 0) return undefined
  if (typeof value.reason !== "string" || value.reason.length === 0) return undefined
  if (typeof value.created_at !== "number" || !(value.created_at > 0)) return undefined
  return value as unknown as StageContinuationRequestPayload
}

export function isStageContinuationStage(value: unknown): value is StageContinuationStage {
  return typeof value === "string" && AgentRoleContract.isProtocolStageContinuationID(value)
}
