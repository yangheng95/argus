import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "@/project/project.sql"
import { OrchestratorPlanVersionTable, OrchestratorRunTable, OrchestratorTaskTable } from "@/orchestrator/orchestrator.sql"
import { Timestamps } from "@/storage/schema.sql"

export type WorkbenchPreferenceScope = "global" | "session" | "user" | "project" | "task"
export type WorkbenchNoteKind =
  | "user_request"
  | "operator_note"
  | "plan_hint"
  | "goal_update"
  | "constraint"
  | "decision"
  | "summary"

export const WorkbenchPreferenceTable = sqliteTable(
  "workbench_preference",
  {
    id: text().primaryKey(),
    project_id: text().references(() => ProjectTable.id, { onDelete: "cascade" }),
    task_id: text().references(() => OrchestratorTaskTable.id, { onDelete: "cascade" }),
    session_id: text(),
    user_id: text(),
    scope: text().notNull().$type<WorkbenchPreferenceScope>().default("global"),
    key: text().notNull(),
    value: text().notNull(),
    source: text().notNull().default("user_message"),
    confidence: integer().notNull().default(100),
    ...Timestamps,
  },
  (table) => [
    index("workbench_preference_project_idx").on(table.project_id),
    index("workbench_preference_task_idx").on(table.task_id),
    index("workbench_preference_session_idx").on(table.session_id),
    index("workbench_preference_user_idx").on(table.user_id),
    index("workbench_preference_key_idx").on(table.key),
  ],
)

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
