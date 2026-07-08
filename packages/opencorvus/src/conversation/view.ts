import { compareTimelineOrderKeys, timelineMessageOrderKey, timelineOrderKey } from "@/timeline/order"
import { isConversationDisplayMessagePartType } from "@opencorvus-ai/transport-protocol"

export interface ConversationPhaseLocation {
  stepID: string
  phaseID: string
}

export interface ConversationSessionView {
  sessionID: string
  orderKey: string
  stage: string
  parentSessionID?: string
  goalID?: string
  messageIDs: string[]
  lastDisplayMessageID?: string
  firstMessageTime: number
  lastMessageTime: number
  firstObservedAt?: number
  lastObservedAt?: number
  status?: "pending" | "running" | "idle" | "completed" | "error" | "skipped"
  displaySummary?: {
    text: string
    source: "session_status"
  }
  placement: "top_level" | "goal_phase" | "hidden" | "filtered"
  phase?: ConversationPhaseLocation
}

export interface ConversationMessageView {
  messageID: string
  orderKey: string
  sessionID: string
  stage: string
  parentSessionID?: string
  goalID?: string
  time: number
  placement: ConversationSessionView["placement"]
  phase?: ConversationPhaseLocation
}

export interface ConversationView {
  topLevelSessionIDs: string[]
  sessions: ConversationSessionView[]
  messages: ConversationMessageView[]
}

export interface ConversationAgentSessionLedgerEntry {
  sessionID: string
  orderKey: string
  stage: string
  parentSessionID?: string
  goalID?: string
  timeCreated: number
  timeUpdated: number
  latestStatus?: {
    type: string
    reason?: string
    error?: string
    summary?: string
  }
  latestStatusEmittedAt?: number
}

interface ConversationLifecycleEvent {
  type?: string
  emittedAt?: number
  timestamp?: number
  payload?: Record<string, unknown>
  properties?: Record<string, unknown>
}

export function conversationTranscriptMessageOrder(left: any, right: any): number {
  return compareTimelineOrderKeys(timelineMessageOrderKey(left), timelineMessageOrderKey(right))
}

function stageFromChannel(channel: unknown): string {
  const value = String(channel || "").trim()
  if (!value) {
    throw new Error("projectConversationView: transcript message missing info.channel")
  }
  if (value === "main") return "user"
  return value
}

function workflowPhaseDefinition(
  board: any,
  stepID: string,
  stage: string,
): { stepID: string; phaseID: string } | undefined {
  const steps = Array.isArray(board?.workflow?.steps) ? board.workflow.steps : []
  const step = steps.find((candidate: any) => String(candidate?.id || "") === stepID)
  const phases = Array.isArray(step?.phases) ? step.phases : []
  for (const phase of phases) {
    if (String(phase?.sessionKind || "") !== stage) continue
    const phaseID = String(phase?.id || "")
    if (!phaseID) continue
    return { stepID, phaseID }
  }
  return undefined
}

function concreteGoalPhaseLocation(
  board: any,
  stage: string,
  goalID: string,
  sessionID: string,
): ConversationPhaseLocation | undefined {
  if (!goalID || !sessionID) return undefined
  const goalWorkflows = Array.isArray(board?.goalWorkflows) ? board.goalWorkflows : []
  const goalWorkflow = goalWorkflows.find((goal: any) => String(goal?.goalID || "") === goalID)
  const steps = Array.isArray(goalWorkflow?.steps) ? goalWorkflow.steps : []
  for (const step of steps) {
    const stepID = String(step?.stepID || "")
    if (!stepID) continue
    const phase = workflowPhaseDefinition(board, stepID, stage)
    if (!phase) continue
    const phaseEntries =
      step?.phases && typeof step.phases === "object" && !Array.isArray(step.phases)
        ? (step.phases as Record<string, unknown>)
        : undefined
    const phaseEntry = phaseEntries?.[phase.phaseID] as { startedAt?: unknown } | undefined
    if (!phaseEntry || !(Number(phaseEntry.startedAt || 0) > 0)) continue
    const buildSessionID =
      typeof step?.payload?.buildSessionID === "string" && step.payload.buildSessionID.length > 0
        ? step.payload.buildSessionID
        : ""
    if (phase.phaseID !== "build" || buildSessionID !== sessionID) continue
    return phase
  }
  return undefined
}

