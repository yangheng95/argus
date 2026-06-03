import { sql } from "drizzle-orm"
import { sqliteTable, text, integer, index, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import type { Message } from "./message"
import type { PermissionNext } from "@/permission/next"
import { Timestamps } from "@/storage/schema.sql"

/**
 * SessionKind — the session's role/purpose, fixed at creation time.
 *
 * Authoritative source for "what is this session for" — sessionRole(sid)
 * reads this column. Do NOT re-derive role from message.agent, title
 * prefixes, or in-memory registries: that's how we got the transcript-reseed
 * bug that silently turned assistant sessions into build worker sessions.
 *
 *   root           root session of an engine_task; holds the user's request
 *   orchestrator   task-level orchestrator's own reasoning session (dispatches
 *                  build/requirements/architect/etc.; never writes code itself).
 *                  Distinct from "assistant" so overlay can label it as the
 *                  scheduler rather than a generic assistant.
 *   assistant      generic assistant dialog — refine sub-agent AND externally-driven
 *                  sessions (MCP, Debug, Coding, Panel, scheduled wakes). Standalone
 *                  callers are filtered out at the bridge by `taskIDForSession`
 *                  failing naturally; no separate "standalone" kind is needed.
 *   mission        Mission agent session — the user's long-running goal owner.
 *                  Stores mission metadata (the channelKey `mission:<id>` plus
 *                  the missionID / current cwd) pinning the `mission` agent to a
 *                  single mission. Mission dispatches squad/team engine_tasks via
 *                  panel.create_task (actor=mission, source=mission) and
 *                  coordinates them, but does not execute work itself — every
 *                  concrete artifact is produced by a dispatched task led by the
 *                  orchestrator. Distinct from the `gateway` infrastructure
 *                  surface (remote/mobile transport), which does not create
 *                  sessions of this kind. See specs/gateway-mission-split-2026-05-28.md.
 *   requirements   requirements sub-agent (goal decomposition)
 *   frontend-design sub-agent (vision -> template/modules/components/materials)
 *   goal           legacy catch-all for sub-agents that predate the dedicated
 *                  `requirements` / `frontend-design` kinds — still accepted so
 *                  historical task rows render, but new code must use the
 *                  specific kind above.
 *   architect      architect sub-agent
 *   integrity      multi-dimension integrity reviewer (child of architect) —
 *                  requirement_fidelity / technical_feasibility / hallucination /
 *                  solution_quality. Successor to the legacy `fidelity` kind.
 *   acceptance       acceptance sub-agent
 *   executor       per-goal container session — empty parent that groups
 *                  build + evaluator children for permission
 *                  inheritance and overlay step-card nesting. No LLM.
 *                  (In the direct workflow there is no executor container;
 *                  the direct build session is top-level.)
 *   build          build worker session — the LLM that writes code.
 *                  Direct workflow: task-level worker under the orchestrator
 *                  root. Pipeline workflow: per-goal worker under the
 *                  executor container (build phase).
 *   explore        read-only repository-investigation subagent dispatched by
 *                  the orchestrator `explore` tool. Distinct from "assistant"
 *                  so the overlay splits each explore call into its own agent
 *                  card instead of collapsing them into the generic lane.
 *   research       read-only advisory evidence-gathering subagent for external
 *                  facts and PRD/SPEC input bundles. It emits durable
 *                  research_brief artifacts; it is not a workflow step.
 *   frontend-research read-only webpage functional/visual evidence subagent.
 *                  It pairs with frontend-design and emits durable
 *                  frontend_research_brief artifacts for requirements and
 *                  architect.
 *   evaluator      LLM judge / evaluator sessions
 *   system         internal maintenance (compaction, summary, title generation)
 */
// Single source for SessionKind. The Zod enum in session/index.ts (Info.kind)
// and any other validator MUST derive from this tuple — do not re-list the
// values (rule 8: that duplicate is exactly what silently dropped "explore").
export const SESSION_KINDS = [
  "root",
  "orchestrator",
  "assistant",
  "mission",
  "intent-analysis",
  "requirements",
  "frontend-design",
  "goal",
  "architect",
  "goal-workload-analyst",
  "integrity",
  "fact-check",
  "acceptance",
  "executor",
  "build",
  "explore",
  "research",
  "frontend-research",
  "evaluator",
  "system",
] as const

export type SessionKind = (typeof SESSION_KINDS)[number]

type PartData = Omit<Message.Part, "id" | "sessionID" | "messageID">
type InfoData = Omit<Message.Info, "id" | "sessionID">

export const SessionTable = sqliteTable(
  "session",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    parent_id: text(),
    slug: text().notNull(),
    directory: text().notNull(),
    title: text().notNull(),
    version: text().notNull(),
    /** Session's role/purpose, fixed at creation time. See SessionKind above. */
    kind: text().notNull().$type<SessionKind>(),
    /** Optional goal this session belongs to (kind="executor"|"build"|"evaluator"
     *  when goal-scoped). Used by overlay to nest the session's messages under
     *  the goal card. Null for root/assistant/requirements/frontend-design/goal/
     *  architect/acceptance/system sessions. */
    goal_id: text(),
    share_url: text(),
    summary_additions: integer(),
    summary_deletions: integer(),
    summary_files: integer(),
    permission: text({ mode: "json" }).$type<PermissionNext.Ruleset>(),
    /** Free-form per-session metadata. */
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
    ...Timestamps,
    time_compacting: integer(),
    time_archived: integer(),
  },
  (table) => [
    index("session_project_idx").on(table.project_id),
    index("session_parent_idx").on(table.parent_id),
    index("session_kind_idx").on(table.kind),
    index("session_goal_idx").on(table.goal_id),
  ],
)

