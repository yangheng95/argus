import { WorkflowRegistry, type MiniWorkflow, type SchedulerAgentWorkflowBinding } from "@/engine/workflow"
import { AgentRoleContract } from "@/agent/role-contract"
export type AgentCoordinationRedispatchBinding = SchedulerAgentWorkflowBinding
import { Event } from "@/engine/model"
import { EngineProtocol } from "@/engine/protocol"
import { Identifier } from "@/id/id"
import { processOwner } from "@/engine/lease"
import { taskIDForSession } from "@/orchestrator/task-event"
import { and, desc, eq, sql } from "@/storage/db"
import { Database } from "@/storage/db"
import { EngineArtifactTable, EngineTaskTable, type EngineArtifactKind, type EngineMetadata } from "./engine.sql"
import { insertEngineArtifact, updateEngineArtifactsWhere, updateEngineArtifactWhereReturning } from "./artifact"
import { findGoal, findGoalRun } from "./store"
import { listLiveOrchestratorToolOwnership } from "./tool-ownership"

export type AgentCoordinationSeverity = "info" | "blocked" | "failure"
export type AgentCoordinationRequestStatus = "pending" | "responded" | "cancelled"
export type AgentCoordinationRequestOrigin = "worker_request" | "operator_steer"
export type AgentCoordinationDecision = "continue" | "cancel_worker" | "redispatch" | "fail_task" | "ask_user"
export type AgentCoordinationActionKind =
  | "continue_worker"
  | "cancel_worker"
  | "redispatch_worker"
  | "fail_task"
  | "ask_user"
export type AgentCoordinationActionStatus = "pending" | "completed" | "failed"
export type AgentCoordinationSessionOwnershipSource = "task_session_tree" | "live_tool_ownership" | "goal_run_session"

export interface AgentCoordinationSessionOwnership {
  source: AgentCoordinationSessionOwnershipSource
  toolOwnershipID?: string
  toolOwnershipArtifactID?: string
}

export interface AgentCoordinationRequestPayload extends EngineMetadata {
  request_id: string
  task_id: string
  session_id: string
  agent: string
  origin?: AgentCoordinationRequestOrigin
  message_id?: string
  tool_call_id?: string
  operator_steer_id?: string
  operator_message?: string
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
  last_failed_response_id?: string
  last_failed_action_id?: string
  last_action_error?: string
  last_action_failed_at?: number
  cancelled_at?: number
  cancel_reason?: string
  session_ownership_source?: AgentCoordinationSessionOwnershipSource
  tool_ownership_id?: string
  tool_ownership_artifact_id?: string
}

export interface AgentCoordinationResponsePayload extends EngineMetadata {
  response_id: string
  request_id: string
  action_id: string
  task_id: string
  orchestrator_session_id: string
  orchestrator_message_id: string
  orchestrator_tool_call_id: string
  orchestrator_tool_part_id: string
  decision: AgentCoordinationDecision
  reason: string
  message?: string
  created_at: number
}

export interface AgentCoordinationActionPayload extends EngineMetadata {
  action_id: string
  request_id: string
  response_id: string
  task_id: string
  orchestrator_session_id: string
  orchestrator_message_id: string
  orchestrator_tool_call_id: string
  orchestrator_tool_part_id: string
  action: AgentCoordinationActionKind
  decision: AgentCoordinationDecision
  target_session_id: string
  target_agent: string
  goal_id?: string
  goal_run_id?: string
  reason: string
  status: AgentCoordinationActionStatus
  created_at: number
  completed_at?: number
  failed_at?: number
  worker_message_id?: string
  error?: string
  result?: Record<string, unknown>
}

export interface AgentCoordinationRequestRow {
  artifactID: string
  taskID: string
  payload: AgentCoordinationRequestPayload
  timeCreated: number
  timeUpdated: number
  createdNow: boolean
}

export interface AgentCoordinationResponseRow {
  artifactID: string
  taskID: string
  payload: AgentCoordinationResponsePayload
  timeCreated: number
  timeUpdated: number
  createdNow?: boolean
}

export class AgentCoordinationPendingConflictError extends Error {
  readonly taskID: string
  readonly sessionID: string
  readonly requestIDs: string[]

  constructor(input: { taskID: string; sessionID: string; requestIDs: string[] }) {
    super(
      `Agent coordination session ${input.sessionID} already has pending request(s): ${input.requestIDs.join(", ")}`,
    )
    this.name = "AgentCoordinationPendingConflictError"
    this.taskID = input.taskID
    this.sessionID = input.sessionID
    this.requestIDs = input.requestIDs
  }
}

