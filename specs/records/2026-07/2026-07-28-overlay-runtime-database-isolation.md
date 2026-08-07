# Overlay Runtime Database Isolation and Stale Installation Cleanup

## Recall

### User Request

- Explain why three test projects could not be deleted.
- Explain why testing replaced the user's formal database.
- Restore the formal database immediately.
- Remove expired OpenCorvus installations and sidecars.
- Eliminate the product defect that lets a non-production Overlay damage the formal database.

### Acceptance Criteria

- The restored formal database remains the active database used by the official `0.0.22-beta` Overlay and passes SQLite integrity checks.
- The expired `0.0.8-beta` visual-test application and its extracted sidecar are absent from active installation and Application Support paths.
- An Overlay built with the canonical Tauri identifier keeps the established formal database location.
- An Overlay built with any non-canonical Tauri identifier passes an explicit, bundle-local `OPENCORVUS_HOME` to its sidecar before the sidecar can open SQLite.
- An explicit portable `OPENCORVUS_HOME` remains the single highest-priority runtime-root source for both the host and sidecar.
- Schema drift continues through the existing strict backup-and-restore path; no empty-rebuild implementation or destructive success claim is reintroduced.
- Rust behavior tests, static ownership tests, focused database restore tests, native package/runtime evidence, repository document-health checks, and a second exact diff review pass.
- Only task-owned files are staged. All concurrent worktree changes remain untouched.

### Hard Constraints

- Do not identify a destructive runtime from a title, filename, suffix, or version string. The canonical Tauri configuration identifier is the authority.
- Do not move the official Overlay to a new database path or migrate the restored database.
- Do not add a compatibility alias, fallback database, second active database, route gate, state machine, or test-name keyword rule.
- Do not weaken `Database.Client()` schema validation, lossless-refresh validation, foreign-key verification, or immutable backup retention.
- Do not create a worktree, reset the repository, restore unrelated files, or overwrite concurrent edits.
- Every code change requires regression coverage.
- Commit subjects use `dsw-33987`; delivery is the current `v0.0.22beta` branch pushed to `myhexin`.

### Runtime Evidence

- At `2026-07-28T04:08:29Z`, the expired `ai.opencorvus.overlay.visualtest` application started an embedded `0.0.8-beta` sidecar on port `7879`.
- Its sidecar command had no `OPENCORVUS_HOME`, so `Database.Path()` resolved `/Users/yangheng/.local/share/opencorvus/opencorvus.db`.
- The first `/work-ledger` request logged schema drift reason `unexpected table automation`, renamed the formal database to a schema backup, and created an empty current database under the old implementation.
- The preserved backup passed `PRAGMA integrity_check` and contained 23 Projects, 15 Tasks, 154 Sessions, and 2475 Messages.
- The restored image initially contained those same counts. Later official-runtime activity changed live
  counts, so the backup counts are recovery evidence rather than an invariant of the active database.
- The pre-restore five-Project image remains separately preserved for rollback.
- The expired visual-test App and its `Application Support/ai.opencorvus.overlay.visualtest` payload were moved out of active paths; the remaining official App and sidecar both report `0.0.22-beta`.

### Sources Read

- `AGENTS.md`
- `specs/current/architecture/02-data.md`
- `specs/records/2026-07/2026-07-16-gui-installer-matrix-and-db-schema-backup.md`
- `specs/records/2026-07/2026-07-20-database-schema-backup-restore.md`
- `specs/records/2026-07/2026-07-25-database-schema-refresh-fts-shadow-repair.md`
- `packages/overlay/src-tauri/tauri.conf.json`
- `packages/overlay/src-tauri/build.rs`
- `packages/overlay/src-tauri/src/main.rs`
- `packages/overlay/test/official-runtime-paths.test.ts`
- `packages/overlay/script/build.ts`
- `packages/opencorvus/src/global/index.ts`
- `packages/opencorvus/src/cli/cmd/serve.ts`
- `packages/opencorvus/src/storage/db.ts`
- `packages/opencorvus/test/storage/db-path.test.ts`

### Whole-Repository Search Evidence

Searches covered `OPENCORVUS_HOME`, `OverlayRuntimePaths`, `app_local_data_dir`, `managed-scope`,
`start_server`, `Database.Path`, `refreshSchemaDatabase`, `rotateDatabaseSchemaFiles`,
`restoreCurrentSchemaData`, `schemaRefresh`, embedded `sidecar-*` publication/collection, Tauri
build/config overrides, and every current database initialization test.

