// ── LogViewer Component ──
// Full-featured log viewer dialog that merges overlay client logs, server logs,
// and pipeline NDJSON events. Ports renderLogViewer / renderNdjsonLogPanel /
// renderLogEntryDetail / logViewerEntries ( lines 10947–11155) and all
// supporting helpers (parseServerLogLine, stringifyLogValue, etc., lines
// 10795–10926).

import {
  createEffect,
  createSignal,
  createMemo,
  onCleanup,
  For,
  Show,
} from "solid-js";
import { setupAutoScroll } from "../utils/dom-utils";
import { appStore, setAppStore, filteredLogEntries } from "../store/app";
import type { LogEntry, LogLevel, LogSource } from "../store/app";
import { t } from "../utils/i18n";
import { apiJson } from "../services/api";

// ── Re-export types so callers can use them without importing store/app ──
export type { LogEntry, LogLevel, LogSource };

// ── Constants ──

const NDJSON_STAGE_COLORS: Record<string, string> = {
  spec: "#3A86FF",
  planner: "#7B54C9",
  goal: "#2ECC71",
  judge: "#F39C12",
  delivery: "#28B4A0",
};

const NDJSON_TOOL_COLORS: Record<string, string> = {
  read_file: "#3498DB",
  list_directory: "#5DADE2",
  find_files: "#76D7EA",
  search_code: "#F39C12",
  memory_search: "#9B59B6",
  web_search: "#E67E22",
  write_file: "#27AE60",
  edit_file: "#2ECC71",
  run_command: "#E8644A",
  bash: "#E74C3C",
};

function ndjsonToolColor(name: string): string {
  return NDJSON_TOOL_COLORS[name] ?? "#95A5A6";
}

// ── Internal server-log state ──
// Stored as module-level variables (same pattern as ) so they survive
// across component remounts but are not reactive (refresh is triggered
// explicitly by the user or on open).

let _serverLogLines: string[] = [];

async function loadServerLogs(): Promise<void> {
  try {
    const data = await apiJson("log/tail?n=500");
    _serverLogLines = Array.isArray(data?.lines) ? data.lines : [];
  } catch {
    _serverLogLines = [];
  }
}

// ── Log value helpers ──

function stringifyLogValue(value: unknown, space = 0): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, space);
  } catch {
    return String(value ?? "");
  }
}

function clipText(value: string, limit = 80): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function logPreviewValue(value: unknown): string {
  return clipText(stringifyLogValue(value), 80);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function logDetailFields(fields: unknown): Record<string, unknown> {
  if (!isRecord(fields)) return {};
  return Object.fromEntries(
    Object.entries(fields).filter(([key]) => key !== "service"),
  );
}

function logSourceLabel(source: LogSource): string {
  if (source === "server") return "Server";
  if (source === "pipeline") return "Pipeline";
  return "Overlay";
}

// ── Server log line parser (

function parseLogValue(raw: string): unknown {
  const text = String(raw || "").trim();
  if (!text) return "";
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (/^[\[{"]/.test(text)) {
    try {
      return JSON.parse(text);
    } catch {}
  }
  return text;
}

function scanBalancedLogValue(text: string, start: number): number {
  if (text[start] === '"') {
    let escaped = false;
    for (let i = start + 1; i < text.length; i++) {
      const ch = text[i];
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === '"') return i + 1;
    }
    return text.length;
  }
  const pairs: Record<string, string> = { "{": "}", "[": "]" };
  const stack = [text[start]];
  let quoted = false;
  let escaped = false;
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === '"') quoted = false;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === "{" || ch === "[") { stack.push(ch); continue; }
    if (ch === "}" || ch === "]") {
      const open = stack[stack.length - 1];
      if (pairs[open] === ch) {
        stack.pop();
        if (stack.length === 0) return i + 1;
      }
    }
  }
  return text.length;
}

