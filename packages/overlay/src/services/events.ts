// ── SSE Event Router ──
// Central dispatch point for all incoming SSE events.
// Replaces the ad-hoc routing that was scattered across legacy app.js
// handleSSEEvent() and the window.__legacyHandleNonMessageEvent bridge.
//
// Contract:
//   routeSSEEvent(event) → true  : event was handled by the Solid stores
//   routeSSEEvent(event) → false : unknown event; caller should forward to
//                                  window.__legacyHandleNonMessageEvent for
//                                  backward-compatible processing.

import { enqueueEvent, shouldReloadConversationForMessageEvent } from "../store/messages";
import { appendAgentEvent } from "../store/messages";
import { appendExecutorEvent } from "../store/executor";
import { syncTask } from "../store/messages";
import { executorEventEntry } from "../utils/executor-events";
import { boardStore } from "../store/board";
import { loadConversation } from "./legacy";

// ── Helpers (mirror app.js record()) ──

function record(value: any): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// ── Main router ──

/**
 * Route a parsed SSE event to the appropriate Solid store or action.
 *
 * @returns true if the event was consumed; false if it should be forwarded to
 *          window.__legacyHandleNonMessageEvent.
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
    // Skip event types that are already handled as message stream events or
    // are pure protocol noise (mirrors the app.js filter).
    if (
      progressType === "message.updated" ||
      progressType === "message.part.updated" ||
      progressType === "message.part.delta" ||
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

  // ── Board-invalidating events are handled by the legacy contract because
  // they also carry board sequence / replay semantics.
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

  // Unknown event — let legacy handler process it.
  return false;
}

// ── executorEventKind ──
// Mirrors app.js executorEventKind() for run.progress payload type mapping.

function executorEventKind(progressType: string | undefined): string {
  const t = String(progressType || "").trim().toLowerCase();
  if (t === "message_delta" || t === "reasoning_delta") return t;
  if (t === "tool_call" || t === "tool_delta" || t === "tool_result") return t;
  if (t === "status") return "status";
  if (t === "git_checkpoint") return "git_checkpoint";
  // Default: use the raw type string so it stays inspectable.
  return t || "event";
}
