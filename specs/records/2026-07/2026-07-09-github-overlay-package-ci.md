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
| GitHub run evidence | `build.yml` run `28994589511` checked out commit `3ee9bec1c92b86091163d33c68ca8dcc02f77139`, then stalled inside `.github/actions/setup-bun` at `bun install` after `Resolved, downloaded and extracted [297]`; cancellation left orphan process `bun`. Run `28995089473` confirmed `HUSKY=0 bun install --frozen-lockfile --no-progress` still stalled at the same point before any `$ husky` output. Run `28995448238` confirmed `--ignore-scripts` still stalled at the same point, making install scripts insufficient as the root cause. Run `28995724703` confirmed `--backend=copyfile` also stalled at the same point, making Bun's default hardlink backend insufficient as the root cause. Run `28997326936` confirmed `--network-concurrency=8` still remained silent after `Resolved, downloaded and extracted [297]` until cancellation, including on Linux x64 and Linux arm64 overlay jobs. Run `28998703262` confirmed `--network-concurrency=1` also remained silent for about 18 minutes after `[297]` across Linux, macOS, and Windows jobs, so network concurrency was not the root cause. Run `29001176500` proved `setup-bun` and frozen install completed on all package jobs, then exposed the next build-contract failure: CLI and overlay-server builds could not resolve `@opencorvus-ai/sdk` because the SDK package exports `dist/*` and CI had not explicitly built that dist surface. Run `29002496208` proved the explicit SDK build step runs before package builds, then exposed the next package-host contract failure: CLI and overlay-server jobs failed in `packages/opencorvus/script/build-runtime-binaries.ts` because runner PATH did not provide the `rg` executable that both package surfaces embed under `bin/rg`. |
| Local reproduction boundary | `HUSKY=0 bun install --frozen-lockfile --no-progress` completed locally without file changes, but CI evidence proved Husky was not the whole root cause. `HUSKY=0 bun install --frozen-lockfile --no-progress --ignore-scripts` also completed locally without file changes. `HUSKY=0 bun install --frozen-lockfile --no-progress --ignore-scripts --backend=copyfile` completed locally against a warm Bun cache, but CI run `28995724703` and a local empty-cache repro both proved the cold-cache path still hangs after extraction. The local empty-cache repro emitted `Fail extracting tarball` for `@esbuild/win32-x64`, `@img/sharp-win32-x64`, `turbo-windows-64`, and `lucide-solid`, then kept the `bun install` process alive. |

## Root Cause

The official GitHub package workflow uses the repository-local `.github/actions/setup-bun` composite action. Its install step ran plain `bun install`, which uses Bun's default install backend and allows install-script lifecycle work after dependency extraction. On the GitHub runner the step repeatedly reached the post-extraction boundary and then remained silent until cancellation, leaving a live Bun process. Follow-up runs with `HUSKY=0`, `--ignore-scripts`, `--backend=copyfile`, `--network-concurrency=8`, and `--network-concurrency=1` all stalled at the same boundary. Splitting `prepare` proved the version-metadata job did not need dependency installation, then run `28996274564` proved every package job still stalled in `bun install`.

The deeper root cause was the lockfile source: `bun.lock` had 1658 package tarball URLs pinned to `http://repositories.myhexin.com:8081/repository/npm-public/...`. That internal registry is not a valid source for public GitHub-hosted runners. Re-generating the lockfile from public npm changed hundreds of package versions, so the correct repair is not dependency refresh. Bun lockfile v1 accepts an empty resolved URL string in the tarball position; replacing only those internal URLs with `""` keeps every locked package version and integrity hash while letting `bun install --frozen-lockfile` fetch the same versions from the active registry.

After that repair, run `29001176500` moved past dependency setup and failed in explicit build steps. The SDK package manifest intentionally exports `dist/*.js` and `dist/*.d.ts`, while the repository does not track `packages/sdk/js/dist`. Because CI now disables implicit dependency install scripts, package jobs must build the SDK dist surface as an explicit build dependency before compiling the CLI or bound overlay server.

