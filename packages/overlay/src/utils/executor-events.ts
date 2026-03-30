// ── Executor Event Utilities ──
// Covers parsing, normalisation, merging, and message-building for executor
// events fed to the overlay conversation view.

import { t } from "./i18n";
import { displayString, clipText } from "./string";
import { displayToolDetail, displayToolIcon } from "./tool";
import { AppLog } from "./log";
import { reasoningPartHidden, touchReasoningPart } from "../store/reasoning";
import { activeDirectory } from "../store/board";
import {
  executorStore,
  clearExecutorEvents,
  setExecutorEvents,
  mergeExecutorEventsFromFetch,
  type ExecutorEvent,
} from "../store/executor";
import { boardStore } from "../store/board";
import { apiJson } from "../services/api";

// ── Re-exports from executor store ──
// appendExecutorEvent and the mergeExecutorEventList equivalent already live
// in store/executor.ts. Re-export so callers can import from a single place.
export { appendExecutorEvent } from "../store/executor";

// ── Internal helpers ──

function record(value: any): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function shellQuote(value: any): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (/^[\w./:=@-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

function commandLine(value: any): string {
  if (Array.isArray(value)) return value.map(shellQuote).filter(Boolean).join(" ").trim();
  if (typeof value === "string") return value.trim();
  return "";
}

function clipBlock(value: any, limit = 280): string {
  const text = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function processStatusLabel(status: string): string {
  if (status === "completed") return t("task.status.completed");
  if (status === "failed") return t("task.status.failed");
  if (status === "blocked") return t("task.status.blocked");
  if (status === "queued") return t("task.status.queued");
  return t("task.status.running");
}

// ── Tool part builder (local copy to avoid circular imports) ──
// Matches eventToolPart / eventToolName / eventToolStatus.

function eventToolName(event: any): string {
  return (
    event?.payload?.name ??
    event?.payload?.tool ??
    event?.payload?.function?.name ??
    event?.summary?.split(":")?.[0]?.trim() ??
    "tool"
  );
}

function eventToolStatus(event: any, override: string): string {
  if (override) return override;
  const status = String(event?.payload?.status || event?.sourceStatus || "").trim().toLowerCase();
  if (status.includes("fail") || status.includes("error")) return "error";
  if (status.includes("complete") || status.includes("done")) return "completed";
  if (status.includes("pending") || status.includes("queue")) return "pending";
  if (event?.kind === "tool_result") return "completed";
  if (event?.kind === "error") return "error";
  return "running";
}

function toolStateInput(raw: any, fallback = ""): any {
  if (record(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    try { return JSON.parse(raw); } catch { return { raw }; }
  }
  if (fallback) return { raw: fallback };
  return {};
}

function eventToolPart(event: any, options: { status?: string; output?: string } = {}): any {
  if (!event) return null;
  const created = Number(event?.time?.created || Date.now());
  const summary = displayString(event?.summary).trim();
  const inputText = displayString(event?.text || event?.payload?.text).trim();
  const input = toolStateInput(
    event?.payload?.input ?? event?.payload?.arguments ?? event?.payload?.args ?? "",
    inputText,
  );
  const id = typeof event?.id === "string" && event.id ? event.id : `tool:${created}:${eventToolName(event)}`;
  const callID = typeof event?.sourceID === "string" && event.sourceID
    ? event.sourceID
    : typeof event?.payload?.id === "string" && event.payload.id
      ? event.payload.id
      : id;
  const tool = eventToolName(event);
  const status = eventToolStatus(event, typeof options.status === "string" ? options.status : "");
  const output = clipBlock(displayString(options.output || event?.payload?.output || event?.payload?.result || summary));
  if (status === "completed") {
    return {
      id,
      type: "tool",
      callID,
      tool,
      state: {
        status: "completed",
        input,
        output: output || summary || tool,
        title: summary || tool,
        metadata: { synthetic: true },
        time: { start: created, end: created },
      },
    };
  }
  if (status === "error") {
    return {
      id,
      type: "tool",
      callID,
      tool,
      state: {
        status: "error",
        input,
        error: output || summary || tool,
        metadata: { synthetic: true },
        time: { start: created, end: created },
      },
    };
  }
  if (status === "pending") {
    return {
      id,
      type: "tool",
      callID,
      tool,
      state: {
        status: "pending",
        input,
        raw: inputText || summary || tool,
      },
    };
  }
  return {
    id,
    type: "tool",
    callID,
    tool,
    state: {
      status: "running",
      input,
      title: summary || tool,
      metadata: { synthetic: true },
      time: { start: created },
    },
  };
}

// ── Exported helpers ──

/** Return the canonical tool name for an executor event. */
export function executorToolName(event: ExecutorEvent): string {
  return eventToolName(event);
}

/** Return the display icon for an executor tool event. */
export function executorToolIcon(event: ExecutorEvent): string {
  return displayToolIcon(eventToolName(event));
}

/** Extract a compact detail string (file path, command, pattern) for an executor tool event. */
export function executorToolDetail(event: ExecutorEvent, base = ""): string {
  const name = eventToolName(event);
  const input = toolStateInput(
    event?.payload?.input ?? event?.payload?.arguments ?? event?.payload?.args ?? "",
    "",
  );
  return displayToolDetail(name, input, {}, base);
}

/** Normalise a raw event type string to a canonical kind token. */
export function executorEventKind(type: string): string {
  const text = String(type || "").trim().toLowerCase();
  if (!text) return "status";
  if (text.includes("tool")) return text.includes("result") ? "tool_result" : "tool_call";
  if (text.includes("reason")) return "reasoning_delta";
  if (text.includes("plan")) return "plan_delta";
  if (text.includes("diff")) return "diff_delta";
  if (text.includes("approval")) return "approval_request";
  if (text.includes("input")) return "input_request";
  if (text.includes("mcp")) return "mcp";
  if (text.includes("command")) return "command";
  if (text.includes("error")) return "error";
  if (text.includes("done") || text.includes("completed")) return "done";
  if (text.includes("delta") || text.includes("message")) return "message_delta";
  return "status";
}

/** Derive the sourceKind for an executor event. */
export function executorEventSourceKind(kind: string, payload: any = {}): string {
  if (typeof payload.sourceKind === "string" && payload.sourceKind.trim()) return payload.sourceKind.trim();
  if (kind === "tool_call" || kind === "tool_result") return "tool";
  if (kind === "command") return "command";
  if (kind === "approval_request") return "approval";
  if (kind === "input_request") return "input";
  if (kind === "mcp") return "mcp";
  if (kind === "reasoning_delta") return "assistant";
  if (kind === "message_delta") return "assistant";
  if (kind === "error") return "error";
  return "status";
}

// Protocol-noise event types that should never become visible executor events.
// message.updated / message.part.updated / message.part.delta are NOT noise —
// they carry the executor's primary activity (tool calls, streaming text).
const EXECUTOR_NOISE_TYPES = new Set([
  "protocol.raw", "executor.status", "executor.progress",
  "session.diff", "session.idle",
  "task.report",
]);

/**
 * Normalise a raw server event object into a canonical ExecutorEvent shape.
 * Returns null when the event carries no useful payload or is protocol noise.
 */
export function executorEventEntry(raw: any): ExecutorEvent | null {
  // Check all possible locations for the original event type string:
  // - raw.type: present on SSE-constructed objects
  // - raw.payload.type: present when SSE properties carry the type
  // - raw.raw.type: present on API-loaded events (DB raw column)
  const rawType = String(raw?.type || raw?.payload?.type || raw?.raw?.type || "").trim().toLowerCase();
  if (rawType && EXECUTOR_NOISE_TYPES.has(rawType)) return null;
  let kind = typeof raw?.kind === "string" && raw.kind ? raw.kind : executorEventKind(raw?.type);
  const payload =
    record(raw?.payload) && record((raw.payload as any).payload)
      ? { ...raw.payload, ...(raw.payload as any).payload }
      : record(raw?.payload)
        ? raw.payload
        : {};

  // "lifecycle" is a generic placeholder assigned by the orchestrator's
  // protocolEventKind for unmapped event types. Re-derive the canonical kind
  // from the original event type so tool calls, message deltas, etc. are
  // properly classified.
  if (kind === "lifecycle" && rawType) {
    kind = executorEventKind(rawType);
  }

  // For message.part.updated events, inspect the embedded part to distinguish
  // tool activity (tool_call/tool_result) from text (message_delta).
  const part = record(payload?.part) ? payload.part : null;
  if (part && (kind === "message_delta" || kind === "lifecycle" || kind === "status")) {
    const partType = String((part as any).type || "").trim().toLowerCase();
    if (partType === "tool") {
      const state = record((part as any).state) ? (part as any).state : {};
      const partStatus = String(state.status || "").trim().toLowerCase();
      kind = (partStatus === "completed" || partStatus === "error") ? "tool_result" : "tool_call";
      // Flatten tool part fields into payload so downstream process builders
      // (eventToolName, executorToolDetail, etc.) can extract them.
      if (!payload.name && (part as any).tool) payload.name = (part as any).tool;
      if (!payload.id && (part as any).id) payload.id = (part as any).id;
      if (!payload.input && state.input) payload.input = state.input;
      if (!payload.output && state.output) payload.output = state.output;
      if (!payload.status) payload.status = partStatus;
    }
  }

  // session.error → error kind
  if (rawType === "session.error" && kind !== "error") kind = "error";

  const summary = typeof raw?.summary === "string"
    ? raw.summary.trim()
    : typeof raw?.text === "string"
      ? raw.text.trim()
      : typeof payload.summary === "string"
        ? payload.summary.trim()
        : typeof payload.text === "string"
          ? payload.text.trim()
          : "";
  const created = Number(raw?.time?.created || raw?.timestamp || Date.now());
  if (!summary && Object.keys(payload).length === 0) return null;
  const marker =
    typeof payload.id === "string" && payload.id
      ? payload.id
      : typeof payload.name === "string" && payload.name
        ? payload.name
        : typeof raw?.type === "string" && raw.type
          ? raw.type
          : "event";
  const sourceID = typeof payload.sourceID === "string" && payload.sourceID
    ? payload.sourceID
    : typeof payload.id === "string" && payload.id
      ? payload.id
      : "";
  const goalRunID = typeof raw?.goalRunID === "string" && raw.goalRunID
    ? raw.goalRunID
    : typeof raw?.goal_run_id === "string" && raw.goal_run_id
      ? raw.goal_run_id
      : typeof payload.goalRunID === "string" && payload.goalRunID
        ? payload.goalRunID
        : typeof payload.goal_run_id === "string" && payload.goal_run_id
          ? payload.goal_run_id
          : "";
  const executorSessionID = typeof raw?.executorSessionID === "string" && raw.executorSessionID
    ? raw.executorSessionID
    : typeof raw?.executor_session_id === "string" && raw.executor_session_id
      ? raw.executor_session_id
      : typeof payload.executorSessionID === "string" && payload.executorSessionID
        ? payload.executorSessionID
        : typeof payload.executor_session_id === "string" && payload.executor_session_id
          ? payload.executor_session_id
          : "";
  const sourceKind = executorEventSourceKind(kind, payload);
  const sourceLabel = typeof payload.sourceLabel === "string" && payload.sourceLabel.trim()
    ? payload.sourceLabel.trim()
    : "";
  const sourceStatus = typeof payload.status === "string" && payload.status.trim()
    ? payload.status.trim()
    : "";
  const scope = goalRunID
    ? `goal:${goalRunID}`
    : executorSessionID
      ? `session:${executorSessionID}`
      : "";
  return {
    id: typeof raw?.id === "string" && raw.id
      ? raw.id
      : kind === "message_delta" && sourceID
        ? `executor:${scope || "global"}:${sourceID}`
        : `executor:${kind}:${created}:${summary || marker}`,
    runID: typeof raw?.runID === "string"
      ? raw.runID
      : typeof raw?.run_id === "string"
        ? raw.run_id
        : typeof raw?.payload?.runID === "string"
          ? raw.payload.runID
          : "",
    kind,
    summary,
    payload,
    sourceID,
    sourceKind,
    sourceLabel,
    sourceStatus,
    goalRunID,
    executorSessionID,
    time: { created: Number.isFinite(created) ? created : Date.now() },
  };
}

/** Return the scope identifier string for an executor event. */
export function executorEventScopeID(event: ExecutorEvent | null | undefined): string {
  if (!event) return "";
  if (typeof event.goalRunID === "string" && event.goalRunID) return `goal:${event.goalRunID}`;
  if (typeof event.executorSessionID === "string" && event.executorSessionID) return `session:${event.executorSessionID}`;
  if (typeof event.runID === "string" && event.runID) return `run:${event.runID}`;
  return "";
}

/** Return true when two events belong to the same goal/session/run scope. */
export function sameExecutorEventScope(left: ExecutorEvent, right: ExecutorEvent): boolean {
  const a = executorEventScopeID(left);
  const b = executorEventScopeID(right);
  if (!a || !b) return true;
  return a === b;
}

/**
 * Return true when an event summary is a generic auto-generated placeholder
 * rather than meaningful user-visible text.
 */
export function genericExecutorSummary(event: ExecutorEvent): boolean {
  const summary = String(event?.summary || "").trim().toLowerCase();
  if (!summary) return true;
  if (event.kind === "tool_call") return /^(tool call|shell command):\s*\S+$/.test(summary);
  if (event.kind === "tool_result") {
    return summary.startsWith("tool result:") ||
      [
        "shell command completed",
        "structured output returned",
        "approval resolved",
        "user input received",
      ].includes(summary);
  }
  if (event.kind === "command") {
    return [
      "command",
      "running command",
      "command started",
      "command completed",
    ].includes(summary);
  }
  return false;
}

/** Extract the shell command string from an executor event payload. */
export function executorCommand(event: any): string {
  if (!record(event?.payload)) return "";
  const input = record(event.payload.input) ? event.payload.input : {};
  return commandLine(
    event.payload.command ??
    event.payload.argv ??
    event.payload.cmd ??
    (input as any).command ??
    (input as any).argv ??
    (input as any).cmd ??
    "",
  );
}

/** Extract and clip the output text from an executor event payload. */
export function executorOutput(event: any): string {
  if (!record(event?.payload)) return "";
  const output = event.payload.output;
  if (typeof output === "string") return clipBlock(output);
  if (record(output)) {
    const text = [
      (output as any).output,
      (output as any).stdout,
      (output as any).stderr,
      (output as any).result,
      (output as any).message,
      (output as any).content,
    ]
      .filter((item) => typeof item === "string" && item.trim())
      .join("\n");
    if (text) return clipBlock(text);
    return "";
  }
  if (typeof event.payload.text === "string") return clipBlock(event.payload.text);
  return "";
}

/**
 * Find the tool_call event that corresponds to a tool_result event.
 * Searches backwards through events for a matching call by payload.id.
 */
export function executorCall(events: ExecutorEvent[], index: number, event: ExecutorEvent): ExecutorEvent | null {
  const id = typeof event?.payload?.id === "string" ? event.payload.id : "";
  if (!id || !Array.isArray(events) || index <= 0) return null;
  return [...events.slice(0, index)]
    .reverse()
    .find((item) =>
      item?.kind === "tool_call" &&
      item?.payload?.id === id &&
      (!item.runID || !event.runID || item.runID === event.runID) &&
      sameExecutorEventScope(item, event),
    ) || null;
}

/**
 * Build the canonical display text for an executor event.
 * Prefers a cached `_targetText` when present; otherwise derives from kind.
 */
export function executorTargetText(event: ExecutorEvent, events: ExecutorEvent[] = [], index = -1): string {
  if (typeof event?._targetText === "string") return event._targetText;
  const summary = displayString(event?.summary).trim();
  const command = executorCommand(event);
  const output = executorOutput(event);

  if (event?.kind === "message_delta") {
    const text = displayString(event?.payload?.text);
    if (text.trim()) return text;
    return summary;
  }

  if (event?.kind === "reasoning_delta") {
    const text = displayString(event?.payload?.text);
    if (text.trim()) return text;
    return summary;
  }

  if (event?.kind === "tool_call") {
    if (!command) return summary;
    if (genericExecutorSummary(event)) return command;
    if (summary.includes(command)) return summary;
    return [summary, command].filter(Boolean).join("\n");
  }

  if (event?.kind === "command") {
    const lines: string[] = [];
    if (summary && (!genericExecutorSummary(event) || !command)) lines.push(summary);
    if (command && !lines.some((item) => item.includes(command))) lines.push(command);
    if (output) lines.push(output);
    if (lines.length > 0) return lines.join("\n");
    return summary;
  }

  if (event?.kind === "tool_result") {
    const call = executorCall(events, index, event);
    const linked = command || executorCommand(call);
    const lines: string[] = [];
    if (summary && (!genericExecutorSummary(event) || (!linked && !output))) lines.push(summary);
    if (linked && !lines.some((item) => item.includes(linked))) lines.push(linked);
    if (output) lines.push(output);
    if (lines.length > 0) return lines.join("\n");
    return summary;
  }

  return summary;
}

/**
 * Return the live display text for an executor event.
 * Returns `_liveText` when the event is animating; otherwise delegates to
 * executorTargetText.
 */
export function executorText(event: ExecutorEvent, events: ExecutorEvent[] = [], index = -1): string {
  if (typeof event?._liveText === "string") return event._liveText;
  return executorTargetText(event, events, index);
}

// Whitelist: only these event kinds are user-visible. Everything else is protocol noise.
const VISIBLE_EXECUTOR_KINDS = new Set([
  "message_delta", "reasoning_delta",
  "tool_call", "tool_result", "command",
  "approval_request", "input_request",
  "error", "mcp",
]);

/** Return true when an executor event should be shown in the conversation view. */
export function visibleExecutorEvent(event: ExecutorEvent): boolean {
  if (!event) return false;
  if (!VISIBLE_EXECUTOR_KINDS.has(event.kind)) return false;
  return !!executorText(event);
}

/**
 * Convert an executor event into a synthetic message object suitable for
 * rendering in the conversation view. Returns null for invisible events.
 */
export function executorMessage(event: ExecutorEvent, events: ExecutorEvent[] = [], index = -1): any {
  const text = executorText(event, events, index);
  if (!text || !visibleExecutorEvent(event)) return null;
  const part = event.kind === "tool_call" || event.kind === "tool_result"
    ? eventToolPart(event, {
      status: event.kind === "tool_result" ? "completed" : "",
      output: event.kind === "tool_result" ? (executorOutput(event) || text) : "",
    })
    : {
      id: `${event.kind === "reasoning_delta" ? "reasoning" : "text"}:${event.id || index}`,
      type: event.kind === "reasoning_delta" ? "reasoning" : "text",
      text,
      messageID: event.id,
      sessionID: "",
    };
  if (part.type === "reasoning" && reasoningPartHidden(part)) return null;
  return {
    _synthetic: true,
    info: {
      id: event.id,
      role: "executor",
      time: { created: event.time?.created || Date.now() },
    },
    parts: [part],
  };
}

/** Return the base process identifier for grouping executor events. */
export function executorProcessBaseID(event: ExecutorEvent): string {
  if (!event) return "";
  if (typeof event.sourceID === "string" && event.sourceID) return event.sourceID;
  if (typeof event?.payload?.sourceID === "string" && event.payload.sourceID) return event.payload.sourceID;
  if (typeof event?.payload?.id === "string" && event.payload.id) return event.payload.id;
  if (event.kind === "command") {
    const command = executorCommand(event);
    if (command) return `command:${command}`;
  }
  return "";
}

/** Return the fully-scoped process identifier for an executor event. */
export function executorProcessID(event: ExecutorEvent): string {
  const base = executorProcessBaseID(event);
  if (!base) return "";
  const scope = executorEventScopeID(event);
  return scope ? `${scope}:${base}` : base;
}

/** Return the source-kind category for an executor event. */
export function executorProcessKind(event: ExecutorEvent): string {
  if (!event) return "";
  if (typeof event.sourceKind === "string" && event.sourceKind) return event.sourceKind;
  return executorEventSourceKind(event.kind, record(event?.payload) ? event.payload : {});
}

/** Derive a normalised status string for an executor process. */
export function executorProcessStatus(event: ExecutorEvent): string {
  const status = String(event?.sourceStatus || event?.payload?.status || "").trim().toLowerCase();
  if (status.includes("fail") || status.includes("error")) return "failed";
  if (status.includes("complete") || status.includes("done")) return "completed";
  if (status.includes("block")) return "blocked";
  if (status.includes("queue") || status.includes("pending")) return "queued";
  if (event?.kind === "tool_result") return "completed";
  if (event?.kind === "error") return "failed";
  if (event?.kind === "approval_request" || event?.kind === "input_request") return "blocked";
  const summary = String(event?.summary || "").trim().toLowerCase();
  if (summary.includes("fail") || summary.includes("error")) return "failed";
  if (summary.includes("complete") || summary.includes("done")) return "completed";
  if (summary.includes("block")) return "blocked";
  if (summary.includes("queue") || summary.includes("pending")) return "queued";
  return "running";
}

/** Return a human-readable title for an executor process. */
export function executorProcessTitle(event: ExecutorEvent, events: ExecutorEvent[] = [], index = -1): string {
  const call = event?.kind === "tool_result" ? executorCall(events, index, event) : null;
  const sourceLabel = displayString(event?.sourceLabel).trim();
  if (sourceLabel) return sourceLabel;
  const command = executorCommand(event);
  if (command) return command;
  const payloadName = displayString(event?.payload?.name).trim();
  if (payloadName) return payloadName;
  const callName = displayString(call?.payload?.name).trim();
  if (callName) return callName;
  return displayString(event?.summary).trim() || displayString(event?.id).trim();
}

/** Return a secondary detail string for an executor process entry. */
export function executorProcessDetail(event: ExecutorEvent, events: ExecutorEvent[] = [], index = -1): string {
  const kind = executorProcessKind(event);
  const call = event?.kind === "tool_result" ? executorCall(events, index, event) : null;
  const command = executorCommand(event) || executorCommand(call);
  if (kind === "tool") {
    if (command && command !== executorProcessTitle(event, events, index)) return command;
    const input = displayString(event?.payload?.input);
    if (input.trim()) return clipText(input.replace(/\s+/g, " "), 120);
    const callInput = displayString(call?.payload?.input);
    if (callInput.trim()) return clipText(callInput.replace(/\s+/g, " "), 120);
  }
  const approvalMessage = displayString(event?.payload?.message).trim();
  if (kind === "approval" && approvalMessage) return approvalMessage;
  const summary = displayString(event?.summary).trim();
  if (kind === "input" && summary) return summary;
  return "";
}

/** Return the ancillary note string for an executor process entry. */
export function executorProcessNote(event: ExecutorEvent, events: ExecutorEvent[] = [], index = -1): string {
  const summary = displayString(event?.summary).trim();
  if (!summary || genericExecutorSummary(event)) return "";
  const title = executorProcessTitle(event, events, index);
  const detail = executorProcessDetail(event, events, index);
  if (summary === title || summary === detail) return "";
  return summary;
}

/** Return the progress label string for an executor process entry. */
export function executorProcessProgress(event: ExecutorEvent, events: ExecutorEvent[] = [], index = -1): string {
  const status = executorProcessStatus(event);
  if (event?.kind === "message_delta") return processStatusLabel(status);
  const summary = displayString(event?.summary).trim();
  const title = executorProcessTitle(event, events, index);
  const detail = executorProcessDetail(event, events, index);
  const output = event?.kind === "message_delta" ? "" : executorOutput(event);
  if (
    summary &&
    summary !== title &&
    summary !== detail &&
    summary !== output &&
    (!genericExecutorSummary(event) || event?.kind === "command" || event?.kind === "mcp")
  ) return summary;
  return processStatusLabel(status);
}

/** Merge the output text of two executor process objects. */
export function mergeExecutorProcessOutput(current: string, next: string, replace = false): string {
  if (!next) return current;
  if (!current) return next;
  if (replace && next.startsWith(current)) return next;
  if (current.includes(next)) return current;
  return `${current}\n${next}`.trim();
}

/**
 * Fold a list of executor events into a map of active processes.
 * Returns processes sorted by creation time.
 * Process objects are rebuilt each call (not cached) because events may
 * update output/status cumulatively. The MESSAGE-level cache in
 * buildExecutorMessages handles DOM stability.
 */
export function buildExecutorProcesses(events: ExecutorEvent[] = []): any[] {
  const items = new Map<string, any>();
  events.forEach((event, index) => {
    const id = executorProcessID(event);
    const kind = executorProcessKind(event);
    if (!id || !kind || kind === "assistant" || kind === "status") return;
    const base = activeDirectory();
    const current = items.get(id) || {
      id,
      kind,
      toolName: eventToolName(event),
      toolDetail: executorToolDetail(event, base),
      title: executorProcessTitle(event, events, index),
      detail: "",
      progress: executorProcessProgress(event, events, index),
      note: "",
      output: "",
      status: executorProcessStatus(event),
      goalRunID: event.goalRunID || "",
      executorSessionID: event.executorSessionID || "",
      time: {
        created: event.time?.created || Date.now(),
        updated: event.time?.created || Date.now(),
      },
    };
    current.kind = kind;
    current.title = executorProcessTitle(event, events, index) || current.title;
    const detail = executorProcessDetail(event, events, index);
    if (detail) current.detail = detail;
    const progress = executorProcessProgress(event, events, index);
    if (progress) current.progress = progress;
    const note = executorProcessNote(event, events, index);
    if (note) current.note = note;
    current.status = executorProcessStatus(event) || current.status;
    const output = event.kind === "message_delta"
      ? executorTargetText(event, events, index)
      : executorOutput(event);
    if (output) current.output = mergeExecutorProcessOutput(current.output, output, event.kind === "message_delta");
    current.time.updated = event.time?.created || current.time.updated;
    items.set(id, current);
  });
  // Reuse cached process objects when content is unchanged to preserve
  // referential identity for downstream <Index> rendering.
  const activeIDs = new Set<string>();
  const result: any[] = [];
  for (const [id, process] of items) {
    activeIDs.add(id);
    const cached = _processCache.get(id);
    if (
      cached &&
      cached.status === process.status &&
      cached.title === process.title &&
      cached.detail === process.detail &&
      cached.progress === process.progress &&
      cached.note === process.note &&
      cached.output === process.output &&
      cached.kind === process.kind &&
      cached.toolName === process.toolName &&
      cached.toolDetail === process.toolDetail
    ) {
      result.push(cached);
    } else {
      _processCache.set(id, process);
      result.push(process);
    }
  }
  for (const key of _processCache.keys()) {
    if (!activeIDs.has(key)) _processCache.delete(key);
  }
  return result.sort((a, b) => (a.time?.created || 0) - (b.time?.created || 0));
}

/**
 * Build a synthetic process-summary message from a list of executor processes.
 * Returns null when there are no processes to display.
 */
export function executorProcessMessage(processes: any[]): any {
  if (!Array.isArray(processes) || processes.length === 0) return null;
  return {
    _synthetic: true,
    info: {
      id: `executor:processes:${boardStore.selectedTaskID || "active"}`,
      role: "executor",
      time: { created: processes[0]?.time?.created || Date.now() },
    },
    parts: processes.map((process) => ({
      type: "executor_process",
      process,
    })),
  };
}

/**
 * Build the full set of synthetic conversation messages for executor events.
 * Processes are grouped by goalRunID — each goal gets its own card/message.
 * Non-goal processes (serial mode) are grouped into a default card.
 *
 * IMPORTANT: message objects are CACHED by stable key so Solid's <For> can
 * reuse DOM nodes. Only the `parts` array is replaced on updates.
 */
const _msgCache = new Map<string, any>();
const _processCache = new Map<string, any>();
const _partCache = new Map<string, any>();

export function buildExecutorMessages(): any[] {
  if (!boardStore.selectedTaskID) { _msgCache.clear(); _processCache.clear(); _partCache.clear(); return []; }
  const events = Array.isArray(executorStore.events) ? executorStore.events : [];
  const processes = buildExecutorProcesses(events);
  const processIDs = new Set(processes.map((item) => item.id));

  // Group processes by goalRunID for per-goal cards
  const processGroups = new Map<string, any[]>();
  for (const process of processes) {
    const key = process.goalRunID || "";
    if (!processGroups.has(key)) processGroups.set(key, []);
    processGroups.get(key)!.push(process);
  }

  // Create or reuse message objects per goal (stable references for Solid)
  const goalMessages: any[] = [];
  const activeKeys = new Set<string>();
  for (const [goalRunID, procs] of processGroups) {
    if (procs.length === 0) continue;
    const msgKey = `executor:processes:${goalRunID || boardStore.selectedTaskID || "active"}`;
    activeKeys.add(msgKey);
    let msg = _msgCache.get(msgKey);
    if (!msg) {
      msg = {
        _synthetic: true,
        info: {
          id: msgKey,
          role: "executor",
          goalRunID: goalRunID || undefined,
          goalTitle: goalRunID ? resolveGoalTitle(goalRunID) : undefined,
          time: { created: procs[0]?.time?.created || Date.now() },
        },
        parts: [],
      };
      _msgCache.set(msgKey, msg);
    }
    // Cache part wrappers by process identity to preserve references for <Index>
    msg.parts = procs.map((process) => {
      const cached = _partCache.get(process.id);
      if (cached && cached.process === process) return cached;
      const wrapper = { type: "executor_process" as const, process };
      _partCache.set(process.id, wrapper);
      return wrapper;
    });
    // Update goal title (may resolve later when board data arrives)
    if (goalRunID) msg.info.goalTitle = resolveGoalTitle(goalRunID);
    goalMessages.push(msg);
  }
  // Prune stale cache entries
  for (const key of _msgCache.keys()) {
    if (!activeKeys.has(key)) _msgCache.delete(key);
  }
  const activeProcessIDs = new Set(processes.map((p: any) => p.id));
  for (const key of _partCache.keys()) {
    if (!activeProcessIDs.has(key)) _partCache.delete(key);
  }

  // Non-process events as individual messages
  const messages = events
    .filter((event) => {
      const id = executorProcessID(event);
      const kind = executorProcessKind(event);
      return !(id && processIDs.has(id) && kind && kind !== "assistant" && kind !== "status");
    })
    .map((event, index) => executorMessage(event, events, index))
    .filter(Boolean);

  return [...goalMessages, ...messages];
}

/** Resolve a goal title from the board store by goalRunID. */
function resolveGoalTitle(goalRunID: string): string | undefined {
  const board = boardStore.board;
  if (!board) return undefined;
  const goalRuns = (board as any).goalRuns;
  if (!Array.isArray(goalRuns)) return undefined;
  const goalRun = goalRuns.find((gr: any) => gr.id === goalRunID || gr.goalRunID === goalRunID);
  if (!goalRun) return undefined;
  const goalID = goalRun.goalID || goalRun.goal_id;
  if (!goalID) return undefined;
  // Find goal card in lanes
  const lanes = (board as any).lanes;
  if (!Array.isArray(lanes)) return undefined;
  for (const lane of lanes) {
    if (!Array.isArray(lane.cards)) continue;
    const card = lane.cards.find((c: any) => c.id === goalID);
    if (card?.title) return card.title;
  }
  return undefined;
}

/**
 * Sync the `_targetText` / `_liveText` cache fields on a single executor event
 * object in place. Also schedules reasoning-part auto-hide when relevant.
 * Note: this mutates the event object. Callers must ensure the object is not
 * a Solid store proxy when calling this function.
 */
export function syncExecutorText(event: any, index = -1): void {
  if (!event) return;
  const events = Array.isArray(executorStore.events) ? executorStore.events : [];
  const target = executorTargetText(event, events, index);
  if (!target) {
    delete event._targetText;
    delete event._liveText;
    return;
  }
  event._targetText = target;
  event._liveText = target;
  if (event.kind === "reasoning_delta" && target.trim()) {
    touchReasoningPart({
      id: `reasoning:${event.id || index}`,
      type: "reasoning",
      text: target,
      messageID: event.id,
      sessionID: "",
    });
  }
}

/** Return true when an event kind carries streaming delta content. */
export function executorDeltaKind(kind: string): boolean {
  return kind === "message_delta" || kind === "reasoning_delta";
}

/** Return true when two events belong to the same streaming context. */
export function sameExecutorEventStream(left: ExecutorEvent, right: ExecutorEvent): boolean {
  return (!left?.runID || !right?.runID || left.runID === right.runID) &&
    sameExecutorEventScope(left, right);
}

/**
 * Merge a delta event into an existing event, accumulating streamed text.
 * Returns a new event object; does not mutate inputs.
 */
export function mergeExecutorDelta(
  current: ExecutorEvent,
  event: ExecutorEvent,
  events: ExecutorEvent[] = [],
  index = -1,
): ExecutorEvent {
  const delta = typeof event.payload?.text === "string" ? event.payload.text : event.summary || "";
  const previous = executorTargetText(current, events, index);
  return {
    ...current,
    summary: previous + delta,
    payload: {
      ...(record(current.payload) ? current.payload : {}),
      ...(record(event.payload) ? event.payload : {}),
      text: previous + delta,
    },
    _targetText: previous + delta,
    _liveText: typeof current._liveText === "string" ? current._liveText : "",
  };
}

/**
 * Merge a single executor event into an event list, handling id deduplication,
 * delta accumulation, and insertion-sort by creation time.
 * Returns a new array; does not mutate the input list.
 */
export function mergeExecutorEventList(events: ExecutorEvent[] = [], event: ExecutorEvent): ExecutorEvent[] {
  const index = typeof event?.id === "string" && event.id
    ? events.findIndex((item) => item.id === event.id)
    : -1;
  if (index >= 0) {
    if (executorDeltaKind(event?.kind)) {
      const next = mergeExecutorDelta(events[index], event, events, index);
      return [
        ...events.slice(0, index),
        next,
        ...events.slice(index + 1),
      ];
    }
    return [
      ...events.slice(0, index),
      {
        ...events[index],
        ...event,
        payload: {
          ...(record(events[index]?.payload) ? events[index].payload : {}),
          ...(record(event?.payload) ? event.payload : {}),
        },
      },
      ...events.slice(index + 1),
    ];
  }
  const sourceIndex = executorDeltaKind(event?.kind) && event?.sourceID
    ? events.findIndex((item) =>
      item.kind === event.kind &&
      item.sourceID === event.sourceID &&
      sameExecutorEventStream(item, event),
    )
    : -1;
  const last = events[events.length - 1];
  if (sourceIndex >= 0) {
    const next = mergeExecutorDelta(events[sourceIndex], event, events, sourceIndex);
    return [
      ...events.slice(0, sourceIndex),
      next,
      ...events.slice(sourceIndex + 1),
    ];
  }
  if (
    executorDeltaKind(event?.kind) &&
    last?.kind === event.kind &&
    !event.sourceID &&
    !last.sourceID &&
    sameExecutorEventStream(last, event)
  ) {
    return [
      ...events.slice(0, -1),
      mergeExecutorDelta(last, event, events, events.length - 1),
    ];
  }
  return [...events, event].sort((a, b) => (a.time?.created || 0) - (b.time?.created || 0));
}

/**
 * Fetch executor events for the given runID from the server, normalise them,
 * and write the result into the executor store.
 * Skips the fetch when:
 * - no task is selected,
 * - runID is empty,
 * - or the store already has fresh data for this runID and the task is not
 * actively running.
 */
export async function loadExecutorEvents(
  runID = (boardStore.board?.task?.activeRunID as string | undefined) ?? "",
): Promise<ExecutorEvent[]> {
  const next = typeof runID === "string" ? runID : "";
  const activeTask = boardStore.board?.task?.status;
  const activeRun = ["queued", "planning", "running", "blocked", "evaluating", "delivering"].includes(String(activeTask || ""));

  if (!boardStore.selectedTaskID) {
    setExecutorEvents([]);
    return [];
  }
  if (!next) {
    setExecutorEvents([]);
    return [];
  }
  if (
    executorStore.runID === next &&
    (!activeRun || Date.now() - executorStore.fetchedAt < 3000)
  ) return executorStore.events as ExecutorEvent[];

  try {
    const events = await apiJson(`run/${encodeURIComponent(next)}/executor-events`);
 // Guard: bail out if the selected task or active run changed during fetch.
    if (boardStore.selectedTaskID !== boardStore.board?.task?.id) return executorStore.events as ExecutorEvent[];
    if ((boardStore.board?.task?.activeRunID ?? "") !== next) return executorStore.events as ExecutorEvent[];
    const normalised = (Array.isArray(events) ? events : [])
      .map(executorEventEntry)
      .filter((item): item is ExecutorEvent => !!item)
      .reduce((items, item) => mergeExecutorEventList(items, item), [] as ExecutorEvent[]);
    // Merge API events with existing SSE events to preserve real-time state.
    // API events are authoritative (correct kind from DB); SSE-only events
    // that arrived after the API query are kept.
    const firstRunID = normalised.find(e => e.runID)?.runID;
    mergeExecutorEventsFromFetch(normalised, firstRunID);
    return executorStore.events as ExecutorEvent[];
  } catch (e) {
    AppLog.debug("executor", "loadExecutorEvents failed", { runID: next, error: String(e) });
    if ((boardStore.board?.task?.activeRunID ?? "") !== next) return executorStore.events as ExecutorEvent[];
    clearExecutorEvents();
    return [];
  }
}
