import { integer, sqliteTable, text, index, uniqueIndex } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "@/project/project.sql"
import { SessionTable } from "@/session/session.sql"
import { Timestamps } from "@/storage/schema.sql"
import type { ProtocolCapabilitiesInfo, ProtocolRefsInfo, ProtocolSettingsInfo } from "@/executor/protocol"

export type EngineBudget = {
  max_runs?: number
  max_fix_runs?: number
  max_executor_groups?: number
}

export type EngineMetadata = Record<string, unknown>

export type DeliveryResult = {
  diffs?: Array<{ file: string; status?: string; before?: string; after?: string; diff?: string }>
  changed_files?: string[]
  commit_ref?: string
  [key: string]: unknown
}

export type EngineTaskStatus =
  | "queued"
  | "active"
  | "completed"
  | "failed"
  | "cancelled"

export type EngineTaskPriority = "critical" | "high" | "normal" | "low"
export type EngineExecutor = "opencode" | "codex" | "claude-code"
export type EnginePlanStatus = "active" | "superseded"
export type EngineGoalPriority = "blocking" | "advisory"
// engine_goal.status was retired in the LLM-autonomous redesign: it was a
// cached projection of (cascade_state, goal_run chain tip) used as a
// dispatch gate, and the FSM gate itself was the source of status-carousel
// deadlocks. Call-sites read engine/describe.ts::goalStatusByID (live
// derivation from goal_run chain) or engine/describe.ts::describeGoal
// (structured view with is_running / is_terminal_ok / etc.). The column
// is gone; no type alias for it.
export type EngineMilestoneStatus = "pending" | "active" | "passed" | "failed"
export type EngineRunStatus = "queued" | "accepted" | "running" | "blocked" | "completed" | "failed" | "aborted"
export type EngineRunPhase = "plan" | "execute" | "evaluate" | "deliver" | "dispatch" | "retry"

/**
 * Why a goal_run was superseded — i.e. what triggered the new attempt that
 * sits at the supersede chain head. Promoted from `metadata.superseded_reason`
 * to a first-class column so deriveGoalStatus / readiness / decision-log can
 * branch on a typed enum instead of a free-form string. Each value names
 * exactly one engine-level retry intent; the operator-facing detail (`why
 * the human / LLM chose this`) lives in decision_log, not here.
 */
export type EngineGoalRunSupersededReason =
  | "manual_retry"      // retry_goal: explicit operator retry under per-goal budget
  | "delivery_rework"   // delivery verdict=rejected: arbiter sent the goal back for rework
  | "modify_contract"   // modify_goal: contract changed, prior run is stale under new contract
  | "restart_stage"     // restart_from_stage / resetTaskGoalsToPending: bulk re-anchor
export type EngineInteractionType = "permission" | "question"
export type EngineInteractionStatus = "pending" | "answered" | "rejected" | "expired"

export type EngineSpecSnapshotStatus = "ready" | "blocked" | "completed" | "superseded"
export type EngineSpecItemStatus = "pending" | "done" | "failed"

export const EngineSpecSnapshotTable = sqliteTable(
  "engine_spec_snapshot",
  {
    id: text().primaryKey(),
    task_id: text().notNull(),
    version: integer().notNull().default(1),
    status: text().notNull().$type<EngineSpecSnapshotStatus>().default("ready"),
    summary: text().notNull(),
    content: text().notNull(),
    scope: text().notNull().default(""),
    out_of_scope: text(),
    evidence: text({ mode: "json" }).$type<string[]>(),
    metadata: text({ mode: "json" }).$type<EngineMetadata>(),
    ...Timestamps,
  },
  (table) => [
    index("engine_spec_snapshot_task_idx").on(table.task_id),
  ],
)

