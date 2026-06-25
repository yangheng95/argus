import { createStore } from "solid-js/store"
import type { AgentWorkflowRecord, AgentWorkflowStatus } from "../utils/agent-workflow"
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
  firstObservedAt?: number
  lastObservedAt?: number
  status?: AgentWorkflowStatus
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

type ConversationAgentTargetRecord = Pick<
  AgentWorkflowRecord,
  | "sessionID"
  | "parentSessionID"
  | "agentName"
  | "stage"
  | "startedAt"
  | "lastObservedAt"
  | "targetMessageID"
  | "targetObservedAt"
  | "goalID"
  | "stepID"
  | "phaseID"
  | "cardID"
  | "renderedCardID"
>

const pendingTargetsBySource = new Map<string, Map<string, ConversationAgentTargetRecord>>()

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

function renderedTargetForSession(
  session: ConversationAgentSessionView,
  stage: string,
): Pick<AgentWorkflowRecord, "cardID" | "renderedCardID"> | null {
  const phaseTarget = renderedTargetForPhaseSession(session)
  if (phaseTarget) return phaseTarget
  const messageID = String(session?.lastDisplayMessageID || "")
  if (!messageID) return null
  if (stage === "integrity") return { renderedCardID: `${stage}:session:${session.sessionID}` }
  return { renderedCardID: `${stage}:session:${session.sessionID}:message:${messageID}` }
}

function agentRecordFromSession(session: ConversationAgentSessionView): AgentWorkflowRecord | null {
  const sessionID = String(session?.sessionID || "")
  const rawStage = String(session?.stage || "")
  const stage = normalizeAgentRole(rawStage)
  const startedAt = Number(session?.firstObservedAt ?? session?.firstMessageTime ?? 0)
  if (
    !sessionID ||
    !stage ||
    stage === "user" ||
    session?.placement === "filtered" ||
    rawStage === "filtered" ||
    !(startedAt > 0)
  ) {
    return null
  }
  const target = renderedTargetForSession(session, stage)
  const lastObservedAt = Math.max(startedAt, Number(session?.lastObservedAt ?? session?.lastMessageTime ?? 0))
  const status = session.status || "pending"
  const terminal = status === "completed" || status === "error" || status === "skipped"
  return {
    id: sessionID,
    sessionID,
    parentSessionID: String(session?.parentSessionID || ""),
    agentName: stage,
    stage,
    status,
    startedAt,
    lastObservedAt,
    ...(terminal ? { completedAt: lastObservedAt } : {}),
    attempts: 1,
    depth: 0,
    targetMessageID: String(session?.lastDisplayMessageID || ""),
    goalID: session?.goalID,
    stepID: session?.phase?.stepID,
    phaseID: session?.phase?.phaseID,
    ...(target ? { ...target, targetObservedAt: Number(session?.lastMessageTime || lastObservedAt) } : {}),
  }
}

function targetHasCard(target: ConversationAgentTargetRecord): boolean {
  return !!target.renderedCardID || !!target.cardID
}

function targetShouldReplace(
  existing: AgentWorkflowRecord,
  target: ConversationAgentTargetRecord,
): boolean {
  if (!targetHasCard(target)) return false
  if (!existing.renderedCardID && !existing.cardID) return true
  return target.lastObservedAt >= Number(existing.targetObservedAt || 0)
}

function mergeTargetIntoRecord(
  existing: AgentWorkflowRecord,
  target: ConversationAgentTargetRecord,
): AgentWorkflowRecord {
  const replaceTarget = targetShouldReplace(existing, target)
  return {
    ...existing,
    startedAt: Math.min(existing.startedAt, target.startedAt),
    lastObservedAt: Math.max(existing.lastObservedAt, target.lastObservedAt),
    parentSessionID: target.parentSessionID || existing.parentSessionID,
    agentName: target.agentName || existing.agentName,
    stage: target.stage || existing.stage,
    goalID: target.goalID || existing.goalID,
    stepID: target.stepID || existing.stepID,
    phaseID: target.phaseID || existing.phaseID,
    ...(replaceTarget
      ? {
          targetMessageID: target.targetMessageID,
          targetObservedAt: target.lastObservedAt,
          cardID: target.cardID,
          renderedCardID: target.renderedCardID,
        }
      : {}),
  }
}

