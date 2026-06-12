#!/bin/sh
set -eu

OPENCORVUS_BIN="${OPENCORVUS_BIN:-/opt/opencorvus/opencorvus}"
OPENCORVUS_PROJECT_DIR="${OPENCORVUS_PROJECT_DIR:-/workspace}"
OPENCORVUS_HOSTNAME="${OPENCORVUS_HOSTNAME:-0.0.0.0}"
OPENCORVUS_PORT="${PORT:-${OPENCORVUS_PORT:-7878}}"

log() {
  printf '[opencorvus-entrypoint] %s\n' "$*" >&2
}

log "starting"
log "binary=$OPENCORVUS_BIN"
log "project_dir=$OPENCORVUS_PROJECT_DIR"
log "hostname=$OPENCORVUS_HOSTNAME"
log "port=$OPENCORVUS_PORT"
log "pwd=$(pwd)"
log "uid=$(id -u 2>/dev/null || true) gid=$(id -g 2>/dev/null || true)"
log "kernel=$(uname -a 2>/dev/null || true)"

if command -v ldd >/dev/null 2>&1; then
  ldd --version 2>&1 | head -n 1 >&2 || true
fi

if command -v file >/dev/null 2>&1; then
  file "$OPENCORVUS_BIN" >&2 || true
fi

if [ ! -f "$OPENCORVUS_BIN" ]; then
  log "fatal: binary does not exist"
  exit 127
fi

if [ ! -x "$OPENCORVUS_BIN" ]; then
  log "fatal: binary is not executable"
  ls -l "$OPENCORVUS_BIN" >&2 || true
  exit 126
fi

mkdir -p "$OPENCORVUS_PROJECT_DIR" /root/.opencorvus

log "version probe"
"$OPENCORVUS_BIN" --version >&2

if [ "$#" -gt 0 ]; then
  log "exec custom command: $*"
  exec "$OPENCORVUS_BIN" "$@"
fi

log "exec default server"
exec "$OPENCORVUS_BIN" serve \
  --project-dir "$OPENCORVUS_PROJECT_DIR" \
  --hostname "$OPENCORVUS_HOSTNAME" \
  --port "$OPENCORVUS_PORT" \
  --print-logs
