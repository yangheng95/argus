// ── Conversation utilities ──
// Assembles the full conversation view from Solid stores: real messages,
// board context (spec/plan/evaluation/delivery), executor events, and
// agent cards. All data is read from reactive stores.

import { messageStore } from "../store/messages";
import { boardStore } from "../store/board";
import { phaseFromAgent, phaseFromMessage } from "./message";
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
  if (status === "planning") return new Set(["spec", "planner"]);
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

// ── Internal: hashText ──

function hashText(value: string): string {
  const text = String(value || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

// ── Internal: signPart ──

function signText(value: any): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) || "";
  } catch {
    return String(value ?? "");
  }
}

function signPart(part: any): string {
  if (!part || typeof part !== "object") return signText(part);
  if (part.type === "text" || part.kind === "trace") {
    if (typeof part._targetText === "string") {
      return ["text", part.id || "", "streaming"].join("\u001f");
    }
    return [
      "text",
      part.kind || "",
      part.source || "",
      part.audience?.ui === false ? "0" : "1",
      part.text || "",
    ].join("\u001f");
  }
  if (part.type === "tool") {
    const st = part.state && typeof part.state === "object" ? part.state : {};
    if (st.status === "pending" && typeof part._targetRaw === "string") {
      return ["tool", part.tool || "", "streaming", part.id || ""].join("\u001f");
    }
    return [
      "tool",
      part.tool || "",
      st.status || "",
      signText(st.input || {}),
      signText(st.output || ""),
      st.title || "",
    ].join("\u001f");
  }
  if (part.type === "reasoning") {
    if (typeof part._targetText === "string") {
      return ["reasoning", part.id || "", "streaming"].join("\u001f");
    }
    const hidden =
      part.collapsed === true ||
      (part.collapsed == null && !part.text?.trim()) ||
      part.audience?.ui === false;
    return ["reasoning", hidden ? "0" : "1", part.text || ""].join("\u001f");
  }
  if (part.type === "patch") {
    return ["patch", ...(Array.isArray(part.files) ? part.files : [])].join("\u001f");
  }
  if (part.type === "file") {
    return ["file", part.filename || "", part.url || "", part.mime || part.mediaType || ""].join(
      "\u001f",
    );
  }
  return signText(part);
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
  const transcriptMessages = preClassifiedMainMessages.length > 0
    ? preClassifiedMainMessages
    : Array.isArray(messages) ? messages : [];
  const hasStageMessage = (stage: string) =>
    transcriptMessages.some(
      (message: any) =>
        message?.info?.role !== "user" &&
        (effectiveRole(message) === stage ||
          phaseFromMessage(message) === phaseFromAgent(stage)),
    );

 // 1. User request — show the original task request as a "user" turn
  if (task?.request && !hasConversationRequest(messages || [], task.request)) {
    syntheticMsgs.push({
      _synthetic: true,
      info: { role: "user", time: { created: (task.time?.created || 0) - 2 } },
      parts: [{ type: "text", text: task.request }],
    });
  }

  if (board.spec && !liveStages.has("spec") && !hasStageMessage("spec")) {
    const message = syntheticTextMessage(
      "spec",
      board.spec.time?.created || task?.time?.updated || Date.now(),
      specContextText(board.spec),
    );
    if (message) syntheticMsgs.push(message);
  }
  if (plan && !liveStages.has("planner") && !hasStageMessage("planner")) {
    const goals = (lanes || []).find((lane: any) => lane.id === "goals")?.cards || [];
    const message = syntheticTextMessage(
      "planner",
      plan.time?.created || task?.time?.updated || Date.now(),
      planContextText(plan, goals),
    );
    if (message) syntheticMsgs.push(message);
  }

  for (const interaction of Array.isArray(board.interactions) ? board.interactions : []) {
    const request = syntheticTextMessage(
      "system",
      interaction.time?.created || Date.now(),
      interactionRequestText(interaction),
    );
    if (request) syntheticMsgs.push(request);
    if (interaction.status === "answered" || interaction.status === "rejected") {
      const response = syntheticTextMessage(
        "user",
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

export function conversationMessages(): any[] {
  const allMessages = messageStore.messages || [];
  const agentEvents = Array.isArray(messageStore.agentEvents) ? messageStore.agentEvents : [];
  const board = boardStore.board;
  const selectedTaskID = boardStore.selectedTaskID;
  const showTranscriptDetails = messageStore.showTranscriptDetails;

 // Classify messages into main conversation vs agent channels.
 // Key by stage:sessionID so different rounds of the same agent get separate cards.
  const mainMessages: any[] = [];
  const agentChannels: Record<string, { stage: string; messages: any[]; startTime: number; endTime: number }> = {};

  for (const msg of allMessages) {
    const channel = classifyMessage(msg);
    if (channel === "main") {
      mainMessages.push(msg);
    } else {
      const sessionID = msg.info?.sessionID || "";
      const key = `${channel}:${sessionID}`;
      if (!agentChannels[key]) {
        agentChannels[key] = { stage: channel, messages: [], startTime: Infinity, endTime: 0 };
      }
      agentChannels[key].messages.push(msg);
      const created = msg.info?.time?.created || 0;
      if (created < agentChannels[key].startTime) agentChannels[key].startTime = created;
      const completed = msg.info?.time?.completed || created;
      if (completed > agentChannels[key].endTime) agentChannels[key].endTime = completed;
    }
  }

 // Build board context and executor messages AFTER classification
 // so we can pass pre-classified main messages (avoids double classification).
  const boardMsgs = buildBoardContextMessages(mainMessages, board, agentEvents, allMessages as any[]);
  const executorMsgs = buildExecutorMessages();

 // Filter orchestrator boilerplate from main messages when board context is available
  let filteredMain = mainMessages;
  if (!showTranscriptDetails && boardMsgs.length > 0 && filteredMain.length > 0) {
    filteredMain = filteredMain.filter((message: any) => {
      const text = (message.parts || []).map((part: any) => part.text || "").join("");
      return (
        !text.includes("<assistant-brief>") &&
        !text.includes("You are executing a headless coding task")
      );
    });
  }

 // Group rounds per stage, sorted by time, to assign round numbers and status
  const stageRounds: Record<string, Array<{ key: string; channel: typeof agentChannels[string] }>> = {};
  for (const [key, channel] of Object.entries(agentChannels)) {
    if (channel.messages.length === 0) continue;
    if (!stageRounds[channel.stage]) stageRounds[channel.stage] = [];
    stageRounds[channel.stage].push({ key, channel });
  }
  const transcriptStages = new Set(
    Object.values(agentChannels)
      .filter((channel) => channel.messages.length > 0)
      .map((channel) => channel.stage),
  );
  for (const rounds of Object.values(stageRounds)) {
    rounds.sort((a, b) => a.channel.startTime - b.channel.startTime);
  }

 // Create synthetic agent-card messages — one card per round per stage
  const agentCardMsgs: any[] = [];
  const allAgentEvents = Array.isArray(messageStore.agentEvents) ? messageStore.agentEvents : [];
  for (const [stage, rounds] of Object.entries(stageRounds)) {
    for (let i = 0; i < rounds.length; i++) {
      const { key, channel } = rounds[i];
      const isLastRound = i === rounds.length - 1;
      let cardStatus: string;
      if (!isLastRound) {
 // Earlier rounds must be done — otherwise a new round wouldn't have started
        cardStatus = "completed";
      } else {
 // Last round: check agent events within this round's time window only
        const stageEvents = allAgentEvents.filter(
          (e: any) =>
            String(e?.stage || "").toLowerCase() === stage &&
            (e.timestamp || 0) >= channel.startTime,
        );
        const isFinished = stageEvents.some(
          (e: any) => e.kind === "status" && /finished|completed|done/i.test(e?.summary || ""),
        );
        const isError = stageEvents.some((e: any) => e.kind === "error") && !isFinished;
        cardStatus = isError ? "error" : isFinished ? "completed" : "running";
      }
      const roundLabel = rounds.length > 1 ? i + 1 : 0; // 0 = single round, don't show number
      agentCardMsgs.push({
        _synthetic: true,
        _agentCard: true,
        _agentStage: stage,
        _agentStatus: cardStatus,
        _agentRound: roundLabel,
        _agentCardKey: key,
        _agentMessages: channel.messages,
        info: {
          role: "agent-card",
          agent: stage,
          time: { created: channel.startTime === Infinity ? Date.now() : channel.startTime },
        },
        parts: [],
      });
    }
  }

  const liveAgentMsgs = buildAgentMessages(transcriptStages);

  return [...filteredMain, ...liveAgentMsgs, ...executorMsgs, ...boardMsgs, ...agentCardMsgs].sort(
    (a: any, b: any) => (a.info?.time?.created || 0) - (b.info?.time?.created || 0),
  );
}

// ── Public: groupMessagesByRole ──

export function groupMessagesByRole(sorted: any[]): Array<{ role: string; messages: any[] }> {
  const groups: Array<{ role: string; messages: any[] }> = [];
  for (const msg of sorted) {
 // Agent card placeholders are always isolated groups
    if (msg._agentCard) {
      groups.push({ role: "agent-card", messages: [msg] });
      continue;
    }

    const role = effectiveRole(msg);
    const parts = msg.parts || [];
 // Skip completely empty messages
    if (parts.length === 0) continue;

 // Synthetic board turns should remain isolated so spec, git checkpoints,
 // and interaction prompts show up as distinct lifecycle events.
    if (msg._synthetic) {
      groups.push({ role, messages: [msg] });
      continue;
    }

 // For assistant messages, each message is a separate step — don't merge them.
 // This preserves the step-by-step flow of agent execution.
    if (role === "assistant") {
      groups.push({ role, messages: [msg] });
      continue;
    }

    const last = groups[groups.length - 1];
    if (last && last.role === role) {
      last.messages.push(msg);
    } else {
      groups.push({ role, messages: [msg] });
    }
  }
  return groups;
}

// ── Public: signGroup ──

export function signGroup(group: { role: string; messages: any[] }): string {
 // Agent cards: sign based on stage, status, and inner message count + latest part signatures
  if (group.role === "agent-card") {
    const card = group.messages[0];
    const innerMsgs = card?._agentMessages || [];
    const lastMsg = innerMsgs[innerMsgs.length - 1];
    const lastParts = Array.isArray(lastMsg?.parts) ? lastMsg.parts : [];
    return hashText(
      [
        "agent-card",
        card?._agentCardKey || card?._agentStage || "",
        card?._agentStatus || "",
        String(innerMsgs.length),
        ...lastParts.map(signPart),
      ].join("\u001d"),
    );
  }
  return hashText(
    [
      group.role,
      ...group.messages.map((message: any) =>
        [
          message._synthetic ? "1" : "0",
          message.info?.time?.created || 0,
          ...(Array.isArray(message.parts) ? message.parts : []).map(signPart),
        ].join("\u001e"),
      ),
    ].join("\u001d"),
  );
}

// ── Public: chatPlaceholder ──
// Returns the first placeholder assistant message, or undefined if none.
// The boolean-like presence test is: !!chatPlaceholder(messages).

export function chatPlaceholder(messages: any[]): any | undefined {
  return (
    messages.find(
      (item: any) =>
        item.info?.role === "assistant" &&
        !item.info?.id &&
        Array.isArray(item.parts) &&
        item.parts.length === 1 &&
        item.parts[0]?.type === "text",
    ) ||
    messages.find(
      (item: any) => item.info?.role === "assistant" && item.parts?.[0]?.text === "……",
    ) ||
    messages.find(
      (item: any) => item.info?.role === "assistant" && item.parts?.[0]?.text === "...",
    ) ||
    messages.find(
      (item: any) =>
        item.info?.role === "assistant" && item.parts?.[0]?.text === t("chat.thinking"),
    )
  );
}

// ── Agent Messages ──
// Agent output goes through the session/message system and is rendered via
// agent cards (classifyMessage → agentChannels → AgentCard component).
// buildAgentMessages intentionally returns [] to avoid duplicating that content
// as standalone conversation messages. This matches the original
// decision (line 5530) after discovering that building synthetic messages from
// agentEvents produced garbled noise alongside real session-persisted messages.

export function agentMessage(_event: any): any | null {
  return null;
}

export function buildAgentMessages(_transcriptStages?: Set<string>): any[] {
  return [];
}