export const EngineSpecItemTable = sqliteTable(
  "engine_spec_item",
  {
    id: text().primaryKey(),
    task_id: text().notNull(),
    spec_snapshot_id: text().notNull(),
    title: text().notNull(),
    description: text().notNull(),
    status: text().notNull().$type<EngineSpecItemStatus>().default("pending"),
    priority: text().notNull().$type<EngineGoalPriority>().default("blocking"),
    check_selector: text({ mode: "json" }).$type<string[]>(),
    evidence: text(),
    metadata: text({ mode: "json" }).$type<EngineMetadata>(),
    ...Timestamps,
  },
  (table) => [
    index("engine_spec_item_task_idx").on(table.task_id),
    index("engine_spec_item_snapshot_idx").on(table.spec_snapshot_id),
  ],
)
export type EngineArtifactKind =
  | "patch"
  | "changed_file"
  | "log"
  | "report"
  | "image"
  | "diff"
  | "link"
  | "git_ref"
  | "verdict"
  | "evaluation"
  | "pr"
export type EngineDeliveryStatus = "candidate" | "publishing" | "delivered" | "failed"
export type EngineEvaluationStatus = "pending" | "passed" | "failed" | "inconclusive"
export type EngineEvaluationVerdict = "accepted" | "rejected" | "inconclusive"
export type EngineProgressStatus = "created" | "active" | "completed" | "failed" | "cancelled"
export type EngineExecutorTransport = "inproc" | "stdio" | "ws" | "http"
export type EngineExecutorSessionStatus = "active" | "completed" | "failed" | "aborted"

/** Kind tag on an EngineEvaluationCheck row. Drill-down only; not a gate. */
export type EngineEvaluationCheckScorerKind =
  | "heuristic_shell"
  | "heuristic_script_ref"
  | "llm_judge"
  | "prebuilt"
  | "visual_diff"
  | "delivery_verdict"

/**
 * Structured row inside engine_evaluation.checks[]. This is audit/drill-down
 * data for operators — not gating signal. Gating lives in
 * engine_metric_result + engine_iteration. Fields mode/severity/trigger were
 * removed when the DAM cut-over replaced strict/soft gating with the Arbiter.
 */
export type EngineEvaluationCheck = {
  name: string
  label?: string
  family?: string
  status: "passed" | "failed" | "skipped"
  evidence?: string
  spec_id?: string
  scorer_kind?: EngineEvaluationCheckScorerKind
  exit_code?: number
  idle_timed_out?: boolean
  matched_paths?: string[]
  output_digest?: string
}

/** Scope marker for an evaluation row (invariant enforced at app layer):
 *  - scope="goal_run" ⇒ goal_run_id NOT NULL
 *  - scope="delivery" ⇒ delivery_id NOT NULL */
export type EngineEvaluationScope = "goal_run" | "delivery"

export type EngineExecutorRef = {
  session_id?: string
  queue_task_id?: string
}

export type EngineExecutorProtocolRef = ProtocolRefsInfo
export type EngineExecutorCapability = ProtocolCapabilitiesInfo
export type EngineExecutorSettings = ProtocolSettingsInfo

