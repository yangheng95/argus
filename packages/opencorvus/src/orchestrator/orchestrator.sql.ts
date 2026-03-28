import { integer, sqliteTable, text, index, uniqueIndex } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "@/project/project.sql"
import { SessionTable } from "@/session/session.sql"
import { Timestamps } from "@/storage/schema.sql"
import type { ProtocolCapabilitiesInfo, ProtocolRefsInfo, ProtocolSettingsInfo } from "@/executor/protocol"

export type OrchestratorBudget = {
  max_runs?: number
  max_replans?: number
  max_evaluations?: number
  max_wall_time_ms?: number
  max_executor_groups?: number
}

export type OrchestratorMetadata = Record<string, unknown>

export type OrchestratorTaskStatus =
  | "queued"
  | "spec_generating"
  | "goal_decomposing"
  | "planning"
  | "planned"
  | "running"
  | "blocked"
  | "evaluating"
  | "delivering"
  | "completed"
  | "failed"
  | "cancelled"

export type OrchestratorTaskPriority = "high" | "normal" | "low"
export type OrchestratorExecutor = "opencode" | "codex" | "claude-code"
export type OrchestratorPlanStatus = "active" | "superseded"
export type OrchestratorGoalPriority = "blocking" | "advisory"
export type OrchestratorGoalStatus = "pending" | "running" | "passed" | "failed"
export type OrchestratorMilestoneStatus = "pending" | "active" | "passed" | "failed"
export type OrchestratorRunStatus = "queued" | "accepted" | "running" | "blocked" | "completed" | "failed" | "aborted"
export type OrchestratorRunPhase = "plan" | "spec" | "execute" | "evaluate" | "deliver" | "replan" | "dispatch"
export type OrchestratorInteractionType = "permission" | "question"
export type OrchestratorInteractionStatus = "pending" | "answered" | "rejected" | "expired"

export type OrchestratorSpecSnapshotStatus = "ready" | "blocked" | "completed" | "superseded"
export type OrchestratorSpecItemStatus = "pending" | "done" | "failed"

export const OrchestratorSpecSnapshotTable = sqliteTable(
  "orchestrator_spec_snapshot",
  {
    id: text().primaryKey(),
    task_id: text().notNull(),
    version: integer().notNull().default(1),
    status: text().notNull().$type<OrchestratorSpecSnapshotStatus>().default("ready"),
    summary: text().notNull(),
    content: text().notNull(),
    scope: text().notNull().default(""),
    out_of_scope: text(),
    evidence: text({ mode: "json" }).$type<string[]>(),
    metadata: text({ mode: "json" }).$type<OrchestratorMetadata>(),
    ...Timestamps,
  },
  (table) => [
    index("orchestrator_spec_snapshot_task_idx").on(table.task_id),
  ],
)

export const OrchestratorSpecItemTable = sqliteTable(
  "orchestrator_spec_item",
  {
    id: text().primaryKey(),
    task_id: text().notNull(),
    spec_snapshot_id: text().notNull(),
    title: text().notNull(),
    description: text().notNull(),
    status: text().notNull().$type<OrchestratorSpecItemStatus>().default("pending"),
    priority: text().notNull().$type<OrchestratorGoalPriority>().default("blocking"),
    check_selector: text({ mode: "json" }).$type<string[]>(),
    evidence: text(),
    metadata: text({ mode: "json" }).$type<OrchestratorMetadata>(),
    ...Timestamps,
  },
  (table) => [
    index("orchestrator_spec_item_task_idx").on(table.task_id),
    index("orchestrator_spec_item_snapshot_idx").on(table.spec_snapshot_id),
  ],
)
export type OrchestratorArtifactKind =
  | "patch"
  | "changed_file"
  | "log"
  | "report"
  | "image"
  | "diff"
  | "html_trace"
  | "link"
  | "git_ref"
  | "pr"
export type OrchestratorDeliveryStatus = "candidate" | "publishing" | "delivered" | "failed"
export type OrchestratorEvaluationStatus = "pending" | "passed" | "failed" | "inconclusive"
export type OrchestratorEvaluationVerdict = "accepted" | "rejected" | "inconclusive"
export type OrchestratorProgressStatus = "created" | "running" | "blocked" | "completed" | "failed" | "cancelled" | "planning" | "planned" | "spec_generating" | "goal_decomposing"
export type OrchestratorExecutorTransport = "inproc" | "stdio" | "ws" | "http"
export type OrchestratorExecutorSessionStatus = "active" | "completed" | "failed" | "aborted"

export type OrchestratorGoalCheck = {
  name: string
  status: "passed" | "failed" | "skipped"
  evidence?: string
}

export type OrchestratorExecutorRef = {
  session_id?: string
  queue_task_id?: string
}

export type OrchestratorExecutorProtocolRef = ProtocolRefsInfo
export type OrchestratorExecutorCapability = ProtocolCapabilitiesInfo
export type OrchestratorExecutorSettings = ProtocolSettingsInfo

