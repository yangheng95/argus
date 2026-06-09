import { integer, sqliteTable, text, index, uniqueIndex } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "@/project/project.sql"
import { SessionTable } from "@/session/session.sql"
import { Timestamps } from "@/storage/schema.sql"

export type EngineBudget = {
  max_executor_groups?: number
}

export type EngineMetadata = Record<string, unknown>

export type AcceptanceResult = {
  diffs?: Array<{ file: string; status?: string; before?: string; after?: string; diff?: string }>
  changed_files?: string[]
  commit_ref?: string
  [key: string]: unknown
}

export type EngineTaskStatus = "queued" | "active" | "completed" | "failed" | "cancelled"

export type EngineTaskPriority = "critical" | "high" | "normal" | "low"
export type EngineExecutor = "opencorvus" | "codex" | "claude-code"
export type EnginePlanStatus = "active" | "superseded"
export type EngineGoalPriority = "blocking" | "advisory"
// engine_goal.status was retired in the LLM-autonomous redesign: it was a
// cached projection of (cascade_state, goal_run chain tip) used as a
// queue/loop scheduling hint, and the old gate itself was the source of
// status-carousel deadlocks. Call-sites read engine/describe.ts::goalStatusByID (live
// derivation from goal_run chain) or engine/describe.ts::describeGoal
// (structured view with is_running / is_terminal_ok / etc.). The column
// is gone; no type alias for it.
export type EngineMilestoneStatus = "pending" | "active" | "passed" | "failed"
export type EngineRunStatus = "queued" | "accepted" | "running" | "blocked" | "completed" | "failed" | "aborted"
export type EngineRunPhase = "plan" | "execute" | "evaluate" | "deliver" | "dispatch" | "retry"

// Why a goal_run was superseded — free-text label for human / LLM consumption.
// Rendered into describe output and surfaces to the orchestrator LLM as a
// semantic hint. Not enumerated: per rule 23 (no state-machine enums), code
// never branches on the specific value. The only boolean signal code reads
// is `!!superseded_reason` ("was this tip superseded?"). The orchestrator
// reads the rendered semantic hint on its next decision turn and decides
// what to do — there is no loop-side watermark / auto-rewake on this column.
// Conventional labels callers write (documentation only, not enforced):
//   manual_retry, acceptance_rework, modify_contract, restart_stage
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
  (table) => [index("engine_spec_snapshot_task_idx").on(table.task_id)],
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
  | "verification-evidence"
  | "acceptance_evidence_manifest"
  | "acceptance_surface_manifest"
  | "acceptance_specialist_review"
  | "acceptance_review_threw"
  | "acceptance"
  | "goal_run_attempt"
  | "integrity_attempt"
  | "fact_check_attempt"
  | "research_brief"
  | "frontend_research_brief"
  | "run"
  | "architect_contract_graph"
  | "goal_workload"
  | "build_session_contract"
  | "orchestrator_tool_ownership"
  | "goal_batch_notification"
  | "exploration"
  | "browser_preview_target"
  | "browser_preview_evidence"
  | "orchestrator-stream-error"
  | "tool-execute-error"
export type EngineAcceptanceStatus = "candidate" | "publishing" | "delivered" | "failed"
export type EngineEvaluationStatus = "pending" | "passed" | "failed" | "inconclusive"
export type EngineEvaluationVerdict = "accepted" | "rejected" | "inconclusive"
export type EngineProgressStatus = "created" | "active" | "completed" | "failed" | "cancelled"

/** Kind tag on an EngineEvaluationCheck row. Drill-down only; not a gate. */
export type EngineEvaluationCheckScorerKind =
  | "heuristic_shell"
  | "heuristic_script_ref"
  | "llm_judge"
  | "prebuilt"
  | "visual_diff"
  | "acceptance_verdict"

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
  status: "passed" | "failed" | "skipped" | "inconclusive"
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
 *  - scope="acceptance" ⇒ acceptance_id NOT NULL */
export type EngineEvaluationScope = "goal_run" | "acceptance"

export type EngineExecutorRef = {
  session_id?: string
  queue_task_id?: string
}

