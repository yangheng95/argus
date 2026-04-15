// ── Message Store ──
// Solid reactive store for conversation messages, agent events, and SSE state.

import { createStore, produce } from "solid-js/store";
import { batch, createMemo } from "solid-js";
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
      time: number;
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
  messages: [] as Message[],
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
// Each entry tracks creation time for TTL-based cleanup.
const _pendingParts = new Map<string, { parts: any[]; created: number }>();
const PENDING_PARTS_TTL_MS = 60_000;
let _lastPendingPrune = 0;

function prunePendingParts(): void {
  const now = Date.now();
  // Throttle: at most once per 10 seconds
  if (now - _lastPendingPrune < 10_000) return;
  _lastPendingPrune = now;
  for (const [key, entry] of _pendingParts) {
    if (now - entry.created > PENDING_PARTS_TTL_MS) {
      _pendingParts.delete(key);
    }
  }
}

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
// of creating new ones, preventing unbounded memory growth during streaming.
//
// IMPORTANT: this cache is also pruned by `pruneAgentEvents()` whenever an
// agent event drops out of `store.agentEvents` (per-stage 12-event cap). The
// pruning relies on `agentMessageStableKey()` producing the SAME key as the
// one written here — both must use a deterministic time fallback, never
// Date.now(), or the prune step won't be able to find the entries to delete
// and the map will grow unbounded again.
const _agentMsgCache = new Map<string, any>();

/** Deterministic stable-key derivation for the agent-message cache. */
function agentMessageStableKey(event: any): string {
  if (!event || typeof event !== "object") return "";
  const stage = String(event?.stage || "").trim().toLowerCase();
  if (!stage) return "";
  // Use 0 (not Date.now()) when time is missing — must be deterministic so
  // pruneAgentEvents can compute the same key later.
  const created = agentEventTime(event) || 0;
  const eventID =
    typeof event?.id === "string" && event.id
      ? event.id
      : `${stage}:${String(event?.kind || "status")}:${created}`;
  const kind = String(event?.kind || "status").trim().toLowerCase();
  return `agent-event:${stage}:${eventID}:${kind}`;
}

