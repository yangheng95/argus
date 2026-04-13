// ── Conversation utilities ──
// Assembles the conversation view from the message store.
// All data is read from Solid stores (messageStore / boardStore) for reactivity.

import { messageStore, messageById, agentCards, agentCardOrder } from "../store/messages";

/** Resolve an agent card message to its live store proxy when available.
 *  Agent card _agentMessages are snapshots in a separate SolidJS store path;
 *  part status updates (running→completed) don't propagate to those copies.
 *  Looking up by ID from store.messages returns the canonical proxy where
 *  fine-grained reactivity works correctly. Synthetic messages (from live
 *  agent events, not in store.messages) are returned as-is. */
function resolveMessage(m: any): any {
  const id = m?.info?.id;
  if (typeof id === "string" && id) {
    const live = messageById(id);
    if (live) return live;
  }
  return m;
}
import { boardStore, rootTaskSessionID } from "../store/board";
import { classifyMessage } from "./message";
import {
  syntheticTextMessage,
  interactionRequestText,
  interactionResponseText,
  isAutoReplied,
} from "./transcript";

// Per-card resolution cache: keyed by card ID, stores fingerprint + resolved object.
// When card structure hasn't changed (same message count, status, children),
// we return the cached resolved card instead of re-spreading/re-sorting.
const _cardResolveCache = new Map<string, { fp: string; resolved: any }>();

function cardFingerprint(card: any): string {
  const msgs = card._agentMessages || [];
  const children = card._agentInternalCards || [];
  const childMsgCount = children.reduce(
    (acc: number, c: any) => acc + (c._agentMessages?.length || 0),
    0,
  );
  // Include step statuses: they change (pending→running→completed) independently
  // of message count. Without this, cached cards show stale step progress.
  const steps = (card._agentGoalSteps || []).map((s: any) => s.status || "").join(",");
  const contractCount = card._agentContracts?.length || 0;
  return `${msgs.length}:${children.length}:${childMsgCount}:${card._agentStatus || ""}:${card._agentGoalStatus || ""}:${steps}:${contractCount}`;
}

const UNTIMED_CONVERSATION_ORDER = Number.MAX_SAFE_INTEGER;

function conversationTime(message: any): number {
  const created = message?.info?.time?.created;
  if (Number.isFinite(created)) return Number(created);
  const updated = message?.info?.time?.updated;
  if (Number.isFinite(updated)) return Number(updated);
  return UNTIMED_CONVERSATION_ORDER;
}

// ── Internal: build user request + interaction messages ──
//
// Note: this function is called from conversationMessages() which is itself
// reactive — it re-runs whenever board state changes. Several timestamp
// fallbacks below were previously paired with devWarn() calls, but those
// fired on every recompute (SSE-driven, hundreds of times per minute) and
// crushed the dev-error overlay during long tasks. The fallbacks remain;
// the warnings were removed. Real timestamp validation should happen at
// mutation time in setBoard / appendInteraction, not here in the derived
// view layer.

function buildUserContextMessages(): any[] {
  const board = boardStore.board;
  if (!board) return [];
  const msgs: any[] = [];
  const { task } = board;

  // 1. User's original task request
  if (task?.request) {
    const rawCreated = task.time?.created;
    const taskCreated = (Number.isFinite(rawCreated) && rawCreated) ? Number(rawCreated) : 0;
    msgs.push({
      _synthetic: true,
      info: { id: "ctx:user-request", role: "user", resolvedRole: "user", channel: "main", time: { created: taskCreated - 2 } },
      parts: [{ type: "text", text: task.request }],
    });
  }

  // 2. Interactions (permissions, questions, clarifications)
  for (const interaction of Array.isArray(board.interactions) ? board.interactions : []) {
    const isAutoPermission =
      interaction.type === "permission" &&
      (interaction.status === "answered" || interaction.status === "rejected") &&
      isAutoReplied(interaction);
    if (isAutoPermission) continue;

    const interactionRole = "system";

    const rawRequestTime = interaction.time?.created;
    const requestTime = (Number.isFinite(rawRequestTime) && rawRequestTime)
      ? Number(rawRequestTime)
      : Date.now();
    const request = syntheticTextMessage(
      interactionRole,
      requestTime,
      interactionRequestText(interaction),
    );
    if (request) msgs.push(request);
    if (interaction.status === "answered" || interaction.status === "rejected") {
      const rawResolvedTime = interaction.time?.resolved ?? interaction.time?.updated;
      const resolvedTime = (Number.isFinite(rawResolvedTime) && rawResolvedTime)
        ? Number(rawResolvedTime)
        : Date.now();
      const response = syntheticTextMessage(
        "system",
        resolvedTime,
        interactionResponseText(interaction),
      );
      if (response) msgs.push(response);
    }
  }

  return msgs;
}

