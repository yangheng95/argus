// ── AppLog ──
// Integrates with store/app.ts appendLog for reactive log display,
// and flushes entries to the server via services/api.ts.

import { appendLog, type LogEntry, type LogLevel } from "../store/app";
import { apiJson } from "../services/api";

// ── Types ──

export interface AppLogEntry {
  ts: string;
  level: LogLevel;
  service: string;
  message: string;
  extra: unknown;
}

// ── Internal state ──

const MAX_ENTRIES = 2000;
const MAX_FLUSH_FAILURES = 5;

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const entries: AppLogEntry[] = [];
let filterLevel: LogLevel = "debug";
let _flushQueue: AppLogEntry[] = [];
let _flushTimer: ReturnType<typeof setTimeout> | null = null;
let _flushFailCount = 0;

// ── Helpers ──

function now(): string {
  return new Date().toISOString().split(".")[0];
}

function add(level: LogLevel, service: string, message: string, extra: unknown): AppLogEntry {
  const entry: AppLogEntry = { ts: now(), level, service, message, extra };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
  return entry;
}

function flush(): void {
  _flushTimer = null;
  const batch = _flushQueue.splice(0);
  if (batch.length === 0) return;
  for (const entry of batch) {
    const extraObj =
      entry.extra && typeof entry.extra === "object" ? entry.extra as Record<string, unknown> : undefined;
    const msg =
      entry.extra && !extraObj ? `${entry.message} ${entry.extra}` : entry.message;
    apiJson("log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service: "overlay:" + entry.service,
        level: entry.level,
        message: msg,
        extra: extraObj,
      }),
    })
      .then(() => {
        _flushFailCount = 0;
      })
      .catch(() => {
        _flushFailCount++;
        if (_flushFailCount <= MAX_FLUSH_FAILURES) {
          _flushQueue.push(entry);
        }
      });
  }
}

function persist(entry: AppLogEntry): void {
  _flushQueue.push(entry);
  if (!_flushTimer) {
    _flushTimer = setTimeout(flush, 500);
  }
}

export async function waitForLogDrain(timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (_flushTimer || _flushQueue.length > 0) {
    if (Date.now() - started >= timeoutMs) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function log(level: LogLevel, service: string, message: string, extra?: unknown): AppLogEntry {
  const entry = add(level, service, message, extra);
  persist(entry);

 // Mirror entry into the Solid reactive store (store/app.ts) so the log
 // viewer component can display overlay log entries reactively.
  const storeEntry: LogEntry = {
    ts: entry.ts,
    level: entry.level,
    service: entry.service,
    delta: "",
    message: entry.message,
    fields: entry.extra && typeof entry.extra === "object"
      ? (entry.extra as Record<string, unknown>)
      : {},
    raw: "",
    source: "overlay",
  };
  appendLog(storeEntry);

  return entry;
}

// ── Public API ──

export const AppLog = {
  debug: (service: string, msg: string, extra?: unknown) =>
    log("debug", service, msg, extra),
  info: (service: string, msg: string, extra?: unknown) =>
    log("info", service, msg, extra),
  warn: (service: string, msg: string, extra?: unknown) =>
    log("warn", service, msg, extra),
  error: (service: string, msg: string, extra?: unknown) =>
    log("error", service, msg, extra),

  /** All accumulated entries (mutable reference, mirrors app.js behaviour). */
  entries,

  get filterLevel(): LogLevel {
    return filterLevel;
  },
  set filterLevel(v: LogLevel) {
    filterLevel = v;
  },

  /** Return entries filtered to at least the current filterLevel. */
  filtered(): AppLogEntry[] {
    const min = LOG_LEVEL_ORDER[filterLevel] ?? 0;
    return entries.filter((e) => (LOG_LEVEL_ORDER[e.level] ?? 0) >= min);
  },

  /** Clear the in-memory entry buffer. */
  clear(): void {
    entries.length = 0;
  },
};

// ── Log viewer helpers ──
// aggregation functions .
// These functions are used by both the path and by any
// future Solid log-viewer component.

// ── stringifyLogValue ──

export function stringifyLogValue(value: unknown, space = 0): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, space);
  } catch {
    return String(value ?? "");
  }
}

// ── fmtElapsed ──
// Format a millisecond duration as a short human-readable string.

export function fmtElapsed(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return s.toFixed(1) + "s";
  const m = Math.floor(s / 60);
  return m + "m" + (s - m * 60).toFixed(0) + "s";
}

// ── parseServerLogLine ──
// Parse a single raw server-log line into a structured log entry object.

interface ServerLogEntry {
  level: string;
  ts: string;
  delta: string;
  service: string;
  message: string;
  fields: Record<string, unknown>;
  raw: string;
  source?: string;
}

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
    } catch { /* fall through */ }
  }
  return text;
}

