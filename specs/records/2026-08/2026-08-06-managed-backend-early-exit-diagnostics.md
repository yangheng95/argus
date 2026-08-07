# Managed Backend Early-Exit Diagnostics

Status: Implemented and verified
Date: 2026-08-06
Owner: Codex

## Recall

### User requirement

The operator reported `[1785947449] managed backend did not become healthy within 30 seconds: managed backend has no active process`, asked why the database failed again and who changed it, then explicitly authorized closing the active database-owning process before repairing the defect.

### Acceptance criteria

- Close the exact live source backend that owns the production database before changing code.
- Preserve the one-database/one-runtime ownership boundary; do not bypass or weaken the conflict.
- If the managed sidecar exits before health readiness, fail immediately with its real exit status, bounded captured output, and canonical sidecar-log path.
- Preserve the sidecar-log path through the startup failure surface instead of querying already-cleared child state.
- Verify the non-User-Interface process/diagnostic contract with focused Rust tests.
- Reproduce the real ownership conflict with a live source backend and the packaged Windows Overlay, inspect the visible failure dialog, and capture a task-bound screenshot without creating or running User-Interface automation tests.
- Complete a second source/evidence review, commit with the `dsw-33987` prefix, and push the main delivery branch to legacy remote.

### Hard constraints

- `Database.Path()` remains the sole physical runtime ownership scope.
- No database reset, migration, fallback, compatibility reader, route bypass, or startup gate.
- No User-Interface test additions, modifications, or executions.
- No negative tests; positive tests assert the complete current early-exit diagnostic contract.
- No new worktree and no destructive Git reset.
- All new abbreviations are expanded in comments or prose.

### Sources read

- `AGENTS.md`
- `packages/opencorvus/test/AGENTS.md`
- `specs/current/architecture/03-control.md`
- `specs/records/2026-08/2026-08-04-single-runtime-owner-and-phase-closure-recovery.md`
- `packages/opencorvus/src/server/runtime-server-ownership.ts`
- `packages/overlay/src-tauri/src/main.rs`
- `C:/Users/hengu/AppData/Local/opencorvus/log/overlay-startup.log`
- `C:/Users/hengu/AppData/Local/opencorvus/log/sidecar-1785947416-28420.log`
- `C:/Users/hengu/AppData/Local/opencorvus/log/2026-08-05T163022-21472-1.log`

### Whole-repository search

Repository search covered the exact timeout and ownership-conflict messages, `SCHEMA_RESET_REQUIRED`, `current_server_info`, `wait_for_server_health`, startup-progress failure emission, sidecar standard-output capture, runtime ownership acquisition, restart handoff, and recent storage/Data Definition Language changes. The incident did not contain a schema-reset failure. The live source backend at process identifier 23620 owned `opencorvus.db` and answered the port 7878 health route while the packaged sidecar attempted port 7879 against the same database.

### Independent agent feedback

No independent agent was requested for this repair. The main Agent will perform a separate post-implementation diff, runtime-evidence, and validation review before delivery.

## Proven cause chain

1. At 2026-08-05 23:54:06 +08:00, a source backend started as process identifier 23620 with `serve --hostname 127.0.0.1 --port 7878 --print-logs`.
2. At 23:54:10.556, it acquired the canonical database runtime lease for `C:/Users/hengu/AppData/Local/opencorvus/data/opencorvus.db`.
3. At 2026-08-06 00:28:04, the packaged Overlay started. Its embedded sidecar later attempted to serve on port 7879 using the same `OPENCORVUS_HOME`.
4. Runtime ownership correctly rejected the second process with `RuntimeServerOwnershipConflictError` and the sidecar exited.
5. `current_server_info` observed the exit but cleared `child`, `port`, and `sidecar_log_path`, returning only `None`.
6. `wait_for_server_health` treated that terminal observation as retryable absence for the remainder of 30 seconds.
7. The failure path queried `current_server_info` again, so it could no longer attach the sidecar log. The visible message therefore reported only `managed backend has no active process`.

## Design

