import { EngineTaskTable } from "@/engine/engine.sql"
import { taskToolSubagentNameFromMetadata } from "@/agent/subagent-session-metadata"
import { SessionTable, type SessionKind } from "@/session/session.sql"
import { Database, eq, sql } from "@/storage/db"
import { timelineOrderKey } from "@/timeline/order"

/**
 * Session metadata lookups for the SSE bridge.
 *
 * The DB is the authoritative source for "what is this session" — every
 * answer comes from columns we wrote at session-creation time
 * (`session.kind`, `session.parent_id`, `session.goal_id`) or from
 * `engine_task.session_id`. Process-local caches sit on top of these
 * lookups for the SSE hot path; they hold values that never change after
 * a session is created (kind / goal_id / parent / owning task), so an LRU
 * with a generous cap is enough — no invalidation is needed.
 *
 * No write APIs (no `register*`, no `ensure*`, no `clear*`): callers cannot
 * change a session's identity from outside its `Session.createNext` call.
 */

// Per-process caches for the SSE hot path. Sessions are immutable in the
// dimensions we read here (kind / goal_id / parent / owning task), so we
// cache forever and rely on the LRU cap to bound memory.
const LRU_LIMIT = 4096

class LRU<K, V> {
  private map = new Map<K, V>()
  constructor(private limit: number) {}
  get(key: K): V | undefined {
    const v = this.map.get(key)
    if (v === undefined) return undefined
    // Refresh recency by re-inserting at the tail.
    this.map.delete(key)
    this.map.set(key, v)
    return v
  }
  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key)
    else if (this.map.size >= this.limit) {
      const oldest = this.map.keys().next().value
      if (oldest !== undefined) this.map.delete(oldest)
    }
    this.map.set(key, value)
  }
}

const kindCache = new LRU<string, SessionKind>(LRU_LIMIT)
const goalIDCache = new LRU<string, string | null>(LRU_LIMIT)
const parentCache = new LRU<string, string | null>(LRU_LIMIT)
const taskIDCache = new LRU<string, string>(LRU_LIMIT)

export interface ConversationAgentSessionLedgerRow {
  sessionID: string
  orderKey: string
  stage: SessionKind
  title?: string
  parentSessionID?: string
  goalID?: string
  metadata?: Record<string, unknown>
  timeCreated: number
  timeUpdated: number
  latestStatus?: ConversationAgentSessionLedgerStatus
  latestStatusEmittedAt?: number
}

export interface ConversationAgentSessionLedgerStatus {
  type: string
  reason?: string
  error?: string
}

export interface AgentInvocationNode {
  sessionID: string
  orderKey: string
  agent: string
  kind: SessionKind
  title?: string
  parentSessionID?: string
  parentAgentSessionID?: string
  goalID?: string
  status?: ConversationAgentSessionLedgerStatus & { emittedAt: number }
  time: {
    created: number
    updated: number
  }
}

export interface AgentInvocationEdge {
  fromSessionID: string
  toSessionID: string
  relation: "agent_call"
  viaSessionIDs?: string[]
}

export interface AgentInvocationDAG {
  taskID: string
  rootSessionID?: string
  nodes: AgentInvocationNode[]
  edges: AgentInvocationEdge[]
  topLevelSessionIDs: string[]
}

function readSessionRow(sessionID: string) {
  return Database.use((db) =>
    db
      .select({
        kind: SessionTable.kind,
        goal_id: SessionTable.goal_id,
        parent_id: SessionTable.parent_id,
      })
      .from(SessionTable)
      .where(eq(SessionTable.id, sessionID))
      .get(),
  )
}

function loadAndCache(sessionID: string) {
  const row = readSessionRow(sessionID)
  if (!row) return undefined
  kindCache.set(sessionID, row.kind as SessionKind)
  goalIDCache.set(sessionID, row.goal_id ?? null)
  parentCache.set(sessionID, row.parent_id ?? null)
  return row
}

/** The session's role/purpose — fixed at creation in `Session.createNext`. */
export function sessionRole(sessionID: string): SessionKind | undefined {
  if (!sessionID) return undefined
  const cached = kindCache.get(sessionID)
  if (cached !== undefined) return cached
  const row = loadAndCache(sessionID)
  return row?.kind as SessionKind | undefined
}

/** The goal this session belongs to (planner / executor / build sessions). */
export function sessionGoalID(sessionID: string): string | undefined {
  if (!sessionID) return undefined
  const cached = goalIDCache.get(sessionID)
  if (cached !== undefined) return cached === null ? undefined : cached
  const row = loadAndCache(sessionID)
  return row?.goal_id ?? undefined
}

