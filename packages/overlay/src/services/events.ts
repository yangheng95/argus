// ── SSE Event Router & Board/Task Lifecycle ──
// Central dispatch for all incoming SSE events.
// Executor events (run.progress/run.output) are converted to standard
// message events and routed to messageStore — no separate executorStore.

import {
  enqueueEvent,
  shouldReloadConversationForMessageEvent,
  syncTask,
  loadConversation,
  appendAgentEvent,
} from "../store/messages";
import {
  boardStore,
  scheduleBoard,
  loadTasks,
  setTaskSequence,
} from "../store/board";
import { startSSE } from "./sse";
import { loadConfigInfo } from "./init";

// ── Helpers ──

function record(value: any): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Parse tool input from various executor formats. */
function parseToolInput(raw: any): Record<string, any> {
  if (record(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    try { return JSON.parse(raw); } catch { return { raw }; }
  }
  return {};
}

/** Derive a stable message ID for grouping executor events by goal/session. */
function executorMessageID(properties: any): string {
  const goalRunID = properties.goalRunID || properties.goal_run_id || "";
  const execSessionID = properties.executorSessionID || properties.executor_session_id || "";
  const runID = properties.runID || "";
  const scope = goalRunID || execSessionID || runID || "default";
  return `executor:msg:${scope}`;
}

/** Derive a stable part ID from a tool call's ID. */
function executorPartID(properties: any, eventID: string): string {
  const callID = properties.sourceID || properties.id || properties.payload?.id || eventID;
  return `executor:part:${callID}`;
}

/** Derive the executor session ID for message info. */
function executorSessionID(properties: any): string {
  return properties.sessionID || properties.session_id ||
         properties.goalSessionID || properties.goal_session_id ||
         properties.goalRunSessionID || properties.goal_run_session_id ||
         properties.executorSessionID || properties.executor_session_id ||
         properties.goalRunID || properties.goal_run_id ||
         properties.runID || "";
}

// ── Executor event → message event conversion ──

function convertExecutorEventToMessages(event: any, properties: any): any[] {
  const kind = executorEventKind(properties.type);
  const timestamp = Number(event.timestamp || Date.now());
  const msgID = executorMessageID(properties);
  const sessionID = executorSessionID(properties);
  // Propagate the backend-stamped goalID so computeAgentCards can attach
  // these synthesized executor messages to their goal card. Without this,
  // external-executor tool_call/tool_result events create messages with
  // no goalID and computeAgentCards drops the entire round.
  const goalID =
    typeof properties.goalID === "string" && properties.goalID
      ? properties.goalID
      : typeof event?.goalID === "string" && event.goalID
        ? event.goalID
        : "";

  // Ensure the message exists with executor agent identity
  const messageEvent = {
    type: "message.updated",
    properties: {
      info: {
        id: msgID,
        sessionID,
        role: "assistant",
        resolvedRole: "executor",
        agent: "executor",
        time: { created: timestamp },
        ...(goalID ? { goalID } : {}),
      },
    },
  };

  if (kind === "tool_call") {
    const name = properties.name || properties.payload?.name || properties.tool || "tool";
    const input = parseToolInput(properties.input ?? properties.arguments ?? properties.args ?? properties.payload?.input);
    const partID = executorPartID(properties, event.event_id);
    return [
      messageEvent,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: partID,
            messageID: msgID,
            sessionID,
            type: "tool",
            tool: name,
            callID: properties.sourceID || properties.id || properties.payload?.id || partID,
            state: {
              status: "running",
              input,
              title: event.summary || name,
              metadata: { synthetic: true },
              time: { start: timestamp },
            },
          },
        },
      },
    ];
  }

  if (kind === "tool_result") {
    const name = properties.name || properties.payload?.name || properties.tool || "tool";
    const input = parseToolInput(properties.input ?? properties.arguments ?? properties.payload?.input ?? {});
    const output = typeof properties.output === "string" ? properties.output
      : typeof properties.payload?.output === "string" ? properties.payload.output
      : event.summary || "";
    const partID = executorPartID(properties, event.event_id);
    return [
      messageEvent,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: partID,
            messageID: msgID,
            sessionID,
            type: "tool",
            tool: name,
            callID: properties.sourceID || properties.id || properties.payload?.id || partID,
            state: {
              status: "completed",
              input,
              output,
              title: event.summary || name,
              metadata: { synthetic: true },
              time: { start: timestamp, end: timestamp },
            },
          },
        },
      },
    ];
  }

  if (kind === "message_delta") {
    const text = typeof properties.text === "string" ? properties.text : event.summary || "";
    if (!text) return [];
    const partID = `executor:text:${sessionID}`;
    return [
      messageEvent,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: partID,
            messageID: msgID,
            sessionID,
            type: "text",
            text: "",
          },
        },
      },
      {
        type: "message.part.delta",
        properties: {
          partID,
          messageID: msgID,
          sessionID,
          field: "text",
          delta: text,
        },
      },
    ];
  }

  if (kind === "reasoning_delta") {
    const text = typeof properties.text === "string" ? properties.text : event.summary || "";
    if (!text) return [];
    const partID = `executor:reasoning:${sessionID}`;
    // First event creates the part as "reasoning" type (not "text"), then delta appends.
    // message.part.updated ensures the part exists with correct type before any delta.
    return [
      messageEvent,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: partID,
            messageID: msgID,
            sessionID,
            type: "reasoning",
            text: "",
          },
        },
      },
      {
        type: "message.part.delta",
        properties: {
          partID,
          messageID: msgID,
          sessionID,
          field: "text",
          delta: text,
        },
      },
    ];
  }

  if (kind === "error") {
    const text = event.summary || properties.message || "Error";
    const partID = `executor:error:${event.event_id || timestamp}`;
    return [
      messageEvent,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: partID,
            messageID: msgID,
            sessionID,
            type: "text",
            text: `Error: ${text}`,
          },
        },
      },
    ];
  }

  // Other event types: create a text part with the summary
  if (event.summary) {
    const partID = `executor:status:${event.event_id || timestamp}`;
    return [
      messageEvent,
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: partID,
            messageID: msgID,
            sessionID,
            type: "text",
            text: event.summary,
            kind: "trace",
          },
        },
      },
    ];
  }

  return [];
}

