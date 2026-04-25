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

const sessionCache = new Map<string, TraceEvent[]>();
const taskCache = new Map<string, TraceEvent[]>();

export async function fetchSessionTrace(sessionID: string, opts?: { force?: boolean }): Promise<TraceEvent[]> {
  if (!sessionID) return [];
  if (!opts?.force) {
    const cached = sessionCache.get(sessionID);
    if (cached) return cached;
  }
  try {
    const data = await apiJson(`session/${encodeURIComponent(sessionID)}/trace`);
    const events = Array.isArray((data as any)?.events) ? ((data as any).events as TraceEvent[]) : [];
    sessionCache.set(sessionID, events);
    return events;
  } catch (err) {
    console.warn("trace fetch (session) failed", sessionID, err);
    return [];
  }
}

export async function fetchTaskTrace(taskID: string, opts?: { force?: boolean }): Promise<TraceEvent[]> {
  if (!taskID) return [];
  if (!opts?.force) {
    const cached = taskCache.get(taskID);
    if (cached) return cached;
  }
  try {
    const data = await apiJson(`task/${encodeURIComponent(taskID)}/trace`);
    const events = Array.isArray((data as any)?.events) ? ((data as any).events as TraceEvent[]) : [];
    taskCache.set(taskID, events);
    return events;
  } catch (err) {
    console.warn("trace fetch (task) failed", taskID, err);
    return [];
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
