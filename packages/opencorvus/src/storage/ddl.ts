/**
 * Consolidated DDL for OpenCorvus.
 *
 * All tables use CREATE TABLE IF NOT EXISTS so the schema is idempotent —
 * safe to run on every startup whether the DB is fresh or already populated.
 *
 * When you need to add a new table, just add it here. No migration directory needed.
 * When you need to alter an existing table (add column, etc.), add a guarded
 * ALTER TABLE statement to SCHEMA_MIGRATIONS at the bottom.
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
  share_url          text,
  summary_additions  integer,
  summary_deletions  integer,
  summary_files      integer,
  summary_diffs      text,
  revert             text,
  permission         text,
  time_created       integer NOT NULL,
  time_updated       integer NOT NULL,
  time_compacting    integer,
  time_archived      integer,
  FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS session_project_idx ON session (project_id);
CREATE INDEX IF NOT EXISTS session_parent_idx  ON session (parent_id);

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
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS memory_file_project_idx ON memory_file (project_id);

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

CREATE TABLE IF NOT EXISTS orchestrator_task (
  id                     text PRIMARY KEY,
  project_id             text NOT NULL,
  session_id             text,
  active_plan_version_id text,
  active_run_id          text,
  request_id             text,
  source                 text NOT NULL DEFAULT 'api',
  title                  text NOT NULL,
  request                text NOT NULL,
  status                 text NOT NULL DEFAULT 'queued',
  priority               text NOT NULL DEFAULT 'normal',
  blocking_reason        text,
  error                  text,
  budget                 text,
  metadata               text,
  time_started           integer,
  time_completed         integer,
  time_created           integer NOT NULL,
  time_updated           integer NOT NULL,
  FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS orchestrator_task_project_idx ON orchestrator_task (project_id);
CREATE INDEX IF NOT EXISTS orchestrator_task_status_idx  ON orchestrator_task (status);
CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_task_project_request_idx
  ON orchestrator_task (project_id, request_id);

CREATE TABLE IF NOT EXISTS orchestrator_plan_version (
  id           text PRIMARY KEY,
  task_id      text NOT NULL,
  version      integer NOT NULL,
  status       text NOT NULL DEFAULT 'active',
  summary      text NOT NULL,
  prompt       text NOT NULL,
  metadata     text,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  FOREIGN KEY (task_id) REFERENCES orchestrator_task(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS orchestrator_plan_task_idx ON orchestrator_plan_version (task_id);

CREATE TABLE IF NOT EXISTS orchestrator_milestone (
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
  FOREIGN KEY (task_id)         REFERENCES orchestrator_task(id)         ON DELETE CASCADE,
  FOREIGN KEY (plan_version_id) REFERENCES orchestrator_plan_version(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS orchestrator_milestone_task_idx ON orchestrator_milestone (task_id);
CREATE INDEX IF NOT EXISTS orchestrator_milestone_plan_idx ON orchestrator_milestone (plan_version_id);

CREATE TABLE IF NOT EXISTS orchestrator_goal (
  id              text PRIMARY KEY,
  task_id         text NOT NULL,
  plan_version_id text NOT NULL,
  milestone_id    text,
  description     text NOT NULL,
  criteria        text NOT NULL,
  metadata        text,
  priority        text NOT NULL DEFAULT 'blocking',
  status          text NOT NULL DEFAULT 'pending',
  order_index     integer NOT NULL DEFAULT 0,
  time_created    integer NOT NULL,
  time_updated    integer NOT NULL,
  FOREIGN KEY (task_id)         REFERENCES orchestrator_task(id)         ON DELETE CASCADE,
  FOREIGN KEY (plan_version_id) REFERENCES orchestrator_plan_version(id) ON DELETE CASCADE,
  FOREIGN KEY (milestone_id)    REFERENCES orchestrator_milestone(id)    ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS orchestrator_goal_task_idx      ON orchestrator_goal (task_id);
CREATE INDEX IF NOT EXISTS orchestrator_goal_plan_idx      ON orchestrator_goal (plan_version_id);
CREATE INDEX IF NOT EXISTS orchestrator_goal_milestone_idx ON orchestrator_goal (milestone_id);

CREATE TABLE IF NOT EXISTS orchestrator_run (
  id              text PRIMARY KEY,
  task_id         text NOT NULL,
  plan_version_id text,
  session_id      text,
  executor        text NOT NULL DEFAULT 'opencode',
  status          text NOT NULL DEFAULT 'queued',
  phase           text NOT NULL DEFAULT 'execute',
  blocking_reason text,
  error           text,
  retry_count     integer NOT NULL DEFAULT 0,
  executor_ref    text,
  metadata        text,
  time_started    integer,
  time_completed  integer,
  time_created    integer NOT NULL,
  time_updated    integer NOT NULL,
  FOREIGN KEY (task_id)         REFERENCES orchestrator_task(id)         ON DELETE CASCADE,
  FOREIGN KEY (plan_version_id) REFERENCES orchestrator_plan_version(id) ON DELETE SET NULL,
  FOREIGN KEY (session_id)      REFERENCES session(id)                   ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS orchestrator_run_task_idx   ON orchestrator_run (task_id);
CREATE INDEX IF NOT EXISTS orchestrator_run_status_idx ON orchestrator_run (status);

CREATE TABLE IF NOT EXISTS orchestrator_interaction_request (
  id            text PRIMARY KEY,
  task_id       text NOT NULL,
  run_id        text NOT NULL,
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
  FOREIGN KEY (task_id)    REFERENCES orchestrator_task(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id)     REFERENCES orchestrator_run(id)  ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES session(id)           ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS orchestrator_interaction_run_idx      ON orchestrator_interaction_request (run_id);
CREATE INDEX IF NOT EXISTS orchestrator_interaction_external_idx ON orchestrator_interaction_request (external_id);
CREATE INDEX IF NOT EXISTS orchestrator_interaction_status_idx   ON orchestrator_interaction_request (status);

CREATE TABLE IF NOT EXISTS orchestrator_delivery (
  id           text PRIMARY KEY,
  task_id      text NOT NULL,
  run_id       text NOT NULL,
  status       text NOT NULL DEFAULT 'ready',
  summary      text NOT NULL,
  result       text,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  FOREIGN KEY (task_id) REFERENCES orchestrator_task(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id)  REFERENCES orchestrator_run(id)  ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS orchestrator_delivery_run_idx ON orchestrator_delivery (run_id);

CREATE TABLE IF NOT EXISTS orchestrator_artifact (
  id           text PRIMARY KEY,
  task_id      text NOT NULL,
  run_id       text NOT NULL,
  delivery_id  text,
  kind         text NOT NULL,
  label        text NOT NULL,
  payload      text,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  FOREIGN KEY (task_id)     REFERENCES orchestrator_task(id)     ON DELETE CASCADE,
  FOREIGN KEY (run_id)      REFERENCES orchestrator_run(id)      ON DELETE CASCADE,
  FOREIGN KEY (delivery_id) REFERENCES orchestrator_delivery(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS orchestrator_artifact_run_idx      ON orchestrator_artifact (run_id);
CREATE INDEX IF NOT EXISTS orchestrator_artifact_delivery_idx ON orchestrator_artifact (delivery_id);

CREATE TABLE IF NOT EXISTS orchestrator_evaluation (
  id             text PRIMARY KEY,
  task_id        text NOT NULL,
  run_id         text NOT NULL,
  delivery_id    text,
  status         text NOT NULL DEFAULT 'pending',
  verdict        text NOT NULL DEFAULT 'inconclusive',
  summary        text NOT NULL,
  checks         text,
  time_completed integer,
  time_created   integer NOT NULL,
  time_updated   integer NOT NULL,
  FOREIGN KEY (task_id)     REFERENCES orchestrator_task(id)     ON DELETE CASCADE,
  FOREIGN KEY (run_id)      REFERENCES orchestrator_run(id)      ON DELETE CASCADE,
  FOREIGN KEY (delivery_id) REFERENCES orchestrator_delivery(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS orchestrator_evaluation_run_idx ON orchestrator_evaluation (run_id);

CREATE TABLE IF NOT EXISTS orchestrator_progress_snapshot (
  id           text PRIMARY KEY,
  task_id      text NOT NULL,
  status       text NOT NULL,
  summary      text NOT NULL,
  payload      text,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  FOREIGN KEY (task_id) REFERENCES orchestrator_task(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS orchestrator_progress_task_idx ON orchestrator_progress_snapshot (task_id);

CREATE TABLE IF NOT EXISTS orchestrator_executor_session (
  id               text PRIMARY KEY,
  task_id          text NOT NULL,
  run_id           text NOT NULL,
  provider         text NOT NULL,
  protocol         text NOT NULL,
  protocol_version text NOT NULL,
  transport        text NOT NULL,
  status           text NOT NULL DEFAULT 'active',
  refs             text,
  capabilities     text,
  settings         text,
  time_started     integer,
  time_completed   integer,
  time_created     integer NOT NULL,
  time_updated     integer NOT NULL,
  FOREIGN KEY (task_id) REFERENCES orchestrator_task(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id)  REFERENCES orchestrator_run(id)  ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS orchestrator_executor_session_task_idx ON orchestrator_executor_session (task_id);
CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_executor_session_run_idx ON orchestrator_executor_session (run_id);
CREATE INDEX IF NOT EXISTS orchestrator_executor_session_status_idx ON orchestrator_executor_session (status);

CREATE TABLE IF NOT EXISTS orchestrator_executor_event (
  id                  text PRIMARY KEY,
  executor_session_id text NOT NULL,
  task_id             text NOT NULL,
  run_id              text NOT NULL,
  sequence            integer NOT NULL,
  kind                text NOT NULL,
  summary             text,
  refs                text,
  payload             text,
  raw                 text,
  time_observed       integer NOT NULL,
  time_created        integer NOT NULL,
  time_updated        integer NOT NULL,
  FOREIGN KEY (executor_session_id) REFERENCES orchestrator_executor_session(id) ON DELETE CASCADE,
  FOREIGN KEY (task_id)             REFERENCES orchestrator_task(id)             ON DELETE CASCADE,
  FOREIGN KEY (run_id)              REFERENCES orchestrator_run(id)              ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS orchestrator_executor_event_session_idx ON orchestrator_executor_event (executor_session_id, sequence);
CREATE INDEX IF NOT EXISTS orchestrator_executor_event_run_idx ON orchestrator_executor_event (run_id, sequence);
CREATE INDEX IF NOT EXISTS orchestrator_executor_event_task_idx ON orchestrator_executor_event (task_id, sequence);
CREATE INDEX IF NOT EXISTS orchestrator_executor_event_kind_idx ON orchestrator_executor_event (kind);

CREATE TABLE IF NOT EXISTS orchestrator_channel_binding (
  id           text PRIMARY KEY,
  task_id      text NOT NULL,
  platform     text NOT NULL,
  channel      text NOT NULL,
  thread       text NOT NULL,
  payload      text,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  FOREIGN KEY (task_id) REFERENCES orchestrator_task(id) ON DELETE CASCADE
);
DELETE FROM orchestrator_channel_binding
WHERE rowid NOT IN (
  SELECT MIN(rowid)
  FROM orchestrator_channel_binding
  GROUP BY platform, channel, thread
);
CREATE INDEX IF NOT EXISTS orchestrator_channel_task_idx ON orchestrator_channel_binding (task_id);
CREATE UNIQUE INDEX IF NOT EXISTS orchestrator_channel_binding_thread_idx ON orchestrator_channel_binding (platform, channel, thread);

-- ===== workbench =====

CREATE TABLE IF NOT EXISTS workbench_preference (
  id           text PRIMARY KEY,
  project_id   text,
  task_id      text,
  session_id   text,
  user_id      text,
  scope        text NOT NULL DEFAULT 'global',
  key          text NOT NULL,
  value        text NOT NULL,
  source       text NOT NULL DEFAULT 'user_message',
  confidence   integer NOT NULL DEFAULT 100,
  time_created integer NOT NULL,
  time_updated integer NOT NULL,
  FOREIGN KEY (project_id) REFERENCES project(id)           ON DELETE CASCADE,
  FOREIGN KEY (task_id)    REFERENCES orchestrator_task(id)  ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS workbench_preference_project_idx ON workbench_preference (project_id);
CREATE INDEX IF NOT EXISTS workbench_preference_task_idx    ON workbench_preference (task_id);
CREATE INDEX IF NOT EXISTS workbench_preference_user_idx    ON workbench_preference (user_id);
CREATE INDEX IF NOT EXISTS workbench_preference_key_idx     ON workbench_preference (key);

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
  FOREIGN KEY (task_id) REFERENCES orchestrator_task(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id)  REFERENCES orchestrator_run(id)  ON DELETE SET NULL
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
  FOREIGN KEY (task_id)         REFERENCES orchestrator_task(id)         ON DELETE CASCADE,
  FOREIGN KEY (plan_version_id) REFERENCES orchestrator_plan_version(id) ON DELETE SET NULL,
  FOREIGN KEY (run_id)          REFERENCES orchestrator_run(id)          ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS workbench_brief_task_idx ON workbench_brief_snapshot (task_id);
CREATE INDEX IF NOT EXISTS workbench_brief_run_idx  ON workbench_brief_snapshot (run_id);

`
