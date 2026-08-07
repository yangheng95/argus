# GitHub Actions Native Package Matrix Repair

## Recall

### User Request

- Change the repository's default Git remote address to `https://github.com/yangheng95/opencorvus`.
- Repair and test the package matrix through GitHub Actions.
- Upgrade Bun to 1.3.14 and explain or repair the observed 500-plus MB package artifact size at its demonstrated owner.
- Ensure public GitHub Release assets remain independently downloadable, then update the documentation and bilingual README files with download links and platform choices.

### Acceptance Criteria

- `origin` fetch and push URLs equal the requested GitHub repository, and ordinary pushes from `v0.0.35beta` target that GitHub branch rather than `git-cc`.
- The exact current source commit is published before packaging; a stale local snapshot or an older GitHub branch is not accepted as evidence.
- The canonical GitHub Actions workflow fans out to native Linux x64, Linux ARM64 (Advanced RISC Machines 64-bit), macOS x64, macOS ARM64, and Windows x64 runners.
- Each row runs the repository-owned matrix packager, validates the final staged artifacts, and uploads only that row's verified output.
- A real GitHub Actions run on the delivered commit reaches terminal success for every required matrix row. Local workflow checks alone do not count as matrix acceptance.
- The final workflow, scripts, logs, and produced artifact inventory receive a second review before delivery.
- Artifact reporting distinguishes one installer's size from a matrix row's aggregate upload, and the Browser Node sidecar contains its own exact runtime closure rather than a duplicate of the Host server closure.
- A release publishes each validated installer as an individual GitHub Release asset; documentation links users to the latest release and explains the correct asset per operating system.

### Hard Constraints

- Preserve the physical native-runner boundary; do not cross-compile or report skipped rows as packaged.
- Do not use `--skip-build`, hand-copy missing runtime files, or publish output from a different source commit.
- Do not add a workflow gate or a second packaging implementation. Fix the canonical workflow or canonical packager at the demonstrated root cause.
- Keep the public graphical installer release path separate from explicit portable command-line interface packaging unless live failure evidence proves that contract changed.
- Preserve unrelated worktree changes and do not rewrite published history.
- GitHub Actions and package artifact contracts are non-User Interface behavior; positive contract tests may validate exact current outputs. No User Interface automation is involved.

### Sources Read

- `AGENTS.md`
- `.github/workflows/build.yml`
- `.github/workflows/build-overlays.yml`
- `.github/actions/setup-bun/action.yml`
- `script/package-gui-installer-matrix.ts`
- `script/package-binary-matrix.ts`
- `script/package-native-binary.ts`
- `script/check-release-assets.ts`
- `script/release-asset-contract.ts`
- `script/stage-release-upload-assets.ts`
- `script/release`
- `LOCAL_PACKAGING.md`
- `packages/opencorvus/script/build-artifact.ts`
- `packages/opencorvus/script/build-runtime-node-modules.ts`
- `packages/opencorvus/script/build.ts`
- `packages/opencorvus/script/build.local.ts`
- `packages/opencorvus/src/browser/runtime/node-sidecar.ts`
- `packages/overlay/src-tauri/build.rs`
- `script/stage-release-upload-assets.ts`
- `docs/packaging.md`
- `RELEASE.md`
- `README.md`
- `README.zh-CN.md`
- `specs/records/2026-07/2026-07-09-github-overlay-package-ci.md`
- `specs/records/2026-07/2026-07-16-gui-installer-matrix-and-db-schema-backup.md`
- `specs/records/2026-08/2026-08-05-v0.0.32beta-windows-native-matrix-package.md`
- GitHub's public Actions run pages for build runs 32, 33, and 34.
- Official action repositories and tags for checkout, upload-artifact, download-artifact, setup-node, setup-bun, cache, and Rust caching.

### Whole-Repository Search Evidence

