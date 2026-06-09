import { Database } from "bun:sqlite"

const TASK = process.env.TASK_ID ?? "tsk_ddc67008f001pRQAXurqfkwPtT"
const DB =
  process.env.OPENCORVUS_DB ??
  "D:/myhexin-local/argus/packages/overlay/dist/opencorvus-overlay-windows-x64/.opencorvus/opencorvus.db"
const db = new Database(DB, { readonly: true })

function show(label: string, sql: string) {
  console.log(`\n===== ${label} =====`)
  try {
    const rows = db.query(sql).all()
    console.log(JSON.stringify(rows, null, 2))
  } catch (e) {
    console.log("ERR", (e as Error).message)
  }
}

show(
  "engine_task",
  `SELECT id, title, session_id, time_created, time_updated, time_completed, error FROM engine_task WHERE id = '${TASK}'`,
)
show(
  "plan_versions",
  `SELECT id, version, status, summary, time_created, time_updated FROM engine_plan_version WHERE task_id = '${TASK}' ORDER BY version`,
)
show(
  "goals",
  `SELECT id, title, kind, plan_version_id, retry_count, order_index, workspace_branch, time_updated FROM engine_goal WHERE task_id = '${TASK}' ORDER BY order_index`,
)
show(
  "milestones",
  `SELECT id, plan_version_id, status, title, order_index, time_updated FROM engine_milestone WHERE task_id = '${TASK}' ORDER BY order_index`,
)
show(
  "iterations",
  `SELECT iteration, aggregate_score, blocking_unmet_count, regressed_blocking, arbiter_verdict, time_updated FROM engine_iteration WHERE task_id = '${TASK}' ORDER BY iteration`,
)
show(
  "workflow_steps",
  `SELECT type, source, emitted_at, json_extract(payload,'$.stepID') AS step_id, json_extract(payload,'$.status') AS step_status, json_extract(payload,'$.summary') AS summary FROM protocol_event WHERE task_id = '${TASK}' AND type='workflow.step.updated' ORDER BY emitted_at`,
)
show(
  "recent_non_stream_events_60",
  `SELECT type, source, emitted_at FROM protocol_event WHERE task_id = '${TASK}' AND source <> 'session.bridge' ORDER BY emitted_at DESC LIMIT 80`,
)
show(
  "integrity_events",
  `SELECT type, source, emitted_at, payload FROM protocol_event WHERE task_id = '${TASK}' AND (type LIKE 'integrity%' OR source LIKE 'architect.integrity%') ORDER BY emitted_at`,
)
show(
  "artifacts",
  `SELECT id, run_id, goal_run_id, kind, label, time_created FROM engine_artifact WHERE task_id = '${TASK}' ORDER BY time_created`,
)
show(
  "sessions",
  `WITH RECURSIVE st(id) AS (SELECT session_id FROM engine_task WHERE id='${TASK}' UNION ALL SELECT s.id FROM session s JOIN st ON s.parent_id = st.id) SELECT s.id, s.parent_id, s.kind, s.goal_id, s.title, s.directory, s.time_created, s.time_updated FROM session s JOIN st ON s.id = st.id ORDER BY s.time_created`,
)
show(
  "orchestrator_messages_finish_dist",
  `WITH RECURSIVE st(id) AS (SELECT session_id FROM engine_task WHERE id='${TASK}' UNION ALL SELECT s.id FROM session s JOIN st ON s.parent_id = st.id) SELECT json_extract(m.data,'$.agent') AS agent, json_extract(m.data,'$.finish') AS finish, json_extract(m.data,'$.role') AS role, COUNT(*) AS n FROM message m JOIN st ON m.session_id = st.id GROUP BY agent, finish, role ORDER BY n DESC`,
)
show(
  "recent_messages",
  `WITH RECURSIVE st(id) AS (SELECT session_id FROM engine_task WHERE id='${TASK}' UNION ALL SELECT s.id FROM session s JOIN st ON s.parent_id = st.id) SELECT m.id, m.session_id, json_extract(m.data,'$.role') AS role, json_extract(m.data,'$.agent') AS agent, json_extract(m.data,'$.finish') AS finish, json_extract(m.data,'$.tokens.total') AS total_tokens, m.time_created, m.time_updated FROM message m JOIN st ON m.session_id = st.id ORDER BY m.time_created DESC LIMIT 60`,
)
show(
  "event_counts_by_type",
  `SELECT type, source, COUNT(*) AS n, MIN(emitted_at) AS first_at, MAX(emitted_at) AS last_at FROM protocol_event WHERE task_id='${TASK}' GROUP BY type, source ORDER BY last_at DESC LIMIT 60`,
)
show(
  "error_or_failed_events",
  `SELECT type, source, emitted_at, substr(payload,1,500) AS payload_preview FROM protocol_event WHERE task_id='${TASK}' AND (type LIKE '%error%' OR type LIKE '%failed%' OR type LIKE '%abort%' OR payload LIKE '%error%' OR payload LIKE '%failed%') ORDER BY emitted_at DESC LIMIT 30`,
)
