// ── Message Store ──
// Solid reactive store for conversation messages, agent events, and SSE state.

import { createStore, produce, reconcile } from "solid-js/store";
import { batch } from "solid-js";
import { apiJson, apiUrl } from "../services/api";
import { boardStore } from "../store/board";
import { clearConversationUiState } from "./conversation-ui";
import {
  setExecutorEvents,
  clearExecutorEvents,
  mergeExecutorEventsFromFetch,
} from "./executor";
import { touchReasoningPart as trackReasoningPart } from "./reasoning";
import { executorEventEntry } from "../utils/executor-events";
import { syncSectionPhases } from "../utils/section";

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
  info: MessageInfo;
  parts: Part[];
}

// ── Store ──

const [store, setStore] = createStore({
  messages: [] as Message[],
  agentEvents: [] as any[],
  agentCards: {} as Record<string, AgentCardMessage>,
  agentCardOrder: [] as string[],
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

function messageTime(item: Message): number {
  return Number(item?.info?.time?.created || item?.info?.time?.updated || 0);
}

function sortMessages(list: Message[]): Message[] {
  // V8 Array.sort is stable since ES2019 — no need for index-based tie-breaking.
  // Single slice instead of slice + 2× map.
  const result = list.slice();
  result.sort((a, b) => messageTime(a) - messageTime(b));
  return result;
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
  const part = record(input) ? { ...input } : { type: "text", text: String(input || "") };
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
  };
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

/** Active pipeline stages — exported so conversation.ts can reuse. */
export function activeAgentStages(): Set<string> {
  const status = String(boardStore.board?.task?.status || "").trim().toLowerCase();
  if (status === "spec_generating") return new Set(["spec"]);
  if (status === "goal_decomposing") return new Set(["goal"]);
  if (status === "planning") return new Set(["planner"]);
  if (status === "evaluating") return new Set(["evaluator"]);
  if (status === "delivering") return new Set(["delivery"]);
  if (!status && Array.isArray(store.agentEvents) && store.agentEvents.length > 0) {
    return new Set(
      store.agentEvents
        .map((item: any) => {
          const raw = String(item?.stage || "").trim().toLowerCase();
          return raw ? normalizeAgentRole(raw) : "";
        })
        .filter((r: string) => r && AGENT_CARD_STAGES.has(r as any)),
    );
  }
  return new Set();
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
  const base = {
    _synthetic: true,
    info: {
      id: msgID,
      role: "assistant",
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

// ── Debounced rebuild: coalesce multiple calls within the same microtask ──
let _rebuildScheduled = false;
function scheduleRebuildAgentCards(): void {
  if (_rebuildScheduled) return;
  _rebuildScheduled = true;
  requestAnimationFrame(() => {
    _rebuildScheduled = false;
    rebuildAgentCards();
  });
}

function rebuildAgentCards(): void {
  const roundsByStage: Record<string, AgentRound[]> = {};
  const latestEventByStage = new Map<string, any>();

  const rootSID = rootTaskSessionID();
  for (const message of store.messages) {
    const stage = classifyMessage(message, rootSID);
    if (stage === "main" || stage === "filtered") continue;
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
    const created = messageTime(message);
    if (created < entry.startTime) entry.startTime = created;
    const completed = messageEndTime(message);
    if (completed > entry.endTime) entry.endTime = completed;
  }

  const liveEventsByStage = new Map<string, any[]>();
  for (const event of Array.isArray(store.agentEvents) ? store.agentEvents : []) {
    const rawStage = String(event?.stage || "").trim().toLowerCase();
    const stage = normalizeAgentRole(rawStage);
    if (!AGENT_CARD_STAGES.has(stage)) continue;
    const items = liveEventsByStage.get(stage) || [];
    items.push(event);
    liveEventsByStage.set(stage, items);
    latestEventByStage.set(stage, event);
  }

  for (const [stage, events] of liveEventsByStage.entries()) {
    // Merge consecutive reasoning_delta events before creating messages
    const mergedEvents = mergeAgentReasoningDeltas(
      events.slice().sort((left, right) => agentEventTime(left) - agentEventTime(right)),
    );
    const liveMessages = mergedEvents
      .map((event) => agentMessage(event))
      .filter(Boolean)
      .slice(-MAX_LIVE_AGENT_MESSAGES);
    if (liveMessages.length === 0) continue;
    const existing = roundsByStage[stage] || [];
    if (existing.length > 0) continue;
    existing.push({
      channelID: `${stage}:live`,
      stage,
      sessionID: "",
      messages: liveMessages,
      startTime: messageTime(liveMessages[0]),
      endTime: Math.max(...liveMessages.map((message: any) => messageEndTime(message))),
    });
    roundsByStage[stage] = existing;
  }

  const nextCards: Record<string, AgentCardMessage> = {};
  const nextOrder: string[] = [];
  for (const [stage, rounds] of Object.entries(roundsByStage)) {
    rounds.sort((left, right) => left.startTime - right.startTime);
    for (let index = 0; index < rounds.length; index += 1) {
      const round = rounds[index];
      const roundLabel = rounds.length > 1 ? index + 1 : 0;
      const status = agentRoundStatus(
        stage,
        round,
        index,
        rounds,
        latestEventByStage.get(stage),
      );
      const created =
        Number.isFinite(round.startTime) && round.startTime > 0 ? round.startTime : Date.now();
      const cardID = round.channelID;
      nextCards[cardID] = {
        _synthetic: true,
        _agentCard: true,
        _agentStage: stage,
        _agentStatus: status,
        _agentRound: roundLabel,
        _agentCardKey: cardID,
        _agentMessages: round.messages
          .slice()
          .sort((left, right) => messageTime(left) - messageTime(right)),
        info: {
          id: `agent-card:${cardID}`,
          role: "agent-card",
          agent: stage,
          sessionID: round.sessionID,
          time: { created },
        },
        parts: [],
      };
      nextOrder.push(cardID);
    }
  }

  nextOrder.sort(
    (left, right) =>
      messageTime(nextCards[left]) - messageTime(nextCards[right]) || left.localeCompare(right),
  );

  // Apply targeted per-card updates instead of reconcile.
  // reconcile can't properly diff arrays whose elements are store proxies
  // from store.messages — it sees the proxy identity, not the value change,
  // so _agentMessages.length never triggers in downstream reactive contexts.
  batch(() => {
    // Remove cards that no longer exist
    const prevKeys = Object.keys(store.agentCards);
    for (const key of prevKeys) {
      if (!(key in nextCards)) {
        setStore("agentCards", key, undefined!);
      }
    }
    // Add or update cards
    for (const [cardID, card] of Object.entries(nextCards)) {
      if (cardID in store.agentCards) {
        const prev = store.agentCards[cardID];
        // Only update fields that actually changed to avoid unnecessary reactivity
        if (prev._agentStatus !== card._agentStatus) {
          setStore("agentCards", cardID, "_agentStatus", card._agentStatus);
        }
        if (prev._agentRound !== card._agentRound) {
          setStore("agentCards", cardID, "_agentRound", card._agentRound);
        }
        // Only replace _agentMessages when the list actually changed
        // (by reference or length) to avoid triggering <For> re-diff
        const prevMsgs = prev._agentMessages;
        const nextMsgs = card._agentMessages;
        if (
          prevMsgs.length !== nextMsgs.length ||
          prevMsgs.some((m: any, i: number) => m !== nextMsgs[i])
        ) {
          setStore("agentCards", cardID, "_agentMessages", [...nextMsgs]);
        }
      } else {
        setStore("agentCards", cardID, { ...card, _agentMessages: [...card._agentMessages] });
      }
    }
    // Update order only when it actually changed
    const prevOrder = store.agentCardOrder;
    if (
      prevOrder.length !== nextOrder.length ||
      prevOrder.some((id: string, i: number) => id !== nextOrder[i])
    ) {
      setStore("agentCardOrder", nextOrder);
    }
  });
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
let _execRunID = "";
let _execFetchedAt = 0;

function touchReasoningPart(part: any): any {
  if (!part || part.type !== "reasoning") return part;
  if (typeof part.text !== "string") part.text = "";
  trackReasoningPart(part);
  return part;
}

async function loadExecutorEvents(runID: string): Promise<void> {
  const now = Date.now();
  if (_execRunID === runID && now - _execFetchedAt < 3000) {
    return;
  }
  _execRunID = runID;
  _execFetchedAt = now;
  const data = await fetch(apiUrl(`run/${encodeURIComponent(runID)}/executor-events`), {
    headers: { Accept: "application/json" },
  })
    .then((res) => (res.ok ? res.json() : []))
    .catch(() => []);
  const items = (Array.isArray(data) ? data : [])
    .map((item) => executorEventEntry(item))
    .filter(Boolean) as ReturnType<typeof executorEventEntry>[];
  const firstRunID = items.find(e => e?.runID)?.runID;
  // Merge API events with existing SSE events to preserve real-time state
  mergeExecutorEventsFromFetch(items as any[], firstRunID);
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
      const activeRunID = String(boardStore.board?.task?.activeRunID || "");
      if (activeRunID) {
        await loadExecutorEvents(activeRunID);
      } else {
        _execRunID = "";
        _execFetchedAt = 0;
        clearExecutorEvents();
      }
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
        setStore("messages", idx, "info", info);
      }
      return true;
    }
    const msg: Message = { info, parts: [] };
    setStore(
      "messages",
      produce((msgs: Message[]) => {
        msgs.push(msg);
      }),
    );
    messageIndex.set(info.id, store.messages[store.messages.length - 1]);
    return true;
  }

  if (type === "message.part.updated") {
    const part = properties.part;
    if (!part?.id || !part?.messageID) return false;
    let message = messageById(part.messageID);
    if (!message) {
      const msg: Message = {
        info: {
          id: part.messageID,
          sessionID: part.sessionID,
          role: "assistant",
        },
        parts: [],
      };
      setStore(
        "messages",
        produce((msgs: Message[]) => {
          msgs.push(msg);
        }),
      );
      message = store.messages[store.messages.length - 1];
      messageIndex.set(part.messageID, message);
    }
    const idx = store.messages.indexOf(message);
    const partIdx = message.parts.findIndex((p: Part) => p.id === part.id);
    if (partIdx >= 0) {
      // Prevent tool status regression: once a tool part reaches "completed"
      // or "error", a stale "pending"/"running" update must not overwrite it.
      const existing = message.parts[partIdx];
      if (
        existing.type === "tool" &&
        part.type === "tool" &&
        existing.state?.status &&
        part.state?.status
      ) {
        const rank: Record<string, number> = {
          pending: 0,
          running: 1,
          completed: 2,
          error: 2,
        };
        const oldRank = rank[existing.state.status] ?? 0;
        const newRank = rank[part.state.status] ?? 0;
        if (newRank < oldRank) {
          // Merge non-status fields but keep the existing terminal status
          setStore("messages", idx, "parts", partIdx, {
            ...part,
            state: { ...part.state, status: existing.state.status, output: existing.state.output || part.state.output, error: existing.state.error || part.state.error },
          });
          return true;
        }
      }
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
      const msg: Message = {
        info: {
          id: properties.messageID,
          sessionID: properties.sessionID,
          role: "assistant",
        },
        parts: [],
      };
      setStore(
        "messages",
        produce((msgs: Message[]) => {
          msgs.push(msg);
        }),
      );
      message = store.messages[store.messages.length - 1];
      messageIndex.set(properties.messageID, message);
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
  let needsUpdate = false;
  batch(() => {
    for (const event of events) {
      if (applyMessageEvent(event)) needsUpdate = true;
    }
  });
  if (needsUpdate) {
    scheduleRebuildAgentCards();
  }
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
  scheduleRebuildAgentCards();

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
  scheduleRebuildAgentCards();
}

export function clearAgentEvents(): void {
  for (const key of [...agentLiveTimers.keys()]) {
    stopAgentLiveTimer(key);
  }
  setStore("agentEvents", []);
  scheduleRebuildAgentCards();
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
    msgs.sort((a, b) => messageTime(a) - messageTime(b));
  }));
  rebuildMessageIndex();
  scheduleRebuildAgentCards();
}

export function setSelectedTaskID(taskID: string) {
  if (store.selectedTaskID !== taskID) {
    clearConversationUiState();
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
  setStore("agentCards", reconcile({}, { merge: false }));
  setStore("agentCardOrder", []);
  messageIndex.clear();
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
