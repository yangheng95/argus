import { integer, sqliteTable, text, index, uniqueIndex } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "@/project/project.sql"
import { SessionTable } from "@/session/session.sql"
import { Timestamps } from "@/storage/schema.sql"

export type OrchestratorBudget = {
  max_runs?: number
  max_replans?: number
  max_evaluations?: number
  max_wall_time_ms?: number
}

export type OrchestratorMetadata = Record<string, unknown>

export type OrchestratorTaskStatus =
  | "queued"
  | "planning"
  | "running"
  | "blocked"
  | "evaluating"
  | "completed"
  | "failed"
  | "cancelled"

export type OrchestratorTaskPriority = "high" | "normal" | "low"
export type OrchestratorPlanStatus = "active" | "superseded"
export type OrchestratorGoalPriority = "blocking" | "advisory"
export type OrchestratorGoalStatus = "pending" | "passed" | "failed"
export type OrchestratorRunStatus = "queued" | "accepted" | "running" | "blocked" | "completed" | "failed" | "aborted"
export type OrchestratorRunPhase = "plan" | "execute" | "evaluate" | "replan"
export type OrchestratorInteractionType = "permission" | "question"
export type OrchestratorInteractionStatus = "pending" | "answered" | "rejected" | "expired"
export type OrchestratorArtifactKind =
  | "patch"
  | "changed_file"
  | "log"
  | "report"
  | "image"
  | "diff"
  | "html_trace"
  | "link"
export type OrchestratorDeliveryStatus = "ready"
export type OrchestratorEvaluationStatus = "pending" | "passed" | "failed" | "inconclusive"
export type OrchestratorEvaluationVerdict = "accepted" | "rejected" | "inconclusive"
export type OrchestratorProgressStatus = "created" | "running" | "blocked" | "completed" | "failed" | "cancelled"

export type OrchestratorGoalCheck = {
  name: string
  status: "passed" | "failed" | "skipped"
  evidence?: string
}

export type OrchestratorExecutorRef = {
  session_id?: string
  queue_task_id?: string
}

export const OrchestratorTaskTable = sqliteTable(
  "orchestrator_task",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    session_id: text().references(() => SessionTable.id, { onDelete: "set null" }),
    active_plan_version_id: text(),
    active_run_id: text(),
    request_id: text(),
    source: text().notNull().default("api"),
    title: text().notNull(),
    request: text().notNull(),
    status: text().notNull().$type<OrchestratorTaskStatus>().default("queued"),
    priority: text().notNull().$type<OrchestratorTaskPriority>().default("normal"),
    blocking_reason: text(),
    error: text(),
    budget: text({ mode: "json" }).$type<OrchestratorBudget>(),
    metadata: text({ mode: "json" }).$type<OrchestratorMetadata>(),
    time_started: integer(),
    time_completed: integer(),
    ...Timestamps,
  },
  (table) => [
    index("orchestrator_task_project_idx").on(table.project_id),
    index("orchestrator_task_status_idx").on(table.status),
    uniqueIndex("orchestrator_task_project_request_idx").on(table.project_id, table.request_id),
  ],
)

export const OrchestratorPlanVersionTable = sqliteTable(
  "orchestrator_plan_version",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => OrchestratorTaskTable.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    status: text().notNull().$type<OrchestratorPlanStatus>().default("active"),
    summary: text().notNull(),
    prompt: text().notNull(),
    metadata: text({ mode: "json" }).$type<OrchestratorMetadata>(),
    ...Timestamps,
  },
  (table) => [
    index("orchestrator_plan_task_idx").on(table.task_id),
  ],
)

export const OrchestratorGoalTable = sqliteTable(
  "orchestrator_goal",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => OrchestratorTaskTable.id, { onDelete: "cascade" }),
    plan_version_id: text()
      .notNull()
      .references(() => OrchestratorPlanVersionTable.id, { onDelete: "cascade" }),
    description: text().notNull(),
    criteria: text().notNull(),
    metadata: text({ mode: "json" }).$type<OrchestratorMetadata>(),
    priority: text().notNull().$type<OrchestratorGoalPriority>().default("blocking"),
    status: text().notNull().$type<OrchestratorGoalStatus>().default("pending"),
    order_index: integer().notNull().default(0),
    ...Timestamps,
  },
  (table) => [
    index("orchestrator_goal_task_idx").on(table.task_id),
    index("orchestrator_goal_plan_idx").on(table.plan_version_id),
  ],
)

