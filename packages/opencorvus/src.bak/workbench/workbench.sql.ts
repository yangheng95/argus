import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core"
import { OrchestratorPlanVersionTable, OrchestratorRunTable, OrchestratorTaskTable } from "@/orchestrator/orchestrator.sql"
import { Timestamps } from "@/storage/schema.sql"

export type WorkbenchNoteKind =
  | "user_request"
  | "operator_note"
  | "plan_hint"
  | "goal_update"
  | "constraint"
  | "decision"
  | "summary"

export const WorkbenchTaskNoteTable = sqliteTable(
  "workbench_task_note",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => OrchestratorTaskTable.id, { onDelete: "cascade" }),
    run_id: text().references(() => OrchestratorRunTable.id, { onDelete: "set null" }),
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
      .references(() => OrchestratorTaskTable.id, { onDelete: "cascade" }),
    plan_version_id: text().references(() => OrchestratorPlanVersionTable.id, { onDelete: "set null" }),
    run_id: text().references(() => OrchestratorRunTable.id, { onDelete: "set null" }),
    content: text().notNull(),
    inputs: text({ mode: "json" }).$type<Record<string, unknown>>(),
    ...Timestamps,
  },
  (table) => [
    index("workbench_brief_task_idx").on(table.task_id),
    index("workbench_brief_run_idx").on(table.run_id),
  ],
)