export interface AgentCoordinationActionRow {
  artifactID: string
  taskID: string
  payload: AgentCoordinationActionPayload
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

function requestForInvocationInTransaction(
  db: Database.TxOrDb,
  input: {
    taskID: string
    sessionID: string
    messageID: string
    callID?: string
  },
): AgentCoordinationRequestRow | undefined {
  const rows = db
    .select()
    .from(EngineArtifactTable)
    .where(
      and(
        eq(EngineArtifactTable.task_id, input.taskID),
        eq(EngineArtifactTable.kind, "agent_coordination_request"),
        sql`json_extract(${EngineArtifactTable.payload}, '$.session_id') = ${input.sessionID}`,
        sql`json_extract(${EngineArtifactTable.payload}, '$.message_id') = ${input.messageID}`,
        sql`coalesce(json_extract(${EngineArtifactTable.payload}, '$.tool_call_id'), '') = ${input.callID ?? ""}`,
      ),
    )
    .all()
  if (rows.length > 1) {
    throw new Error(
      `Agent coordination request invocation ${input.sessionID}/${input.messageID}/${input.callID ?? ""} has ${rows.length} persisted requests`,
    )
  }
  const row = rows[0]
  return row ? requestRowFromArtifact(row) : undefined
}

function operatorSteerRequestInTransaction(
  db: Database.TxOrDb,
  input: {
    taskID: string
    operatorSteerID: string
  },
): AgentCoordinationRequestRow | undefined {
  const rows = db
    .select()
    .from(EngineArtifactTable)
    .where(
      and(
        eq(EngineArtifactTable.task_id, input.taskID),
        eq(EngineArtifactTable.kind, "agent_coordination_request"),
        sql`json_extract(${EngineArtifactTable.payload}, '$.operator_steer_id') = ${input.operatorSteerID}`,
      ),
    )
    .all()
  if (rows.length > 1) {
    throw new Error(
      `Operator steer request ${input.operatorSteerID} for task ${input.taskID} has ${rows.length} persisted requests`,
    )
  }
  const row = rows[0]
  return row ? requestRowFromArtifact(row) : undefined
}

function pendingSessionControlRequestsInTransaction(
  db: Database.TxOrDb,
  input: {
    taskID: string
    sessionID: string
    goalRunID?: string
  },
): AgentCoordinationRequestRow[] {
  const scopePredicate = input.goalRunID
    ? sql`(json_extract(${EngineArtifactTable.payload}, '$.session_id') = ${input.sessionID} or json_extract(${EngineArtifactTable.payload}, '$.goal_run_id') = ${input.goalRunID})`
    : sql`json_extract(${EngineArtifactTable.payload}, '$.session_id') = ${input.sessionID}`
  return db
    .select()
    .from(EngineArtifactTable)
    .where(
      and(
        eq(EngineArtifactTable.task_id, input.taskID),
        eq(EngineArtifactTable.kind, "agent_coordination_request"),
        eq(EngineArtifactTable.label, "pending"),
        sql`json_extract(${EngineArtifactTable.payload}, '$.status') = 'pending'`,
        scopePredicate,
      ),
    )
    .all()
    .map(requestRowFromArtifact)
}

function requestRowFromArtifact(row: AgentCoordinationArtifactRow): AgentCoordinationRequestRow {
  const payload = normalizeAgentCoordinationRequestPayload(row.payload)
  if (!payload) {
    throw new Error(`Malformed agent coordination request artifact ${row.id} for task ${row.task_id}`)
  }
  return {
    artifactID: row.id,
    taskID: row.task_id,
    payload,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
    createdNow: false,
  }
}

function responseRowFromArtifact(row: AgentCoordinationArtifactRow): AgentCoordinationResponseRow {
  const payload = normalizeAgentCoordinationResponsePayload(row.payload)
  if (!payload) {
    throw new Error(`Malformed agent coordination response artifact ${row.id} for task ${row.task_id}`)
  }
  return {
    artifactID: row.id,
    taskID: row.task_id,
    payload,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

function actionKindForDecision(decision: AgentCoordinationDecision): AgentCoordinationActionKind {
  if (decision === "continue") return "continue_worker"
  if (decision === "cancel_worker") return "cancel_worker"
  if (decision === "redispatch") return "redispatch_worker"
  return decision
}

function actionRowFromArtifact(row: AgentCoordinationArtifactRow): AgentCoordinationActionRow {
  const payload = normalizeAgentCoordinationActionPayload(row.payload)
  if (!payload) {
    throw new Error(`Malformed agent coordination action artifact ${row.id} for task ${row.task_id}`)
  }
  return {
    artifactID: row.id,
    taskID: row.task_id,
    payload,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }
}

function assertAgentCoordinationActionPayload(payload: AgentCoordinationActionPayload): void {
  if (!normalizeAgentCoordinationActionPayload(payload)) {
    throw new Error(`Malformed agent coordination action payload: ${payload.action_id}`)
  }
}

function emitAgentCoordinationActionEventInTransaction(input: {
  taskID: string
  sessionID: string
  goalRunID?: string
  payload: AgentCoordinationActionPayload
  summary: string
}): void {
  EngineProtocol.emitInTransaction(
    Event.AgentCoordinationActionUpdated,
    {
      taskID: input.taskID,
      requestID: input.payload.request_id,
      responseID: input.payload.response_id,
      actionID: input.payload.action_id,
      sessionID: input.sessionID,
      action: input.payload.action,
      status: input.payload.status,
      summary: input.summary,
    },
    {
      taskID: input.taskID,
      sessionID: input.sessionID,
      goalRunID: input.goalRunID,
      source: "orchestrator",
      target: input.payload.target_agent,
      correlationID: input.payload.request_id,
      causationID: input.payload.action_id,
    },
  )
}

function actionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function assertRequestedDecisionIsNotRedispatchActionLiteral(value: string): void {
  const normalized = value.trim().toLowerCase()
  if (normalized === "redispatch" || normalized === "redispatch_worker") {
    throw new Error(
      "Agent coordination requested_decision must describe the scheduling question, not the redispatch response action literal.",
    )
  }
}

function sameRedispatchBinding(left: unknown, right: AgentCoordinationRedispatchBinding | undefined): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

const LEGACY_REDISPATCH_RESULT_FIELDS = ["workflow_tool_name", "stage", "target_kind"] as const

function hasLegacyRedispatchResultFields(result: Record<string, unknown>): boolean {
  return LEGACY_REDISPATCH_RESULT_FIELDS.some((field) => Object.hasOwn(result, field))
}

function normalizeRedispatchBinding(
  value: unknown,
  expectedAgent: string,
): AgentCoordinationRedispatchBinding | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const candidate = value as Partial<AgentCoordinationRedispatchBinding>
  if (
    typeof candidate.workflow_tool_name !== "string" ||
    typeof candidate.stage !== "string" ||
    typeof candidate.target_kind !== "string"
  ) {
    return undefined
  }
  if (!WorkflowRegistry.isWorkflowToolName(candidate.workflow_tool_name)) return undefined
  if (!AgentRoleContract.isRoleID(candidate.stage) || !AgentRoleContract.isRoleID(candidate.target_kind)) {
    return undefined
  }
  if (candidate.stage !== expectedAgent || candidate.target_kind !== candidate.stage) return undefined
  return {
    workflow_tool_name: candidate.workflow_tool_name,
    stage: candidate.stage,
    target_kind: candidate.stage,
  }
}

function deriveAgentCoordinationRedispatchBinding(input: {
  decision: AgentCoordinationDecision
  request: AgentCoordinationRequestRow
  workflow?: MiniWorkflow
}): AgentCoordinationRedispatchBinding | undefined {
  if (input.decision !== "redispatch") return undefined
  const binding = WorkflowRegistry.schedulerAgentWorkflowBindingsForWorkflow(input.workflow).find(
    (candidate) => candidate.stage === input.request.payload.agent,
  )
  if (!binding) {
    throw new Error(
      `Agent coordination redispatch for ${input.request.payload.agent} requires a concrete scheduler workflow binding`,
    )
  }
  return binding
}

function redispatchBindingFromExistingAction(input: {
  request: AgentCoordinationRequestRow
  existingAction: AgentCoordinationActionRow
}): AgentCoordinationRedispatchBinding | undefined {
  if (input.existingAction.payload.action !== "redispatch_worker") return undefined
  const rawBinding = input.existingAction.payload.result?.redispatch_binding
  if (!rawBinding || typeof rawBinding !== "object" || Array.isArray(rawBinding)) {
    throw new Error(
      `Agent coordination redispatch action ${input.existingAction.payload.action_id} has malformed redispatch_binding`,
    )
  }
  const binding = normalizeRedispatchBinding(rawBinding, input.request.payload.agent)
  if (!binding) {
    throw new Error(
      `Agent coordination redispatch action ${input.existingAction.payload.action_id} has invalid redispatch_binding`,
    )
  }
  return binding
}

function mergeAgentCoordinationActionResult(input: {
  current: AgentCoordinationActionPayload
  patch: Record<string, unknown>
}): Record<string, unknown> {
  const currentResult = input.current.result ?? {}
  if (input.current.action !== "redispatch_worker") return { ...currentResult, ...input.patch }

  const currentBinding = normalizeRedispatchBinding(currentResult.redispatch_binding, input.current.target_agent)
  if (!currentBinding) {
    throw new Error(`Agent coordination redispatch action ${input.current.action_id} has invalid redispatch_binding`)
  }
  if (Object.hasOwn(input.patch, "redispatch_binding")) {
    const patchBinding = normalizeRedispatchBinding(input.patch.redispatch_binding, input.current.target_agent)
    if (!sameRedispatchBinding(patchBinding, currentBinding)) {
      throw new Error(
        `Agent coordination redispatch action ${input.current.action_id} cannot replace scheduler-derived redispatch_binding`,
      )
    }
  }
  const { redispatch_binding: _redispatchBinding, ...patchWithoutBinding } = input.patch
  return { ...currentResult, ...patchWithoutBinding, redispatch_binding: currentResult.redispatch_binding }
}

function assertReplayMatchesExistingResponse(input: {
  existingResponse: AgentCoordinationResponseRow
  existingAction: AgentCoordinationActionRow
  requestID: string
  taskID: string
  orchestratorSessionID: string
  orchestratorMessageID: string
  orchestratorToolCallID: string
  orchestratorToolPartID: string
  decision: AgentCoordinationDecision
  reason: string
  message?: string
  redispatchBinding?: AgentCoordinationRedispatchBinding
}): void {
  const response = input.existingResponse.payload
  const action = input.existingAction.payload
  const mismatches: string[] = []
  if (response.request_id !== input.requestID) mismatches.push("request_id")
  if (response.task_id !== input.taskID) mismatches.push("task_id")
  if (response.orchestrator_session_id !== input.orchestratorSessionID) mismatches.push("orchestrator_session_id")
  if (response.orchestrator_message_id !== input.orchestratorMessageID) mismatches.push("orchestrator_message_id")
  if (response.orchestrator_tool_call_id !== input.orchestratorToolCallID) mismatches.push("orchestrator_tool_call_id")
  if (response.orchestrator_tool_part_id !== input.orchestratorToolPartID) mismatches.push("orchestrator_tool_part_id")
  if (response.decision !== input.decision) mismatches.push("decision")
  if (response.reason !== input.reason) mismatches.push("reason")
  if ((response.message ?? undefined) !== (input.message ?? undefined)) mismatches.push("message")
  if (!sameRedispatchBinding(action.result?.redispatch_binding, input.redispatchBinding)) {
    mismatches.push("redispatch_binding")
  }
  if (mismatches.length > 0) {
    throw new Error(`Agent coordination response replay mismatch for ${input.requestID}: ${mismatches.join(", ")}`)
  }
}

function sameStringList(left: string[] | undefined, right: string[] | undefined): boolean {
  const leftList = left ?? []
  const rightList = right ?? []
  if (leftList.length !== rightList.length) return false
  return leftList.every((value, index) => value === rightList[index])
}

function assertReplayMatchesExistingRequest(input: {
  existing: AgentCoordinationRequestRow
  callID?: string
  agent: string
  summary: string
  details: string
  blocking: boolean
  requestedDecision: string
  evidenceRefs?: string[]
  severity: AgentCoordinationSeverity
  goalID?: string
  goalRunID?: string
}): void {
  const payload = input.existing.payload
  const mismatches: string[] = []
  if ((payload.tool_call_id ?? "") !== (input.callID ?? "")) mismatches.push("tool_call_id")
  if (payload.agent !== input.agent) mismatches.push("agent")
  if (payload.summary !== input.summary) mismatches.push("summary")
  if (payload.details !== input.details) mismatches.push("details")
  if (payload.blocking !== input.blocking) mismatches.push("blocking")
  if (payload.requested_decision !== input.requestedDecision) mismatches.push("requested_decision")
  if (!sameStringList(payload.evidence_refs, input.evidenceRefs)) mismatches.push("evidence_refs")
  if (payload.severity !== input.severity) mismatches.push("severity")
  if ((payload.goal_id ?? undefined) !== (input.goalID ?? undefined)) mismatches.push("goal_id")
  if ((payload.goal_run_id ?? undefined) !== (input.goalRunID ?? undefined)) mismatches.push("goal_run_id")
  if (mismatches.length === 0) return
  throw new Error(
    `Agent coordination request replay for message ${payload.message_id} conflicts with existing request ${payload.request_id}: ${mismatches.join(", ")}`,
  )
}

function assertReplayMatchesExistingOperatorSteerRequest(input: {
  existing: AgentCoordinationRequestRow
  agent: string
  operatorMessage: string
  summary: string
  details: string
  goalID?: string
  goalRunID?: string
}): void {
  const payload = input.existing.payload
  const mismatches: string[] = []
  if (payload.origin !== "operator_steer") mismatches.push("origin")
  if (payload.agent !== input.agent) mismatches.push("agent")
  if ((payload.operator_message ?? "") !== input.operatorMessage) mismatches.push("operator_message")
  if (payload.summary !== input.summary) mismatches.push("summary")
  if (payload.details !== input.details) mismatches.push("details")
  if ((payload.goal_id ?? undefined) !== (input.goalID ?? undefined)) mismatches.push("goal_id")
  if ((payload.goal_run_id ?? undefined) !== (input.goalRunID ?? undefined)) mismatches.push("goal_run_id")
  if (mismatches.length === 0) return
  throw new Error(
    `Operator steer request replay for ${payload.operator_steer_id ?? payload.request_id} conflicts with existing request ${payload.request_id}: ${mismatches.join(", ")}`,
  )
}

export function resolveAgentCoordinationSessionOwnership(input: {
  taskID: string
  sessionID: string
  goalID?: string
  goalRunID?: string
}): AgentCoordinationSessionOwnership {
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

  if (owningTask === input.taskID) return { source: "task_session_tree" }
  if (liveOwnership) {
    return {
      source: "live_tool_ownership",
      toolOwnershipID: liveOwnership.ownershipID,
      toolOwnershipArtifactID: liveOwnership.artifactID,
    }
  }
  if (goalRunSessionMatches) return { source: "goal_run_session" }
  throw new Error(`Agent coordination session ${input.sessionID} is not owned by task ${input.taskID}`)
}

export async function createAgentCoordinationRequest(input: {
  taskID: string
  sessionID: string
  agent: string
  messageID: string
  callID?: string
  summary: string
  details: string
  blocking: boolean
  requestedDecision: string
  evidenceRefs?: string[]
  severity?: AgentCoordinationSeverity
  goalID?: string
  goalRunID?: string
  now?: number
}): Promise<AgentCoordinationRequestRow> {
  requireTask(input.taskID)
  assertRequestedDecisionIsNotRedispatchActionLiteral(input.requestedDecision)
  const severity = input.severity ?? (input.blocking ? "blocked" : "info")

  const now = input.now ?? Date.now()
  const requestID = Identifier.ascending("artifact")

  let replay: AgentCoordinationRequestRow | undefined
  let payload: AgentCoordinationRequestPayload | undefined
  Database.transaction((db) => {
    replay = requestForInvocationInTransaction(db, {
      taskID: input.taskID,
      sessionID: input.sessionID,
      messageID: input.messageID,
      callID: input.callID,
    })
    if (replay) {
      assertReplayMatchesExistingRequest({
        existing: replay,
        callID: input.callID,
        agent: input.agent,
        summary: input.summary,
        details: input.details,
        blocking: input.blocking,
        requestedDecision: input.requestedDecision,
        evidenceRefs: input.evidenceRefs,
        severity,
        goalID: input.goalID,
        goalRunID: input.goalRunID,
      })
      return
    }

    const ownership = resolveAgentCoordinationSessionOwnership(input)
    payload = {
      request_id: requestID,
      task_id: input.taskID,
      session_id: input.sessionID,
      agent: input.agent,
      message_id: input.messageID,
      ...(input.callID ? { tool_call_id: input.callID } : {}),
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
      session_ownership_source: ownership.source,
      ...(ownership.toolOwnershipID ? { tool_ownership_id: ownership.toolOwnershipID } : {}),
      ...(ownership.toolOwnershipArtifactID ? { tool_ownership_artifact_id: ownership.toolOwnershipArtifactID } : {}),
    }

    insertEngineArtifact(db, {
      id: requestID,
      taskID: input.taskID,
      goalRunID: input.goalRunID,
      kind: "agent_coordination_request" as EngineArtifactKind,
      label: "pending",
      payload,
      timeCreated: now,
    })
    EngineProtocol.emitInTransaction(
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
  })

  if (replay) return replay
  if (!payload) throw new Error(`Agent coordination request ${requestID} was not created`)
  return { artifactID: requestID, taskID: input.taskID, payload, timeCreated: now, timeUpdated: now, createdNow: true }
}

export async function createOperatorSteerCoordinationRequest(input: {
  taskID: string
  sessionID: string
  agent: string
  operatorMessage: string
  goalID?: string
  goalRunID?: string
  operatorSteerID?: string
  now?: number
}): Promise<AgentCoordinationRequestRow> {
  requireTask(input.taskID)
  const now = input.now ?? Date.now()
  const requestID = input.operatorSteerID ?? Identifier.ascending("artifact")
  const summary = `Operator steer for ${input.agent} session ${input.sessionID}`
  const details = input.operatorMessage

  let replay: AgentCoordinationRequestRow | undefined
  let payload: AgentCoordinationRequestPayload | undefined
  Database.transaction((db) => {
    replay = operatorSteerRequestInTransaction(db, {
      taskID: input.taskID,
      operatorSteerID: requestID,
    })
    if (replay) {
      assertReplayMatchesExistingOperatorSteerRequest({
        existing: replay,
        agent: input.agent,
        operatorMessage: input.operatorMessage,
        summary,
        details,
        goalID: input.goalID,
        goalRunID: input.goalRunID,
      })
      return
    }
    const pending = pendingSessionControlRequestsInTransaction(db, {
      taskID: input.taskID,
      sessionID: input.sessionID,
      goalRunID: input.goalRunID,
    })
    if (pending.length > 0) {
      throw new AgentCoordinationPendingConflictError({
        taskID: input.taskID,
        sessionID: input.sessionID,
        requestIDs: pending.map((request) => request.payload.request_id),
      })
    }

    const ownership = resolveAgentCoordinationSessionOwnership(input)
    payload = {
      request_id: requestID,
      task_id: input.taskID,
      session_id: input.sessionID,
      agent: input.agent,
      origin: "operator_steer",
      operator_steer_id: requestID,
      operator_message: input.operatorMessage,
      ...(input.goalID ? { goal_id: input.goalID } : {}),
      ...(input.goalRunID ? { goal_run_id: input.goalRunID } : {}),
      owner: processOwner(),
      summary,
      details,
      blocking: true,
      requested_decision: "operator_steer",
      severity: "blocked",
      status: "pending",
      created_at: now,
      session_ownership_source: ownership.source,
      ...(ownership.toolOwnershipID ? { tool_ownership_id: ownership.toolOwnershipID } : {}),
      ...(ownership.toolOwnershipArtifactID ? { tool_ownership_artifact_id: ownership.toolOwnershipArtifactID } : {}),
    }

    insertEngineArtifact(db, {
      id: requestID,
      taskID: input.taskID,
      goalRunID: input.goalRunID,
      kind: "agent_coordination_request" as EngineArtifactKind,
      label: "pending",
      payload,
      timeCreated: now,
    })
    EngineProtocol.emitInTransaction(
      Event.AgentCoordinationRequested,
      {
        taskID: input.taskID,
        requestID,
        sessionID: input.sessionID,
        agent: input.agent,
        blocking: true,
        severity: "blocked",
        summary,
      },
      {
        taskID: input.taskID,
        sessionID: input.sessionID,
        goalRunID: input.goalRunID,
        source: "operator",
        target: "orchestrator",
        correlationID: requestID,
      },
    )
  })

  if (replay) return replay
  if (!payload) throw new Error(`Operator steer request ${requestID} was not created`)
  return { artifactID: requestID, taskID: input.taskID, payload, timeCreated: now, timeUpdated: now, createdNow: true }
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
  return rows.map((row) => requestRowFromArtifact(row))
}

export function listPendingAgentCoordinationRequests(taskID: string): AgentCoordinationRequestRow[] {
  return listAgentCoordinationRequests(taskID).filter((row) => row.payload.status === "pending")
}

/**
 * A2A (Agent-to-Agent) session-control ownership query.
 * Any pending worker request for the same session or goal run must be answered
 * through respond_agent_coordination before a direct control surface may abort
 * that worker.
 */
export function listPendingAgentCoordinationSessionControlRequests(input: {
  taskID: string
  sessionID: string
  goalRunID?: string
}): AgentCoordinationRequestRow[] {
  return listPendingAgentCoordinationRequests(input.taskID).filter(
    (request) =>
      request.payload.session_id === input.sessionID ||
      (input.goalRunID !== undefined && request.payload.goal_run_id === input.goalRunID),
  )
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

export function listAgentCoordinationResponses(taskID: string): AgentCoordinationResponseRow[] {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "agent_coordination_response")))
      .orderBy(desc(EngineArtifactTable.time_updated), desc(EngineArtifactTable.id))
      .all(),
  )
  return rows.map((row) => responseRowFromArtifact(row))
}

