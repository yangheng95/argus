# Desktop Managed Sidecar Ownership and Session Diff Failure Isolation

Status: implementation complete

## Recall

### User request

- Diagnose and fix the failure where a backend restart made Goal/runtime content disappear and the scheduler reported `EPERM: operation not permitted` while opening a project-scoped `.opencorvus/.r/c/sdiff/<project>/<session>.json` file.
- Do not treat an installer build as the root fix.

### Acceptance criteria

1. A Desktop Overlay backend cannot survive the owning Overlay process and later coexist with its replacement against the same SQLite database and project runtime.
2. Desktop and Visual Studio Code managed servers use the same atomic ownership-lock and parent-watchdog implementation; there is no second process registry or process-name scan.
3. One ownership scope admits at most one live managed server. Different Visual Studio Code workspaces remain independently admissible.
4. A session-diff derived-cache write failure is logged with the session identity and returned by the publication boundary for direct callers, but does not turn a completed agent turn into an Orchestrator failure or emit a false terminal session error.
5. Session-diff publication remains single-source and atomic; readers never accept partial JSON.
6. Existing task, Goal, plan, decision-log and progress data remain untouched. No database reset, compatibility branch, retry loop or filesystem permission fallback is introduced.
7. Focused TypeScript, Rust, CLI lifecycle and document-health tests pass, followed by a second diff review.
8. Changes are committed with the `dsw-33987` prefix and pushed to `myhexin/v0.0.11beta` without restarting the user's running OpenCorvus processes.

### Hard constraints

- Preserve unrelated uncommitted Provider, Work Ledger, Projects-toolbar, SDK and documentation work, including the existing non-overlapping settings edits in `packages/overlay/src-tauri/src/main.rs`.
- Do not kill, restart, refresh or replace either currently running Overlay/backend process without explicit runtime authorization.
- Do not infer failure causality from task/session names. Use process, database, filesystem, event-log and code-path evidence.
- Do not add a host preflight gate, mechanical retry, PID file registry, process-name matcher or fallback cache path.
- macOS signing credentials and notarization are release inputs. Code must not claim that an ad-hoc installer creates a stable Transparency, Consent, and Control identity.

### Evidence collected

- At failure time, backend processes `79228` (`127.0.0.1:7878`) and `97292` (`127.0.0.1:7879`) concurrently held the same `opencorvus.db` and write-ahead log.
- The old backend survived its Overlay owner. The replacement selected the next port because `next_server_port()` treats an occupied default port as a reason to start another server.
- Desktop `start_server()` launches `opencorvus serve`; it does not use the existing `SidecarLock` or `ParentWatchdog` used by the Visual Studio Code `sidecar` command.
- Durable SQLite evidence still contained 9 `engine_goal` rows, 9 plan nodes, 33 requirements, 12 progress snapshots and 41 decision-log rows. The runtime disappearance was not deletion.
- Progress evidence recorded both the session-diff `open` failure and a contemporaneous project `expert-squads` `scandir` failure. POSIX ownership, mode and access-control-list inspection did not show a discretionary permission denial.
- The exact session-diff file later wrote successfully at the same path, proving the reported error was transient and not a permanently read-only target.
- `SessionSummary.summarizeSession()` catches summary-metadata failure but directly awaits `writeDiff()`, allowing a derived-cache write error to reject the agent completion path.
- The packaged macOS app and extracted sidecar are ad-hoc signed with no stable Developer ID identity. Apple documentation states that protected-location access may fail with `EPERM`, persistent user-selected access requires security-scoped bookmarks in sandboxed deployments, and dynamic access granted after launch is not automatically inherited as a static child entitlement. System TCC logs were not readable in the current terminal, so the precise macOS mandatory-access-control subsystem that issued this instance's denial remains unproven.

### Sources read

- `AGENTS.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-17-sidecar-payload-lease-garbage-collection.md`
- `packages/overlay/src-tauri/src/main.rs`
- `packages/overlay/src-tauri/Cargo.toml`
- `packages/opencorvus/src/cli/cmd/{serve,sidecar}.ts`
- `packages/opencorvus/src/server/{sidecar-lock,parent-watchdog,shutdown,stop}.ts`
- `packages/opencorvus/src/session/{index,summary}.ts`
- `packages/vscode-extension/src/sidecar/manager.ts`
- Existing sidecar, parent-watchdog, serve-shutdown and session tests.
- Apple Developer documentation for macOS protected file access and child-process sandbox inheritance.

### Whole-repository call-point inventory

