import { Database } from "bun:sqlite";
const db = new Database("C:\\Users\\hengu\\.local\\share\\opencorvus\\opencorvus.db", { readonly: true });
const TASK = "tsk_e670bb4e4001mRna3llmJpE0Mt";
const GOAL_G12 = "gol_e674506a500c8ouWcRju2QENlG";

function q(label: string, sql: string) {
  console.log("\n===", label, "===");
  const rows = db.query(sql).all();
  for (const r of rows) console.log(JSON.stringify(r));
}

q("G12 goal_run_attempt timeline", `
SELECT goal_run_id, run_id,
       json_extract(payload,'$.goal_id') AS goal_id,
       json_extract(payload,'$.status') AS status,
       json_extract(payload,'$.retry_count') AS retry_count,
       json_extract(payload,'$.blocking_reason') AS blocking,
       json_extract(payload,'$.superseded_reason') AS superseded,
       substr(coalesce(json_extract(payload,'$.error'), ''), 1, 240) AS error,
       json_extract(payload,'$.workspace_branch') AS branch,
       time_created
FROM engine_artifact
WHERE task_id='${TASK}' AND kind='goal_run_attempt'
  AND json_extract(payload,'$.goal_id')='${GOAL_G12}'
ORDER BY time_created;
`);

q("G12 run snapshots", `
SELECT run_id,
       json_extract(payload,'$.status') AS status,
       json_extract(payload,'$.phase') AS phase,
       json_extract(payload,'$.executor') AS executor,
       json_extract(payload,'$.session_id') AS session_id,
       json_extract(payload,'$.blocking_reason') AS blocking,
       substr(coalesce(json_extract(payload,'$.error'), ''), 1, 240) AS error,
       time_created
FROM engine_artifact
WHERE task_id='${TASK}' AND kind='run'
ORDER BY time_created DESC LIMIT 25;
`);

q("Recent orchestrator-stream-error", `
SELECT id, run_id, goal_run_id,
       substr(coalesce(json_extract(payload,'$.error'), ''),1,400) AS error,
       json_extract(payload,'$.phase') AS phase,
       time_created
FROM engine_artifact
WHERE task_id='${TASK}' AND kind='orchestrator-stream-error'
ORDER BY time_created DESC LIMIT 25;
`);

q("G12 sessions", `
WITH RECURSIVE st(id) AS (
  SELECT session_id FROM engine_task WHERE id='${TASK}'
  UNION ALL SELECT s.id FROM session s JOIN st ON s.parent_id=st.id
)
SELECT s.id, s.parent_id, s.kind, s.goal_id, s.title, s.time_created, s.time_updated
FROM session s JOIN st ON s.id=st.id
WHERE s.goal_id='${GOAL_G12}' OR s.title LIKE '%G12%' OR s.title LIKE '%Fibonacci%'
ORDER BY s.time_created;
`);

q("Latest 40 messages in G12-related sessions", `
WITH RECURSIVE st(id) AS (
  SELECT session_id FROM engine_task WHERE id='${TASK}'
  UNION ALL SELECT s.id FROM session s JOIN st ON s.parent_id=st.id
), gsess AS (
  SELECT s.id FROM session s JOIN st ON s.id=st.id
  WHERE s.goal_id='${GOAL_G12}'
)
SELECT m.id, m.session_id,
       json_extract(m.data,'$.role') AS role,
       json_extract(m.data,'$.agent') AS agent,
       json_extract(m.data,'$.finish') AS finish,
       json_extract(m.data,'$.tokens.total') AS total_tokens,
       m.time_created
FROM message m JOIN gsess ON m.session_id=gsess.id
ORDER BY m.time_created DESC LIMIT 40;
`);

q("Recent tool parts for G12 (last 60)", `
WITH RECURSIVE st(id) AS (
  SELECT session_id FROM engine_task WHERE id='${TASK}'
  UNION ALL SELECT s.id FROM session s JOIN st ON s.parent_id=st.id
), gsess AS (
  SELECT s.id FROM session s JOIN st ON s.id=st.id
  WHERE s.goal_id='${GOAL_G12}'
)
SELECT p.id, p.message_id, p.session_id,
       json_extract(p.data,'$.type') AS part_type,
       json_extract(p.data,'$.tool') AS tool,
       json_extract(p.data,'$.state.status') AS tool_status,
       substr(coalesce(json_extract(p.data,'$.state.title'), ''),1,80) AS title,
       p.time_created
FROM part p JOIN gsess ON p.session_id=gsess.id
ORDER BY p.time_created DESC LIMIT 60;
`);

q("Recent task protocol events (skip session.bridge)", `
SELECT type, source, emitted_at, run_id, goal_run_id,
       substr(coalesce(payload,''),1,160) AS payload_head
FROM protocol_event
WHERE task_id='${TASK}' AND source<>'session.bridge'
ORDER BY emitted_at DESC LIMIT 60;
`);

db.close();
