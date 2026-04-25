// ── TracePanel ──
//
// Renders AgentTrace events for a session or task. Each event is collapsed
// to a one-line header (ts · kind · agent) by default; clicking expands the
// full payload as pretty-printed JSON so the operator can inspect the LLM
// request body, agent report collector dump, or stream errors that produced
// a particular assistant turn.
//
// Two entry points:
//   <TracePanel sessionID="..." /> — per-session (the 🔍 button on a card)
//   <TracePanel taskID="..." />    — task-wide aggregate ("Show all" button)

import { For, Show, createMemo, createResource, createSignal } from "solid-js";
import { fetchSessionTrace, fetchTaskTrace, invalidateTraceCache, type TraceEvent } from "../services/trace";

type TracePanelProps =
  | { sessionID: string; taskID?: never; onClose?: () => void }
  | { taskID: string; sessionID?: never; onClose?: () => void };

function formatTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

function payloadJson(event: TraceEvent): string {
  const { ts: _ts, kind: _kind, ...rest } = event;
  try {
    return JSON.stringify(rest, null, 2);
  } catch {
    return String(rest);
  }
}

function eventTitle(event: TraceEvent): string {
  const parts: string[] = [event.kind];
  if (event.agentName) parts.push(event.agentName);
  return parts.filter(Boolean).join(" · ");
}

function TraceEventRow(props: { event: TraceEvent; defaultOpen?: boolean }) {
  const [open, setOpen] = createSignal(!!props.defaultOpen);
  return (
    <div class="trace-event" data-kind={props.event.kind} data-open={open() ? "true" : "false"}>
      <button
        type="button"
        class="trace-event-head"
        aria-expanded={open()}
        onClick={() => setOpen((v) => !v)}
      >
        <span class="trace-event-ts">{formatTime(props.event.ts)}</span>
        <span class="trace-event-kind">{eventTitle(props.event)}</span>
        <Show when={props.event.sessionID}>
          <span class="trace-event-sid" title={props.event.sessionID}>
            {String(props.event.sessionID).slice(-8)}
          </span>
        </Show>
        <span class="trace-event-chevron" aria-hidden="true">{open() ? "▾" : "▸"}</span>
      </button>
      <Show when={open()}>
        <pre class="trace-event-body">{payloadJson(props.event)}</pre>
      </Show>
    </div>
  );
}

export function TracePanel(props: TracePanelProps) {
  const cacheKey = createMemo(() => props.sessionID ?? `task:${props.taskID}`);
  const [refreshTick, setRefreshTick] = createSignal(0);

  const [events] = createResource(
    () => ({ key: cacheKey(), tick: refreshTick() }),
    async () => {
      if ("sessionID" in props && props.sessionID) {
        return fetchSessionTrace(props.sessionID, { force: refreshTick() > 0 });
      }
      if ("taskID" in props && props.taskID) {
        return fetchTaskTrace(props.taskID, { force: refreshTick() > 0 });
      }
      return [] as TraceEvent[];
    },
  );

  const refresh = () => {
    if ("sessionID" in props && props.sessionID) {
      invalidateTraceCache({ sessionID: props.sessionID });
    } else if ("taskID" in props && props.taskID) {
      invalidateTraceCache({ taskID: props.taskID });
    }
    setRefreshTick((v) => v + 1);
  };

  return (
    <div class="trace-panel">
      <div class="trace-panel-head">
        <span class="trace-panel-title">
          {"sessionID" in props && props.sessionID
            ? `Session trace · ${String(props.sessionID).slice(-12)}`
            : `Task trace · ${String((props as any).taskID ?? "").slice(-12)}`}
        </span>
        <span class="trace-panel-actions">
          <button type="button" class="trace-panel-refresh" onClick={refresh} title="Refresh">
            ↻
          </button>
          <Show when={props.onClose}>
            <button type="button" class="trace-panel-close" onClick={() => props.onClose?.()} title="Close">
              ✕
            </button>
          </Show>
        </span>
      </div>
      <Show when={events.loading}>
        <div class="trace-panel-empty">Loading…</div>
      </Show>
      <Show when={!events.loading && (events()?.length ?? 0) === 0}>
        <div class="trace-panel-empty">
          No trace events yet. Trace files write to <code>&lt;project&gt;/.opencorvus/trace/</code>;
          this view picks them up after the next agent run.
        </div>
      </Show>
      <Show when={(events()?.length ?? 0) > 0}>
        <div class="trace-panel-body">
          <For each={events()}>
            {(event) => <TraceEventRow event={event} />}
          </For>
        </div>
      </Show>
    </div>
  );
}
