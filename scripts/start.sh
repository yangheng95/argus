#!/usr/bin/env bash
# start.sh — Start OpenCorvus server with overlay UI.
#
# Usage:
#   ./scripts/start.sh                    # foreground, default port 7878
#   ./scripts/start.sh --bg               # background daemon
#   ./scripts/start.sh --port 9000        # custom port
#   ./scripts/start.sh --host 0.0.0.0     # listen on all interfaces
#   ./scripts/start.sh --overlay          # also launch Tauri desktop overlay
#   ./scripts/start.sh --stop             # kill running instance

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OC_DIR="$ROOT/packages/opencorvus"
LOG_FILE="$ROOT/tmp-api.log"
ERR_FILE="$ROOT/tmp-api.err.log"
PID_FILE="$ROOT/tmp-api.pid"
BUN="C:/Users/hengu/.bun/bin/bun.exe"

HOST="127.0.0.1"
PORT="7878"
BG=0
OVERLAY=0
STOP=0

if [[ ! -x "$BUN" ]]; then
  BUN="bun"
fi

while [[ $# -gt 0 ]]; do
  case $1 in
    --bg|--background) BG=1; shift ;;
    --port)   PORT="${2:?'--port requires a value'}"; shift 2 ;;
    --host)   HOST="${2:?'--host requires a value'}"; shift 2 ;;
    --overlay) OVERLAY=1; shift ;;
    --stop)   STOP=1; shift ;;
    -h|--help)
      cat <<'HELP'
Usage: start.sh [OPTIONS]

Options:
  --bg         run server in background
  --port PORT  server port (default: 7878)
  --host HOST  listen address (default: 127.0.0.1)
  --overlay    also launch Tauri desktop overlay
  --stop       kill running opencorvus server
  -h, --help   show this help

Examples:
  ./scripts/start.sh --bg
  ./scripts/start.sh --bg --overlay
  ./scripts/start.sh --port 9000 --host 0.0.0.0
  ./scripts/start.sh --stop
HELP
      exit 0
      ;;
    *)
      echo "ERROR: Unknown option '$1'" >&2
      echo "Run '$0 --help' for usage." >&2
      exit 1
      ;;
  esac
done

# ── Stop ──

stop_port() {
  local port="$1"
  local pids
  if [[ "$(uname -s)" == MINGW* || "$(uname -s)" == MSYS* ]]; then
    pids="$(cmd.exe /c "netstat -ano -p tcp | findstr :$port | findstr LISTENING" 2>/dev/null \
      | tr -d '\r' | awk '{print $5}' | sort -u)" || true
    while IFS= read -r pid; do
      [[ -z "$pid" || "$pid" == "0" ]] && continue
      cmd.exe /c "taskkill /F /PID $pid" >/dev/null 2>&1 || true
    done <<< "$pids"
  else
    fuser -k "$port/tcp" 2>/dev/null || true
  fi
}

if [[ "$STOP" == "1" ]]; then
  echo "Stopping opencorvus on port $PORT ..."
  stop_port "$PORT"
  rm -f "$PID_FILE"
  echo "Done."
  exit 0
fi

# ── Pre-flight ──

echo "Checking port $PORT ..."
stop_port "$PORT"
sleep 1

: > "$LOG_FILE"
: > "$ERR_FILE"

wait_http() {
  local url="$1" timeout="$2" start elapsed
  start="$(date +%s)"
  while true; do
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      return 0
    fi
    elapsed=$(( $(date +%s) - start ))
    if (( elapsed >= timeout )); then
      return 1
    fi
    printf "\r  waiting for server ... %ds" "$elapsed"
    sleep 0.5
  done
}

# ── Start server ──

echo "Starting opencorvus server on $HOST:$PORT ..."

if [[ "$BG" == "1" ]]; then
  (
    cd "$OC_DIR"
    nohup "$BUN" --preload @opentui/solid/preload --conditions=browser \
      ./src/index.ts serve --hostname "$HOST" --port "$PORT" \
      >"$LOG_FILE" 2>"$ERR_FILE" </dev/null &
    echo $! > "$PID_FILE"
  )
  SERVER_PID="$(cat "$PID_FILE")"

  if ! wait_http "http://$HOST:$PORT/project" 30; then
    echo ""
    echo "ERROR: Server failed to start within 30s." >&2
    echo "--- stderr (last 30 lines) ---" >&2
    tail -n 30 "$ERR_FILE" >&2
    echo "--- stdout (last 10 lines) ---" >&2
    tail -n 10 "$LOG_FILE" >&2
    exit 1
  fi
  printf "\r                              \r"

  echo ""
  echo "========================================="
  echo "  OpenCorvus started (background)"
  echo "========================================="
  echo "  API:        http://$HOST:$PORT"
  echo "  Overlay UI: http://$HOST:$PORT/ui/"
  echo "  PID:        $SERVER_PID"
  echo "  Log:        $LOG_FILE"
  echo "  Err:        $ERR_FILE"
  echo "========================================="
  echo ""
  echo "  Stop:  ./scripts/start.sh --stop"
  echo ""

  # ── Optional: launch Tauri overlay ──
  if [[ "$OVERLAY" == "1" ]]; then
    TAURI_DIR="$ROOT/packages/overlay/src-tauri"
    if [[ -d "$TAURI_DIR" ]]; then
      TAURI_BIN="$TAURI_DIR/target/release/opencorvus-overlay.exe"
      if [[ -f "$TAURI_BIN" ]]; then
        echo "Launching Tauri overlay (prebuilt) ..."
        "$TAURI_BIN" &
      else
        echo "Tauri overlay not built yet, running cargo build --release ..."
        echo "(This may take a few minutes on first run)"
        (cd "$TAURI_DIR" && cargo run --release) &
      fi
    else
      echo "WARNING: Tauri overlay directory not found at $TAURI_DIR"
      echo "  The overlay UI is still available in browser at http://$HOST:$PORT/ui/"
    fi
  fi
else
  echo ""
  echo "========================================="
  echo "  OpenCorvus (foreground)"
  echo "========================================="
  echo "  API:        http://$HOST:$PORT"
  echo "  Overlay UI: http://$HOST:$PORT/ui/"
  echo "========================================="
  echo "  Press Ctrl+C to stop"
  echo ""

  if [[ "$OVERLAY" == "1" ]]; then
    TAURI_DIR="$ROOT/packages/overlay/src-tauri"
    if [[ -d "$TAURI_DIR" ]]; then
      TAURI_BIN="$TAURI_DIR/target/release/opencorvus-overlay.exe"
      if [[ -f "$TAURI_BIN" ]]; then
        echo "Launching Tauri overlay (prebuilt) ..."
        "$TAURI_BIN" &
      else
        echo "Tauri overlay not built yet, running cargo build --release ..."
        (cd "$TAURI_DIR" && cargo run --release) &
      fi
    fi
  fi

  cd "$OC_DIR"
  exec "$BUN" --preload @opentui/solid/preload --conditions=browser \
    ./src/index.ts serve --hostname "$HOST" --port "$PORT"
fi
