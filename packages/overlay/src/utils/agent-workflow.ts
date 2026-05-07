import type { CardNode, CardStatus } from "../store/card-tree";
import type { TraceEvent } from "../services/trace";
import { normalizeAgentRole } from "./message";

export type AgentWorkflowStatus = "pending" | "running" | "idle" | "completed" | "error" | "skipped";

export interface AgentWorkflowReport {
  kind: string;
  summary: string;
  detail: string;
  ts: number;
  attempts?: number;
}

export interface AgentWorkflowRecord {
  id: string;
  sessionID: string;
  parentSessionID: string;
  agentName: string;
  stage: string;
  status: AgentWorkflowStatus;
  startedAt: number;
  completedAt?: number;
  attempts: number;
  depth: number;
  cardID?: string;
  goalID?: string;
  model?: string;
  report?: AgentWorkflowReport;
}

export interface AgentWorkflowStack {
  id: string;
  agentName: string;
  parentSessionID: string;
  depth: number;
  startedAt: number;
  records: AgentWorkflowRecord[];
}

export interface AgentWorkflowProjection {
  records: AgentWorkflowRecord[];
  stacks: AgentWorkflowStack[];
}

function sessionIDFromCardID(id: string): string {
  const marker = ":session:";
  const idx = id.indexOf(marker);
  return idx >= 0 ? id.slice(idx + marker.length) : "";
}

function normaliseStatus(status: CardStatus | string | undefined): AgentWorkflowStatus {
  const value = String(status || "").toLowerCase();
  if (value === "running") return "running";
  if (value === "idle") return "idle";
  if (value === "completed") return "completed";
  if (value === "error" || value === "failed") return "error";
  if (value === "skipped") return "skipped";
  return "pending";
}

function statusFromReport(kind: string, payload: Record<string, any>): AgentWorkflowStatus {
  if (kind === "agent_report_failure" || payload?.error) return "error";
  if (kind === "orchestrator_wake_failure") return "error";
  if (kind === "agent_report" || kind === "agent_report_retry_final" || kind === "orchestrator_wake") return "completed";
  return "pending";
}

