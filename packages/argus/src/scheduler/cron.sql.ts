import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import { SessionTable } from "../session/session.sql"
import { Timestamps } from "@/storage/schema.sql"

export const CronJobTable = sqliteTable(
  "cron_job",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    session_id: text()
      .references(() => SessionTable.id, { onDelete: "set null" }),
    name: text().notNull(),
    expression: text().notNull(),
    prompt: text().notNull(),
    agent: text().notNull().default("default"),
    enabled: integer({ mode: "boolean" }).notNull().default(true),
    one_shot: integer({ mode: "boolean" }).notNull().default(false),
    last_run: integer(),
    next_run: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("cron_job_project_idx").on(table.project_id),
    index("cron_job_next_run_idx").on(table.next_run),
  ],
)
