// ── TracePanel ──
// Live agent-trace viewer. Subscribes to /trace/:taskID/stream, replays
// historical events first, then streams new events as workflow agents make
// LLM/tool calls. Events are grouped by agent and rendered as a flat
// scroll list with content-visibility virtualization (same trick as
// LogViewer) so a long task with thousands of events doesn't melt the UI.

import { createEffect, createSignal, For, Show, onCleanup, createMemo } from "solid-js";
import { apiUrl } from "../services/api";
import { t } from "../utils/i18n";

interface TraceEvent {
  ts: number;
  seq: number;
  taskID: string;
  sessionID?: string;
  agent?: string;
  round?: number;
  category: string;
  payload?: Record<string, unknown> | unknown;
}

interface TracePanelProps {
  /** Task to view. null → empty state. Changing this resets the stream. */
  taskID: string | null;
}

const CATEGORY_ICON: Record<string, string> = {
  "task.start": "▶",
  "task.finish": "■",
  "agent.start": "↳",
  "agent.finish": "↲",
  "llm.step": "✦",
  "llm.finish": "✓",
  "llm.error": "✗",
  "tool.call": "→",
  "tool.result": "←",
  "tool.error": "⊘",
  "phase.change": "⇉",
  "error": "!",
};

function categoryIcon(category: string): string {
  return CATEGORY_ICON[category] ?? "·";
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

export function TracePanel(props: TracePanelProps) {
  const [events, setEvents] = createSignal<TraceEvent[]>([]);
  const [status, setStatus] = createSignal<"idle" | "connecting" | "live" | "error">("idle");
  const [expanded, setExpanded] = createSignal<Set<number>>(new Set());

  function toggle(seq: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });
  }

  // Reactive: when taskID changes, close the old stream and open a new one.
  createEffect(() => {
    const taskID = props.taskID;
    setEvents([]);
    setExpanded(new Set<number>());
    if (!taskID) {
      setStatus("idle");
      return;
    }
    setStatus("connecting");
    const url = apiUrl(`/trace/${encodeURIComponent(taskID)}/stream`);
    const source = new EventSource(url);
    let lastSeq = 0;
    source.onopen = () => setStatus("live");
    source.onerror = () => setStatus("error");
    source.onmessage = (msg) => {
      try {
        const ev = JSON.parse(msg.data) as TraceEvent;
        if (ev.category === "_heartbeat") return;
        if (ev.seq <= lastSeq) return;
        lastSeq = ev.seq;
        setEvents((prev) => [...prev, ev]);
      } catch {
        // Ignore unparseable lines — server sends well-formed JSON, this is defensive.
      }
    };
    onCleanup(() => source.close());
  });

  const grouped = createMemo(() => {
    // Group consecutive events by agent for visual clustering, but keep
    // chronological order across agents. Returns an array of agent-runs:
    //   [{ agent, events: [...] }, { agent, events: [...] }, ...]
    const result: { key: string; agent: string; events: TraceEvent[] }[] = [];
    for (const ev of events()) {
      const agent = ev.agent ?? "(workflow)";
      const last = result.at(-1);
      if (last && last.agent === agent) {
        last.events.push(ev);
      } else {
        result.push({ key: `${agent}-${ev.seq}`, agent, events: [ev] });
      }
    }
    return result;
  });

  return (
    <div class="trace-panel">
      <header class="trace-panel-header">
        <div class="trace-panel-title">{t("trace.title")}</div>
        <div class="trace-panel-meta">
          <span class="trace-panel-status" data-status={status()}>{status()}</span>
          <span class="trace-panel-count">{events().length} events</span>
        </div>
      </header>
      <Show
        when={props.taskID}
        fallback={<div class="trace-panel-empty">{t("trace.empty_no_task")}</div>}
      >
        <Show
          when={events().length > 0}
          fallback={<div class="trace-panel-empty">{t("trace.empty_no_events")}</div>}
        >
          <div class="trace-panel-list" role="tree">
            <For each={grouped()}>
              {(group) => (
                <section class="trace-group" role="treeitem">
                  <header class="trace-group-header">
                    <span class="trace-group-agent">{group.agent}</span>
                    <span class="trace-group-count">{group.events.length}</span>
                  </header>
                  <For each={group.events}>
                    {(ev) => {
                      const isOpen = () => expanded().has(ev.seq);
                      return (
                        <div class="trace-event" data-category={ev.category}>
                          <button
                            type="button"
                            class="trace-event-row"
                            onClick={() => toggle(ev.seq)}
                            aria-expanded={isOpen()}
                          >
                            <span class="trace-event-icon" aria-hidden="true">{categoryIcon(ev.category)}</span>
                            <span class="trace-event-time">{formatTime(ev.ts)}</span>
                            <span class="trace-event-cat">{ev.category}</span>
                            <Show when={ev.round !== undefined}>
                              <span class="trace-event-round">#{ev.round}</span>
                            </Show>
                            <Show when={ev.payload && (ev.payload as { tool?: string })?.tool}>
                              <span class="trace-event-tool">{(ev.payload as { tool?: string }).tool}</span>
                            </Show>
                          </button>
                          <Show when={isOpen() && ev.payload}>
                            <pre class="trace-event-payload">{JSON.stringify(ev.payload, null, 2)}</pre>
                          </Show>
                        </div>
                      );
                    }}
                  </For>
                </section>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}