- Root `package.json` exposes `package:gui-installer-matrix` and `package:binary-matrix` as separate canonical commands.
- `.github/workflows/build.yml` and the manual `.github/workflows/build-overlays.yml` call `package:gui-installer-matrix`; the current public release workflow intentionally publishes graphical installer artifacts rather than portable command-line interface archives.
- The graphical installer packager already maps the five native platform rows, stages platform installers under `packages/overlay/dist-artifacts/<platform>`, and invokes `check-release-assets.ts overlay --require-bundle` after staging.
- The GitHub remote already has the requested URL, but local `v0.0.35beta` tracks `git-cc/v0.0.35beta`; therefore URL inspection alone does not satisfy the default-push request.
- GitHub's default branch is `candidate`, and its latest public successful package matrix is build 34 on the older `v0.0.2beta` line. Current `v0.0.35beta` has no remote branch or live Actions evidence yet.
- The failed public build 33 was a GitHub-hosted-runner acquisition incident affecting all rows, not evidence of a repository packaging defect. Build 34 subsequently completed all ten then-declared command-line interface and Overlay rows successfully.
- Searches used: `rg --files .github script specs`; `rg 'package:gui-installer-matrix|package:binary-matrix|check-release-assets|matrix'`; `git remote -v`; `git remote show origin`; `git ls-remote --symref origin HEAD`; and current branch/status/log inspection.

### Independent Agent Feedback

- No sub-agent was started because the user did not request delegation or an independent parallel audit. This task uses live GitHub runner evidence plus a final self-review.

## Evidence Timeline

1. The workspace began clean on `v0.0.35beta` at `8d336b8db4`, one commit ahead of `git-cc/v0.0.35beta`.
2. `origin` already resolved to the requested GitHub URL, while branch upstream remained `git-cc/v0.0.35beta` and no `remote.pushDefault` existed.
3. GitHub's public Actions history showed build 34 succeeded on July 9, 2026 at old commit `85599f9`; it does not validate current source.
4. The locally installed GitHub Command Line Interface had no authentication, while a Git dry-run proved the existing Git credential path can publish a new `v0.0.35beta` branch and the repository pre-push checks pass.
5. The first full push was rejected by GitHub `GH001`: historical and current generated package outputs contained executable and installer blobs above GitHub's 100 MB per-file limit. The current tree still tracked ten files under root `opencorvus-dist/`, including 121-128 MB Linux executables, while only Overlay's generated `dist-artifacts/` directory was ignored.
6. GitHub Actions build 35 checked out the exact delivery commit and acquired all five hosted runners, but every row stalled in the shared Bun 1.3.13 cold install. Linux x64 reached `Resolved, downloaded and extracted [346]` in nine seconds, then produced no output for 22 minutes and left an orphan Bun process when cancelled; no package command started.
7. An isolated Windows cold-cache reproduction reached the same `[346]` boundary. Bun 1.3.13 then emitted an `EPERM` cache-move error and remained alive, while official stable Bun 1.3.14 returned explicit `InstallFailed` errors instead of silently retaining the process. The lockfile also contained approximately 1,900 tarball URLs pinned to `registry.npmmirror.com`, whereas Bun's documented default registry is `registry.npmjs.org`.
8. The first Bun 1.3.14 pre-push review exposed two stale local/generated boundaries before publication: Overlay's package-local SDK junction pointed at an older isolated worktree, and the tracked OpenAPI/SDK artifacts differed from the current server route generator. Correcting the local junction made Overlay typecheck pass; running the canonical transactional SDK build regenerated the tracked artifacts instead of weakening the checks.
9. GitHub Actions build 36 proved Bun 1.3.14 plus the official registry completed dependency installation on all five native runners. Both macOS rows then reached the canonical packager and failed independently during the Vite transform: Node exhausted its default approximately 2 GB heap. Homebrew's untrusted `aws/tap` message was only a runner warning and not the failed command's cause.
10. Build 37's completed row uploads measured 545-612 MB because each row artifact aggregates three distributable forms. The Windows directory contains a roughly 211 MiB bare executable, 202 MiB Microsoft Installer package, and 202 MiB Nullsoft Scriptable Install System setup executable; an existing local 0.0.34-beta staging tree has the same sizes, so this aggregate is neither a single installer nor a Bun 1.3.14 regression.
11. The underlying Windows server payload is roughly 493 MiB before gzip embedding: the Bun-compiled server is 168 MiB, the Browser Node sidecar is 187 MiB, the Host `node_modules` closure is 102 MiB, and tool binaries are 36 MiB. The sidecar's 187 MiB included an 83 MiB Node executable plus another 102 MiB copy of the full Host dependency closure, although its runtime contract resolves only Playwright. This is a real duplicate owner independent of the aggregate-upload presentation.
12. Build 37 packaged all three Linux ARM64 bundles, then staging rejected the generated `OpenCorvus_0.0.35-beta_aarch64.AppImage` because the shared release asset contract incorrectly expected an `arm64` AppImage suffix. Tauri uses `aarch64` for that AppImage and RPM, while Debian correctly uses `arm64`; the other four matrix rows succeeded.
13. The canonical release job downloads aggregate CI row artifacts only as an internal transfer step. `stage-release-upload-assets.ts` then flattens and validates the installer filenames, and `gh release upload` receives each staged file as its own argument. GitHub Release users therefore download one installer asset, not the 500-plus MB CI row artifact.