function placementOf(
  stage: string,
  phase: ConversationPhaseLocation | undefined,
): ConversationSessionView["placement"] {
  if (stage === "filtered") return "filtered"
  if (phase) return "goal_phase"
  if (stage === "executor") return "hidden"
  return "top_level"
}

function stageFromLedgerStage(stage: unknown): string {
  const value = String(stage || "").trim()
  if (!value) throw new Error("projectConversationAgentView: ledger session missing stage")
  if (value === "root") return "user"
  return value
}

function shouldIncludeAgentStage(stage: string): boolean {
  return stage !== "user" && stage !== "filtered" && stage !== "system"
}

function statusFromLifecycleStatus(status: unknown): NonNullable<ConversationSessionView["status"]> {
  const value =
    status && typeof status === "object" && !Array.isArray(status) ? (status as Record<string, unknown>) : {}
  const type = String(value.type || "")
  if (type === "streaming" || type === "retry") return "running"
  if (type === "idle") return "idle"
  if (type === "terminal") {
    const reason = String(value.reason || "")
    if (reason === "error" || reason === "artifact_missing") return "error"
    if (reason === "completed") return "completed"
    if (reason === "aborted") return "skipped"
  }
  throw new Error(`projectConversationAgentView: unknown lifecycle status ${JSON.stringify(status)}`)
}

function displaySummaryFromLifecycleStatus(status: unknown): ConversationSessionView["displaySummary"] | undefined {
  const value =
    status && typeof status === "object" && !Array.isArray(status) ? (status as Record<string, unknown>) : {}
  const summary = typeof value.summary === "string" ? value.summary.trim() : ""
  return summary ? { text: summary, source: "session_status" } : undefined
}

function lifecyclePayload(event: ConversationLifecycleEvent): Record<string, unknown> {
  if (event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)) return event.payload
  throw new Error(`projectConversationAgentView: lifecycle event ${event.type || "<missing>"} missing payload`)
}

function lifecycleObservedAt(event: ConversationLifecycleEvent): number {
  if (typeof event.emittedAt === "number" && event.emittedAt > 0) return event.emittedAt
  throw new Error(`projectConversationAgentView: lifecycle event ${event.type || "<missing>"} missing emittedAt`)
}

function applyLifecycleSession(
  board: any,
  bySession: Map<string, ConversationSessionView>,
  event: ConversationLifecycleEvent,
): void {
  if (event.type !== "session.status") return
  const payload = lifecyclePayload(event)
  const sessionID = String(payload.sessionID || "")
  if (!sessionID) throw new Error("projectConversationAgentView: session.status missing sessionID")
  const existing = bySession.get(sessionID)
  if (!existing) return
  const stage = String(existing.stage || stageFromChannel(payload.channel))
  if (!shouldIncludeAgentStage(stage)) return
  const observedAt = lifecycleObservedAt(event)
  const parentSessionID = String(payload.parentSessionID || existing.parentSessionID || "")
  const goalID = String(payload.goalID || existing.goalID || "")
  const phase = concreteGoalPhaseLocation(board, stage, goalID, sessionID)
  const placement = placementOf(stage, phase)
  const displayGoalID = placement === "goal_phase" ? goalID : ""
  const status = statusFromLifecycleStatus(payload.status)
  const displaySummary = displaySummaryFromLifecycleStatus(payload.status)
  existing.firstObservedAt = Math.min(existing.firstObservedAt ?? existing.firstMessageTime, observedAt)
  existing.lastObservedAt = Math.max(existing.lastObservedAt ?? existing.lastMessageTime, observedAt)
  existing.status = status
  if (displaySummary) existing.displaySummary = displaySummary
  if (!existing.parentSessionID && parentSessionID) existing.parentSessionID = parentSessionID
  if (!existing.goalID && displayGoalID) existing.goalID = displayGoalID
  if (!existing.phase && phase) existing.phase = phase
}

