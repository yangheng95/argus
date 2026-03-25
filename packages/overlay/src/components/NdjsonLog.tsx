// ── NdjsonLog ──
// Renders the NDJSON event log panel.
// Ported from app.js renderNdjsonEvent (line 11044) and renderNdjsonLogPanel
// (line 11082), plus NDJSON_STAGE_COLORS / NDJSON_TOOL_COLORS / fmtElapsed
// helpers (lines 11007-11038).

import { createMemo, For, Show } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { t } from "../utils/i18n";

// ── Types ──

export interface NdjsonEvent {
  /** ISO timestamp string */
  at: string;
  /** Elapsed milliseconds since start of current run */
  elapsed_ms: number;
  /** Full event type, e.g. "orchestrator.tool.call" */
  type: string;
  taskID: string;
  runID: string;
  stage: string;
  kind: string;
  status: string;
  toolName: string;
  summary: string;
  text: string;
  progressType: string;
  goalRunID: string;
}

// ── Internal store ──
// Holds the accumulated ndjson events for the current run.
// Legacy app.js pushes events via addNdjsonEvent / clearNdjsonEvents below.

const [ndjsonStore, setNdjsonStore] = createStore({
  events: [] as NdjsonEvent[],
  startMs: 0,
});

export function addNdjsonEvent(event: NdjsonEvent): void {
  setNdjsonStore(
    "events",
    produce((evs: NdjsonEvent[]) => {
      evs.push(event);
    }),
  );
}

export function clearNdjsonEvents(): void {
  setNdjsonStore({ events: [], startMs: 0 });
}

export function setNdjsonStartMs(ms: number): void {
  setNdjsonStore("startMs", ms);
}

/** Replace the entire events list (e.g. on task switch). */
export function setNdjsonEvents(events: NdjsonEvent[]): void {
  setNdjsonStore({ events: Array.isArray(events) ? [...events] : [] });
}

// ── Color tables (mirrors app.js NDJSON_STAGE_COLORS / NDJSON_TOOL_COLORS) ──

const STAGE_COLORS: Record<string, string> = {
  spec: "#3A86FF",
  planner: "#7B54C9",
  goal: "#2ECC71",
  judge: "#F39C12",
  delivery: "#28B4A0",
};

const TOOL_COLORS: Record<string, string> = {
  read_file: "#3498DB",
  list_directory: "#5DADE2",
  find_files: "#76D7EA",
  search_code: "#F39C12",
  memory_search: "#9B59B6",
  preference_list: "#8E44AD",
  web_search: "#E67E22",
  write_file: "#27AE60",
  edit_file: "#2ECC71",
  run_command: "#E8644A",
  bash: "#E74C3C",
};

function stageColor(stage: string): string {
  return STAGE_COLORS[stage] || "#6B7280";
}

function toolColor(name: string): string {
  return TOOL_COLORS[name] || "#95A5A6";
}

// ── Formatting helpers ──

function fmtElapsed(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return s.toFixed(1) + "s";
  const m = Math.floor(s / 60);
  return m + "m" + (s - m * 60).toFixed(0) + "s";
}

function eventTypeLabel(type: string): string {
  return (type || "").replace("orchestrator.", "").replace(/\./g, " \u203A ");
}

// ── Sub-component: single ndjson event row ──

function NdjsonEventRow(props: { event: NdjsonEvent }) {
  const ev = props.event;
  const stage = ev.stage || "";
  const kind = ev.kind || "";
  const toolName = ev.toolName || "";
  const summary = ev.summary || ev.text || "";
  const typeLabel = eventTypeLabel(ev.type);

  // Skip tool_delta rows entirely (mirrors app.js line 11054)
  if (kind === "tool_delta") return null;

  const kindBadge = (() => {
    if (kind === "tool_call")
      return <span class="ndjson-badge tool-call">call</span>;
    if (kind === "tool_result")
      return <span class="ndjson-badge tool-result">result</span>;
    if (kind === "message_delta")
      return <span class="ndjson-badge msg-delta">text</span>;
    if (kind === "status")
      return <span class="ndjson-badge status-badge">status</span>;
    return null;
  })();

  const summaryText =
    summary.length > 120 ? summary.slice(0, 120) + "\u2026" : summary;

  return (
    <div class="ndjson-event">
      <div class="ndjson-event-head">
        <span class="ndjson-elapsed">{fmtElapsed(ev.elapsed_ms)}</span>
        <span class="ndjson-type">{typeLabel}</span>
        {kindBadge}
      </div>
      <Show
        when={
          stage || (toolName && kind !== "message_delta") || summaryText || ev.status
        }
      >
        <div class="ndjson-event-body">
          <Show when={stage}>
            <span
              class="ndjson-stage"
              style={{ color: stageColor(stage) }}
            >
              {stage}
            </span>
          </Show>
          <Show when={toolName && kind !== "message_delta"}>
            <span
              class="ndjson-tool"
              style={{ color: toolColor(toolName) }}
            >
              {toolName}
            </span>
          </Show>
          <Show when={summaryText && kind !== "tool_delta"}>
            <span class="ndjson-summary">{summaryText}</span>
          </Show>
          <Show when={ev.status}>
            <span class={`ndjson-status ndjson-status-${ev.status}`}>
              {ev.status}
            </span>
          </Show>
        </div>
      </Show>
    </div>
  );
}

// ── NdjsonLog component ──

interface NdjsonLogProps {
  /** Maximum number of events to render (default: unbounded). */
  maxEvents?: number;
}

export function NdjsonLog(props: NdjsonLogProps) {
  // Filter out tool_delta events (they are never rendered per app.js logic)
  const visibleEvents = createMemo(() => {
    const all = ndjsonStore.events.filter((ev) => ev.kind !== "tool_delta");
    const max = props.maxEvents;
    if (max != null && max > 0 && all.length > max) {
      // Show the most recent N events
      return all.slice(all.length - max);
    }
    return all;
  });

  return (
    <div class="ndjson-log-panel">
      <Show
        when={visibleEvents().length > 0}
        fallback={
          <div class="empty-hint">{t("log.empty")}</div>
        }
      >
        <For each={visibleEvents()}>
          {(ev) => <NdjsonEventRow event={ev} />}
        </For>
      </Show>
    </div>
  );
}