// ── Public: conversationMessages ──

export function conversationMessages(): any[] {
  const allMessages = messageStore.messages || [];
  const rootSID = rootTaskSessionID();
  const showTranscriptDetails = messageStore.showTranscriptDetails;

  // Main conversation messages (non-card channels).
  const mainMessages: any[] = [];

  for (const msg of allMessages) {
    const channel = msg.info?.channel || classifyMessage(msg, rootSID);
    if (channel === "main") {
      mainMessages.push(msg);
    }
  }

  // Filter assistant boilerplate when not in transcript detail mode
  let filteredMain = mainMessages;
  if (!showTranscriptDetails && filteredMain.length > 0) {
    filteredMain = filteredMain.filter((message: any) => {
      // Backend already filters child session user messages via channel="filtered",
      // but for messages without _overlay (e.g. synthetic), apply legacy filters
      const text = (message.parts || []).map((part: any) => part.text || "").join("");
      if (
        text.includes("<assistant-brief>") ||
        text.includes("You are executing a headless coding task")
      ) return false;
      return true;
    });
  }

  // User request + interaction messages from board state
  const contextMsgs = buildUserContextMessages();

  // Agent card messages — all AGENT_CARD_STAGES render as collapsible AgentCard.
  // Parallel executor goal groups get ExecutorGoalGroup rendering.
  //
  // Per-card resolution cache: avoids recreating resolved objects when the
  // underlying card data hasn't structurally changed (same message count,
  // same status). This eliminates the majority of spread/sort allocations
  // during streaming where only text content changes, not card structure.
  const agentCardMsgs: any[] = [];
  const currentOrder = agentCardOrder();
  const currentCards = agentCards();
  const staleKeys = new Set(_cardResolveCache.keys());
  for (const id of currentOrder) {
    const card = currentCards[id];
    if (!card) continue;
    staleKeys.delete(id);
    const fp = cardFingerprint(card);
    const cached = _cardResolveCache.get(id);
    if (cached && cached.fp === fp) {
      agentCardMsgs.push(cached.resolved);
      continue;
    }
    let resolved: any;
    if (card._agentGoalGroup && Array.isArray(card._agentInternalCards)) {
      const resolvedChildren = card._agentInternalCards.map((child: any) => {
        if (!Array.isArray(child._agentMessages)) return child;
        const msgs = child._agentMessages.map((m: any) => resolveMessage(m));
        msgs.sort((a: any, b: any) => conversationTime(a) - conversationTime(b));
        return { ...child, _agentMessages: msgs };
      });
      resolved = { ...card, _agentInternalCards: resolvedChildren };
    } else if (Array.isArray(card._agentMessages) && card._agentMessages.length > 0) {
      const msgs = card._agentMessages.map((m: any) => resolveMessage(m));
      msgs.sort((a: any, b: any) => conversationTime(a) - conversationTime(b));
      resolved = { ...card, _agentMessages: msgs };
    } else {
      continue;
    }
    _cardResolveCache.set(id, { fp, resolved });
    agentCardMsgs.push(resolved);
  }
  // Evict cache entries for cards that no longer exist
  for (const key of staleKeys) _cardResolveCache.delete(key);

  const result = [...filteredMain, ...contextMsgs, ...agentCardMsgs].sort(
    (a: any, b: any) => conversationTime(a) - conversationTime(b),
  );

  return result;
}