export function findAgentCoordinationResponse(input: {
  taskID: string
  responseID: string
}): AgentCoordinationResponseRow | undefined {
  const row = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, input.taskID),
          eq(EngineArtifactTable.id, input.responseID),
          eq(EngineArtifactTable.kind, "agent_coordination_response"),
        ),
      )
      .get(),
  )
  if (!row) return undefined
  return responseRowFromArtifact(row)
}

export function listAgentCoordinationActions(taskID: string): AgentCoordinationActionRow[] {
  const rows = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "agent_coordination_action")))
      .orderBy(desc(EngineArtifactTable.time_updated), desc(EngineArtifactTable.id))
      .all(),
  )
  return rows.map((row) => actionRowFromArtifact(row))
}

export function findAgentCoordinationAction(input: {
  taskID: string
  actionID: string
}): AgentCoordinationActionRow | undefined {
  const row = Database.use((db) =>
    db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, input.taskID),
          eq(EngineArtifactTable.id, input.actionID),
          eq(EngineArtifactTable.kind, "agent_coordination_action"),
        ),
      )
      .get(),
  )
  if (!row) return undefined
  return actionRowFromArtifact(row)
}

export async function createAgentCoordinationResponse(input: {
  taskID: string
  requestID: string
  orchestratorSessionID: string
  orchestratorMessageID: string
  orchestratorToolCallID: string
  orchestratorToolPartID: string
  decision: AgentCoordinationDecision
  reason: string
  message?: string
  redispatchWorkflow?: MiniWorkflow
  now?: number
}): Promise<AgentCoordinationResponseRow> {
  const now = input.now ?? Date.now()
  const responseID = Identifier.ascending("artifact")
  const actionID = Identifier.ascending("artifact")
  let responseArtifactID = responseID
  let responseTimeCreated = now
  let responseTimeUpdated = now
  let createdNow = true
  let request: AgentCoordinationRequestRow | undefined
  let payload: AgentCoordinationResponsePayload | undefined
  let actionPayload: AgentCoordinationActionPayload | undefined
  let redispatchBinding: AgentCoordinationRedispatchBinding | undefined

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
      if (request.payload.status === "responded" && request.payload.response_id) {
        const existingResponseRow = db
          .select()
          .from(EngineArtifactTable)
          .where(
            and(
              eq(EngineArtifactTable.task_id, input.taskID),
              eq(EngineArtifactTable.id, request.payload.response_id),
              eq(EngineArtifactTable.kind, "agent_coordination_response"),
            ),
          )
          .get()
        const existingResponse = existingResponseRow ? responseRowFromArtifact(existingResponseRow) : undefined
        if (!existingResponse) {
          throw new Error(
            `Agent coordination request ${input.requestID} points to missing response ${request.payload.response_id}`,
          )
        }
        const existingActionRow = db
          .select()
          .from(EngineArtifactTable)
          .where(
            and(
              eq(EngineArtifactTable.task_id, input.taskID),
              eq(EngineArtifactTable.id, existingResponse.payload.action_id),
              eq(EngineArtifactTable.kind, "agent_coordination_action"),
            ),
          )
          .get()
        const existingAction = existingActionRow ? actionRowFromArtifact(existingActionRow) : undefined
        if (!existingAction) {
          throw new Error(
            `Agent coordination response ${existingResponse.payload.response_id} points to missing action ${existingResponse.payload.action_id}`,
          )
        }
        assertReplayMatchesExistingResponse({
          existingResponse,
          existingAction,
          requestID: input.requestID,
          taskID: input.taskID,
          orchestratorSessionID: input.orchestratorSessionID,
          orchestratorMessageID: input.orchestratorMessageID,
          orchestratorToolCallID: input.orchestratorToolCallID,
          orchestratorToolPartID: input.orchestratorToolPartID,
          decision: input.decision,
          reason: input.reason,
          ...(input.message ? { message: input.message } : {}),
          ...(input.decision === "redispatch"
            ? {
                redispatchBinding: redispatchBindingFromExistingAction({
                  request,
                  existingAction,
                }),
              }
            : {}),
        })
        responseArtifactID = existingResponse.artifactID
        responseTimeCreated = existingResponse.timeCreated
        responseTimeUpdated = existingResponse.timeUpdated
        payload = existingResponse.payload
        actionPayload = existingAction.payload
        createdNow = false
        return
      }
      throw new Error(`Agent coordination request ${input.requestID} is ${request.payload.status}`)
    }

    redispatchBinding = deriveAgentCoordinationRedispatchBinding({
      decision: input.decision,
      request,
      workflow: input.redispatchWorkflow,
    })

    if (request.payload.last_failed_response_id || request.payload.last_failed_action_id) {
      if (!request.payload.last_failed_response_id || !request.payload.last_failed_action_id) {
        throw new Error(`Agent coordination request ${input.requestID} has incomplete failed action replay pointers`)
      }
      const failedResponseRow = db
        .select()
        .from(EngineArtifactTable)
        .where(
          and(
            eq(EngineArtifactTable.task_id, input.taskID),
            eq(EngineArtifactTable.id, request.payload.last_failed_response_id),
            eq(EngineArtifactTable.kind, "agent_coordination_response"),
          ),
        )
        .get()
      const failedResponse = failedResponseRow ? responseRowFromArtifact(failedResponseRow) : undefined
      if (!failedResponse) {
        throw new Error(
          `Agent coordination request ${input.requestID} points to missing failed response ${request.payload.last_failed_response_id}`,
        )
      }
      const failedActionRow = db
        .select()
        .from(EngineArtifactTable)
        .where(
          and(
            eq(EngineArtifactTable.task_id, input.taskID),
            eq(EngineArtifactTable.id, request.payload.last_failed_action_id),
            eq(EngineArtifactTable.kind, "agent_coordination_action"),
          ),
        )
        .get()
      const failedAction = failedActionRow ? actionRowFromArtifact(failedActionRow) : undefined
      if (!failedAction) {
        throw new Error(
          `Agent coordination request ${input.requestID} points to missing failed action ${request.payload.last_failed_action_id}`,
        )
      }
      if (failedResponse.payload.action_id !== failedAction.payload.action_id) {
        throw new Error(
          `Agent coordination failed response ${failedResponse.payload.response_id} points to action ${failedResponse.payload.action_id}, not ${failedAction.payload.action_id}`,
        )
      }
      if (failedAction.payload.status !== "failed") {
        throw new Error(
          `Agent coordination failed action ${failedAction.payload.action_id} is ${failedAction.payload.status}`,
        )
      }
      const sameToolExecution =
        failedResponse.payload.orchestrator_session_id === input.orchestratorSessionID &&
        failedResponse.payload.orchestrator_message_id === input.orchestratorMessageID &&
        failedResponse.payload.orchestrator_tool_call_id === input.orchestratorToolCallID &&
        failedResponse.payload.orchestrator_tool_part_id === input.orchestratorToolPartID
      if (sameToolExecution) {
        assertReplayMatchesExistingResponse({
          existingResponse: failedResponse,
          existingAction: failedAction,
          requestID: input.requestID,
          taskID: input.taskID,
          orchestratorSessionID: input.orchestratorSessionID,
          orchestratorMessageID: input.orchestratorMessageID,
          orchestratorToolCallID: input.orchestratorToolCallID,
          orchestratorToolPartID: input.orchestratorToolPartID,
          decision: input.decision,
          reason: input.reason,
          ...(input.message ? { message: input.message } : {}),
          ...(redispatchBinding ? { redispatchBinding } : {}),
        })
        responseArtifactID = failedResponse.artifactID
        responseTimeCreated = failedResponse.timeCreated
        responseTimeUpdated = failedResponse.timeUpdated
        payload = failedResponse.payload
        actionPayload = failedAction.payload
        createdNow = false
        return
      }
    }

    payload = {
      response_id: responseID,
      request_id: input.requestID,
      action_id: actionID,
      task_id: input.taskID,
      orchestrator_session_id: input.orchestratorSessionID,
      orchestrator_message_id: input.orchestratorMessageID,
      orchestrator_tool_call_id: input.orchestratorToolCallID,
      orchestrator_tool_part_id: input.orchestratorToolPartID,
      decision: input.decision,
      reason: input.reason,
      ...(input.message ? { message: input.message } : {}),
      created_at: now,
    }
    actionPayload = {
      action_id: actionID,
      request_id: input.requestID,
      response_id: responseID,
      task_id: input.taskID,
      orchestrator_session_id: input.orchestratorSessionID,
      orchestrator_message_id: input.orchestratorMessageID,
      orchestrator_tool_call_id: input.orchestratorToolCallID,
      orchestrator_tool_part_id: input.orchestratorToolPartID,
      action: actionKindForDecision(input.decision),
      decision: input.decision,
      target_session_id: request.payload.session_id,
      target_agent: request.payload.agent,
      ...(request.payload.goal_id ? { goal_id: request.payload.goal_id } : {}),
      ...(request.payload.goal_run_id ? { goal_run_id: request.payload.goal_run_id } : {}),
      reason: input.reason,
      status: "pending",
      ...(redispatchBinding ? { result: { redispatch_binding: redispatchBinding } } : {}),
      created_at: now,
    }
    assertAgentCoordinationActionPayload(actionPayload)

    const updated = updateEngineArtifactWhereReturning(db, {
      label: "responded",
      payload: {
        ...request.payload,
        status: "responded",
        responded_at: now,
        response_id: responseID,
      } satisfies AgentCoordinationRequestPayload,
      timeUpdated: now,
      where: and(
        eq(EngineArtifactTable.task_id, input.taskID),
        eq(EngineArtifactTable.id, input.requestID),
        eq(EngineArtifactTable.kind, "agent_coordination_request"),
        eq(EngineArtifactTable.label, "pending"),
        sql`json_extract(${EngineArtifactTable.payload}, '$.status') = 'pending'`,
      )!,
    })
    if (!updated) throw new Error(`Agent coordination request ${input.requestID} was already claimed`)

    insertEngineArtifact(db, {
      id: responseID,
      taskID: input.taskID,
      goalRunID: request.payload.goal_run_id,
      kind: "agent_coordination_response" as EngineArtifactKind,
      label: input.decision,
      payload,
      timeCreated: now,
    })
    insertEngineArtifact(db, {
      id: actionID,
      taskID: input.taskID,
      goalRunID: request.payload.goal_run_id,
      kind: "agent_coordination_action" as EngineArtifactKind,
      label: "pending",
      payload: actionPayload,
      timeCreated: now,
    })
    EngineProtocol.emitInTransaction(
      Event.AgentCoordinationResponded,
      {
        taskID: input.taskID,
        requestID: input.requestID,
        responseID,
        actionID,
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
    emitAgentCoordinationActionEventInTransaction({
      taskID: input.taskID,
      sessionID: request.payload.session_id,
      goalRunID: request.payload.goal_run_id,
      payload: actionPayload,
      summary: `Action ${actionPayload.action} is pending`,
    })
  })

  if (!request || !payload || !actionPayload) {
    throw new Error(`Agent coordination response transaction failed: ${input.requestID}`)
  }

  return {
    artifactID: responseArtifactID,
    taskID: input.taskID,
    payload,
    timeCreated: responseTimeCreated,
    timeUpdated: responseTimeUpdated,
    createdNow,
  }
}

