// ── Conversation utilities ──
// Assembles the conversation view from the message store.
// All data is read from Solid stores (messageStore / boardStore) for reactivity.

import { messageStore } from "../store/messages";
import { rootTaskSessionID } from "../store/board";
import { classifyMessage } from "./message";

// ── Public: conversationMessages ──

let _prevConversationResult: any[] = [];
let _prevConversationKey = "";

export function conversationMessages(): any[] {
  const allMessages = messageStore.messages || [];
  const rootSID = rootTaskSessionID();
  const showTranscriptDetails = messageStore.showTranscriptDetails;

  // Single-source classification: main conversation messages only.
  // Card-stage messages are rendered as AgentCards (maintained in messageStore).
  const mainMessages: any[] = [];

  for (const msg of allMessages) {
    const channel = classifyMessage(msg, rootSID);
    if (channel === "main") {
      mainMessages.push(msg);
    }
  }

  // Filter orchestrator boilerplate when not in transcript detail mode
  let filteredMain = mainMessages;
  if (!showTranscriptDetails && filteredMain.length > 0) {
    filteredMain = filteredMain.filter((message: any) => {
      const text = (message.parts || []).map((part: any) => part.text || "").join("");
      if (
        text.includes("<assistant-brief>") ||
        text.includes("You are executing a headless coding task")
      ) return false;
      // Hide orchestrator-generated user prompts on child sessions
      const role = message.info?.role || "";
      const sid = message.info?.sessionID || "";
      if (role === "user" && rootSID && sid && sid !== rootSID) return false;
      return true;
    });
  }

  // Agent cards from the store
  const agentCardMsgs = (Array.isArray(messageStore.agentCardOrder)
    ? messageStore.agentCardOrder
        .map((id: string) => messageStore.agentCards[id])
        .filter(Boolean)
    : []) as any[];

  const result = [...filteredMain, ...agentCardMsgs].sort(
    (a: any, b: any) => (a.info?.time?.created || 0) - (b.info?.time?.created || 0),
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
