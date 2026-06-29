import type { CardNode, CardStatus } from "../store/card-tree"
import type { TraceEvent } from "../services/trace"
import { isBuildPhaseCard } from "./card-tree"
import { normalizeAgentRole } from "./message"

export type AgentWorkflowStatus = "pending" | "running" | "idle" | "completed" | "error" | "skipped"

export interface AgentWorkflowReport {
  kind: string
  summary: string
  detail: string
  ts: number
  attempts?: number
}

export interface AgentWorkflowRecord {
  id: string
  sessionID: string
  parentSessionID: string
  agentName: string
  stage: string
  status: AgentWorkflowStatus
  orderKey?: string
  startedAt: number
  lastObservedAt: number
  completedAt?: number
  attempts: number
  depth: number
  cardID?: string
  renderedCardID?: string
  targetMessageID?: string
  targetObservedAt?: number
  goalID?: string
  goalDescription?: string
  round?: number
  attempt?: number
  stepID?: string
  phaseID?: string
  model?: string
  traceReport?: AgentWorkflowReport
  displaySummary?: {
    text: string
    source: "trace_report"
  }
}

export interface AgentWorkflowStack {
  id: string
  agentName: string
  parentSessionID: string
  depth: number
  startedAt: number
  records: AgentWorkflowRecord[]
}

export interface AgentWorkflowProjection {
  records: AgentWorkflowRecord[]
  stacks: AgentWorkflowStack[]
}

function normaliseStatus(status: CardStatus | string | undefined): AgentWorkflowStatus {
  const value = String(status || "").toLowerCase()
  if (value === "running") return "running"
  if (value === "idle") return "idle"
  if (value === "completed") return "completed"
  if (value === "error" || value === "failed") return "error"
  if (value === "skipped") return "skipped"
  return "pending"
}

function statusFromReport(kind: string, payload: Record<string, any>): AgentWorkflowStatus {
  if (kind === "agent_report_failure" || payload?.error) return "error"
  if (kind === "orchestrator_wake_failure") return "error"
  if (kind === "agent_report" || kind === "agent_report_retry_final" || kind === "orchestrator_wake") return "completed"
  return "pending"
}

function mergeStatus(current: AgentWorkflowStatus, next: AgentWorkflowStatus): AgentWorkflowStatus {
  const rank: Record<AgentWorkflowStatus, number> = {
    pending: 0,
    idle: 1,
    skipped: 2,
    running: 3,
    completed: 4,
    error: 5,
  }
  return rank[next] >= rank[current] ? next : current
}

function isTerminalStatus(status: AgentWorkflowStatus): boolean {
  return status === "completed" || status === "error" || status === "skipped" || status === "idle"
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}

export function traceReport(event: TraceEvent): AgentWorkflowReport | undefined {
  const kind = String(event.kind || "")
  if (
    kind !== "agent_report" &&
    kind !== "agent_report_retry_final" &&
    kind !== "agent_report_failure" &&
    kind !== "orchestrator_wake" &&
    kind !== "orchestrator_wake_failure"
  ) {
    return undefined
  }
  const payload = (event.payload || {}) as Record<string, any>
  const report = payload.report
  if (!report || typeof report !== "object") return undefined
  const summary = typeof report.summary === "string" ? report.summary.trim() : ""
  const detail = typeof report.detail === "string" ? report.detail.trim() : ""
  if (!summary || !detail) return undefined
  const attempts = Number(payload.attempts || 0)
  return {
    kind,
    ts: Number(event.ts || 0),
    summary,
    detail,
    ...(attempts > 0 ? { attempts } : {}),
  }
}

function phaseIDFromCardID(id: string): string {
  const marker = ":phase:"
  const idx = id.indexOf(marker)
  return idx >= 0 ? id.slice(idx + marker.length) : ""
}

function stepIDFromCardID(id: string): string {
  const [head] = id.split(":phase:")
  const parts = (head || "").split(":")
  return parts[0] === "step" && parts.length >= 3 ? parts[2] || "" : ""
}

function renderedCardIDForCard(card: CardNode, cards: Record<string, CardNode>): string | undefined {
  if (card.kind !== "phase") return card.id
  if (!isBuildPhaseCard(card)) return card.id
  const owners = Object.values(cards).filter(
    (candidate) =>
      candidate?.kind === "step" && Array.isArray(candidate.childIDs) && candidate.childIDs.includes(card.id),
  )
  if (owners.length === 1) return owners[0]!.id
  return undefined
}

function ensureRecord(records: Map<string, AgentWorkflowRecord>, sessionID: string): AgentWorkflowRecord {
  const existing = records.get(sessionID)
  if (existing) return existing
  const record: AgentWorkflowRecord = {
    id: sessionID,
    sessionID,
    parentSessionID: "",
    agentName: "assistant",
    stage: "assistant",
    status: "pending",
    startedAt: 0,
    lastObservedAt: 0,
    attempts: 1,
    depth: 0,
  }
  records.set(sessionID, record)
  return record
}

