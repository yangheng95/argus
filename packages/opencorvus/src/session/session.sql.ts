import { sqliteTable, text, integer, index, primaryKey, uniqueIndex } from "drizzle-orm/sqlite-core"
import { sql } from "drizzle-orm"
import { ProjectTable } from "../project/project.sql"
import type { Message } from "./message"
import type { Snapshot } from "@/snapshot"
import type { PermissionNext } from "@/permission/next"
import { Timestamps } from "@/storage/schema.sql"

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
    /** "gateway" sessions are per-(platform, channel, user) singletons that hold
     *  the long-lived dialog with the user. "task" sessions are 1:1 with an
     *  OrchestratorTask and hold the task's execution trace. */
    kind: text().notNull().$type<"gateway" | "task">().default("task"),
    /** Composite key `${platform}:${channel}:${userID}` (or `local:${userID}`).
     *  Only populated for gateway sessions; the partial unique index enforces
     *  one gateway session per channel_key. */
    channel_key: text(),
    share_url: text(),
    summary_additions: integer(),
    summary_deletions: integer(),
    summary_files: integer(),
    summary_diffs: text({ mode: "json" }).$type<Snapshot.FileDiff[]>(),
    revert: text({ mode: "json" }).$type<{ messageID: string; partID?: string; snapshot?: string; diff?: string }>(),
    permission: text({ mode: "json" }).$type<PermissionNext.Ruleset>(),
    /** Free-form per-session metadata. Used today by Gateway sessions to track
     *  the current cwd context (`metadata.gateway.cwd`); future per-session
     *  state should live here rather than spawning new tables. */
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
    ...Timestamps,
    time_compacting: integer(),
    time_archived: integer(),
  },
  (table) => [
    index("session_project_idx").on(table.project_id),
    index("session_parent_idx").on(table.parent_id),
    index("session_kind_idx").on(table.kind),
    uniqueIndex("session_gateway_singleton_idx")
      .on(table.channel_key)
      .where(sql`${table.kind} = 'gateway' AND ${table.channel_key} IS NOT NULL`),
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
