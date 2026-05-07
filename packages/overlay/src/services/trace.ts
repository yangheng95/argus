// ── AgentTrace fetch client ──
//
// Reads JSONL-derived events from the opencorvus server's debug routes and
// caches them per (sessionID|taskID) so the trace panel can re-open without
// hammering the disk on every render. The cache is invalidated when the user
// explicitly refreshes — backend writes are append-only so a stale cached
// list is never WRONG, just incomplete.

import { apiJson } from "./api";

export interface TraceEvent {
  ts: number;
  kind: string;
  sessionID?: string;
  parentSessionID?: string;
  taskID?: string;
  agentName?: string;
  agentMode?: string;
  payload?: Record<string, any>;
  [key: string]: any;
}

export interface TraceFetchResult {
  events: TraceEvent[];
  /** Server-resolved trace directory; surfaces in the empty state so the
   *  operator can see WHICH dir was scanned (path-mismatch is the dominant
   *  cause of "events:[]" when agents have actually run). */
  traceDir: string;
  /** Server's AgentTrace.isEnabled() value. False = OPENCORVUS_AGENT_TRACE=0
   *  was set on the server process and no traces are being written. */
  enabled: boolean;
}

const sessionCache = new Map<string, TraceFetchResult>();
const taskCache = new Map<string, TraceFetchResult>();

const EMPTY_RESULT: TraceFetchResult = { events: [], traceDir: "", enabled: true };

function normaliseResult(data: unknown): TraceFetchResult {
  const obj = (data ?? {}) as Record<string, unknown>;
  const events = Array.isArray(obj.events) ? (obj.events as TraceEvent[]) : [];
  const traceDir = typeof obj.traceDir === "string" ? obj.traceDir : "";
  const enabled = typeof obj.enabled === "boolean" ? obj.enabled : true;
  return { events, traceDir, enabled };
}

export async function fetchSessionTrace(
  sessionID: string,
  opts?: { force?: boolean },
): Promise<TraceFetchResult> {
  if (!sessionID) return EMPTY_RESULT;
  if (!opts?.force) {
    const cached = sessionCache.get(sessionID);
    if (cached) return cached;
  }
  try {
    const data = await apiJson(`session/${encodeURIComponent(sessionID)}/trace`);
    const result = normaliseResult(data);
    sessionCache.set(sessionID, result);
    return result;
  } catch (err) {
    console.warn("trace fetch (session) failed", sessionID, err);
    return EMPTY_RESULT;
  }
}

export async function fetchTaskTrace(
  taskID: string,
  opts?: { force?: boolean },
): Promise<TraceFetchResult> {
  if (!taskID) return EMPTY_RESULT;
  if (!opts?.force) {
    const cached = taskCache.get(taskID);
    if (cached) return cached;
  }
  try {
    const data = await apiJson(`task/${encodeURIComponent(taskID)}/trace`);
    const result = normaliseResult(data);
    taskCache.set(taskID, result);
    return result;
  } catch (err) {
    console.warn("trace fetch (task) failed", taskID, err);
    return EMPTY_RESULT;
  }
}

export function invalidateTraceCache(scope?: { sessionID?: string; taskID?: string }) {
  if (!scope) {
    sessionCache.clear();
    taskCache.clear();
    return;
  }
  if (scope.sessionID) sessionCache.delete(scope.sessionID);
  if (scope.taskID) taskCache.delete(scope.taskID);
}