/** Parent session id; undefined for root sessions. */
export function sessionParentID(sessionID: string): string | undefined {
  if (!sessionID) return undefined
  const cached = parentCache.get(sessionID)
  if (cached !== undefined) return cached === null ? undefined : cached
  const row = loadAndCache(sessionID)
  return row?.parent_id ?? undefined
}

/**
 * The owning task's session_id. A pure DB read of
 * `engine_task.session_id` for `taskID`.
 */
export function taskSession(taskID: string): string | undefined {
  const row = Database.use((db) =>
    db
      .select({ sessionID: EngineTaskTable.session_id })
      .from(EngineTaskTable)
      .where(eq(EngineTaskTable.id, taskID))
      .get(),
  )
  return row?.sessionID ?? undefined
}

/**
 * Walk `session.parent_id` to the root, then look up
 * `engine_task.session_id` to find the owning task. Returns undefined
 * only when the session is genuinely orphaned (no parent chain reaches a
 * task root) — callers should treat that as a bug, not a fallback.
 */
export function taskIDForSession(sessionID: string): string | undefined {
  const initial = typeof sessionID === "string" ? sessionID.trim() : ""
  if (!initial) return undefined

  const cachedTask = taskIDCache.get(initial)
  if (cachedTask !== undefined) return cachedTask

  const visited: string[] = []
  let current: string | undefined = initial
  while (current && !visited.includes(current)) {
    visited.push(current)

    // Direct hit: `current` is the root session of a task.
    const task = Database.use((db) =>
      db.select({ id: EngineTaskTable.id }).from(EngineTaskTable).where(eq(EngineTaskTable.session_id, current!)).get(),
    )
    if (task?.id) {
      for (const sid of visited) taskIDCache.set(sid, task.id)
      return task.id
    }

    // Walk one level up the session tree.
    current = sessionParentID(current)
  }
  return undefined
}

export function invalidateSessionParent(sessionID: string): void {
  parentCache.set(sessionID, null) // overwrite next read; LRU eviction is cheap
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
  return taskIDForSession(evtSession) === taskID
}

/**
 * Latest `time_updated` watermark across every message and part in any
 * session belonging to `taskID`'s session tree. Used by the
 * conversation-history SSE bridge to detect new writes since a polling
 * cursor; lives here (not in `routes/orchestrator`) so route handlers
 * keep their SQL discipline (no direct `Database.use` / `sql\`...\``
 * inside `routes/`).
 *
 * Returns 0 when the task has no messages/parts yet, so callers can
 * safely use it as a monotonic comparator without a special-case for
 * empty tasks.
 */
export function taskMessageWatermark(taskID: string): number {
  return taskMessageWatermarkCursor(taskID).watermark
}

export function taskMessageWatermarkCursor(taskID: string): { watermark: number; signature: string } {
  const row = Database.use((db) =>
    db.get<{ watermark: number | null }>(sql`
      WITH RECURSIVE session_tree(id) AS (
        SELECT session_id FROM engine_task WHERE id = ${taskID}
        UNION ALL
        SELECT s.id FROM session s JOIN session_tree st ON s.parent_id = st.id
      ),
      message_watermark(value) AS (
        SELECT max(m.time_updated)
        FROM message m
        JOIN session_tree st ON st.id = m.session_id
      ),
      part_watermark(value) AS (
        SELECT max(p.time_updated)
        FROM part p
        JOIN session_tree st ON st.id = p.session_id
      )
      SELECT max(value) AS watermark FROM (
        SELECT value FROM message_watermark
        UNION ALL
        SELECT value FROM part_watermark
      )
    `),
  )
  const watermark = Math.max(0, Number(row?.watermark ?? 0) || 0)
  if (watermark === 0) {
    return {
      watermark,
      signature: "0:",
    }
  }
  const members = Database.use((db) =>
    db.all<{ member: string }>(sql`
      WITH RECURSIVE session_tree(id) AS (
        SELECT session_id FROM engine_task WHERE id = ${taskID}
        UNION ALL
        SELECT s.id FROM session s JOIN session_tree st ON s.parent_id = st.id
      )
      SELECT member FROM (
        SELECT 'message:' || m.id || ':' || coalesce(cast(m.data AS TEXT), '') AS member
        FROM message m
        JOIN session_tree st ON st.id = m.session_id
        WHERE m.time_updated = ${watermark}
        UNION ALL
        SELECT 'part:' || p.id || ':' || coalesce(cast(p.data AS TEXT), '') AS member
        FROM part p
        JOIN session_tree st ON st.id = p.session_id
        WHERE p.time_updated = ${watermark}
      )
      ORDER BY member
    `),
  )
  return {
    watermark,
    signature: `${watermark}:${members.map((item) => item.member).join("|")}`,
  }
}

