# Remote-Latest macOS ARM64 Repackage

## Recall

- User request: update to the latest remote code and package the macOS application again.
- Acceptance criteria: local `v0.0.7beta` is fast-forwarded to `myhexin/v0.0.7beta`; the native macOS ARM64 GUI package is rebuilt from that exact commit; the compiled sidecar self-host and backend health regressions remain fixed; package contracts, signatures, disk image, architecture, hashes, and a second review are recorded.
- Hard constraints: use `myhexin` as the git-cc source; do not overwrite unrelated work; do not restart, close, or refresh the user's running Overlay; do not claim unsupported platform rows as verified; keep generated artifacts untracked; commit subjects use `dsw-33987` and push records to the delivery branch.
- Sources read: `AGENTS.md`, `script/package-gui-installer-matrix.ts`, `packages/overlay/package.json`, the prior packaged-sidecar repair record, branch/remote history, and the fast-forward diff from `f5b544b423` to `464536b8cd`.
- Whole-repository search: root `package.json` owns `package:gui-installer-matrix`; `script/package-gui-installer-matrix.ts` owns SDK preparation, Overlay/Tauri build, staging, and release-contract validation; focused contract tests are `package-gui-installer-matrix.test.ts` and `release-overlay-contract.test.ts`; backend health is `/global/health`; `BunExecutable.resolve()` remains the sole dependency command executable authority.
- Independent agent feedback: none; the user did not request sub-agent work.

## Baseline

The branch was clean except for the previous untracked native artifacts and was a strict ancestor of the remote by four commits. It fast-forwarded without merge conflict from `f5b544b423` to remote commit `464536b8cd`. The incoming changes add the expert-squad authoring SDK, API, generated contracts, documentation, and tests; they do not replace the native package or sidecar build path.

## Execution and verification

- Pre-build verification: 122 tests passed across the incoming expert-squad SDK, portable template, real route, installer matrix, release contract, historical-link, and document-health suites.
- Push verification: all 10 repository type-check tasks passed from a cold local cache; SDK import, AI runtime, API route, generated API docs, Overlay internationalization, and secret scans passed.
- Native build: `bun run package:gui-installer-matrix` completed on commit `0242f2f7c` for `darwin-arm64`. Linux x64/ARM64, macOS x64, and Windows x64 rows were explicitly skipped because this host cannot validate them.
- Sidecar self-host: the newly compiled ARM64 sidecar returned Bun `1.3.13` under `BUN_BE_BUN=1`; SHA-256 is `2df48ad83b0560a7c04f6aab0b5ad4b61e04518e99ac8a716bd05a4de860173f`.
- Finder-like backend health: with `PATH=/usr/bin:/bin` and an isolated home/data directory, the compiled sidecar listened on `127.0.0.1`, and `GET /global/health` returned `healthy: true` with version `0.0.7-beta`. The isolated process then shut down normally with zero live tasks, runs, sessions, or tool parts.
- Native integrity: the `.app` passes deep/strict code-sign verification, the staged GUI executable passes code-sign verification, `hdiutil verify` reports a valid DMG checksum, and both GUI and sidecar executables are Mach-O ARM64.
- Artifact SHA-256: GUI executable `154e40f75d019a2a5cd3f8a17c6a5886e271c8280e710660249b7165f7707127`; DMG `fbac0b0f06ab07030e222af1283e9219307c7c4a1b982a87901e213fc3a84d0b`; application archive `fb26f94ceef7a3f93ecebad35c98d23962c19e76e8fa13ffd5af855aba57e992`.
- Second review: the artifact timestamps and hashes changed from the prior package, the staged package contains the latest fast-forwarded SDK/API source, the packaged-backend repair remains active, no unsupported platform was claimed, the generated Tauri schema was removed, and only the intended untracked native artifacts remain.
