#!/usr/bin/env bash
# Usage: inspect-db.sh <task_id>
# Prints DB state for a completed benchmark run: task, goals, goal_runs,
# deliveries, evaluations, and the invariants the Phase 1-7 refactor enforces.
set -e
TASK="${1:?usage: inspect-db.sh <task_id>}"

# Benchmark uses isolated OPENCORVUS_HOME under /tmp/mirrorcode-overlay-benchmark-home-*
# Find the most recent one that contains our task.
for db in $(ls -t /tmp/mirrorcode-overlay-benchmark-home-*/data/opencorvus.db 2>/dev/null); do
  cnt=$(sqlite3 "$db" "SELECT count(*) FROM engine_task WHERE id='$TASK'" 2>/dev/null || echo 0)
  if [ "$cnt" = "1" ]; then
    DB="$db"; break
  fi
done
if [ -z "$DB" ]; then
  echo "No DB contains task $TASK" >&2
  exit 1
fi
echo "DB=$DB"
echo ""

echo "=== TASK ==="
sqlite3 -cmd ".mode line" "$DB" "SELECT id, status, source, substr(error,1,300) AS error, datetime(time_created/1000,'unixepoch') AS created, datetime(time_completed/1000,'unixepoch') AS completed FROM engine_task WHERE id='$TASK'"
echo ""
echo "=== GOALS ==="
sqlite3 -cmd ".mode column" "$DB" "SELECT id, substr(title,1,40) AS title, status, retry_count FROM engine_goal WHERE task_id='$TASK' ORDER BY order_index"
echo ""
echo "=== GOAL RUNS (incl supersede_of) ==="
sqlite3 -cmd ".mode column" "$DB" "SELECT id, goal_id, status, coalesce(supersede_of,'') AS supersedes, substr(coalesce(error,''),1,60) AS error FROM engine_goal_run WHERE task_id='$TASK' ORDER BY time_created"
echo ""
echo "=== DELIVERIES ==="
sqlite3 -cmd ".mode column" "$DB" "SELECT id, status, substr(summary,1,60) AS summary FROM engine_delivery WHERE task_id='$TASK' ORDER BY time_created"
echo ""
echo "=== EVALUATIONS (should be 1:1 with deliveries) ==="
sqlite3 -cmd ".mode column" "$DB" "SELECT id, delivery_id, status, verdict, substr(summary,1,60) AS summary FROM engine_evaluation WHERE task_id='$TASK' ORDER BY time_created"
echo ""

echo "=== INVARIANT 1: delivery count == evaluation count ==="
D=$(sqlite3 "$DB" "SELECT count(*) FROM engine_delivery WHERE task_id='$TASK'")
E=$(sqlite3 "$DB" "SELECT count(*) FROM engine_evaluation WHERE task_id='$TASK'")
echo "  deliveries=$D evaluations=$E $([ "$D" = "$E" ] && echo "PASS" || echo "FAIL")"

echo "=== INVARIANT 2: deliveries w/o evaluation row ==="
sqlite3 "$DB" "SELECT d.id FROM engine_delivery d LEFT JOIN engine_evaluation e ON e.delivery_id=d.id WHERE d.task_id='$TASK' AND e.id IS NULL"

echo "=== INVARIANT 3: goal.status vs goal_run tip (Phase 4 derivation) ==="
sqlite3 "$DB" "
WITH tips AS (
  SELECT gr.* FROM engine_goal_run gr
  WHERE gr.task_id='$TASK'
    AND NOT EXISTS (SELECT 1 FROM engine_goal_run x WHERE x.supersede_of=gr.id)
  ORDER BY time_created DESC
)
SELECT g.id AS goal_id, g.status AS goal_status,
  (SELECT status FROM tips WHERE goal_id=g.id LIMIT 1) AS tip_status
FROM engine_goal g WHERE g.task_id='$TASK'"

echo "=== INVARIANT 4: supersede chain has no cycles and no dangling references ==="
sqlite3 "$DB" "
SELECT r.id, r.supersede_of AS missing_parent
FROM engine_goal_run r
LEFT JOIN engine_goal_run p ON p.id=r.supersede_of
WHERE r.task_id='$TASK' AND r.supersede_of IS NOT NULL AND p.id IS NULL"

echo "=== PROGRESS SNAPSHOTS (tail 10) ==="
sqlite3 -cmd ".mode column" -cmd ".width 20 10 70" "$DB" "SELECT datetime(time_created/1000,'unixepoch') AS t, status, substr(summary,1,70) AS summary FROM engine_progress_snapshot WHERE task_id='$TASK' ORDER BY time_created DESC LIMIT 10"