export const EngineTaskTable = sqliteTable(
  "engine_task",
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
    /** JSON array of AttachmentStore references — { sha, url, mime, size, filename?, intent?, source? }.
     *  Base64 bytes are never stored here; they live on disk under the project's
     *  .opencorvus/attachments directory and are fetched via the /attachment route.
     *  `intent` controls which evaluator gate consumes the file (e.g.
     *  "visual_reference" → deliver visual SSIM gate). `source` records where
     *  the attachment came from (user-upload / figma / url-screenshot). */
    attachments: text({ mode: "json" }).$type<Array<{ sha: string; url: string; mime: string; size: number; filename?: string; intent?: string; source?: string }>>(),
    /** "workflow" tasks go through requirements→design→architect→execute→deliver.
     *  "build" tasks bypass the pipeline and run the build agent directly —
     *  used for one-shot edits / Q&A / quick fixes. Both kinds share the same
     *  task table and queue so cancel/list/audit are uniform. */
    kind: text().notNull().$type<"workflow" | "build">().default("workflow"),
    status: text().notNull().$type<EngineTaskStatus>().default("queued"),
    priority: text().notNull().$type<EngineTaskPriority>().default("normal"),
    blocking_reason: text(),
    error: text(),
    budget: text({ mode: "json" }).$type<EngineBudget>(),
    metadata: text({ mode: "json" }).$type<EngineMetadata>(),
    time_started: integer(),
    time_completed: integer(),
    /** Timestamp when the task's status last changed. Used by stranded-task recovery
     *  to measure time-in-current-status without being reset by incidental DB writes. */
    time_status_changed: integer(),
    /** Rewind cursor: when non-null, all UI-facing event queries filter events
     *  with `time_created > rewind_cursor_time` OUT. This is how "rewind to a
     *  specific message card" works without deleting history — the filter is
     *  a projection, the underlying append-only log stays intact. Written by
     *  `rewindTask(taskID, eventID)` which also aborts any in-flight loop.
     *  When a new user message arrives AFTER a rewind, its session-message
     *  event is appended normally; the next loop sees "history up to cursor
     *  + new message beyond cursor" as a merged view per describe layer. */
    rewind_cursor_time: integer(),
    /** The event id the user clicked to anchor the rewind. Audit only;
     *  the cursor time is what actually filters queries. Kept for overlay
     *  highlighting (which card the user rewound from). */
    rewind_cursor_event_id: text(),
    /** Monotonic counter of rewind operations on this task. Useful for
     *  rate-limiting (overlay can warn on rapid re-rewind) and for
     *  distinguishing "new events since rewind" in UI diffs. */
    rewind_count: integer().notNull().default(0),
    ...Timestamps,
  },
  (table) => [
    index("engine_task_project_idx").on(table.project_id),
    index("engine_task_status_idx").on(table.status),
    index("engine_task_kind_idx").on(table.kind),
    uniqueIndex("engine_task_project_request_idx").on(table.project_id, table.request_id),
  ],
)

export const EnginePlanVersionTable = sqliteTable(
  "engine_plan_version",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => EngineTaskTable.id, { onDelete: "cascade" }),
    spec_snapshot_id: text()
      .references(() => EngineSpecSnapshotTable.id, { onDelete: "set null" }),
    version: integer().notNull(),
    status: text().notNull().$type<EnginePlanStatus>().default("active"),
    summary: text().notNull(),
    prompt: text().notNull(),
    metadata: text({ mode: "json" }).$type<EngineMetadata>(),
    ...Timestamps,
  },
  (table) => [
    index("engine_plan_task_idx").on(table.task_id),
  ],
)

export const EngineMilestoneTable = sqliteTable(
  "engine_milestone",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => EngineTaskTable.id, { onDelete: "cascade" }),
    plan_version_id: text()
      .notNull()
      .references(() => EnginePlanVersionTable.id, { onDelete: "cascade" }),
    title: text().notNull(),
    description: text().notNull().default(""),
    status: text().notNull().$type<EngineMilestoneStatus>().default("pending"),
    order_index: integer().notNull().default(0),
    metadata: text({ mode: "json" }).$type<EngineMetadata>(),
    ...Timestamps,
  },
  (table) => [
    index("engine_milestone_task_idx").on(table.task_id),
    index("engine_milestone_plan_idx").on(table.plan_version_id),
  ],
)

