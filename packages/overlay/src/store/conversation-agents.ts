import { createStore } from "solid-js/store"
import type { AgentWorkflowRecord } from "../utils/agent-workflow"
import { normalizeAgentRole } from "../utils/message"
import { goalStagePhaseID } from "../utils/workflow-step"
import type { BoardSource } from "./board"

export interface ConversationAgentSessionView {
  sessionID: string
  stage: string
  parentSessionID?: string
  goalID?: string
  messageIDs?: string[]
  lastDisplayMessageID?: string
  firstMessageTime: number
  lastMessageTime: number
  placement?: "top_level" | "goal_phase" | "hidden" | "filtered" | string
  phase?: {
    stepID: string
    phaseID: string
  }
}

export interface ConversationAgentMessageView {
  messageID: string
  sessionID: string
  stage: string
  parentSessionID?: string
  goalID?: string
  time: number
  placement?: "top_level" | "goal_phase" | "hidden" | "filtered" | string
  phase?: {
    stepID: string
    phaseID: string
  }
}

export interface ConversationAgentView {
  sessions?: ConversationAgentSessionView[]
  messages?: ConversationAgentMessageView[]
}

export interface ConversationAgentStore {
  taskID: string
  records: AgentWorkflowRecord[]
}

export const [conversationAgentStore, setConversationAgentStore] = createStore<ConversationAgentStore>({
  taskID: "",
  records: [],
})

export function conversationAgentSourceKey(source: BoardSource | null): string {
  return source ? `${source.kind}:${source.id}` : ""
}

export function conversationAgentRecordsForSource(source: BoardSource | null): AgentWorkflowRecord[] {
  const key = conversationAgentSourceKey(source)
  return key && conversationAgentStore.taskID === key ? conversationAgentStore.records : []
}

function renderedTargetForMessage(
  message: ConversationAgentMessageView,
  stage: string,
): Pick<AgentWorkflowRecord, "cardID" | "renderedCardID"> | null {
  const goalID = String(message?.goalID || "")
  const stepID = String(message?.phase?.stepID || "")
  const phaseID = String(message?.phase?.phaseID || "")
  if (goalID && stepID && phaseID) {
    const renderedCardID = `step:${goalID}:${stepID}`
    return {
      cardID: `${renderedCardID}:phase:${phaseID}`,
      renderedCardID,
    }
  }
  const messageID = String(message?.messageID || "")
  if (stage === "integrity" && messageID) return { renderedCardID: `${stage}:session:${message.sessionID}` }
  if (messageID) return { renderedCardID: `${stage}:session:${message.sessionID}:message:${messageID}` }
  return null
}

function renderedTargetForPhaseSession(
  session: ConversationAgentSessionView,
): Pick<AgentWorkflowRecord, "cardID" | "renderedCardID"> | null {
  const goalID = String(session?.goalID || "")
  const stepID = String(session?.phase?.stepID || "")
  const phaseID = String(session?.phase?.phaseID || "")
  if (!goalID || !stepID || !phaseID) return null
  const renderedCardID = `step:${goalID}:${stepID}`
  return {
    cardID: `${renderedCardID}:phase:${phaseID}`,
    renderedCardID,
  }
}

function agentRecordFromPhaseSession(session: ConversationAgentSessionView): AgentWorkflowRecord | null {
  const sessionID = String(session?.sessionID || "")
  const rawStage = String(session?.stage || "")
  const stage = normalizeAgentRole(rawStage)
  const startedAt = Number(session?.firstMessageTime || 0)
  if (
    !sessionID ||
    !stage ||
    stage === "user" ||
    session?.placement !== "goal_phase" ||
    rawStage === "filtered" ||
    !(startedAt > 0)
  ) {
    return null
  }
  const target = renderedTargetForPhaseSession(session)
  if (!target) return null
  const lastObservedAt = Math.max(startedAt, Number(session?.lastMessageTime || 0))
  return {
    id: sessionID,
    sessionID,
    parentSessionID: String(session?.parentSessionID || ""),
    agentName: stage,
    stage,
    status: "completed",
    startedAt,
    lastObservedAt,
    completedAt: lastObservedAt,
    attempts: 1,
    depth: 0,
    targetMessageID: String(session?.lastDisplayMessageID || ""),
    goalID: session?.goalID,
    stepID: session?.phase?.stepID,
    phaseID: session?.phase?.phaseID,
    ...target,
  }
}