function toConversationAgentSessionLedgerRows(
  rows: Array<{
    sessionID: string
    stage: SessionKind
    title: string
    parentSessionID: string | null
    goalID: string | null
    metadata: unknown
    timeCreated: number
    timeUpdated: number
    statusType: string | null
    statusReason: string | null
    statusError: string | null
    statusEmittedAt: number | null
  }>,
): ConversationAgentSessionLedgerRow[] {
  return rows.map((row) => {
    const statusType = String(row.statusType || "")
    const statusEmittedAt = Number(row.statusEmittedAt ?? 0)
    if (!statusType && row.statusEmittedAt != null) {
      throw new Error(`conversation agent ledger status event missing status.type for session ${row.sessionID}`)
    }
    if (statusType && !(statusEmittedAt > 0)) {
      throw new Error(`conversation agent ledger status event missing emitted_at for session ${row.sessionID}`)
    }
    return {
      sessionID: row.sessionID,
      orderKey: timelineOrderKey({
        domain: "session",
        time: row.timeCreated,
        id: row.sessionID,
      }),
      stage: row.stage,
      title: row.title,
      parentSessionID: row.parentSessionID ?? undefined,
      goalID: row.goalID ?? undefined,
      metadata: parseLedgerMetadata(row.metadata, row.sessionID),
      timeCreated: row.timeCreated,
      timeUpdated: row.timeUpdated,
      ...(statusType
        ? {
            latestStatus: {
              type: statusType,
              ...(row.statusReason ? { reason: row.statusReason } : {}),
              ...(row.statusError ? { error: row.statusError } : {}),
            },
            latestStatusEmittedAt: statusEmittedAt,
          }
        : {}),
    }
  })
}

