import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core"
import { EnginePlanVersionTable, EngineTaskTable } from "@/engine/engine.sql"
import { Timestamps } from "@/storage/schema.sql"

export type WorkbenchNoteKind = "user_request" | "operator_note" | "goal_update" | "constraint" | "decision" | "summary"

export const WorkbenchTaskNoteTable = sqliteTable(
  "workbench_task_note",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => EngineTaskTable.id, { onDelete: "cascade" }),
    run_id: text(),
    kind: text().notNull().$type<WorkbenchNoteKind>(),
    source: text().notNull().default("user_message"),
    user_id: text(),
    content: text().notNull(),
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
    ...Timestamps,
  },
  (table) => [
    index("workbench_task_note_task_idx").on(table.task_id),
    index("workbench_task_note_run_idx").on(table.run_id),
    index("workbench_task_note_kind_idx").on(table.kind),
  ],
)

export const WorkbenchBriefSnapshotTable = sqliteTable(
  "workbench_brief_snapshot",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => EngineTaskTable.id, { onDelete: "cascade" }),
    plan_version_id: text().references(() => EnginePlanVersionTable.id, { onDelete: "set null" }),
    run_id: text(),
    content: text().notNull(),
    inputs: text({ mode: "json" }).$type<Record<string, unknown>>(),
    ...Timestamps,
  },
  (table) => [index("workbench_brief_task_idx").on(table.task_id), index("workbench_brief_run_idx").on(table.run_id)],
)
