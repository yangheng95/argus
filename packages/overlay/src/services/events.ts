// ── SSE Event Router & Board/Task Lifecycle ──
// Central dispatch for all incoming SSE events.
// Executor events (run.progress/run.output) are converted to standard
// message events and routed to messageStore — no separate executorStore.

import {
  enqueueEvent,
  shouldReloadConversationForMessageEvent,
  syncTask,
  loadConversation,
} from "../store/messages";
import {
  boardStore,
  scheduleBoard,
  loadTasks,
  setTaskSequence,
} from "../store/board";
import { startSSE } from "./sse";
import { loadConfigInfo } from "./init";
import { applyEvent as applyTreeWriterEvent } from "./tree-writer";
import {
  isBoardInvalidatingEventType,
  isRouterConsumedNoopEventType,
  isSubagentPhaseCompletedEventType,
} from "./event-policy";

// Forward SSE events to the tree-writer. Runs alongside `enqueueEvent` so
// the `messageStore.messages` index (still consumed by Board panels, chat
// pending bubbles, SessionTokenBadge, and section phase detection) stays in
// sync with the `cardTreeStore` that powers the conversation view.
function writeToTree(event: any): void {
  applyTreeWriterEvent(event);
}

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
  // Propagate the backend-stamped goalID so tree-writer can nest these
  // synthesized executor messages under their goal card. Without this,
  // external-executor tool_call/tool_result events produce sessions with
  // no goalID and the whole round floats to the top level instead of the
  // goal group.
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
        channel: "executor",
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
             resolvedRole: "executor",
             channel: "executor",
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
             resolvedRole: "executor",
             channel: "executor",
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
             resolvedRole: "executor",
             channel: "executor",
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
             resolvedRole: "executor",
             channel: "executor",
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
          },
        },
      },
    ];
  }

  return [];
}

export function replayTaskEventToTree(event: any): void {
  const type: string = event?.type || "";
  const properties = record(event?.properties)
    ? event.properties
    : record(event?.payload)
      ? event.payload
      : {};

  writeToTree(event);

  if (type === "run.progress" || type === "run.output") {
    const messages = convertExecutorEventToMessages(
      type === "run.output"
        ? {
            ...event,
            summary:
              typeof properties.text === "string" ? properties.text : event?.summary || "",
          }
        : event,
      type === "run.output"
        ? {
            ...properties,
            type: "text_delta",
            text: typeof properties.text === "string" ? properties.text : event?.summary || "",
          }
        : properties,
    );
    for (const msg of messages) {
      writeToTree(msg);
    }
  }
}

// ── Main router ──

const BOARD_EVENT_DEBOUNCE = 500;

let tasksKickTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Route a parsed SSE event to the appropriate Solid store or action.
 * @returns true if the event was consumed; false if it should be forwarded to
 * handleEventStreamEvent for board/task lifecycle processing.
 */