export const EngineGoalTable = sqliteTable(
  "engine_goal",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => EngineTaskTable.id, { onDelete: "cascade" }),
    plan_version_id: text()
      .references(() => EnginePlanVersionTable.id, { onDelete: "cascade" }),
    spec_snapshot_id: text()
      .references(() => EngineSpecSnapshotTable.id, { onDelete: "cascade" }),
    milestone_id: text().references(() => EngineMilestoneTable.id, { onDelete: "set null" }),

    // --- GoalContractFields: each field is an independent column (no compression) ---
    /** Short goal title. */
    title: text().notNull(),
    /**
     * Content-derived human-readable identifier (e.g. "add-login-form"). Derived
     * from title at insert, immutable thereafter. Display-only — never an FK,
     * never referenced as identity. Used alongside goal_id in logs/UI so humans
     * can tell goals apart without memorising `gol_<hex>` ids.
     */
    slug: text().notNull(),
    /** Full objective statement — what this goal accomplishes. */
    objective: text().notNull(),
    /** Typed acceptance specs (AcceptanceSpec[] JSON). Eval source of truth. */
    acceptance_specs: text({ mode: "json" }).$type<import("@/acceptance/types").AcceptanceSpec[]>().notNull().default([]),
    /** Files this goal owns exclusively. Executor hard write boundary. */
    owned_paths: text({ mode: "json" }).$type<string[]>().notNull().default([]),
    /** Goal IDs this depends on (must complete before this goal starts). */
    depends_on: text({ mode: "json" }).$type<string[]>().notNull().default([]),
    /** Interfaces this goal EXPORTS for dependent goals. */
    exports: text({ mode: "json" }).$type<string[]>().notNull().default([]),
    /** Interfaces this goal IMPORTS from its dependencies. */
    imports: text({ mode: "json" }).$type<string[]>().notNull().default([]),
    /** Goal category (e.g. bootstrap, feature, verification). */
    kind: text().notNull().default("feature"),
    /** Requirement IDs from user input that this goal covers (fidelity tracing). */
    requirement_ids: text({ mode: "json" }).$type<string[]>().notNull().default([]),

    // --- Orchestrator-managed fields ---
    priority: text().notNull().$type<EngineGoalPriority>().default("blocking"),
    source: text().notNull().default("spec"),
    // RETIRED: engine_goal.status + cascade_state columns.
    // Both were cached projections serving dispatch-gate logic that the
    // LLM-autonomous redesign deleted. Current state is always derived
    // live from the goal_run chain via engine/describe.ts::goalStatusByID
    // or engine/describe.ts::describeGoal. Dep-failure propagation is the
    // LLM's decision (it reads depends_on + each dep's terminal flags in
    // the describe snapshot), not a schema column.
    /** Per-goal retry counter. Incremented each time retry_goal resets this goal. */
    retry_count: integer().notNull().default(0),
    /** Goal-scoped live workspace directory reused across retries until terminal cleanup. */
    workspace_dir: text(),
    /** Branch currently checked out in workspace_dir. */
    workspace_branch: text(),
    /** Goal-scoped Snapshot baseRef (tree-hash) captured BEFORE the first
     *  attempt's executor ran. Reused across all retries so that "zero file
     *  changes" semantics stay anchored to the original scaffold state rather
     *  than the post-prior-attempt state. Without this, retry #2 of a goal
     *  that kept its files would capture a new baseRef after the prior
     *  attempt's diff, then a no-op executor would produce zero diffs against
     *  that contaminated baseline and the snapshot subsystem would report
     *  "zero file changes" — forcing a false failure even though the branch
     *  HEAD already contains the goal's work. */
    workspace_base_ref: text(),
    order_index: integer().notNull().default(0),
    /** Remaining metadata (check_selector, visual hints, etc.) */
    metadata: text({ mode: "json" }).$type<EngineMetadata>(),
    ...Timestamps,
  },
  (table) => [
    index("engine_goal_task_idx").on(table.task_id),
    index("engine_goal_plan_idx").on(table.plan_version_id),
    index("engine_goal_milestone_idx").on(table.milestone_id),
  ],
)

export type EngineGoalRunStatus = "queued" | "accepted" | "planning" | "running" | "evaluating" | "blocked" | "completed" | "failed" | "aborted"