export const OrchestratorTaskTable = sqliteTable(
  "orchestrator_task",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    session_id: text().references(() => SessionTable.id, { onDelete: "set null" }),
    active_spec_version_id: text(),
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
    /** Timestamp when the task's status last changed. Used by stranded-task recovery
     *  to measure time-in-current-status without being reset by incidental DB writes. */
    time_status_changed: integer(),
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
    spec_snapshot_id: text()
      .references(() => OrchestratorSpecSnapshotTable.id, { onDelete: "set null" }),
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

export const OrchestratorMilestoneTable = sqliteTable(
  "orchestrator_milestone",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => OrchestratorTaskTable.id, { onDelete: "cascade" }),
    plan_version_id: text()
      .notNull()
      .references(() => OrchestratorPlanVersionTable.id, { onDelete: "cascade" }),
    title: text().notNull(),
    description: text().notNull().default(""),
    status: text().notNull().$type<OrchestratorMilestoneStatus>().default("pending"),
    order_index: integer().notNull().default(0),
    metadata: text({ mode: "json" }).$type<OrchestratorMetadata>(),
    ...Timestamps,
  },
  (table) => [
    index("orchestrator_milestone_task_idx").on(table.task_id),
    index("orchestrator_milestone_plan_idx").on(table.plan_version_id),
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
      .references(() => OrchestratorPlanVersionTable.id, { onDelete: "cascade" }),
    spec_snapshot_id: text()
      .references(() => OrchestratorSpecSnapshotTable.id, { onDelete: "cascade" }),
    milestone_id: text().references(() => OrchestratorMilestoneTable.id, { onDelete: "set null" }),
    description: text().notNull(),
    criteria: text().notNull(),
    metadata: text({ mode: "json" }).$type<OrchestratorMetadata>(),
    priority: text().notNull().$type<OrchestratorGoalPriority>().default("blocking"),
    source: text().notNull().default("spec"),
    status: text().notNull().$type<OrchestratorGoalStatus>().default("pending"),
    order_index: integer().notNull().default(0),
    ...Timestamps,
  },
  (table) => [
    index("orchestrator_goal_task_idx").on(table.task_id),
    index("orchestrator_goal_plan_idx").on(table.plan_version_id),
    index("orchestrator_goal_milestone_idx").on(table.milestone_id),
  ],
)

export type OrchestratorGoalRunStatus = "queued" | "accepted" | "running" | "blocked" | "completed" | "failed" | "aborted"

export const OrchestratorRequirementTable = sqliteTable(
  "orchestrator_requirement",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => OrchestratorTaskTable.id, { onDelete: "cascade" }),
    spec_snapshot_id: text()
      .notNull()
      .references(() => OrchestratorSpecSnapshotTable.id, { onDelete: "cascade" }),
    title: text().notNull(),
    description: text().notNull(),
    status: text().notNull().$type<"pending" | "passed" | "failed">().default("pending"),
    priority: text().notNull().$type<OrchestratorGoalPriority>().default("blocking"),
    acceptance: text().notNull(),
    evidence_refs: text({ mode: "json" }).$type<string[]>(),
    non_goals: text({ mode: "json" }).$type<string[]>(),
    metadata: text({ mode: "json" }).$type<OrchestratorMetadata>(),
    order_index: integer().notNull().default(0),
    ...Timestamps,
  },
  (table) => [
    index("orchestrator_requirement_task_idx").on(table.task_id),
    index("orchestrator_requirement_spec_idx").on(table.spec_snapshot_id),
  ],
)

export const OrchestratorGoalSnapshotTable = sqliteTable(
  "orchestrator_goal_snapshot",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => OrchestratorTaskTable.id, { onDelete: "cascade" }),
    spec_snapshot_id: text()
      .notNull()
      .references(() => OrchestratorSpecSnapshotTable.id, { onDelete: "cascade" }),
    version: integer().notNull().default(1),
    status: text().notNull().$type<"ready" | "superseded" | "completed">().default("ready"),
    summary: text().notNull(),
    metadata: text({ mode: "json" }).$type<OrchestratorMetadata>(),
    ...Timestamps,
  },
  (table) => [
    index("orchestrator_goal_snapshot_task_idx").on(table.task_id),
  ],
)