function parseLedgerMetadata(input: unknown, sessionID: string): Record<string, unknown> | undefined {
  if (input == null) return undefined
  if (typeof input === "object" && !Array.isArray(input)) return input as Record<string, unknown>
  if (typeof input !== "string") {
    throw new Error(`conversation agent ledger metadata for session ${sessionID} is not an object`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(input)
  } catch (err) {
    throw new Error(
      `conversation agent ledger metadata for session ${sessionID} is not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`conversation agent ledger metadata for session ${sessionID} is not an object`)
  }
  return parsed as Record<string, unknown>
}

export function listConversationAgentSessionsForSessionTree(input: {
  sessionID: string
  projectID: string
}): ConversationAgentSessionLedgerRow[] {
  const rows = Database.use((db) =>
    db.all<{
      sessionID: string
      stage: SessionKind
      title: string
      parentSessionID: string | null
      goalID: string | null
      metadata: unknown
      timeCreated: number
      timeUpdated: number
      statusType: string | null
      statusReason: string | null
      statusError: string | null
      statusEmittedAt: number | null
    }>(sql`
      WITH RECURSIVE session_tree(id) AS (
        SELECT id FROM session WHERE id = ${input.sessionID} AND project_id = ${input.projectID}
        UNION ALL
        SELECT s.id
        FROM session s
        JOIN session_tree st ON s.parent_id = st.id
        WHERE s.project_id = ${input.projectID}
      )
      SELECT
        s.id AS sessionID,
        s.kind AS stage,
        s.title AS title,
        s.parent_id AS parentSessionID,
        s.goal_id AS goalID,
        s.metadata AS metadata,
        s.time_created AS timeCreated,
        s.time_updated AS timeUpdated,
        json_extract(pe.payload, '$.status.type') AS statusType,
        json_extract(pe.payload, '$.status.reason') AS statusReason,
        json_extract(pe.payload, '$.status.error') AS statusError,
        pe.emitted_at AS statusEmittedAt
      FROM session s
      JOIN session_tree st ON st.id = s.id
      LEFT JOIN protocol_event pe
        ON pe.session_id = s.id
       AND pe.type = 'session.status'
       AND NOT EXISTS (
         SELECT 1 FROM protocol_event pe_newer
         WHERE pe_newer.session_id = pe.session_id
           AND pe_newer.type = 'session.status'
           AND (
             pe_newer.emitted_at > pe.emitted_at
             OR (
               pe_newer.emitted_at = pe.emitted_at
               AND pe_newer.seq > pe.seq
             )
           )
       )
      ORDER BY s.time_created, s.id
    `),
  )
  return toConversationAgentSessionLedgerRows(rows)
}

export function listTaskConversationAgentSessions(taskID: string): ConversationAgentSessionLedgerRow[] {
  const row = Database.use((db) =>
    db
      .select({
        sessionID: EngineTaskTable.session_id,
        projectID: EngineTaskTable.project_id,
      })
      .from(EngineTaskTable)
      .where(eq(EngineTaskTable.id, taskID))
      .get(),
  )
  if (!row) throw new Error(`conversation agent ledger task ${taskID} does not exist`)
  if (!row.sessionID) return []
  return listConversationAgentSessionsForSessionTree({
    sessionID: row.sessionID,
    projectID: row.projectID,
  })
}

const NON_AGENT_SESSION_KINDS = new Set<SessionKind>(["root", "executor", "system"])

function isAgentInvocationSession(row: ConversationAgentSessionLedgerRow) {
  return !NON_AGENT_SESSION_KINDS.has(row.stage)
}

function agentNameForLedgerRow(row: ConversationAgentSessionLedgerRow) {
  if (row.stage !== "assistant") return row.stage
  const taskToolSubagent = taskToolSubagentNameFromMetadata(row.metadata)
  if (taskToolSubagent) return taskToolSubagent
  return "assistant"
}

export function agentInvocationDAGFromLedger(input: {
  taskID: string
  rootSessionID?: string
  sessions: ConversationAgentSessionLedgerRow[]
}): AgentInvocationDAG {
  const ledgerByID = new Map(input.sessions.map((row) => [row.sessionID, row]))
  const includedSessionIDs = new Set(
    input.sessions.filter((row) => isAgentInvocationSession(row)).map((row) => row.sessionID),
  )
  const parentAgentBySessionID = new Map<string, string>()
  const edges: AgentInvocationEdge[] = []

  const nodes: AgentInvocationNode[] = input.sessions.flatMap((row) => {
    if (!includedSessionIDs.has(row.sessionID)) return []
    return [
      {
        sessionID: row.sessionID,
        orderKey: row.orderKey,
        agent: agentNameForLedgerRow(row),
        kind: row.stage,
        title: row.title,
        parentSessionID: row.parentSessionID,
        goalID: row.goalID,
        ...(row.latestStatus && row.latestStatusEmittedAt
          ? {
              status: {
                ...row.latestStatus,
                emittedAt: row.latestStatusEmittedAt,
              },
            }
          : {}),
        time: {
          created: row.timeCreated,
          updated: row.timeUpdated,
        },
      },
    ]
  })

  for (const node of nodes) {
    const viaSessionIDs: string[] = []
    const visited = new Set<string>([node.sessionID])
    let parentID = node.parentSessionID
    while (parentID) {
      if (visited.has(parentID)) {
        throw new Error(`agent invocation DAG detected a parent cycle at session ${parentID}`)
      }
      visited.add(parentID)
      if (includedSessionIDs.has(parentID)) {
        parentAgentBySessionID.set(node.sessionID, parentID)
        edges.push({
          fromSessionID: parentID,
          toSessionID: node.sessionID,
          relation: "agent_call",
          ...(viaSessionIDs.length > 0 ? { viaSessionIDs } : {}),
        })
        break
      }
      viaSessionIDs.push(parentID)
      parentID = ledgerByID.get(parentID)?.parentSessionID
    }
  }

  const nodesWithParent = nodes.map((node) => {
    const parentAgentSessionID = parentAgentBySessionID.get(node.sessionID)
    return parentAgentSessionID ? { ...node, parentAgentSessionID } : node
  })

  return {
    taskID: input.taskID,
    rootSessionID: input.rootSessionID,
    nodes: nodesWithParent,
    edges,
    topLevelSessionIDs: nodesWithParent
      .filter((node) => !parentAgentBySessionID.has(node.sessionID))
      .map((node) => node.sessionID),
  }
}

export function agentInvocationDAGForTask(taskID: string): AgentInvocationDAG {
  const row = Database.use((db) =>
    db
      .select({
        sessionID: EngineTaskTable.session_id,
        projectID: EngineTaskTable.project_id,
      })
      .from(EngineTaskTable)
      .where(eq(EngineTaskTable.id, taskID))
      .get(),
  )
  if (!row) throw new Error(`agent invocation DAG task ${taskID} does not exist`)
  if (!row.sessionID) {
    return agentInvocationDAGFromLedger({ taskID, sessions: [] })
  }
  return agentInvocationDAGFromLedger({
    taskID,
    rootSessionID: row.sessionID,
    sessions: listConversationAgentSessionsForSessionTree({
      sessionID: row.sessionID,
      projectID: row.projectID,
    }),
  })
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