export const EngineRequirementTable = sqliteTable(
  "engine_requirement",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => EngineTaskTable.id, { onDelete: "cascade" }),
    spec_snapshot_id: text()
      .notNull()
      .references(() => EngineSpecSnapshotTable.id, { onDelete: "cascade" }),
    title: text().notNull(),
    description: text().notNull(),
    status: text().notNull().$type<"pending" | "passed" | "failed">().default("pending"),
    priority: text().notNull().$type<EngineGoalPriority>().default("blocking"),
    acceptance: text().notNull(),
    evidence_refs: text({ mode: "json" }).$type<string[]>(),
    non_goals: text({ mode: "json" }).$type<string[]>(),
    metadata: text({ mode: "json" }).$type<EngineMetadata>(),
    order_index: integer().notNull().default(0),
    ...Timestamps,
  },
  (table) => [
    index("engine_requirement_task_idx").on(table.task_id),
    index("engine_requirement_spec_idx").on(table.spec_snapshot_id),
  ],
)

export const EngineGoalSnapshotTable = sqliteTable(
  "engine_goal_snapshot",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => EngineTaskTable.id, { onDelete: "cascade" }),
    spec_snapshot_id: text()
      .notNull()
      .references(() => EngineSpecSnapshotTable.id, { onDelete: "cascade" }),
    version: integer().notNull().default(1),
    status: text().notNull().$type<"ready" | "superseded" | "completed">().default("ready"),
    summary: text().notNull(),
    metadata: text({ mode: "json" }).$type<EngineMetadata>(),
    ...Timestamps,
  },
  (table) => [
    index("engine_goal_snapshot_task_idx").on(table.task_id),
  ],
)

export const EnginePlanNodeTable = sqliteTable(
  "engine_plan_node",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => EngineTaskTable.id, { onDelete: "cascade" }),
    plan_version_id: text()
      .notNull()
      .references(() => EnginePlanVersionTable.id, { onDelete: "cascade" }),
    kind: text().notNull().$type<"goal" | "milestone" | "step">(),
    goal_id: text().references(() => EngineGoalTable.id, { onDelete: "set null" }),
    title: text().notNull(),
    brief: text().notNull(),
    depends_on_ids: text({ mode: "json" }).$type<string[]>(),
    order_index: integer().notNull().default(0),
    metadata: text({ mode: "json" }).$type<EngineMetadata>(),
    ...Timestamps,
  },
  (table) => [
    index("engine_plan_node_task_idx").on(table.task_id),
    index("engine_plan_node_plan_idx").on(table.plan_version_id),
    index("engine_plan_node_goal_idx").on(table.goal_id),
  ],
)

export const EngineRunTable = sqliteTable(
  "engine_run",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => EngineTaskTable.id, { onDelete: "cascade" }),
    plan_version_id: text().references(() => EnginePlanVersionTable.id, { onDelete: "set null" }),
    session_id: text().references(() => SessionTable.id, { onDelete: "set null" }),
    executor: text().notNull().$type<EngineExecutor>().default("opencode"),
    status: text().notNull().$type<EngineRunStatus>().default("queued"),
    phase: text().notNull().$type<EngineRunPhase>().default("execute"),
    blocking_reason: text(),
    error: text(),
    retry_count: integer().notNull().default(0),
    executor_ref: text({ mode: "json" }).$type<EngineExecutorRef>(),
    metadata: text({ mode: "json" }).$type<EngineMetadata>(),
    time_started: integer(),
    time_completed: integer(),
    ...Timestamps,
  },
  (table) => [
    index("engine_run_task_idx").on(table.task_id),
    index("engine_run_status_idx").on(table.status),
  ],
)