async function updateAgentCoordinationAction(input: {
  taskID: string
  actionID: string
  status: "completed" | "failed"
  workerMessageID?: string
  result?: Record<string, unknown>
  error?: unknown
  summary?: string
  now?: number
}): Promise<AgentCoordinationActionRow> {
  const now = input.now ?? Date.now()
  let updated: AgentCoordinationArtifactRow | undefined

  Database.transaction((db) => {
    const currentRow = db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, input.taskID),
          eq(EngineArtifactTable.id, input.actionID),
          eq(EngineArtifactTable.kind, "agent_coordination_action"),
        ),
      )
      .get()
    const current = currentRow ? actionRowFromArtifact(currentRow) : undefined
    if (!current) throw new Error(`Agent coordination action not found: ${input.actionID}`)
    if (current.payload.status !== "pending") {
      throw new Error(`Agent coordination action ${input.actionID} is ${current.payload.status}`)
    }

    const payload: AgentCoordinationActionPayload = {
      ...current.payload,
      status: input.status,
      ...(input.workerMessageID ? { worker_message_id: input.workerMessageID } : {}),
      ...(input.result !== undefined
        ? { result: mergeAgentCoordinationActionResult({ current: current.payload, patch: input.result }) }
        : {}),
      ...(input.status === "completed" ? { completed_at: now } : {}),
      ...(input.status === "failed" ? { failed_at: now, error: actionErrorMessage(input.error) } : {}),
    }
    assertAgentCoordinationActionPayload(payload)

    updated = updateEngineArtifactWhereReturning(db, {
      label: input.status,
      payload,
      timeUpdated: now,
      where: and(
        eq(EngineArtifactTable.task_id, input.taskID),
        eq(EngineArtifactTable.id, input.actionID),
        eq(EngineArtifactTable.kind, "agent_coordination_action"),
        eq(EngineArtifactTable.label, "pending"),
        sql`json_extract(${EngineArtifactTable.payload}, '$.status') = 'pending'`,
      )!,
    })
    if (!updated) throw new Error(`Agent coordination action ${input.actionID} was already completed`)

    if (input.status === "failed") {
      const requestRow = db
        .select()
        .from(EngineArtifactTable)
        .where(
          and(
            eq(EngineArtifactTable.task_id, input.taskID),
            eq(EngineArtifactTable.id, current.payload.request_id),
            eq(EngineArtifactTable.kind, "agent_coordination_request"),
          ),
        )
        .get()
      const request = requestRow ? requestRowFromArtifact(requestRow) : undefined
      if (request?.payload.status === "responded" && request.payload.response_id === current.payload.response_id) {
        const { response_id: _responseID, responded_at: _respondedAt, ...requestPayload } = request.payload
        updateEngineArtifactsWhere(db, {
          label: "pending",
          payload: {
            ...requestPayload,
            status: "pending",
            last_failed_response_id: current.payload.response_id,
            last_failed_action_id: current.payload.action_id,
            last_action_error: actionErrorMessage(input.error),
            last_action_failed_at: now,
          } satisfies AgentCoordinationRequestPayload,
          timeUpdated: now,
          where: and(
            eq(EngineArtifactTable.task_id, input.taskID),
            eq(EngineArtifactTable.id, current.payload.request_id),
            eq(EngineArtifactTable.kind, "agent_coordination_request"),
            eq(EngineArtifactTable.label, "responded"),
            sql`json_extract(${EngineArtifactTable.payload}, '$.response_id') = ${current.payload.response_id}`,
          )!,
        })
      }
    }
    emitAgentCoordinationActionEventInTransaction({
      taskID: input.taskID,
      sessionID: payload.target_session_id,
      goalRunID: payload.goal_run_id,
      payload,
      summary: input.summary ?? `Action ${payload.action} ${payload.status}`,
    })
  })

  if (!updated) throw new Error(`Agent coordination action update failed: ${input.actionID}`)
  return actionRowFromArtifact(updated)
}