function mergeTargetRecords(
  records: AgentWorkflowRecord[],
  targets: ConversationAgentTargetRecord[],
): { records: AgentWorkflowRecord[]; attachedSessionIDs: Set<string> } {
  const attachedSessionIDs = new Set<string>()
  let nextRecords = records.map((record) => ({ ...record }))
  for (const target of targets) {
    const index = nextRecords.findIndex((record) => record.sessionID === target.sessionID)
    if (index === -1) continue
    nextRecords[index] = mergeTargetIntoRecord(nextRecords[index]!, target)
    attachedSessionIDs.add(target.sessionID)
  }
  nextRecords = nextRecords.sort((left, right) => left.startedAt - right.startedAt)
  return { records: applyDepth(nextRecords), attachedSessionIDs }
}

function pendingTargetsForSource(sourceKey: string): Map<string, ConversationAgentTargetRecord> {
  const existing = pendingTargetsBySource.get(sourceKey)
  if (existing) return existing
  const created = new Map<string, ConversationAgentTargetRecord>()
  pendingTargetsBySource.set(sourceKey, created)
  return created
}

function rememberPendingTarget(sourceKey: string, target: ConversationAgentTargetRecord): void {
  const pending = pendingTargetsForSource(sourceKey)
  const existing = pending.get(target.sessionID)
  if (!existing || target.lastObservedAt >= existing.lastObservedAt) pending.set(target.sessionID, target)
}

function forgetPendingTargets(sourceKey: string, sessionIDs: Set<string>): void {
  const pending = pendingTargetsBySource.get(sourceKey)
  if (!pending) return
  for (const sessionID of sessionIDs) pending.delete(sessionID)
  if (pending.size === 0) pendingTargetsBySource.delete(sourceKey)
}

function pendingTargetsForCurrentRecords(sourceKey: string, records: AgentWorkflowRecord[]): ConversationAgentTargetRecord[] {
  const pending = pendingTargetsBySource.get(sourceKey)
  if (!pending) return []
  const sessionIDs = new Set(records.map((record) => record.sessionID))
  return [...pending.values()].filter((target) => sessionIDs.has(target.sessionID))
}

function applyTargetRecordsToStore(sourceKey: string, targets: ConversationAgentTargetRecord[]): void {
  if (conversationAgentStore.taskID !== sourceKey) {
    for (const target of targets) rememberPendingTarget(sourceKey, target)
    return
  }
  const { records, attachedSessionIDs } = mergeTargetRecords(conversationAgentStore.records, targets)
  for (const target of targets) {
    if (!attachedSessionIDs.has(target.sessionID)) rememberPendingTarget(sourceKey, target)
  }
  forgetPendingTargets(sourceKey, attachedSessionIDs)
  setConversationAgentStore({
    taskID: sourceKey,
    records,
  })
}

function agentTargetRecordsFromMessages(messages: ConversationAgentMessageView[]): ConversationAgentTargetRecord[] {
  const bySession = new Map<string, ConversationAgentTargetRecord>()
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
        sessionID,
        parentSessionID: String(message?.parentSessionID || ""),
        agentName: stage,
        stage,
        startedAt: observedAt,
        lastObservedAt: observedAt,
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
  pendingTargetsBySource.clear()
  setConversationAgentStore({ taskID: "", records: [] })
}