export const EngineGoalRunTable = sqliteTable(
  "engine_goal_run",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => EngineTaskTable.id, { onDelete: "cascade" }),
    goal_id: text()
      .notNull()
      .references(() => EngineGoalTable.id, { onDelete: "cascade" }),
    plan_node_id: text(),
    coordinator_run_id: text()
      .notNull()
      .references(() => EngineRunTable.id, { onDelete: "cascade" }),
    session_id: text().references(() => SessionTable.id, { onDelete: "set null" }),
    status: text().notNull().$type<EngineGoalRunStatus>().default("queued"),
    retry_count: integer().notNull().default(0),
    blocking_reason: text(),
    error: text(),
    workspace_dir: text(),
    base_ref: text(),
    merge_ref: text(),
    /** When a retry creates a fresh goal_run for a goal whose prior run is
     *  already in a terminal state (completed/failed/aborted), the new row
     *  points at the old row via supersede_of. Readiness, dispatch gate,
     *  and "satisfies goal" queries walk this chain and treat only the
     *  tail (no successor) as authoritative — retries re-dispatch without
     *  mutating history and without resurrecting terminal states. */
    supersede_of: text(),
    /** Why this row's tip was superseded (i.e. why a new attempt was opened).
     *  Set on the OLD row by `Goal.startNewAttempt` / `supersedeGoalRun`
     *  when the prior run is in a terminal state but the goal must re-dispatch.
     *  `deriveGoalStatus` projects terminal tips with this column non-null
     *  back to `pending` so the dispatch loop picks them up. NULL on rows
     *  that were never superseded. */
    superseded_reason: text().$type<EngineGoalRunSupersededReason>(),
    superseded_at: integer(),
    metadata: text({ mode: "json" }).$type<EngineMetadata>(),
    time_started: integer(),
    time_completed: integer(),
    ...Timestamps,
  },
  (table) => [
    index("engine_goal_run_task_idx").on(table.task_id),
    index("engine_goal_run_goal_idx").on(table.goal_id),
    index("engine_goal_run_coordinator_idx").on(table.coordinator_run_id),
    index("engine_goal_run_status_idx").on(table.status),
    index("engine_goal_run_supersede_of_idx").on(table.supersede_of),
  ],
)

export const EngineInteractionRequestTable = sqliteTable(
  "engine_interaction_request",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => EngineTaskTable.id, { onDelete: "cascade" }),
    run_id: text().references(() => EngineRunTable.id, { onDelete: "cascade" }),
    session_id: text().references(() => SessionTable.id, { onDelete: "set null" }),
    external_id: text().notNull(),
    request_type: text().notNull().$type<EngineInteractionType>(),
    status: text().notNull().$type<EngineInteractionStatus>().default("pending"),
    title: text().notNull(),
    body: text().notNull(),
    payload: text({ mode: "json" }).$type<EngineMetadata>(),
    response: text({ mode: "json" }).$type<EngineMetadata>(),
    time_resolved: integer(),
    ...Timestamps,
  },
  (table) => [
    index("engine_interaction_run_idx").on(table.run_id),
    index("engine_interaction_external_idx").on(table.external_id),
    index("engine_interaction_status_idx").on(table.status),
  ],
)

export const EngineDeliveryTable = sqliteTable(
  "engine_delivery",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => EngineTaskTable.id, { onDelete: "cascade" }),
    run_id: text()
      .notNull()
      .references(() => EngineRunTable.id, { onDelete: "cascade" }),
    goal_run_id: text().references(() => EngineGoalRunTable.id, { onDelete: "set null" }),
    status: text().notNull().$type<EngineDeliveryStatus>().default("candidate"),
    summary: text().notNull(),
    result: text({ mode: "json" }).$type<DeliveryResult>(),
    ...Timestamps,
  },
  (table) => [
    index("engine_delivery_run_idx").on(table.run_id),
  ],
)

export const EngineArtifactTable = sqliteTable(
  "engine_artifact",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => EngineTaskTable.id, { onDelete: "cascade" }),
    run_id: text()
      .notNull()
      .references(() => EngineRunTable.id, { onDelete: "cascade" }),
    goal_run_id: text().references(() => EngineGoalRunTable.id, { onDelete: "set null" }),
    delivery_id: text().references(() => EngineDeliveryTable.id, { onDelete: "set null" }),
    kind: text().notNull().$type<EngineArtifactKind>(),
    label: text().notNull(),
    payload: text({ mode: "json" }).$type<EngineMetadata>(),
    ...Timestamps,
  },
  (table) => [
    index("engine_artifact_run_idx").on(table.run_id),
    index("engine_artifact_delivery_idx").on(table.delivery_id),
  ],
)