export const MessageTable = sqliteTable(
  "message",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    ...Timestamps,
    data: text({ mode: "json" }).notNull().$type<InfoData>(),
  },
  (table) => [
    index("message_session_idx").on(table.session_id),
    index("message_session_time_idx").on(table.session_id, table.time_created),
  ],
)

export const PartTable = sqliteTable(
  "part",
  {
    id: text().primaryKey(),
    message_id: text()
      .notNull()
      .references(() => MessageTable.id, { onDelete: "cascade" }),
    session_id: text().notNull(),
    ...Timestamps,
    data: text({ mode: "json" }).notNull().$type<PartData>(),
  },
  (table) => [
    index("part_message_idx").on(table.message_id),
    index("part_session_idx").on(table.session_id),
    index("part_session_time_idx").on(table.session_id, table.time_created),
    uniqueIndex("part_message_tool_call_idx")
      .on(table.message_id, sql<string>`json_extract(${table.data}, '$.callID')`)
      .where(sql`json_extract(${table.data}, '$.type') = 'tool'`),
  ],
)

export type SessionControlKind =
  | "manual_summarize"
  | "compaction_request"
  | "subtask_request"
  | "wake_reason"

export type SessionControlStatus = "pending" | "consumed" | "failed"

export const SessionControlRecordTable = sqliteTable(
  "session_control_record",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    kind: text().notNull().$type<SessionControlKind>(),
    status: text().notNull().$type<SessionControlStatus>(),
    owner: text(),
    payload: text({ mode: "json" }).notNull().$type<Record<string, unknown>>(),
    ...Timestamps,
    time_consumed: integer(),
  },
  (table) => [
    index("session_control_session_idx").on(table.session_id),
    index("session_control_session_status_idx").on(table.session_id, table.status),
    index("session_control_kind_idx").on(table.kind),
  ],
)

export const WorkerTurnDescriptorTable = sqliteTable(
  "worker_turn_descriptor",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    hash: text().notNull(),
    agent: text().notNull(),
    payload: text({ mode: "json" }).notNull().$type<Record<string, unknown>>(),
    ...Timestamps,
  },
  (table) => [
    index("worker_turn_descriptor_session_idx").on(table.session_id),
    index("worker_turn_descriptor_hash_idx").on(table.hash),
  ],
)

export const TodoTable = sqliteTable(
  "todo",
  {
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    content: text().notNull(),
    status: text().notNull(),
    priority: text().notNull(),
    position: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.session_id, table.position] }),
    index("todo_session_idx").on(table.session_id),
  ],
)

export const PermissionTable = sqliteTable("permission", {
  project_id: text()
    .primaryKey()
    .references(() => ProjectTable.id, { onDelete: "cascade" }),
  ...Timestamps,
  data: text({ mode: "json" }).notNull().$type<PermissionNext.Ruleset>(),
})
