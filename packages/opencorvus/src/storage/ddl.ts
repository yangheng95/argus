/**
 * Consolidated DDL for OpenCorvus.
 *
 * All tables use CREATE TABLE IF NOT EXISTS so the schema is idempotent —
 * safe to run on every startup whether the DB is fresh or already populated.
 *
 * No migrations — DDL is the single source of truth. Change columns here directly.
 * The benchmark resets the DB on each run via resetDatabase().
 */

// ---------------------------------------------------------------------------
// Full schema — ordered by foreign-key dependency (parents first)
// ---------------------------------------------------------------------------

export const SCHEMA_DDL = /* sql */ `

-- ===== project (root) =====

CREATE TABLE IF NOT EXISTS project (
  id           text PRIMARY KEY,
  worktree     text NOT NULL,
  vcs          text,
  name         text,
  icon_url     text,
  icon_color   text,
  commands     text,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  time_initialized integer,
  sandboxes    text NOT NULL
);

-- ===== control =====

CREATE TABLE IF NOT EXISTS control_message (
  id           text PRIMARY KEY,
  project_id   text NOT NULL,
  scope        text NOT NULL,
  scope_id     text NOT NULL,
  task_id      text,
  session_id   text,
  surface      text NOT NULL,
  role         text NOT NULL,
  source       text NOT NULL,
  channel      text,
  thread       text,
  user_id      text,
  request_id   text,
  text         text NOT NULL,
  metadata     text,
  time_created integer NOT NULL,
  time_updated integer NOT NULL
);
CREATE INDEX IF NOT EXISTS control_message_project_idx ON control_message (project_id);
CREATE INDEX IF NOT EXISTS control_message_task_idx    ON control_message (task_id);
CREATE INDEX IF NOT EXISTS control_message_session_idx ON control_message (session_id);
CREATE INDEX IF NOT EXISTS control_message_thread_idx  ON control_message (surface, channel, thread);

-- ===== session =====

CREATE TABLE IF NOT EXISTS session (
  id                 text PRIMARY KEY,
  project_id         text NOT NULL,
  parent_id          text,
  slug               text NOT NULL,
  directory          text NOT NULL,
  title              text NOT NULL,
  version            text NOT NULL,
  kind               text NOT NULL,
  goal_id            text,
  share_url          text,
  summary_additions  integer,
  summary_deletions  integer,
  summary_files      integer,
  permission         text,
  metadata           text,
  time_created       integer NOT NULL,
  time_updated       integer NOT NULL,
  time_compacting    integer,
  time_archived      integer,
  FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS session_project_idx ON session (project_id);
CREATE INDEX IF NOT EXISTS session_parent_idx  ON session (parent_id);
CREATE INDEX IF NOT EXISTS session_kind_idx    ON session (kind);
CREATE INDEX IF NOT EXISTS session_goal_idx    ON session (goal_id);

-- ===== message =====

CREATE TABLE IF NOT EXISTS message (
  id           text PRIMARY KEY,
  session_id   text NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  data         text NOT NULL,
  FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS message_session_idx ON message (session_id);
CREATE INDEX IF NOT EXISTS message_session_time_idx ON message (session_id, time_created);

-- ===== part =====

CREATE TABLE IF NOT EXISTS part (
  id           text PRIMARY KEY,
  message_id   text NOT NULL,
  session_id   text NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  data         text NOT NULL,
  FOREIGN KEY (message_id) REFERENCES message(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS part_message_idx ON part (message_id);
CREATE INDEX IF NOT EXISTS part_session_idx ON part (session_id);
CREATE INDEX IF NOT EXISTS part_session_time_idx ON part (session_id, time_created);

-- ===== permission =====

CREATE TABLE IF NOT EXISTS permission (
  project_id   text PRIMARY KEY,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  data         text NOT NULL,
  FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
);

-- ===== todo =====

CREATE TABLE IF NOT EXISTS todo (
  session_id   text NOT NULL,
  content      text NOT NULL,
  status       text NOT NULL,
  priority     text NOT NULL,
  position     integer NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  PRIMARY KEY (session_id, position),
  FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS todo_session_idx ON todo (session_id);

-- ===== session_share =====

CREATE TABLE IF NOT EXISTS session_share (
  session_id   text PRIMARY KEY,
  id           text NOT NULL,
  secret       text NOT NULL,
  url          text NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
);

-- ===== control_account =====

CREATE TABLE IF NOT EXISTS control_account (
  email         text NOT NULL,
  url           text NOT NULL,
  access_token  text NOT NULL,
  refresh_token text NOT NULL,
  token_expiry  integer,
  active        integer NOT NULL,
  time_created  integer NOT NULL,
  time_updated  integer NOT NULL,
  PRIMARY KEY (email, url)
);

-- ===== workspace =====

CREATE TABLE IF NOT EXISTS workspace (
  id         text PRIMARY KEY,
  branch     text,
  project_id text NOT NULL,
  config     text NOT NULL,
  FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
);

-- ===== memory =====

CREATE TABLE IF NOT EXISTS memory_file (
  id           text PRIMARY KEY,
  project_id   text NOT NULL,
  session_id   text,
  scope        text NOT NULL DEFAULT 'global',
  title        text NOT NULL,
  source       text NOT NULL,
  kind         text NOT NULL DEFAULT 'note',
  key          text,
  importance   integer NOT NULL DEFAULT 60,
  confidence   integer NOT NULL DEFAULT 75,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS memory_file_project_idx ON memory_file (project_id);
CREATE INDEX IF NOT EXISTS memory_file_session_idx ON memory_file (session_id);
CREATE INDEX IF NOT EXISTS memory_file_scope_idx ON memory_file (scope);
CREATE INDEX IF NOT EXISTS memory_file_kind_idx ON memory_file (kind);
CREATE INDEX IF NOT EXISTS memory_file_key_idx ON memory_file (key);

CREATE TABLE IF NOT EXISTS memory_chunk (
  id           text PRIMARY KEY,
  file_id      text NOT NULL,
  project_id   text NOT NULL,
  content      text NOT NULL,
  token_count  integer NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  FOREIGN KEY (file_id)      REFERENCES memory_file(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id)   REFERENCES project(id)     ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS memory_chunk_file_idx    ON memory_chunk (file_id);
CREATE INDEX IF NOT EXISTS memory_chunk_project_idx ON memory_chunk (project_id);

CREATE TABLE IF NOT EXISTS memory_embedding (
  chunk_id     text PRIMARY KEY,
  embedding    blob NOT NULL,
  model        text NOT NULL,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  FOREIGN KEY (chunk_id) REFERENCES memory_chunk(id) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  content,
  chunk_id UNINDEXED,
  project_id UNINDEXED
);

-- ===== scheduler =====

CREATE TABLE IF NOT EXISTS cron_job (
  id            text PRIMARY KEY,
  project_id    text NOT NULL,
  session_id    text,
  name          text NOT NULL,
  expression    text NOT NULL,
  prompt        text NOT NULL,
  agent         text NOT NULL DEFAULT 'default',
  enabled       integer NOT NULL DEFAULT 1,
  one_shot      integer NOT NULL DEFAULT 0,
  last_run      integer,
  next_run      integer NOT NULL,
  failure_count integer NOT NULL DEFAULT 0,
  last_error    text,
  lease_until   integer NOT NULL DEFAULT 0,
  lease_owner   text,
  time_created  integer NOT NULL,
  time_updated  integer NOT NULL,
  FOREIGN KEY (project_id) REFERENCES project(id)  ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES session(id)  ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS cron_job_project_idx    ON cron_job (project_id);
CREATE INDEX IF NOT EXISTS cron_job_next_run_idx   ON cron_job (next_run);
CREATE INDEX IF NOT EXISTS cron_job_lease_until_idx ON cron_job (lease_until);

CREATE TABLE IF NOT EXISTS event_job (
  id           text PRIMARY KEY,
  project_id   text NOT NULL,
  session_id   text,
  name         text NOT NULL,
  event_type   text NOT NULL,
  match_json   text,
  prompt       text NOT NULL,
  agent        text NOT NULL DEFAULT 'default',
  enabled      integer NOT NULL DEFAULT 1,
  one_shot     integer NOT NULL DEFAULT 0,
  cooldown_ms  integer NOT NULL DEFAULT 0,
  last_run     integer,
  last_event   text,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  FOREIGN KEY (project_id) REFERENCES project(id)  ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES session(id)  ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS event_job_project_idx ON event_job (project_id);
CREATE INDEX IF NOT EXISTS event_job_type_idx    ON event_job (event_type);
CREATE INDEX IF NOT EXISTS event_job_enabled_idx ON event_job (enabled);

-- ===== session extensions =====

CREATE TABLE IF NOT EXISTS scratchpad (
  session_id   text PRIMARY KEY,
  content      text NOT NULL DEFAULT '',
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_plan (
  id           text PRIMARY KEY,
  session_id   text NOT NULL,
  parent_id    text,
  goal         text NOT NULL,
  status       text NOT NULL DEFAULT 'pending',
  priority     integer NOT NULL DEFAULT 0,
  notes        text,
  progress_pct integer NOT NULL DEFAULT 0,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS task_plan_session_idx ON task_plan (session_id);
CREATE INDEX IF NOT EXISTS task_plan_parent_idx  ON task_plan (parent_id);
CREATE INDEX IF NOT EXISTS task_plan_status_idx  ON task_plan (status);

CREATE TABLE IF NOT EXISTS goal (
  id               text PRIMARY KEY,
  session_id       text NOT NULL,
  description      text NOT NULL,
  criteria         text NOT NULL,
  verify_cmd       text,
  status           text NOT NULL DEFAULT 'active',
  priority         text NOT NULL DEFAULT 'blocking',
  max_attempts     integer NOT NULL DEFAULT 10,
  current_attempts integer NOT NULL DEFAULT 0,
  progress_log     text NOT NULL DEFAULT '[]',
  time_created     integer NOT NULL,
  time_updated     integer NOT NULL,
  FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS goal_session_idx ON goal (session_id);
CREATE INDEX IF NOT EXISTS goal_status_idx  ON goal (status);

CREATE TABLE IF NOT EXISTS a2a_task_queue (
  id               text PRIMARY KEY,
  session_id       text NOT NULL,
  prompt           text NOT NULL,
  priority         text NOT NULL DEFAULT 'normal',
  status           text NOT NULL DEFAULT 'queued',
  source           text NOT NULL DEFAULT 'api',
  retry_count      integer NOT NULL DEFAULT 0,
  max_retries      integer NOT NULL DEFAULT 3,
  previous_summary text,
  error_message    text,
  metadata         text NOT NULL DEFAULT '{}',
  time_started     integer,
  time_completed   integer,
  time_created     integer NOT NULL,
  time_updated     integer NOT NULL,
  FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS a2a_queue_session_idx  ON a2a_task_queue (session_id);
CREATE INDEX IF NOT EXISTS a2a_queue_status_idx   ON a2a_task_queue (status);
CREATE INDEX IF NOT EXISTS a2a_queue_priority_idx ON a2a_task_queue (priority, status);

-- ===== orchestrator =====

CREATE TABLE IF NOT EXISTS engine_task (
  id                     text PRIMARY KEY,
  project_id             text NOT NULL,
  session_id             text,
  -- Phase-6-f-5: active_spec_version_id cache column removed. Derive via
  -- engine_spec_snapshot.status != 'superseded' (findActiveSpecForTask in store.ts).
  -- Phase-6-f: active_plan_version_id cache column removed. Derive via
  -- engine_plan_version.status = 'active' (findActivePlanForTask in store.ts).
  -- Phase-6-f-3: active_run_id cache column removed. Derive via the newest
  -- engine_artifact kind='run' per task (findActiveRunForTask in store.ts).
  request_id             text,
  source                 text NOT NULL DEFAULT 'api',
  title                  text NOT NULL,
  request                text NOT NULL,
  attachments            text,
  system_artifacts       text NOT NULL DEFAULT '[]',
  design_specs           text NOT NULL DEFAULT '[]',
  executor               text NOT NULL DEFAULT 'opencorvus',
  criteria_results       text NOT NULL DEFAULT '[]',
  kind                   text NOT NULL DEFAULT 'workflow',
  priority               text NOT NULL DEFAULT 'normal',
  queue_order            integer NOT NULL DEFAULT 0,
  -- Phase-6-f-4: blocking_reason cache column removed. Blocking is a
  -- run-scoped signal (run.blocking_reason + pending interactions).
  error                  text,
  budget                 text,
  metadata               text,
  time_started           integer,
  time_completed         integer,
  -- rewind_cursor_time: when set, UI-facing event queries filter out rows
  -- with time_created > cursor. Append-only history stays intact; this is
  -- a projection cursor, not a delete marker. Written by rewindTask API.
  rewind_cursor_time     integer,
  rewind_cursor_event_id text,
  rewind_count           integer NOT NULL DEFAULT 0,
  time_created           integer NOT NULL,
  time_updated           integer NOT NULL,
  FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS engine_task_project_idx ON engine_task (project_id);
CREATE INDEX IF NOT EXISTS engine_task_time_completed_idx ON engine_task (time_completed);
CREATE INDEX IF NOT EXISTS engine_task_kind_idx    ON engine_task (kind);
CREATE INDEX IF NOT EXISTS engine_task_queue_order_idx ON engine_task (queue_order);
CREATE UNIQUE INDEX IF NOT EXISTS engine_task_project_request_idx
  ON engine_task (project_id, request_id);

CREATE TABLE IF NOT EXISTS engine_spec_snapshot (
  id           text PRIMARY KEY,
  task_id      text NOT NULL,
  version      integer NOT NULL DEFAULT 1,
  status       text NOT NULL DEFAULT 'ready',
  summary      text NOT NULL,
  content      text NOT NULL,
  scope        text NOT NULL DEFAULT '',
  out_of_scope text,
  evidence     text,
  metadata     text,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  FOREIGN KEY (task_id) REFERENCES engine_task(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS engine_spec_snapshot_task_idx ON engine_spec_snapshot (task_id);

CREATE TABLE IF NOT EXISTS engine_spec_item (
  id               text PRIMARY KEY,
  task_id          text NOT NULL,
  spec_snapshot_id text NOT NULL,
  title            text NOT NULL,
  description      text NOT NULL,
  status           text NOT NULL DEFAULT 'pending',
  priority         text NOT NULL DEFAULT 'blocking',
  check_selector   text,
  evidence         text,
  metadata         text,
  time_created     integer NOT NULL,
  time_updated     integer NOT NULL,
  FOREIGN KEY (task_id)          REFERENCES engine_task(id)          ON DELETE CASCADE,
  FOREIGN KEY (spec_snapshot_id) REFERENCES engine_spec_snapshot(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS engine_spec_item_task_idx     ON engine_spec_item (task_id);
CREATE INDEX IF NOT EXISTS engine_spec_item_snapshot_idx ON engine_spec_item (spec_snapshot_id);

CREATE TABLE IF NOT EXISTS engine_plan_version (
  id               text PRIMARY KEY,
  task_id          text NOT NULL,
  spec_snapshot_id text,
  version          integer NOT NULL,
  status           text NOT NULL DEFAULT 'active',
  summary          text NOT NULL,
  prompt           text NOT NULL,
  metadata         text,
  time_created     integer NOT NULL,
  time_updated     integer NOT NULL,
  FOREIGN KEY (task_id)          REFERENCES engine_task(id)          ON DELETE CASCADE,
  FOREIGN KEY (spec_snapshot_id) REFERENCES engine_spec_snapshot(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS engine_plan_task_idx ON engine_plan_version (task_id);

CREATE TABLE IF NOT EXISTS engine_milestone (
  id               text PRIMARY KEY,
  task_id          text NOT NULL,
  plan_version_id  text NOT NULL,
  title            text NOT NULL,
  description      text NOT NULL DEFAULT '',
  status           text NOT NULL DEFAULT 'pending',
  order_index      integer NOT NULL DEFAULT 0,
  metadata         text,
  time_created     integer NOT NULL,
  time_updated     integer NOT NULL,
  FOREIGN KEY (task_id)         REFERENCES engine_task(id)         ON DELETE CASCADE,
  FOREIGN KEY (plan_version_id) REFERENCES engine_plan_version(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS engine_milestone_task_idx ON engine_milestone (task_id);
CREATE INDEX IF NOT EXISTS engine_milestone_plan_idx ON engine_milestone (plan_version_id);

CREATE TABLE IF NOT EXISTS engine_goal (
  id               text PRIMARY KEY,
  task_id          text NOT NULL,
  plan_version_id  text,
  spec_snapshot_id text,
  milestone_id     text,
  title            text NOT NULL,
  slug             text NOT NULL,
  objective        text NOT NULL,
  acceptance_specs text NOT NULL DEFAULT '[]',
  owned_paths      text NOT NULL DEFAULT '[]',
  depends_on       text NOT NULL DEFAULT '[]',
  kind             text NOT NULL DEFAULT 'feature',
  requirement_ids  text NOT NULL DEFAULT '[]',
  priority         text NOT NULL DEFAULT 'blocking',
  source           text NOT NULL DEFAULT 'spec',
  -- RETIRED columns (LLM-autonomous redesign): status, cascade_state.
  -- Both were cached projections used as dispatch gates. Current state
  -- is derived live from the goal_run chain via goalStatusByID /
  -- describeGoal. Dep-failure propagation is an LLM decision, not a
  -- schema column.
  -- Phase E (2026-05-05): retry_count retired here too. Lived as a
  -- denormalised cache of the latest goal_run_attempt artifact's
  -- payload.retry_count; rule 8 (no dual source) forced the consolidation.
  -- Read via engine/store.ts:getGoalRetryCount(goalID); writers in
  -- openGoalImplementationVersion compute the bumped count from the
  -- artifact tip and persist it on the new attempt's payload only.
  -- Phase B (2026-05-05): workspace_dir / workspace_branch / workspace_base_ref
  -- retired here. Persistent goal-scoped worktree pointer lives on
  -- engine_artifact[kind='goal_run_attempt'].payload.workspace_*; callers
  -- read via engine/store.ts:findGoalLatestWorkspace(goalID). Single
  -- source eliminates the rejected-dispatch poisoning that left phantom
  -- "in-flight" rows (bench gemini 2026-05-04 reproducer).
  order_index      integer NOT NULL DEFAULT 0,
  metadata         text,
  time_created     integer NOT NULL,
  time_updated     integer NOT NULL,
  FOREIGN KEY (task_id)          REFERENCES engine_task(id)          ON DELETE CASCADE,
  FOREIGN KEY (plan_version_id)  REFERENCES engine_plan_version(id)  ON DELETE CASCADE,
  FOREIGN KEY (spec_snapshot_id) REFERENCES engine_spec_snapshot(id) ON DELETE CASCADE,
  FOREIGN KEY (milestone_id)     REFERENCES engine_milestone(id)     ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS engine_goal_task_idx      ON engine_goal (task_id);
CREATE INDEX IF NOT EXISTS engine_goal_plan_idx      ON engine_goal (plan_version_id);
CREATE INDEX IF NOT EXISTS engine_goal_milestone_idx ON engine_goal (milestone_id);

CREATE TABLE IF NOT EXISTS engine_requirement (
  id               text PRIMARY KEY,
  task_id          text NOT NULL,
  spec_snapshot_id text NOT NULL,
  title            text NOT NULL,
  description      text NOT NULL,
  status           text NOT NULL DEFAULT 'pending',
  priority         text NOT NULL DEFAULT 'blocking',
  acceptance       text NOT NULL,
  evidence_refs    text,
  non_goals        text,
  metadata         text,
  order_index      integer NOT NULL DEFAULT 0,
  time_created     integer NOT NULL,
  time_updated     integer NOT NULL,
  FOREIGN KEY (task_id)          REFERENCES engine_task(id)          ON DELETE CASCADE,
  FOREIGN KEY (spec_snapshot_id) REFERENCES engine_spec_snapshot(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS engine_requirement_task_idx ON engine_requirement (task_id);
CREATE INDEX IF NOT EXISTS engine_requirement_spec_idx ON engine_requirement (spec_snapshot_id);

-- Phase-6-f-cleanup-3: engine_goal_snapshot was never written or read — a
-- placeholder from the pre-artifact design. Deleted.

CREATE TABLE IF NOT EXISTS engine_plan_node (
  id              text PRIMARY KEY,
  task_id         text NOT NULL,
  plan_version_id text NOT NULL,
  kind            text NOT NULL,
  goal_id         text,
  title           text NOT NULL,
  brief           text NOT NULL,
  depends_on_ids  text,
  order_index     integer NOT NULL DEFAULT 0,
  metadata        text,
  time_created    integer NOT NULL,
  time_updated    integer NOT NULL,
  FOREIGN KEY (task_id)         REFERENCES engine_task(id)         ON DELETE CASCADE,
  FOREIGN KEY (plan_version_id) REFERENCES engine_plan_version(id) ON DELETE CASCADE,
  FOREIGN KEY (goal_id)         REFERENCES engine_goal(id)         ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS engine_plan_node_task_idx ON engine_plan_node (task_id);
CREATE INDEX IF NOT EXISTS engine_plan_node_plan_idx ON engine_plan_node (plan_version_id);
CREATE INDEX IF NOT EXISTS engine_plan_node_goal_idx ON engine_plan_node (goal_id);

-- Phase-6-e: engine_run was removed in favour of engine_artifact rows with
-- kind='run'. See engine/writer.ts (createRun) + engine/state.ts (updateRun)
-- for the writer and engine/store.ts (RunRow / artifactRowToRunRow /
-- latestPerRun) for the read-model. Append-only — status transitions are new
-- rows per logical run_id; findRun takes the newest via time_created desc +
-- id desc tiebreak. Other tables (engine_artifact.run_id NOT NULL,
-- engine_interaction_request.run_id, protocol_event.run_id,
-- workbench_task_note.run_id, workbench_brief_snapshot.run_id)
-- are plain text pointers now (no FK).

-- Phase-6-d: engine_goal_run was removed in favour of engine_artifact rows
-- with kind='goal_run_attempt'. See engine/persist.ts for the writer (first
-- insert uses the logical goal_run_id as artifact row id; updates append
-- new artifact rows with the same goal_run_id) and engine/store.ts
-- (GoalRunRow / artifactRowToGoalRunRow / latestPerGoalRun) for the
-- read-model. Append-only — status transitions + supersede marks are new
-- rows per logical goal_run_id; queries take the newest via
-- time_created desc. Other tables (engine_artifact.goal_run_id,
-- engine_metric_result.goal_run_id, protocol_event.goal_run_id) are plain
-- text pointers now (no FK).

CREATE TABLE IF NOT EXISTS engine_interaction_request (
  id            text PRIMARY KEY,
  task_id       text NOT NULL,
  run_id        text,
  session_id    text,
  external_id   text NOT NULL,
  request_type  text NOT NULL,
  status        text NOT NULL DEFAULT 'pending',
  title         text NOT NULL,
  body          text NOT NULL,
  payload       text,
  response      text,
  time_resolved integer,
  time_created  integer NOT NULL,
  time_updated  integer NOT NULL,
  FOREIGN KEY (task_id)    REFERENCES engine_task(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES session(id)           ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS engine_interaction_run_idx      ON engine_interaction_request (run_id);
CREATE INDEX IF NOT EXISTS engine_interaction_external_idx ON engine_interaction_request (external_id);
CREATE INDEX IF NOT EXISTS engine_interaction_status_idx   ON engine_interaction_request (status);

-- Phase-6-c: engine_delivery was removed in favour of engine_artifact rows
-- with kind='delivery'. See engine/persist.ts for the writer and
-- engine/store.ts (DeliveryRow) for the read-model. delivery_id below is
-- now a plain text pointer (no FK) to the id of the latest delivery-kind
-- artifact row for the logical delivery.

CREATE TABLE IF NOT EXISTS engine_artifact (
  id           text PRIMARY KEY,
  task_id      text NOT NULL,
  -- Phase-7+: nullable. Most artifacts still scope to a run (self-referencing
  -- for kind='run': id === run_id), but task-level facts emitted before any
  -- run exists (kind='orchestrator-stream-error' when runCount=0) have no run.
  -- Per rule 23 the schema does not enforce a state-machine invariant the
  -- orchestrator owns.
  run_id       text,
  goal_run_id  text,
  delivery_id  text,
  kind         text NOT NULL,
  label        text NOT NULL,
  payload      text,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  FOREIGN KEY (task_id)     REFERENCES engine_task(id)     ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS engine_artifact_run_idx      ON engine_artifact (run_id);
CREATE INDEX IF NOT EXISTS engine_artifact_delivery_idx ON engine_artifact (delivery_id);
CREATE INDEX IF NOT EXISTS engine_artifact_task_kind_latest_idx
  ON engine_artifact (task_id, kind, time_created DESC, id DESC);

-- Phase-6-b: engine_evaluation was removed in favour of engine_artifact rows
-- with kind='verification-evidence'. See verification/persist.ts for the writer
-- and engine/store.ts (EvaluationRow) for the read-model that reconstructs the
-- historical shape from the artifact payload.

CREATE TABLE IF NOT EXISTS engine_progress_snapshot (
  id           text PRIMARY KEY,
  task_id      text NOT NULL,
  status       text NOT NULL,
  summary      text NOT NULL,
  payload      text,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  FOREIGN KEY (task_id) REFERENCES engine_task(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS engine_progress_task_idx ON engine_progress_snapshot (task_id);

CREATE TABLE IF NOT EXISTS engine_channel_binding (
  id           text PRIMARY KEY,
  task_id      text NOT NULL,
  platform     text NOT NULL,
  channel      text NOT NULL,
  thread       text NOT NULL,
  payload      text,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  FOREIGN KEY (task_id) REFERENCES engine_task(id) ON DELETE CASCADE
);
DELETE FROM engine_channel_binding
WHERE rowid NOT IN (
  SELECT MIN(rowid)
  FROM engine_channel_binding
  GROUP BY platform, channel, thread
);
CREATE INDEX IF NOT EXISTS engine_channel_task_idx ON engine_channel_binding (task_id);
CREATE UNIQUE INDEX IF NOT EXISTS engine_channel_binding_thread_idx ON engine_channel_binding (platform, channel, thread);

-- ===== dynamic adversarial metrics =====

CREATE TABLE IF NOT EXISTS engine_metric_spec (
  id                     text PRIMARY KEY,
  task_id                text NOT NULL,
  scope                  text NOT NULL,                 -- 'goal' | 'global'
  goal_id                text,                          -- NULL iff scope='global'
  name                   text NOT NULL,
  description            text NOT NULL,
  unit                   text NOT NULL,
  direction              text NOT NULL,                 -- 'higher_better' | 'lower_better'
  target                 real NOT NULL,
  floor                  real NOT NULL,
  weight                 real NOT NULL,
  gate_class             text NOT NULL,                 -- 'blocking' | 'diagnostic' | 'efficiency'
  evaluator_kind         text NOT NULL,                 -- 'shell' | 'judge' | 'query' | 'aggregator'
  evaluator_config       text NOT NULL,                 -- JSON
  source_requirement_ids text NOT NULL DEFAULT '[]',
  source                 text NOT NULL,                 -- 'baseline' | 'challenge'
  frozen_at              integer NOT NULL,
  created_by             text NOT NULL,                 -- 'architect'
  time_created           integer NOT NULL,
  time_updated           integer NOT NULL,
  FOREIGN KEY (task_id) REFERENCES engine_task(id) ON DELETE CASCADE,
  FOREIGN KEY (goal_id) REFERENCES engine_goal(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS engine_metric_spec_task_idx   ON engine_metric_spec (task_id);
CREATE INDEX IF NOT EXISTS engine_metric_spec_scope_idx  ON engine_metric_spec (task_id, scope);
CREATE INDEX IF NOT EXISTS engine_metric_spec_source_idx ON engine_metric_spec (task_id, source);
CREATE INDEX IF NOT EXISTS engine_metric_spec_goal_idx   ON engine_metric_spec (goal_id);

CREATE TABLE IF NOT EXISTS engine_metric_result (
  id               text PRIMARY KEY,
  metric_spec_id   text NOT NULL,
  task_id          text NOT NULL,
  iteration        integer NOT NULL,
  goal_run_id      text,
  raw_value        real NOT NULL,
  normalized_value real NOT NULL,
  met_target       integer NOT NULL,
  met_floor        integer NOT NULL,
  evidence_ref     text NOT NULL,
  evidence_fresh   integer NOT NULL,
  computed_at      integer NOT NULL,
  time_created     integer NOT NULL,
  time_updated     integer NOT NULL,
  FOREIGN KEY (metric_spec_id) REFERENCES engine_metric_spec(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id)        REFERENCES engine_task(id)        ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS engine_metric_result_task_iter_idx ON engine_metric_result (task_id, iteration);
CREATE INDEX IF NOT EXISTS engine_metric_result_spec_idx      ON engine_metric_result (metric_spec_id);

CREATE TABLE IF NOT EXISTS engine_counterexample (
  id                    text PRIMARY KEY,
  task_id               text NOT NULL,
  iteration_found       integer NOT NULL,
  iteration_resolved    integer,
  novelty_hash          text NOT NULL,
  target_scope          text NOT NULL,                  -- 'goal' | 'global'
  target_ref            text NOT NULL,
  claim                 text NOT NULL,
  reproducer            text NOT NULL,
  severity              text NOT NULL,                  -- 'blocking' | 'diagnostic'
  linked_metric_spec_id text,
  time_created          integer NOT NULL,
  time_updated          integer NOT NULL,
  FOREIGN KEY (task_id)               REFERENCES engine_task(id)        ON DELETE CASCADE,
  FOREIGN KEY (linked_metric_spec_id) REFERENCES engine_metric_spec(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS engine_counterexample_task_idx    ON engine_counterexample (task_id);
CREATE INDEX IF NOT EXISTS engine_counterexample_open_idx    ON engine_counterexample (task_id, iteration_resolved);
CREATE INDEX IF NOT EXISTS engine_counterexample_novelty_idx ON engine_counterexample (task_id, novelty_hash);

CREATE TABLE IF NOT EXISTS engine_iteration (
  task_id              text NOT NULL,
  iteration            integer NOT NULL,
  aggregate_score      real NOT NULL,
  per_goal_score_json  text NOT NULL,
  global_score         real NOT NULL,
  delta_vs_prev        real NOT NULL,
  novelty_score        real NOT NULL,
  blocking_unmet_count integer NOT NULL,
  open_counterexamples integer NOT NULL,
  regressed_blocking   integer NOT NULL,
  arbiter_verdict      text NOT NULL,                   -- 'continue' | 'accept' | 'stalled' | 'abort'
  time_created         integer NOT NULL,
  time_updated         integer NOT NULL,
  PRIMARY KEY (task_id, iteration),
  FOREIGN KEY (task_id) REFERENCES engine_task(id) ON DELETE CASCADE
);

-- Frozen-ruler enforcement. Baseline metric specs are immutable once written.
-- Raising at the SQL layer catches bugs that bypass src/metrics/store.ts.
CREATE TRIGGER IF NOT EXISTS engine_metric_spec_baseline_no_update
BEFORE UPDATE ON engine_metric_spec
FOR EACH ROW
WHEN OLD.source = 'baseline'
BEGIN
  SELECT RAISE(ABORT, 'engine_metric_spec: baseline row is frozen (no UPDATE)');
END;

-- ===== decision log =====

CREATE TABLE IF NOT EXISTS decision_log (
  id           text PRIMARY KEY,
  task_id      text NOT NULL,
  goal_id      text,
  phase        text NOT NULL,
  key          text NOT NULL,
  value        text NOT NULL,
  reason       text NOT NULL,
  time_created integer NOT NULL,
  FOREIGN KEY (task_id) REFERENCES engine_task(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS decision_log_task_idx ON decision_log (task_id);
CREATE INDEX IF NOT EXISTS decision_log_task_key_idx ON decision_log (task_id, key);

-- ===== workbench =====

CREATE TABLE IF NOT EXISTS workbench_task_note (
  id           text PRIMARY KEY,
  task_id      text NOT NULL,
  run_id       text,
  kind         text NOT NULL,
  source       text NOT NULL DEFAULT 'user_message',
  user_id      text,
  content      text NOT NULL,
  metadata     text,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  FOREIGN KEY (task_id) REFERENCES engine_task(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS workbench_task_note_task_idx ON workbench_task_note (task_id);
CREATE INDEX IF NOT EXISTS workbench_task_note_run_idx  ON workbench_task_note (run_id);
CREATE INDEX IF NOT EXISTS workbench_task_note_kind_idx ON workbench_task_note (kind);

CREATE TABLE IF NOT EXISTS workbench_brief_snapshot (
  id              text PRIMARY KEY,
  task_id         text NOT NULL,
  plan_version_id text,
  run_id          text,
  content         text NOT NULL,
  inputs          text,
  time_created    integer NOT NULL,
  time_updated    integer NOT NULL,
  FOREIGN KEY (task_id)         REFERENCES engine_task(id)         ON DELETE CASCADE,
  FOREIGN KEY (plan_version_id) REFERENCES engine_plan_version(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS workbench_brief_task_idx ON workbench_brief_snapshot (task_id);
CREATE INDEX IF NOT EXISTS workbench_brief_run_idx  ON workbench_brief_snapshot (run_id);

-- ===== quick note =====

CREATE TABLE IF NOT EXISTS quick_note (
  id           text PRIMARY KEY,
  project_id   text,
  content      text NOT NULL,
  summary      text NOT NULL,
  tags         text NOT NULL DEFAULT '[]',
  status       text NOT NULL DEFAULT 'draft',
  user_id      text,
  time_created integer NOT NULL,
  time_updated integer NOT NULL
);
CREATE INDEX IF NOT EXISTS quick_note_project_idx ON quick_note (project_id);
CREATE INDEX IF NOT EXISTS quick_note_user_idx    ON quick_note (user_id);
CREATE INDEX IF NOT EXISTS quick_note_status_idx  ON quick_note (status);

-- ===== protocol event store =====

CREATE TABLE IF NOT EXISTS protocol_event (
  id              text PRIMARY KEY,
  kind            text NOT NULL,
  type            text NOT NULL,
  aggregate_type  text NOT NULL,
  aggregate_id    text NOT NULL,
  task_id         text REFERENCES engine_task(id) ON DELETE CASCADE,
  run_id          text,
  goal_run_id     text,
  session_id      text REFERENCES session(id) ON DELETE SET NULL,
  interaction_id  text REFERENCES engine_interaction_request(id) ON DELETE SET NULL,
  stream_id       text,
  source          text NOT NULL,
  target          text,
  causation_id    text,
  correlation_id  text,
  reply_to        text,
  seq             integer NOT NULL,
  deadline_ms     integer,
  emitted_at      integer NOT NULL,
  payload         text,
  time_created    integer NOT NULL,
  time_updated    integer NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS protocol_event_aggregate_seq_idx ON protocol_event (aggregate_type, aggregate_id, seq);
CREATE INDEX IF NOT EXISTS protocol_event_task_idx        ON protocol_event (task_id, seq);
CREATE INDEX IF NOT EXISTS protocol_event_run_idx         ON protocol_event (run_id, seq);
CREATE INDEX IF NOT EXISTS protocol_event_session_idx     ON protocol_event (session_id, seq);
CREATE INDEX IF NOT EXISTS protocol_event_interaction_idx ON protocol_event (interaction_id, seq);
CREATE INDEX IF NOT EXISTS protocol_event_stream_idx      ON protocol_event (stream_id, seq);
CREATE INDEX IF NOT EXISTS protocol_event_type_idx        ON protocol_event (type);

CREATE TABLE IF NOT EXISTS protocol_inbox (
  id           text PRIMARY KEY,
  envelope_id  text NOT NULL REFERENCES protocol_event(id) ON DELETE CASCADE,
  actor        text NOT NULL,
  actor_id     text NOT NULL,
  status       text NOT NULL DEFAULT 'pending',
  lease_owner  text,
  lease_until  integer,
  attempt      integer NOT NULL DEFAULT 0,
  visible_at   integer NOT NULL,
  last_error   text,
  time_created integer NOT NULL,
  time_updated integer NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS protocol_inbox_envelope_actor_idx ON protocol_inbox (envelope_id, actor, actor_id);
CREATE INDEX IF NOT EXISTS protocol_inbox_visible_idx              ON protocol_inbox (actor, status, visible_at);
CREATE INDEX IF NOT EXISTS protocol_inbox_lease_idx                ON protocol_inbox (actor, lease_until);

`
