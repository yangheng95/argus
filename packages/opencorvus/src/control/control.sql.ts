import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core"
import { Timestamps } from "@/storage/schema.sql"

export const ControlAccountTable = sqliteTable(
  "control_account",
  {
    email: text().notNull(),
    url: text().notNull(),
    access_token: text().notNull(),
    refresh_token: text().notNull(),
    token_expiry: integer(),
    active: integer({ mode: "boolean" })
      .notNull()
      .$default(() => false),
    ...Timestamps,
  },
  (table) => [primaryKey({ columns: [table.email, table.url] })],
)

export type ControlMessageRole = "user" | "assistant" | "system"

export const ControlMessageTable = sqliteTable(
  "control_message",
  {
    id: text().primaryKey(),
    project_id: text().notNull(),
    scope: text().notNull(),
    scope_id: text().notNull(),
    task_id: text(),
    session_id: text(),
    surface: text().notNull(),
    role: text().notNull().$type<ControlMessageRole>(),
    source: text().notNull(),
    channel: text(),
    thread: text(),
    user_id: text(),
    request_id: text(),
    text: text().notNull(),
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
    ...Timestamps,
  },
  (table) => [
    index("control_message_project_idx").on(table.project_id),
    index("control_message_scope_idx").on(table.scope, table.scope_id),
    index("control_message_task_idx").on(table.task_id),
    index("control_message_session_idx").on(table.session_id),
    index("control_message_thread_idx").on(table.surface, table.channel, table.thread),
  ],
)
