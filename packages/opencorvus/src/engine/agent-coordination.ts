import { Event } from "@/engine/model"
import { EngineProtocol } from "@/engine/protocol"
import { Identifier } from "@/id/id"
import { processOwner } from "@/engine/lease"
import { and, desc, eq } from "@/storage/db"
import { Database } from "@/storage/db"
import { EngineArtifactTable, EngineTaskTable, type EngineArtifactKind, type EngineMetadata } from "./engine.sql"

export type AgentCoordinationSeverity = "info" | "blocked" | "failure"
export type AgentCoordinationRequestStatus = "pending" | "responded" | "cancelled"
export type AgentCoordinationDecision = "continue" | "cancel_worker" | "redispatch" | "fail_task" | "ask_user"

export interface AgentCoordinationRequestPayload extends EngineMetadata {
  request_id: string
  task_id: string
  session_id: string
  agent: string
  message_id: string
  goal_id?: string
  goal_run_id?: string
  owner: string
  summary: string
  details: string
  blocking: boolean
  requested_decision: string
  evidence_refs?: string[]
  severity: AgentCoordinationSeverity
  status: AgentCoordinationRequestStatus
  created_at: number
  responded_at?: number
  response_id?: string
  cancelled_at?: number
  cancel_reason?: string
}

export interface AgentCoordinationResponsePayload extends EngineMetadata {
  response_id: string
  request_id: string
  task_id: string
  orchestrator_session_id: string
  orchestrator_message_id: string
  decision: AgentCoordinationDecision
  reason: string
  message?: string
  worker_message_id?: string
  created_at: number
}

export interface AgentCoordinationRequestRow {
  artifactID: string
  taskID: string
  payload: AgentCoordinationRequestPayload
  timeCreated: number
  timeUpdated: number
}

export interface AgentCoordinationResponseRow {
  artifactID: string
  taskID: string
  payload: AgentCoordinationResponsePayload
  timeCreated: number
  timeUpdated: number
}

function requireTask(taskID: string): void {
  const row = Database.use((db) =>
    db.select({ id: EngineTaskTable.id }).from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get(),
  )
  if (!row) throw new Error(`Agent coordination task not found: ${taskID}`)
}

function pendingRequestForSession(input: {
  taskID: string
  sessionID: string
}): AgentCoordinationRequestRow | undefined {
  return listAgentCoordinationRequests(input.taskID).find(
    (row) => row.payload.session_id === input.sessionID && row.payload.status === "pending",
  )
}

export function createAgentCoordinationRequest(input: {
  taskID: string
  sessionID: string
  agent: string
  messageID: string
  summary: string
  details: string
  blocking: boolean
  requestedDecision: string
  evidenceRefs?: string[]
  severity?: AgentCoordinationSeverity
  goalID?: string
  goalRunID?: string
  now?: number
}): AgentCoordinationRequestRow {
  requireTask(input.taskID)
  const existing = pendingRequestForSession({ taskID: input.taskID, sessionID: input.sessionID })
  if (existing) {
    throw new Error(
      `Agent coordination request already pending for session ${input.sessionID}: ${existing.payload.request_id}`,
    )
  }

  const now = input.now ?? Date.now()
  const requestID = Identifier.ascending("artifact")
  const severity = input.severity ?? (input.blocking ? "blocked" : "info")
  const payload: AgentCoordinationRequestPayload = {
    request_id: requestID,
    task_id: input.taskID,
    session_id: input.sessionID,
    agent: input.agent,
    message_id: input.messageID,
    ...(input.goalID ? { goal_id: input.goalID } : {}),
    ...(input.goalRunID ? { goal_run_id: input.goalRunID } : {}),
    owner: processOwner(),
    summary: input.summary,
    details: input.details,
    blocking: input.blocking,
    requested_decision: input.requestedDecision,
    ...(input.evidenceRefs && input.evidenceRefs.length > 0 ? { evidence_refs: input.evidenceRefs } : {}),
    severity,
    status: "pending",
    created_at: now,
  }

  Database.use((db) => {
    db.insert(EngineArtifactTable)
      .values({
        id: requestID,
        task_id: input.taskID,
        run_id: null,
        goal_run_id: input.goalRunID ?? null,
        acceptance_id: null,
        kind: "agent_coordination_request" as EngineArtifactKind,
        label: "pending",
        payload,
        time_created: now,
        time_updated: now,
      })
      .run()
  })

  void EngineProtocol.emit(
    Event.AgentCoordinationRequested,
    {
      taskID: input.taskID,
      requestID,
      sessionID: input.sessionID,
      agent: input.agent,
      blocking: input.blocking,
      severity,
      summary: input.summary,
    },
    {
      taskID: input.taskID,
      sessionID: input.sessionID,
      goalRunID: input.goalRunID,
      source: input.agent,
      target: "orchestrator",
      correlationID: requestID,
    },
  )

  return { artifactID: requestID, taskID: input.taskID, payload, timeCreated: now, timeUpdated: now }
}