export async function recordAgentCoordinationActionProgress(input: {
  taskID: string
  actionID: string
  result: Record<string, unknown>
  summary: string
  now?: number
}): Promise<AgentCoordinationActionRow> {
  const now = input.now ?? Date.now()
  let updated: AgentCoordinationArtifactRow | undefined
  Database.transaction((db) => {
    const currentRow = db
      .select()
      .from(EngineArtifactTable)
      .where(
        and(
          eq(EngineArtifactTable.task_id, input.taskID),
          eq(EngineArtifactTable.id, input.actionID),
          eq(EngineArtifactTable.kind, "agent_coordination_action"),
        ),
      )
      .get()
    const current = currentRow ? actionRowFromArtifact(currentRow) : undefined
    if (!current) throw new Error(`Agent coordination action not found: ${input.actionID}`)
    if (current.payload.status !== "pending") {
      throw new Error(`Agent coordination action ${input.actionID} is ${current.payload.status}`)
    }
    const payload: AgentCoordinationActionPayload = {
      ...current.payload,
      result: mergeAgentCoordinationActionResult({ current: current.payload, patch: input.result }),
    }
    assertAgentCoordinationActionPayload(payload)
    updated = updateEngineArtifactWhereReturning(db, {
      payload,
      timeUpdated: now,
      where: and(
        eq(EngineArtifactTable.task_id, input.taskID),
        eq(EngineArtifactTable.id, input.actionID),
        eq(EngineArtifactTable.kind, "agent_coordination_action"),
        eq(EngineArtifactTable.label, "pending"),
        sql`json_extract(${EngineArtifactTable.payload}, '$.status') = 'pending'`,
      )!,
    })
    if (!updated) throw new Error(`Agent coordination action ${input.actionID} was already completed`)
    emitAgentCoordinationActionEventInTransaction({
      taskID: input.taskID,
      sessionID: payload.target_session_id,
      goalRunID: payload.goal_run_id,
      payload,
      summary: input.summary,
    })
  })
  if (!updated) throw new Error(`Agent coordination action progress update failed: ${input.actionID}`)
  return actionRowFromArtifact(updated)
}

