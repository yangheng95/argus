import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { SessionTable } from "./session.sql"
import { Timestamps } from "@/storage/schema.sql"

export const GoalTable = sqliteTable(
  "goal",
  {
    id: text().primaryKey(),
    session_id: text()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    description: text().notNull(),
    criteria: text().notNull(),
    verify_cmd: text(),
    status: text().notNull().$type<"active" | "achieved" | "failed" | "cancelled">().default("active"),
    priority: text().notNull().$type<"blocking" | "advisory">().default("blocking"),
    max_attempts: integer().notNull().default(10),
    current_attempts: integer().notNull().default(0),
    progress_log: text().notNull().default("[]"),
    ...Timestamps,
  },
  (table) => [
    index("goal_session_idx").on(table.session_id),
    index("goal_status_idx").on(table.status),
  ],
)