export const EngineTaskTable = sqliteTable(
  "engine_task",
  {
    id: text().primaryKey(),
    project_id: text()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    session_id: text().references(() => SessionTable.id, { onDelete: "set null" }),
    /** Phase-6-f-5: `active_spec_version_id` cache column removed. Derive via
     *  `findActiveSpecForTask(taskID)` (engine_spec_snapshot.status != 'superseded').
     *  Rule 22 — single source in the spec status column. */
    /** Phase-6-f: `active_plan_version_id` cache column removed. Derive via
     *  `findActivePlanForTask(taskID)` (engine_plan_version.status='active').
     *  Rule 22 — single source in the plan status column. */
    /** Phase-6-f-3: `active_run_id` cache column removed. Derive via
     *  `findActiveRunForTask(taskID)` (newest engine_artifact kind="run"). */
    request_id: text(),
    source: text().notNull().default("api"),
    title: text().notNull(),
    request: text().notNull(),
    /** USER-CONTRACT attachments only. JSON array of AttachmentStore references.
     *  Carries what the USER explicitly attached as part of the task contract:
     *    `source: "user-upload"` — files the user uploaded with the request
     *    `source: "figma"`       — frames fetched from a user-provided Figma URL
     *  Read by requirements / frontend-design as the user's intent (multimodal
     *  prompt content). Read by acceptance alongside system_artifacts for visual
     *  comparison. Shown in the overlay as user-attached files.
     *  System-generated visual evidence (URL screenshots, rendered.png, local
     *  material reads) lives in `system_artifacts` instead — see that column
     *  for the rationale. Mixing the two previously caused requirements to
     *  hard-fail when a system-generated screenshot went missing.
     *  Base64 bytes are never stored here; the file lives on disk under the
     *  project's runtime attachment blob store. */
    attachments: text({ mode: "json" }).$type<
      Array<{
        sha: string
        url: string
        mime: string
        size: number
        filename?: string
        intent?: string
        source?: string
      }>
    >(),
    /** SYSTEM-GENERATED artifacts. Same shape as `attachments` but covers
     *  things the orchestrator/agents created (or read off disk) on the
     *  user's behalf — never part of the user's contract:
     *    `source: "url-screenshot"`  — frontend_design URL captures
     *    `source: "material"`        — frontend_design local file reads
     *    `source: "playwright"`      — acceptance rendered.png captures
     *  Read ONLY by acceptance (visual diff against user attachments). Never
     *  fed to requirements/frontend-design as user intent. Losing one of these
     *  on disk is a soft failure: the consuming agent skips it; it does NOT
     *  kill the whole task the way a user-contract attachment loss would. */
    system_artifacts: text({ mode: "json" })
      .$type<
        Array<{
          sha: string
          url: string
          mime: string
          size: number
          filename?: string
          intent?: string
          source?: string
        }>
      >()
      .notNull()
      .default([]),
    /** Frontend-design visual constraints (advisory only — acceptance reads them as
     *  checklist guidance for its own visual review, they are NOT auto-scored
     *  and do NOT gate any phase). See `src/frontend-design/types.ts` for the
     *  shape. Written by the orchestrator `frontend_design` tool, consumed by
     *  acceptance prompt rendering. */
    design_specs: text({ mode: "json" }).$type<import("@/frontend-design/types").VisualSpec[]>().notNull().default([]),
    /** Executor that runs this task's goal runs — "opencorvus" / "codex" /
     *  "claude-code". Promoted from task.metadata._pipeline.executor (which
     *  carried several other fields that turned out to be dead). Read by the
     *  dispatch tool when creating runs. */
    executor: text().notNull().$type<EngineExecutor>().default("opencorvus"),
    /** Acceptance verdict criteria rollup — unified stream of
     *  deferred_checks + rejection_details + startup/frontend checks, used
     *  by the overlay Quality Gates panel. Promoted from
     *  task.metadata.criteria_results. Written by state.ts::upsertTaskCriteria,
     *  read by workbench/board.ts::buildBoardFields. */
    criteria_results: text({ mode: "json" }).$type<Array<Record<string, unknown>>>().notNull().default([]),
    /** "workflow" tasks go through requirements→design→architect→execute→deliver.
     *  "build" tasks bypass the pipeline and run the build agent directly —
     *  used for one-shot edits / Q&A / quick fixes. Both kinds share the same
     *  task table and queue so cancel/list/audit are uniform. */
    kind: text().notNull().$type<"workflow" | "build">().default("workflow"),
    /** Phase-6-f-2: `status` cache column removed. Derive via
     *  `engine/task-status.ts::deriveTaskStatus` from
     *  (time_started, time_completed, error, metadata.cancelled). */
    priority: text().notNull().$type<EngineTaskPriority>().default("normal"),
    /** Directory-scoped runnable queue order. Active tasks are excluded from
     *  reordering and queued siblings are claimed by this value. Priority only
     *  seeds initial placement; user drag order rewrites this field directly. */
    queue_order: integer().notNull().default(0),
    /** Phase-6-f-4: `blocking_reason` cache column removed. Blocking is a
     *  run-scoped signal (run.blocking_reason + pending interactions). */
    error: text(),
    budget: text({ mode: "json" }).$type<EngineBudget>(),
    metadata: text({ mode: "json" }).$type<EngineMetadata>(),
    time_started: integer(),
    time_completed: integer(),
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
    index("engine_task_time_updated_idx").on(table.time_updated, table.id),
    index("engine_task_project_time_updated_idx").on(table.project_id, table.time_updated, table.id),
    index("engine_task_time_completed_idx").on(table.time_completed),
    index("engine_task_kind_idx").on(table.kind),
    index("engine_task_queue_order_idx").on(table.queue_order),
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
    spec_snapshot_id: text().references(() => EngineSpecSnapshotTable.id, { onDelete: "set null" }),
    version: integer().notNull(),
    status: text().notNull().$type<EnginePlanStatus>().default("active"),
    summary: text().notNull(),
    prompt: text().notNull(),
    metadata: text({ mode: "json" }).$type<EngineMetadata>(),
    ...Timestamps,
  },
  (table) => [index("engine_plan_task_idx").on(table.task_id)],
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
    plan_version_id: text().references(() => EnginePlanVersionTable.id, { onDelete: "cascade" }),
    spec_snapshot_id: text().references(() => EngineSpecSnapshotTable.id, { onDelete: "cascade" }),
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
    acceptance_specs: text({ mode: "json" })
      .$type<import("@/acceptance/types").AcceptanceSpec[]>()
      .notNull()
      .default([]),
    /** Files this goal owns exclusively. Executor hard write boundary. */
    owned_paths: text({ mode: "json" }).$type<string[]>().notNull().default([]),
    /** Goal IDs this depends on (must complete before this goal starts). */
    depends_on: text({ mode: "json" }).$type<string[]>().notNull().default([]),
    /** Goal category (e.g. bootstrap, feature, verification). */
    kind: text().notNull().default("feature"),
    /** Requirement IDs from user input that this goal covers (integrity tracing). */
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
    // Phase E (2026-05-05): retry_count retired here. The per-goal
    // implementation version counter (V label) lived as a denormalised cache
    // of the latest goal_run_attempt artifact's payload.retry_count — same
    // value, two writers, no transactional coupling. Rule 8 (no dual
    // source) forced the move: callers go through
    // engine/store.ts:getGoalRetryCount(goalID) which reads the latest
    // attempt artifact. New attempts compute the bumped count from the
    // artifact tip in `openGoalImplementationVersion`.
    // Phase B (2026-05-05): workspace_dir / workspace_branch / workspace_base_ref
    // were retired here in favour of the per-attempt artifact payload as the
    // single source of truth. Persistent goal-scoped worktree state lives on
    // engine_artifact[kind="goal_run_attempt"].payload.workspace_*; readers go
    // through engine/store.ts:findGoalLatestWorkspace(goalID). Pre-fix the
    // duplication (engine_goal column + artifact payload) let the build tool
    // poison the engine_goal row when fidelity rejected a dispatch — no
    // attempt was ever opened, but the column was already written, leaving
    // the orchestrator wedged on a phantom worktree it could never finish.
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

export type EngineGoalRunStatus =
  | "queued"
  | "accepted"
  | "planning"
  | "running"
  | "evaluating"
  | "blocked"
  | "completed"
  | "failed"
  | "aborted"

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

// Phase-6-f-cleanup-3: `engine_goal_snapshot` was never written or read by
// src/ — the table was an unused placeholder from the pre-artifact design.
// Deleted along with EngineGoalSnapshotTable definition, DDL CREATE,
// findGoalSnapshot / goalSnapshotIDOfPlan helpers (zero callers).

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

// Phase-6-e: `engine_run` was removed in favour of `engine_artifact` rows
// with kind="run". See engine/writer.ts (createRun) + engine/state.ts
// (updateRun) for the writer and engine/store.ts (RunRow +
// artifactRowToRunRow + latestPerRun) for the read-model. Append-only —
// status transitions (queued → accepted → running → ...) are new rows
// per logical run_id; findRun and the listLiveRunsForProject / findRuns
// helpers take the newest via time_created desc (+ id tiebreak).

// Phase-6-d: `engine_goal_run` was removed in favour of `engine_artifact`
// rows with kind="goal_run_attempt". See engine/persist.ts (createGoalRun /
// supersedeGoalRun / updateGoalRun → appendGoalRunArtifact) for the writer
// and engine/store.ts (GoalRunRow + artifactRowToGoalRunRow +
// latestPerGoalRun) for the read-model. Append-only — status transitions
// (queued → accepted → running → completed/failed/aborted, plus
// supersede marks) are new rows per logical goal_run_id; `findGoalRun` and
// the 7 listGoalRunsFor* helpers take the newest via `time_created desc`.

export const EngineInteractionRequestTable = sqliteTable(
  "engine_interaction_request",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => EngineTaskTable.id, { onDelete: "cascade" }),
    /** Phase-6-e: plain text pointer to the logical run id (was FK). */
    run_id: text(),
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

// Phase-6-c: `engine_acceptance` was removed in favour of `engine_artifact` rows
// with kind="acceptance". See engine/persist.ts (writeAcceptanceRow /
// markAcceptancePublishing / finalizeAcceptanceResult) for the writer and
// engine/store.ts (AcceptanceRow) for the read-model that reconstructs the
// historical shape from the artifact payload. Append-only — status
// transitions (candidate → publishing → delivered/failed) are new rows per
// acceptance_id and `findAcceptance*` take the newest via `time_created desc`.

export const EngineArtifactTable = sqliteTable(
  "engine_artifact",
  {
    id: text().primaryKey(),
    task_id: text()
      .notNull()
      .references(() => EngineTaskTable.id, { onDelete: "cascade" }),
    /** Phase-6-e: plain text pointer to the logical run id (was FK to
     *  engine_run which is now deleted). Nullable post-phase-7: most artifacts
     *  still scope to a run (self-referencing for "run" kind: id === run_id),
     *  but task-level facts emitted before any run exists (e.g.
     *  kind="orchestrator-stream-error" raised mid-decision when runCount=0)
     *  legitimately have no run. Per rule 23 schema does not enforce a
     *  state-machine invariant the orchestrator owns. */
    run_id: text(),
    /** Phase-6-d: plain text pointer to the logical goal_run id (was FK to
     *  engine_goal_run which is now deleted). See persist.ts / store.ts for
     *  the artifact-backed goal_run semantics. */
    goal_run_id: text(),
    /** Phase-6-c: acceptance_id used to FK onto engine_acceptance(id). With that
     *  table deleted, the column is a plain text pointer to the id of the
     *  latest acceptance-kind artifact row for the logical acceptance. Still set
     *  to that id by writers so downstream consumers can group artifact
     *  rows by acceptance without a FK constraint. */
    acceptance_id: text(),
    kind: text().notNull().$type<EngineArtifactKind>(),
    label: text().notNull(),
    payload: text({ mode: "json" }).$type<EngineMetadata>(),
    ...Timestamps,
  },
  (table) => [
    index("engine_artifact_run_idx").on(table.run_id),
    index("engine_artifact_acceptance_idx").on(table.acceptance_id),
    index("engine_artifact_task_kind_latest_idx").on(table.task_id, table.kind, table.time_created, table.id),
  ],
)

// Phase-6-b: `engine_evaluation` was removed in favour of `engine_artifact` rows
// with kind="verification-evidence". See verification/persist.ts for the writer
// and engine/store.ts for the EvaluationRow shape that preserves the historical
// read-model. EngineEvaluationScope/Status/Verdict types above are still used
// inside the artifact payload.

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
  (table) => [index("engine_progress_task_idx").on(table.task_id)],
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