export async function completeAgentCoordinationAction(input: {
  taskID: string
  actionID: string
  workerMessageID?: string
  result?: Record<string, unknown>
  summary?: string
  now?: number
}): Promise<AgentCoordinationActionRow> {
  return await updateAgentCoordinationAction({
    ...input,
    status: "completed",
  })
}

export async function failAgentCoordinationAction(input: {
  taskID: string
  actionID: string
  workerMessageID?: string
  error: unknown
  result?: Record<string, unknown>
  summary?: string
  now?: number
}): Promise<AgentCoordinationActionRow> {
  return await updateAgentCoordinationAction({
    ...input,
    status: "failed",
  })
}

async function cancelPendingAgentCoordinationRequests(input: {
  taskID: string
  reason: string
  filter?: (row: AgentCoordinationRequestRow) => boolean
  now?: number
}): Promise<number> {
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
    let updated: { id: string } | undefined
    Database.transaction((db) => {
      updated = updateEngineArtifactWhereReturning(db, {
        label: "cancelled",
        payload,
        timeUpdated: now,
        where: and(
          eq(EngineArtifactTable.task_id, input.taskID),
          eq(EngineArtifactTable.id, request.artifactID),
          eq(EngineArtifactTable.kind, "agent_coordination_request"),
          eq(EngineArtifactTable.label, "pending"),
          sql`json_extract(${EngineArtifactTable.payload}, '$.status') = 'pending'`,
        )!,
      })
      if (!updated) return
      EngineProtocol.emitInTransaction(
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
    })
    if (!updated) continue
    cancelled += 1
  }
  return cancelled
}