export function listAgentCoordinationRequests(taskID: string): AgentCoordinationRequestRow[] {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "agent_coordination_request")))
      .orderBy(desc(EngineArtifactTable.time_updated), desc(EngineArtifactTable.id))
      .all(),
  )
  return rows.flatMap((row) => {
    const payload = normalizeAgentCoordinationRequestPayload(row.payload)
    if (!payload) return []
    return [
      {
        artifactID: row.id,
        taskID: row.task_id,
        payload,
        timeCreated: row.time_created,
        timeUpdated: row.time_updated,
      },
    ]
  })
}

export function listPendingAgentCoordinationRequests(taskID: string): AgentCoordinationRequestRow[] {
  return listAgentCoordinationRequests(taskID).filter((row) => row.payload.status === "pending")
}

export function findAgentCoordinationRequest(input: {
  taskID: string
  requestID: string
}): AgentCoordinationRequestRow | undefined {
  const row = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, input.taskID),
          eq(EngineArtifactTable.id, input.requestID),
          eq(EngineArtifactTable.kind, "agent_coordination_request"),
        ),
      )
      .get(),
  )
  if (!row) return undefined
  const payload = normalizeAgentCoordinationRequestPayload(row.payload)
  if (!payload) return undefined
  return {
    artifactID: row.id,
    taskID: row.task_id,
    payload,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

export function createAgentCoordinationResponse(input: {
  taskID: string
  requestID: string
  orchestratorSessionID: string
  orchestratorMessageID: string
  decision: AgentCoordinationDecision
  reason: string
  message?: string
  workerMessageID?: string
  now?: number
}): AgentCoordinationResponseRow {
  const request = findAgentCoordinationRequest({ taskID: input.taskID, requestID: input.requestID })
  if (!request) throw new Error(`Agent coordination request not found: ${input.requestID}`)
  if (request.payload.status !== "pending") {
    throw new Error(`Agent coordination request ${input.requestID} is ${request.payload.status}`)
  }
  const now = input.now ?? Date.now()
  const responseID = Identifier.ascending("artifact")
  const payload: AgentCoordinationResponsePayload = {
    response_id: responseID,
    request_id: input.requestID,
    task_id: input.taskID,
    orchestrator_session_id: input.orchestratorSessionID,
    orchestrator_message_id: input.orchestratorMessageID,
    decision: input.decision,
    reason: input.reason,
    ...(input.message ? { message: input.message } : {}),
    ...(input.workerMessageID ? { worker_message_id: input.workerMessageID } : {}),
    created_at: now,
  }

  Database.use((db) => {
    db.insert(EngineArtifactTable)
      .values({
        id: responseID,
        task_id: input.taskID,
        run_id: null,
        goal_run_id: request.payload.goal_run_id ?? null,
        acceptance_id: null,
        kind: "agent_coordination_response" as EngineArtifactKind,
        label: input.decision,
        payload,
        time_created: now,
        time_updated: now,
      })
      .run()
    db.update(EngineArtifactTable)
      .set({
        label: "responded",
        payload: {
          ...request.payload,
          status: "responded",
          responded_at: now,
          response_id: responseID,
        } satisfies AgentCoordinationRequestPayload,
        time_updated: now,
      })
      .where(
        and(
          eq(EngineArtifactTable.task_id, input.taskID),
          eq(EngineArtifactTable.id, input.requestID),
          eq(EngineArtifactTable.kind, "agent_coordination_request"),
        ),
      )
      .run()
  })

  void EngineProtocol.emit(
    Event.AgentCoordinationResponded,
    {
      taskID: input.taskID,
      requestID: input.requestID,
      responseID,
      sessionID: request.payload.session_id,
      decision: input.decision,
      summary: input.reason,
    },
    {
      taskID: input.taskID,
      sessionID: request.payload.session_id,
      goalRunID: request.payload.goal_run_id,
      source: "orchestrator",
      target: request.payload.agent,
      correlationID: input.requestID,
      causationID: responseID,
    },
  )

  return { artifactID: responseID, taskID: input.taskID, payload, timeCreated: now, timeUpdated: now }
}

export function cancelPendingAgentCoordinationRequestsForSession(input: {
  taskID: string
  sessionID: string
  reason: string
  now?: number
}): number {
  const pending = listPendingAgentCoordinationRequests(input.taskID).filter(
    (row) => row.payload.session_id === input.sessionID,
  )
  const now = input.now ?? Date.now()
  for (const request of pending) {
    const payload: AgentCoordinationRequestPayload = {
      ...request.payload,
      status: "cancelled",
      cancelled_at: now,
      cancel_reason: input.reason,
    }
    Database.use((db) => {
      db.update(EngineArtifactTable)
        .set({ label: "cancelled", payload, time_updated: now })
        .where(
          and(
            eq(EngineArtifactTable.task_id, input.taskID),
            eq(EngineArtifactTable.id, request.artifactID),
            eq(EngineArtifactTable.kind, "agent_coordination_request"),
          ),
        )
        .run()
    })
    void EngineProtocol.emit(
      Event.AgentCoordinationCancelled,
      {
        taskID: input.taskID,
        requestID: request.payload.request_id,
        sessionID: input.sessionID,
        summary: input.reason,
      },
      {
        taskID: input.taskID,
        sessionID: input.sessionID,
        source: "orchestrator",
        target: request.payload.agent,
        correlationID: request.payload.request_id,
      },
    )
  }
  return pending.length
}

function normalizeAgentCoordinationRequestPayload(payload: unknown): AgentCoordinationRequestPayload | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined
  const value = payload as Record<string, unknown>
  if (typeof value.request_id !== "string" || value.request_id.length === 0) return undefined
  if (typeof value.task_id !== "string" || value.task_id.length === 0) return undefined
  if (typeof value.session_id !== "string" || value.session_id.length === 0) return undefined
  if (typeof value.agent !== "string" || value.agent.length === 0) return undefined
  if (typeof value.message_id !== "string" || value.message_id.length === 0) return undefined
  if (typeof value.owner !== "string" || value.owner.length === 0) return undefined
  if (typeof value.summary !== "string" || value.summary.length === 0) return undefined
  if (typeof value.details !== "string" || value.details.length === 0) return undefined
  if (typeof value.blocking !== "boolean") return undefined
  if (typeof value.requested_decision !== "string" || value.requested_decision.length === 0) return undefined
  if (value.severity !== "info" && value.severity !== "blocked" && value.severity !== "failure") return undefined
  if (value.status !== "pending" && value.status !== "responded" && value.status !== "cancelled") return undefined
  if (typeof value.created_at !== "number" || !(value.created_at > 0)) return undefined
  return value as unknown as AgentCoordinationRequestPayload
}
