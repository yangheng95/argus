import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import type { Message } from "./message"
import type { Snapshot } from "@/snapshot"
import type { PermissionNext } from "@/permission/next"
import { Timestamps } from "@/storage/schema.sql"

/**
 * SessionKind — the session's role/purpose, fixed at creation time.
 *
 * Authoritative source for "what is this session for" — sessionRole(sid)
 * reads this column. Do NOT re-derive role from message.agent, title
 * prefixes, or in-memory registries: that's how we got the transcript-reseed
 * bug that silently turned assistant sessions into executor sessions.
 *
 *   root           root session of an engine_task; holds the user's request
 *   assistant      generic assistant dialog — orchestrator's own reasoning session,
 *                  refine sub-agent, AND externally-driven sessions (MCP, Debug,
 *                  Coding, Panel, scheduled wakes). Standalone callers are
 *                  filtered out at the bridge by `taskIDForSession` failing
 *                  naturally; no separate "standalone" kind is needed.
 *   requirements   requirements sub-agent (goal decomposition)
 *   design-analyst design-analyst sub-agent (vision → layout/style/component spec)
 *   planner        per-goal planning session
 *   goal           legacy catch-all for sub-agents that predate the dedicated
 *                  `requirements` / `design-analyst` kinds — still accepted so
 *                  historical task rows render, but new code must use the
 *                  specific kind above.
 *   architect      architect sub-agent
 *   delivery       delivery sub-agent
 *   executor       goal executor session (runs in worktree)
 *   build          build sub-agent
 *   evaluator      LLM judge / evaluator sessions
 *   system         internal maintenance (compaction, summary, title generation)
 */
export type SessionKind =
  | "root"
  | "assistant"
  | "requirements"
  | "design-analyst"
  | "planner"
  | "goal"
  | "architect"
  | "delivery"
  | "executor"
  | "build"
  | "evaluator"
  | "system"

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
    /** Optional goal this session belongs to (kind="planner"|"executor"|"build").
     *  Used by overlay to nest the session's messages under the goal card.
     *  Null for root/assistant/requirements/design-analyst/goal/architect/delivery/evaluator/system sessions. */
    goal_id: text(),
    share_url: text(),
    summary_additions: integer(),
    summary_deletions: integer(),
    summary_files: integer(),
    summary_diffs: text({ mode: "json" }).$type<Snapshot.FileDiff[]>(),
    revert: text({ mode: "json" }).$type<{ messageID: string; partID?: string; snapshot?: string; diff?: string }>(),
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
  (table) => [index("message_session_idx").on(table.session_id)],
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
  (table) => [index("part_message_idx").on(table.message_id), index("part_session_idx").on(table.session_id)],
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
