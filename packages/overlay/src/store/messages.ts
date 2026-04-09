// ── Message Store ──
// Solid reactive store for conversation messages, agent events, and SSE state.

import { createStore, produce, reconcile } from "solid-js/store";
import { batch, createMemo, createRoot } from "solid-js";
import { apiJson, apiUrl } from "../services/api";
import { boardStore } from "../store/board";
import { clearConversationUiState } from "./conversation-ui";
import { touchReasoningPart as trackReasoningPart } from "./reasoning";
import { syncSectionPhases } from "../utils/section";
import { devWarn, devError } from "../utils/dev-error";

// ── Types ──

export interface MessageInfo {
  id: string;
  sessionID: string;
  role: string;
  agent?: string;
  time?: { created?: number; updated?: number; completed?: number };
  [key: string]: any;
}

export interface Part {
  id: string;
  type: string;
  text?: string;
  tool?: string;
  state?: any;
  sessionID?: string;
  messageID?: string;
  [key: string]: any;
}

export interface Message {
  info: MessageInfo;
  parts: Part[];
  _synthetic?: boolean;
}

export interface AgentCardMessage {
  _synthetic: true;
  _agentCard: true;
  _agentStage: string;
  _agentStatus: string;
  _agentRound: number;
  _agentCardKey: string;
  _agentMessages: any[];
  _agentGoalGroup?: true;
  _agentGoalID?: string;
  _agentGoalTitle?: string;
  _agentGoalStatus?: string;
  _agentGoalDescription?: string;
  _agentGoalSteps?: Array<{ stepID: string; label: string; status: string; summary?: string }>;
  _agentContracts?: Array<{ key: string; value: string; reason?: string }>;
  _agentInternalCards?: AgentCardMessage[];
  info: MessageInfo;
  parts: Part[];
}

// ── Store ──

const [store, setStore] = createStore({
  messages: [] as Message[],
  agentEvents: [] as any[],
  selectedTaskID: "" as string,
  showTranscriptDetails: false,
  agentStatus: null as any,
  sseConnected: false,
  /** @deprecated No longer used — kept only for store shape compatibility. */
  conversationUpdatedAt: 0 as number,
 // ── Chat request / attachments (mirrors state.chatRequest / state.chatAttachments) ──
  /** AbortController for the active chat HTTP request; null when idle */
  chatRequest: null as AbortController | null,
  /** File attachments staged for the next chat message */
  chatAttachments: [] as any[],
});

export { store as messageStore };

// ── O(1) message lookup ──

const messageIndex = new Map<string, Message>();
// Buffer for parts that arrive before their parent message.updated event.
const _pendingParts = new Map<string, any[]>();

function rebuildMessageIndex() {
  messageIndex.clear();
  for (const msg of store.messages) {
    if (msg?.info?.id) messageIndex.set(msg.info.id, msg);
  }
}

export function messageById(id: string): Message | undefined {
  return messageIndex.get(id);
}

// ── Sorting ──

const UNTIMED_MESSAGE_ORDER = Number.MAX_SAFE_INTEGER;

function finiteMessageTime(item: Message | undefined): number | undefined {
  const created = item?.info?.time?.created;
  if (Number.isFinite(created)) return Number(created);
  const updated = item?.info?.time?.updated;
  if (Number.isFinite(updated)) return Number(updated);
  return undefined;
}

function messageOrderTime(item: Message): number {
  return finiteMessageTime(item) ?? UNTIMED_MESSAGE_ORDER;
}

/** @deprecated Use finiteMessageTime or messageOrderTime instead */
function messageTime(item: Message): number {
  return finiteMessageTime(item) ?? 0;
}

function sortMessages(list: Message[]): Message[] {
  // V8 Array.sort is stable since ES2019 — no need for index-based tie-breaking.
  // Single slice instead of slice + 2× map.
  const result = list.slice();
  result.sort((a, b) => messageOrderTime(a) - messageOrderTime(b));
  return result;
}

/** Append message in sorted position. Fast path: if newer than last, just push. */
function insertSorted(msgs: Message[], msg: Message): number {
  const t = messageOrderTime(msg);
  // Fast path: normal chronological append (most common case)
  if (msgs.length === 0 || messageOrderTime(msgs[msgs.length - 1]) <= t) {
    msgs.push(msg);
    return msgs.length - 1;
  }
  // Slow path: out-of-order arrival (SSE replay, cross-session), binary search
  let lo = 0, hi = msgs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (messageOrderTime(msgs[mid]) <= t) lo = mid + 1;
    else hi = mid;
  }
  msgs.splice(lo, 0, msg);
  return lo;
}

function mergeMessageInfo(
  existing: MessageInfo | undefined,
  next: MessageInfo,
): MessageInfo {
  const existingTime = existing?.time;
  const nextTime = next?.time;
  const createdCandidates = [existingTime?.created, nextTime?.created]
    .filter((value): value is number => Number.isFinite(value));
  const updatedCandidates = [existingTime?.updated, nextTime?.updated]
    .filter((value): value is number => Number.isFinite(value));
  const completedCandidates = [existingTime?.completed, nextTime?.completed]
    .filter((value): value is number => Number.isFinite(value));

  const time: MessageInfo["time"] = {};
  if (createdCandidates.length > 0) time.created = Math.min(...createdCandidates);
  if (updatedCandidates.length > 0) time.updated = Math.max(...updatedCandidates);
  if (completedCandidates.length > 0) time.completed = Math.max(...completedCandidates);

  return {
    ...(existing || {}),
    ...next,
    time,
  };
}

