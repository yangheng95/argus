// ── Conversation utilities ──
// Assembles the conversation view from the message store.
// All data is read from Solid stores (messageStore / boardStore) for reactivity.

import { messageStore, messageById, agentCards, agentCardOrder } from "../store/messages";

/** Resolve an agent card message to its live store proxy when available.
 *  Agent card `messages` snapshots live in a separate SolidJS store path;
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
  const msgs = card.messages || [];
  const children = card.internalCards || [];
  const childMsgCount = children.reduce(
    (acc: number, c: any) => acc + (c.messages?.length || 0),
    0,
  );
  // Include step statuses: they change (pending→running→completed) independently
  // of message count. Without this, cached cards show stale step progress.
  const steps = (card.goalSteps || []).map((s: any) => s.status || "").join(",");
  const contractCount = card.contracts?.length || 0;
  return `${msgs.length}:${children.length}:${childMsgCount}:${card.status || ""}:${card.goalStatus || ""}:${steps}:${contractCount}`;
}

const UNTIMED_CONVERSATION_ORDER = Number.MAX_SAFE_INTEGER;

function conversationTime(item: any): number {
  // AgentCardData carries `time` directly; raw Message uses info.time.created.
  if (Number.isFinite(item?.time)) return Number(item.time);
  const created = item?.info?.time?.created;
  if (Number.isFinite(created)) return Number(created);
  const updated = item?.info?.time?.updated;
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
  // task.request + task.attachments are the authoritative representation of
  // the user's input. Render both into a single synthetic bubble — never
  // duplicate by also writing a session message on the backend.
  if (task?.request) {
    const rawCreated = task.time?.created;
    const taskCreated = (Number.isFinite(rawCreated) && rawCreated) ? Number(rawCreated) : 0;
    const parts: any[] = [{ type: "text", text: task.request }];
    const attachments = Array.isArray((task as any).attachments) ? (task as any).attachments : [];
    for (const a of attachments) {
      parts.push({
        type: "file",
        url: a?.url,
        mime: a?.mime,
        filename: a?.filename,
      });
    }
    msgs.push({
      _synthetic: true,
      info: { id: "ctx:user-request", role: "user", resolvedRole: "user", channel: "main", time: { created: taskCreated - 2 } },
      parts,
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

    // Pending questions are rendered inline as an interactive system message
    // (see InteractionQuestionPart). The right-side InteractionPanel handles
    // only permission requests. Answered/rejected questions fall through to
    // the text-based transcript path below.
    if (interaction.type === "question" && interaction.status === "pending") {
      msgs.push({
        _synthetic: true,
        info: {
          id: `ctx:interaction:${interaction.id}`,
          role: interactionRole,
          resolvedRole: interactionRole,
          channel: "main",
          time: { created: requestTime },
        },
        parts: [{ type: "interaction-question", interaction }],
      });
      continue;
    }

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

  // Agent card messages — all AGENT_CARD_STAGES produce collapsible
  // CardNode entries (kind="agent"). Parallel executor goal groups produce
  // CardNode entries (kind="goal") with step children.
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
    if (card.kind === "goal" && Array.isArray(card.internalCards)) {
      const resolvedChildren = card.internalCards.map((child: any) => {
        if (!Array.isArray(child.messages)) return child;
        const msgs = child.messages.map((m: any) => resolveMessage(m));
        msgs.sort((a: any, b: any) => conversationTime(a) - conversationTime(b));
        return { ...child, messages: msgs };
      });
      resolved = { ...card, internalCards: resolvedChildren };
    } else if (card.kind === "agent" && Array.isArray(card.messages) && card.messages.length > 0) {
      const msgs = card.messages.map((m: any) => resolveMessage(m));
      msgs.sort((a: any, b: any) => conversationTime(a) - conversationTime(b));
      resolved = { ...card, messages: msgs };
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
