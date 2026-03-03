#!/usr/bin/env bash
# Build all platforms via GitHub Actions and download the result.
#
# Usage:
#   ./script/build-ci.sh [--out <dir>] [--ref <branch>] [--run-id <id>]
#
# Options:
#   --out   Download destination (default: ./dist-ci)
#   --ref   Git ref to build (default: current branch)
#   --run-id  Skip triggering, just download an existing run

set -euo pipefail

REPO="yangheng95/argus"
WORKFLOW="build.yml"
OUT_DIR="./dist-ci"
REF=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "dev")
RUN_ID=""
POLL_INTERVAL=30

while [[ $# -gt 0 ]]; do
  case $1 in
    --out)    OUT_DIR="$2"; shift 2 ;;
    --ref)    REF="$2";     shift 2 ;;
    --run-id) RUN_ID="$2";  shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

SSL_CERT_FILE="${SSL_CERT_FILE:-/usr/ssl/certs/ca-bundle.crt}"
export SSL_CERT_FILE

gh_cmd() { SSL_CERT_FILE="$SSL_CERT_FILE" gh "$@"; }

# ── 1. Trigger or reuse ───────────────────────────────────────────────────────
if [[ -z "$RUN_ID" ]]; then
  echo "▶ Triggering $WORKFLOW on ref=$REF ..."
  TRIGGER_OUT=$(gh_cmd workflow run "$WORKFLOW" --ref "$REF" 2>&1)
  echo "$TRIGGER_OUT"

  # Extract run URL from trigger output, then resolve run ID
  RUN_URL=$(echo "$TRIGGER_OUT" | grep -Eo 'https://github.com/[^ ]+/actions/runs/[0-9]+' | head -1)
  if [[ -n "$RUN_URL" ]]; then
    RUN_ID="${RUN_URL##*/}"
  else
    # Fallback: find the most recent run for this workflow + ref
    sleep 5
    RUN_ID=$(gh_cmd run list --workflow="$WORKFLOW" --branch="$REF" --limit=1 --json databaseId --jq '.[0].databaseId')
  fi
  echo "  Run ID: $RUN_ID"
  echo "  URL: https://github.com/$REPO/actions/runs/$RUN_ID"
fi

# ── 2. Poll until done ────────────────────────────────────────────────────────
echo ""
echo "⏳ Waiting for run $RUN_ID to complete ..."
while true; do
  STATUS=$(gh_cmd run view "$RUN_ID" --json status,conclusion --jq '[.status,.conclusion] | join(" ")' 2>/dev/null || echo "unknown")
  STATUS_PART="${STATUS%% *}"
  CONCLUSION_PART="${STATUS##* }"

  if [[ "$STATUS_PART" == "completed" ]]; then
    if [[ "$CONCLUSION_PART" == "success" ]]; then
      echo "✓ Build succeeded"
      break
    else
      echo "✗ Build failed (conclusion=$CONCLUSION_PART)"
      echo "  See: https://github.com/$REPO/actions/runs/$RUN_ID"
      exit 1
    fi
  fi

  # Print current job statuses while waiting
  echo -n "  [$(date +%H:%M:%S)] status=$STATUS_PART  jobs: "
  gh_cmd run view "$RUN_ID" --json jobs \
    --jq '.jobs[] | "\(.name)=\(.conclusion // .status)"' 2>/dev/null \
    | tr '\n' ' ' || true
  echo ""

  sleep "$POLL_INTERVAL"
done

# ── 3. Download opencorvus-dist ───────────────────────────────────────────────
echo ""
echo "⬇ Downloading opencorvus-dist → $OUT_DIR ..."
mkdir -p "$OUT_DIR"
gh_cmd run download "$RUN_ID" -n opencorvus-dist -D "$OUT_DIR"

echo ""
echo "✓ Done. Contents:"
for platform_dir in "$OUT_DIR"/*/; do
  name=$(basename "$platform_dir")
  files=$(ls "$platform_dir/bin/" 2>/dev/null | grep -v '\.map$' | tr '\n' ' ')
  echo "  $name/bin/  $files"
done
echo ""
echo "Run URL: https://github.com/$REPO/actions/runs/$RUN_ID"
