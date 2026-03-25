// ── Message Store ──
// Solid reactive store for conversation messages, extracted from legacy app.js.
// Replaces the window.__solidConversation bridge pattern.

import { createStore, produce, reconcile } from "solid-js/store";
import { batch } from "solid-js";
import { apiJson } from "../services/api";
import { boardStore } from "../store/board";

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

// ── Store ──

const [store, setStore] = createStore({
  messages: [] as Message[],
  agentEvents: [] as any[],
  selectedTaskID: "" as string,
  showTranscriptDetails: false,
  agentStatus: null as any,
  sseConnected: false,
  conversationUpdatedAt: 0,
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
  return [...list]
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) => messageTime(a.item) - messageTime(b.item) || a.index - b.index,
    )
    .map((x) => x.item);
}

// ── Full load from transcript ──

export async function syncTask(taskID: string) {
  if (!taskID) {
    setStore("messages", []);
    messageIndex.clear();
    return;
  }
  try {
    const data = await apiJson(
      `task/${encodeURIComponent(taskID)}/transcript`,
    );
    const messages: Message[] = Array.isArray(data) ? data : [];
    setStore("messages", sortMessages(messages));
    rebuildMessageIndex();
    setStore("conversationUpdatedAt", Date.now());
  } catch (e) {
    console.error("syncTask failed", e);
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

const FLUSH_INTERVAL = 16;
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

function flushEvents() {
  if (eventQueue.length === 0) return;
  const events = eventQueue;
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
    setStore("conversationUpdatedAt", Date.now());
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
// These mirror the mergeAgentEvent / mergeAgentEventList / agentEventEntry
// logic from legacy app.js so that the Solid path no longer needs to
// round-trip through window.__solidOverlay.setAgentEvents.

function displayString(value: any): string {
  return typeof value === "string" ? value.trim() : "";
}

function agentEventRecord(value: any): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

interface AgentEvent {
  id: string;
  eventID: string;
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

function agentEventTargetText(event: AgentEvent): string {
  if (!event) return "";
  const k = event.kind;
  if (k === "message_delta" || k === "reasoning_delta" || k === "status") {
    return displayString(event.text || event.summary);
  }
  if (k === "tool_call" || k === "tool_delta") {
    return displayString(event.text || event.payload?.text || event.summary);
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
  if (!target) {
    delete event._targetText;
    delete event._liveText;
    return;
  }
  event._targetText = target;
  event._liveText = target;
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
  const text = displayString(payload.text);
  const summary = displayString(raw?.summary || payload.summary || text);
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
    stage,
    kind,
    toolName,
    text,
    summary,
    payload,
    time: { created: Number.isFinite(created) ? created : Date.now() },
  };
}

function mergeAgentEvent(existing: AgentEvent, next: AgentEvent): AgentEvent {
  if (!existing) return next;
  if (next.kind === "message_delta" || next.kind === "reasoning_delta") {
    const merged = `${displayString(existing._targetText || existing.text || existing.summary)}${displayString(next.text || next.summary)}`;
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
    const mergedText = `${displayString(existing.text || existing.payload?.text || "")}${displayString(next.text || next.payload?.text || next.summary)}`;
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
  return next.sort(
    (a, b) => (a.time?.created || 0) - (b.time?.created || 0),
  );
}

/** Incrementally merge a raw agent.updated SSE event into the agentEvents list. */
export function appendAgentEvent(raw: any): void {
  const next = mergeAgentEventList([...store.agentEvents], raw);
  setStore("agentEvents", reconcile(next));
  setStore("conversationUpdatedAt", Date.now());
}

// ── Setters for legacy bridge ──

export function setAgentEvents(events: any[]) {
  setStore("agentEvents", reconcile(events));
}

export function setSelectedTaskID(taskID: string) {
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
// Mirrors app.js currentTaskSessionID / currentSessionID / matchesCurrentSession.

/**
 * Returns the sessionID of the currently selected task, preferring the board
 * task's sessionID and falling back to the task list entry for selectedTaskID.
 * Mirrors app.js currentTaskSessionID.
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
 * Mirrors app.js currentSessionID.
 */
export function currentSessionID(): string {
  return currentTaskSessionID();
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
 * Mirrors app.js matchesCurrentSession.
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
