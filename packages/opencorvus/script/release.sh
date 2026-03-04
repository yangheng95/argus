#!/usr/bin/env bash
# release.sh — Build all platforms locally and publish binaries to a clean GitHub repo.
#
# The release repo (--release-repo) should contain ONLY README.md on its main
# branch. Binaries are published as GitHub Release assets (zip / tar.gz).
# No source code is ever pushed to the release repo.
#
# Usage (run from packages/opencorvus):
#   bash script/release.sh --version 1.2.3 --release-repo owner/repo
#
# Options:
#   --version <x.y.z>          Release version (required)
#   --release-repo <owner/repo> Target repo for release assets (required)
#   --ref <branch>             Git ref to build overlays from (default: current branch)
#   --run-id <id>              Re-use an existing overlay CI run instead of triggering
#   --overlay-dir <dir>        Use prebuilt overlays instead of CI build (skips CI)
#   --work-dir <dir>           Temp work directory (default: /tmp/oc-release-<version>)
#   --skip-install             Skip `bun install` for native cross-platform deps
#   --no-upload                Build everything but do NOT upload to GitHub Release

set -euo pipefail

# ── Parse arguments ───────────────────────────────────────────────────────────

VERSION=""
RELEASE_REPO=""
REF="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "dev")"
RUN_ID=""
OVERLAY_DIR=""
WORK_DIR=""
SKIP_INSTALL=0
NO_UPLOAD=0
POLL_INTERVAL=30

while [[ $# -gt 0 ]]; do
  case $1 in
    --version)      VERSION="${2:?'--version requires a value'}";       shift 2 ;;
    --release-repo) RELEASE_REPO="${2:?'--release-repo requires a value'}"; shift 2 ;;
    --ref)          REF="${2:?'--ref requires a value'}";               shift 2 ;;
    --run-id)       RUN_ID="${2:?'--run-id requires a value'}";         shift 2 ;;
    --overlay-dir)  OVERLAY_DIR="${2:?'--overlay-dir requires a value'}"; shift 2 ;;
    --work-dir)     WORK_DIR="${2:?'--work-dir requires a value'}";     shift 2 ;;
    --skip-install) SKIP_INSTALL=1;     shift   ;;
    --no-upload)    NO_UPLOAD=1;        shift   ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

[[ -z "$VERSION" ]]      && { echo "Error: --version is required"; exit 1; }
[[ -z "$RELEASE_REPO" ]] && { echo "Error: --release-repo is required (e.g. owner/repo)"; exit 1; }

# ── Setup ────────────────────────────────────────────────────────────────────

