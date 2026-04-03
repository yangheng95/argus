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

const UNTIMED_CONVERSATION_ORDER = Number.MAX_SAFE_INTEGER;

function conversationTime(message: any): number {
  const created = message?.info?.time?.created;
  if (Number.isFinite(created)) return Number(created);
  const updated = message?.info?.time?.updated;
  if (Number.isFinite(updated)) return Number(updated);
  return UNTIMED_CONVERSATION_ORDER;
}

// ── Internal: build user request + interaction messages ──

function buildUserContextMessages(): any[] {
  const board = boardStore.board;
  if (!board) return [];
  const msgs: any[] = [];
  const { task } = board;

  // 1. User's original task request
  if (task?.request) {
    msgs.push({
      _synthetic: true,
      info: { id: "ctx:user-request", role: "user", resolvedRole: "user", channel: "main", time: { created: (task.time?.created || 0) - 2 } },
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

    const isPlannerClarification = interaction.payload?.planner_clarification === true;
    const interactionRole = isPlannerClarification ? "planner" : "system";
    const request = syntheticTextMessage(
      interactionRole,
      interaction.time?.created || Date.now(),
      interactionRequestText(interaction),
    );
    if (request) msgs.push(request);
    if (interaction.status === "answered" || interaction.status === "rejected") {
      const response = syntheticTextMessage(
        isPlannerClarification ? "user" : "system",
        interaction.time?.resolved || interaction.time?.updated || Date.now(),
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
  const agentCardMsgs: any[] = [];
  const currentOrder = agentCardOrder();
  const currentCards = agentCards();
  for (const id of currentOrder) {
    const card = currentCards[id];
    if (!card) continue;
    if (card._agentGoalGroup && Array.isArray(card._agentInternalCards)) {
      // Goal groups: resolve messages inside each internal step card so SolidJS
      // reactivity works, then keep the card structure for per-step rendering.
      const resolvedChildren = card._agentInternalCards.map((child: any) => {
        if (!Array.isArray(child._agentMessages)) return child;
        const resolved = child._agentMessages.map((m: any) => resolveMessage(m));
        resolved.sort((a: any, b: any) => conversationTime(a) - conversationTime(b));
        return { ...child, _agentMessages: resolved };
      });
      agentCardMsgs.push({ ...card, _agentInternalCards: resolvedChildren });
    } else if (Array.isArray(card._agentMessages) && card._agentMessages.length > 0) {
      // All agent card stages (goal, architect, planner, executor, evaluator,
      // delivery, spec) are kept as collapsible AgentCard items.
      const resolved = card._agentMessages.map((m: any) => resolveMessage(m));
      resolved.sort((a: any, b: any) => conversationTime(a) - conversationTime(b));
      agentCardMsgs.push({
        ...card,
        _agentMessages: resolved,
      });
    }
  }

  const result = [...filteredMain, ...contextMsgs, ...agentCardMsgs].sort(
    (a: any, b: any) => conversationTime(a) - conversationTime(b),
  );

  return result;
}
