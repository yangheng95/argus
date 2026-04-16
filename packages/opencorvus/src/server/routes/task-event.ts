import { OrchestratorTaskTable } from "@/orchestrator/orchestrator.sql"
import { SessionTable } from "@/session/session.sql"
import { Database, eq } from "@/storage/db"

// In-memory registry of goal run session IDs → { taskID, role, goalID? }.
// Maintained by the orchestrator runtime when goal runs are created/finalized.
// O(1) lookup with no DB queries at event-dispatch time.
const goalRunSessionRegistry = new Map<string, { taskID: string; role: string; goalID?: string }>()

function cacheTaskSessions(taskID: string, role: string, goalID: string | undefined, ...sessionIDs: Array<string | undefined>) {
  for (const sessionID of sessionIDs) {
    if (!sessionID) continue
    goalRunSessionRegistry.set(sessionID, { taskID, role, goalID })
  }
}

export function registerGoalRunSession(sessionID: string, taskID: string, role = "executor", goalID?: string) {
  cacheTaskSessions(taskID, role, goalID, sessionID)
}

/**
 * Ensure `sessionID` is registered under `taskID` WITHOUT clobbering an
 * already-recorded role or goalID. Use this from bulk reseed paths (e.g.
 * the task SSE endpoint walking Session.children()) that only know the
 * taskID — otherwise they would overwrite the goalID that goal-pool.ts
 * set at dispatch time, which is what enrichProperties stamps onto every
 * outgoing message.
 */
export function ensureTaskSession(sessionID: string, taskID: string): void {
  if (!sessionID) return
  const existing = goalRunSessionRegistry.get(sessionID)
  if (existing) {
    if (existing.taskID !== taskID) {
      goalRunSessionRegistry.set(sessionID, { ...existing, taskID })
    }
    return
  }
  goalRunSessionRegistry.set(sessionID, { taskID, role: "assistant", goalID: undefined })
}

/** Look up the registered role for a session (e.g. "executor", "assistant"). */
export function sessionRole(sessionID: string): string | undefined {
  return goalRunSessionRegistry.get(sessionID)?.role
}

/** Look up the goalID associated with a session (if any). */
export function sessionGoalID(sessionID: string): string | undefined {
  return goalRunSessionRegistry.get(sessionID)?.goalID
}

/**
 * Look up the parent session id. Root task-agent sessions have no parent
 * (returns undefined). Drives overlay card nesting: a card's position in
 * the tree is literally its parent session's position + 1 level of nesting.
 *
 * Reads from SessionTable (the authoritative child→parent edge), with a
 * process-local cache so we don't hit sqlite on every SSE event.
 */
const sessionParentCache = new Map<string, string | null>()

export function sessionParentID(sessionID: string): string | undefined {
  if (!sessionID) return undefined
  const cached = sessionParentCache.get(sessionID)
  if (cached !== undefined) return cached === null ? undefined : cached
  const row = Database.use((db) =>
    db
      .select({ parentID: SessionTable.parent_id })
      .from(SessionTable)
      .where(eq(SessionTable.id, sessionID))
      .get(),
  )
  const parentID = typeof row?.parentID === "string" && row.parentID ? row.parentID : null
  sessionParentCache.set(sessionID, parentID)
  return parentID ?? undefined
}

export function invalidateSessionParent(sessionID: string): void {
  sessionParentCache.delete(sessionID)
}

export function unregisterGoalRunSession(sessionID: string) {
  goalRunSessionRegistry.delete(sessionID)
}

/**
 * Drop every session previously registered for `taskID`. Called from the
 * task-agent terminal path so the registry doesn't grow unboundedly across
 * benchmark runs — each task spawns ~10+ sub-sessions (planner, executor,
 * requirements, design, architect, delivery, refine, build, assistant) and
 * none of the register call sites pair with an unregister.
 */
export function clearTaskSessions(taskID: string) {
  for (const [sessionID, entry] of goalRunSessionRegistry) {
    if (entry.taskID === taskID) goalRunSessionRegistry.delete(sessionID)
  }
}

export function taskSession(taskID: string) {
  const row = Database.use((db) =>
    db
      .select({ sessionID: OrchestratorTaskTable.session_id })
      .from(OrchestratorTaskTable)
      .where(eq(OrchestratorTaskTable.id, taskID))
      .get(),
  )
  const sessionID = row?.sessionID ?? undefined
  cacheTaskSessions(taskID, "assistant", undefined, sessionID)
  return sessionID
}

export function taskIDForSession(sessionID: string) {
  const initial = typeof sessionID === "string" ? sessionID.trim() : ""
  if (!initial) return undefined
  const visited: string[] = []
  let current = initial
  while (current && !visited.includes(current)) {
    visited.push(current)
    const cached = goalRunSessionRegistry.get(current)
    if (cached) {
      cacheTaskSessions(cached.taskID, cached.role, cached.goalID, ...visited)
      return cached.taskID
    }
    const task = Database.use((db) =>
      db
        .select({ id: OrchestratorTaskTable.id })
        .from(OrchestratorTaskTable)
        .where(eq(OrchestratorTaskTable.session_id, current))
        .get(),
    )
    if (task?.id) {
      cacheTaskSessions(task.id, "assistant", undefined, ...visited)
      return task.id
    }
    const parent = Database.use((db) =>
      db
        .select({ parentID: SessionTable.parent_id })
        .from(SessionTable)
        .where(eq(SessionTable.id, current))
        .get(),
    )
    current = typeof parent?.parentID === "string" ? parent.parentID : ""
  }
  return undefined
}

export function matchesTaskEvent(
  event: { type: string; properties: Record<string, unknown> },
  taskID: string,
  sessionID?: string,
) {
  if (event.properties?.taskID === taskID) return true
  const evtSession = eventSession(event.properties)
  if (!evtSession) return false
  if (evtSession === sessionID) return true
  // Also match events from goal run sessions belonging to this task.
  return goalRunSessionRegistry.get(evtSession)?.taskID === taskID
}

function eventSession(properties: Record<string, unknown>) {
  if (typeof properties.sessionID === "string") return properties.sessionID
  const info = properties.info
  if (info && typeof info === "object" && "sessionID" in info && typeof info.sessionID === "string") {
    return info.sessionID
  }
  const part = properties.part
  if (part && typeof part === "object" && "sessionID" in part && typeof part.sessionID === "string") {
    return part.sessionID
  }
  return undefined
}
