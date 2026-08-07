# Workspace File Manager Launcher

## Recall

| Item | Evidence |
| --- | --- |
| User request | Add another open method to the workspace `打开于` dropdown shown in the supplied screenshot so the current project can be opened from the folder/file-manager surface. |
| Acceptance criteria | The dropdown keeps every supported Integrated Development Environment (IDE) launcher and adds one file-manager item; selecting it closes the menu and opens the active project directory through the host's existing native path opener; the item is visible only when that host capability exists; Chinese and English labels use the existing localization source; focused source, interaction, type, document-health, and visual screenshot checks pass. |
| Hard constraints | Preserve the user's pre-existing uncommitted overlay edits; use `openDirectory()` and `HostTransport` as the single source; do not add a fallback, compatibility path, gate, state machine, new host command, or hand-written menu primitive; do not restart or disturb the running OpenCorvus/overlay; use Node-based Playwright/browser verification and inspect a task-scoped screenshot. |
| Sources read | `AGENTS.md`; `specs/README.md`; `specs/records/2026-07/README.md`; `WorkspaceEditorLaunchers.tsx`; `WorkspaceSplitLauncher.tsx`; `workspace.ts`; `native.ts`; `host-transport.ts`; `tauri-transport.ts`; Tauri `main.rs`; relevant i18n, conversation styles, overlay tests, and Browser skill instructions. |
| Whole-repository search evidence | `workspace.editor_open` has one UI owner in `WorkspaceEditorLaunchers.tsx`; `cwd.open` already owns the file-manager label in both locales; `openDirectory()` is the existing current-directory service and delegates to `nativeOpen()`; `nativeOpen()` sends the `open-path` `NativeCommand`; Tauri maps it to `overlay_open_path`, which calls `tauri-plugin-opener`; host capability truth is `nativeCommands["open-path"]`; existing IDE entries call only `openDirectoryInEditor()`; related assertions live in `composer-file-loader-right-toolbar.test.ts` and browser toolbar tests. |
| Independent agent feedback | No independent agents were requested, so none were started. The main agent performed the repository-wide call-site audit required for this focused change. |

## Current behavior and root cause

The workspace split launcher renders only `PROJECT_EDITORS`. The operating-system file manager is already supported by the workspace service and native host, but `WorkspaceEditorLaunchers` never projects that existing action into its dropdown. The missing menu item is therefore a UI capability-projection omission, not a missing backend feature.

## Call-site disposition

| Surface | Decision |
| --- | --- |
| `WorkspaceEditorLaunchers.tsx` | Import `Show` and existing `openDirectory()`, read `nativeCommands["open-path"]`, and append one Kobalte-backed `WorkspaceSplitLauncherItem` after the IDE entries. Close the menu before invoking the service. |
| `workspace.ts::openDirectory()` | Keep unchanged as the sole current-directory/file-manager action and error owner. |
| `native.ts::nativeOpen()` | Keep unchanged as the sole URL/path native-open dispatcher. |
| `host-transport.ts` capability maps | Keep unchanged; visibility reads the existing capability rather than inferring a host. |
| `tauri-transport.ts` and `src-tauri/main.rs` | Keep unchanged; the existing `open-path` route already opens directories with the operating-system default file manager. |
| `cwd.open` i18n entries | Reuse unchanged: `Reveal in File Manager` / `在文件管理器中打开`. |
| IDE launcher loop | Keep unchanged; the new item is a sibling action and does not alter the selected default IDE. |

## Implementation and verification

1. Add the capability-backed file-manager item using the existing folder icon and launcher primitive.
2. Add focused source assertions for capability ownership, ordering, label reuse, and the canonical action.
3. Add or extend a Node Playwright browser check that opens the dropdown, verifies keyboard/click interaction and the emitted native `overlay_open_path` command, and captures the current delivery surface.
4. Run focused tests, overlay typecheck/build checks, and spec/document-health checks.
5. Start an isolated preview without touching the user's running overlay, inspect the screenshot, correct any visual mismatch, then re-run verification.
6. Commit only the files owned by this task with the required `dsw-33987` prefix and push to the legacy remote.

## Validation record

- Implementation: `WorkspaceEditorLaunchers` reads the existing host `open-path` capability and renders `cwd.open` after the supported IDE list. Selection closes the Kobalte menu and delegates to the unchanged `openDirectory()` service.
- Focused source test: `bun test packages/overlay/test/composer-file-loader-right-toolbar.test.ts` passed (3 tests, 113 assertions).
- Type verification: `bun run --cwd packages/overlay typecheck` passed.
- Production render: `vite build --config vite.config.ts` passed while the Node browser runner prepared the isolated fixture (2,444 transformed modules).
- Interaction verification: `OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1 node --test --test-concurrency=1 --test-name-pattern="workspace editor menu opens" test/browser/titlebar-toolbar-toggle-browser.test.ts` passed. It verified the file-manager item, menu geometry, one folder icon, close-on-select, and the exact `overlay_open_path` target `D:/overlay/workspace/app`.
- Visual review: `.scratch/workspace-editor-file-manager-option.png` was opened at original resolution and inspected. The sixth file-manager row aligns with the five IDE rows, stays within the menu bounds, uses the same density and hover-ready primitive, and introduces no clipping or overlap.
- Spec link verification: `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` passed (20 tests).
- Document-health verification passed (53 tests), and product-document single-source verification passed (4 tests).
- Full overlay i18n verification currently reports four unrelated locale keys made unused by the user's pre-existing uncommitted `TaskDirBar` redesign (`project_runtime.summary`, `worktree.cleanup_expired_confirm`, `worktree.cleanup_failed`, `worktree.cleanup_reload_failed`). This task does not modify or stage those user-owned locale files; the focused test verifies the reused `cwd.open` key in both locales.