function agentMessage(event: any): any | null {
  if (!event || typeof event !== "object") return null;
  const stage = String(event?.stage || "").trim().toLowerCase();
  if (!stage) return null;
  // Use the same deterministic time as agentMessageStableKey (0 fallback,
  // not Date.now()) so the eventID embedded in msgID matches what prune
  // computes. The "live" creation timestamp on the synthesized message
  // itself can still fall back to Date.now() — that field is presentation
  // only and isn't part of the cache key.
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

function computeAgentCards(): { cards: Record<string, AgentCardData>; order: string[] } {
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
  // Board-driven: use goalWorkflows for goal info & sessionID→goalID mapping.
  // Executor messages are matched to goals via sessionID.
  // Other per-goal stages (planner, evaluator) use message goalID (bridge-stamped).
  // All per-goal stages are collected into goal group cards.
  // Task-scope stages (goal/requirements, architect, delivery, spec) stay standalone.

  // Stages that nest into a goal card when they carry a goalID. "build" is
  // here because a goal's executor may spawn a build sub-session for direct
  // code edits; when goal-scoped it belongs next to planner/executor/evaluator
  // under the goal rather than as a rootless agent card. Task-level fast-path
  // builds (task-agent routing a simple request straight to `build`) carry no
  // goalID and fall through to root rendering — see the `gid` branch below.
  const PER_GOAL_STAGES = new Set(["planner", "executor", "evaluator", "build"]);

  const goalInfoMap = new Map<string, { id: string; title: string; status: string }>();
  const goalIndexMap = new Map<string, number>();
  // sessionID → goalID, built from the board snapshot (board.goalRuns). This
  // is the authoritative O(1) index — goal-pool.ts persists goalRun rows at
  // dispatch time, so every running executor/planner session resolves here.
  const sessionToGoal = new Map<string, string>();

  for (let i = 0; i < (boardStore.board?.goalWorkflows || []).length; i++) {
    const gw = boardStore.board!.goalWorkflows![i];
    goalInfoMap.set(gw.goalID, { id: gw.goalID, title: gw.goalTitle, status: gw.goalStatus });
    goalIndexMap.set(gw.goalID, i + 1);
  }
  for (const gr of boardStore.board?.goalRuns || []) {
    if (gr.sessionID) sessionToGoal.set(gr.sessionID, gr.goalID);
    if (gr.executorSessionID) sessionToGoal.set(gr.executorSessionID, gr.goalID);
    if (gr.plannerSessionID) sessionToGoal.set(gr.plannerSessionID, gr.goalID);
  }

  /** Two O(1) lookups, both feed from the same goal-pool registration:
   *   1. sessionToGoal — DB snapshot; covers planner/executor once board
   *      sync catches up.
   *   2. first message's info.goalID — live stamp from the bridge; catches
   *      rounds whose session hasn't landed in the board snapshot yet.
   *  All messages in a round share the same goalID, so checking only the
   *  first one is sufficient (and keeps computeAgentCards O(rounds), not
   *  O(rounds·messages)). */
  function resolveGoalID(round: AgentRound): string {
    if (round.sessionID && sessionToGoal.has(round.sessionID)) {
      return sessionToGoal.get(round.sessionID)!;
    }
    const first = round.messages[0];
    return typeof first?.info?.goalID === "string" ? first.info.goalID : "";
  }

  const nextCards: Record<string, AgentCardData> = {};
  const nextOrder: string[] = [];

  function buildCard(
    stage: string,
    round: AgentRound,
    roundLabel: number,
    status: string,
  ): AgentCardData {
    // Fall back to Date.now() if the round had no valid timestamp.
    // Real timestamp validation belongs in setMessages/appendAgentEvent.
    let created = round.startTime;
    if (!Number.isFinite(created) || created <= 0) {
      created = Date.now();
    }
    return {
      kind: "agent",
      id: round.channelID,
      stage,
      status,
      round: roundLabel,
      sessionID: round.sessionID,
      time: created,
      messages: round.messages
        .slice()
        .sort((left, right) => messageOrderTime(left) - messageOrderTime(right)),
    };
  }

  // Collect per-goal step cards: goalID → step entries
  const goalStepCards = new Map<string, { stage: string; card: AgentCardData; startTime: number }[]>();

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
          continue;
        }
        // No goal association. For planner/executor/evaluator this is a
        // transient SSE-settling state that resolves when the goalID event
        // arrives — silently drop to avoid a flicker. For "build" it's the
        // task-level fast-path (task-agent routed the request directly to
        // the build agent, bypassing goals) and must render at root,
        // otherwise the card vanishes whenever build is called without a
        // goal context.
        if (stage === "build") {
          const cardID = round.channelID;
          nextCards[cardID] = card;
          nextOrder.push(cardID);
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
  // Goal descriptions are carried on goalWorkflows.contracts or derived from title.
  const goalDescMap = new Map<string, string>();

  // Build per-goal step info from goalWorkflows. `payload` carries the
  // structured content for each step (planNodes / changedFiles / diffStats /
  // checks / verdict / executorSessionID) as emitted by workbench/board.ts.
  const goalStepsMap = new Map<string, Array<{ stepID: string; label: string; status: string; summary?: string; payload?: any }>>();
  for (const gw of boardStore.board?.goalWorkflows || []) {
    goalStepsMap.set(gw.goalID, (gw.steps || []).map((s: any) => ({
      stepID: s.stepID, label: s.label, status: s.status, summary: s.summary, payload: s.payload,
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

    // Skip pending goals with no activity — don't show cards before architect alignment
    if (entries.length === 0 && goalInfo?.status === "pending") {
      continue;
    }

    const groupKey = `goal-group:${gid}`;

    // Note: previously had several devWarn/devError calls here for:
    //   - missing goalInfo in board
    //   - empty title
    //   - active goal with no step entries
    //   - missing goalInfo.status
    //   - missing sessionID
    //   - invalid groupStart
    // All of those describe transient states that resolve as more SSE events
    // arrive (board sync lag, executor session boot, etc.). Because they
    // lived inside a createMemo body driven by SSE updates, each one fired
    // hundreds of times per minute on long tasks and crushed the dev-error
    // overlay. Removed; functional fallbacks (Date.now() etc.) are kept.

    const groupStart = entries.length > 0
      ? Math.min(...entries.map(e => e.startTime))
      : Date.now();

    const groupStatus = entries.length === 0
      ? (goalInfo?.status === "passed" || goalInfo?.status === "failed" ? goalInfo.status : "pending")
      : entries.some(e => e.card.status === "running")
        ? "running"
        : entries.some(e => e.card.status === "error")
          ? "error"
          : "completed";

    const goalSessionID = entries[0]?.card.sessionID;

    const groupCreated = (Number.isFinite(groupStart) && groupStart > 0)
      ? groupStart
      : Date.now();

    nextCards[groupKey] = {
      kind: "goal",
      id: groupKey,
      stage: "executor",
      status: groupStatus,
      round: goalIndexMap.get(gid) ?? 0,
      sessionID: goalSessionID ?? "",
      time: groupCreated,
      goalID: gid,
      goalTitle: goalInfo?.title ?? "",
      goalStatus: goalInfo?.status ?? groupStatus,
      goalDescription: goalDescMap.get(gid) ?? "",
      goalSteps: goalStepsMap.get(gid),
      contracts: goalContractsMap.get(gid),
      internalCards: entries.map(e => e.card),
    };
    nextOrder.push(groupKey);
  }

  // Task-scope stage priority: architect before goal (requirements).
  // Other stages (executor goal groups, etc.) fall through to chronological order.
  const TASK_STAGE_PRIORITY: Record<string, number> = { spec: 0, architect: 1, goal: 2 };

  nextOrder.sort((left, right) => {
    const lCard = nextCards[left];
    const rCard = nextCards[right];
    const lPrio = TASK_STAGE_PRIORITY[lCard?.stage || ""];
    const rPrio = TASK_STAGE_PRIORITY[rCard?.stage || ""];
    if (lPrio !== undefined && rPrio !== undefined && lPrio !== rPrio) {
      return lPrio - rPrio;
    }
    return (lCard?.time ?? 0) - (rCard?.time ?? 0) || left.localeCompare(right);
  });

  return { cards: nextCards, order: nextOrder };
}

// Agent-card derivation: pure synchronous read of messages + agentEvents +
// board. We deliberately do NOT wrap this in createMemo / createRoot — the
// only consumer that benefits from caching is conversationMessages(), which
// already lives inside its own createMemo and only re-runs when its tracked
// dependencies change. Returning a fresh object here also makes test
// assertions deterministic (no dangling memo to flush).
export function agentCards(): Record<string, AgentCardData> {
  return computeAgentCards().cards;
}

export function agentCardOrder(): string[] {
  return computeAgentCards().order;
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
    const bufferedEntry = _pendingParts.get(info.id);
    if (bufferedEntry) _pendingParts.delete(info.id);
    const msg: Message = { info: mergeMessageInfo(undefined, info), parts: bufferedEntry?.parts || [] };
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
      const existing = _pendingParts.get(part.messageID);
      if (existing) {
        existing.parts.push(part);
      } else {
        _pendingParts.set(part.messageID, { parts: [part], created: Date.now() });
      }
      // Prune stale orphaned entries
      prunePendingParts();
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

  // Stop animation timers for events that no longer exist.
  const liveKeys = new Set(kept.map((event) => agentEventKey(event)));
  for (const key of [...agentLiveTimers.keys()]) {
    if (!liveKeys.has(key)) stopAgentLiveTimer(key);
  }

  // Drop _agentMsgCache entries for events that no longer exist. Without
  // this, the cache grows unbounded on long tasks (one entry per unique
  // stableKey ever produced) — agentEvents itself is bounded by the
  // per-stage 12-event cap above, but the cache wasn't.
  // Uses agentMessageStableKey() so the formula matches what agentMessage()
  // wrote when populating the cache.
  if (_agentMsgCache.size > 0) {
    const cacheKeys = new Set<string>();
    for (const event of kept) {
      const sk = agentMessageStableKey(event);
      if (sk) cacheKeys.add(sk);
    }
    for (const cachedKey of [..._agentMsgCache.keys()]) {
      if (!cacheKeys.has(cachedKey)) _agentMsgCache.delete(cachedKey);
    }
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