function applyTraceEvent(records: Map<string, AgentWorkflowRecord>, event: TraceEvent): void {
  const sessionID = typeof event.sessionID === "string" ? event.sessionID : ""
  if (!sessionID) return
  const record = ensureRecord(records, sessionID)
  const agentName = firstString(event.agentName, record.agentName)
  record.agentName = agentName
  record.stage = normalizeAgentRole(agentName)
  record.parentSessionID = firstString(event.parentSessionID, record.parentSessionID)
  const ts = Number(event.ts || 0)
  if (ts > 0) {
    record.startedAt = record.startedAt > 0 ? Math.min(record.startedAt, ts) : ts
    record.lastObservedAt = Math.max(record.lastObservedAt || 0, ts)
  }
  if (event.kind === "llm_request") {
    const model = (event.payload || {}).model || {}
    const providerID = typeof model.providerID === "string" ? model.providerID : ""
    const modelID = typeof model.modelID === "string" ? model.modelID : ""
    record.model = providerID && modelID ? `${providerID}/${modelID}` : firstString(modelID, providerID, record.model)
    record.status = mergeStatus(record.status, "running")
  }
  const report = traceReport(event)
  if (report) {
    record.traceReport = report
    record.displaySummary = { text: report.summary, source: "trace_report" }
    record.attempts = Math.max(record.attempts, report.attempts || 1)
    const nextStatus = statusFromReport(String(event.kind || ""), (event.payload || {}) as Record<string, any>)
    record.status = mergeStatus(record.status, nextStatus)
    if (ts > 0 && isTerminalStatus(nextStatus)) {
      record.completedAt = Math.max(record.completedAt || 0, ts)
    }
  }
}

function applyCardRecord(
  records: Map<string, AgentWorkflowRecord>,
  card: CardNode,
  cards: Record<string, CardNode>,
): void {
  if (card.kind !== "agent" && card.kind !== "phase") return
  // Phase cards absorb a goal-scoped runtime session via phaseSessionID;
  // every other card carries its explicit sessionID. Multiple message-turn
  // cards for the same session merge into one workflow record because
  // ensureRecord is keyed by sessionID (spec §5.2).
  const sessionID = card.kind === "phase" ? String(card.phaseSessionID || "") : String(card.sessionID || "")
  if (!sessionID) return
  const record = ensureRecord(records, sessionID)
  record.cardID = card.id
  record.renderedCardID = renderedCardIDForCard(card, cards) || record.renderedCardID
  record.goalID = card.goalID || record.goalID
  record.goalDescription = card.goalDescription || record.goalDescription
  record.round = typeof card.round === "number" ? card.round : record.round
  record.attempt = typeof card.attempt === "number" ? card.attempt : record.attempt
  record.stepID = card.stepID || stepIDFromCardID(card.id) || record.stepID
  record.phaseID = card.phaseID || phaseIDFromCardID(card.id) || record.phaseID
  record.agentName = firstString(card.stage, record.agentName)
  record.stage = normalizeAgentRole(record.agentName)
  const cardStatus = normaliseStatus(card.status)
  record.status = mergeStatus(record.status, cardStatus)
  if (typeof card.time === "number" && card.time > 0) {
    record.startedAt = record.startedAt > 0 ? Math.min(record.startedAt, card.time) : card.time
    record.lastObservedAt = Math.max(record.lastObservedAt || 0, card.time)
  }
  if (typeof card.timeCompleted === "number" && card.timeCompleted > 0) {
    record.lastObservedAt = Math.max(record.lastObservedAt || 0, card.timeCompleted)
    if (isTerminalStatus(cardStatus)) {
      record.completedAt = Math.max(record.completedAt || 0, card.timeCompleted)
    }
  }
}

function applyDepth(records: Map<string, AgentWorkflowRecord>): void {
  const visiting = new Set<string>()
  const memo = new Map<string, number>()
  const depthOf = (sessionID: string): number => {
    if (memo.has(sessionID)) return memo.get(sessionID)!
    if (visiting.has(sessionID)) return 0
    visiting.add(sessionID)
    const parent = records.get(sessionID)?.parentSessionID || ""
    const depth = parent && records.has(parent) ? depthOf(parent) + 1 : 0
    visiting.delete(sessionID)
    memo.set(sessionID, depth)
    return depth
  }
  for (const record of records.values()) {
    record.depth = depthOf(record.sessionID)
  }
}

export function buildAgentWorkflow(input: {
  cards: Record<string, CardNode>
  order: string[]
  traceEvents: TraceEvent[]
}): AgentWorkflowProjection {
  const records = new Map<string, AgentWorkflowRecord>()
  for (const event of input.traceEvents || []) applyTraceEvent(records, event)
  const seenCards = new Set<string>()
  const visitCard = (cardID: string) => {
    if (!cardID || seenCards.has(cardID)) return
    seenCards.add(cardID)
    const card = input.cards[cardID]
    if (!card) return
    applyCardRecord(records, card, input.cards)
    for (const childID of card.childIDs || []) visitCard(childID)
  }
  for (const cardID of input.order || []) {
    visitCard(cardID)
  }
  applyDepth(records)
  const list = [...records.values()]
    .filter((record) => record.sessionID && record.startedAt > 0)
    .sort((left, right) => left.startedAt - right.startedAt)
  const stackMap = new Map<string, AgentWorkflowStack>()
  for (const record of list) {
    const key = `${record.parentSessionID || "root"}::${normalizeAgentRole(record.agentName)}`
    const existing = stackMap.get(key)
    if (existing) {
      existing.records.push(record)
      existing.startedAt = Math.min(existing.startedAt, record.startedAt)
      existing.depth = Math.min(existing.depth, record.depth)
    } else {
      stackMap.set(key, {
        id: key,
        agentName: record.agentName,
        parentSessionID: record.parentSessionID,
        depth: record.depth,
        startedAt: record.startedAt,
        records: [record],
      })
    }
  }
  const stacks = [...stackMap.values()]
    .map((stack) => ({
      ...stack,
      records: stack.records.slice().sort((left, right) => left.startedAt - right.startedAt),
    }))
    .sort((left, right) => left.startedAt - right.startedAt)
  return { records: list, stacks }
}