Introduce one process observation result that distinguishes a running child, an inactive server, and a terminal child observation carrying exit status plus the already-recorded sidecar-log path. The health-readiness loop will return terminal and inactive observations immediately. Network or unhealthy-route observations remain bounded retries while the child is still running.

Represent startup failure as one typed Rust value containing the operator-visible message and optional sidecar-log path. A terminal child message includes a bounded tail of captured sidecar output so the primary failure, such as runtime database ownership conflict, is visible without searching another log. The startup surface consumes the path carried by this failure value; it does not attempt to reconstruct evidence from cleared process state.

The existing runtime ownership implementation is unchanged. Development beside a packaged application still requires a distinct explicit `OPENCORVUS_HOME`.

## Verification plan

- Rust formatting and focused `opencorvus-overlay` unit tests.
- Existing managed-server ownership and lifecycle non-User-Interface tests if the touched contract crosses their surface.
- Overlay TypeScript/Rust build checks required by the package scripts.
- Spec link and document-health tests required for the new record.
- Real Windows package conflict reproduction: start a source backend against the canonical home, launch the packaged Overlay, confirm failure occurs without the 30-second masking delay, inspect the dialog text and capture a screenshot, then close both processes and confirm the database owner is released.
- Final clean-worktree diff review, commit, legacy remote push, and remote equality check.

## Outcome

The exact database-owning source backend (process identifier 23620) and the stale packaged Overlay process were closed before implementation. The runtime ownership boundary was left intact; no schema, database contents, ownership acquisition, reset, fallback, or migration behavior changed.

Commit `403c17250a` introduced `ManagedBackendProcessObservation` and `ManagedBackendStartupFailure` in `packages/overlay/src-tauri/src/main.rs`. A terminal managed child now carries its exit status, bounded captured sidecar output, and canonical sidecar-log path directly through the startup failure surface. The health loop returns that terminal observation instead of converting it to retryable absence and later re-querying already-cleared state.

Positive Rust contract verification passed:

- `cargo test --manifest-path packages/overlay/src-tauri/Cargo.toml managed_backend_ -- --nocapture`
- Result: 2 passed, 0 failed. The tests positively assert complete terminal startup evidence and terminal process observation.

The full current Windows Overlay build passed with `bun run --cwd packages/overlay build:overlay`, including Internationalization checks, Vite production compilation, Software Development Kit generation, embedded server compilation and payload hashing, and the Tauri release build. The verified executable is `packages/overlay/dist/opencorvus-overlay-windows-x64/opencorvus-overlay.exe`.

`cargo fmt --manifest-path packages/overlay/src-tauri/Cargo.toml -- --check` passed. The current repository documentation authority, `bun run docs:check`, passed with 315 operations across 24 groups, and direct index-target resolution confirmed both the record and visual artifact. The three historical test paths named by the older documentation rule are absent on this branch; both prescribed invocation forms were attempted and reported no matching files, so the removed tests were not recreated.

Real conflict reproduction used source backend process identifier 13440 on port 7878 and packaged Overlay process identifier 30196. The sidecar logged `RuntimeServerOwnershipConflictError` at 2026-08-07 06:36:02.824 +08:00, naming the canonical database and owner process identifier. The supervisor recorded `early_exit` at 06:36:03.498, 674 milliseconds later, with exit code 1 and the canonical sidecar-log path. The visible dialog contained the same exit code, captured output, database path, owner process identifier, sidecar log, and Overlay diagnostic log. [Task-bound visual evidence](../../artifacts/2026-08-07-managed-backend-early-exit-dialog.png) was captured from the real native window and reviewed manually; no User-Interface test was created or run.

After the conflict evidence was captured, processes 30196 and 13440 were closed and ports 7878 and 7879 were released. The same rebuilt package was restarted as Overlay process identifier 24120. Its managed backend process identifier 26392 is its direct child, listens on port 7878, and returns `healthy: true` with version `0.0.33-beta` against the unchanged canonical database. This healthy Overlay remains running for the operator.

The second review re-read the implementation, focused test contract, runtime logs, process occurrence envelope, native screenshot, final diff, and repository checks. It found no ownership weakening, alternate database source, retry fallback, or hidden diagnostic reconstruction path.