export async function cancelPendingAgentCoordinationRequestsForSession(input: {
  taskID: string
  sessionID: string
  reason: string
  now?: number
}): Promise<number> {
  return await cancelPendingAgentCoordinationRequests({
    taskID: input.taskID,
    reason: input.reason,
    now: input.now,
    filter: (row) => row.payload.session_id === input.sessionID,
  })
}

export async function cancelPendingAgentCoordinationRequest(input: {
  taskID: string
  requestID: string
  reason: string
  now?: number
}): Promise<number> {
  return await cancelPendingAgentCoordinationRequests({
    taskID: input.taskID,
    reason: input.reason,
    now: input.now,
    filter: (row) => row.payload.request_id === input.requestID,
  })
}

export async function cancelPendingAgentCoordinationRequestsForTask(input: {
  taskID: string
  reason: string
  now?: number
}): Promise<number> {
  return await cancelPendingAgentCoordinationRequests(input)
}

function normalizeAgentCoordinationRequestPayload(payload: unknown): AgentCoordinationRequestPayload | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined
  const value = payload as Record<string, unknown>
  if (typeof value.request_id !== "string" || value.request_id.length === 0) return undefined
  if (typeof value.task_id !== "string" || value.task_id.length === 0) return undefined
  if (typeof value.session_id !== "string" || value.session_id.length === 0) return undefined
  if (typeof value.agent !== "string" || value.agent.length === 0) return undefined
  if (value.origin !== undefined && value.origin !== "worker_request" && value.origin !== "operator_steer") {
    return undefined
  }
  if (value.origin === "operator_steer") {
    if (typeof value.operator_steer_id !== "string" || value.operator_steer_id.length === 0) return undefined
    if (typeof value.operator_message !== "string" || value.operator_message.length === 0) return undefined
    if (value.message_id !== undefined && (typeof value.message_id !== "string" || value.message_id.length === 0)) {
      return undefined
    }
  } else if (typeof value.message_id !== "string" || value.message_id.length === 0) {
    return undefined
  }
  if (value.tool_call_id !== undefined && (typeof value.tool_call_id !== "string" || value.tool_call_id.length === 0)) {
    return undefined
  }
  if (
    value.operator_steer_id !== undefined &&
    (typeof value.operator_steer_id !== "string" || value.operator_steer_id.length === 0)
  ) {
    return undefined
  }
  if (
    value.operator_message !== undefined &&
    (typeof value.operator_message !== "string" || value.operator_message.length === 0)
  ) {
    return undefined
  }
  if (typeof value.owner !== "string" || value.owner.length === 0) return undefined
  if (typeof value.summary !== "string" || value.summary.length === 0) return undefined
  if (typeof value.details !== "string" || value.details.length === 0) return undefined
  if (typeof value.blocking !== "boolean") return undefined
  if (typeof value.requested_decision !== "string" || value.requested_decision.length === 0) return undefined
  if (
    value.evidence_refs !== undefined &&
    (!Array.isArray(value.evidence_refs) ||
      value.evidence_refs.some((item) => typeof item !== "string" || item.length === 0))
  ) {
    return undefined
  }
  if (value.severity !== "info" && value.severity !== "blocked" && value.severity !== "failure") return undefined
  if (value.status !== "pending" && value.status !== "responded" && value.status !== "cancelled") return undefined
  if (typeof value.created_at !== "number" || !(value.created_at > 0)) return undefined
  if (
    value.session_ownership_source !== undefined &&
    value.session_ownership_source !== "task_session_tree" &&
    value.session_ownership_source !== "live_tool_ownership" &&
    value.session_ownership_source !== "goal_run_session"
  ) {
    return undefined
  }
  if (
    value.tool_ownership_id !== undefined &&
    (typeof value.tool_ownership_id !== "string" || value.tool_ownership_id.length === 0)
  ) {
    return undefined
  }
  if (
    value.tool_ownership_artifact_id !== undefined &&
    (typeof value.tool_ownership_artifact_id !== "string" || value.tool_ownership_artifact_id.length === 0)
  ) {
    return undefined
  }
  return value as unknown as AgentCoordinationRequestPayload
}

