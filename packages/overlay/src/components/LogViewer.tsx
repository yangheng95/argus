// ── LogViewer Component ──
// Full-featured log viewer dialog that merges overlay client logs, server logs,
// and pipeline newline-delimited JSON (NDJSON) events. Ports renderLogViewer / renderNdjsonLogPanel /
// renderLogEntryDetail / logViewerEntries ( lines 10947–11155) and all
// supporting helpers (parseServerLogLine, stringifyLogValue, etc., lines
// 10795–10926).

import {
  createEffect,
  createSignal,
  createMemo,
  For,
  Show,
} from "solid-js";
import { VList, type VListHandle } from "virtua/solid";
import { appStore, setAppStore, filteredLogEntries } from "../store/app";
import type { LogEntry, LogLevel, LogSource } from "../store/app";
import { t } from "../utils/i18n";
import { apiJson } from "../services/api";
import { useAsyncAction } from "../solid/async-action";
import { Dialog } from "./primitives/Dialog";
import { Button } from "./ui/Button";
import {
  fmtElapsed,
  logDetailFields,
  parseServerLogLine,
  stringifyLogValue,
} from "../utils/log";

// ── Re-export types so callers can use them without importing store/app ──
export type { LogEntry, LogLevel, LogSource };

// ── Constants ──

const NDJSON_STAGE_COLORS: Record<string, string> = {
  spec: "#3A86FF",
  planner: "#7B54C9",
  goal: "#2ECC71",
  judge: "#F39C12",
  acceptance: "#28B4A0",
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

function clipText(value: string, limit = 80): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function logPreviewValue(value: unknown): string {
  return clipText(stringifyLogValue(value), 80);
}

function logSourceLabel(source: LogSource): string {
  if (source === "server") return "Server";
  if (source === "pipeline") return "Pipeline";
  return "Overlay";
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
    .map((line): LogEntry => {
      const entry = parseServerLogLine(line);
      return {
        ...entry,
        level: entry.level as LogLevel,
        source: "server",
      };
    })
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
  const [serverLogsSeq, setServerLogsSeq] = createSignal(0);
  let logList: VListHandle | undefined;

 // Merged & filtered log entries
  const entries = createMemo(() => {
    serverLogsSeq();
    return buildLogEntries(
      filteredLogEntries(),
      props.ndjsonEvents ?? [],
      appStore.logFilterLevel,
    );
  });

  const refreshAction = useAsyncAction(async () => {
    await loadServerLogs();
    setServerLogsSeq((value) => value + 1);
  });

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
    if (props.open) {
      void refreshAction.run();
    }
  });

  createEffect(() => {
    if (!props.open) return;
    const count = entries().length;
    if (count > 0) {
      queueMicrotask(() => logList?.scrollToIndex(count - 1, { align: "end" }));
    }
  });

  return (
    <Dialog
      id="logDialog"
      open={props.open === true}
      wide={true}
      title={t("log.title")}
      onClose={() => props.onClose?.()}
      headerActions={
        <>
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
          <Button
            type="button"
            id="btnLogServerLogs"
            variant="ghost"
            size="sm"
            tone="neutral"
            onClick={() => void refreshAction.run()}
            disabled={refreshAction.pending()}
          >
            {t("log.load_server")}
          </Button>
          <Button
            type="button"
            id="btnLogRefresh"
            variant="ghost"
            size="sm"
            tone="neutral"
            onClick={() => void refreshAction.run()}
            disabled={refreshAction.pending()}
          >
            {t("common.refresh")}
          </Button>
          <Button
            type="button"
            id="btnLogCopy"
            variant="ghost"
            size="sm"
            tone="neutral"
            onClick={() => void handleCopy()}
            disabled={refreshAction.pending() || entries().length === 0}
          >
            {t("common.copy")}
          </Button>
          <Button
            type="button"
            id="btnLogClear"
            variant="ghost"
            size="sm"
            tone="danger"
            onClick={handleClear}
          >
            {t("common.clear")}
          </Button>
          <Button
            type="button"
            id="btnCloseLog"
            variant="ghost"
            size="sm"
            tone="neutral"
            onClick={() => props.onClose?.()}
          >
            {t("common.close")}
          </Button>
        </>
      }
    >
      <Show
        when={entries().length > 0}
        fallback={
          <div id="logViewerBody" class="log-viewer">
            <div class="empty-hint">{t("log.empty")}</div>
          </div>
        }
      >
        <VList
          id="logViewerBody"
          class="log-viewer"
          data={entries()}
          itemSize={88}
          overscan={8}
          ref={(handle) => {
            logList = handle;
          }}
        >
          {(entry) => <LogLine entry={entry} />}
        </VList>
      </Show>
    </Dialog>
  );
}