export function hydrateConversationAgentView(taskID: string, view: ConversationAgentView): void {
  const recordsBySession = new Map<string, AgentWorkflowRecord>()
  const sessionRecords = (Array.isArray(view?.sessions) ? view.sessions : [])
    .map(agentRecordFromSession)
    .filter((record): record is AgentWorkflowRecord => !!record)
  for (const record of sessionRecords) recordsBySession.set(record.sessionID, { ...record })
  for (const target of agentTargetRecordsFromMessages(Array.isArray(view?.messages) ? view.messages : [])) {
    const existing = recordsBySession.get(target.sessionID)
    if (!existing) continue
    recordsBySession.set(target.sessionID, mergeTargetIntoRecord(existing, target))
  }
  const sourcePendingTargets = pendingTargetsForCurrentRecords(taskID, [...recordsBySession.values()])
  for (const target of sourcePendingTargets) {
    const existing = recordsBySession.get(target.sessionID)
    if (!existing) continue
    recordsBySession.set(target.sessionID, mergeTargetIntoRecord(existing, target))
  }
  forgetPendingTargets(taskID, new Set(sourcePendingTargets.map((target) => target.sessionID)))
  const records = [...recordsBySession.values()].sort((left, right) => left.startedAt - right.startedAt)
  setConversationAgentStore({
    taskID,
    records: applyDepth(records),
  })
}

