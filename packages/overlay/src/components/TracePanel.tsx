// ── TracePanel ──
//
// Renders AgentTrace events for a session or task. Each event collapses to a
// one-line headline that extracts the semantic meaning of the event (which
// agent, what it produced, did it succeed) so the operator can scan the trace
// without expanding everything. Click to expand for the raw JSON payload —
// the source-of-truth dump that drove the headline.
//
// Two entry points:
//   <TracePanel sessionID="..." /> — per-session (the 🔍 button on a card)
//   <TracePanel taskID="..." />    — task-wide aggregate, also used as the
//                                    persistent right-panel trace stream
//                                    when no `onClose` is provided.

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

// ── Per-kind headline extractors ─────────────────────────────────────────
// Trace events are heterogeneous (session_open / llm_request / agent_report /
// agent_report_failure / helper_llm_call / orchestrator_wake / ...). Each kind
// stores its own shape under `payload`. The headline below pulls the
// fields that matter for at-a-glance scanning, leaving the raw JSON to
// the expanded view for full inspection.

function summariseCollector(collector: unknown): string {
  if (!collector || typeof collector !== "object") return "";
  const c = collector as Record<string, unknown>;
  const parts: string[] = [];
  if (Array.isArray(c.specs)) parts.push(`${c.specs.length} specs`);
  if (Array.isArray(c.requirements)) parts.push(`${c.requirements.length} reqs`);
  if (Array.isArray(c.goals)) parts.push(`${c.goals.length} goals`);
  if (Array.isArray(c.collector)) parts.push(`${c.collector.length} items`);
  if (Array.isArray((c as any).slots)) parts.push(`${((c as any).slots as unknown[]).length} slots`);
  return parts.join(" / ");
}

function lastAssistantToolCalls(messages: unknown[]): string[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; content?: unknown } | undefined;
    if (!m || m.role !== "assistant") continue;
    const content = m.content;
    if (!Array.isArray(content)) return [];
    const calls: string[] = [];
    for (const p of content) {
      if (p && typeof p === "object" && (p as any).type === "tool-call") {
        const name = (p as any).toolName;
        if (typeof name === "string") calls.push(name);
      }
    }
    return calls;
  }
  return [];
}

function eventHeadline(event: TraceEvent): string {
  const kind = event.kind;
  const agent = event.agentName ? event.agentName : "";
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  switch (kind) {
    case "session_open": {
      const first = typeof payload.firstEvent === "string" ? ` · ${payload.firstEvent}` : "";
      return `open · ${agent || "session"}${first}`;
    }
    case "llm_request": {
      const msgs = Array.isArray(payload.messages) ? (payload.messages as unknown[]) : [];
      const calls = lastAssistantToolCalls(msgs);
      const tail = calls.length > 0 ? ` → ${calls.slice(0, 4).join(", ")}${calls.length > 4 ? ` +${calls.length - 4}` : ""}` : "";
      return `llm_request · ${agent || "?"} · ${msgs.length} msgs${tail}`;
    }
    case "agent_report":
    case "agent_report_retry_final": {
      const structuredOK = payload.structured !== undefined && payload.structured !== null;
      const collector = summariseCollector(payload.collector);
      const errs = Array.isArray(payload.streamErrors) ? (payload.streamErrors as unknown[]).length : 0;
      const tail = [
        structuredOK ? "structured ✓" : "structured ✗",
        collector,
        errs ? `${errs} stream-err` : "",
      ].filter(Boolean).join(" · ");
      return `agent_report · ${agent || "?"} · ${tail}`;
    }
    case "agent_report_failure":
    case "orchestrator_wake_failure": {
      const err = (payload.error ?? (payload as any).reason ?? "(no message)") as unknown;
      return `${kind} · ${agent || "?"} · ${String(err).slice(0, 120)}`;
    }
    case "orchestrator_wake": {
      const reason = typeof (payload as any).reason === "string" ? (payload as any).reason : "";
      return `orchestrator_wake${reason ? ` · ${reason}` : ""}`;
    }
    case "helper_llm_call": {
      const purpose = (payload as any).purpose ?? (payload as any).label ?? "";
      return `helper_llm_call${purpose ? ` · ${purpose}` : ""}`;
    }
    default:
      return `${kind}${agent ? ` · ${agent}` : ""}`;
  }
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
        <span class="trace-event-kind">{eventHeadline(props.event)}</span>
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