function applyLedgerSession(
  board: any,
  bySession: Map<string, ConversationSessionView>,
  ledger: ConversationAgentSessionLedgerEntry,
): void {
  const sessionID = String(ledger?.sessionID || "")
  if (!sessionID) throw new Error("projectConversationAgentView: ledger session missing sessionID")
  const stage = stageFromLedgerStage(ledger.stage)
  if (!shouldIncludeAgentStage(stage)) return
  const observedAt = Number(ledger.timeCreated || 0)
  if (!(observedAt > 0))
    throw new Error(`projectConversationAgentView: ledger session ${sessionID} missing timeCreated`)
  if (typeof ledger.orderKey !== "string" || !ledger.orderKey) {
    throw new Error(`projectConversationAgentView: ledger session ${sessionID} missing orderKey`)
  }
  const lastObservedAt = Math.max(observedAt, Number(ledger.timeUpdated || 0))
  const parentSessionID = String(ledger.parentSessionID || "")
  const goalID = String(ledger.goalID || "")
  const phase = concreteGoalPhaseLocation(board, stage, goalID, sessionID)
  const placement = placementOf(stage, phase)
  const displayGoalID = placement === "goal_phase" ? goalID : ""
  const existing = bySession.get(sessionID)
  if (!existing) {
    const created: ConversationSessionView = {
      sessionID,
      orderKey: ledger.orderKey,
      stage,
      parentSessionID: parentSessionID || undefined,
      goalID: displayGoalID || undefined,
      messageIDs: [],
      firstMessageTime: observedAt,
      lastMessageTime: lastObservedAt,
      firstObservedAt: observedAt,
      lastObservedAt,
      status: "pending",
      placement,
      phase,
    }
    applyLedgerLatestStatus(created, ledger)
    bySession.set(sessionID, created)
    return
  }
  existing.firstObservedAt = Math.min(existing.firstObservedAt ?? existing.firstMessageTime, observedAt)
  existing.lastObservedAt = Math.max(existing.lastObservedAt ?? existing.lastMessageTime, lastObservedAt)
  existing.status = existing.status || "pending"
  if (!existing.parentSessionID && parentSessionID) existing.parentSessionID = parentSessionID
  if (!existing.goalID && displayGoalID) existing.goalID = displayGoalID
  if (!existing.phase && phase) existing.phase = phase
  applyLedgerLatestStatus(existing, ledger)
}

function applyLedgerLatestStatus(session: ConversationSessionView, ledger: ConversationAgentSessionLedgerEntry): void {
  if (!ledger.latestStatus) {
    if (ledger.latestStatusEmittedAt != null) {
      throw new Error(`projectConversationAgentView: ledger session ${ledger.sessionID} status missing payload`)
    }
    return
  }
  const observedAt = Number(ledger.latestStatusEmittedAt || 0)
  if (!(observedAt > 0)) {
    throw new Error(`projectConversationAgentView: ledger session ${ledger.sessionID} status missing emitted time`)
  }
  session.status = statusFromLifecycleStatus(ledger.latestStatus)
  const displaySummary = displaySummaryFromLifecycleStatus(ledger.latestStatus)
  if (displaySummary) session.displaySummary = displaySummary
  session.firstObservedAt = Math.min(session.firstObservedAt ?? session.firstMessageTime, observedAt)
  session.lastObservedAt = Math.max(session.lastObservedAt ?? session.lastMessageTime, observedAt)
}

export function conversationPartHasDisplay(part: any): boolean {
  const type = String(part?.type || "")
  if (!type || !isConversationDisplayMessagePartType(type)) return false
  if (type === "reasoning") return !!String(part?.text || "").replace(/[\[\]\s]/g, "")
  if (type === "text") {
    return !!String(part?.text || "").trim()
  }
  return true
}

export function conversationMessageHasDisplay(message: any): boolean {
  return Array.isArray(message?.parts) && message.parts.some(conversationPartHasDisplay)
}