function parsePinoLogLine(raw: string): ServerLogEntry | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const level = typeof record.level === "string" ? record.level : "info";
  const ts = typeof record.time === "string" ? record.time.replace(/\.\d{3}Z$/, "") : "";
  const message = typeof record.message === "string" ? record.message : "";
  const service = typeof record.service === "string" ? record.service : "";
  const fields = { ...record };
  delete fields.level;
  delete fields.time;
  delete fields.message;
  return {
    level,
    ts,
    delta: typeof record.duration === "number" ? fmtElapsed(record.duration) : "",
    service,
    message,
    fields,
    raw,
  };
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
  const stack: string[] = [text[start]];
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
  if (first === '"' || first === "{" || first === "[")
    return scanBalancedLogValue(text, start);
  let cursor = start;
  while (cursor < text.length) {
    const nextSpace = text.indexOf(" ", cursor);
    if (nextSpace < 0) return text.length;
    let probe = nextSpace;
    while (probe < text.length && text[probe] === " ") probe++;
    if (/^[A-Za-z0-9_.-]+=/.test(text.slice(probe))) return nextSpace;
    return nextSpace;
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

export function parseServerLogLine(raw: string): ServerLogEntry {
  const pinoLine = parsePinoLogLine(raw);
  if (pinoLine) return pinoLine;
  const match = raw.match(
    /^(DEBUG|INFO|WARN|ERROR)\s+(\S+)\s+(\+\d+ms)\s+(.*)$/,
  );
  if (!match) {
    return { level: "info", ts: "", delta: "", service: "", message: raw, fields: {}, raw };
  }
  const [, level, ts, delta, rest] = match;
  const parsed = parseLeadingLogFields(rest);
  const service =
    typeof parsed.fields.service === "string" ? parsed.fields.service : "";
  const message = rest.slice(parsed.end).trim() || rest.trim();
  return {
    level: level.toLowerCase(),
    ts,
    delta,
    service,
    message,
    fields: parsed.fields,
    raw,
  };
}

// ── logDetailFields ──
// Strip the "service" key from a fields object (it is displayed separately).

export function logDetailFields(
  fields: unknown,
): Record<string, unknown> {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return {};
  return Object.fromEntries(
    Object.entries(fields as Record<string, unknown>).filter(
      ([key]) => key !== "service",
    ),
  );
}

// ── ndjsonEventTypeLabel ──
// Format a dotted event-type string for display.

export function ndjsonEventTypeLabel(type: string): string {
  return (type || "")
    .replace(/\./g, " › ");
}

// ── logViewerEntries ──
// Aggregate overlay client logs, server log lines, and pipeline ndjson events
// into a unified sorted array for the log viewer.
// Parameters are accepted explicitly so that this function can be unit-tested
// without depending on module-level state:
// serverLogLines — raw server-log text lines (from _serverLogLines
// ndjsonEvents — ndjson event objects (from state.ndjsonEvents

export interface LogViewerEntry {
  level: string;
  ts: string;
  service: string;
  delta: string;
  message: string;
  fields: Record<string, unknown>;
  raw: string;
  source: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function logViewerEntries(
  serverLogLines: string[],
  ndjsonEvents: any[],
): LogViewerEntry[] {
  const minLevel: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
  const threshold = minLevel[AppLog.filterLevel] || 0;

 // Overlay client logs
  const clientLines: LogViewerEntry[] = AppLog.filtered().map((e) => ({
    level: e.level,
    ts: e.ts,
    service: e.service,
    delta: "",
    message: e.message,
    fields: isRecord(e.extra)
      ? (e.extra as Record<string, unknown>)
      : e.extra == null
        ? {}
        : { extra: e.extra },
    raw: "",
    source: "overlay",
  }));

 // Server logs
  const serverLines: LogViewerEntry[] = serverLogLines
    .map(parseServerLogLine)
    .filter((e) => (minLevel[e.level] || 0) >= threshold)
    .map((e) => ({ ...e, source: "server" }));

 // Pipeline execution events → unified log entries
  const ndjsonLines: LogViewerEntry[] = (ndjsonEvents || [])
    .filter((ev: any) => ev.kind !== "tool_delta")
    .map((ev: any): LogViewerEntry | null => {
      const level = ev.kind === "error" ? "error" : "info";
      if ((minLevel[level] || 0) < threshold) return null;
      const stage: string = ev.stage || "";
      const kind: string = ev.kind || "";
      const toolName: string = ev.toolName || "";
      const summary: string = ev.summary || ev.text || "";
      const parts: string[] = [];
      if (kind === "tool_call" && toolName) parts.push(`→ ${toolName}`);
      else if (kind === "tool_result" && toolName) parts.push(`← ${toolName}`);
      else if (kind === "status") parts.push(summary);
      else if (kind === "message_delta") parts.push("[text delta]");
      if (kind !== "status" && summary) {
        parts.push(summary.length > 150 ? summary.slice(0, 150) + "\u2026" : summary);
      }
      const elapsed =
        typeof ev.elapsed_ms === "number" ? fmtElapsed(ev.elapsed_ms) : "";
      return {
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
        source: "pipeline",
      };
    })
    .filter((e): e is LogViewerEntry => e !== null);

  return [...serverLines, ...ndjsonLines, ...clientLines].sort(
    (a, b) => (a.ts || "").localeCompare(b.ts || ""),
  );
}

// ── formatLogViewerText ──
// Serialise a list of log viewer entries to a plain-text string for copying.

export function formatLogViewerText(entries: LogViewerEntry[]): string {
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