| Owner or call site | Decision |
| --- | --- |
| `tauri.conf.json::identifier` | Keep as the only canonical official Overlay identity source. |
| `build.rs` | Read the canonical identifier and inject it into the Rust binary; do not duplicate the string in `main.rs`. |
| `OverlayRuntimePaths::from_tauri` | Preserve Tauri data/log/embedded paths and derive a sidecar portable root only for a non-canonical runtime identifier. |
| `OverlayRuntimePaths::from_portable_root` | Preserve the explicit portable root as both host path source and sidecar `OPENCORVUS_HOME`. |
| `overlay_runtime_paths` | Compare the actual runtime Tauri identifier with the build-injected canonical identifier. |
| `start_server` | Pass or remove `OPENCORVUS_HOME` from the child command according to the resolved single source before spawn. |
| `Global.Path` and `Database.Path` | Keep unchanged; they already consume `OPENCORVUS_HOME` lazily and define one database path. |
| `collect_stale_embedded_payloads` | Keep as the bundle-local extracted-sidecar cleanup owner; it already removes lease-proven stale payloads. |
| `refreshSchemaDatabase` | Keep the strict current DDL plus transactional data restore path. |
| `Database.resetFiles/reset` | Keep unchanged as explicit destructive operations protected by their existing contracts. |
| `official-runtime-paths.test.ts` and Rust unit tests | Add canonical/non-canonical/portable-root sidecar-home assertions and child environment ownership checks. |
| `db-path.test.ts` | Re-run the existing real stale-schema restore cases; no second database test implementation is added. |

### Independent Agent Feedback

- No sub-agent was started because the user did not request delegation or a parallel audit.

## Design

1. `build.rs` reads the base `tauri.conf.json` identifier and exports one compile-time
   `OPENCORVUS_OFFICIAL_BUNDLE_IDENTIFIER` value.
2. `OverlayRuntimePaths` carries an optional `sidecar_home`. An explicit portable root sets it to
   that exact root. A normal official App leaves it absent so the restored established formal
   database location remains unchanged. A non-canonical App sets it to its own Tauri local-data
   directory.
3. `start_server` applies the resolved child environment explicitly. A present `sidecar_home`
   becomes `OPENCORVUS_HOME`; absence removes inherited ambiguity. The sidecar therefore resolves
   one database before any request can initialize SQLite.
4. Existing schema drift handling remains the only database-refresh path: checkpoint, immutable
   backup rotation, current DDL creation, transactional shared-column restore, derived FTS rebuild,
   foreign-key validation, and final exact-schema verification.
5. Native acceptance builds a non-canonical macOS application in an isolated target directory,
   launches it, proves `/global/health.paths.database` is bundle-local, proves the formal database
   remains intact, then removes the test installation and support directory.

## Implementation and Runtime Acceptance

- The formal database was restored from
  `opencorvus.schema-backup-2026-07-28T04-08-30.082Z-dfd3f207-2045-4b72-855a-69f6388c6882.db`.
  The displaced five-Project database, WAL, and SHM remain preserved under
  `pre-restore-current-2026-07-28T07-02-00Z/`, and an online consistent snapshot remains at
  `opencorvus.pre-restore-2026-07-28T07-02-00Z.db`.
- The expired `0.0.8-beta` visual-test App and
  `Application Support/ai.opencorvus.overlay.visualtest` were removed from active paths and moved
  to the user's Trash for recoverability. The native acceptance App and its support directory were
  cleaned the same way after verification.
- A real macOS alternate-identifier build,
  `ai.opencorvus.overlay.runtime-isolation-test`, launched its `0.0.22-beta` sidecar on port `7879`.
  `/global/health.paths.database` and `lsof` both resolved its only open database to
  `Application Support/ai.opencorvus.overlay.runtime-isolation-test/data/opencorvus.db`.
- Formal database counts were `30` Projects, `15` Tasks, `154` Sessions, and `2356` Messages both
  before and after the alternate-App runtime window. The isolated database passed
  `PRAGMA integrity_check`.
- The official App was not restarted for final static re-verification after the user later closed
  it; the last successful official health response identified `0.0.22-beta` and the formal database
  path. After shutdown, the active database again passed `PRAGMA integrity_check`; its observed
  counts were 30 Projects, 15 Tasks, 154 Sessions, and 2358 Messages. Final filesystem inspection
  found neither the expired visual-test paths nor the temporary native-acceptance paths active.

## Verification Plan

- Rust unit tests for official, alternate-identifier, and explicit-portable runtime paths.
- `bun test packages/overlay/test/official-runtime-paths.test.ts`
- Focused Rust tests for `overlay_runtime_paths` and sidecar process ownership.
- `bun test packages/opencorvus/test/storage/db-path.test.ts`
- Overlay and OpenCorvus typechecks.
- Isolated alternate-identifier native macOS build and real sidecar health/database-path proof.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- Applicable document-health and docs single-source tests.
- `git diff --check`, exact task-owned diff review, staged-path review, commit, hook-clean push.

## Verification Results

- `bun test packages/overlay/test/official-runtime-paths.test.ts`: 7 passed, 0 failed.
- `cargo test --manifest-path packages/overlay/src-tauri/Cargo.toml overlay_runtime_paths -- --nocapture`:
  4 passed, 0 failed.
- `bun test packages/opencorvus/test/storage/db-path.test.ts`: 40 passed, 0 failed, 177 assertions.
- Overlay `bun run typecheck`: passed.
- Historical links: 22 passed. Product documentation single-source checks: 8 passed.
- Native alternate-identifier acceptance: passed with an isolated database and unchanged formal
  database counts during the runtime window.
