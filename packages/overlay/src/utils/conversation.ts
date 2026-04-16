// ── Conversation utilities ──
// Assembles the conversation view from the message store.
// All data is read from Solid stores (messageStore / boardStore) for reactivity.

import { messageStore, messageById, computeAgentCards } from "../store/messages";

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

    // Pending interactions render inline as interactive system messages:
    //   - question   → InteractionQuestionPart
    //   - permission → InteractionPermissionPart
    // Answered/rejected fall through to the text-based transcript path below.
    if (interaction.status === "pending") {
      const partType =
        interaction.type === "question"
          ? "interaction-question"
          : interaction.type === "permission"
            ? "interaction-permission"
            : null;
      if (partType) {
        msgs.push({
          _synthetic: true,
          info: {
            id: `ctx:interaction:${interaction.id}`,
            role: interactionRole,
            resolvedRole: interactionRole,
            channel: "main",
            time: { created: requestTime },
          },
          parts: [{ type: partType, interaction }],
        });
        continue;
      }
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
  const _t0 = performance.now();
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

  // Agent card tree — walk recursively so nested sub-agent cards (e.g. build
  // under executor) get the same live-proxy resolution and chronological sort
  // as top-level cards. Messages come directly from the reactive store;
  // resolveMessage() is a no-op for anything already in messageIndex and only
  // matters for synthetic live-event messages.
  const resolveCardTree = (card: any): any => {
    if (!card) return card;
    if (card.kind === "goal" && Array.isArray(card.internalCards)) {
      const children = card.internalCards.map((c: any) => resolveCardTree(c));
      return { ...card, internalCards: children };
    }
    if (card.kind === "agent") {
      const msgs = Array.isArray(card.messages) ? card.messages.map((m: any) => resolveMessage(m)) : [];
      msgs.sort((a: any, b: any) => conversationTime(a) - conversationTime(b));
      const children = Array.isArray(card.children) ? card.children.map((c: any) => resolveCardTree(c)) : [];
      return { ...card, messages: msgs, children };
    }
    return card;
  };

  const agentCardMsgs: any[] = [];
  const computed = computeAgentCards();
  const currentOrder = computed.order;
  const currentCards = computed.cards;
  for (const id of currentOrder) {
    const card = currentCards[id];
    if (!card) continue;
    if (card.kind === "agent") {
      const hasMessages = Array.isArray(card.messages) && card.messages.length > 0;
      const hasChildren = Array.isArray((card as any).children) && (card as any).children.length > 0;
      if (!hasMessages && !hasChildren) continue;
    }
    agentCardMsgs.push(resolveCardTree(card));
  }

  const result = [...filteredMain, ...contextMsgs, ...agentCardMsgs].sort(
    (a: any, b: any) => conversationTime(a) - conversationTime(b),
  );

  const _dt = performance.now() - _t0;
  if (_dt > 5) {
    console.warn(`[perf] conversationMessages: ${_dt.toFixed(1)}ms, ${allMessages.length} msgs`);
  }

  return result;
}
