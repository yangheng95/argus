#!/usr/bin/env bash
set -euo pipefail

LISTEN_HOST="${1:-127.0.0.1}"
FRONTEND_PORT="${2:-3000}"
BACKEND_PORT="${3:-7879}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT/packages/console/app"
BACKEND_DIR="$ROOT/packages/opencorvus"
FRONTEND_LOG="$ROOT/tmp-console.log"
FRONTEND_ERR="$ROOT/tmp-console.err.log"
BACKEND_LOG="$ROOT/tmp-opencorvus.log"
BACKEND_ERR="$ROOT/tmp-opencorvus.err.log"
BUN="C:/Users/hengu/.bun/bin/bun.exe"

if [[ ! -x "$BUN" ]]; then
  BUN="bun"
fi

reset_log() {
  : > "$1"
}

stop_port() {
  local port="$1"
  local pids
  pids="$(cmd.exe /c "netstat -ano -p tcp | findstr :$port | findstr LISTENING" 2>/dev/null | tr -d '\r' | awk '{print $5}' | sort -u)"
  if [[ -z "$pids" ]]; then
    return
  fi
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    cmd.exe /c "taskkill /F /PID $pid" >/dev/null 2>&1 || true
  done <<< "$pids"
}

wait_http() {
  local url="$1"
  local timeout="$2"
  local start
  start="$(date +%s)"
  while true; do
    if curl -fsS --max-time 3 "$url" >/dev/null 2>&1; then
      return 0
    fi
    if (( "$(date +%s)" - start >= timeout )); then
      return 1
    fi
    sleep 0.5
  done
}

tail_log() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  tail -n 40 "$file"
}

start_backend() {
  (
    cd "$BACKEND_DIR"
    nohup "$BUN" --preload @opentui/solid/preload --conditions=browser ./src/index.ts serve --hostname "$LISTEN_HOST" --port "$BACKEND_PORT" \
      >"$BACKEND_LOG" 2>"$BACKEND_ERR" < /dev/null &
    echo $!
  )
}

start_frontend() {
  (
    cd "$FRONTEND_DIR"
    OPENCORVUS_BOARD_URL="http://$LISTEN_HOST:$BACKEND_PORT" \
      nohup "$BUN" run dev >"$FRONTEND_LOG" 2>"$FRONTEND_ERR" < /dev/null &
    echo $!
  )
}

reset_log "$FRONTEND_LOG"
reset_log "$FRONTEND_ERR"
reset_log "$BACKEND_LOG"
reset_log "$BACKEND_ERR"

stop_port "$FRONTEND_PORT"
stop_port 7878
stop_port "$BACKEND_PORT"
sleep 2

BACKEND_PID="$(start_backend)"
if ! wait_http "http://$LISTEN_HOST:$BACKEND_PORT/project" 45; then
  echo "Backend failed to start on http://$LISTEN_HOST:$BACKEND_PORT" >&2
  tail_log "$BACKEND_ERR" >&2
  exit 1
fi

FRONTEND_PID="$(start_frontend)"
if ! wait_http "http://$LISTEN_HOST:$FRONTEND_PORT/tasks" 45; then
  echo "Frontend failed to start on http://$LISTEN_HOST:$FRONTEND_PORT" >&2
  tail_log "$FRONTEND_ERR" >&2
  exit 1
fi

echo
echo "Panel restarted."
echo "Frontend: http://$LISTEN_HOST:$FRONTEND_PORT/tasks"
echo "Backend:  http://$LISTEN_HOST:$BACKEND_PORT"
echo "Frontend PID: $FRONTEND_PID"
echo "Backend PID:  $BACKEND_PID"