| Surface | Call points and disposition |
| --- | --- |
| Desktop spawn | `main.rs::start_server()` is the only bundled Desktop backend spawn owner. Replace bare `serve` arguments with managed ownership and the Overlay parent process identity. |
| Desktop settlement | `stop_server()`, `restart_server()`, `ensure_server()` and `RunEvent::Exit` are the only Desktop child settlement paths. Preserve them; parent watchdog covers abnormal parent loss. |
| Port selection | `next_server_port()` is the only Desktop port allocator. Retain dynamic port selection only after ownership is acquired; port availability must not authorize a second owner. |
| Managed lock | `server/sidecar-lock.ts` owns strict lock validation, liveness detection, atomic exclusive creation and ownership-checked release. Keep that canonical storage implementation and project an explicit ownership scope through one shared lifecycle composition used by both hosts. |
| Parent watchdog | `server/parent-watchdog.ts::start()` is the only parent-liveness implementation. Reuse it; do not add Rust polling. |
| Visual Studio Code spawn | `vscode-extension/src/sidecar/manager.ts::startSidecar()` is the only extension spawn caller. Its existing workspace and parent arguments already provide the required explicit ownership inputs, so retain the external contract and route the CLI command through the shared composition. |
| CLI managed lifecycle | `cli/cmd/sidecar.ts` is the sole current lock/watchdog composition. Extract shared managed ownership composition used by both `serve --managed-*` and `sidecar`. |
| Session-diff path | `ProjectRuntimePaths.sessionDiffPath()` is the only canonical target builder. Retain it unchanged. |
| Session-diff writes | `SessionSummary.writeDiff()` has two callers: terminal summarization and filename-normalization repair. Make the canonical write atomic; terminal summarization logs an explicit session-scoped diagnostic and returns a failed-storage result without rejecting the completed turn; normalization already logs asynchronously and remains non-terminal. |
| Session-diff reads | `Session.diff()` and `SessionSummary.readDiff()` accept only `ENOENT` as empty and propagate malformed/permission errors. Retain this strict read behavior. |
| Session error semantics | `Session.Event.Error` is a terminal execution signal consumed by the Orchestrator. Do not misuse it for a derived-cache publication failure after the turn completed; record the diagnostic in the canonical server log with the session identity and expose it as the `publishDiff()` result. |

### Independent agent feedback

- No sub-agent was created because the user did not request delegation and current collaboration instructions prohibit implicit spawning. The primary agent owns implementation and the second review.

## Implementation plan

1. Add failing tests for Desktop managed spawn arguments, shared ownership contention/parent loss, atomic session-diff publication and non-terminal write failure.
2. Project an explicit managed-server ownership scope through a shared lock/watchdog composition while retaining the existing canonical lock storage implementation.
3. Make Desktop `serve` require the parent process and one data-root ownership scope when launched by Overlay; keep ordinary user-invoked `serve` unmanaged.
4. Make session-diff storage atomic and isolate its derived-cache failure at the publication boundary without emitting a false terminal session-error event.
5. Run focused suites, Rust tests, typecheck and docs health; inspect the final diff for state duplication, fallback logic and overlap with existing user changes.

## Implementation and verification

- Added `ManagedServerOwnership` as the single composition of the existing atomic `SidecarLock` and `ParentWatchdog`; both the Visual Studio Code `sidecar` command and Desktop-managed `serve` now use it.
- Desktop `start_server()` passes the canonical data-root scope and Overlay parent PID. Ordinary user-invoked `serve` remains explicitly unmanaged.
- Session-diff writes now use `Filesystem.writeAtomic()`. Publication occurs only after durable replacement succeeds; a storage failure returns `{ stored: false }` and logs the session identity without rejecting the completed turn.
- Corrected `serve` shutdown settlement so cleanup failures exit non-zero rather than being overwritten by a `.finally()` success exit.
- Verified focused TypeScript suites (41 tests), real managed CLI lifecycle/sidecar contention and shutdown suites (11 tests), the post-review lifecycle subset (8 tests), Rust tests (52 tests), and TypeScript typechecks for OpenCorvus, Overlay and the Visual Studio Code extension.
- Historical-link and product-document single-source tests pass. The aggregate document-health test still reports the separate, pre-existing untracked `2026-07-20-tool-schema-budget-unit-consistency.md` record linked by concurrent workspace work; this repair does not stage or modify that record.
- No running Overlay/backend process was restarted or terminated. The two legacy processes observed before the fix remain runtime state requiring an explicitly authorized restart after an updated build is installed.
