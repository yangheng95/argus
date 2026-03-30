// ── SSE Event Router & Board/Task Lifecycle ──
// Central dispatch for all incoming SSE events plus board/task lifecycle
// processing (handleEventStreamEvent).

import {
  enqueueEvent,
  shouldReloadConversationForMessageEvent,
  syncTask,
  appendAgentEvent,
  loadConversation,
} from "../store/messages";
import { appendExecutorEvent } from "../store/executor";
import { executorEventEntry } from "../utils/executor-events";
import {
  boardStore,
  scheduleBoard,
  loadTasks,
  setTaskSequence,
} from "../store/board";
import { startSSE } from "./sse";

// ── Helpers ──

function record(value: any): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value);
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
 // Re-sync the active task's transcript then reload board state.
    const taskID: string =
      boardStore.selectedTaskID || "";
    if (taskID) void syncTask(taskID);
    return true;
  }

  const properties = record(event?.properties)
    ? event.properties
    : record(event?.payload)
      ? event.payload
      : {};

 // ── Executor progress / output events ──
  if (type === "run.progress") {
    const progressType: string = properties.type || "";
 // Skip pure protocol noise — NOT executor message events.
 // message.updated / message.part.updated / message.part.delta are the
 // executor's primary activity signals (tool calls, streaming text) and
 // must reach the executor event store.
    if (
      progressType === "protocol.raw" ||
      progressType === "executor.status" ||
      progressType === "executor.progress"
    ) {
      return true; // consume silently
    }
    const executorEvent = executorEventEntry({
      id: event.event_id,
      runID: event.run_id || properties.runID,
      kind: executorEventKind(properties.type),
      summary: event.summary || properties.summary || "",
      payload: properties,
      sourceID: properties.sourceID || "",
      sourceKind: "",
      sourceLabel: "",
      sourceStatus: "",
      goalRunID: properties.goalRunID || "",
      executorSessionID: properties.executorSessionID || "",
      time: { created: Number(event.timestamp || Date.now()) },
    });
    if (executorEvent) appendExecutorEvent(executorEvent);
    return true;
  }

  if (type === "run.output") {
    const executorEvent = executorEventEntry({
      id: event.event_id,
      runID: event.run_id || properties.runID,
      kind: "message_delta",
      summary:
        typeof properties.text === "string"
          ? properties.text
          : event.summary || "",
      payload: properties,
      sourceID: properties.sourceID || "",
      sourceKind: "",
      sourceLabel: "",
      sourceStatus: "",
      goalRunID: properties.goalRunID || "",
      executorSessionID: properties.executorSessionID || "",
      time: { created: Number(event.timestamp || Date.now()) },
    });
    if (executorEvent) appendExecutorEvent(executorEvent);
    return true;
  }

 // ── Agent stage events ──
  if (type === "agent.updated") {
    appendAgentEvent(event);
    return true;
  }

 // ── Board-invalidating events → forwarded to handleEventStreamEvent
 // which manages board reload scheduling and task sequence tracking.
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

 // Unknown event — forward to handleEventStreamEvent.
  return false;
}

// ── executorEventKind ──
// Map run.progress payload type to canonical executor event kind.
// Must handle both underscore forms (tool_call) and dot forms (tool.call)
// because executor event streams use dot notation while the internal
// canonical form uses underscores.

function executorEventKind(progressType: string | undefined): string {
  const t = String(progressType || "").trim().toLowerCase();
  if (!t) return "event";
  // Canonical underscore forms — pass through
  if (t === "message_delta" || t === "reasoning_delta") return t;
  if (t === "tool_call" || t === "tool_delta" || t === "tool_result") return t;
  if (t === "status") return "status";
  if (t === "git_checkpoint") return "git_checkpoint";
  // Dot-notation types from executor event streams (tool.call, tool.result,
  // reasoning.delta, permission.asked, etc.)
  if (t.includes("tool")) return t.includes("result") ? "tool_result" : "tool_call";
  if (t.includes("reason")) return "reasoning_delta";
  if (t.includes("approval") || t === "permission.asked") return "approval_request";
  if (t.includes("input")) return "input_request";
  if (t.includes("mcp")) return "mcp";
  if (t.includes("command")) return "command";
  if (t.includes("error")) return "error";
  if (t.includes("done") || t.includes("completed")) return "done";
  // Do NOT catch-all on includes("delta")/includes("message") here.
  // Protocol events like message.part.delta / message.part.updated flow
  // through run.progress and must stay as-is — executorEventEntry handles
  // extracting embedded tool parts when present. Mapping them to
  // "message_delta" would make every streaming delta a visible message.
  return t;
}

// ── Board / Task Lifecycle Event Handling ──

const BOARD_EVENT_DEBOUNCE = 150;

let tasksKickTimer: ReturnType<typeof setTimeout> | null = null;

function normalizedEventType(event: any): string {
  const raw = String(event?.type || "").trim();
  return raw.startsWith("orchestrator.") ? raw.slice("orchestrator.".length) : raw;
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
  );
}

function scheduleBoardCompat(delay = 0): void {
  scheduleBoard(delay);
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
    enqueueEvent({
      ...event,
      type,
    });
    return;
  }
  if (type === "task.replay_expired") {
    if (boardStore.selectedTaskID) void syncTask(boardStore.selectedTaskID);
    scheduleTasksCompat(0);
    scheduleBoardCompat(0);
    return;
  }
  const taskID = eventTaskID(event);
  const sequence = eventSequence(event);
  if (taskID && taskID === boardStore.selectedTaskID && sequence > 0) {
    const current = boardStore.taskSequence;
    if (current > 0 && sequence <= current) return;
    if (current > 0 && sequence > current + 1) {
      scheduleBoardCompat(BOARD_EVENT_DEBOUNCE);
      scheduleTasksCompat(BOARD_EVENT_DEBOUNCE);
      startSSE(taskID);
      return;
    }
    setTaskSequence(sequence);
  }
  if (boardInvalidatingEvent(type)) {
    scheduleTasksCompat(BOARD_EVENT_DEBOUNCE);
    if (taskID && taskID === boardStore.selectedTaskID) {
      scheduleBoardCompat(BOARD_EVENT_DEBOUNCE);
    }
  }
}
