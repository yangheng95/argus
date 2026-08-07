# GUI Installer Matrix and Database Schema Backup

## Recall

### User Request

- Write a new matrix packaging tool that directly produces OpenCorvus GUI installers.
- Package every supported desktop platform through one matrix release operation.
- Stop generating the portable unified release package.
- When the database schema changes, automatically back up the existing database instance, create a new database from the current schema, and show a notification.

### Acceptance Criteria

- A repository-owned GUI installer matrix defines exactly `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, and `windows-x64`.
- The matrix tool packages only the current native host row, uses Tauri's native installer pipeline, stages the raw GUI executable plus every required installer for that row, and validates the staged files against the release version.
- One release workflow invocation fans out over all five native runners and calls the same GUI matrix tool; no workflow-only staging implementation remains.
- The release workflow no longer runs or uploads the portable CLI bundle matrix and release publishing no longer expects portable CLI archives.
- Linux produces DEB (Debian package), RPM (Red Hat Package Manager package), and AppImage installers; macOS produces an application bundle archive plus DMG (Apple Disk Image); Windows produces MSI (Microsoft Installer) and NSIS (Nullsoft Scriptable Install System) installers.
- A database with current schema opens without backup or notification metadata.
- A database with schema drift is checkpointed and closed, its complete SQLite contents are moved to a timestamped backup file, its WAL (Write-Ahead Log) and SHM (shared-memory) companions are removed after the checkpoint, and a new database is created from the current DDL (Data Definition Language).
- The backup is readable and retains data from the old database; the new database exactly matches the current schema and does not retain old rows.
- `/global/health` remains independent of database initialization and returns process-owned schema-refresh evidence containing the original path, backup path, reason, and refresh timestamp only after a refresh occurred.
- The GUI connection path shows one durable in-app notification for a given backup and requests the existing native desktop notification path, including the backup path in copyable details.
- Focused unit/contract tests, generated API/docs checks, typecheck, a native Windows GUI package build, installer validation, and `git diff --check` pass. Native Linux/macOS execution remains owned by their workflow runners and is not falsely claimed from Windows.
- After automated checks pass, the changed files and generated artifacts receive a second manual review.

### Hard Constraints

- No fallback, compatibility alias, retry masking, or alternate package source.
- Do not cross-build another operating system and call it verified; each matrix row runs on its native operating system.
- Use Tauri's mature installer/bundler rather than hand-building MSI, NSIS, DMG, DEB, RPM, or AppImage packages.
- The portable CLI packagers may remain available for explicit operational/baseline use, but the release matrix must not call, upload, or publish them.
- Database schema refresh replaces the old manual-reset-on-drift behavior; it must not preserve both paths.
- Database backup failure must abort refresh and preserve the original database; database recreation failure must remain visible and must not silently restore or discard evidence.
- Do not migrate rows into the new schema. The project rule is backup old DB, then rebuild from current DDL.
- Do not restart, stop, refresh, or otherwise interfere with a running OpenCorvus/Overlay process.
- Preserve all unrelated dirty-worktree changes and stage only files owned by this task.
- Every implementation change requires regression coverage.
- All test timeouts measure inactivity, not wall time since process start.

### Sources Read

- `AGENTS.md`
- `specs/records/2026-07/2026-07-10-cross-platform-native-binary-installation.md`
- `specs/records/2026-07/2026-07-09-github-overlay-package-ci.md`
- `specs/records/2026-06/2026-06-04-binary-native-node-modules.md`
- `script/package-binary-matrix.ts`
- `script/package-native-binary.ts`
- `script/package-linux-binary.ts`
- `script/check-release-assets.ts`
- `script/release-asset-contract.ts`
- `packages/overlay/script/build.ts`
- `packages/overlay/script/build-overlay.ts`
- `packages/overlay/script/artifact-names.ts`
- `packages/overlay/src-tauri/tauri.conf.json`
- `packages/overlay/src-tauri/Cargo.toml`
- `packages/overlay/src-tauri/build.rs`
- `packages/overlay/src-tauri/src/main.rs`
- `packages/overlay/src/services/connection.ts`
- `packages/overlay/src/services/notify.ts`
- `packages/opencorvus/src/storage/db.ts`
- `packages/opencorvus/src/server/routes/global.ts`
- `.github/workflows/build.yml`
- `.github/workflows/build-overlays.yml`
- Tauri v2 official CLI, distribution, Windows installer, macOS application bundle, DMG, and AppImage documentation.

### Whole-Repository Search Evidence

- `package:binary-matrix` is called only by the release workflow and owns the portable CLI archive matrix. Its tests are `packages/opencorvus/test/script/package-binary-matrix.test.ts` and portable release wiring assertions in `release-overlay-contract.test.ts`.
- `packages/overlay/script/build.ts` is the production Tauri bundle owner. It builds Vite, builds the matching overlay-server payload, embeds that payload in the Tauri executable, and invokes platform-specific Tauri installer targets.
- Installer staging currently exists only as shell code duplicated between `.github/workflows/build.yml` and `.github/workflows/build-overlays.yml`; `script/check-release-assets.ts` and `script/release-asset-contract.ts` already define the authoritative installer filename contract.
- The portable release job uploads `opencorvus-dist-*`, the publish job downloads those archives, and `stage-release-upload-assets.ts` accepts both portable archives and GUI installers. Removing the portable job requires changing all three workflow call sites and their contract tests.
- `Database.Client()` is the single lazy database initialization source. `ensureCurrentSchema()` currently detects table/column drift and throws `DatabaseSchemaResetRequiredError`; the manual reset message and error mapping are therefore the old behavior to replace.
- `Database.resetFiles()` and `Database.reset()` are explicit destructive user operations and remain separate from automatic schema refresh.
- `/global/health` is the first common GUI probe and already returns authoritative runtime DB paths, but it does not currently initialize or report schema status.
- `packages/overlay/src/services/connection.ts::checkConnection()` reads `/global/health` on initial connection and reconnect; `packages/overlay/src/services/notify.ts` is the single in-app/native notification abstraction.
- Tauri's Rust host already registers `tauri-plugin-notification`; no second native notification implementation is required.
- Searches used: `rg --files | rg '(package|installer|tauri|binary|release|matrix)'`; `rg 'package:binary-matrix|tauri build|--no-bundle|require-bundle|dist-artifacts'`; `rg 'DatabaseSchemaResetRequiredError|ensureCurrentSchema|Database.Client|Database.Path|global/health'`; `rg 'desktopNotifications|notification.send|notifySuccess|notifyInfo'`.

### Independent Agent Feedback

- No sub-agent was started because the current task did not request agent delegation or a parallel audit. The repository's prior packaging records already contain the relevant independent-agent ownership findings: CLI bundles and Tauri installers are separate products, and native runners must verify their own operating-system artifacts.

## Design

### GUI Packaging Single Source

- Add `script/package-gui-installer-matrix.ts` as the single host-native GUI matrix lifecycle.
- Matrix metadata owns platform, architecture, required Tauri bundle kinds, staging names, and native-host skip reasons.
- The tool calls `packages/overlay/script/build.ts`, stages the raw executable and Tauri bundle outputs into `packages/overlay/dist-artifacts/<platform>`, archives the macOS `.app` directory, and calls the existing release-asset validator.
- Root `package:gui-installer-matrix` exposes the tool. Release workflow matrix rows call only this command.
- Remove workflow-owned installer staging and portable CLI release jobs. Keep explicit CLI/baseline commands outside the release matrix because remote service delivery still uses them.

### Database Refresh Single Source

- Replace `ensureCurrentSchema()`'s drift exception path with a database-initialization result that can rotate the old database exactly once.
- On drift, checkpoint WAL into the main DB, close SQLite, atomically rename the main DB to a collision-free timestamped schema-backup path, remove checkpoint companions, open a new SQLite DB, apply the current DDL, and verify the resulting table/column shape.
- Record one immutable process-local `DatabaseSchemaRefresh` value after success. Do not persist a second state file.
- `/global/health` remains a database-independent control-plane probe so corrupt databases do not hide the authoritative reset path. After a data request initializes or refreshes the database, health includes the process-local refresh value when present.

### GUI Notification

- `checkConnection()` parses the optional health refresh value.
- A backup-path keyed in-memory set prevents repeated health polling from duplicating the same notification.
- The existing notification abstraction creates a persistent success notification and requests the existing desktop-notification dispatch path. Details include original path, backup path, drift reason, and timestamp.

## Benchmark Contract

### Input -> Output

- Packaging input: repository version plus one native runner matching a declared GUI matrix row.
- Packaging output: a validated `packages/overlay/dist-artifacts/<platform>` directory containing the raw GUI binary and all required native installers, with no portable CLI archive generated by the release workflow.
- Database input: current-schema SQLite DB or a deliberately stale-schema SQLite DB under an isolated `OPENCORVUS_HOME`.
- Database output: unchanged current DB, or readable old backup plus new current-schema DB and one health/GUI notification fact.

### Environment

- Windows host workspace for local implementation and native Windows installer proof.
- GitHub Actions native Linux x64/arm64, macOS x64/arm64, and Windows x64 runners for full matrix proof.
- Repository Bun runtime, Rust/Cargo toolchain, Tauri CLI, platform packaging dependencies, and existing release validator.
- Tests isolate `OPENCORVUS_HOME`; they do not use the user's running DB.

### Inactivity Timeout

- Long package commands are observed through output-producing build tools. A monitor may fail a run only after 10 minutes with no new stdout/stderr or artifact activity; elapsed build duration alone is not a timeout.
- Focused tests retain their existing shorter process/test timeouts where they continuously report progress.

### Executable Checks

1. Matrix metadata and host selection tests cover all five rows and reject unsupported hosts.
2. Staging tests prove every platform maps Tauri output to the release-asset contract and excludes portable archives.
3. Workflow contract tests prove all-platform native fan-out uses `package:gui-installer-matrix`, contains no portable CLI release job/download, and contains no duplicated staging shell.
4. Database tests create an old schema with retained data, trigger `Database.Client()`, then assert backup readability, fresh schema, cleared old rows, companion cleanup, and refresh metadata.
5. Current-schema database tests assert no backup and no refresh metadata.
6. Health route tests assert the optional process-owned refresh response shape without opening or initializing the database.
7. Overlay tests assert one notification per backup path and use the existing desktop-notification abstraction.
8. Native Windows package command completes and `check-release-assets.ts overlay --require-bundle` passes for the staged output.
9. Focused tests, SDK/OpenAPI generation checks, docs health tests, typecheck, and `git diff --check` pass.
10. Manual review confirms installer output names, workflow ownership, DB failure ordering, and no unrelated dirty changes were staged.

## Implementation Status

- Implemented `script/package-gui-installer-matrix.ts` as the five-row native GUI installer matrix. The current host builds through the existing Tauri owner, stages the raw GUI executable plus all required installers, and validates the staged directory; other rows report native-runner skip reasons.
- Replaced the public release workflow's portable CLI package/upload/publish path with the GUI matrix command. The manual overlay workflow calls the same command and no longer owns staging shell.
- Added synchronized WiX version projection. Public SemVer remains `0.0.6-beta`; MSI (Microsoft Installer) receives numeric `0.0.6.0` metadata while installer names retain the public version.
- Replaced manual schema-reset-on-drift with checkpointed backup rotation and fresh DDL creation. Refresh evidence and the success log are published only after the new database passes the exact current-schema check.
- Extended the DB-independent health response with optional process-owned refresh evidence and connected it to one durable GUI success notification per backup path plus the existing native notification transport.
- The independent-review rejection items were repaired: the publisher owns checkout/Bun setup; release staging rejects portable artifacts; VSIX builds sidecars on five matching native runners; debug ingest residue was removed; malformed health evidence fails visibly; recreation failure, native notification, unsupported host, and all five staging contracts are tested.

## Verification Evidence

- `bun run package:gui-installer-matrix` passed on native Windows x64 in 414.3 seconds and validated `opencorvus-overlay.exe`, `OpenCorvus_0.0.6-beta_x64_en-US.msi`, and `OpenCorvus_0.0.6-beta_x64-setup.exe`.
- The first package attempt exposed Tauri's rejection of textual MSI prerelease metadata. The repair uses Tauri's `bundle.windows.wix.version`; the second real run produced both MSI and NSIS (Nullsoft Scriptable Install System) bundles.
- The post-review focused run passed 58 tests and 206 assertions across DB rotation/recreation, five-platform staging, release and VSIX workflow contracts, notification transport, strict health evidence, and debug-residue checks.
- The post-review aggregate rerun passed 79 tests before one transient fixture-level `git init` inactivity timeout; Git 2.52.0 was healthy and the affected health-route suite then passed independently at 22/22. Document health passed 53/53 and historical links passed 21/21.
- Post-review `bun run version:check`, `bun run typecheck` (10 workspace tasks), `bun run overlay:i18n-check`, `bun run api:routes-check`, `bun run docs:check`, and `git diff --check` passed.
- A task-scoped browser preview connected through the visible Network settings UI to isolated health evidence. Visual inspection confirmed the green persistent notification, backup-created message, and expanded copyable original path, backup path, drift reason, and timestamp. The isolated preview services were closed without touching the user's running OpenCorvus/Overlay.
- Linux x64/ARM64 and macOS x64/ARM64 installer execution belongs to their native workflow runners and is not claimed as locally executed from Windows. Deterministic staging contracts cover their expected output names without misrepresenting them as native execution.
- Root revalidation after the Mission-model correction passed the combined packaging/Mission/storage group at `58 / 58` with 218 assertions and the Overlay notification group at `4 / 4` with 12 assertions. OpenCorvus, Overlay and JavaScript SDK typechecks, API route freshness, docs freshness, candidate Prettier, and `74 / 74` document-health/history tests pass. The current Windows Tauri output was restaged through the matrix entry with `--skip-build`; its required validator accepted the raw executable, MSI and NSIS files. This reuses the real native compiler output and reruns staging/validation only; it does not claim a second native compilation.

## Independent Review Rejection Recall

The first complete read-only review rejected the implementation before commit. The release-assets job downloaded GUI artifacts but did not check out the repository or install Bun before invoking the repository-owned staging script. The staging script and its positive test still accepted `opencorvus-dist-*` command-line interface archives even though this release no longer downloads or publishes them. Removing those artifacts from `build.yml` also broke `build-vscode-extension.yml`, which still tried to download them from a successful `build.yml` run. The extension workflow must invoke the explicit host-native binary packager itself; the public GUI release workflow must not recreate the removed portable archive job.

Whole-repository inspection of that explicit binary packager found retired localhost diagnostic uploads to `127.0.0.1:7925` with swallowed failures. They are debug residue, not product behavior, and must be deleted with a negative workflow/packager regression. No replacement telemetry or compatibility path is permitted.

The Overlay health parser silently treated malformed `databaseSchemaRefresh` evidence as absence, and its test positively required that behavior. Absence remains valid; a present malformed value must fail at the response boundary so backend/SDK drift is visible. Notification evidence must also prove both the durable in-app record and the existing native notification transport when desktop notifications are enabled.

Database rotation preserves the checkpointed original database and propagates rename/open/DDL failures, but the success log was emitted before the fresh schema existed and no regression exercised recreation failure after a successful backup rename. Logging must occur only after `ensureCurrentSchema` succeeds. A failure regression must prove the backup remains readable, the error is visible, no success metadata is published and the partially created replacement is not described as successful.

The matrix metadata has all five native rows and the real Windows build produced the raw executable, MSI and NSIS artifacts, but deterministic staging tests covered only Windows and never exercised the public unsupported-host rejection. Tests must cover Linux x64/arm64, macOS x64/arm64 and Windows x64 staging names through the same release-asset contract without claiming non-Windows native execution.

The health route intentionally remains database-independent so corrupt storage cannot hide the control-plane reset path. Benchmark check 6 is corrected to require optional process-owned refresh projection without database initialization; it must not be interpreted as permission to silently ignore malformed refresh evidence.

## Second Review

The bullets below are implementation self-review evidence, not an independent exact-tree ACCEPT. A fresh read-only Agent must bind the final candidate contents after the Mission and strict-health corrections before this section can be accepted as complete.

- Release packaging is single-source: workflows supply native runners and dependencies, while the GUI matrix owns SDK preparation, Tauri build, staging, naming, and validation. `build.yml` contains no portable CLI generation/download/publish path, and the upload staging script rejects any `opencorvus-dist-*` directory.
- The release-assets job now checks out the exact repository and provisions Bun before invoking its repository-owned script. The VSIX workflow no longer depends on removed release artifacts; each of its five rows builds and smoke-verifies its sidecar on the matching native operating system and architecture.
- DB ordering is checkpoint/close, companion cleanup, backup rename, fresh DDL creation, exact schema validation, refresh metadata, then success log. Rename failure keeps the original readable; recreation failure keeps the backup readable, exposes the failure, and publishes no refresh metadata.
- Health remains DB-independent. An absent refresh field is valid, but a present malformed object throws instead of being converted to absence. Tests prove the durable in-app notification and the existing `notification.send` native command.
- Deterministic staging tests exercise Linux x64/ARM64, macOS x64/ARM64, and Windows x64 output names plus unsupported-host rejection without claiming cross-platform execution. The real Windows native run remains the local executable proof.
- Whole-repository debug-residue coverage now includes root `script/**`; no localhost ingest probes or swallowed diagnostic uploads remain.
- Manual diff review separated this task's OpenAPI/types health hunks from unrelated dirty generated changes. No unrelated dirty-worktree hunk is selected for delivery.

## Obsolete Code Review

- `script/package-binary-matrix.ts` and `script/package-native-binary.ts` become obsolete for public release generation, but explicit CLI/native bundle and remote baseline workflows may still need them. This task will stop invoking them from the GUI release matrix without deleting them; deletion requires a separate usage decision because the repository still documents explicit non-GUI operational packaging.
