# Workspace Editor Native Launch Repair

## Recall

| Item | Evidence |
| --- | --- |
| User request | Repair the broken workspace quick-open menu. The supplied screenshots show the existing editor dropdown and a VS Code launch failure: `No such file or directory (os error 2)`. |
| Acceptance criteria | Selecting any supported editor continues to route through the existing workspace native command; the desktop host launches installed graphical editor applications without depending on a terminal-only `PATH`; empty targets remain no-ops; launch errors remain visible through the existing localized error dialog; focused native and Overlay tests, formatting, type checks, document-health checks, and a second diff review pass. |
| Hard constraints | Preserve all pre-existing uncommitted changes; do not reset, stash, create a worktree, or disturb the running OpenCorvus/Overlay; use one mature native launch implementation with no fallback, compatibility branch, gate, state machine, or duplicate frontend owner; no frontend layout or interaction change is authorized or required. |
| Supplied evidence | `codex-clipboard-55c7b2f9-26b4-4d21-adb6-c4335144fff2.png` shows the six existing launcher options. `codex-clipboard-b5888193-3c1a-45cc-81c4-851bc44538da.png` shows that VS Code selection reaches the error owner but native process creation fails with operating-system error 2. Both images were inspected at original resolution. |
| Sources read | `AGENTS.md`; `specs/README.md`; `specs/records/2026-07/README.md`; `specs/current/architecture/99-principles.md`; the prior workspace launcher records from 2026-07-15; `WorkspaceEditorLaunchers.tsx`; `workspace.ts`; `host-transport.ts`; `tauri-transport.ts`; the Tauri `main.rs`; installed `tauri-plugin-opener` 2.5.3 and its `open` 5.3.3 dependency source; official Tauri opener documentation. |
| Whole-repository search evidence | `WorkspaceEditorLaunchers` is the single menu owner and calls `openDirectoryInEditor`; `workspace.ts` is the single error/log owner and emits `workspace.openProjectEditor`; `tauri-transport.ts` maps that command only to `overlay_open_project_editor`; the VS Code extension bridge has its own VS Code-host implementation; Tauri `main.rs` is the only desktop native process launcher and currently calls `Command::new` with `code`, `pycharm`, `webstorm`, `idea`, or `cursor`; the same Rust file already registers the command in its mobile and desktop invoke handlers and contains the native unit-test module. |
| Independent agent feedback | None. The user did not request sub-agents, and current collaboration rules prohibit proactive delegation. |

## Root cause and causal chain

The menu and Overlay transport succeed: the visible localized dialog proves the request reached `openProjectPathInEditor`, invoked the Tauri native command, and returned its native error. The direct trigger is `Command::new("code")` failing to resolve an executable. The deeper cause is that the desktop host models graphical editors as terminal command names and depends on the GUI process `PATH`; on macOS, an application launched from Finder does not inherit the terminal environment in which a user may have installed the `code` shell command. The previous implementation therefore tested only command routing, not the native graphical-application launch contract.

The repository already depends on `tauri-plugin-opener`, whose `open_path(path, Some(application))` API is the mature single source for opening a path with a selected application. Its macOS implementation uses `/usr/bin/open -a <application>`, its Windows implementation uses the native detached application launcher, and its Unix implementation invokes the selected program. Reusing this existing dependency removes the duplicate raw-process launcher and does not add a fallback.

## Call-site disposition

| Owner / call site | Decision |
| --- | --- |
| `WorkspaceEditorLaunchers.tsx` | Keep unchanged; the menu, selection, capability projection, and error presentation already behave correctly. |
| `workspace.ts::openDirectoryInEditor/openProjectPathInEditor` | Keep unchanged as the only path-resolution, log, and localized-error owner. |
| `host-transport.ts` and `tauri-transport.ts` | Keep the existing typed command and exact Tauri invoke mapping unchanged. |
| `src-tauri/main.rs::ProjectEditor` | Replace terminal command naming with the operating-system application identifier consumed by the existing opener dependency. |
| `src-tauri/main.rs::overlay_open_project_editor` | Accept the existing app handle and delegate to `app.opener().open_path(path, Some(editor application))`; delete raw `Command::new` editor spawning. |
| `src-tauri/main.rs` native unit tests | Enumerate all supported editor-to-application mappings for the current target operating system so future launch regressions fail before packaging. |
| VS Code extension bridge | Keep unchanged; it is a separate host implementation that already uses VS Code application programming interfaces rather than the Tauri desktop launcher. |

## Implementation and verification plan

1. Replace the Tauri editor process launcher with the already-installed opener plugin and add target-specific mapping tests.
2. Run Rust formatting and focused native tests, then the existing Overlay workspace/transport tests and type check.
3. Run required spec link/document single-source checks, `git diff --check`, and a second source/diff review.
4. Commit only task-owned files with the required `dsw-33987` subject and push the current main branch to `legacy-remote`; do not include unrelated dirty files.

## Validation record

- `cargo fmt --manifest-path packages/overlay/src-tauri/Cargo.toml -- --check` passed.
- `cargo test --manifest-path packages/overlay/src-tauri/Cargo.toml` passed all 53 native tests, including the new five-editor application mapping regression.
- `bun test test/workspace-editor.test.ts test/host-transport-capabilities.test.ts` passed 13 tests and 100 assertions.
- `bun run typecheck` passed in `packages/overlay`.
- macOS metadata lookup found the installed application at `/Applications/Visual Studio Code.app`, matching the native opener identifier `Visual Studio Code` without relying on the terminal `code` command.
- Historical-link and product-document single-source checks passed. The combined document suite has 86 passing tests and one pre-existing workspace failure outside this task: the monthly index links two other tasks' record files that remain untracked. This task preserves those user-owned files and does not claim the combined suite passed.
- `git diff --check` passed after removing the planning record's extra trailing blank line.
