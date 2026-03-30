// ── Conversation utilities ──
// Assembles the full conversation view from Solid stores: real messages,
// board context (spec/plan/evaluation/delivery), executor events, and
// agent cards. All data is read from reactive stores.

import { messageStore } from "../store/messages";
import { boardStore } from "../store/board";
import { stripAssistantBrief } from "./string";
import { t } from "./i18n";
import {
  syntheticTextMessage,
  specContextText,
  planContextText,
  goalContextText,
  evaluationContextText,
  interactionRequestText,
  interactionResponseText,
  isAutoReplied,
} from "./transcript";
import { gitCheckpointText, boardGitCheckpoints } from "./git";
import {
  buildExecutorMessages,
} from "./executor-events";

// ── Constants ──

const AGENT_STAGES = new Set(["spec", "planner", "goal", "judge", "delivery"]);

// ── Internal: rootTaskSessionID ──

function rootTaskSessionID(): string {
  const sessionID = boardStore.board?.task?.sessionID;
  return typeof sessionID === "string" ? sessionID : "";
}

// ── Internal: classifyMessage ──

function classifyMessage(msg: any): string {
  const agent = String(msg?.info?.agent || "").trim().toLowerCase();
  if (AGENT_STAGES.has(agent)) {
    if (String(msg?.info?.role || "").trim().toLowerCase() === "user") return "main";
    return agent;
  }
  // Legacy: messages with agent="agent" from child sessions — separate from main
  if (agent === "agent") {
    const rootSession = rootTaskSessionID();
    const sessionID = typeof msg?.info?.sessionID === "string" ? msg.info.sessionID : "";
    if (rootSession && sessionID && sessionID !== rootSession) {
      return "agent";
    }
  }
  return "main";
}

// ── Internal: activeAgentStages ──
// Reads from messageStore (agentEvents) and boardStore (board.task.status).

function activeAgentStages(): Set<string> {
  const status = String(boardStore.board?.task?.status || "").trim().toLowerCase();
  if (status === "spec_generating") return new Set(["spec"]);
  if (status === "goal_decomposing") return new Set(["goal"]);
  if (status === "planning") return new Set(["planner"]);
  if (status === "evaluating") return new Set(["judge"]);
  if (status === "delivering") return new Set(["delivery"]);
  const agentEvents = Array.isArray(messageStore.agentEvents) ? messageStore.agentEvents : [];
  if (!status && agentEvents.length > 0) {
    return new Set(agentEvents.map((item: any) => String(item?.stage || "").trim().toLowerCase()).filter(Boolean));
  }
  return new Set();
}

// ── Internal: effectiveRole (local version for conversation context) ──
// Simplified: reads role from info directly (used for board context filtering only).

function effectiveRole(message: any): string {
  return message?.info?.role || "assistant";
}

// ── Internal: normalizeConversationText ──

function normalizeConversationText(text: any): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

// ── Internal: messageConversationText ──

function messageConversationText(message: any): string {
  const role = effectiveRole(message);
  return normalizeConversationText(
    (message.parts || [])
      .flatMap((part: any) => {
        if (part?.type !== "text") return [];
        if (part.audience && part.audience.ui === false) return [];
        if (part.kind === "trace" && !part.audience?.ui) return [];
        const text = typeof part.text === "string" ? part.text : "";
        if (!text.trim()) return [];
        if (
          ["user", "planner", "scheduler", "system"].includes(role) &&
          text.includes("<assistant-brief>")
        ) {
          const cleaned = stripAssistantBrief(text);
          return cleaned ? [cleaned] : [];
        }
        return [text];
      })
      .join("\n"),
  );
}

// ── Internal: hasConversationRequest ──

function hasConversationRequest(messages: any[], request: string): boolean {
  const target = normalizeConversationText(request);
  if (!target) return false;
  return messages.some(
    (message: any) =>
      effectiveRole(message) === "user" && messageConversationText(message) === target,
  );
}

function messageTime(message: any): number {
  return Number(message?.info?.time?.created || message?.info?.time?.updated || 0);
}

function deliveryStatusLabel(status: string): string {
  return status || "";
}

// ── Public: buildBoardContextMessages ──
// preClassifiedMainMessages: already-classified main-channel messages.
// board: board data object (state.board equivalent).
// agentEvents: agent events array (state.agentEvents equivalent).
// messages: full messages array for hasConversationRequest check.

