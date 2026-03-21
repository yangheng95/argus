import { OrchestratorTaskTable } from "@/orchestrator/orchestrator.sql"
import { SessionTable } from "@/session/session.sql"
import { Database, eq } from "@/storage/db"

// In-memory registry of goal run session IDs → task IDs.
// Maintained by the orchestrator runtime when goal runs are created/finalized.
// O(1) lookup with no DB queries at event-dispatch time.
const goalRunSessionRegistry = new Map<string, string>()

function cacheTaskSessions(taskID: string, ...sessionIDs: Array<string | undefined>) {
  for (const sessionID of sessionIDs) {
    if (!sessionID) continue
    goalRunSessionRegistry.set(sessionID, taskID)
  }
}

export function registerGoalRunSession(sessionID: string, taskID: string) {
  cacheTaskSessions(taskID, sessionID)
}

export function unregisterGoalRunSession(sessionID: string) {
  goalRunSessionRegistry.delete(sessionID)
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
  cacheTaskSessions(taskID, sessionID)
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
      cacheTaskSessions(cached, ...visited)
      return cached
    }
    const task = Database.use((db) =>
      db
        .select({ id: OrchestratorTaskTable.id })
        .from(OrchestratorTaskTable)
        .where(eq(OrchestratorTaskTable.session_id, current))
        .get(),
    )
    if (task?.id) {
      cacheTaskSessions(task.id, ...visited)
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
  return goalRunSessionRegistry.get(evtSession) === taskID
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
