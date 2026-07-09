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
| GitHub run evidence | `build.yml` run `28994589511` checked out commit `3ee9bec1c92b86091163d33c68ca8dcc02f77139`, then stalled inside `.github/actions/setup-bun` at `bun install` after `Resolved, downloaded and extracted [297]`; cancellation left orphan process `bun`. Run `28995089473` confirmed `HUSKY=0 bun install --frozen-lockfile --no-progress` still stalled at the same point before any `$ husky` output. Run `28995448238` confirmed `--ignore-scripts` still stalled at the same point, making install scripts insufficient as the root cause. Run `28995724703` confirmed `--backend=copyfile` also stalled at the same point, making Bun's default hardlink backend insufficient as the root cause. |
| Local reproduction boundary | `HUSKY=0 bun install --frozen-lockfile --no-progress` completed locally without file changes, but CI evidence proved Husky was not the whole root cause. `HUSKY=0 bun install --frozen-lockfile --no-progress --ignore-scripts` also completed locally without file changes. `HUSKY=0 bun install --frozen-lockfile --no-progress --ignore-scripts --backend=copyfile` completed locally without file changes, but CI run `28995724703` proved the package workflow still must isolate jobs that do not need dependency installation from the shared install action. |

## Root Cause

The official GitHub package workflow uses the repository-local `.github/actions/setup-bun` composite action. Its install step ran plain `bun install`, which uses Bun's default install backend and allows install-script lifecycle work after dependency extraction. On the GitHub runner the step repeatedly reached the post-extraction boundary and then remained silent until cancellation, leaving a live Bun process. Follow-up runs with `HUSKY=0`, `--ignore-scripts`, and `--backend=copyfile` all stalled at the same boundary. The proven root cause in the first blocked job is that `prepare` reused a dependency-install action even though its real responsibility is version resolution and `script/sync-version.ts`, which only needs the Bun runtime and built-in APIs. That is a CI workflow responsibility bug, not an overlay package failure.

## Repair

Make the CI setup responsibilities explicit:

- add a single `install_dependencies` input to `.github/actions/setup-bun`, defaulting to dependency installation for build and test jobs;
- set `install_dependencies: "false"` only in `build.yml`'s `prepare` job, whose steps only need Bun to read and update package version files;
- use `bun install --frozen-lockfile --no-progress --ignore-scripts --backend=copyfile` so the workflow consumes the committed lockfile, avoids progress UI noise, does not enter package install-script lifecycle work before build commands, and avoids the GitHub runner hardlink backend hang;
- set `HUSKY=0` only for the install step, because Git hook installation is not part of package construction inside GitHub Actions;
- apply the same install contract to the Linux musl Docker build command in `build.yml`, which otherwise has a second raw `bun install` path;
- keep `actions/setup-node@v6`, `actions/cache@v6`, and `oven-sh/setup-bun@v2` unchanged.

This is not a fallback path: there remains one dependency install command and one lockfile source for jobs that need dependencies. The `prepare` job no longer performs unrelated install work before version metadata can be emitted. Build-time scripts remain explicit package commands such as `bun run script/build.ts`; implicit dependency install scripts are not part of the overlay package contract.

## Verification

- `bun run script/secret-scan.ts`
- `HUSKY=0 bun install --frozen-lockfile --no-progress`
- `HUSKY=0 bun install --frozen-lockfile --no-progress --ignore-scripts`
- `HUSKY=0 bun install --frozen-lockfile --no-progress --ignore-scripts --backend=copyfile`
- `bun test packages/opencorvus/test/script/document-health.test.ts -t "repository GitHub workflows use current action majors"`
- Re-run `gh workflow run build.yml --repo yangheng95/opencorvus --ref v0.0.2beta` and verify overlay artifacts.