// ── Main router ──

/**
 * Route a parsed SSE event to the appropriate Solid store or action.
 * @returns true if the event was consumed; false if it should be forwarded to
 * handleEventStreamEvent for board/task lifecycle processing.
 */
export function routeSSEEvent(event: any): boolean {
  const type: string = event.type || "";

  // ── Message stream events → batched queue ──
  if (
    type === "message.updated" ||
    type === "message.part.updated" ||
    type === "message.part.delta"
  ) {
    if (shouldReloadConversationForMessageEvent(event)) {
      void loadConversation();
      return true;
    }
    enqueueEvent(event);
    return true;
  }

  // ── Replay buffer expired → full transcript reload ──
  if (type === "task.replay_expired") {
    const taskID: string = boardStore.selectedTaskID || "";
    if (taskID) void syncTask(taskID);
    return true;
  }

  const properties = record(event?.properties)
    ? event.properties
    : record(event?.payload)
      ? event.payload
      : {};

  // ── Executor progress / output events → convert to standard messages ──
  if (type === "run.progress") {
    const progressType: string = properties.type || "";

    // Protocol noise — skip
    if (
      progressType === "protocol.raw" ||
      progressType === "executor.status" ||
      progressType === "executor.progress"
    ) {
      return true;
    }

    // OpenCode executor: these events already arrive via the direct message path.
    // Skip to avoid duplication.
    if (
      progressType === "message.part.updated" ||
      progressType === "message.part.delta" ||
      progressType === "message.updated"
    ) {
      return true;
    }

    // Convert executor events (Codex/Claude-Code CodingEventInfo) to standard messages
    const messages = convertExecutorEventToMessages(event, properties);
    for (const msg of messages) {
      enqueueEvent(msg);
    }
    return true;
  }

  if (type === "run.output") {
    // Text output from executor — convert to message delta
    const messages = convertExecutorEventToMessages(event, {
      ...properties,
      type: "text_delta",
      text: typeof properties.text === "string" ? properties.text : event.summary || "",
    });
    for (const msg of messages) {
      enqueueEvent(msg);
    }
    return true;
  }

  // ── Config changed → refresh appStore.config ──
  if (type === "config.changed") {
    void loadConfigInfo().catch(() => {});
    return true;
  }

  // ── Live agent status / tool activity ──
  if (type === "agent.updated") {
    appendAgentEvent(event);
    return true;
  }

  // ── Board-invalidating events → forwarded to handleEventStreamEvent
  if (
    type === "task.updated" ||
    type === "task.completed" ||
    type === "task.failed" ||
    type === "task.cancelled" ||
    type === "task.blocked" ||
    type.startsWith("run.") ||
    type.startsWith("plan.") ||
    type.startsWith("goal.") ||
    type.startsWith("delivery.") ||
    type.startsWith("evaluation.") ||
    type.startsWith("interaction.")
  ) {
    return false;
  }

  return false;
}

