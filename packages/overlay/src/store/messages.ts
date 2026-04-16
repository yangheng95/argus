// ── Message Store ──
// Solid reactive store for conversation messages, agent events, and SSE state.

import { createStore, produce } from "solid-js/store";
import { batch, createMemo, createRoot, type Accessor } from "solid-js";
import { apiJson, apiUrl } from "../services/api";
import { boardStore } from "../store/board";
import { clearConversationUiState } from "./conversation-ui";
import { touchReasoningPart as trackReasoningPart } from "./reasoning";
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

/** Synthesised UI snapshot of an agent's contribution to a task — derived
 *  from store.messages + agentEvents + boardStore by computeAgentCards().
 *
 *  `kind` discriminates a single-stage round ("agent") from a per-goal
 *  container of stage cards ("goal"). All consumers (conversation.ts,
 *  card-tree.ts, Board.tsx) read this struct, never raw Message objects. */
export type AgentCardData =
  | {
      kind: "agent";
      id: string;
      stage: string;
      status: string;
      round: number;
      messages: any[];
      sessionID: string;
      /** Parent session id (bridge-stamped). Drives card nesting: a card's
       *  position in the tree is literally its parent session's position + 1
       *  level of nesting, unless the card has a goalID (then it lives in
       *  that goal's container instead). Empty string for root sessions and
       *  for synthetic live-event cards that don't map to a real session. */
      parentSessionID: string;
      /** Goal membership (bridge-stamped or from board.goalRuns). When set,
       *  this card is routed into the matching Goal card, not the session
       *  tree — Goal is the stronger container. */
      goalID: string;
      time: number;
      /** Nested sub-agent cards. Populated by computeAgentCards() once all
       *  sessions are assembled; consumed by card-tree.ts to render a
       *  recursive Card node tree. */
      children: AgentCardData[];
    }
  | {
      kind: "goal";
      id: string;
      stage: "executor";
      status: string;
      round: number;
      sessionID: string;
      time: number;
      goalID: string;
      goalTitle: string;
      goalStatus: string;
      goalDescription: string;
      goalSteps?: Array<{ stepID: string; label: string; status: string; summary?: string; payload?: any }>;
      contracts?: Array<{ key: string; value: string; reason?: string }>;
      internalCards: AgentCardData[];
    };

// ── Store ──