function agentRecordFromMessages(messages: ConversationAgentMessageView[]): AgentWorkflowRecord[] {
  const bySession = new Map<string, AgentWorkflowRecord>()
  for (const message of messages) {
    const sessionID = String(message?.sessionID || "")
    const rawStage = String(message?.stage || "")
    const stage = normalizeAgentRole(rawStage)
    const observedAt = Number(message?.time || 0)
    if (
      !sessionID ||
      !stage ||
      stage === "user" ||
      message?.placement === "hidden" ||
      message?.placement === "filtered" ||
      rawStage === "filtered" ||
      !(observedAt > 0)
    ) {
      continue
    }
    const target = renderedTargetForMessage(message, stage)
    if (!target) continue
    const existing = bySession.get(sessionID)
    if (!existing) {
      bySession.set(sessionID, {
        id: sessionID,
        sessionID,
        parentSessionID: String(message?.parentSessionID || ""),
        agentName: stage,
        stage,
        status: "completed",
        startedAt: observedAt,
        lastObservedAt: observedAt,
        completedAt: observedAt,
        attempts: 1,
        depth: 0,
        targetMessageID: String(message.messageID || ""),
        goalID: message.goalID,
        stepID: message.phase?.stepID,
        phaseID: message.phase?.phaseID,
        ...target,
      })
      continue
    }
    existing.startedAt = Math.min(existing.startedAt, observedAt)
    existing.lastObservedAt = Math.max(existing.lastObservedAt, observedAt)
    existing.completedAt = Math.max(existing.completedAt || 0, observedAt)
    if (observedAt >= existing.lastObservedAt) {
      existing.agentName = stage
      existing.stage = stage
      existing.parentSessionID = String(message?.parentSessionID || existing.parentSessionID || "")
      existing.targetMessageID = String(message.messageID || "")
      existing.goalID = message.goalID || existing.goalID
      existing.stepID = message.phase?.stepID || existing.stepID
      existing.phaseID = message.phase?.phaseID || existing.phaseID
      existing.cardID = target.cardID
      existing.renderedCardID = target.renderedCardID
    }
  }
  return [...bySession.values()]
}

function applyDepth(records: AgentWorkflowRecord[]): AgentWorkflowRecord[] {
  const byID = new Map(records.map((record) => [record.sessionID, record]))
  const visiting = new Set<string>()
  const memo = new Map<string, number>()
  const depthOf = (sessionID: string): number => {
    if (memo.has(sessionID)) return memo.get(sessionID)!
    if (visiting.has(sessionID)) return 0
    visiting.add(sessionID)
    const parent = byID.get(sessionID)?.parentSessionID || ""
    const depth = parent && byID.has(parent) ? depthOf(parent) + 1 : 0
    visiting.delete(sessionID)
    memo.set(sessionID, depth)
    return depth
  }
  return records.map((record) => ({ ...record, depth: depthOf(record.sessionID) }))
}

export function resetConversationAgentView(): void {
  setConversationAgentStore({ taskID: "", records: [] })
}

export function hydrateConversationAgentView(taskID: string, view: ConversationAgentView): void {
  const messageBackedRecords = agentRecordFromMessages(Array.isArray(view?.messages) ? view.messages : [])
  const messageBackedSessionIDs = new Set(messageBackedRecords.map((record) => record.sessionID))
  const phaseOnlyRecords = (Array.isArray(view?.sessions) ? view.sessions : [])
    .filter((session) => !messageBackedSessionIDs.has(String(session?.sessionID || "")))
    .map(agentRecordFromPhaseSession)
    .filter((record): record is AgentWorkflowRecord => !!record)
  const records = [...messageBackedRecords, ...phaseOnlyRecords].sort((left, right) => left.startedAt - right.startedAt)
  setConversationAgentStore({
    taskID,
    records: applyDepth(records),
  })
}

