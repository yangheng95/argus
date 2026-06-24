export interface ConversationPhaseLocation {
  stepID: string
  phaseID: string
}

export interface ConversationSessionView {
  sessionID: string
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
  placement: "top_level" | "goal_phase" | "hidden" | "filtered"
  phase?: ConversationPhaseLocation
}

export interface ConversationMessageView {
  messageID: string
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
  stage: string
  parentSessionID?: string
  goalID?: string
  timeCreated: number
  timeUpdated: number
}

interface ConversationLifecycleEvent {
  type?: string
  emittedAt?: number
  timestamp?: number
  payload?: Record<string, unknown>
  properties?: Record<string, unknown>
}

function stageFromChannel(channel: unknown): string {
  const value = String(channel || "").trim()
  if (!value) {
    throw new Error("projectConversationView: transcript message missing info.channel")
  }
  if (value === "main") return "user"
  return value
}

function phaseLocation(board: any, stage: string): ConversationPhaseLocation | undefined {
  const steps = Array.isArray(board?.workflow?.steps) ? board.workflow.steps : []
  for (const step of steps) {
    const stepID = String(step?.id || "")
    if (!stepID) continue
    const phases = Array.isArray(step?.phases) ? step.phases : []
    for (const phase of phases) {
      if (String(phase?.sessionKind || "") !== stage) continue
      const phaseID = String(phase?.id || "")
      if (!phaseID) continue
      return { stepID, phaseID }
    }
  }
  return undefined
}

function placementOf(board: any, stage: string, goalID: string): ConversationSessionView["placement"] {
  if (stage === "filtered") return "filtered"
  if (goalID && phaseLocation(board, stage)) return "goal_phase"
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
  const value = status && typeof status === "object" && !Array.isArray(status) ? (status as Record<string, unknown>) : {}
  const type = String(value.type || "")
  if (type === "streaming" || type === "retry") return "running"
  if (type === "idle") return "idle"
  if (type === "terminal") {
    const reason = String(value.reason || "")
    if (reason === "error" || reason === "artifact_missing") return "error"
    if (reason === "completed" || reason === "aborted") return "completed"
  }
  throw new Error(`projectConversationAgentView: unknown lifecycle status ${JSON.stringify(status)}`)
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
  const placement = placementOf(board, stage, goalID)
  const phase = phaseLocation(board, stage)
  const status = statusFromLifecycleStatus(payload.status)
  existing.firstObservedAt = Math.min(existing.firstObservedAt ?? existing.firstMessageTime, observedAt)
  existing.lastObservedAt = Math.max(existing.lastObservedAt ?? existing.lastMessageTime, observedAt)
  existing.status = status
  if (!existing.parentSessionID && parentSessionID) existing.parentSessionID = parentSessionID
  if (!existing.goalID && goalID) existing.goalID = goalID
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
  if (!(observedAt > 0)) throw new Error(`projectConversationAgentView: ledger session ${sessionID} missing timeCreated`)
  const lastObservedAt = Math.max(observedAt, Number(ledger.timeUpdated || 0))
  const parentSessionID = String(ledger.parentSessionID || "")
  const goalID = String(ledger.goalID || "")
  const phase = phaseLocation(board, stage)
  const placement = placementOf(board, stage, goalID)
  const existing = bySession.get(sessionID)
  if (!existing) {
    bySession.set(sessionID, {
      sessionID,
      stage,
      parentSessionID: parentSessionID || undefined,
      goalID: goalID || undefined,
      messageIDs: [],
      firstMessageTime: observedAt,
      lastMessageTime: lastObservedAt,
      firstObservedAt: observedAt,
      lastObservedAt,
      status: "pending",
      placement,
      phase,
    })
    return
  }
  existing.firstObservedAt = Math.min(existing.firstObservedAt ?? existing.firstMessageTime, observedAt)
  existing.lastObservedAt = Math.max(existing.lastObservedAt ?? existing.lastMessageTime, lastObservedAt)
  existing.status = existing.status || "pending"
  if (!existing.parentSessionID && parentSessionID) existing.parentSessionID = parentSessionID
  if (!existing.goalID && goalID) existing.goalID = goalID
}

export function conversationPartHasDisplay(part: any): boolean {
  const type = String(part?.type || "")
  if (!type || type === "step-start" || type === "step-finish" || type === "boundary") return false
  if (type === "text" || type === "reasoning") {
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
  const sorted = [...(Array.isArray(transcript) ? transcript : [])].sort(
    (left, right) => Number(left?.info?.time?.created || 0) - Number(right?.info?.time?.created || 0),
  )

  const bySession = new Map<string, ConversationSessionView>()
  const messages: ConversationMessageView[] = []
  for (const message of sorted) {
    const info = message?.info
    const messageID = String(info?.id || "")
    const sessionID = String(info?.sessionID || "")
    const created = Number(info?.time?.created || 0)
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
    const phase = phaseLocation(board, stage)
    const placement = placementOf(board, stage, goalID)
    if (displayMessageID) {
      messages.push({
        messageID,
        sessionID,
        stage,
        parentSessionID: parentSessionID || undefined,
        goalID: goalID || undefined,
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
      if (!existing.goalID && goalID) existing.goalID = goalID
      continue
    }
    bySession.set(sessionID, {
      sessionID,
      stage,
      parentSessionID: parentSessionID || undefined,
      goalID: goalID || undefined,
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
  const sessions = [...bySession.values()].sort((left, right) => left.firstMessageTime - right.firstMessageTime)
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
  for (const event of sessionStatusEvents.sort((left, right) => lifecycleObservedAt(left) - lifecycleObservedAt(right))) {
    applyLifecycleSession(board, bySession, event)
  }
  const sessions = [...bySession.values()].sort((left, right) => left.firstMessageTime - right.firstMessageTime)
  const sessionIDs = new Set(sessions.map((session) => session.sessionID))
  return {
    topLevelSessionIDs: sessions
      .filter((session) => session.placement === "top_level" && session.messageIDs.length > 0)
      .map((session) => session.sessionID),
    sessions,
    messages: view.messages.filter((message) => sessionIDs.has(message.sessionID)),
  }
}
