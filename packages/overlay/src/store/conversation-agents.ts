import { createStore } from "solid-js/store"
import type { AgentWorkflowRecord, AgentWorkflowStatus } from "../utils/agent-workflow"
import { normalizeAgentRole } from "../utils/message"
import type { BoardSource } from "./board"
import {
  renderedConversationCardTargetForGoalPhase,
  renderedConversationCardTargetForMessage,
} from "../services/tree-writer"
import { compareTimelineOrderKeys, requireTimelineOrderKey, requireTimelineOrderKeyDomain } from "../utils/timeline-order"
import { messagePartHasDisplayContent } from "../utils/message-part"

export interface ConversationAgentSessionView {
  sessionID: string
  orderKey: string
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
  orderKey: string
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
  | "rawStage"
  | "orderKey"
  | "startedAt"
  | "lastObservedAt"
  | "targetMessageID"
  | "goalID"
  | "stepID"
  | "phaseID"
  | "cardID"
  | "renderedCardID"
>

const pendingTargetsBySource = new Map<string, Map<string, ConversationAgentTargetRecord>>()

type AgentRenderedTarget = Pick<AgentWorkflowRecord, "cardID" | "renderedCardID" | "stepID" | "phaseID">
type AgentProjectedRecordTarget = {
  orderKey: string
  targetMessageID: string
  target: AgentRenderedTarget
}

export function conversationAgentSourceKey(source: BoardSource | null): string {
  return source ? `${source.kind}:${source.id}` : ""
}

export function conversationAgentRecordsForSource(source: BoardSource | null): AgentWorkflowRecord[] {
  const key = conversationAgentSourceKey(source)
  return key && conversationAgentStore.taskID === key
    ? conversationAgentStore.records.map(recordWithCurrentProjection)
    : []
}

function agentRenderedTargetFromProjection(target: {
  cardID?: string
  renderedCardID: string
  stepID?: string
  phaseID?: string
}): AgentRenderedTarget {
  return {
    ...(target.cardID ? { cardID: target.cardID } : {}),
    renderedCardID: target.renderedCardID,
    ...(target.stepID ? { stepID: target.stepID } : {}),
    ...(target.phaseID ? { phaseID: target.phaseID } : {}),
  }
}

function renderedTargetForMessage(message: ConversationAgentMessageView): AgentRenderedTarget | null {
  const messageID = String(message?.messageID || "")
  if (!messageID) return null
  const orderKey = requireTimelineOrderKeyDomain(message?.orderKey, `conversation agent message ${messageID}`, "message")
  const target = renderedConversationCardTargetForMessage(messageID)
  if (!target) return null
  if (target.orderKey !== orderKey) {
    throw new Error(`conversation agent message ${messageID} orderKey drift between rail view and tree-writer target`)
  }
  return agentRenderedTargetFromProjection(target)
}

function renderedTargetForPhaseSession(session: ConversationAgentSessionView, rawStage: string): AgentRenderedTarget | null {
  const goalID = String(session?.goalID || "")
  const stepID = String(session?.phase?.stepID || "")
  const phaseID = String(session?.phase?.phaseID || "")
  const sessionID = String(session?.sessionID || "")
  if (!goalID || !rawStage) return null
  const target = renderedConversationCardTargetForGoalPhase({ goalID, sessionID, stepID, phaseID, stage: rawStage })
  return target ? agentRenderedTargetFromProjection(target) : null
}

function renderedTargetForSession(
  session: ConversationAgentSessionView,
  stage: string,
  rawStage: string,
): AgentRenderedTarget | null {
  const phaseTarget = renderedTargetForPhaseSession(session, rawStage)
  if (phaseTarget) return phaseTarget
  const messageID = String(session?.lastDisplayMessageID || "")
  if (!messageID) return null
  if (!stage) return null
  const target = renderedConversationCardTargetForMessage(messageID)
  return target ? agentRenderedTargetFromProjection(target) : null
}

function agentRecordFromSession(session: ConversationAgentSessionView): AgentWorkflowRecord | null {
  const sessionID = String(session?.sessionID || "")
  const rawStage = String(session?.stage || "")
  const stage = normalizeAgentRole(rawStage)
  const startedAt = Number(session?.firstObservedAt ?? session?.firstMessageTime ?? 0)
  const orderKey = requireTimelineOrderKey(session?.orderKey, `conversation agent session ${sessionID}`)
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
  const target = renderedTargetForSession(session, stage, rawStage)
  const lastDisplayMessageID = String(session?.lastDisplayMessageID || "")
  const targetMessageID = renderedConversationCardTargetForMessage(lastDisplayMessageID) ? lastDisplayMessageID : ""
  const lastObservedAt = Math.max(startedAt, Number(session?.lastObservedAt ?? session?.lastMessageTime ?? 0))
  const status = session.status || "pending"
  const terminal = status === "completed" || status === "error" || status === "skipped"
  return {
    id: sessionID,
    sessionID,
    parentSessionID: String(session?.parentSessionID || ""),
    agentName: stage,
    stage,
    rawStage,
    status,
    orderKey,
    startedAt,
    lastObservedAt,
    ...(terminal ? { completedAt: lastObservedAt } : {}),
    attempts: 1,
    depth: 0,
    targetMessageID,
    goalID: session?.goalID,
    stepID: session?.phase?.stepID,
    phaseID: session?.phase?.phaseID,
    ...(target ? { ...target } : {}),
  }
}

function projectedTargetForRecord(record: {
  sessionID: string
  stage?: string
  rawStage?: string
  targetMessageID?: string
  goalID?: string
  stepID?: string
  phaseID?: string
}): AgentProjectedRecordTarget | null {
  const targetMessageID = String(record.targetMessageID || "")
  if (targetMessageID) {
    const target = renderedConversationCardTargetForMessage(targetMessageID)
    if (target) {
      return {
        orderKey: target.orderKey,
        targetMessageID,
        target: agentRenderedTargetFromProjection(target),
      }
    }
  }
  const phaseTarget = renderedConversationCardTargetForGoalPhase({
    goalID: record.goalID,
    sessionID: record.sessionID,
    stepID: record.stepID,
    phaseID: record.phaseID,
    stage: record.rawStage || record.stage,
  })
  return phaseTarget
    ? {
        orderKey: phaseTarget.orderKey,
        targetMessageID: "",
        target: agentRenderedTargetFromProjection(phaseTarget),
      }
    : null
}

function requireProjectedTargetForRecord(
  record: {
    sessionID: string
    stage?: string
    rawStage?: string
    targetMessageID?: string
    goalID?: string
    stepID?: string
    phaseID?: string
  },
  label: string,
): AgentProjectedRecordTarget {
  const projected = projectedTargetForRecord(record)
  if (!projected) throw new Error(`${label} has no current tree-writer projection`)
  return projected
}

function clearRecordTarget(record: AgentWorkflowRecord): AgentWorkflowRecord {
  const {
    cardID: _cardID,
    renderedCardID: _renderedCardID,
    stepID: _stepID,
    phaseID: _phaseID,
    ...rest
  } = record
  return {
    ...rest,
    targetMessageID: "",
  }
}

function recordWithCurrentProjection(record: AgentWorkflowRecord): AgentWorkflowRecord {
  const projected = projectedTargetForRecord(record)
  if (!projected) {
    return record.targetMessageID || record.cardID || record.renderedCardID ? clearRecordTarget(record) : record
  }
  return {
    ...record,
    targetMessageID: projected.targetMessageID,
    cardID: projected.target.cardID,
    renderedCardID: projected.target.renderedCardID,
    stepID: projected.target.stepID,
    phaseID: projected.target.phaseID,
  }
}

function mergeTargetIntoRecord(
  existing: AgentWorkflowRecord,
  target: ConversationAgentTargetRecord,
): AgentWorkflowRecord {
  const incomingProjection = requireProjectedTargetForRecord(
    target,
    `conversation agent target ${target.sessionID}`,
  )
  const existingProjection = projectedTargetForRecord(existing)
  const replaceTarget =
    !existingProjection ||
    compareTimelineOrderKeys(
      incomingProjection.orderKey,
      existingProjection.orderKey,
      `conversation agent target ${existing.sessionID}`,
    ) >= 0
  const existingOrderKey = requireTimelineOrderKey(existing.orderKey, `conversation agent record ${existing.sessionID}`)
  const incomingOrderKey = requireTimelineOrderKey(
    incomingProjection.orderKey,
    `conversation agent target ${target.sessionID} projection`,
  )
  return {
    ...existing,
    orderKey:
      compareTimelineOrderKeys(incomingOrderKey, existingOrderKey, "conversation agent merge") < 0
        ? incomingOrderKey
        : existingOrderKey,
    startedAt: Math.min(existing.startedAt, target.startedAt),
    lastObservedAt: Math.max(existing.lastObservedAt, target.lastObservedAt),
    parentSessionID: target.parentSessionID || existing.parentSessionID,
    agentName: target.agentName || existing.agentName,
    stage: target.stage || existing.stage,
    rawStage: target.rawStage || existing.rawStage,
    goalID: target.goalID || existing.goalID,
    stepID: target.stepID || existing.stepID,
    phaseID: target.phaseID || existing.phaseID,
    ...(replaceTarget
      ? {
          targetMessageID: incomingProjection.targetMessageID,
          cardID: incomingProjection.target.cardID,
          renderedCardID: incomingProjection.target.renderedCardID,
          stepID: incomingProjection.target.stepID,
          phaseID: incomingProjection.target.phaseID,
        }
      : existingProjection
        ? {
            targetMessageID: existingProjection.targetMessageID,
            cardID: existingProjection.target.cardID,
            renderedCardID: existingProjection.target.renderedCardID,
            stepID: existingProjection.target.stepID,
            phaseID: existingProjection.target.phaseID,
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
  nextRecords = sortAgentRecords(nextRecords)
  return { records: applyDepth(nextRecords), attachedSessionIDs }
}

function sortAgentRecords(records: AgentWorkflowRecord[]): AgentWorkflowRecord[] {
  return records.sort((left, right) =>
    compareTimelineOrderKeys(left.orderKey, right.orderKey, "conversation agent record"),
  )
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
  if (
    !existing ||
    compareTimelineOrderKeys(target.orderKey, existing.orderKey, `conversation agent pending target ${target.sessionID}`) >=
      0
  ) {
    pending.set(target.sessionID, target)
  }
}

function forgetPendingTargets(sourceKey: string, sessionIDs: Set<string>): void {
  const pending = pendingTargetsBySource.get(sourceKey)
  if (!pending) return
  for (const sessionID of sessionIDs) pending.delete(sessionID)
  if (pending.size === 0) pendingTargetsBySource.delete(sourceKey)
}

function pendingTargetsForCurrentRecords(
  sourceKey: string,
  records: AgentWorkflowRecord[],
): ConversationAgentTargetRecord[] {
  const pending = pendingTargetsBySource.get(sourceKey)
  if (!pending) return []
  const sessionIDs = new Set(records.map((record) => record.sessionID))
  const current: ConversationAgentTargetRecord[] = []
  for (const target of pending.values()) {
    if (!sessionIDs.has(target.sessionID)) continue
    if (!projectedTargetForRecord(target)) {
      pending.delete(target.sessionID)
      continue
    }
    current.push(target)
  }
  if (pending.size === 0) pendingTargetsBySource.delete(sourceKey)
  return current
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
    const orderKey = requireTimelineOrderKeyDomain(
      message?.orderKey,
      `conversation agent message ${message?.messageID || ""}`,
      "message",
    )
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
    const target = renderedTargetForMessage(message)
    if (!target) continue
    const existing = bySession.get(sessionID)
    if (!existing) {
      bySession.set(sessionID, {
        sessionID,
        parentSessionID: String(message?.parentSessionID || ""),
        agentName: stage,
        stage,
        rawStage,
        orderKey,
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
    const isLatestTarget = compareTimelineOrderKeys(orderKey, existing.orderKey, "conversation agent message target") >= 0
    existing.startedAt = Math.min(existing.startedAt, observedAt)
    existing.lastObservedAt = Math.max(existing.lastObservedAt, observedAt)
    if (isLatestTarget) {
      existing.orderKey = orderKey
      existing.agentName = stage
      existing.stage = stage
      existing.rawStage = rawStage
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

export function clearConversationAgentRenderedTargets(sourceKeyInput?: string): void {
  const sourceKey = String(sourceKeyInput || "").trim()
  if (sourceKey && conversationAgentStore.taskID !== sourceKey) {
    pendingTargetsBySource.delete(sourceKey)
    return
  }
  if (sourceKey) pendingTargetsBySource.delete(sourceKey)
  else pendingTargetsBySource.clear()
  if (!conversationAgentStore.taskID) return
  setConversationAgentStore({
    taskID: conversationAgentStore.taskID,
    records: applyDepth(sortAgentRecords(conversationAgentStore.records.map(clearRecordTarget))),
  })
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
  const records = sortAgentRecords([...recordsBySession.values()])
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

function liveRawStageFromMessageInfo(info: any): string | null {
  const channel = String(info?.channel || "").trim()
  if (!channel) {
    throw new Error(`conversation agent live view: message info is missing channel. info=${JSON.stringify(info)}`)
  }
  if (channel === "main" || channel === "filtered") return null
  return normalizeAgentRole(channel) === "user" ? null : channel
}

function liveStageFromMessageInfo(info: any): string | null {
  const rawStage = liveRawStageFromMessageInfo(info)
  return rawStage ? normalizeAgentRole(rawStage) : null
}

function liveEventProperties(event: any): any {
  return event?.properties && typeof event.properties === "object" ? event.properties : event?.payload
}

function liveEventObservedAt(event: any): number {
  const value = Number(event?.emittedAt || event?.emitted_at || event?.timestamp || event?.time?.emitted || 0)
  return Number.isFinite(value) && value > 0 ? value : 0
}

function livePartHasDisplay(part: any): boolean {
  return messagePartHasDisplayContent(part)
}

function liveMessageRecordTarget(
  sessionID: string,
  messageID: string,
): Pick<AgentWorkflowRecord, "cardID" | "renderedCardID" | "stepID" | "phaseID"> | null {
  const target = renderedConversationCardTargetForMessage(messageID)
  void sessionID
  return target ? agentRenderedTargetFromProjection(target) : null
}

function requireLiveMessageRecordTarget(
  sessionID: string,
  messageID: string,
): Pick<AgentWorkflowRecord, "cardID" | "renderedCardID" | "stepID" | "phaseID"> {
  const target = liveMessageRecordTarget(sessionID, messageID)
  if (!target) {
    throw new Error(
      `conversation agent live view missing rendered message target for message ${messageID} in session ${sessionID}`,
    )
  }
  return target
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
  const rawStage = liveRawStageFromMessageInfo(info)
  if (!rawStage) return
  const stage = normalizeAgentRole(rawStage)
  const observedAt = Number(info?.time?.created || 0)
  const orderKey = requireTimelineOrderKey(event?.orderKey, `conversation agent live message ${messageID}`)
  if (typeof info?.orderKey === "string" && info.orderKey.length > 0 && info.orderKey !== orderKey) {
    throw new Error(`conversation agent live message ${messageID} orderKey drift between envelope and info`)
  }
  if (!(observedAt > 0)) {
    throw new Error(`conversation agent live view info.time.created must be positive (got ${info?.time?.created})`)
  }
  const parentSessionID = String(info.parentSessionID || "")
  const goalID = String(info.goalID || "")
  const completedAt = Number(info?.time?.completed || 0)
  const completed = Number.isFinite(completedAt) && completedAt > 0
  const target = liveMessageRecordTarget(sessionID, messageID)
  if (!target) return
  const nextObservedAt = completed ? Math.max(observedAt, completedAt) : observedAt
  applyTargetRecordsToStore(sourceKey, [
    {
      sessionID,
      parentSessionID,
      agentName: stage,
      stage,
      rawStage,
      orderKey,
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
  const messageID = String(part.messageID || "")
  const sessionID = String(part.sessionID || "")
  if (!messageID || !sessionID) throw new Error("conversation agent live view part missing messageID/sessionID")
  const channel = typeof properties?.channel === "string" ? properties.channel.trim() : ""
  const resolvedRole = typeof properties?.resolvedRole === "string" ? properties.resolvedRole.trim() : ""
  if (!channel || !resolvedRole) {
    throw new Error(
      `conversation agent live view message.part.updated for ${messageID} missing top-level channel/resolvedRole`,
    )
  }
  const rawStage = liveRawStageFromMessageInfo({ channel })
  if (!rawStage) return
  const stage = normalizeAgentRole(rawStage)
  const observedAt = liveEventObservedAt(event)
  const orderKey = requireTimelineOrderKey(event?.orderKey, `conversation agent live part ${messageID}`)
  if (typeof properties?.orderKey === "string" && properties.orderKey.length > 0 && properties.orderKey !== orderKey) {
    throw new Error(`conversation agent live part ${messageID} orderKey drift between envelope and payload`)
  }
  if (!(observedAt > 0)) {
    throw new Error("conversation agent live view message.part.updated missing emitted time")
  }
  const parentSessionID = String(properties.parentSessionID || "")
  const goalID = String(properties.goalID || "")
  const target = requireLiveMessageRecordTarget(sessionID, messageID)
  applyTargetRecordsToStore(sourceKey, [
    {
      sessionID,
      parentSessionID,
      agentName: stage,
      stage,
      rawStage,
      orderKey,
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
  rawStage: string,
  goalID: string,
  sessionID: string,
): Pick<AgentWorkflowRecord, "cardID" | "renderedCardID" | "stepID" | "phaseID"> | null {
  const target = renderedConversationCardTargetForGoalPhase({ goalID, sessionID, stage: rawStage })
  return target ? agentRenderedTargetFromProjection(target) : null
}

export function applyLiveConversationAgentSessionStatus(sourceKeyInput: string, event: any): void {
  const sourceKey = String(sourceKeyInput || "").trim()
  if (!sourceKey) throw new Error("conversation agent live view requires a source key")
  const properties = liveEventProperties(event)
  const sessionID = String(properties?.sessionID || "")
  if (!sessionID) throw new Error("conversation agent live view session.status missing sessionID")
  const rawStage = liveRawStageFromMessageInfo(properties)
  if (!rawStage) return
  const stage = normalizeAgentRole(rawStage)
  const status = liveAgentStatusFromSessionStatus(properties?.status)
  const observedAt = liveEventObservedAt(event)
  const orderKey = requireTimelineOrderKeyDomain(event?.orderKey, `conversation agent live session ${sessionID}`, "session")
  if (!(observedAt > 0)) {
    throw new Error("conversation agent live view session.status missing emitted time")
  }
  const existingRecords = conversationAgentStore.taskID === sourceKey ? conversationAgentStore.records : []
  const nextRecords = existingRecords.map((record) => ({ ...record }))
  const index = nextRecords.findIndex((record) => record.sessionID === sessionID)
  const terminal = status === "completed" || status === "error" || status === "skipped"
  if (index === -1) {
    const goalID = String(properties.goalID || "")
    const target = liveSessionRecordTarget(rawStage, goalID, sessionID)
    const created: AgentWorkflowRecord = {
      id: sessionID,
      sessionID,
      parentSessionID: String(properties.parentSessionID || ""),
      agentName: stage,
      stage,
      rawStage,
      status,
      orderKey,
      startedAt: observedAt,
      lastObservedAt: observedAt,
      ...(terminal ? { completedAt: observedAt } : {}),
      attempts: 1,
      depth: 0,
      targetMessageID: "",
      goalID: goalID || undefined,
      ...(target ? { ...target } : {}),
    }
    const pendingTarget = pendingTargetsForSource(sourceKey).get(sessionID)
    nextRecords.push(pendingTarget ? mergeTargetIntoRecord(created, pendingTarget) : created)
  } else {
    const existing = recordWithCurrentProjection(nextRecords[index]!)
    const goalID = String(properties.goalID || existing.goalID || "")
    const target = liveSessionRecordTarget(rawStage, goalID, sessionID)
    const updated: AgentWorkflowRecord = {
      ...existing,
      parentSessionID: String(properties.parentSessionID || existing.parentSessionID || ""),
      agentName: stage,
      stage,
      rawStage,
      status,
      orderKey:
        existing.orderKey &&
        compareTimelineOrderKeys(existing.orderKey, orderKey, "conversation agent live session") <= 0
          ? existing.orderKey
          : orderKey,
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
          orderKey,
          startedAt: observedAt,
          lastObservedAt: observedAt,
          targetMessageID: updated.targetMessageID || "",
          goalID: goalID || undefined,
          ...target,
        })
      : recordWithCurrentProjection(updated)
  }
  const records = applyDepth(sortAgentRecords(nextRecords))
  forgetPendingTargets(sourceKey, new Set(records.map((record) => record.sessionID)))
  setConversationAgentStore({
    taskID: sourceKey,
    records,
  })
}