const [store, setStore] = createStore({
  /**
   * Chronologically sorted flat list of all messages. Primary source of truth
   * for message content. Consumers that need all messages (synthetic-message
   * merging in chat.ts, section phase sync, etc.) read this.
   */
  messages: [] as Message[],
  /**
   * Parallel session-indexed view into `messages` — values are references to
   * the same Message objects, grouped and sorted per sessionID. Maintained
   * by applyMessageEvent / setMessages alongside the flat array.
   *
   * Why both: the flat list supports "show me everything" consumers; the
   * per-session view is what unlocks Solid's fine-grained reactivity. When
   * a memo reads `messagesBySession[sid]`, Solid tracks only that key's
   * sub-tree — a part delta on session A does not fan out to session B's
   * downstream work. The old single-array iteration model re-ran every
   * card memo on every SSE delta; this shape is the structural fix.
   */
  messagesBySession: {} as Record<string, Message[]>,
  agentEvents: [] as any[],
  selectedTaskID: "" as string,
  showTranscriptDetails: false,
  agentStatus: null as any,
  sseConnected: false,
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
// Cleared on task switch (clearMessages). No TTL — SSE is meant to deliver
// message.updated first; if it doesn't, that's a backend-ordering bug to fix
// at the source, not a symptom to paper over here.
const _pendingParts = new Map<string, { parts: any[] }>();

function rebuildMessageIndex() {
  messageIndex.clear();
  for (const msg of store.messages) {
    if (msg?.info?.id) messageIndex.set(msg.info.id, msg);
  }
}

export function messageById(id: string): Message | undefined {
  return messageIndex.get(id);
}

/**
 * Resolve a message's session bucket key. Messages without an info.sessionID
 * fall into the "" bucket (rare; transcript reconstruction edge cases).
 */
function sessionKeyOf(message: Message | undefined): string {
  const sid = message?.info?.sessionID;
  return typeof sid === "string" ? sid : "";
}

/**
 * Locate an already-stored message within its session bucket. Returns -1 if
 * the bucket is empty or the message isn't present. Uses reference equality
 * on Message objects — the flat `messages` array and `messagesBySession`
 * share the same object references.
 */
function sessionBucketIndexOf(sid: string, msg: Message): number {
  const bucket = store.messagesBySession[sid];
  return bucket ? bucket.indexOf(msg) : -1;
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

import { normalizeAgentRole, classifyMessage } from "../utils/message";
import { rootTaskSessionID } from "../store/board";

function messageEndTime(message: any): number {
  return Number(
    message?.info?.time?.completed || message?.info?.time?.updated || (finiteMessageTime(message) ?? 0),
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

// Cache live agent messages by stable key (msgID:kind) to maintain referential
// stability for Solid's `<For>`. Text changes overwrite the same entry instead
// of creating new ones. Per-task lifetime: cleared by `clearAgentEvents()` on
// task switch; no per-stage cap, because persisted messages are the
// authoritative source (see specs/new-arch/02-data.md) and any truncation of
// the live buffer would be a fallback layer papering over that.
const _agentMsgCache = new Map<string, any>();

function agentMessage(event: any): any | null {
  if (!event || typeof event !== "object") return null;
  const stage = String(event?.stage || "").trim().toLowerCase();
  if (!stage) return null;
  // Deterministic time embedded in the synthesized eventID (0 fallback, not
  // Date.now()), so repeated lookups for the same logical event compute the
  // same key. The `created` time written onto the presentation record can
  // still fall back to Date.now() — it's not part of the cache key.
  const stableTime = agentEventTime(event) || 0;
  const created = stableTime || Date.now();
  const eventID =
    typeof event?.id === "string" && event.id
      ? event.id
      : `${stage}:${String(event?.kind || "status")}:${stableTime}`;
  const kind = String(event?.kind || "status").trim().toLowerCase();
  const text = agentEventDisplayText(event).trim();
  const msgID = `agent-event:${stage}:${eventID}`;
  const stableKey = `${msgID}:${kind}`;
  const cached = _agentMsgCache.get(stableKey);
  if (cached) {
    // Same source text → return cached reference (referential stability for <Index>/<For>).
    // Different text → fall through to create a new object so Solid detects the change.
    // We compare _sourceText (stored alongside the msg) instead of parts[0].text,
    // because tool parts don't have a .text property.
    if (cached._sourceText === text) return cached.msg;
  }
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

  if (msg) _agentMsgCache.set(stableKey, { msg, _sourceText: text });
  return msg;
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

// ── Agent cards: session-tree-driven derivation ──
//
// Two-layer Solid reactive design to eliminate the "single giant memo iterates
// store.messages" bottleneck that caused multi-second freezes during streaming:
//
//   Layer 1 (fine-grained) — `getSessionBucketCardMemo(sid)`:
//     Per-session createMemo wrapped in createRoot so it survives outer memo
//     re-runs. Reads only `store.messagesBySession[sid]` plus per-session
//     board slices. When a part delta fires on session A, only session A's
//     memo re-runs; sessions B..Z do not re-evaluate.
//
//   Layer 2 (assembly) — `computeAgentCards()`:
//     Reads memo outputs for each known sessionID plus board goalWorkflows,
//     assembles goal groups and root ordering. Light work; no raw iteration
//     of `store.messages` or per-message field access.
//
// Nesting still follows session.parentID (bridge-stamped via parentSessionID
// on info). Cards carrying a goalID route into the matching Goal container;
// everything else forms a tree under the root orchestrator card.

type SessionBucket = {
  sessionID: string;
  stage: string;
  parentSessionID: string;
  goalID: string;
  messages: Message[];
  startTime: number;
  endTime: number;
};

/**
 * Derive lifecycle status from structured signals on messages + parts only:
 *   - any part whose `state.status === "error"` → "error"
 *   - any part whose `state.status === "running"` → "running"
 *   - any message carrying a finite `info.time.completed` → "completed"
 *   - otherwise "running" (in-flight / waiting on first response)
 *
 * Deliberately free of agent-event dependency — if it read store.agentEvents
 * each session memo would invalidate on every live event, defeating the
 * point of per-session granularity. Per CLAUDE.md principle 12 also refuses
 * to match summary text; completion signal is the message timestamp.
 */
function bucketStatus(bucket: SessionBucket): string {
  let hasRunning = false;
  let hasError = false;
  let hasCompleted = false;
  for (const m of bucket.messages) {
    for (const p of (m.parts || [])) {
      const s = p?.state?.status;
      if (s === "error") hasError = true;
      else if (s === "running") hasRunning = true;
    }
    if (Number.isFinite(m?.info?.time?.completed)) hasCompleted = true;
  }
  if (hasError) return "error";
  if (hasRunning) return "running";
  return hasCompleted ? "completed" : "running";
}

// Per-session card memos — created lazily, cached across outer-memo runs via
// createRoot (so Solid doesn't dispose them when the outer computation
// re-runs), cleared when the selected task changes.
const sessionBucketMemos = new Map<string, Accessor<AgentCardData | null>>();
const sessionBucketMemoDisposers: Array<() => void> = [];

function clearSessionBucketMemos(): void {
  while (sessionBucketMemoDisposers.length > 0) {
    const dispose = sessionBucketMemoDisposers.pop();
    try { dispose?.(); } catch { /* ignore */ }
  }
  sessionBucketMemos.clear();
}

function getSessionBucketCardMemo(sid: string): Accessor<AgentCardData | null> {
  const existing = sessionBucketMemos.get(sid);
  if (existing) return existing;
  let memo!: Accessor<AgentCardData | null>;
  createRoot((dispose) => {
    memo = createMemo(() => buildSessionBucketCard(sid));
    sessionBucketMemoDisposers.push(dispose);
  });
  sessionBucketMemos.set(sid, memo);
  return memo;
}

/**
 * Build an AgentCardData for a single session. All reactive reads confined
 * to that session's own bucket + the session's goalRun row + rootSessionID.
 * Cross-session state (ordering, goal grouping) is NOT touched here — it
 * belongs to the outer assembly memo.
 */
function buildSessionBucketCard(sid: string): AgentCardData | null {
  const bucket = store.messagesBySession[sid];
  if (!bucket || bucket.length === 0) return null;

  const rootSID = rootTaskSessionID();
  const msgs: Message[] = [];
  let stage = "";
  let parentSessionID = "";
  let goalID = "";
  let startTime = Infinity;
  let endTime = 0;
  for (const m of bucket) {
    const s = String(m.info?.channel || classifyMessage(m, rootSID));
    if (s === "main" || s === "filtered") continue;
    if (String(m.info?.role || "").toLowerCase() === "user") continue;
    if (!stage) stage = s;
    if (!parentSessionID && typeof m.info?.parentSessionID === "string") {
      parentSessionID = m.info.parentSessionID;
    }
    if (!goalID && typeof m.info?.goalID === "string") {
      goalID = m.info.goalID;
    }
    msgs.push(m);
    const t = finiteMessageTime(m) ?? Infinity;
    if (t < startTime) startTime = t;
    const e = messageEndTime(m);
    if (e > endTime) endTime = e;
  }
  if (msgs.length === 0) return null;

  // Back-fill goalID from board.goalRuns when the bridge stamp isn't on the
  // message yet (common for transcripts loaded before registration).
  if (!goalID) {
    for (const gr of boardStore.board?.goalRuns || []) {
      if (gr.sessionID === sid || gr.executorSessionID === sid || gr.plannerSessionID === sid) {
        goalID = gr.goalID;
        break;
      }
    }
  }

  msgs.sort((l, r) => messageOrderTime(l) - messageOrderTime(r));
  const bucketObj: SessionBucket = {
    sessionID: sid,
    stage,
    parentSessionID,
    goalID,
    messages: msgs,
    startTime,
    endTime,
  };
  const status = bucketStatus(bucketObj);
  const start = Number.isFinite(startTime) && startTime > 0 ? startTime : Date.now();
  return {
    kind: "agent",
    id: `${stage}:session:${sid}`,
    stage,
    status,
    round: 0,
    sessionID: sid,
    parentSessionID,
    goalID,
    time: start,
    messages: msgs,
    children: [],
  };
}

export function computeAgentCards(): { cards: Record<string, AgentCardData>; order: string[] } {
  const _t0 = performance.now();
  // 1. Per-session agent cards from memo cache. Reading each memo tracks only
  //    that one session's bucket — outer assembly reruns narrowly when any
  //    single session's card output changes.
  const allAgentCards: AgentCardData[] = [];
  for (const sid of Object.keys(store.messagesBySession)) {
    const card = getSessionBucketCardMemo(sid)();
    // Shallow-copy with a fresh children array. nestWithinBucket() mutates
    // children via push — without the copy, repeated calls to
    // computeAgentCards() (from conversationMessages + Board memos) would
    // accumulate duplicates in the memo-cached object's children array.
    if (card) allAgentCards.push({ ...card, children: [] });
  }

  // 2. Live agent-event-only stages — keeps overlay responsive during the
  //    bootstrap window where events arrive before any session emits messages.
  //    Dropped once a real session bucket for that stage exists.
  const liveEventsByStage = new Map<string, any[]>();
  for (const event of store.agentEvents) {
    const stage = String(event?.stage || "").trim().toLowerCase();
    if (!stage) continue;
    const list = liveEventsByStage.get(stage);
    if (list) list.push(event);
    else liveEventsByStage.set(stage, [event]);
  }
  const stagesWithSessions = new Set<string>();
  for (const c of allAgentCards) if (c.kind === "agent") stagesWithSessions.add(c.stage);
  for (const [stage, events] of liveEventsByStage) {
    if (stagesWithSessions.has(stage)) continue;
    const merged = mergeAgentReasoningDeltas(
      events.slice().sort((l, r) => agentEventTime(l) - agentEventTime(r)),
    );
    const msgs = merged.map((e) => agentMessage(e)).filter((m): m is Message => !!m);
    if (msgs.length === 0) continue;
    const startTime = agentEventTime(merged[0]) || Date.now();
    allAgentCards.push({
      kind: "agent",
      id: `${stage}:live`,
      stage,
      status: "running",
      round: 0,
      sessionID: "",
      parentSessionID: "",
      goalID: "",
      time: startTime,
      messages: msgs,
      children: [],
    });
  }

  // 5. Goal cards — one per board.goalWorkflows entry.
  const goalInfoMap = new Map<string, { id: string; title: string; status: string; index: number }>();
  const goalStepsMap = new Map<string, Array<{ stepID: string; label: string; status: string; summary?: string; payload?: any }>>();
  const goalContractsMap = new Map<string, Array<{ key: string; value: string; reason?: string }>>();
  for (let i = 0; i < (boardStore.board?.goalWorkflows || []).length; i++) {
    const gw = boardStore.board!.goalWorkflows![i];
    goalInfoMap.set(gw.goalID, { id: gw.goalID, title: gw.goalTitle, status: gw.goalStatus, index: i + 1 });
    goalStepsMap.set(gw.goalID, (gw.steps || []).map((s: any) => ({
      stepID: s.stepID, label: s.label, status: s.status, summary: s.summary, payload: s.payload,
    })));
    if (Array.isArray(gw.contracts) && gw.contracts.length > 0) {
      goalContractsMap.set(gw.goalID, gw.contracts);
    }
  }

  // Partition agent cards by goal membership.
  const goalBuckets = new Map<string, AgentCardData[]>();
  const looseCards: AgentCardData[] = [];
  for (const card of allAgentCards) {
    if (card.kind !== "agent") continue;
    if (card.goalID && goalInfoMap.has(card.goalID)) {
      const list = goalBuckets.get(card.goalID) || [];
      list.push(card);
      goalBuckets.set(card.goalID, list);
    } else {
      looseCards.push(card);
    }
  }

  /** Nest agent cards within a bucket according to session parent links.
   *  A card whose parentSessionID is another card in the same bucket
   *  becomes that card's child. Cards whose parent is not in the bucket
   *  (e.g. executor whose parent is orchestrator at root) surface as bucket
   *  roots. Sorts chronologically at every level. */
  function nestWithinBucket(cards: AgentCardData[]): AgentCardData[] {
    const byID = new Map<string, AgentCardData>();
    for (const c of cards) {
      if (c.kind === "agent" && c.sessionID) byID.set(c.sessionID, c);
    }
    const roots: AgentCardData[] = [];
    for (const c of cards) {
      if (c.kind !== "agent") continue;
      const parent = c.parentSessionID ? byID.get(c.parentSessionID) : undefined;
      if (parent && parent !== c) {
        parent.children.push(c);
      } else {
        roots.push(c);
      }
    }
    for (const c of cards) {
      if (c.kind === "agent") c.children.sort((a, b) => (a.time || 0) - (b.time || 0));
    }
    roots.sort((a, b) => (a.time || 0) - (b.time || 0));
    return roots;
  }

  const nextCards: Record<string, AgentCardData> = {};
  const nextOrder: string[] = [];

  // Goal group cards in board order. Pending goals with no activity are
  // skipped so the overlay doesn't show empty shells before anything starts.
  const goalEntries = [...goalInfoMap.entries()].sort((a, b) => a[1].index - b[1].index);
  for (const [gid, info] of goalEntries) {
    const bucket = goalBuckets.get(gid) || [];
    if (bucket.length === 0 && info.status === "pending") continue;

    const internalCards = nestWithinBucket(bucket);
    const groupKey = `goal-group:${gid}`;
    const groupStatus = bucket.length === 0
      ? (info.status === "passed" || info.status === "failed" ? info.status : "pending")
      : bucket.some((c) => c.status === "running") ? "running"
      : bucket.some((c) => c.status === "error") ? "error"
      : "completed";
    const groupStart = internalCards.length > 0
      ? Math.min(...internalCards.map((c) => c.time || Infinity))
      : Date.now();

    nextCards[groupKey] = {
      kind: "goal",
      id: groupKey,
      stage: "executor",
      status: groupStatus,
      round: info.index,
      sessionID: internalCards[0]?.kind === "agent" ? internalCards[0].sessionID : "",
      time: Number.isFinite(groupStart) && groupStart > 0 ? groupStart : Date.now(),
      goalID: gid,
      goalTitle: info.title,
      goalStatus: info.status,
      goalDescription: "",
      goalSteps: goalStepsMap.get(gid),
      contracts: goalContractsMap.get(gid),
      internalCards,
    };
    nextOrder.push(groupKey);
  }

  // Loose cards: nest by session parent. Roots become top-level overlay cards.
  const looseRoots = nestWithinBucket(looseCards);
  for (const c of looseRoots) {
    if (c.kind !== "agent") continue;
    nextCards[c.id] = c;
    nextOrder.push(c.id);
  }

  // Final root ordering: root orchestrator card first, then goal cards in
  // board order, then other root agent cards chronologically.
  //
  // Only the orchestrator session emits messages with `stage: "assistant"`
  // (all other stages are "architect" / "planner" / "delivery" / "executor"
  // / "build" / etc.). Sub-stage `stage: "assistant"` cards (e.g. the refine
  // session) are children of the orchestrator card after nestWithinBucket, so
  // they never reach this priority sort — only the root orchestrator does.
  // The previous `!parentSessionID` guard was a left-over from when bridge
  // hadn't started stamping parentSessionID; once enrichProperties stamped
  // every message with the parent session, the orchestrator card always had a
  // parent (task.session_id) and never matched, dropping it to priority 2.
  const priority = (c: AgentCardData | undefined): number => {
    if (!c) return 3;
    if (c.kind === "agent" && c.stage === "assistant") return 0;
    if (c.kind === "goal") return 1;
    return 2;
  };
  nextOrder.sort((left, right) => {
    const ca = nextCards[left];
    const cb = nextCards[right];
    const pa = priority(ca);
    const pb = priority(cb);
    if (pa !== pb) return pa - pb;
    if (ca?.kind === "goal" && cb?.kind === "goal") return ca.round - cb.round;
    return (ca?.time || 0) - (cb?.time || 0);
  });

  const _dt = performance.now() - _t0;
  if (_dt > 5) {
    console.warn(`[perf] computeAgentCards: ${_dt.toFixed(1)}ms, ${nextOrder.length} cards`);
  }
  return { cards: nextCards, order: nextOrder };
}

// Note: agentCards() and agentCardOrder() wrappers removed — all callers
// now use computeAgentCards() directly to avoid the double-call overhead
// (each wrapper called computeAgentCards() independently, doubling the work
// when both cards and order were needed in the same reactive context).

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

  // All mutation branches below touch two reactive views in lock-step:
  //   1. `store.messages` — flat chronological array (legacy consumers)
  //   2. `store.messagesBySession[sid]` — per-session bucket (card memos)
  // Both hold references to the SAME Message objects, but Solid tracks
  // them as independent reactive slots. Writing only one side leaves the
  // other's subscribers unnotified — so every write is mirrored.

  if (type === "message.updated") {
    const info = properties.info;
    if (!info?.id) return false;
    const existing = messageById(info.id);
    if (existing) {
      const merged = mergeMessageInfo(existing.info, info);
      const idx = store.messages.indexOf(existing);
      if (idx >= 0) setStore("messages", idx, "info", merged);
      const sid = sessionKeyOf(existing);
      const sIdx = sessionBucketIndexOf(sid, existing);
      if (sIdx >= 0) setStore("messagesBySession", sid, sIdx, "info", merged);
      return true;
    }
    // Flush any parts that arrived before this message
    const bufferedEntry = _pendingParts.get(info.id);
    if (bufferedEntry) _pendingParts.delete(info.id);
    const msg: Message = { info: mergeMessageInfo(undefined, info), parts: bufferedEntry?.parts ?? [] };
    let insertIdx = 0;
    setStore(
      "messages",
      produce((msgs: Message[]) => {
        insertIdx = insertSorted(msgs, msg);
      }),
    );
    // The object we put into the session bucket must be the SAME reference
    // Solid wrapped in the flat array — otherwise sub-path updates on either
    // side won't propagate to the other.
    const stored = store.messages[insertIdx];
    messageIndex.set(info.id, stored);
    const sid = sessionKeyOf(stored);
    const existingBucket = store.messagesBySession[sid];
    if (!existingBucket) {
      setStore("messagesBySession", sid, [stored]);
    } else {
      setStore(
        "messagesBySession",
        sid,
        produce((arr: Message[]) => {
          insertSorted(arr, stored);
        }),
      );
    }
    return true;
  }

  if (type === "message.part.updated") {
    const part = properties.part;
    if (!part?.id || !part?.messageID) return false;
    let message = messageById(part.messageID);
    if (!message) {
      // Buffer: message.updated hasn't arrived yet. Store part for later.
      const existing = _pendingParts.get(part.messageID);
      if (existing) {
        existing.parts.push(part);
      } else {
        _pendingParts.set(part.messageID, { parts: [part] });
      }
      return true;
    }
    const idx = store.messages.indexOf(message);
    const sid = sessionKeyOf(message);
    const sIdx = sessionBucketIndexOf(sid, message);
    const partIdx = message.parts.findIndex((p: Part) => p.id === part.id);
    if (partIdx >= 0) {
      setStore("messages", idx, "parts", partIdx, part);
      if (sIdx >= 0) setStore("messagesBySession", sid, sIdx, "parts", partIdx, part);
    } else {
      // CRITICAL: messages[idx] and messagesBySession[sid][sIdx] share the same
      // Message reference — so `.parts` is a single JS array. Using `produce`
      // with push() twice would push the new part ONCE into that shared array
      // (via the first setStore), then push it AGAIN on the second setStore
      // (because produce reads the now-modified array). That is how users saw
      // every tool card appearing in duplicate.
      //
      // Compute the new array ONCE and assign it as a value to both reactive
      // paths. Value assignment is idempotent — the second setStore sees the
      // same target and re-emits the same reference without mutating.
      const nextParts = [...message.parts, part];
      setStore("messages", idx, "parts", nextParts);
      if (sIdx >= 0) setStore("messagesBySession", sid, sIdx, "parts", nextParts);
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
    const sid = sessionKeyOf(message);
    const sIdx = sessionBucketIndexOf(sid, message);
    const partIdx = message.parts.findIndex(
      (p: Part) => p.id === properties.partID,
    );

    if (properties.field === "raw") {
      if (partIdx < 0) return false;
      const part = message.parts[partIdx];
      if (part.type !== "tool" || !part.state) return false;
      // CRITICAL: messages and messagesBySession hold the SAME Message object
      // refs. If we used a functional updater `(prev) => prev + delta` and ran
      // it twice (once per mirrored setStore), the second call would read the
      // already-appended value and double the delta — producing "aa bb cc" for
      // each streamed token. Resolve the new value ONCE, then write it as a
      // plain value to both reactive paths.
      const nextRaw = ((part.state as any).raw || "") + properties.delta;
      setStore("messages", msgIdx, "parts", partIdx, "state", "raw", nextRaw);
      if (sIdx >= 0) setStore("messagesBySession", sid, sIdx, "parts", partIdx, "state", "raw", nextRaw);
      return true;
    }

    // text delta
    if (partIdx < 0) {
      // Create placeholder part on both views. Same shared-array gotcha as in
      // message.part.updated's push branch — assign a freshly-built array to
      // both reactive paths instead of running `produce(push)` twice, which
      // would otherwise duplicate the placeholder in the shared parts array.
      const newPart: Part = {
        id: properties.partID,
        type: "text",
        text: properties.delta,
        sessionID: properties.sessionID,
        messageID: properties.messageID,
      };
      const nextParts = [...message.parts, newPart];
      setStore("messages", msgIdx, "parts", nextParts);
      if (sIdx >= 0) setStore("messagesBySession", sid, sIdx, "parts", nextParts);
      return true;
    }

    // CRITICAL: compute next text ONCE — see the raw-field branch above for
    // the full explanation. Using a functional updater twice across mirrored
    // setStore calls reads the already-appended value on the second pass and
    // doubles every delta.
    const existingText = (message.parts[partIdx] as any).text || "";
    const nextText = existingText + properties.delta;
    setStore("messages", msgIdx, "parts", partIdx, "text", nextText);
    if (sIdx >= 0) setStore("messagesBySession", sid, sIdx, "parts", partIdx, "text", nextText);
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

/** Sort events chronologically. No per-stage truncation: persistent messages
 *  are the authoritative source (see specs/new-arch/02-data.md) and live
 *  agentEvents are a single task's working set, bounded naturally by task
 *  lifetime. `clearAgentEvents()` on task switch drops everything at once. */
function pruneAgentEvents(events: AgentEvent[]): AgentEvent[] {
  return events
    .slice()
    .sort((a, b) => (a.time?.created || 0) - (b.time?.created || 0));
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

  // Map-based merge: O(n + m) instead of O(n*m) spread-per-event.
  // Copy current events into a keyed map (avoids store proxy leaks).
  const byKey = new Map<string, AgentEvent>();
  for (const e of store.agentEvents as AgentEvent[]) {
    const key = `${e.stage}:${e.id}`;
    byKey.set(key, { ...e } as AgentEvent);
  }

  // Merge queued events
  const affectedKeys: string[] = [];
  for (const raw of queued) {
    const event = agentEventEntry(raw);
    if (!event) continue;
    if (event.taskID && boardStore.selectedTaskID && event.taskID !== boardStore.selectedTaskID) continue;
    const key = `${event.stage}:${event.id}`;
    const existing = byKey.get(key);
    const merged = existing ? mergeAgentEvent(existing, event) : event;
    syncAgentText(merged);
    byKey.set(key, merged);
    affectedKeys.push(key);
  }

  // Sort + prune once (not per-event)
  const sorted = [...byKey.values()].sort(
    (a, b) => (a.time?.created || 0) - (b.time?.created || 0),
  );
  const pruned = pruneAgentEvents(sorted);

  // Direct assignment: cheaper than reconcile (avoids O(n) deep comparison).
  // computeAgentCards() reads the full array anyway, so reconcile's fine-grained
  // diffing provides no benefit and adds significant overhead.
  setStore("agentEvents", pruned);

  // Schedule live text animation for affected events
  for (const key of affectedKeys) {
    const target = pruned.find((e) => `${e.stage}:${e.id}` === key);
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
  setStore("agentEvents", normalized);
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
  // Rebuild the per-session view from scratch — bulk transcript loads are
  // infrequent (task switch, resume) so the full rebuild is acceptable, and
  // the alternative (incrementally reconciling every session bucket) is
  // brittle. Same Message refs as `store.messages` so sub-path reactivity
  // via either view stays consistent afterwards.
  const nextBySession: Record<string, Message[]> = {};
  for (const m of store.messages) {
    const sid = sessionKeyOf(m);
    (nextBySession[sid] ??= []).push(m);
  }
  setStore("messagesBySession", nextBySession);
}

export function setSelectedTaskID(taskID: string) {
  if (store.selectedTaskID !== taskID) {
    clearConversationUiState();
    clearKnownChildSessions();
    // Session memos belong to the previous task's session set; disposing them
    // here lets the new task start with a clean cache.
    clearSessionBucketMemos();
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
  setStore("messagesBySession", {});
  messageIndex.clear();
  _pendingParts.clear();
  clearSessionBucketMemos();
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