export function buildBoardContextMessages(
  preClassifiedMainMessages: any[],
  board: any,
  agentEvents: any[],
  messages: any[],
): any[] {
  if (!board) return [];
  const syntheticMsgs: any[] = [];
  const { task, plan, evaluation, delivery, lanes } = board;
  const activeStages = activeAgentStages();
  const liveStages = new Set(
    (Array.isArray(agentEvents) ? agentEvents : [])
      .map((event: any) => String(event?.stage || "").trim().toLowerCase())
      .filter((stage: string) => activeStages.has(stage)),
  );
 // 1. User request — show the original task request as a "user" turn
  if (task?.request && !hasConversationRequest(messages || [], task.request)) {
    syntheticMsgs.push({
      _synthetic: true,
      info: { role: "user", time: { created: (task.time?.created || 0) - 2 } },
      parts: [{ type: "text", text: task.request }],
    });
  }

  if (board.spec && !liveStages.has("spec")) {
    const message = syntheticTextMessage(
      "spec",
      board.spec.time?.created || task?.time?.updated || Date.now(),
      specContextText(board.spec),
    );
    if (message) syntheticMsgs.push(message);
  }
  if (plan && !liveStages.has("planner")) {
    const goals = (lanes || []).find((lane: any) => lane.id === "goals")?.cards || [];
    const message = syntheticTextMessage(
      "planner",
      plan.time?.created || task?.time?.updated || Date.now(),
      planContextText(plan, goals),
    );
    if (message) syntheticMsgs.push(message);
  }

  for (const interaction of Array.isArray(board.interactions) ? board.interactions : []) {
    // Hide auto-resolved permission interactions (they flash "blocked" for 0 seconds)
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
    if (request) syntheticMsgs.push(request);
    if (interaction.status === "answered" || interaction.status === "rejected") {
      const response = syntheticTextMessage(
        isPlannerClarification ? "user" : "system",
        interaction.time?.resolved || interaction.time?.updated || Date.now(),
        interactionResponseText(interaction),
      );
      if (response) syntheticMsgs.push(response);
    }
  }

 // 3. Goals — show goal status as a "goal_gate" turn
  for (const item of boardGitCheckpoints(board)) {
    const message = syntheticTextMessage("system", item.time, gitCheckpointText(item));
    if (message) syntheticMsgs.push(message);
  }

  const goalsLane = (lanes || []).find((lane: any) => lane.id === "goals");
  const goals = goalsLane?.cards || [];
  if (goals.length > 0) {
    const goalTime = evaluation?.time?.created || task?.time?.updated || Date.now();
    const message = syntheticTextMessage("goal_gate", goalTime - 1, goalContextText(goals));
    if (message) syntheticMsgs.push(message);
  }

 // 4. Evaluation verdict — show as "scheduler" turn
  if (evaluation?.verdict) {
    const message = syntheticTextMessage(
      "scheduler",
      evaluation.time?.created || Date.now(),
      evaluationContextText(board, goals),
    );
    if (message) syntheticMsgs.push(message);
  }

 // 5. Delivery summary — show as "assistant" turn if delivery was accepted
  const finalDelivery = board.acceptedDelivery || delivery;
  if (finalDelivery?.summary && finalDelivery.status !== "candidate") {
    const message = syntheticTextMessage(
      "assistant",
      (finalDelivery.time?.created || Date.now()) + 1,
      `**${t("detail.delivery")} (${deliveryStatusLabel(finalDelivery.status)})**\n\n${finalDelivery.summary}`,
    );
    if (message) syntheticMsgs.push(message);
  }

  return syntheticMsgs;
}

// ── Public: conversationMessages ──
// All data is read from Solid stores (messageStore / boardStore) to match
// the reactive pull model.

let _prevConversationResult: any[] = [];
let _prevConversationKey = "";

export function conversationMessages(): any[] {
  const allMessages = messageStore.messages || [];
  const agentEvents = Array.isArray(messageStore.agentEvents) ? messageStore.agentEvents : [];
  const board = boardStore.board;
  const showTranscriptDetails = messageStore.showTranscriptDetails;

 // Classify messages into main conversation only.
 // Agent cards are maintained as stable store entities in messageStore.
  const mainMessages: any[] = [];

  for (const msg of allMessages) {
    const channel = classifyMessage(msg);
    if (channel === "main") {
      mainMessages.push(msg);
    }
  }

 // Build board context and executor messages AFTER classification
 // so we can pass pre-classified main messages (avoids double classification).
  const boardMsgs = buildBoardContextMessages(mainMessages, board, agentEvents, allMessages as any[]);
  const executorMsgs = buildExecutorMessages();

 // Filter orchestrator boilerplate from main messages when board context is available
  let filteredMain = mainMessages;
  if (!showTranscriptDetails && boardMsgs.length > 0 && filteredMain.length > 0) {
    const rootSID = rootTaskSessionID();
    filteredMain = filteredMain.filter((message: any) => {
      const text = (message.parts || []).map((part: any) => part.text || "").join("");
      if (
        text.includes("<assistant-brief>") ||
        text.includes("You are executing a headless coding task")
      ) return false;
      // Hide orchestrator-generated user prompts on child sessions
      // (e.g. "Explore the repository structure..." sent to executor)
      const role = message.info?.role || "";
      const sid = message.info?.sessionID || "";
      if (role === "user" && rootSID && sid && sid !== rootSID) return false;
      return true;
    });
  }

  const agentCardMsgs = (Array.isArray(messageStore.agentCardOrder)
    ? messageStore.agentCardOrder
        .map((id: string) => messageStore.agentCards[id])
        .filter(Boolean)
    : []) as any[];

  const result = [...filteredMain, ...executorMsgs, ...boardMsgs, ...agentCardMsgs].sort(
    (a: any, b: any) => (a.info?.time?.created || 0) - (b.info?.time?.created || 0),
  );

  // Referential stability: return cached array if same items in same order
  const key = result.map((m: any) => m.info?.id || m._agentCardKey || "").join(",");
  if (key === _prevConversationKey && result.length === _prevConversationResult.length) {
    // Same IDs in same order — reuse previous array reference to avoid
    // triggering downstream <Index> signal updates
    return _prevConversationResult;
  }
  _prevConversationKey = key;
  _prevConversationResult = result;
  return result;
}
