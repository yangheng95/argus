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
  placement: "top_level" | "goal_phase" | "hidden" | "filtered"
  phase?: ConversationPhaseLocation
}

export interface ConversationView {
  topLevelSessionIDs: string[]
  sessions: ConversationSessionView[]
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

export function projectConversationView(board: any, transcript: any[]): ConversationView {
  const sorted = [...(Array.isArray(transcript) ? transcript : [])].sort(
    (left, right) =>
      Number(left?.info?.time?.created || 0) - Number(right?.info?.time?.created || 0),
  )

  const bySession = new Map<string, ConversationSessionView>()
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
    const existing = bySession.get(sessionID)
    if (existing) {
      existing.messageIDs.push(messageID)
      if (displayMessageID) existing.lastDisplayMessageID = displayMessageID
      existing.lastMessageTime = created
      if (!existing.parentSessionID && parentSessionID) existing.parentSessionID = parentSessionID
      if (!existing.goalID && goalID) existing.goalID = goalID
      continue
    }
    const phase = phaseLocation(board, stage)
    bySession.set(sessionID, {
      sessionID,
      stage,
      parentSessionID: parentSessionID || undefined,
      goalID: goalID || undefined,
      messageIDs: [messageID],
      lastDisplayMessageID: displayMessageID || undefined,
      firstMessageTime: created,
      lastMessageTime: created,
      placement: placementOf(board, stage, goalID),
      phase,
    })
  }

  const sessions = [...bySession.values()].sort(
    (left, right) => left.firstMessageTime - right.firstMessageTime,
  )
  const topLevelSessionIDs = sessions
    .filter((session) => session.placement === "top_level")
    .map((session) => session.sessionID)

  return {
    topLevelSessionIDs,
    sessions,
  }
}
