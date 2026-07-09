# 2026-07-09 GitHub Overlay Package CI

## Recall

| Item | Evidence |
| --- | --- |
| User request | Sync latest local code to GitHub, make the GitHub repository public, and ensure a unified-version overlay package can be produced. |
| Acceptance | GitHub has the latest `v0.0.2beta` code, repository visibility is public, and the official `build.yml` workflow can reach overlay package artifacts for `darwin-arm64`, `darwin-x64`, Linux, and Windows. |
| Hard constraints | No fallback/retry masking; fix CI tooling when it fails; do not reset user code; push git-cc and GitHub; keep package versions unified. |
| Records and docs read | `docs/packaging.md`, `.github/workflows/build.yml`, `.github/workflows/build-overlays.yml`, `.github/actions/setup-bun/action.yml`, `script/check-release-assets.ts`, `script/release-asset-contract.ts`, `specs/records/2026-07/README.md`. |
| Full grep | `rg -n "setup-bun\|workflow\|GitHub Actions\|actions/setup\|bun install\|HUSKY\|action\\.yml" .github packages script specs`; `rg -n ".github/actions/setup-bun\|setup-bun/action.yml\|action.yml" packages/opencorvus/test packages/overlay/test packages`. |
| Secret/public check | `bun run script/secret-scan.ts` passed with 0 tracked-source hits before making the GitHub repository public. |
| GitHub run evidence | `build.yml` run `28994589511` checked out commit `3ee9bec1c92b86091163d33c68ca8dcc02f77139`, then stalled inside `.github/actions/setup-bun` at `bun install` after `Resolved, downloaded and extracted [297]`; cancellation left orphan process `bun`. |
| Local reproduction boundary | `HUSKY=0 bun install --frozen-lockfile --no-progress` completed locally without file changes. |

## Root Cause

The official GitHub package workflow uses the repository-local `.github/actions/setup-bun` composite action. Its install step ran plain `bun install`, which executes the repository root lifecycle and therefore invokes `prepare: husky`. On the GitHub runner the install step reached the lifecycle phase and then remained silent until cancellation, leaving a live Bun process. This is a CI toolchain defect in dependency setup, not an overlay package failure.

## Repair

Make the CI dependency install deterministic and non-interactive:

- use `bun install --frozen-lockfile --no-progress` so the workflow consumes the committed lockfile and avoids progress UI noise;
- set `HUSKY=0` only for the install step, because Git hook installation is not part of package construction inside GitHub Actions;
- keep `actions/setup-node@v6`, `actions/cache@v6`, and `oven-sh/setup-bun@v2` unchanged.

This is not a fallback path: there remains one install command and one lockfile source. The change removes a local developer hook side effect from CI package construction.

## Verification

- `bun run script/secret-scan.ts`
- `HUSKY=0 bun install --frozen-lockfile --no-progress`
- `bun test packages/opencorvus/test/script/document-health.test.ts -t "repository GitHub workflows use current action majors"`
- Re-run `gh workflow run build.yml --repo yangheng95/opencorvus --ref v0.0.2beta` and verify overlay artifacts.