## Implementation Plan

1. Remove the tracked root `opencorvus-dist/` generated package tree and add its root path to `.gitignore`; the canonical matrix remains the regeneration source.
2. Set repository-local `remote.pushDefault=origin`. Because published `git-cc` history contains rejected large package objects and cannot be rewritten, create a GitHub delivery commit whose parent is GitHub `candidate` and whose tree is the exact cleaned current source tree; publish it as `v0.0.35beta` without changing the local or `git-cc` history.
3. Dispatch `.github/workflows/build.yml` explicitly at that branch with an empty release version so the run creates retained development artifacts without creating a release or mutating the release branch.
4. Replace the stale Bun 1.3.13 cold-install workaround with the current official stable Bun release, official npm registry authority, and Bun's native platform backend/concurrency defaults. Synchronize all active runtime requirement documentation and the Overlay Docker builder.
5. Inspect every matrix job and artifact from the exact dispatched commit. Distinguish runner-service failures from repository workflow or packager failures.
6. Repair only evidenced canonical owners. Add or restore focused positive non-User Interface contract coverage when implementation changes are required.
7. Commit with the required `dsw-33987` prefix, push the ordinary history to `git-cc`, update the GitHub delivery commit, rerun the exact workflow, and record terminal job/artifact evidence here.
8. Run documentation health, version, workflow syntax/contract, typecheck, diff, and cached-diff checks; then manually review the final source and live Actions result.
9. Run Vite through the package-owned Node entrypoint with an explicit 8 GB heap so every local, Tauri, and matrix caller shares the same memory contract; rerun the full native matrix rather than retrying only macOS.
10. Give the Browser Node sidecar an explicit Playwright runtime-module closure, use that closure in both production builders and packaged-runtime validation, and rebuild the Windows package to measure the resulting installer rather than estimating from source.
11. Correct the Linux ARM64 AppImage architecture mapping at the shared release asset contract, add a positive filename-contract test covering all three Tauri outputs, then rerun the full matrix on the new exact source tree.
12. Add a positive release-staging test proving multiple installers become independent files, document the CI-artifact versus public-release distinction, and add current GitHub Releases download links and operating-system selection guidance to both README languages and the release documentation.

## Verification Evidence

- Bun 1.3.14 focused contracts pass: `bun test script/release-asset-contract.test.ts script/stage-release-upload-assets.test.ts packages/opencorvus/test/browser-mcp-node-bundle.test.ts` reports four passing tests and nine assertions.
- The rebuilt Windows Browser Node sidecar resolves the exact `playwright` and `playwright-core` closure, and its packaged Node executable successfully loads Playwright's Chromium export.
- The uncompressed Windows embedded server payload fell from roughly 493 MiB to 406 MiB. The Browser Node sidecar fell from roughly 187 MiB to 98 MiB.
- A full local `bun run package:gui-installer-matrix` completed SDK generation, the 7,087-module Vite production build, embedded backend construction, Tauri executable linking, MSI and NSIS bundling, staging, and release-asset validation.
- The resulting Windows MSI is 178.98 MiB and the NSIS setup executable is 178.48 MiB, down from roughly 202 MiB each. The staged bare executable is 186.46 MiB; their aggregate staging directory remains larger because it deliberately contains all three files.
- Build 37 on delivery snapshot `581a49f84c6e70dd0154550d472e6520bc59a28b` proved Windows x64, both macOS architectures, and Linux x64. Linux ARM64 produced all three native bundles before the now-corrected AppImage filename contract rejected staging.
- Final acceptance remains bound to a new public five-platform workflow run on the post-fix exact delivery tree; no earlier run substitutes for that evidence.

## Second Review

- The public release path uploads individual flattened installer files; the large per-row Actions artifact remains an internal transfer container.
- Browser sidecar dependencies are owned by one explicit runtime-closure function shared by both builders and the packaged-runtime validator.
- Linux ARM64 naming follows the three actual Tauri formats rather than a platform-wide guessed suffix.
- Bilingual README guidance and `RELEASE.md` point to the canonical GitHub Releases pages and tell users which single file to download.
- Final diff, repository checks, public run result, artifact inventory, and both remote pushes remain required before delivery.