function record(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (!record(value)) return JSON.stringify(String(value));
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function hashText(value: string): string {
  const text = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function partSignature(part: any): string {
  return stableStringify({
    type: part?.type || "",
    text: part?.text || "",
    tool: part?.tool || "",
    kind: part?.kind || "",
    source: part?.source || "",
    filename: part?.filename || "",
    url: part?.url || "",
    mime: part?.mime || part?.mediaType || "",
    callID: part?.callID || "",
    description: part?.description || "",
    prompt: part?.prompt || "",
    audience: record(part?.audience) ? part.audience : null,
    state: record(part?.state) ? part.state : part?.state ?? null,
    files: Array.isArray(part?.files) ? part.files : [],
    process: record(part?.process) ? part.process : null,
  });
}

function messageSignature(message: any): string {
  const info = record(message?.info) ? message.info : {};
  return stableStringify({
    role: info.role || "",
    agent: info.agent || "",
    sessionID: info.sessionID || "",
    taskID: info.taskID || "",
    time: {
      created: info.time?.created || 0,
      updated: info.time?.updated || 0,
      completed: info.time?.completed || 0,
    },
    parts: Array.isArray(message?.parts)
      ? message.parts.map((part: any) => partSignature(part))
      : [],
  });
}

function normalizeLoadedPart(
  input: any,
  messageID: string,
  sessionID: string,
  index: number,
): Part {
  const part: Record<string, any> = record(input) ? { ...input } : { type: "text", text: String(input || "") };
  const id =
    typeof part.id === "string" && part.id.trim()
      ? part.id.trim()
      : `loaded-part:${messageID}:${index}:${hashText(partSignature(part))}`;
  return {
    ...part,
    id,
    messageID:
      typeof part.messageID === "string" && part.messageID.trim()
        ? part.messageID.trim()
        : messageID,
    sessionID:
      typeof part.sessionID === "string" && part.sessionID.trim()
        ? part.sessionID.trim()
        : sessionID,
  } as Part;
}

function normalizeLoadedMessage(input: any): Message {
  const message = record(input) ? input : {};
  const info = record(message.info) ? message.info : {};
  const signature = messageSignature(message);
  const id =
    typeof info.id === "string" && info.id.trim()
      ? info.id.trim()
      : `loaded-msg:${hashText(signature)}`;
  const sessionID =
    typeof info.sessionID === "string" && info.sessionID.trim()
      ? info.sessionID.trim()
      : "";
  const parts = Array.isArray(message.parts)
    ? message.parts.map((part: any, index: number) =>
        normalizeLoadedPart(part, id, sessionID, index),
      )
    : [];
  return {
    ...message,
    info: {
      ...info,
      id,
      sessionID,
      role:
        typeof info.role === "string" && info.role.trim()
          ? info.role.trim()
          : "assistant",
    },
    parts,
  };
}

export function normalizeLoadedMessages(messages: any[]): Message[] {
  return (Array.isArray(messages) ? messages : []).map((message) =>
    normalizeLoadedMessage(message),
  );
}

export function mergeLoadedConversationMessages(
  left: any[],
  right: any[],
): Message[] {
  const seen = new Set<string>();
  const result: any[] = [];
  for (const item of [
    ...(Array.isArray(left) ? left : []),
    ...(Array.isArray(right) ? right : []),
  ]) {
    const info = record(item?.info) ? item.info : {};
    const key =
      typeof info.id === "string" && info.id.trim()
        ? `id:${info.id.trim()}`
        : `sig:${messageSignature(item)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return normalizeLoadedMessages(result);
}

import { normalizeAgentRole, AGENT_CARD_STAGES, classifyMessage } from "../utils/message";
import { rootTaskSessionID } from "../store/board";

const MAX_LIVE_AGENT_MESSAGES = 12;

type AgentRound = {
  channelID: string;
  stage: string;
  sessionID: string;
  messages: any[];
  startTime: number;
  endTime: number;
};

/** Active pipeline stages — derived from session messages with running tool parts. */
export function activeAgentStages(): Set<string> {
  const status = String(boardStore.board?.task?.status || "").trim().toLowerCase();
  if (status !== "active") return new Set();
  const stages = new Set<string>();
  for (const msg of store.messages) {
    const role = normalizeAgentRole(String(msg?.info?.resolvedRole || msg?.info?.channel || ""));
    if (!AGENT_CARD_STAGES.has(role as any)) continue;
    const hasRunning = (msg.parts || []).some((p: any) => p?.state?.status === "running");
    if (hasRunning) stages.add(role);
  }
  return stages;
}

function messageEndTime(message: any): number {
  return Number(
    message?.info?.time?.completed || message?.info?.time?.updated || messageTime(message),
  );
}

function agentEventTime(event: any): number {
  return Number(event?.time?.created || event?.timestamp || 0);
}

function agentEventDisplayText(event: any): string {
  const live = typeof event?._liveText === "string" ? event._liveText : "";
  if (live) return live;
  const target = typeof event?._targetText === "string" ? event._targetText : "";
  if (target) return target;
  if (typeof event?.text === "string" && event.text) return event.text;
  if (typeof event?.summary === "string" && event.summary) return event.summary;
  return "";
}

function agentEventToolName(event: any): string {
  if (typeof event?.toolName === "string" && event.toolName.trim()) return event.toolName.trim();
  const summary = String(event?.summary || "");
  const split = summary.split("→");
  return split.length > 1 ? String(split[split.length - 1] || "").trim() : "";
}

function agentEventToolPart(event: any): any | null {
  const tool = agentEventToolName(event);
  if (!tool) return null;
  const created = agentEventTime(event) || Date.now();
  const id = typeof event?.id === "string" && event.id ? event.id : `tool:${tool}:${created}`;
  const kind = String(event?.kind || "").trim().toLowerCase();
  const status =
    kind === "tool_result"
      ? "completed"
      : kind === "error"
        ? "error"
        : "running";
  const summary = agentEventDisplayText(event).trim() || tool;
  return {
    id: `agent-tool:${id}`,
    type: "tool",
    callID: id,
    tool,
    state: {
      status,
      input: {},
      ...(status === "completed" ? { output: summary, title: tool } : {}),
      ...(status === "error" ? { error: summary } : {}),
      ...(status === "running"
        ? {
            title: summary,
            metadata: { synthetic: true },
            time: { start: created },
          }
        : {}),
    },
  };
}

// Cache live agent messages by content-key to maintain referential stability
// for Solid's `<For>`, which tracks items by reference.
const _agentMsgCache = new Map<string, any>();

function agentMessage(event: any): any | null {
  if (!event || typeof event !== "object") return null;
  const stage = String(event?.stage || "").trim().toLowerCase();
  if (!stage) return null;
  const created = agentEventTime(event) || Date.now();
  const eventID =
    typeof event?.id === "string" && event.id
      ? event.id
      : `${stage}:${String(event?.kind || "status")}:${created}`;
  const kind = String(event?.kind || "status").trim().toLowerCase();
  const text = agentEventDisplayText(event).trim();
  const msgID = `agent-event:${stage}:${eventID}`;
  const cacheKey = `${msgID}:${kind}:${text}`;
  const cached = _agentMsgCache.get(cacheKey);
  if (cached) return cached;
  const resolvedRole = normalizeAgentRole(stage);
  const base = {
    _synthetic: true,
    info: {
      id: msgID,
      role: "assistant",
      resolvedRole,
      agent: stage,
      time: { created },
    },
    parts: [] as any[],
  };

  let msg: any = null;

  if (kind === "reasoning_delta" && text) {
    msg = {
      ...base,
      parts: [
        {
          id: `reasoning:${eventID}`,
          type: "reasoning",
          text,
          _targetText: typeof event?._targetText === "string" ? event._targetText : text,
        },
      ],
    };
  } else if (kind === "tool_call" || kind === "tool_delta" || kind === "tool_result") {
    const part = agentEventToolPart(event);
    msg = part ? { ...base, parts: [part] } : null;
  } else if (text) {
    msg = {
      ...base,
      parts: [
        {
          id: `text:${eventID}`,
          type: "text",
          text,
          _targetText: typeof event?._targetText === "string" ? event._targetText : text,
        },
      ],
    };
  }

  if (msg) _agentMsgCache.set(cacheKey, msg);
  return msg;
}

function agentRoundStatus(
  stage: string,
  round: AgentRound,
  roundIndex: number,
  rounds: AgentRound[],
  latestStageEvent: any,
): string {
  if (roundIndex < rounds.length - 1) return "completed";
  const active = activeAgentStages().has(stage);
  const latestKind = String(latestStageEvent?.kind || "").trim().toLowerCase();
  const latestSummary = String(latestStageEvent?.summary || "");
  if (latestKind === "error") return "error";
  if (latestKind === "status" && /finished|completed|done/i.test(latestSummary)) {
    return "completed";
  }
  if (active) return "running";
  return "completed";
}

/**
 * Merge consecutive reasoning_delta events into a single accumulated event.
 * Prevents fragmented rendering where each token appears as a separate message.
 */
function mergeAgentReasoningDeltas(events: any[]): any[] {
  const result: any[] = [];
  let accum: any = null;
  for (const event of events) {
    const kind = String(event?.kind || "").trim().toLowerCase();
    if (kind === "reasoning_delta") {
      if (!accum) {
        accum = { ...event };
      } else {
        const prev = String(accum._targetText || accum.summary || accum.text || "");
        const delta = String(event._targetText || event.summary || event.text || "");
        const merged = prev + delta;
        accum._targetText = merged;
        accum.summary = merged;
        if (typeof accum.text === "string") accum.text = merged;
        if (event.time?.created > (accum.time?.created || 0)) accum.time = event.time;
      }
    } else {
      if (accum) { result.push(accum); accum = null; }
      result.push(event);
    }
  }
  if (accum) result.push(accum);
  return result;
}

// ── Agent cards: reactive derivation ──
// agentCards is a pure computation derived from store.messages, store.agentEvents,
// boardStore.board (goal titles), and rootTaskSessionID(). Solid's reactive graph
// guarantees that consumers always see a consistent snapshot — no manual rebuild
// calls, no timing gaps between source updates and derived state.

function computeAgentCards(): { cards: Record<string, AgentCardMessage>; order: string[] } {
  const roundsByStage: Record<string, AgentRound[]> = {};
  const latestEventByStage = new Map<string, any>();

  const rootSID = rootTaskSessionID();
  for (const message of store.messages) {
    const stage = message.info?.channel || classifyMessage(message, rootSID);
    if (stage === "main" || stage === "filtered") continue;
    // Skip user-role messages inside agent cards — they are internal orchestrator
    // prompts (goal prompts, trigger messages), never actual user input.
    if (String(message.info?.role || "").toLowerCase() === "user") continue;
    const sessionID =
      typeof message?.info?.sessionID === "string" ? message.info.sessionID.trim() : "";
    const fallbackID =
      typeof message?.info?.id === "string" && message.info.id ? message.info.id : hashText(messageSignature(message));
    const channelID = sessionID
      ? `${stage}:session:${sessionID}`
      : `${stage}:message:${fallbackID}`;
    const round = roundsByStage[stage] || [];
    let entry = round.find((item) => item.channelID === channelID);
    if (!entry) {
      entry = {
        channelID,
        stage,
        sessionID,
        messages: [],
        startTime: Infinity,
        endTime: 0,
      };
      round.push(entry);
      roundsByStage[stage] = round;
    }
    entry.messages.push(message);
    const created = finiteMessageTime(message) ?? Infinity;
    if (created < entry.startTime) entry.startTime = created;
    const completed = messageEndTime(message);
    if (completed > entry.endTime) entry.endTime = completed;
  }

  const liveEventsByStage = new Map<string, any[]>();
  for (const event of store.agentEvents) {
    const stage = String(event?.stage || "").trim().toLowerCase();
    if (!stage) continue;
    const stageEvents = liveEventsByStage.get(stage) || [];
    stageEvents.push(event);
    liveEventsByStage.set(stage, stageEvents);
    latestEventByStage.set(stage, event);
  }

  for (const [stage, events] of liveEventsByStage) {
    if ((roundsByStage[stage]?.length ?? 0) > 0) continue;
    const merged = mergeAgentReasoningDeltas(
      events
        .slice()
        .sort((left, right) => agentEventTime(left) - agentEventTime(right)),
    );
    const messages = merged
      .map((event) => agentMessage(event))
      .filter((message): message is Message => !!message);
    if (messages.length === 0) continue;
    const startTime = agentEventTime(merged[0]);
    const endTime = agentEventTime(merged[merged.length - 1]);
    roundsByStage[stage] = [{
      channelID: `${stage}:live`,
      stage,
      sessionID: "",
      messages,
      startTime: Number.isFinite(startTime) && startTime > 0 ? startTime : Date.now(),
      endTime: Number.isFinite(endTime) && endTime > 0 ? endTime : Date.now(),
    }];
  }

  // ── Goal group assembly ──
  // Board-driven: use goalWorkflows + lanes for goal info & sessionID→goalID mapping.
  // Executor messages are matched to goals via sessionID.
  // Other per-goal stages (planner, evaluator) use message goalID (bridge-stamped).
  // All per-goal stages are collected into goal group cards.
  // Task-scope stages (goal/decompose, architect, delivery, spec) stay standalone.

  const PER_GOAL_STAGES = new Set(["planner", "executor", "evaluator"]);

  // Build sessionID→goalID + goalID→info maps from board data
  const sessionToGoal = new Map<string, string>();
  const goalInfoMap = new Map<string, { id: string; title: string; status: string }>();
  const goalIndexMap = new Map<string, number>();

  for (let i = 0; i < (boardStore.board?.goalWorkflows || []).length; i++) {
    const gw = boardStore.board!.goalWorkflows![i];
    goalInfoMap.set(gw.goalID, { id: gw.goalID, title: gw.goalTitle, status: gw.goalStatus });
    goalIndexMap.set(gw.goalID, i + 1);
  }
  const goalsLane = (boardStore.board?.lanes || []).find((l: any) => l.id === "goals");
  for (const card of goalsLane?.cards || []) {
    if (!goalInfoMap.has(card.id)) {
      goalInfoMap.set(card.id, { id: card.id, title: card.title || "", status: card.status || "pending" });
    }
    const sid = card?.metadata?.sessionID;
    if (typeof sid === "string" && sid) {
      sessionToGoal.set(sid, card.id);
    }
    // Also map executorSessionID (the opencode executor's native session)
    const exSid = card?.metadata?.executorSessionID;
    if (typeof exSid === "string" && exSid) {
      sessionToGoal.set(exSid, card.id);
    }
  }

  // Ensure every goal in goalInfoMap has an index — goals from goalsLane
  // that aren't in goalWorkflows (e.g. no workflow state) need a sequential
  // index so the UI can display Goal#N.
  {
    let nextIdx = goalIndexMap.size > 0 ? Math.max(...goalIndexMap.values()) + 1 : 1;
    for (const [gid] of goalInfoMap) {
      if (!goalIndexMap.has(gid)) {
        goalIndexMap.set(gid, nextIdx++);
      }
    }
  }

  /** Resolve goalID for a round: session mapping (executor) → message goalID (bridge) → "" */
  function resolveGoalID(round: AgentRound): string {
    // 1. Session-based (from board lanes, reliable for executor)
    if (round.sessionID && sessionToGoal.has(round.sessionID)) {
      return sessionToGoal.get(round.sessionID)!;
    }
    // 2. Message-based (bridge-stamped goalID, for planner/evaluator)
    for (const msg of round.messages) {
      const gid = typeof msg?.info?.goalID === "string" ? msg.info.goalID : "";
      if (gid) return gid;
    }
    return "";
  }

  const nextCards: Record<string, AgentCardMessage> = {};
  const nextOrder: string[] = [];

  function buildCard(
    stage: string,
    round: AgentRound,
    roundLabel: number,
    status: string,
  ): AgentCardMessage {
    let created = round.startTime;
    if (!Number.isFinite(created) || created <= 0) {
      devError("store/messages.ts:buildCard", `${stage} round has invalid startTime=${created}, channelID=${round.channelID}. Using Date.now().`);
      created = Date.now();
    }
    return {
      _synthetic: true,
      _agentCard: true,
      _agentStage: stage,
      _agentStatus: status,
      _agentRound: roundLabel,
      _agentCardKey: round.channelID,
      _agentMessages: round.messages
        .slice()
        .sort((left, right) => messageOrderTime(left) - messageOrderTime(right)),
      info: {
        id: `agent-card:${round.channelID}`,
        role: "agent-card",
        agent: stage,
        sessionID: round.sessionID,
        time: { created },
      },
      parts: [],
    };
  }

  // Collect per-goal step cards: goalID → step entries
  const goalStepCards = new Map<string, { stage: string; card: AgentCardMessage; startTime: number }[]>();

  for (const [stage, rounds] of Object.entries(roundsByStage)) {
    rounds.sort((left, right) => left.startTime - right.startTime);

    if (PER_GOAL_STAGES.has(stage)) {
      for (let index = 0; index < rounds.length; index += 1) {
        const round = rounds[index];
        const gid = resolveGoalID(round);
        const roundLabel = rounds.length > 1 ? index + 1 : 0;
        const status = agentRoundStatus(stage, round, index, rounds, latestEventByStage.get(stage));
        const card = buildCard(stage, round, roundLabel, status);

        if (gid) {
          const entries = goalStepCards.get(gid) || [];
          entries.push({ stage, card, startTime: round.startTime });
          goalStepCards.set(gid, entries);
        } else {
          // No goal association — data integrity error. Skip standalone card.
          devError(
            "store/messages.ts:resolveGoalID",
            `${stage} round has no goal mapping — sessionID=${round.sessionID}, msgs=${round.messages.length}, channelID=${round.channelID}. Skipped.`,
          );
        }
      }
    } else {
      // Task-scope stages: standalone cards
      for (let index = 0; index < rounds.length; index += 1) {
        const round = rounds[index];
        const roundLabel = rounds.length > 1 ? index + 1 : 0;
        const status = agentRoundStatus(stage, round, index, rounds, latestEventByStage.get(stage));
        const cardID = round.channelID;
        nextCards[cardID] = buildCard(stage, round, roundLabel, status);
        nextOrder.push(cardID);
      }
    }
  }

  // Build goal group cards — board-driven: every goal from board gets a card,
  // even if no planner/executor/evaluator messages have arrived yet.
  // Look up goal descriptions from board lanes
  const goalDescMap = new Map<string, string>();
  for (const gc of goalsLane?.cards || []) {
    const desc = gc.detail || gc.description;
    if (gc.id && desc) goalDescMap.set(gc.id, desc);
  }

  // Build per-goal step info from goalWorkflows
  const goalStepsMap = new Map<string, Array<{ stepID: string; label: string; status: string; summary?: string }>>();
  for (const gw of boardStore.board?.goalWorkflows || []) {
    goalStepsMap.set(gw.goalID, (gw.steps || []).map((s: any) => ({
      stepID: s.stepID, label: s.label, status: s.status, summary: s.summary,
    })));
  }

  // Per-goal contracts from goalWorkflows (architect decisions from Decision Log)
  const goalContractsMap = new Map<string, Array<{ key: string; value: string; reason?: string }>>();
  for (const gw of boardStore.board?.goalWorkflows || []) {
    if (Array.isArray(gw.contracts) && gw.contracts.length > 0) {
      goalContractsMap.set(gw.goalID, gw.contracts);
    }
  }

  // Ensure every board goal has an entry in goalStepCards (may be empty)
  for (const [gid] of goalInfoMap) {
    if (!goalStepCards.has(gid)) goalStepCards.set(gid, []);
  }

  for (const [gid, entries] of goalStepCards) {
    entries.sort((a, b) => a.startTime - b.startTime);
    const goalInfo = goalInfoMap.get(gid);
    const groupKey = `goal-group:${gid}`;

    if (!goalInfo) {
      devWarn("store/messages.ts:goalGroup", `goal ${gid}: no goalInfo in board — title/status empty`);
    }
    if (goalInfo && !goalInfo.title) {
      devWarn("store/messages.ts:goalGroup", `goal ${gid}: goalInfo exists but title is empty`);
    }

    let groupStart: number;
    if (entries.length > 0) {
      groupStart = Math.min(...entries.map(e => e.startTime));
    } else {
      devWarn("store/messages.ts:goalGroup", `goal ${gid}: no step entries, using Date.now() for timestamp`);
      groupStart = Date.now();
    }

    const groupStatus = entries.length === 0
      ? (goalInfo?.status === "passed" || goalInfo?.status === "failed" ? goalInfo.status : "pending")
      : entries.some(e => e.card._agentStatus === "running")
        ? "running"
        : entries.some(e => e.card._agentStatus === "error")
          ? "error"
          : "completed";

    if (!goalInfo?.status && groupStatus !== "pending") {
      devWarn("store/messages.ts:goalGroup", `goal ${gid}: goalInfo.status missing, derived groupStatus=${groupStatus}`);
    }

    const goalSessionID = entries[0]?.card.info.sessionID;
    if (!goalSessionID) {
      devWarn("store/messages.ts:goalGroup", `goal ${gid}: no sessionID from step entries`);
    }

    let groupCreated = groupStart;
    if (!Number.isFinite(groupCreated) || groupCreated <= 0) {
      devError("store/messages.ts:goalGroup", `goal ${gid}: invalid groupStart=${groupStart}, using Date.now()`);
      groupCreated = Date.now();
    }

    nextCards[groupKey] = {
      _synthetic: true,
      _agentCard: true,
      _agentGoalGroup: true,
      _agentGoalID: gid,
      _agentGoalTitle: goalInfo?.title ?? "",
      _agentGoalStatus: goalInfo?.status ?? groupStatus,
      _agentGoalDescription: goalDescMap.get(gid) ?? "",
      _agentGoalSteps: goalStepsMap.get(gid),
      _agentContracts: goalContractsMap.get(gid),
      _agentInternalCards: entries.map(e => e.card),
      _agentStage: "executor",
      _agentStatus: groupStatus,
      _agentRound: goalIndexMap.get(gid) ?? 0,
      _agentCardKey: groupKey,
      _agentMessages: [],
      info: {
        id: `agent-card:${groupKey}`,
        role: "agent-card",
        agent: "executor",
        sessionID: goalSessionID ?? "",
        time: { created: groupCreated },
      },
      parts: [],
    };
    nextOrder.push(groupKey);
  }

  // Task-scope stage priority: architect before goal (decompose).
  // Other stages (executor goal groups, etc.) fall through to chronological order.
  const TASK_STAGE_PRIORITY: Record<string, number> = { spec: 0, architect: 1, goal: 2 };

  nextOrder.sort((left, right) => {
    const lCard = nextCards[left];
    const rCard = nextCards[right];
    const lPrio = TASK_STAGE_PRIORITY[lCard?._agentStage || ""];
    const rPrio = TASK_STAGE_PRIORITY[rCard?._agentStage || ""];
    // When both cards are task-scope stages with defined priority, use that order
    if (lPrio !== undefined && rPrio !== undefined && lPrio !== rPrio) {
      return lPrio - rPrio;
    }
    return messageOrderTime(lCard) - messageOrderTime(rCard) || left.localeCompare(right);
  });

  return { cards: nextCards, order: nextOrder };
}

// createRoot keeps the memo alive outside of a component tree (module-level singleton).
const agentCardsMemo = createRoot(() =>
  createMemo(computeAgentCards, { cards: {} as Record<string, AgentCardMessage>, order: [] as string[] }),
);

/** Reactive accessor: agent cards derived from messages + events + board. */
export function agentCards(): Record<string, AgentCardMessage> {
  return agentCardsMemo().cards;
}

/** Reactive accessor: ordered agent card IDs. */
export function agentCardOrder(): string[] {
  return agentCardsMemo().order;
}

// ── Full load from transcript ──

export async function syncTask(taskID: string) {
  if (!taskID) {
    clearMessages();
    clearAgentEvents();
    return;
  }
  try {
    const [transcript, timeline] = await Promise.all([
      apiJson(`task/${encodeURIComponent(taskID)}/transcript`).catch(() => []),
      apiJson(`control/timeline?taskID=${encodeURIComponent(taskID)}`).catch(
        () => [],
      ),
    ]);
    const messages = mergeLoadedConversationMessages(
      Array.isArray(timeline) ? timeline : [],
      Array.isArray(transcript) ? transcript : [],
    );
    setMessages(messages);
  } catch (e) {
    console.error("syncTask failed", e);
  }
}

// ── Conversation loading (.ts) ──

let _convLoading: Promise<void> | null = null;
let _convQueued = false;

function touchReasoningPart(part: any): any {
  if (!part || part.type !== "reasoning") return part;
  if (typeof part.text !== "string") part.text = "";
  trackReasoningPart(part);
  return part;
}

export async function loadConversation(): Promise<void> {
  if (!boardStore.selectedTaskID) {
    setMessages([]);
    clearAgentEvents();
    return;
  }
  if (_convLoading) {
    _convQueued = true;
    await _convLoading;
    return;
  }
  const requestTaskID = String(boardStore.selectedTaskID || "");
  const loading = (async () => {
    do {
      _convQueued = false;
      const taskID = String(boardStore.selectedTaskID || "");
      if (!taskID) {
        setMessages([]);
        return;
      }
      const transcript = await fetch(
        apiUrl(`task/${encodeURIComponent(taskID)}/transcript`),
        {
          headers: { Accept: "application/json" },
        },
      )
        .then((res) => (res.ok ? res.json() : []))
        .catch(() => []);
      const timeline = await fetch(
        apiUrl(`control/timeline?taskID=${encodeURIComponent(taskID)}`),
        {
          headers: { Accept: "application/json" },
        },
      )
        .then((res) => (res.ok ? res.json() : []))
        .catch(() => []);
      if (taskID !== boardStore.selectedTaskID) continue;
      const merged = mergeLoadedConversationMessages(
        Array.isArray(timeline) ? timeline : [],
        Array.isArray(transcript) ? transcript : [],
      ).map((message: any) => ({
        ...message,
        parts: Array.isArray(message?.parts)
          ? message.parts.map((part: any) => touchReasoningPart(part))
          : [],
      }));
      setMessages(merged);
      syncSectionPhases(boardStore.board, boardStore.changes.length);
    } while (_convQueued && requestTaskID === boardStore.selectedTaskID);
  })();
  _convLoading = loading;
  try {
    await loading;
  } finally {
    if (_convLoading === loading) {
      _convLoading = null;
    }
  }
}

// ── Apply SSE events ──

export function applyMessageEvent(event: any): boolean {
  const type = event.type || "";
  const properties =
    typeof event?.properties === "object" &&
    event.properties &&
    !Array.isArray(event.properties)
      ? event.properties
      : typeof event?.payload === "object" &&
          event.payload &&
          !Array.isArray(event.payload)
        ? event.payload
        : {};

  if (type === "message.updated") {
    const info = properties.info;
    if (!info?.id) return false;
    const existing = messageById(info.id);
    if (existing) {
      const idx = store.messages.indexOf(existing);
      if (idx >= 0) {
        setStore("messages", idx, "info", mergeMessageInfo(existing.info, info));
      }
      return true;
    }
    // Flush any parts that arrived before this message
    const buffered = _pendingParts.get(info.id);
    if (buffered) _pendingParts.delete(info.id);
    const msg: Message = { info: mergeMessageInfo(undefined, info), parts: buffered || [] };
    let insertIdx = 0;
    setStore(
      "messages",
      produce((msgs: Message[]) => {
        insertIdx = insertSorted(msgs, msg);
      }),
    );
    messageIndex.set(info.id, store.messages[insertIdx]);
    return true;
  }

  if (type === "message.part.updated") {
    const part = properties.part;
    if (!part?.id || !part?.messageID) return false;
    let message = messageById(part.messageID);
    if (!message) {
      // Buffer: message.updated hasn't arrived yet. Store part for later.
      const buf = _pendingParts.get(part.messageID) || [];
      buf.push(part);
      _pendingParts.set(part.messageID, buf);
      return true;
    }
    const idx = store.messages.indexOf(message);
    const partIdx = message.parts.findIndex((p: Part) => p.id === part.id);
    if (partIdx >= 0) {
      setStore("messages", idx, "parts", partIdx, part);
    } else {
      setStore(
        "messages",
        idx,
        "parts",
        produce((parts: Part[]) => {
          parts.push(part);
        }),
      );
    }
    return true;
  }

  if (type === "message.part.delta") {
    if (typeof properties.delta !== "string") return false;
    if (properties.field !== "text" && properties.field !== "raw") return false;

    let message = messageById(properties.messageID);
    if (!message) {
      // Delta for unknown message — drop silently. The full part will arrive
      // via message.part.updated (persisted) when SSE reconnects or transcript loads.
      return false;
    }

    const msgIdx = store.messages.indexOf(message);
    const partIdx = message.parts.findIndex(
      (p: Part) => p.id === properties.partID,
    );

    if (properties.field === "raw") {
      if (partIdx < 0) return false;
      const part = message.parts[partIdx];
      if (part.type !== "tool" || !part.state) return false;
      setStore(
        "messages",
        msgIdx,
        "parts",
        partIdx,
        "state",
        "raw",
        (prev: string) => (prev || "") + properties.delta,
      );
      return true;
    }

 // text delta
    if (partIdx < 0) {
 // Create placeholder part
      setStore(
        "messages",
        msgIdx,
        "parts",
        produce((parts: Part[]) => {
          parts.push({
            id: properties.partID,
            type: "text",
            text: properties.delta,
            sessionID: properties.sessionID,
            messageID: properties.messageID,
          });
        }),
      );
      return true;
    }

    setStore(
      "messages",
      msgIdx,
      "parts",
      partIdx,
      "text",
      (prev: string) => (prev || "") + properties.delta,
    );
    return true;
  }

  return false;
}

// ── 16ms event batching ──

const FLUSH_INTERVAL = 50;
let eventQueue: any[] = [];
let flushTimer: any = null;
let lastFlushTime = 0;

export function enqueueEvent(event: any) {
  eventQueue.push(event);
  if (flushTimer) return;
  if (Date.now() - lastFlushTime < FLUSH_INTERVAL) {
    flushTimer = setTimeout(flushEvents, FLUSH_INTERVAL);
    return;
  }
  flushEvents();
}

/** Coalesce consecutive delta events for the same part before applying. */
function coalesceDeltas(events: any[]): any[] {
  if (events.length <= 1) return events;
  const out: any[] = [];
  for (const ev of events) {
    const p = ev?.properties;
    if (
      ev?.type === "message.part.delta" &&
      p?.field === "text" &&
      typeof p?.delta === "string" &&
      out.length > 0
    ) {
      const prev = out[out.length - 1];
      const pp = prev?.properties;
      if (
        prev?.type === "message.part.delta" &&
        pp?.field === "text" &&
        pp?.partID === p.partID &&
        pp?.messageID === p.messageID
      ) {
        pp.delta += p.delta;
        continue;
      }
    }
    out.push(ev);
  }
  return out;
}

function flushEvents() {
  if (eventQueue.length === 0) return;
  const events = coalesceDeltas(eventQueue);
  eventQueue = [];
  flushTimer = null;
  lastFlushTime = Date.now();
  batch(() => {
    for (const event of events) {
      applyMessageEvent(event);
    }
  });
}

export function clearEventQueue() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  eventQueue = [];
}

// ── Agent event helpers ──
// Merge and animate agent SSE events for agent card status tracking.

function displayString(value: any): string {
  return typeof value === "string" ? value.trim() : "";
}

function deltaString(value: any): string {
  return typeof value === "string" ? value : "";
}

function streamingAgentKind(kind: string): boolean {
  return kind === "message_delta" || kind === "reasoning_delta" || kind === "tool_delta";
}

function agentEventRecord(value: any): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

interface AgentEvent {
  id: string;
  eventID: string;
  taskID: string;
  stage: string;
  kind: string;
  toolName: string;
  text: string;
  summary: string;
  payload: Record<string, any>;
  time: { created: number };
  _targetText?: string;
  _liveText?: string;
  [key: string]: any;
}

const AGENT_LIVE_INTERVAL = 32;
const MAX_AGENT_EVENTS_PER_STAGE = 12;
const agentLiveTimers = new Map<string, ReturnType<typeof setTimeout>>();

function agentEventKey(event: Pick<AgentEvent, "stage" | "id"> | null | undefined): string {
  const stage = String(event?.stage || "").trim().toLowerCase();
  const id = String(event?.id || "").trim();
  return stage && id ? `${stage}:${id}` : "";
}

function stopAgentLiveTimer(key: string): void {
  const timer = agentLiveTimers.get(key);
  if (!timer) return;
  clearTimeout(timer);
  agentLiveTimers.delete(key);
}

function nextLiveLength(live: string, target: string): number {
  if (!target) return 0;
  if (!live) return Math.min(target.length, 1);
  const remaining = target.length - live.length;
  if (remaining <= 0) return target.length;
 // Avoid a long one-character tail when timers are slightly delayed.
  if (remaining <= 4) return target.length;
  return Math.min(target.length, live.length + Math.max(1, Math.ceil(remaining / 2)));
}

function advanceAgentLiveText(key: string): void {
  const index = store.agentEvents.findIndex(
    (item: any) => agentEventKey(item as AgentEvent) === key,
  );
  if (index < 0) {
    stopAgentLiveTimer(key);
    return;
  }
  const event = store.agentEvents[index] as AgentEvent;
  const target = typeof event?._targetText === "string" ? event._targetText : "";
  const live = typeof event?._liveText === "string" ? event._liveText : "";
  if (!target) {
    stopAgentLiveTimer(key);
    return;
  }
  if (live.length >= target.length) {
    if (live !== target) {
      setStore("agentEvents", index, "_liveText", target);
  
    }
    stopAgentLiveTimer(key);
    return;
  }
  setStore("agentEvents", index, "_liveText", target.slice(0, nextLiveLength(live, target)));
  agentLiveTimers.set(
    key,
    setTimeout(() => advanceAgentLiveText(key), AGENT_LIVE_INTERVAL),
  );
}

function scheduleAgentLiveText(event: AgentEvent): void {
  const key = agentEventKey(event);
  if (!key) return;
  const target = typeof event?._targetText === "string" ? event._targetText : "";
  const live = typeof event?._liveText === "string" ? event._liveText : "";
  if (!target || live.length >= target.length) {
    stopAgentLiveTimer(key);
    return;
  }
  if (agentLiveTimers.has(key)) return;
  agentLiveTimers.set(
    key,
    setTimeout(() => advanceAgentLiveText(key), AGENT_LIVE_INTERVAL),
  );
}

function agentEventTargetText(event: AgentEvent): string {
  if (!event) return "";
  const k = event.kind;
  if (k === "message_delta" || k === "reasoning_delta" || k === "status") {
    return deltaString(event.text ?? event.summary);
  }
  if (k === "tool_call" || k === "tool_delta") {
    return deltaString(event.text ?? event.payload?.text ?? event.summary);
  }
  if (k === "tool_result") {
    return displayString(
      event.payload?.output || event.payload?.result || event.summary,
    );
  }
  return displayString(event.summary);
}

function syncAgentText(event: AgentEvent): void {
  if (!event) return;
  const target = agentEventTargetText(event);
  const live = typeof event._liveText === "string" ? event._liveText : "";
  if (!target) {
    stopAgentLiveTimer(agentEventKey(event));
    delete event._targetText;
    delete event._liveText;
    return;
  }
  event._targetText = target;
  event._liveText = live || target;
}

function agentEventEntry(raw: any): AgentEvent | null {
  const payload = agentEventRecord(raw?.payload)
    ? raw.payload
    : agentEventRecord(raw?.properties)
      ? raw.properties
      : {};
  const stage = String(payload.stage || "")
    .trim()
    .toLowerCase();
  const taskID = String(payload.taskID || raw?.taskID || "")
    .trim();
  const kind = String(payload.kind || "status")
    .trim()
    .toLowerCase();
  const created = Number(raw?.timestamp || payload.timestamp || Date.now());
  const toolName =
    typeof payload.toolName === "string" && payload.toolName.trim()
      ? payload.toolName.trim()
      : typeof payload.name === "string" && payload.name.trim()
        ? payload.name.trim()
        : "";
  const text = streamingAgentKind(kind)
    ? deltaString(payload.text)
    : displayString(payload.text);
  const summary = streamingAgentKind(kind)
    ? deltaString(raw?.summary ?? payload.summary ?? text)
    : displayString(raw?.summary || payload.summary || text);
  const id =
    typeof payload.id === "string" && payload.id
      ? payload.id
      : typeof raw?.event_id === "string" && raw.event_id
        ? raw.event_id
        : `${stage}:${kind}:${toolName || "event"}:${created}`;
  if (!stage) return null;
  if (!summary && !text && !toolName) return null;
  return {
    id,
    eventID: typeof raw?.event_id === "string" ? raw.event_id : "",
    taskID,
    stage,
    kind,
    toolName,
    text,
    summary,
    payload,
    time: { created: Number.isFinite(created) ? created : Date.now() },
  };
}

function pruneAgentEvents(events: AgentEvent[]): AgentEvent[] {
  const byStage = new Map<string, AgentEvent[]>();
  for (const event of events) {
    const stageEvents = byStage.get(event.stage) || [];
    stageEvents.push(event);
    byStage.set(event.stage, stageEvents);
  }
  const kept = Array.from(byStage.values())
    .flatMap((stageEvents) => stageEvents.slice(-MAX_AGENT_EVENTS_PER_STAGE))
    .sort((a, b) => (a.time?.created || 0) - (b.time?.created || 0));
  const keys = new Set(kept.map((event) => agentEventKey(event)));
  for (const key of [...agentLiveTimers.keys()]) {
    if (!keys.has(key)) stopAgentLiveTimer(key);
  }
  return kept;
}

function mergeAgentEvent(existing: AgentEvent, next: AgentEvent): AgentEvent {
  if (!existing) return next;
  if (next.kind === "message_delta" || next.kind === "reasoning_delta") {
    const merged = `${deltaString(existing._targetText ?? existing.text ?? existing.summary)}${deltaString(next.text ?? next.summary)}`;
    return {
      ...existing,
      ...next,
      text: merged,
      summary: merged,
      payload: {
        ...(agentEventRecord(existing.payload) ? existing.payload : {}),
        ...(agentEventRecord(next.payload) ? next.payload : {}),
      },
    };
  }
  if (next.kind === "tool_delta") {
    const mergedText = `${deltaString(existing.text ?? existing.payload?.text ?? "")}${deltaString(next.text ?? next.payload?.text ?? next.summary)}`;
    return {
      ...existing,
      ...next,
      kind:
        existing.kind === "tool_result" ? "tool_result" : "tool_call",
      text: mergedText,
      summary: displayString(existing.summary || next.summary),
      payload: {
        ...(agentEventRecord(existing.payload) ? existing.payload : {}),
        ...(agentEventRecord(next.payload) ? next.payload : {}),
        text: mergedText,
      },
    };
  }
  if (next.kind === "tool_result") {
    return {
      ...existing,
      ...next,
      payload: {
        ...(agentEventRecord(existing.payload) ? existing.payload : {}),
        ...(agentEventRecord(next.payload) ? next.payload : {}),
        text: displayString(
          existing.payload?.text || existing.text || next.payload?.text || "",
        ),
      },
    };
  }
  return {
    ...existing,
    ...next,
    payload: {
      ...(agentEventRecord(existing.payload) ? existing.payload : {}),
      ...(agentEventRecord(next.payload) ? next.payload : {}),
    },
  };
}

function mergeAgentEventList(events: AgentEvent[], raw: any): AgentEvent[] {
  const event = agentEventEntry(raw);
  if (!event) return events;
  if (event.taskID && boardStore.selectedTaskID && event.taskID !== boardStore.selectedTaskID) {
    return events;
  }
  const index = events.findIndex(
    (item) => item.id === event.id && item.stage === event.stage,
  );
  const next: AgentEvent[] =
    index >= 0
      ? [
          ...events.slice(0, index),
          mergeAgentEvent(events[index], event),
          ...events.slice(index + 1),
        ]
      : [...events, event];
  const target = index >= 0 ? next[index] : next[next.length - 1];
  syncAgentText(target);
  return pruneAgentEvents(
    next.sort(
      (a, b) => (a.time?.created || 0) - (b.time?.created || 0),
    ),
  );
}

// ── 16ms agent event batching (mirrors message event batching) ──
let agentEventQueue: any[] = [];
let agentFlushTimer: any = null;
let agentLastFlush = 0;
const AGENT_FLUSH_INTERVAL = 16;

function flushAgentEvents(): void {
  if (agentEventQueue.length === 0) return;
  const queued = agentEventQueue;
  agentEventQueue = [];
  agentFlushTimer = null;
  agentLastFlush = Date.now();

  let merged = [...store.agentEvents] as AgentEvent[];
  for (const raw of queued) {
    merged = mergeAgentEventList(merged, raw);
  }
  setStore("agentEvents", reconcile(merged));

  // Schedule live text animation for each queued event
  for (const raw of queued) {
    const payload = agentEventRecord(raw?.payload)
      ? raw.payload
      : agentEventRecord(raw?.properties)
        ? raw.properties
        : {};
    const key = agentEventKey({
      stage: String(payload.stage || "").trim().toLowerCase(),
      id:
        typeof payload.id === "string" && payload.id
          ? payload.id
          : typeof raw?.event_id === "string"
            ? raw.event_id
            : "",
    } as Pick<AgentEvent, "stage" | "id">);
    const target = key
      ? merged.find((item) => agentEventKey(item as AgentEvent) === key) || null
      : null;
    if (target) scheduleAgentLiveText(target as AgentEvent);
  }
}

/** Incrementally merge a raw agent.updated SSE event into the agentEvents list. */
export function appendAgentEvent(raw: any): void {
  agentEventQueue.push(raw);
  if (agentFlushTimer) return;
  if (Date.now() - agentLastFlush < AGENT_FLUSH_INTERVAL) {
    agentFlushTimer = setTimeout(flushAgentEvents, AGENT_FLUSH_INTERVAL);
    return;
  }
  flushAgentEvents();
}

// ── Setters for ──

export function setAgentEvents(events: any[]) {
  for (const key of agentLiveTimers.keys()) {
    stopAgentLiveTimer(key);
  }
  const normalized = pruneAgentEvents(Array.isArray(events) ? events as AgentEvent[] : []);
  setStore("agentEvents", reconcile(normalized));
}

export function clearAgentEvents(): void {
  for (const key of [...agentLiveTimers.keys()]) {
    stopAgentLiveTimer(key);
  }
  setStore("agentEvents", []);
  _agentMsgCache.clear();
}

export function setMessages(messages: any[]) {
  const next = sortMessages(Array.isArray(messages) ? messages : []);
  setStore("messages", produce((msgs: Message[]) => {
    // Build lookup for new messages
    const nextById = new Map<string, Message>();
    for (const m of next) {
      const id = m?.info?.id;
      if (id) nextById.set(id, m);
    }

    // Remove messages no longer present
    for (let i = msgs.length - 1; i >= 0; i--) {
      const id = msgs[i]?.info?.id;
      if (!id || !nextById.has(id)) msgs.splice(i, 1);
    }

    // Build existing index
    const existingIdx = new Map<string, number>();
    for (let i = 0; i < msgs.length; i++) {
      const id = msgs[i]?.info?.id;
      if (id) existingIdx.set(id, i);
    }

    // Update existing or append new
    for (const m of next) {
      const id = m?.info?.id;
      if (!id) { msgs.push(m); continue; }
      const idx = existingIdx.get(id);
      if (idx !== undefined) {
        // Surgical update: only write changed properties
        const existing = msgs[idx];
        if (existing.info) Object.assign(existing.info, m.info);
        if (m.parts) {
          existing.parts.length = 0;
          existing.parts.push(...m.parts);
        }
      } else {
        msgs.push(m);
      }
    }

    // Re-sort in place
    msgs.sort((a, b) => messageOrderTime(a) - messageOrderTime(b));
  }));
  rebuildMessageIndex();
}

export function setSelectedTaskID(taskID: string) {
  if (store.selectedTaskID !== taskID) {
    clearConversationUiState();
    clearKnownChildSessions();
  }
  setStore("selectedTaskID", taskID);
}

export function setShowTranscriptDetails(show: boolean) {
  setStore("showTranscriptDetails", show);
}

export function setAgentStatus(status: any) {
  setStore("agentStatus", status);
}

export function setSseConnected(connected: boolean) {
  setStore("sseConnected", connected);
}

export function clearMessages() {
  setStore("messages", []);
  messageIndex.clear();
  _pendingParts.clear();
}

// ── Chat request helpers ──

/** Store the AbortController for an in-flight chat request. */
export function setChatRequest(req: AbortController | null): void {
  setStore("chatRequest", req ?? null);
}

/** Abort any active chat request and clear the stored controller. */
export function abortChatRequest(): void {
  const req = store.chatRequest;
  if (req) {
    try {
      req.abort();
    } catch (_) {
 // ignore abort errors
    }
  }
  setStore("chatRequest", null);
}

// ── Chat attachments helpers ──

export function setChatAttachments(attachments: any[]): void {
  setStore("chatAttachments", Array.isArray(attachments) ? attachments : []);
}

export function clearChatAttachments(): void {
  setStore("chatAttachments", []);
}

// ── Session utilities ──
// ── Session helpers ──

/**
 * Returns the sessionID of the currently selected task, preferring the board
 * task's sessionID and falling back to the task list entry for selectedTaskID.
 * Returns the sessionID of the currently active task.
 */
export function currentTaskSessionID(): string {
  const boardSession = boardStore.board?.task?.sessionID;
  if (typeof boardSession === "string" && boardSession) return boardSession;
  const taskID = store.selectedTaskID;
  if (!taskID) return "";
  const entry = boardStore.tasks.find(
    (item: any) => item?.task?.id === taskID,
  );
  return typeof entry?.task?.sessionID === "string"
    ? entry.task.sessionID
    : "";
}

/**
 * Alias for currentTaskSessionID.
 * Alias for currentTaskSessionID.
 */
export function currentSessionID(): string {
  return currentTaskSessionID();
}

function messageEventSessionID(event: any): string {
  const properties =
    typeof event?.properties === "object" &&
    event.properties &&
    !Array.isArray(event.properties)
      ? event.properties
      : typeof event?.payload === "object" &&
          event.payload &&
          !Array.isArray(event.payload)
        ? event.payload
        : {};
  if (typeof properties?.info?.sessionID === "string") {
    return properties.info.sessionID;
  }
  if (typeof properties?.part?.sessionID === "string") {
    return properties.part.sessionID;
  }
  return typeof properties?.sessionID === "string" ? properties.sessionID : "";
}

/**
 * Message deltas are only safe to apply incrementally once the selected task's
 * root session is known. Before that, the authoritative transcript + timeline
 * load must establish the conversation shape first.
 */
export function shouldReloadConversationForMessageEvent(event: any): boolean {
  const type = String(event?.type || "").trim();
  if (
    type !== "message.updated" &&
    type !== "message.part.updated" &&
    type !== "message.part.delta"
  ) {
    return false;
  }
  if (!store.selectedTaskID) return false;
  if (currentTaskSessionID()) return false;
  return !!messageEventSessionID(event);
}

// Module-private set to cache known child session IDs for O(1) lookup.
let _knownChildSessions: Set<string> | null = null;

/** Clear the known-child-sessions cache (call when task selection changes). */
export function clearKnownChildSessions(): void {
  _knownChildSessions = null;
}

/**
 * Returns true if the given sessionID belongs to the currently selected task
 * (including child/sub-agent sessions).
 * Check if a sessionID belongs to the current task's session tree.
 */
export function matchesCurrentSession(sessionID: string): boolean {
  if (!sessionID) return false;
 // SSE stream is task-scoped (backend filters by taskID). Any sessionID that
 // arrives belongs to this task — accept and remember it.
  if (!store.selectedTaskID) return false;
  const current = currentSessionID();
  if (current && current === sessionID) return true;
  if (_knownChildSessions && _knownChildSessions.has(sessionID)) return true;
 // Remember this session for fast O(1) lookups on subsequent events.
  if (!_knownChildSessions) _knownChildSessions = new Set();
  _knownChildSessions.add(sessionID);
  return true;
}
