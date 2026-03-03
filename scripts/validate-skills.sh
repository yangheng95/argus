#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SKILL_DIR="$ROOT_DIR/.opencorvus/skill"
CODEX_HOME_DIR=${CODEX_HOME:-"$HOME/.codex"}
VALIDATOR="$CODEX_HOME_DIR/skills/.system/skill-creator/scripts/quick_validate.py"
TMP_DIR="$ROOT_DIR/.tmp-py"

if [ ! -d "$SKILL_DIR" ]; then
  echo "Skill directory not found: $SKILL_DIR" >&2
  exit 1
fi

if [ ! -f "$VALIDATOR" ]; then
  echo "Validator not found: $VALIDATOR" >&2
  exit 1
fi

mkdir -p "$TMP_DIR"
export TMPDIR="$TMP_DIR"
export TEMP="$TMP_DIR"
export TMP="$TMP_DIR"

PY_MODE=""
if command -v python3 >/dev/null 2>&1; then
  PY_MODE="python3"
elif command -v python >/dev/null 2>&1; then
  PY_MODE="python"
elif command -v py >/dev/null 2>&1; then
  PY_MODE="py"
else
  echo "Python not found. Install python3, python, or py launcher." >&2
  exit 1
fi

run_py() {
  if [ "$PY_MODE" = "py" ]; then
    py -3 "$@"
    return
  fi
  "$PY_MODE" "$@"
}

if ! run_py -m pip --version >/dev/null 2>&1; then
  run_py -m ensurepip --upgrade
fi

run_py -m pip install --upgrade pyyaml

found=0
ok=0
fail=0

for dir in "$SKILL_DIR"/opencorvus-*-bot-config; do
  if [ ! -d "$dir" ]; then
    continue
  fi
  found=$((found + 1))
  name=$(basename "$dir")
  echo "=== $name ==="
  if run_py "$VALIDATOR" "$dir"; then
    ok=$((ok + 1))
  else
    fail=$((fail + 1))
  fi
done

if [ "$found" -eq 0 ]; then
  echo "No bot skills found under: $SKILL_DIR" >&2
  exit 1
fi

echo "Skill validation done: $ok passed, $fail failed."

if [ "$fail" -gt 0 ]; then
  exit 1
fi
