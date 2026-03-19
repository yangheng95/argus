#!/usr/bin/env bash
# monitor-prd-bench.sh — 每30秒轮询一次PRD benchmark状态，追加写到日志文件
# Usage: bash script/benchmark/monitor-prd-bench.sh >> /tmp/prd-bench-monitor.log 2>&1 &

TASK_ID="tsk_d04c0ea09001z1nIee0ukiEVDL"
PROJECT_DIR="C:/Users/chuan/AppData/Local/Temp/opencorvus-overlay-benchmark-project-BUirqo"
DB="C:/Users/chuan/.local/share/opencorvus/opencorvus.db"
REPORT_GLOB="C:/Users/chuan/myhexin-local/argus-opencode/packages/opencorvus/overlay-web-benchmark-report-*.json"

poll() {
  local ts
  ts=$(date '+%H:%M:%S')
  echo ""
  echo "========== $ts =========="

  # 1. bun 进程
  local bun_pids
  bun_pids=$(wmic process where "name='bun.exe'" get processid 2>/dev/null | grep -E '^[0-9]+' | tr -d ' \r' | tr '\n' ' ')
  echo "[bun] pids=$bun_pids"

  # 2. task 状态
  local task_status spec_id plan_id
  task_status=$(bun -e "
import { Database } from 'bun:sqlite';
const db = new Database('$DB', { readonly: true });
const t = db.query(\"SELECT status, active_spec_version_id, active_plan_version_id FROM orchestrator_task WHERE id='$TASK_ID'\").get();
if (t) console.log(t.status + '|' + (t.active_spec_version_id||'') + '|' + (t.active_plan_version_id||''));
" 2>/dev/null)
  echo "[task] $task_status"

  # 3. goals
  local goals
  goals=$(bun -e "
import { Database } from 'bun:sqlite';
const db = new Database('$DB', { readonly: true });
const gs = db.query(\"SELECT id, description, status, priority FROM orchestrator_goal WHERE task_id='$TASK_ID' ORDER BY order_index ASC\").all();
gs.forEach(g => console.log(g.status + ' | ' + g.priority + ' | ' + (g.description||'').slice(0,60)));
" 2>/dev/null)
  if [ -n "$goals" ]; then
    echo "[goals]"
    echo "$goals" | while read line; do echo "  $line"; done
  else
    echo "[goals] (none yet)"
  fi

  # 4. active run
  local run
  run=$(bun -e "
import { Database } from 'bun:sqlite';
const db = new Database('$DB', { readonly: true });
const r = db.query(\"SELECT id, status, phase, error FROM orchestrator_run WHERE task_id='$TASK_ID' ORDER BY time_created DESC LIMIT 1\").get();
if (r) console.log(r.status + '/' + r.phase + ' err=' + (r.error||''));
" 2>/dev/null)
  [ -n "$run" ] && echo "[run] $run"

  # 5. 项目文件
  local file_count
  file_count=$(find "$PROJECT_DIR" -not -path "*/.git/*" -type f 2>/dev/null | grep -v "\.json$\|\.toml$\|\.lock$" | wc -l)
  echo "[files] non-config files in project dir: $file_count"
  if [ "$file_count" -gt 3 ]; then
    find "$PROJECT_DIR" -not -path "*/.git/*" -type f 2>/dev/null | grep -v "\.json$\|\.toml$\|\.lock$" | head -20 | while read f; do
      echo "  $f"
    done
  fi

  # 6. 最新报告
  local latest_report
  latest_report=$(ls -t $REPORT_GLOB 2>/dev/null | grep -v events | head -1)
  if [ -n "$latest_report" ]; then
    local rts
    rts=$(basename "$latest_report" | sed 's/overlay-web-benchmark-report-//;s/\.json//')
    echo "[report] latest=$rts"
  fi
}

echo "=== PRD Benchmark Monitor started at $(date) ==="
echo "=== Task: $TASK_ID ==="

while true; do
  poll
  sleep 30
done