function mergeStatus(current: AgentWorkflowStatus, next: AgentWorkflowStatus): AgentWorkflowStatus {
  const rank: Record<AgentWorkflowStatus, number> = {
    pending: 0,
    idle: 1,
    skipped: 2,
    running: 3,
    completed: 4,
    error: 5,
  };
  return rank[next] >= rank[current] ? next : current;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function summariseObject(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const item = value as Record<string, any>;
  const direct = firstString(
    item.summary,
    item.verdictSummary,
    item.finalSummary,
    item.result?.summary,
    item.output?.summary,
    item.message,
    item.error,
  );
  if (direct) return direct;
  const parts: string[] = [];
  if (Array.isArray(item.requirements)) parts.push(`${item.requirements.length} requirements`);
  if (Array.isArray(item.specs)) parts.push(`${item.specs.length} specs`);
  if (Array.isArray(item.goals)) parts.push(`${item.goals.length} goals`);
  if (Array.isArray(item.contracts)) parts.push(`${item.contracts.length} contracts`);
  if (Array.isArray(item.changedFiles)) parts.push(`${item.changedFiles.length} files changed`);
  if (Array.isArray(item.files)) parts.push(`${item.files.length} files`);
  if (Array.isArray(item.checks)) parts.push(`${item.checks.length} checks`);
  return parts.join(" · ");
}

function summariseReportPayload(payload: Record<string, any>): string {
  const explicit = firstString(payload.error, payload.finalText);
  if (explicit) return explicit;
  return firstString(
    summariseObject(payload.collector),
    summariseObject(payload.structured),
    payload.streamErrors?.length ? `${payload.streamErrors.length} stream errors` : "",
  );
}

function textFromPart(part: any): string {
  if (!part || typeof part !== "object") return "";
  if (part.type === "text" || part.type === "reasoning") return String(part.text || "").trim();
  return "";
}

function textFromCard(card: CardNode | undefined, cards: Record<string, CardNode>, seen = new Set<string>()): string {
  if (!card || seen.has(card.id)) return "";
  seen.add(card.id);
  const chunks: string[] = [];
  for (const part of card.parts || []) {
    const text = textFromPart(part);
    if (text) chunks.push(text);
  }
  for (const childID of card.childIDs || []) {
    const text = textFromCard(cards[childID], cards, seen);
    if (text) chunks.push(text);
  }
  return chunks.join("\n\n").trim();
}

function traceReport(event: TraceEvent): AgentWorkflowReport | undefined {
  const kind = String(event.kind || "");
  if (
    kind !== "agent_report" &&
    kind !== "agent_report_retry_final" &&
    kind !== "agent_report_failure" &&
    kind !== "orchestrator_wake" &&
    kind !== "orchestrator_wake_failure"
  ) {
    return undefined;
  }
  const payload = (event.payload || {}) as Record<string, any>;
  const attempts = Number(payload.attempts || 0);
  const summary = summariseReportPayload(payload);
  return {
    kind,
    ts: Number(event.ts || 0),
    summary: summary || "(no summary)",
    detail: compactJson(payload),
    ...(attempts > 0 ? { attempts } : {}),
  };
}

function ensureRecord(records: Map<string, AgentWorkflowRecord>, sessionID: string): AgentWorkflowRecord {
  const existing = records.get(sessionID);
  if (existing) return existing;
  const record: AgentWorkflowRecord = {
    id: sessionID,
    sessionID,
    parentSessionID: "",
    agentName: "assistant",
    stage: "assistant",
    status: "pending",
    startedAt: 0,
    attempts: 1,
    depth: 0,
  };
  records.set(sessionID, record);
  return record;
}

function applyTraceEvent(records: Map<string, AgentWorkflowRecord>, event: TraceEvent): void {
  const sessionID = typeof event.sessionID === "string" ? event.sessionID : "";
  if (!sessionID) return;
  const record = ensureRecord(records, sessionID);
  const agentName = firstString(event.agentName, record.agentName);
  record.agentName = agentName;
  record.stage = normalizeAgentRole(agentName);
  record.parentSessionID = firstString(event.parentSessionID, record.parentSessionID);
  const ts = Number(event.ts || 0);
  if (ts > 0) {
    record.startedAt = record.startedAt > 0 ? Math.min(record.startedAt, ts) : ts;
    record.completedAt = Math.max(record.completedAt || 0, ts);
  }
  if (event.kind === "llm_request") {
    const model = (event.payload || {}).model || {};
    const providerID = typeof model.providerID === "string" ? model.providerID : "";
    const modelID = typeof model.modelID === "string" ? model.modelID : "";
    record.model = providerID && modelID ? `${providerID}/${modelID}` : firstString(modelID, providerID, record.model);
    record.status = mergeStatus(record.status, "running");
  }
  const report = traceReport(event);
  if (report) {
    record.report = report;
    record.attempts = Math.max(record.attempts, report.attempts || 1);
    record.status = mergeStatus(record.status, statusFromReport(String(event.kind || ""), (event.payload || {}) as Record<string, any>));
  }
}

function applyCardRecord(
  records: Map<string, AgentWorkflowRecord>,
  card: CardNode,
  cards: Record<string, CardNode>,
): void {
  if (card.kind !== "agent" && card.kind !== "phase") return;
  const sessionID = card.kind === "phase" ? String(card.phaseSessionID || "") : sessionIDFromCardID(card.id);
  if (!sessionID) return;
  const record = ensureRecord(records, sessionID);
  record.cardID = card.id;
  record.goalID = card.goalID || record.goalID;
  record.agentName = firstString(card.stage, record.agentName);
  record.stage = normalizeAgentRole(record.agentName);
  record.status = mergeStatus(record.status, normaliseStatus(card.status));
  if (typeof card.time === "number" && card.time > 0) {
    record.startedAt = record.startedAt > 0 ? Math.min(record.startedAt, card.time) : card.time;
  }
  if (!record.report) {
    const summary = textFromCard(card, cards);
    if (summary) {
      record.report = {
        kind: "card_output",
        ts: record.completedAt || record.startedAt || 0,
        summary,
        detail: summary,
      };
    }
  }
}

function applyDepth(records: Map<string, AgentWorkflowRecord>): void {
  const visiting = new Set<string>();
  const memo = new Map<string, number>();
  const depthOf = (sessionID: string): number => {
    if (memo.has(sessionID)) return memo.get(sessionID)!;
    if (visiting.has(sessionID)) return 0;
    visiting.add(sessionID);
    const parent = records.get(sessionID)?.parentSessionID || "";
    const depth = parent && records.has(parent) ? depthOf(parent) + 1 : 0;
    visiting.delete(sessionID);
    memo.set(sessionID, depth);
    return depth;
  };
  for (const record of records.values()) {
    record.depth = depthOf(record.sessionID);
  }
}

export function buildAgentWorkflow(input: {
  cards: Record<string, CardNode>;
  order: string[];
  traceEvents: TraceEvent[];
}): AgentWorkflowProjection {
  const records = new Map<string, AgentWorkflowRecord>();
  for (const event of input.traceEvents || []) applyTraceEvent(records, event);
  for (const cardID of input.order || []) {
    const card = input.cards[cardID];
    if (card) applyCardRecord(records, card, input.cards);
  }
  applyDepth(records);
  const list = [...records.values()]
    .filter((record) => record.sessionID && record.startedAt > 0)
    .sort((left, right) => left.startedAt - right.startedAt);
  const stackMap = new Map<string, AgentWorkflowStack>();
  for (const record of list) {
    const key = `${record.parentSessionID || "root"}::${normalizeAgentRole(record.agentName)}`;
    const existing = stackMap.get(key);
    if (existing) {
      existing.records.push(record);
      existing.startedAt = Math.min(existing.startedAt, record.startedAt);
      existing.depth = Math.min(existing.depth, record.depth);
    } else {
      stackMap.set(key, {
        id: key,
        agentName: record.agentName,
        parentSessionID: record.parentSessionID,
        depth: record.depth,
        startedAt: record.startedAt,
        records: [record],
      });
    }
  }
  const stacks = [...stackMap.values()]
    .map((stack) => ({
      ...stack,
      records: stack.records.slice().sort((left, right) => left.startedAt - right.startedAt),
    }))
    .sort((left, right) => left.startedAt - right.startedAt);
  return { records: list, stacks };
}