export function attachConversationAgentViewTargets(sourceKeyInput: string, view: ConversationAgentView): void {
  const sourceKey = String(sourceKeyInput || "").trim()
  if (!sourceKey) throw new Error("conversation agent target attachment requires a source key")
  const targets = agentTargetRecordsFromMessages(Array.isArray(view?.messages) ? view.messages : [])
  applyTargetRecordsToStore(sourceKey, targets)
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

function liveEventProperties(event: any): any {
  return event?.properties && typeof event.properties === "object" ? event.properties : event?.payload
}

function liveEventObservedAt(event: any): number {
  const value = Number(event?.emittedAt || event?.emitted_at || event?.timestamp || event?.time?.emitted || 0)
  return Number.isFinite(value) && value > 0 ? value : 0
}

function livePartHasDisplay(part: any): boolean {
  const type = String(part?.type || "")
  if (!type || type === "step-start" || type === "step-finish" || type === "boundary") return false
  if (type === "text" || type === "reasoning") return Boolean(String(part?.text || "").trim())
  return true
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
  const properties = liveEventProperties(event)
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
  const nextObservedAt = completed ? Math.max(observedAt, completedAt) : observedAt
  applyTargetRecordsToStore(sourceKey, [
    {
      sessionID,
      parentSessionID,
      agentName: stage,
      stage,
      startedAt: observedAt,
      lastObservedAt: nextObservedAt,
      targetMessageID: messageID,
      goalID: goalID || undefined,
      ...target,
    },
  ])
}

export function applyLiveConversationAgentPartUpdated(sourceKeyInput: string, event: any): void {
  const sourceKey = String(sourceKeyInput || "").trim()
  if (!sourceKey) throw new Error("conversation agent live view requires a source key")
  const properties = liveEventProperties(event)
  const part = properties?.part
  if (!part || typeof part !== "object" || Array.isArray(part)) return
  if (!livePartHasDisplay(part)) return
  const channel = String(properties?.channel || "").trim()
  const resolvedRole = String(properties?.resolvedRole || "").trim()
  if (!channel || !resolvedRole) return
  const messageID = String(part.messageID || "")
  const sessionID = String(part.sessionID || "")
  if (!messageID || !sessionID) throw new Error("conversation agent live view part missing messageID/sessionID")
  const stage = liveStageFromMessageInfo({ channel })
  if (!stage) return
  const observedAt = liveEventObservedAt(event)
  if (!(observedAt > 0)) {
    throw new Error("conversation agent live view message.part.updated missing emitted time")
  }
  const parentSessionID = String(properties.parentSessionID || "")
  const goalID = String(properties.goalID || "")
  const target = liveMessageRecordTarget(sessionID, messageID, stage, goalID)
  applyTargetRecordsToStore(sourceKey, [
    {
      sessionID,
      parentSessionID,
      agentName: stage,
      stage,
      startedAt: observedAt,
      lastObservedAt: observedAt,
      targetMessageID: messageID,
      goalID: goalID || undefined,
      ...target,
    },
  ])
}

function liveAgentStatusFromSessionStatus(status: any): AgentWorkflowStatus {
  const type = String(status?.type || "")
  if (type === "streaming" || type === "retry") return "running"
  if (type === "idle") return "idle"
  if (type === "terminal") {
    const reason = String(status?.reason || "")
    if (reason === "error" || reason === "artifact_missing") return "error"
    if (reason === "completed") return "completed"
    if (reason === "aborted") return "skipped"
  }
  throw new Error(`conversation agent live view unknown session.status: ${JSON.stringify(status)}`)
}

function liveSessionRecordTarget(
  sessionID: string,
  stage: string,
  goalID: string,
): Pick<AgentWorkflowRecord, "cardID" | "renderedCardID" | "stepID" | "phaseID"> | null {
  const phase = goalID ? goalStagePhaseID(stage) : null
  if (!phase) return null
  const renderedCardID = `step:${goalID}:${phase.stepID}`
  return {
    cardID: `${renderedCardID}:phase:${phase.phaseID}`,
    renderedCardID,
    stepID: phase.stepID,
    phaseID: phase.phaseID,
  }
}

export function applyLiveConversationAgentSessionStatus(sourceKeyInput: string, event: any): void {
  const sourceKey = String(sourceKeyInput || "").trim()
  if (!sourceKey) throw new Error("conversation agent live view requires a source key")
  const properties = liveEventProperties(event)
  const sessionID = String(properties?.sessionID || "")
  if (!sessionID) throw new Error("conversation agent live view session.status missing sessionID")
  const stage = liveStageFromMessageInfo(properties)
  if (!stage) return
  const status = liveAgentStatusFromSessionStatus(properties?.status)
  const observedAt = liveEventObservedAt(event)
  if (!(observedAt > 0)) {
    throw new Error("conversation agent live view session.status missing emitted time")
  }
  const existingRecords = conversationAgentStore.taskID === sourceKey ? conversationAgentStore.records : []
  const nextRecords = existingRecords.map((record) => ({ ...record }))
  const index = nextRecords.findIndex((record) => record.sessionID === sessionID)
  const terminal = status === "completed" || status === "error" || status === "skipped"
  if (index === -1) {
    const goalID = String(properties.goalID || "")
    const target = liveSessionRecordTarget(sessionID, stage, goalID)
    const created: AgentWorkflowRecord = {
      id: sessionID,
      sessionID,
      parentSessionID: String(properties.parentSessionID || ""),
      agentName: stage,
      stage,
      status,
      startedAt: observedAt,
      lastObservedAt: observedAt,
      ...(terminal ? { completedAt: observedAt } : {}),
      attempts: 1,
      depth: 0,
      targetMessageID: "",
      goalID: goalID || undefined,
      ...(target ? { ...target, targetObservedAt: observedAt } : {}),
    }
    const pendingTarget = pendingTargetsForSource(sourceKey).get(sessionID)
    nextRecords.push(pendingTarget ? mergeTargetIntoRecord(created, pendingTarget) : created)
  } else {
    const existing = nextRecords[index]!
    const goalID = String(properties.goalID || existing.goalID || "")
    const target = liveSessionRecordTarget(sessionID, stage, goalID)
    const updated: AgentWorkflowRecord = {
      ...existing,
      parentSessionID: String(properties.parentSessionID || existing.parentSessionID || ""),
      agentName: stage,
      stage,
      status,
      startedAt: Math.min(existing.startedAt, observedAt),
      lastObservedAt: Math.max(existing.lastObservedAt, observedAt),
      ...(terminal ? { completedAt: Math.max(existing.completedAt || 0, observedAt) } : {}),
      goalID: goalID || undefined,
    }
    nextRecords[index] = target
      ? mergeTargetIntoRecord(updated, {
          sessionID,
          parentSessionID: updated.parentSessionID,
          agentName: stage,
          stage,
          startedAt: observedAt,
          lastObservedAt: observedAt,
          targetMessageID: updated.targetMessageID || "",
          goalID: goalID || undefined,
          ...target,
        })
      : updated
  }
  const records = applyDepth(nextRecords.sort((left, right) => left.startedAt - right.startedAt))
  forgetPendingTargets(sourceKey, new Set(records.map((record) => record.sessionID)))
  setConversationAgentStore({
    taskID: sourceKey,
    records,
  })
}