export const EngineEvaluationTable = sqliteTable(
  "engine_evaluation",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => EngineTaskTable.id, { onDelete: "cascade" }),
    run_id: text()
      .notNull()
      .references(() => EngineRunTable.id, { onDelete: "cascade" }),
    goal_run_id: text().references(() => EngineGoalRunTable.id, { onDelete: "set null" }),
    delivery_id: text().references(() => EngineDeliveryTable.id, { onDelete: "set null" }),
    /** Scope marker. App-layer invariant:
     *    scope="goal_run" ⇒ goal_run_id NOT NULL
     *    scope="delivery" ⇒ delivery_id NOT NULL */
    scope: text().$type<EngineEvaluationScope>().notNull().default("delivery"),
    status: text().notNull().$type<EngineEvaluationStatus>().default("pending"),
    verdict: text().notNull().$type<EngineEvaluationVerdict>().default("inconclusive"),
    summary: text().notNull(),
    checks: text({ mode: "json" }).$type<EngineEvaluationCheck[]>(),
    time_completed: integer(),
    ...Timestamps,
  },
  (table) => [
    index("engine_evaluation_run_idx").on(table.run_id),
    index("engine_evaluation_scope_task_idx").on(table.task_id, table.scope),
  ],
)

export const EngineProgressSnapshotTable = sqliteTable(
  "engine_progress_snapshot",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => EngineTaskTable.id, { onDelete: "cascade" }),
    status: text().notNull().$type<EngineProgressStatus>(),
    summary: text().notNull(),
    payload: text({ mode: "json" }).$type<EngineMetadata>(),
    ...Timestamps,
  },
  (table) => [
    index("engine_progress_task_idx").on(table.task_id),
  ],
)

export const EngineExecutorSessionTable = sqliteTable(
  "engine_executor_session",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => EngineTaskTable.id, { onDelete: "cascade" }),
    run_id: text()
      .notNull()
      .references(() => EngineRunTable.id, { onDelete: "cascade" }),
    goal_run_id: text().references(() => EngineGoalRunTable.id, { onDelete: "set null" }),
    provider: text().notNull().$type<EngineExecutor>(),
    protocol: text().notNull(),
    protocol_version: text().notNull(),
    transport: text().notNull().$type<EngineExecutorTransport>(),
    status: text().notNull().$type<EngineExecutorSessionStatus>().default("active"),
    refs: text({ mode: "json" }).$type<EngineExecutorProtocolRef>(),
    capabilities: text({ mode: "json" }).$type<EngineExecutorCapability>(),
    settings: text({ mode: "json" }).$type<EngineExecutorSettings>(),
    lease_owner: text(),
    lease_until: integer(),
    time_started: integer(),
    time_completed: integer(),
    ...Timestamps,
  },
  (table) => [
    index("engine_executor_session_task_idx").on(table.task_id),
    index("engine_executor_session_run_idx").on(table.run_id),
    index("engine_executor_session_goal_run_idx").on(table.goal_run_id),
    index("engine_executor_session_status_idx").on(table.status),
  ],
)

export const EngineChannelBindingTable = sqliteTable(
  "engine_channel_binding",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => EngineTaskTable.id, { onDelete: "cascade" }),
    platform: text().notNull(),
    channel: text().notNull(),
    thread: text().notNull(),
    payload: text({ mode: "json" }).$type<EngineMetadata>(),
    ...Timestamps,
  },
  (table) => [
    index("engine_channel_task_idx").on(table.task_id),
    uniqueIndex("engine_channel_binding_thread_idx").on(table.platform, table.channel, table.thread),
  ],
)