function normalizeAgentCoordinationResponsePayload(payload: unknown): AgentCoordinationResponsePayload | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined
  const value = payload as Record<string, unknown>
  if (typeof value.response_id !== "string" || value.response_id.length === 0) return undefined
  if (typeof value.request_id !== "string" || value.request_id.length === 0) return undefined
  if (typeof value.action_id !== "string" || value.action_id.length === 0) return undefined
  if (typeof value.task_id !== "string" || value.task_id.length === 0) return undefined
  if (typeof value.orchestrator_session_id !== "string" || value.orchestrator_session_id.length === 0) {
    return undefined
  }
  if (typeof value.orchestrator_message_id !== "string" || value.orchestrator_message_id.length === 0) {
    return undefined
  }
  if (typeof value.orchestrator_tool_call_id !== "string" || value.orchestrator_tool_call_id.length === 0) {
    return undefined
  }
  if (typeof value.orchestrator_tool_part_id !== "string" || value.orchestrator_tool_part_id.length === 0) {
    return undefined
  }
  if (
    value.decision !== "continue" &&
    value.decision !== "cancel_worker" &&
    value.decision !== "redispatch" &&
    value.decision !== "fail_task" &&
    value.decision !== "ask_user"
  ) {
    return undefined
  }
  if (typeof value.reason !== "string" || value.reason.length === 0) return undefined
  if (value.message !== undefined && (typeof value.message !== "string" || value.message.length === 0)) {
    return undefined
  }
  if (typeof value.created_at !== "number" || !(value.created_at > 0)) return undefined
  return value as unknown as AgentCoordinationResponsePayload
}

function normalizeAgentCoordinationActionPayload(payload: unknown): AgentCoordinationActionPayload | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined
  const value = payload as Record<string, unknown>
  if (typeof value.action_id !== "string" || value.action_id.length === 0) return undefined
  if (typeof value.request_id !== "string" || value.request_id.length === 0) return undefined
  if (typeof value.response_id !== "string" || value.response_id.length === 0) return undefined
  if (typeof value.task_id !== "string" || value.task_id.length === 0) return undefined
  if (typeof value.orchestrator_session_id !== "string" || value.orchestrator_session_id.length === 0) {
    return undefined
  }
  if (typeof value.orchestrator_message_id !== "string" || value.orchestrator_message_id.length === 0) {
    return undefined
  }
  if (typeof value.orchestrator_tool_call_id !== "string" || value.orchestrator_tool_call_id.length === 0) {
    return undefined
  }
  if (typeof value.orchestrator_tool_part_id !== "string" || value.orchestrator_tool_part_id.length === 0) {
    return undefined
  }
  if (
    value.decision !== "continue" &&
    value.decision !== "cancel_worker" &&
    value.decision !== "redispatch" &&
    value.decision !== "fail_task" &&
    value.decision !== "ask_user"
  ) {
    return undefined
  }
  if (
    value.action !== "continue_worker" &&
    value.action !== "cancel_worker" &&
    value.action !== "redispatch_worker" &&
    value.action !== "fail_task" &&
    value.action !== "ask_user"
  ) {
    return undefined
  }
  if (value.action !== actionKindForDecision(value.decision)) return undefined
  if (typeof value.target_session_id !== "string" || value.target_session_id.length === 0) return undefined
  if (typeof value.target_agent !== "string" || value.target_agent.length === 0) return undefined
  if (value.goal_id !== undefined && (typeof value.goal_id !== "string" || value.goal_id.length === 0)) {
    return undefined
  }
  if (value.goal_run_id !== undefined && (typeof value.goal_run_id !== "string" || value.goal_run_id.length === 0)) {
    return undefined
  }
  if (typeof value.reason !== "string" || value.reason.length === 0) return undefined
  if (value.status !== "pending" && value.status !== "completed" && value.status !== "failed") return undefined
  if (typeof value.created_at !== "number" || !(value.created_at > 0)) return undefined
  if (
    value.worker_message_id !== undefined &&
    (typeof value.worker_message_id !== "string" || value.worker_message_id.length === 0)
  ) {
    return undefined
  }
  if (
    value.result !== undefined &&
    (!value.result || typeof value.result !== "object" || Array.isArray(value.result))
  ) {
    return undefined
  }
  const result = value.result as Record<string, unknown> | undefined
  if (result && hasLegacyRedispatchResultFields(result)) return undefined
  if (value.action === "redispatch_worker") {
    if (!result || !normalizeRedispatchBinding(result.redispatch_binding, value.target_agent)) return undefined
  } else if (result?.redispatch_binding !== undefined) {
    return undefined
  }
  if (value.status === "pending") {
    if (value.completed_at !== undefined || value.failed_at !== undefined || value.error !== undefined) return undefined
  }
  if (value.status === "completed") {
    if (typeof value.completed_at !== "number" || !(value.completed_at > 0)) return undefined
    if (value.failed_at !== undefined || value.error !== undefined) return undefined
  }
  if (value.status === "failed") {
    if (typeof value.failed_at !== "number" || !(value.failed_at > 0)) return undefined
    if (typeof value.error !== "string" || value.error.length === 0) return undefined
    if (value.completed_at !== undefined) return undefined
  }
  return value as unknown as AgentCoordinationActionPayload
}