// ── executorEventKind ──

function executorEventKind(progressType: string | undefined): string {
  const t = String(progressType || "").trim().toLowerCase();
  if (!t) return "event";
  if (t === "message_delta" || t === "reasoning_delta") return t;
  if (t === "tool_call" || t === "tool_delta" || t === "tool_result") return t;
  if (t.includes("tool")) return t.includes("result") ? "tool_result" : "tool_call";
  if (t.includes("reason")) return "reasoning_delta";
  if (t.includes("error")) return "error";
  if (t.includes("done") || t.includes("completed")) return "done";
  if (t.includes("approval") || t === "permission.asked") return "approval_request";
  if (t.includes("command")) return "command";
  return "event";
}

// ── Board / Task Lifecycle Event Handling ──

const BOARD_EVENT_DEBOUNCE = 500;

let tasksKickTimer: ReturnType<typeof setTimeout> | null = null;

function normalizedEventType(event: any): string {
  const raw = String(event?.type || "").trim();
  return raw;
}

function eventTaskID(event: any): string {
  return String(event?.properties?.taskID || event?.payload?.taskID || "");
}

function eventSequence(event: any): number {
  const value = Number(event?.sequence);
  return Number.isFinite(value) ? value : 0;
}

function boardInvalidatingEvent(type: string): boolean {
  return (
    type === "task.created" ||
    type === "task.updated" ||
    type === "task.completed" ||
    type === "task.failed" ||
    type === "task.cancelled" ||
    type === "task.blocked" ||
    type.startsWith("run.") ||
    type.startsWith("plan.") ||
    type.startsWith("goal.") ||
    type.startsWith("delivery.") ||
    type.startsWith("evaluation.") ||
    type.startsWith("interaction.") ||
    type.startsWith("workflow.")
  );
}

function scheduleTasksCompat(delay = 0): void {
  if (tasksKickTimer) clearTimeout(tasksKickTimer);
  tasksKickTimer = setTimeout(() => {
    tasksKickTimer = null;
    void loadTasks();
  }, delay);
}

export function handleEventStreamEvent(event: any): void {
  const type = normalizedEventType(event);
  if (type.startsWith("message.")) {
    if (shouldReloadConversationForMessageEvent({ ...event, type })) {
      void loadConversation();
      return;
    }
    enqueueEvent({ ...event, type });
    return;
  }
  if (type === "task.replay_expired") {
    if (boardStore.selectedTaskID) void syncTask(boardStore.selectedTaskID);
    scheduleTasksCompat(0);
    scheduleBoard(0);
    return;
  }
  const taskID = eventTaskID(event);
  const sequence = eventSequence(event);
  if (taskID && taskID === boardStore.selectedTaskID && sequence > 0) {
    const current = boardStore.taskSequence;
    if (current > 0 && sequence <= current) return;
    if (current > 0 && sequence > current + 1) {
      scheduleBoard(BOARD_EVENT_DEBOUNCE);
      scheduleTasksCompat(BOARD_EVENT_DEBOUNCE);
      // Don't restart SSE for sequence gaps — the refresh will catch up.
      // Restarting SSE here causes cascading refreshes that lead to flickering.
    }
    setTaskSequence(sequence);
  }
  if (boardInvalidatingEvent(type)) {
    scheduleTasksCompat(BOARD_EVENT_DEBOUNCE);
    if (taskID && taskID === boardStore.selectedTaskID) {
      scheduleBoard(BOARD_EVENT_DEBOUNCE);
    }
  }
}
