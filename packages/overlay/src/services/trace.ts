// ── AgentTrace fetch client ──
//
// Reads JSONL-derived events from the opencorvus server's debug routes and
// caches them per (sessionID|taskID) so the trace panel can re-open without
// hammering the disk on every render. The cache is invalidated when the user
// explicitly refreshes — backend writes are append-only so a stale cached
// list is never WRONG, just incomplete.

import { apiJson } from "./api"

export interface TraceEvent {
  ts: number
  kind: string
  sessionID?: string
  parentSessionID?: string
  taskID?: string
  agentName?: string
  agentMode?: string
  payload?: Record<string, any>
  [key: string]: any
}

export type TraceFetchResult =
  | {
      ok: true
      events: TraceEvent[]
      /** Server-resolved trace directory; surfaces in the empty state so the
       *  operator can see WHICH dir was scanned (path-mismatch is the dominant
       *  cause of "events:[]" when agents have actually run). */
      traceDir: string
      /** Server's AgentTrace.isEnabled() value. False = OPENCORVUS_AGENT_TRACE=0
       *  was set on the server process and no traces are being written. */
      enabled: boolean
    }
  | {
      ok: false
      events: TraceEvent[]
      traceDir: string
      enabled: boolean
      error: string
    }

const sessionCache = new Map<string, TraceFetchResult>()
const taskCache = new Map<string, TraceFetchResult>()

const EMPTY_RESULT: TraceFetchResult = { ok: true, events: [], traceDir: "", enabled: true }

function traceFetchError(error: unknown, target: string): TraceFetchResult {
  const message = error instanceof Error ? error.message : String(error)
  return {
    ok: false,
    events: [],
    traceDir: "",
    enabled: true,
    error: `${target}: ${message || "unknown trace fetch error"}`,
  }
}

function normaliseResult(data: unknown): TraceFetchResult {
  if (!data || typeof data !== "object") {
    return traceFetchError("malformed trace response: expected object", "trace")
  }
  const obj = data as Record<string, unknown>
  if (!Array.isArray(obj.events)) {
    return traceFetchError("malformed trace response: events must be an array", "trace")
  }
  if (typeof obj.traceDir !== "string") {
    return traceFetchError("malformed trace response: traceDir must be a string", "trace")
  }
  if (typeof obj.enabled !== "boolean") {
    return traceFetchError("malformed trace response: enabled must be a boolean", "trace")
  }
  return { ok: true, events: obj.events as TraceEvent[], traceDir: obj.traceDir, enabled: obj.enabled }
}

export async function fetchSessionTrace(sessionID: string, opts?: { force?: boolean }): Promise<TraceFetchResult> {
  if (!sessionID) return EMPTY_RESULT
  if (!opts?.force) {
    const cached = sessionCache.get(sessionID)
    if (cached) return cached
  }
  try {
    const data = await apiJson(`session/${encodeURIComponent(sessionID)}/trace`)
    const result = normaliseResult(data)
    sessionCache.set(sessionID, result)
    return result
  } catch (err) {
    console.warn("trace fetch (session) failed", sessionID, err)
    return traceFetchError(err, `session ${sessionID}`)
  }
}

export async function fetchTaskTrace(taskID: string, opts?: { force?: boolean }): Promise<TraceFetchResult> {
  if (!taskID) return EMPTY_RESULT
  if (!opts?.force) {
    const cached = taskCache.get(taskID)
    if (cached) return cached
  }
  try {
    const data = await apiJson(`task/${encodeURIComponent(taskID)}/trace`)
    const result = normaliseResult(data)
    taskCache.set(taskID, result)
    return result
  } catch (err) {
    console.warn("trace fetch (task) failed", taskID, err)
    return traceFetchError(err, `task ${taskID}`)
  }
}

export function invalidateTraceCache(scope?: { sessionID?: string; taskID?: string }) {
  if (!scope) {
    sessionCache.clear()
    taskCache.clear()
    return
  }
  if (scope.sessionID) sessionCache.delete(scope.sessionID)
  if (scope.taskID) taskCache.delete(scope.taskID)
}