export const OrchestratorPlanNodeTable = sqliteTable(
  "orchestrator_plan_node",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => OrchestratorTaskTable.id, { onDelete: "cascade" }),
    plan_version_id: text()
      .notNull()
      .references(() => OrchestratorPlanVersionTable.id, { onDelete: "cascade" }),
    kind: text().notNull().$type<"goal" | "milestone" | "step">(),
    goal_id: text().references(() => OrchestratorGoalTable.id, { onDelete: "set null" }),
    title: text().notNull(),
    brief: text().notNull(),
    depends_on_ids: text({ mode: "json" }).$type<string[]>(),
    order_index: integer().notNull().default(0),
    metadata: text({ mode: "json" }).$type<OrchestratorMetadata>(),
    ...Timestamps,
  },
  (table) => [
    index("orchestrator_plan_node_task_idx").on(table.task_id),
    index("orchestrator_plan_node_plan_idx").on(table.plan_version_id),
    index("orchestrator_plan_node_goal_idx").on(table.goal_id),
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
    executor: text().notNull().$type<OrchestratorExecutor>().default("opencode"),
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

export const OrchestratorGoalRunTable = sqliteTable(
  "orchestrator_goal_run",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => OrchestratorTaskTable.id, { onDelete: "cascade" }),
    goal_id: text()
      .notNull()
      .references(() => OrchestratorGoalTable.id, { onDelete: "cascade" }),
    plan_node_id: text(),
    coordinator_run_id: text()
      .notNull()
      .references(() => OrchestratorRunTable.id, { onDelete: "cascade" }),
    session_id: text().references(() => SessionTable.id, { onDelete: "set null" }),
    executor: text().notNull().$type<OrchestratorExecutor>().default("opencode"),
    status: text().notNull().$type<OrchestratorGoalRunStatus>().default("queued"),
    retry_count: integer().notNull().default(0),
    blocking_reason: text(),
    error: text(),
    workspace_dir: text(),
    base_ref: text(),
    merge_ref: text(),
    metadata: text({ mode: "json" }).$type<OrchestratorMetadata>(),
    time_started: integer(),
    time_completed: integer(),
    ...Timestamps,
  },
  (table) => [
    index("orchestrator_goal_run_task_idx").on(table.task_id),
    index("orchestrator_goal_run_goal_idx").on(table.goal_id),
    index("orchestrator_goal_run_coordinator_idx").on(table.coordinator_run_id),
    index("orchestrator_goal_run_status_idx").on(table.status),
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
    goal_run_id: text().references(() => OrchestratorGoalRunTable.id, { onDelete: "set null" }),
    status: text().notNull().$type<OrchestratorDeliveryStatus>().default("candidate"),
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
    goal_run_id: text().references(() => OrchestratorGoalRunTable.id, { onDelete: "set null" }),
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
    goal_run_id: text().references(() => OrchestratorGoalRunTable.id, { onDelete: "set null" }),
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

export const OrchestratorExecutorSessionTable = sqliteTable(
  "orchestrator_executor_session",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => OrchestratorTaskTable.id, { onDelete: "cascade" }),
    run_id: text()
      .notNull()
      .references(() => OrchestratorRunTable.id, { onDelete: "cascade" }),
    goal_run_id: text().references(() => OrchestratorGoalRunTable.id, { onDelete: "set null" }),
    provider: text().notNull().$type<OrchestratorExecutor>(),
    protocol: text().notNull(),
    protocol_version: text().notNull(),
    transport: text().notNull().$type<OrchestratorExecutorTransport>(),
    status: text().notNull().$type<OrchestratorExecutorSessionStatus>().default("active"),
    refs: text({ mode: "json" }).$type<OrchestratorExecutorProtocolRef>(),
    capabilities: text({ mode: "json" }).$type<OrchestratorExecutorCapability>(),
    settings: text({ mode: "json" }).$type<OrchestratorExecutorSettings>(),
    lease_owner: text(),
    lease_until: integer(),
    time_started: integer(),
    time_completed: integer(),
    ...Timestamps,
  },
  (table) => [
    index("orchestrator_executor_session_task_idx").on(table.task_id),
    index("orchestrator_executor_session_run_idx").on(table.run_id),
    index("orchestrator_executor_session_goal_run_idx").on(table.goal_run_id),
    index("orchestrator_executor_session_status_idx").on(table.status),
  ],
)

export const OrchestratorExecutorEventTable = sqliteTable(
  "orchestrator_executor_event",
  {
    id: text().primaryKey(),
    executor_session_id: text()
      .notNull()
      .references(() => OrchestratorExecutorSessionTable.id, { onDelete: "cascade" }),
    task_id: text()
      .notNull()
      .references(() => OrchestratorTaskTable.id, { onDelete: "cascade" }),
    run_id: text()
      .notNull()
      .references(() => OrchestratorRunTable.id, { onDelete: "cascade" }),
    goal_run_id: text().references(() => OrchestratorGoalRunTable.id, { onDelete: "set null" }),
    sequence: integer().notNull(),
    kind: text().notNull(),
    summary: text(),
    refs: text({ mode: "json" }).$type<OrchestratorExecutorProtocolRef>(),
    payload: text({ mode: "json" }).$type<OrchestratorMetadata>(),
    raw: text({ mode: "json" }).$type<OrchestratorMetadata>(),
    time_observed: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("orchestrator_executor_event_session_idx").on(table.executor_session_id, table.sequence),
    index("orchestrator_executor_event_run_idx").on(table.run_id, table.sequence),
    index("orchestrator_executor_event_task_idx").on(table.task_id, table.sequence),
    index("orchestrator_executor_event_kind_idx").on(table.kind),
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
    uniqueIndex("orchestrator_channel_binding_thread_idx").on(table.platform, table.channel, table.thread),
  ],
)