After the SDK repair, run `29002496208` moved into the real CLI and overlay package matrix. CLI jobs failed in `Build CLI (native + baseline)` and overlay jobs failed in `Build bound overlay bundle` with `Missing ripgrep executable on build host PATH for target ...`. Both package surfaces call the OpenCorvus build script, which intentionally copies the target platform's host `rg` executable into the artifact so release-branch validation can require `bin/rg`; this means the package runner must install `ripgrep` as an explicit runtime binary dependency. The musl Docker path has the same contract inside the Alpine container.

## Repair

Make the CI setup responsibilities explicit:

- add a single `install_dependencies` input to `.github/actions/setup-bun`, defaulting to dependency installation for build and test jobs;
- set `install_dependencies: "false"` only in `build.yml`'s `prepare` job, whose steps only need Bun to read and update package version files;
- use `bun install --frozen-lockfile --no-progress --ignore-scripts --backend=copyfile --network-concurrency=1` so the workflow consumes the committed lockfile, avoids progress UI noise, does not enter package install-script lifecycle work before build commands, avoids the GitHub runner hardlink backend path, and serializes Bun's cold-cache download/extract work;
- replace internal `repositories.myhexin.com` resolved URLs in `bun.lock` with empty resolved URL strings, preserving locked versions and integrity hashes while making the lockfile portable for public GitHub-hosted runners;
- build `packages/sdk/js` explicitly after version sync in both `package-cli` and `package-overlay`, before `packages/opencorvus/script/build.ts` or `packages/overlay/script/build.ts` compile code that imports `@opencorvus-ai/sdk`;
- install `ripgrep` explicitly in every `package-cli` and `package-overlay` matrix runner before their package build steps, and install `ripgrep` inside the Alpine musl Docker build command before `build.ts --musl-only`;
- set `HUSKY=0` only for the install step, because Git hook installation is not part of package construction inside GitHub Actions;
- apply the same install contract to the Linux musl Docker build command in `build.yml`, which otherwise has a second raw `bun install` path;
- keep `actions/setup-node@v6`, `actions/cache@v6`, and `oven-sh/setup-bun@v2` unchanged.

This is not a fallback path: there remains one dependency install command and one lockfile source for jobs that need dependencies. The `prepare` job no longer performs unrelated install work before version metadata can be emitted. Build-time scripts remain explicit package commands such as `bun run script/build.ts`; implicit dependency install scripts are not part of the overlay package contract.

## Verification

- `bun run script/secret-scan.ts`
- `HUSKY=0 bun install --frozen-lockfile --no-progress`
- `HUSKY=0 bun install --frozen-lockfile --no-progress --ignore-scripts`
- `HUSKY=0 bun install --frozen-lockfile --no-progress --ignore-scripts --backend=copyfile`
- empty-cache local repro without `--network-concurrency=8`: reached `Resolved, downloaded and extracted [297]`, emitted `Fail extracting tarball`, then remained live until manually stopped;
- empty-cache local repro with `--network-concurrency=8`: installed 2692 packages and exited successfully in 193.77 seconds, but GitHub run `28997326936` still did not leave the same silent post-extraction boundary;
- empty-cache local repro with `--linker=isolated --network-concurrency=1`: reached `Resolved, downloaded and extracted [297]` and remained live for 499.22 seconds until the scratch-only install process was stopped, so isolated linking was rejected as the repair path;
- empty-cache local repro with `--network-concurrency=1`: installed 2692 packages and exited successfully in 297.31 seconds;
- scratch lockfile regeneration against `https://registry.npmjs.org` removed internal URLs but changed hundreds of dependency versions, so it was rejected;
- scratch lockfile conversion replacing only internal URLs with `""` kept the 1533-package lock and passed `bun install --frozen-lockfile --registry=https://registry.npmjs.org --no-progress --ignore-scripts --backend=copyfile --network-concurrency=1`;
- `bun ./packages/sdk/js/script/build.ts`;
- `bun --cwd packages/opencorvus -e "await import('@opencorvus-ai/sdk'); console.log('sdk import ok')"`;
- `bun test packages/opencorvus/test/script/document-health.test.ts -t "repository GitHub workflows use current action majors"`
- Re-run `gh workflow run build.yml --repo yangheng95/opencorvus --ref v0.0.2beta` and verify overlay artifacts.