export function projectConversationView(
  board: any,
  transcript: any[],
  lifecycleEvents: ConversationLifecycleEvent[] = [],
): ConversationView {
  const sorted = [...(Array.isArray(transcript) ? transcript : [])].sort(conversationTranscriptMessageOrder)

  const bySession = new Map<string, ConversationSessionView>()
  const messages: ConversationMessageView[] = []
  for (const message of sorted) {
    const info = message?.info
    const messageID = String(info?.id || "")
    const sessionID = String(info?.sessionID || "")
    const created = Number(info?.time?.created)
    if (!messageID || !sessionID) {
      throw new Error("projectConversationView: transcript message missing id/sessionID")
    }
    if (!(created > 0)) {
      throw new Error(`projectConversationView: message ${messageID} missing info.time.created`)
    }
    const stage = stageFromChannel(info?.channel)
    const parentSessionID = String(info?.parentSessionID || "")
    const goalID = String(info?.goalID || "")
    const displayMessageID = conversationMessageHasDisplay(message) ? messageID : ""
    const phase = concreteGoalPhaseLocation(board, stage, goalID, sessionID)
    const placement = placementOf(stage, phase)
    const displayGoalID = placement === "goal_phase" ? goalID : ""
    if (displayMessageID) {
      const orderKey = timelineMessageOrderKey(message)
      messages.push({
        messageID,
        orderKey,
        sessionID,
        stage,
        parentSessionID: parentSessionID || undefined,
        goalID: displayGoalID || undefined,
        time: created,
        placement,
        phase,
      })
    }
    const existing = bySession.get(sessionID)
    if (existing) {
      existing.messageIDs.push(messageID)
      if (displayMessageID) existing.lastDisplayMessageID = displayMessageID
      existing.lastMessageTime = created
      if (!existing.parentSessionID && parentSessionID) existing.parentSessionID = parentSessionID
      if (!existing.goalID && displayGoalID) existing.goalID = displayGoalID
      if (!existing.phase && phase) existing.phase = phase
      continue
    }
    bySession.set(sessionID, {
      sessionID,
      orderKey: timelineOrderKey({
        domain: "session",
        time: created,
        id: sessionID,
      }),
      stage,
      parentSessionID: parentSessionID || undefined,
      goalID: displayGoalID || undefined,
      messageIDs: [messageID],
      lastDisplayMessageID: displayMessageID || undefined,
      firstMessageTime: created,
      lastMessageTime: created,
      firstObservedAt: created,
      lastObservedAt: created,
      placement,
      phase,
    })
  }
  void lifecycleEvents
  const sessions = [...bySession.values()].sort((left, right) => {
    return compareTimelineOrderKeys(left.orderKey, right.orderKey)
  })
  const topLevelSessionIDs = sessions
    .filter((session) => session.placement === "top_level" && session.messageIDs.length > 0)
    .map((session) => session.sessionID)

  return {
    topLevelSessionIDs,
    sessions,
    messages,
  }
}

export function projectConversationAgentView(
  board: any,
  transcript: any[],
  lifecycleEvents: ConversationLifecycleEvent[] = [],
  ledgerSessions: ConversationAgentSessionLedgerEntry[] = [],
): ConversationView {
  const view = projectConversationView(board, transcript)
  const bySession = new Map<string, ConversationSessionView>()
  for (const session of ledgerSessions) applyLedgerSession(board, bySession, session)
  for (const session of view.sessions) {
    const existing = bySession.get(session.sessionID)
    if (!existing) continue
    existing.messageIDs = session.messageIDs
    existing.lastDisplayMessageID = session.lastDisplayMessageID
    existing.firstMessageTime = Math.min(existing.firstMessageTime, session.firstMessageTime)
    existing.lastMessageTime = Math.max(existing.lastMessageTime, session.lastMessageTime)
    existing.firstObservedAt = Math.min(existing.firstObservedAt ?? existing.firstMessageTime, session.firstMessageTime)
    existing.lastObservedAt = Math.max(existing.lastObservedAt ?? existing.lastMessageTime, session.lastMessageTime)
    if (!existing.parentSessionID && session.parentSessionID) existing.parentSessionID = session.parentSessionID
    if (!existing.goalID && session.goalID) existing.goalID = session.goalID
  }
  const sessionStatusEvents = [...lifecycleEvents].filter((event) => event.type === "session.status")
  for (const event of sessionStatusEvents.sort(
    (left, right) => lifecycleObservedAt(left) - lifecycleObservedAt(right),
  )) {
    applyLifecycleSession(board, bySession, event)
  }
  const sessions = [...bySession.values()].sort((left, right) => {
    return compareTimelineOrderKeys(left.orderKey, right.orderKey)
  })
  const sessionIDs = new Set(sessions.map((session) => session.sessionID))
  return {
    topLevelSessionIDs: sessions
      .filter((session) => session.placement === "top_level" && session.messageIDs.length > 0)
      .map((session) => session.sessionID),
    sessions,
    messages: view.messages.filter((message) => sessionIDs.has(message.sessionID)),
  }
}