function scanLogValueEnd(text: string, start: number): number {
  if (!text[start]) return start;
  const first = text[start];
  if (first === '"' || first === "{" || first === "[") {
    return scanBalancedLogValue(text, start);
  }
  let cursor = start;
  while (cursor < text.length) {
    const nextSpace = text.indexOf(" ", cursor);
    if (nextSpace < 0) return text.length;
    let probe = nextSpace;
    while (probe < text.length && text[probe] === " ") probe++;
    if (/^[A-Za-z0-9_.-]+=/.test(text.slice(probe))) return nextSpace;
    cursor = probe;
  }
  return text.length;
}

function parseLeadingLogFields(text: string): {
  fields: Record<string, unknown>;
  end: number;
} {
  const fields: Record<string, unknown> = {};
  let index = 0;
  while (index < text.length) {
    while (text[index] === " ") index++;
    const match = /^([A-Za-z0-9_.-]+)=/.exec(text.slice(index));
    if (!match) break;
    const key = match[1];
    index += match[0].length;
    const end = scanLogValueEnd(text, index);
    fields[key] = parseLogValue(text.slice(index, end));
    index = end;
  }
  return { fields, end: index };
}

function parseServerLogLine(raw: string): LogEntry {
  const match = raw.match(/^(DEBUG|INFO|WARN|ERROR)\s+(\S+)\s+(\+\d+ms)\s+(.*)$/);
  if (!match) {
    return {
      level: "info",
      ts: "",
      delta: "",
      service: "",
      message: raw,
      fields: {},
      raw,
      source: "server",
    };
  }
  const [, levelRaw, ts, delta, rest] = match;
  const parsed = parseLeadingLogFields(rest);
  const service =
    typeof parsed.fields.service === "string" ? parsed.fields.service : "";
  const message = rest.slice(parsed.end).trim() || rest.trim();
  return {
    level: levelRaw.toLowerCase() as LogLevel,
    ts,
    delta,
    service,
    message,
    fields: parsed.fields,
    raw,
    source: "server",
  };
}

// ── Elapsed formatter ──

function fmtElapsed(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return s.toFixed(1) + "s";
  const m = Math.floor(s / 60);
  return m + "m" + (s - m * 60).toFixed(0) + "s";
}

// ── Merge all log sources (

function buildLogEntries(
  overlayEntries: LogEntry[],
  ndjsonEvents: any[],
  filterLevel: LogLevel,
): LogEntry[] {
  const levelOrder: Record<string, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };
  const threshold = levelOrder[filterLevel] ?? 0;

 // Server log lines (parsed from raw strings)
  const serverLines: LogEntry[] = _serverLogLines
    .map(parseServerLogLine)
    .filter((e) => (levelOrder[e.level] ?? 0) >= threshold);

 // Pipeline NDJSON events
  const pipelineLines: LogEntry[] = (Array.isArray(ndjsonEvents) ? ndjsonEvents : [])
    .filter((ev) => ev.kind !== "tool_delta")
    .flatMap((ev) => {
      const level: LogLevel = ev.kind === "error" ? "error" : "info";
      if ((levelOrder[level] ?? 0) < threshold) return [];
      const stage = ev.stage || "";
      const kind = ev.kind || "";
      const toolName = ev.toolName || "";
      const summary = ev.summary || ev.text || "";
      const parts: string[] = [];
      if (kind === "tool_call" && toolName) parts.push(`→ ${toolName}`);
      else if (kind === "tool_result" && toolName) parts.push(`← ${toolName}`);
      else if (kind === "status") parts.push(summary);
      else if (kind === "message_delta") parts.push("[text delta]");
      if (kind !== "status" && summary) {
        parts.push(summary.length > 150 ? summary.slice(0, 150) + "…" : summary);
      }
      const elapsed =
        typeof ev.elapsed_ms === "number" ? fmtElapsed(ev.elapsed_ms) : "";
      return [
        {
          level,
          ts: ev.at || "",
          service: stage,
          delta: elapsed,
          message: parts.join(" "),
          fields: {
            kind,
            ...(toolName ? { tool: toolName } : {}),
            ...(ev.status ? { status: ev.status } : {}),
          },
          raw: "",
          source: "pipeline" as LogSource,
        },
      ];
    });

  return [...serverLines, ...pipelineLines, ...overlayEntries].sort(
    (a, b) => (a.ts || "").localeCompare(b.ts || ""),
  );
}

