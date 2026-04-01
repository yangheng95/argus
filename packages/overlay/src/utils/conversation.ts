// ── Conversation utilities ──
// Assembles the conversation view from the message store.
// All data is read from Solid stores (messageStore / boardStore) for reactivity.

import { messageStore, messageById } from "../store/messages";
import { boardStore, rootTaskSessionID } from "../store/board";
import { classifyMessage } from "./message";
import { t } from "./i18n";
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

let _prevConversationResult: any[] = [];
let _prevConversationKey = "";

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

  // Filter orchestrator boilerplate when not in transcript detail mode
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

  // Flatten agent card messages into the timeline.
  // Exception: parallel executor goal groups stay grouped to avoid cross-goal confusion.
  const agentCardMsgs: any[] = [];
  for (const id of Array.isArray(messageStore.agentCardOrder) ? messageStore.agentCardOrder : []) {
    const card = messageStore.agentCards[id];
    if (!card) continue;
    if (card._agentGoalGroup && Array.isArray(card._agentInternalCards)) {
      // Parallel goals: keep as a group item but flatten internal card messages
      // Resolve via messageById to get live store proxies (not stale agent card copies)
      const flatMsgs: any[] = [];
      for (const child of card._agentInternalCards) {
        if (Array.isArray(child._agentMessages)) {
          for (const m of child._agentMessages) {
            const live = m?.info?.id ? messageById(m.info.id) : undefined;
            if (live) flatMsgs.push(live);
          }
        }
      }
      flatMsgs.sort((a: any, b: any) => conversationTime(a) - conversationTime(b));
      agentCardMsgs.push({ ...card, _agentMessages: flatMsgs });
    } else if (Array.isArray(card._agentMessages)) {
      // Resolve via messageById to get live store proxies
      for (const m of card._agentMessages) {
        const live = m?.info?.id ? messageById(m.info.id) : undefined;
        if (live) agentCardMsgs.push(live);
      }
    }
  }

  const result = [...filteredMain, ...contextMsgs, ...agentCardMsgs].sort(
    (a: any, b: any) => conversationTime(a) - conversationTime(b),
  );

  // Referential stability for Solid's <Index>
  const key = result.map((m: any) => m.info?.id || m._agentCardKey || "").join(",");
  if (key === _prevConversationKey && result.length === _prevConversationResult.length) {
    return _prevConversationResult;
  }
  _prevConversationKey = key;
  _prevConversationResult = result;
  return result;
}