export SSL_CERT_FILE="${SSL_CERT_FILE:-/usr/ssl/certs/ca-bundle.crt}"
gh_cmd()  { SSL_CERT_FILE="$SSL_CERT_FILE" gh "$@"; }
curl_cmd(){ SSL_CERT_FILE="$SSL_CERT_FILE" curl "$@"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORK_DIR="${WORK_DIR:-/tmp/oc-release-${VERSION}}"
mkdir -p "$WORK_DIR"

SOURCE_REPO="$(git remote get-url origin 2>/dev/null \
  | sed 's|.*github.com[:/]\(.*\)\.git|\1|;s|.*github.com[:/]\(.*\)|\1|')"

echo "════════════════════════════════════════════════════════"
echo "  OpenCorvus Release Builder"
echo "  version       : $VERSION"
echo "  source repo   : $SOURCE_REPO"
echo "  release repo  : $RELEASE_REPO"
echo "  ref           : $REF"
echo "  work dir      : $WORK_DIR"
[[ "$NO_UPLOAD" == "1" ]] && echo "  mode          : --no-upload (build only)"
echo "════════════════════════════════════════════════════════"
echo ""

OVERLAY_STAGED="$WORK_DIR/overlays-staged"

# ── 1. Overlay CI Build (skip if --overlay-dir provided) ─────────────────────

if [[ -n "$OVERLAY_DIR" ]]; then
  echo "⏭  Using prebuilt overlay dir: $OVERLAY_DIR"
  OVERLAY_STAGED="$OVERLAY_DIR"

else
  WORKFLOW="build-overlays.yml"

  if [[ -z "$RUN_ID" ]]; then
    echo "▶ Triggering $WORKFLOW on $SOURCE_REPO ref=$REF ..."
    TRIGGER_OUT=$(gh_cmd workflow run "$WORKFLOW" --repo "$SOURCE_REPO" --ref "$REF" 2>&1)
    echo "$TRIGGER_OUT"

    RUN_URL=$(echo "$TRIGGER_OUT" | grep -Eo 'https://github.com/[^ ]+/actions/runs/[0-9]+' | head -1)
    if [[ -n "$RUN_URL" ]]; then
      RUN_ID="${RUN_URL##*/}"
    else
      sleep 6
      RUN_ID=$(gh_cmd run list --repo "$SOURCE_REPO" --workflow="$WORKFLOW" \
                 --branch="$REF" --limit=1 --json databaseId --jq '.[0].databaseId')
    fi
    echo "  Run ID : $RUN_ID"
    echo "  URL    : https://github.com/$SOURCE_REPO/actions/runs/$RUN_ID"
  fi

  echo ""
  echo "⏳ Waiting for overlay build run $RUN_ID ..."
  while true; do
    INFO=$(gh_cmd run view "$RUN_ID" --repo "$SOURCE_REPO" \
             --json status,conclusion \
             --jq '[.status,.conclusion//"-"] | join(" ")' 2>/dev/null || echo "unknown -")
    STATUS="${INFO%% *}"
    CONCLUSION="${INFO##* }"

    if [[ "$STATUS" == "completed" ]]; then
      if [[ "$CONCLUSION" == "success" ]]; then
        echo "✓ Overlay build succeeded"
        break
      else
        echo "✗ Overlay build $CONCLUSION"
        echo "  https://github.com/$SOURCE_REPO/actions/runs/$RUN_ID"
        exit 1
      fi
    fi

    echo -n "  [$(date +%H:%M:%S)] $STATUS  "
    gh_cmd run view "$RUN_ID" --repo "$SOURCE_REPO" --json jobs \
      --jq '.jobs[] | "\(.name | split(" ")[1])=\(.conclusion // .status)"' \
      2>/dev/null | tr '\n' ' ' || true
    echo ""
    sleep "$POLL_INTERVAL"
  done

  echo ""
  echo "⬇ Downloading overlay artifacts ..."
  OVERLAYS_RAW="$WORK_DIR/overlays-raw"
  mkdir -p "$OVERLAYS_RAW"

  for platform in linux-x64 linux-arm64 darwin-arm64 darwin-x64 windows-x64; do
    gh_cmd run download "$RUN_ID" --repo "$SOURCE_REPO" \
      -n "overlay-$platform" -D "$OVERLAYS_RAW/overlay-$platform" \
      || { echo "  Warning: overlay-$platform not found, skipping"; }
  done

  echo ""
  echo "🔧 Staging overlay binaries ..."
  mkdir -p "$OVERLAY_STAGED"
  install -m755 "$OVERLAYS_RAW/overlay-linux-x64/opencorvus-overlay"    "$OVERLAY_STAGED/opencorvus-overlay-linux-x64"
  install -m755 "$OVERLAYS_RAW/overlay-linux-arm64/opencorvus-overlay"  "$OVERLAY_STAGED/opencorvus-overlay-linux-arm64"
  install -m755 "$OVERLAYS_RAW/overlay-darwin-arm64/opencorvus-overlay" "$OVERLAY_STAGED/opencorvus-overlay-darwin-arm64"
  install -m755 "$OVERLAYS_RAW/overlay-darwin-x64/opencorvus-overlay"   "$OVERLAY_STAGED/opencorvus-overlay-darwin-x64"
  cp             "$OVERLAYS_RAW/overlay-windows-x64/opencorvus-overlay.exe" \
                 "$OVERLAY_STAGED/opencorvus-overlay-windows-x64.exe"
  echo "  Staged:"
  ls -lh "$OVERLAY_STAGED/"
fi

# ── 2. Fetch models.dev snapshot ─────────────────────────────────────────────

MODELS_JSON="$WORK_DIR/models-api-clean.json"
echo ""
echo "⬇ Fetching models.dev snapshot ..."
curl_cmd -fsSL https://models.dev/api.json | tr -d '\n\r' > "$MODELS_JSON"
echo "  Saved to $MODELS_JSON ($(wc -c < "$MODELS_JSON") bytes)"

# ── 3. Pre-create GitHub Release (before build so upload succeeds) ────────────

if [[ "$NO_UPLOAD" == "0" ]]; then
  echo ""
  echo "📦 Creating GitHub Release v$VERSION on $RELEASE_REPO ..."
  gh_cmd release create "v${VERSION}" \
    --title "v${VERSION}" \
    --generate-notes \
    --repo "$RELEASE_REPO" || true
fi

# ── 4. Build all platforms locally ───────────────────────────────────────────

echo ""
echo "🔨 Building all platforms locally ..."
cd "$PKG_DIR"

BUILD_ARGS=("--all")
[[ "$SKIP_INSTALL" == "1" ]] && BUILD_ARGS+=("--skip-install")

if [[ "$NO_UPLOAD" == "1" ]]; then
  # Build only, no release upload
  env \
    SSL_CERT_FILE="$SSL_CERT_FILE" \
    MODELS_DEV_API_JSON="$MODELS_JSON" \
    OPENCORVUS_OVERLAY_BIN_DIR="$OVERLAY_STAGED" \
    OPENCORVUS_VERSION="$VERSION" \
    OPENCORVUS_CHANNEL="latest" \
    bun run script/build.ts "${BUILD_ARGS[@]}"
else
  # Build AND upload release assets to RELEASE_REPO
  env \
    SSL_CERT_FILE="$SSL_CERT_FILE" \
    MODELS_DEV_API_JSON="$MODELS_JSON" \
    OPENCORVUS_OVERLAY_BIN_DIR="$OVERLAY_STAGED" \
    OPENCORVUS_RELEASE="1" \
    OPENCORVUS_VERSION="$VERSION" \
    OPENCORVUS_CHANNEL="latest" \
    GH_REPO="$RELEASE_REPO" \
    bun run script/build.ts "${BUILD_ARGS[@]}"
fi

# ── 5. Summary ───────────────────────────────────────────────────────────────

echo ""
echo "━━━ dist/ contents ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
for d in dist/*/; do
  name=$(basename "$d")
  files=$(ls "$d/bin/" 2>/dev/null | grep -v '\.map$' | tr '\n' ' ')
  echo "  $name/bin/  $files"
done
echo ""

if [[ "$NO_UPLOAD" == "1" ]]; then
  echo "⚠  --no-upload: binaries built to dist/ but NOT uploaded."
  echo "   Run without --no-upload to publish, or upload manually:"
  echo "   gh release upload v$VERSION ./dist/*.zip ./dist/*.tar.gz --clobber --repo $RELEASE_REPO"
else
  echo "🎉 Released!"
  echo "   https://github.com/$RELEASE_REPO/releases/tag/v$VERSION"
fi
