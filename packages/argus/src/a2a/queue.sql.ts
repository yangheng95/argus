import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/session.sql"
import { Timestamps } from "@/storage/schema.sql"

export const A2ATaskQueueTable = sqliteTable(
  "a2a_task_queue",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    prompt: text().notNull(),
    priority: text().notNull().$type<"critical" | "high" | "normal" | "low">().default("normal"),
    status: text()
      .notNull()
      .$type<"queued" | "planning" | "executing" | "completed" | "failed" | "cancelled">()
      .default("queued"),
    source: text().notNull().$type<"slack" | "api" | "schedule" | "retry">().default("api"),
    retry_count: integer().notNull().default(0),
    max_retries: integer().notNull().default(3),
    previous_summary: text(),
    error_message: text(),
    metadata: text().notNull().default("{}"),
    time_started: integer(),
    time_completed: integer(),
    ...Timestamps,
  },
  (table) => [
    index("a2a_queue_session_idx").on(table.session_id),
    index("a2a_queue_status_idx").on(table.status),
    index("a2a_queue_priority_idx").on(table.priority, table.status),
  ],
)