function formatLogText(entries: LogEntry[]): string {
  return entries
    .map((e) => {
      const parts = [
        `[${String(e.source || "client").toUpperCase()}]`,
        `[${String(e.level || "info").toUpperCase()}]`,
      ];
      if (e.ts) parts.push(e.ts);
      if (e.service) parts.push(e.service);
      parts.push(e.message || "");
      const fields = logDetailFields(e.fields);
      if (Object.keys(fields).length) parts.push(stringifyLogValue(fields));
      return parts.join(" ");
    })
    .join("\n");
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ── LogEntryDetail subcomponent ──
// Ports renderLogEntryDetail ( 10928–10944)

function LogEntryDetail(props: { entry: LogEntry }) {
  const fields = createMemo(() => logDetailFields(props.entry.fields));
  const items = createMemo(() => Object.entries(fields()));

  return (
    <>
      <Show when={items().length > 0}>
        <div class="log-fields">
          <For each={items().slice(0, 6)}>
            {([key, value]) => (
              <span class="log-chip">
                {key}={logPreviewValue(value)}
              </span>
            )}
          </For>
        </div>
        <details class="log-detail">
          <summary>{t("log.details")}</summary>
          <div class="log-detail-block">
            <div class="log-detail-title">{t("log.fields")}</div>
            <pre class="log-detail-pre">{stringifyLogValue(fields(), 2)}</pre>
          </div>
          <Show when={!!props.entry.raw}>
            <div class="log-detail-block">
              <div class="log-detail-title">{t("log.raw")}</div>
              <pre class="log-detail-pre">{props.entry.raw}</pre>
            </div>
          </Show>
        </details>
      </Show>
      <Show when={items().length === 0 && !!props.entry.raw}>
        <details class="log-detail">
          <summary>{t("log.details")}</summary>
          <div class="log-detail-block">
            <div class="log-detail-title">{t("log.raw")}</div>
            <pre class="log-detail-pre">{props.entry.raw}</pre>
          </div>
        </details>
      </Show>
    </>
  );
}

// ── LogLine subcomponent ──

function LogLine(props: { entry: LogEntry }) {
  return (
    <div class="log-line" data-source={props.entry.source}>
      <div class="log-line-head">
        <span class="log-source" data-source={props.entry.source}>
          {logSourceLabel(props.entry.source)}
        </span>
        <span class={`log-level log-level-${props.entry.level}`}>
          [{props.entry.level.toUpperCase()}]
        </span>
        <Show when={!!props.entry.delta}>
          <span class="log-delta">{props.entry.delta}</span>
        </Show>
        <Show when={!!props.entry.service}>
          <span class="log-service">{props.entry.service}</span>
        </Show>
        <span class="log-ts">{props.entry.ts}</span>
      </div>
      <div class="log-msg">{props.entry.message || props.entry.raw || ""}</div>
      <LogEntryDetail entry={props.entry} />
    </div>
  );
}

// ── LogViewer component props ──

export interface LogViewerProps {
  /**
 * NDJSON pipeline events array. Pass the live ndjsonEvents array from the
 * or an empty array.
 */
  ndjsonEvents?: any[];
  /** Whether the dialog is open. */
  open?: boolean;
  onClose?: () => void;
}

// ── LogViewer ──

export function LogViewer(props: LogViewerProps) {
  let dialogRef: HTMLDialogElement | undefined;

  const [loading, setLoading] = createSignal(false);
  const [serverLogsSeq, setServerLogsSeq] = createSignal(0);

 // Merged & filtered log entries
  const entries = createMemo(() => {
    serverLogsSeq();
    return buildLogEntries(
      filteredLogEntries(),
      props.ndjsonEvents ?? [],
      appStore.logFilterLevel,
    );
  });

  const refresh = async () => {
    setLoading(true);
    try {
      await loadServerLogs();
      setServerLogsSeq((value) => value + 1);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    const text = formatLogText(entries());
    if (!text) return;
    await copyText(text);
  };

  const handleClear = () => {
 // Clear overlay client log entries via the store
    setAppStore("logEntries", []);
    _serverLogLines = [];
    setServerLogsSeq((value) => value + 1);
  };

  const handleLevelChange = (e: Event) => {
    const select = e.target as HTMLSelectElement;
    setAppStore("logFilterLevel", select.value as LogLevel);
  };

  createEffect(() => {
    const dialog = dialogRef;
    if (!dialog) return;
    if (props.open) {
      void refresh().finally(() => {
        if (!dialog.open) dialog.showModal();
      });
      return;
    }
    if (dialog.open) dialog.close();
  });


  return (
    <dialog
      id="logDialog"
      class="dialog dialog-wide"
      ref={(el) => (dialogRef = el)}
    >
      <div class="dialog-form">
        <div class="dialog-header">
          <span class="dialog-title">{t("log.title")}</span>
          <div class="dialog-header-actions">
            <select
              id="logLevelFilter"
              class="select select-sm"
              value={appStore.logFilterLevel}
              onChange={handleLevelChange}
              aria-label={t("log.filter_level")}
            >
              <option value="debug">DEBUG</option>
              <option value="info">INFO</option>
              <option value="warn">WARN</option>
              <option value="error">ERROR</option>
            </select>
            <button
              type="button"
              id="btnLogServerLogs"
              class="btn btn-ghost mini"
              onClick={() => void refresh()}
              disabled={loading()}
            >
              {t("log.load_server")}
            </button>
            <button
              type="button"
              id="btnLogRefresh"
              class="btn btn-ghost mini"
              onClick={() => void refresh()}
              disabled={loading()}
            >
              {t("common.refresh")}
            </button>
            <button
              type="button"
              id="btnLogCopy"
              class="btn btn-ghost mini"
              onClick={() => void handleCopy()}
              disabled={loading() || entries().length === 0}
            >
              {t("common.copy")}
            </button>
            <button
              type="button"
              id="btnLogClear"
              class="btn btn-ghost mini danger"
              onClick={handleClear}
            >
              {t("common.clear")}
            </button>
            <button
              type="button"
              id="btnCloseLog"
              class="btn btn-ghost mini"
              onClick={() => {
                dialogRef?.close();
                props.onClose?.();
              }}
            >
              {t("common.close")}
            </button>
          </div>
        </div>

        <div
          id="logViewerBody"
          class="log-viewer"
          ref={(el) => {
            // setupAutoScroll requires an AutoScrollOptions object. The prior
            // `setupAutoScroll(el)` call (missing opts) threw at first scroll:
            // `Cannot read properties of undefined (reading 'isTracking')`
            // which aborted the entire component tree render, leaving the
            // overlay blank and the benchmark's puppeteer assertion
            // (`Overlay did not render streamed task output within 120s`)
            // failing. Log panels want always-follow behaviour; provide a
            // constant tracker + no-op onUserScrollUp.
            const ctrl = setupAutoScroll(el, {
              isTracking: () => true,
              onUserScrollUp: () => {},
            });
            onCleanup(() => ctrl.cleanup());
          }}
        >
          <Show
            when={entries().length > 0}
            fallback={
              <div class="empty-hint">{t("log.empty")}</div>
            }
          >
            <For each={entries()} fallback={null}>
              {(entry) => <LogLine entry={entry} />}
            </For>
          </Show>
        </div>
      </div>
    </dialog>
  );
}
