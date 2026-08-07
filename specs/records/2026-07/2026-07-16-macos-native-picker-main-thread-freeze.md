# macOS native picker main-thread freeze repair

## Recall

| Field | Evidence |
| --- | --- |
| User request | Diagnose and fix Overlay freezing on macOS when opening a project folder. |
| Acceptance criteria | Opening the native project-folder picker must not block the Tauri main thread on macOS; folder and file picker commands must use one consistent safe scheduling model; cancel and malformed-path behavior must remain unchanged; focused tests, Rust compilation/tests, Overlay typecheck, documentation health, and a second diff review must pass. |
| Hard constraints | Fix the native scheduling root cause without UI fallback, a second picker source, a route gate, or a state machine; preserve `HostTransport` and `workspace.pickDir` / `workspace.pickFiles` as the canonical contracts; do not restart or interfere with the running Overlay; preserve unrelated worktree changes; commit with `dsw-33987` and push `myhexin/v0.0.7beta`. |
| Sources read | `AGENTS.md`; `packages/overlay/src/services/workspace.ts`; `packages/overlay/src/services/tauri-transport.ts`; `packages/overlay/src-tauri/src/main.rs`; `packages/overlay/src-tauri/Cargo.toml`; `packages/overlay/test/host-transport-capabilities.test.ts`; Tauri dialog plugin API and source documentation. |
| Whole-repository search evidence | `rg` found one folder-picker native owner (`overlay_pick_dir`), one file-picker native owner (`overlay_pick_files`), their two `TauriHostTransport` dispatch arms, the `workspace.pickDir` / `workspace.pickFiles` protocol variants, and all UI/test callers. Only the two Rust owners call `blocking_pick_folder`, `blocking_pick_files`, or `blocking_pick_file`; both are synchronous Tauri commands. |
| Git baseline | `v0.0.7beta` matched `myhexin/v0.0.7beta` (`0 0`) before task edits and a pre-change push completed. The worktree already contained unrelated Provider UI/spec changes and a Darwin artifact directory; they remain outside this task's commit. |
| Independent agent feedback | None. The user did not request delegation, and the active collaboration policy forbids unrequested sub-agents. |

## Root-cause chain

1. The Projects open-folder action calls `browseDirectory()`, which sends the canonical `workspace.pickDir` HostTransport command.
2. The Tauri transport invokes the synchronous Rust command `overlay_pick_dir`.
3. That synchronous command calls `blocking_pick_folder()`. The Tauri dialog API explicitly states that blocking picker methods must not run on the main thread because they freeze the application; its command example places the blocking call in an asynchronous Tauri command.
4. macOS native dialogs depend on the application event loop. Blocking the command on that thread prevents the picker/application from completing normal event processing, which is observed as the whole Overlay hanging.
5. The file picker has the same scheduling defect through `overlay_pick_files`; leaving it synchronous would preserve the same root bug on attachment/import surfaces.

## Call-site disposition

| Owner / caller | Current behavior | Disposition |
| --- | --- | --- |
| `workspace.ts::browseDirectory` and `pickDirectory` | Canonical project-folder selection and strict string validation | Preserve unchanged. |
| `tauri-transport.ts` | Maps `workspace.pickDir` to `overlay_pick_dir` | Preserve unchanged. |
| `main.rs::overlay_pick_dir` | Synchronous Tauri command calls `blocking_pick_folder()` | Convert the command to `async fn` so Tauri dispatches it away from the main-thread synchronous command path; preserve result conversion and cancellation semantics. |
| `workspace.ts::pickFiles` and all attachment/import callers | Canonical multi-file selection and strict array validation | Preserve unchanged. |
| `main.rs::overlay_pick_files` | Synchronous Tauri command calls blocking single/multi-file methods | Convert to the same asynchronous command scheduling model; preserve filters, multiplicity, ordering, conversion, and cancellation semantics. |
| `host-transport-capabilities.test.ts` | Covers malformed native picker payloads but accepts synchronous blocking command ownership | Add regression assertions that both blocking picker owners are asynchronous Tauri commands. |

## Implementation plan

1. Convert both native picker command functions to asynchronous Tauri commands, without adding a parallel callback implementation or changing transport payloads.
2. Extend the focused source contract test to reject a regression back to synchronous blocking picker commands.
3. Run the focused Bun test, Rust formatting/check/tests, Overlay typecheck, documentation-health tests, and `git diff --check`.
4. Review the exact task diff separately from unrelated worktree changes, record validation, commit only task files, and push `myhexin/v0.0.7beta`.

## Verification plan

```bash
bun test packages/overlay/test/host-transport-capabilities.test.ts
cargo fmt --manifest-path packages/overlay/src-tauri/Cargo.toml -- --check
cargo check --manifest-path packages/overlay/src-tauri/Cargo.toml
cargo test --manifest-path packages/overlay/src-tauri/Cargo.toml
bun run --cwd packages/overlay typecheck
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```

## Validation record

- `bun test packages/overlay/test/host-transport-capabilities.test.ts`: 6 passed, 0 failed; the picker contract now rejects synchronous blocking picker ownership.
- `cargo fmt --manifest-path packages/overlay/src-tauri/Cargo.toml -- --check`: passed.
- `cargo check --manifest-path packages/overlay/src-tauri/Cargo.toml`: passed on the macOS host target. The only warnings are pre-existing conditional taskbar badge helpers outside this change.
- `cargo test --manifest-path packages/overlay/src-tauri/Cargo.toml`: 30 passed, 0 failed.
- `bun run --cwd packages/overlay typecheck`: passed.
- The isolated desktop Vite preview was opened through the Browser skill, its File menu was interacted with, and the resulting screenshot was inspected. The HTML surface remains visually unchanged; the isolated web-only host correctly omits native-only Open Folder because it does not advertise the Tauri picker capability.
- Historical links, document health, and product-doc single-source checks passed: 80 passed, 0 failed. The unrelated concurrent window-chrome record was temporarily included in Git's tracked-file view for this read-only health check because its separate worktree change had already indexed that record from the shared monthly README; it remains unstaged and outside this task's commit.
- `git diff --check`: passed before staging.