function liveStageFromMessageInfo(info: any): string | null {
  const channel = String(info?.channel || "").trim()
  if (!channel) {
    throw new Error(
      `conversation agent live view: message info is missing channel. info=${JSON.stringify(info)}`,
    )
  }
  if (channel === "main" || channel === "filtered") return null
  const stage = normalizeAgentRole(channel)
  return stage === "user" ? null : stage
}

function liveMessageRecordTarget(
  sessionID: string,
  messageID: string,
  stage: string,
  goalID: string,
): Pick<AgentWorkflowRecord, "cardID" | "renderedCardID" | "stepID" | "phaseID"> {
  const phase = goalID ? goalStagePhaseID(stage) : null
  if (phase) {
    const renderedCardID = `step:${goalID}:${phase.stepID}`
    return {
      cardID: `${renderedCardID}:phase:${phase.phaseID}`,
      renderedCardID,
      stepID: phase.stepID,
      phaseID: phase.phaseID,
    }
  }
  if (stage === "integrity") return { renderedCardID: `${stage}:session:${sessionID}` }
  return { renderedCardID: `${stage}:session:${sessionID}:message:${messageID}` }
}

export function applyLiveConversationAgentMessageUpdated(sourceKeyInput: string, event: any): void {
  const sourceKey = String(sourceKeyInput || "").trim()
  if (!sourceKey) throw new Error("conversation agent live view requires a source key")
  const properties = event?.properties && typeof event.properties === "object" ? event.properties : event?.payload
  const info = properties?.info
  if (!info || typeof info !== "object" || Array.isArray(info)) {
    throw new Error("conversation agent live view message.updated missing info")
  }
  const messageID = String(info.id || "")
  const sessionID = String(info.sessionID || "")
  if (!messageID || !sessionID) throw new Error("conversation agent live view missing message id/sessionID")
  const stage = liveStageFromMessageInfo(info)
  if (!stage) return
  const observedAt = Number(info?.time?.created || 0)
  if (!(observedAt > 0)) {
    throw new Error(
      `conversation agent live view info.time.created must be positive (got ${info?.time?.created})`,
    )
  }
  const parentSessionID = String(info.parentSessionID || "")
  const goalID = String(info.goalID || "")
  const completedAt = Number(info?.time?.completed || 0)
  const completed = Number.isFinite(completedAt) && completedAt > 0
  const target = liveMessageRecordTarget(sessionID, messageID, stage, goalID)
  const existingRecords = conversationAgentStore.taskID === sourceKey ? conversationAgentStore.records : []
  const nextRecords = existingRecords.map((record) => ({ ...record }))
  const index = nextRecords.findIndex((record) => record.sessionID === sessionID)
  const nextObservedAt = completed ? Math.max(observedAt, completedAt) : observedAt
  if (index === -1) {
    nextRecords.push({
      id: sessionID,
      sessionID,
      parentSessionID,
      agentName: stage,
      stage,
      status: completed ? "completed" : "running",
      startedAt: observedAt,
      lastObservedAt: nextObservedAt,
      ...(completed ? { completedAt: nextObservedAt } : {}),
      attempts: 1,
      depth: 0,
      targetMessageID: messageID,
      goalID: goalID || undefined,
      ...target,
    })
  } else {
    const existing = nextRecords[index]!
    const isLatest = observedAt >= existing.lastObservedAt
    nextRecords[index] = {
      ...existing,
      startedAt: Math.min(existing.startedAt, observedAt),
      lastObservedAt: Math.max(existing.lastObservedAt, nextObservedAt),
      ...(completed ? { completedAt: Math.max(existing.completedAt || 0, nextObservedAt) } : {}),
      ...(isLatest
        ? {
            parentSessionID,
            agentName: stage,
            stage,
            status: completed ? "completed" : "running",
            targetMessageID: messageID,
            goalID: goalID || undefined,
            ...target,
          }
        : {}),
    }
  }
  const records = nextRecords.sort((left, right) => left.startedAt - right.startedAt)
  setConversationAgentStore({
    taskID: sourceKey,
    records: applyDepth(records),
  })
}