export function routeSSEEvent(event: any): boolean {
  const type: string = event.type || "";

  // Double-write to the new cardTreeStore. Runs before any legacy routing
  // so a writer crash surfaces with the original event context intact.
  writeToTree(event);

  // ── Message stream events → batched queue ──
  if (
    type === "message.updated" ||
    type === "message.part.updated" ||
    type === "message.part.delta"
  ) {
    scheduleBoard(BOARD_EVENT_DEBOUNCE);
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

  // ── Task rewound → incremental prune of the card tree ──
  // Backend emitted Event.TaskRewound after a rewindTask call. We prune
  // the tail of the timeline locally (card-tree store) without a full
  // refresh — the full-refresh path was the "user message → overlay
  // 卡顿" symptom, and the server has already filtered its describe
  // outputs to `time_created <= cursorTime`.
  if (type === "task.rewound") {
    const properties = record(event?.properties) ? event.properties : {};
    const evtTaskID: string | undefined = typeof properties.taskID === "string" ? properties.taskID : undefined;
    const cursorTime: number | undefined = typeof properties.cursorTime === "number" ? properties.cursorTime : undefined;
    if (!evtTaskID || cursorTime === undefined) return true;
    // Only prune when the event concerns the currently-selected task —
    // other tasks' card trees are not loaded in this overlay instance.
    if (evtTaskID === boardStore.selectedTaskID && cursorTime > 0) {
      // Idempotent — pruneCardsAfterCursor is a no-op if the cards are
      // already gone (e.g. the local initiator already pruned optimistically).
      void (async () => {
        const { pruneCardsAfterCursor, clearPruneCursor } = await import("../store/card-tree");
        pruneCardsAfterCursor(cursorTime);
        // cursorTime === 0 means "undo the undo"; reload to bring events back.
        void clearPruneCursor;
      })();
    } else if (evtTaskID === boardStore.selectedTaskID && cursorTime === 0) {
      // Rewind cleared by backend — full reload to restore the suppressed tail.
      void syncTask(evtTaskID);
    }
    return true;
  }

  const properties = record(event?.properties)
    ? event.properties
    : record(event?.payload)
      ? event.payload
      : {};

  // ── Executor progress / output events → convert to standard messages ──
  if (type === "run.progress") {
    scheduleBoard(BOARD_EVENT_DEBOUNCE);
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
      writeToTree(msg);
      enqueueEvent(msg);
    }
    return true;
  }

  if (type === "run.output") {
    scheduleBoard(BOARD_EVENT_DEBOUNCE);
    // Text output from executor — convert to message delta
    const messages = convertExecutorEventToMessages(event, {
      ...properties,
      type: "text_delta",
      text: typeof properties.text === "string" ? properties.text : event.summary || "",
    });
    for (const msg of messages) {
      writeToTree(msg);
      enqueueEvent(msg);
    }
    return true;
  }

  // ── Config changed → refresh appStore.config ──
  if (type === "config.changed") {
    void loadConfigInfo().catch(() => {});
    return true;
  }

  // Explicitly consumed protocol events that do not project into either
  // messageStore or cardTreeStore. tree-writer whitelists them as no-ops so
  // they remain auditable and don't surface as unknown-event crashes.
  if (isRouterConsumedNoopEventType(type)) return true;

  // ── Board-invalidating events → forwarded to handleEventStreamEvent
  if (isBoardInvalidatingEventType(type)) return false;

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


function normalizedEventType(event: any): string {
  const raw = String(event?.type || "").trim();
  return raw;
}

function eventTaskID(event: any): string {
  return String(event?.taskID || event?.properties?.taskID || event?.payload?.taskID || "");
}

function eventSequence(event: any): number {
  const value = Number(event?.sequence);
  return Number.isFinite(value) ? value : 0;
}

function boardInvalidatingEvent(type: string): boolean {
  return isBoardInvalidatingEventType(type);
}

function shouldRefreshSelectedBoard(type: string): boolean {
  return (
    boardInvalidatingEvent(type) ||
    type.startsWith("message.") ||
    type.startsWith("run.") ||
    type === "task.message" ||
    isSubagentPhaseCompletedEventType(type)
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
  // Double-write to the new cardTreeStore before any legacy routing.
  writeToTree(event);
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
  }
  if (taskID && taskID === boardStore.selectedTaskID && shouldRefreshSelectedBoard(type)) {
    scheduleBoard(BOARD_EVENT_DEBOUNCE);
  }
}

/**
 * Handler for the GLOBAL task-list SSE stream (`GET /task/events`).
 *
 * Server contract (see server/routes/orchestrator.ts): this stream emits a
 * pure change-notification shape — `{type, taskID, sequence}` — with NO
 * payload / properties. It is meant to tell the sidebar "some task changed,
 * refetch the list"; it is NOT the per-task message stream.
 *
 * The previous implementation routed these notifications through
 * `handleEventStreamEvent`, which feeds events into `writeToTree` →
 * tree-writer. tree-writer correctly throws for missing partID/info/part,
 * producing one throw per stream notification. Under active benchmarks
 * the task-list stream emits `message.part.delta` at full SSE cadence,
 * which flooded the console and made the browser miss render deadlines
 * (observed as `Overlay did not render streamed task output within 120s`
 * in the overlay-web-benchmark).
 *
 * Route them correctly here instead:
 *   - `message.*` notifications → only mean "that task changed"; if it
 *     is the selected task, refresh the board.
 *   - task lifecycle events → same refresh path.
 *   - sequence tracking mirrors handleEventStreamEvent's rules.
 *
 * tree-writer is reserved for task-scope events that carry full payload
 * (delivered via `routeSSEEvent` on the per-task stream).
 */
export function handleTaskListNotification(event: any): void {
  const type = normalizedEventType(event);
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
    }
    setTaskSequence(sequence);
  }
  if (taskID) {
    scheduleTasksCompat(BOARD_EVENT_DEBOUNCE);
  }
  if (taskID && taskID === boardStore.selectedTaskID && shouldRefreshSelectedBoard(type)) {
    scheduleBoard(BOARD_EVENT_DEBOUNCE);
  }
}
