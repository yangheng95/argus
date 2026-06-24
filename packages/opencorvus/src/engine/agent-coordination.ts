import { Event } from "@/engine/model"
import { EngineProtocol } from "@/engine/protocol"
import { Identifier } from "@/id/id"
import { processOwner } from "@/engine/lease"
import { taskIDForSession } from "@/orchestrator/task-event"
import { and, desc, eq, sql } from "@/storage/db"
import { Database } from "@/storage/db"
import { EngineArtifactTable, EngineTaskTable, type EngineArtifactKind, type EngineMetadata } from "./engine.sql"
import { findGoal, findGoalRun } from "./store"
import { listLiveOrchestratorToolOwnership } from "./tool-ownership"

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

type AgentCoordinationArtifactRow = typeof EngineArtifactTable.$inferSelect

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

function requestRowFromArtifact(row: AgentCoordinationArtifactRow): AgentCoordinationRequestRow | undefined {
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

function validateAgentCoordinationRequestBinding(input: {
  taskID: string
  sessionID: string
  goalID?: string
  goalRunID?: string
}): void {
  const owningTask = taskIDForSession(input.sessionID)
  if (owningTask && owningTask !== input.taskID) {
    throw new Error(`Agent coordination session ${input.sessionID} belongs to task ${owningTask}, not ${input.taskID}`)
  }

  const liveOwnership = listLiveOrchestratorToolOwnership(input.taskID).find(
    (ownership) => ownership.payload.child_session_id === input.sessionID,
  )

  if (input.goalID) {
    const goal = findGoal(input.goalID)
    if (!goal) throw new Error(`Agent coordination goal not found: ${input.goalID}`)
    if (goal.task_id !== input.taskID) {
      throw new Error(`Agent coordination goal ${input.goalID} belongs to task ${goal.task_id}, not ${input.taskID}`)
    }
  }

  let goalRunSessionMatches = false
  if (input.goalRunID) {
    const goalRun = findGoalRun(input.goalRunID)
    if (!goalRun) throw new Error(`Agent coordination goal_run not found: ${input.goalRunID}`)
    if (goalRun.task_id !== input.taskID) {
      throw new Error(
        `Agent coordination goal_run ${input.goalRunID} belongs to task ${goalRun.task_id}, not ${input.taskID}`,
      )
    }
    if (input.goalID && goalRun.goal_id !== input.goalID) {
      throw new Error(
        `Agent coordination goal_run ${input.goalRunID} belongs to goal ${goalRun.goal_id}, not ${input.goalID}`,
      )
    }
    if (goalRun.session_id !== input.sessionID) {
      throw new Error(
        `Agent coordination goal_run ${input.goalRunID} is bound to session ${goalRun.session_id ?? "null"}, not ${input.sessionID}`,
      )
    }
    goalRunSessionMatches = true
  }

  if (owningTask === input.taskID || liveOwnership || goalRunSessionMatches) return
  throw new Error(`Agent coordination session ${input.sessionID} is not owned by task ${input.taskID}`)
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
  validateAgentCoordinationRequestBinding(input)
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
    const request = requestRowFromArtifact(row)
    return request ? [request] : []
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
  return requestRowFromArtifact(row)
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
  const now = input.now ?? Date.now()
  const responseID = Identifier.ascending("artifact")
  let request: AgentCoordinationRequestRow | undefined
  let payload: AgentCoordinationResponsePayload | undefined

  Database.transaction((db) => {
    const requestRow = db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, input.taskID),
          eq(EngineArtifactTable.id, input.requestID),
          eq(EngineArtifactTable.kind, "agent_coordination_request"),
        ),
      )
      .get()
    request = requestRow ? requestRowFromArtifact(requestRow) : undefined
    if (!request) throw new Error(`Agent coordination request not found: ${input.requestID}`)
    if (request.payload.status !== "pending") {
      throw new Error(`Agent coordination request ${input.requestID} is ${request.payload.status}`)
    }

    payload = {
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

    const updated = db
      .update(EngineArtifactTable)
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
          eq(EngineArtifactTable.label, "pending"),
          sql`json_extract(${EngineArtifactTable.payload}, '$.status') = 'pending'`,
        ),
      )
      .returning({ id: EngineArtifactTable.id })
      .get()
    if (!updated) throw new Error(`Agent coordination request ${input.requestID} was already claimed`)

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
  })

  if (!request || !payload) throw new Error(`Agent coordination response transaction failed: ${input.requestID}`)

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

function cancelPendingAgentCoordinationRequests(input: {
  taskID: string
  reason: string
  filter?: (row: AgentCoordinationRequestRow) => boolean
  now?: number
}): number {
  const pending = listPendingAgentCoordinationRequests(input.taskID).filter((row) => input.filter?.(row) ?? true)
  const now = input.now ?? Date.now()
  let cancelled = 0
  for (const request of pending) {
    const payload: AgentCoordinationRequestPayload = {
      ...request.payload,
      status: "cancelled",
      cancelled_at: now,
      cancel_reason: input.reason,
    }
    const updated = Database.use((db) =>
      db
        .update(EngineArtifactTable)
        .set({ label: "cancelled", payload, time_updated: now })
        .where(
          and(
            eq(EngineArtifactTable.task_id, input.taskID),
            eq(EngineArtifactTable.id, request.artifactID),
            eq(EngineArtifactTable.kind, "agent_coordination_request"),
            eq(EngineArtifactTable.label, "pending"),
            sql`json_extract(${EngineArtifactTable.payload}, '$.status') = 'pending'`,
          ),
        )
        .returning({ id: EngineArtifactTable.id })
        .get(),
    )
    if (!updated) continue
    cancelled += 1
    void EngineProtocol.emit(
      Event.AgentCoordinationCancelled,
      {
        taskID: input.taskID,
        requestID: request.payload.request_id,
        sessionID: request.payload.session_id,
        summary: input.reason,
      },
      {
        taskID: input.taskID,
        sessionID: request.payload.session_id,
        source: "orchestrator",
        target: request.payload.agent,
        correlationID: request.payload.request_id,
      },
    )
  }
  return cancelled
}

export function cancelPendingAgentCoordinationRequestsForSession(input: {
  taskID: string
  sessionID: string
  reason: string
  now?: number
}): number {
  return cancelPendingAgentCoordinationRequests({
    taskID: input.taskID,
    reason: input.reason,
    now: input.now,
    filter: (row) => row.payload.session_id === input.sessionID,
  })
}

export function cancelPendingAgentCoordinationRequestsForTask(input: {
  taskID: string
  reason: string
  now?: number
}): number {
  return cancelPendingAgentCoordinationRequests(input)
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