export const OrchestratorRunTable = sqliteTable(
  "orchestrator_run",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => OrchestratorTaskTable.id, { onDelete: "cascade" }),
    plan_version_id: text().references(() => OrchestratorPlanVersionTable.id, { onDelete: "set null" }),
    session_id: text().references(() => SessionTable.id, { onDelete: "set null" }),
    executor: text().notNull().default("opencode"),
    status: text().notNull().$type<OrchestratorRunStatus>().default("queued"),
    phase: text().notNull().$type<OrchestratorRunPhase>().default("execute"),
    blocking_reason: text(),
    error: text(),
    retry_count: integer().notNull().default(0),
    executor_ref: text({ mode: "json" }).$type<OrchestratorExecutorRef>(),
    metadata: text({ mode: "json" }).$type<OrchestratorMetadata>(),
    time_started: integer(),
    time_completed: integer(),
    ...Timestamps,
  },
  (table) => [
    index("orchestrator_run_task_idx").on(table.task_id),
    index("orchestrator_run_status_idx").on(table.status),
  ],
)

export const OrchestratorInteractionRequestTable = sqliteTable(
  "orchestrator_interaction_request",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => OrchestratorTaskTable.id, { onDelete: "cascade" }),
    run_id: text()
      .notNull()
      .references(() => OrchestratorRunTable.id, { onDelete: "cascade" }),
    session_id: text().references(() => SessionTable.id, { onDelete: "set null" }),
    external_id: text().notNull(),
    request_type: text().notNull().$type<OrchestratorInteractionType>(),
    status: text().notNull().$type<OrchestratorInteractionStatus>().default("pending"),
    title: text().notNull(),
    body: text().notNull(),
    payload: text({ mode: "json" }).$type<OrchestratorMetadata>(),
    response: text({ mode: "json" }).$type<OrchestratorMetadata>(),
    time_resolved: integer(),
    ...Timestamps,
  },
  (table) => [
    index("orchestrator_interaction_run_idx").on(table.run_id),
    index("orchestrator_interaction_external_idx").on(table.external_id),
    index("orchestrator_interaction_status_idx").on(table.status),
  ],
)

export const OrchestratorDeliveryTable = sqliteTable(
  "orchestrator_delivery",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => OrchestratorTaskTable.id, { onDelete: "cascade" }),
    run_id: text()
      .notNull()
      .references(() => OrchestratorRunTable.id, { onDelete: "cascade" }),
    status: text().notNull().$type<OrchestratorDeliveryStatus>().default("ready"),
    summary: text().notNull(),
    result: text({ mode: "json" }).$type<OrchestratorMetadata>(),
    ...Timestamps,
  },
  (table) => [
    index("orchestrator_delivery_run_idx").on(table.run_id),
  ],
)

export const OrchestratorArtifactTable = sqliteTable(
  "orchestrator_artifact",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => OrchestratorTaskTable.id, { onDelete: "cascade" }),
    run_id: text()
      .notNull()
      .references(() => OrchestratorRunTable.id, { onDelete: "cascade" }),
    delivery_id: text().references(() => OrchestratorDeliveryTable.id, { onDelete: "set null" }),
    kind: text().notNull().$type<OrchestratorArtifactKind>(),
    label: text().notNull(),
    payload: text({ mode: "json" }).$type<OrchestratorMetadata>(),
    ...Timestamps,
  },
  (table) => [
    index("orchestrator_artifact_run_idx").on(table.run_id),
    index("orchestrator_artifact_delivery_idx").on(table.delivery_id),
  ],
)

export const OrchestratorEvaluationTable = sqliteTable(
  "orchestrator_evaluation",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => OrchestratorTaskTable.id, { onDelete: "cascade" }),
    run_id: text()
      .notNull()
      .references(() => OrchestratorRunTable.id, { onDelete: "cascade" }),
    delivery_id: text().references(() => OrchestratorDeliveryTable.id, { onDelete: "set null" }),
    status: text().notNull().$type<OrchestratorEvaluationStatus>().default("pending"),
    verdict: text().notNull().$type<OrchestratorEvaluationVerdict>().default("inconclusive"),
    summary: text().notNull(),
    checks: text({ mode: "json" }).$type<OrchestratorGoalCheck[]>(),
    time_completed: integer(),
    ...Timestamps,
  },
  (table) => [
    index("orchestrator_evaluation_run_idx").on(table.run_id),
  ],
)

export const OrchestratorProgressSnapshotTable = sqliteTable(
  "orchestrator_progress_snapshot",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => OrchestratorTaskTable.id, { onDelete: "cascade" }),
    status: text().notNull().$type<OrchestratorProgressStatus>(),
    summary: text().notNull(),
    payload: text({ mode: "json" }).$type<OrchestratorMetadata>(),
    ...Timestamps,
  },
  (table) => [
    index("orchestrator_progress_task_idx").on(table.task_id),
  ],
)

export const OrchestratorChannelBindingTable = sqliteTable(
  "orchestrator_channel_binding",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => OrchestratorTaskTable.id, { onDelete: "cascade" }),
    platform: text().notNull(),
    channel: text().notNull(),
    thread: text().notNull(),
    payload: text({ mode: "json" }).$type<OrchestratorMetadata>(),
    ...Timestamps,
  },
  (table) => [
    index("orchestrator_channel_task_idx").on(table.task_id),
  ],
)
