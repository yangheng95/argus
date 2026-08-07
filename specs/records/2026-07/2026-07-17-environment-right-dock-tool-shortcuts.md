# Environment Right Dock Tool Shortcuts

## Recall

| Item | Detail |
| --- | --- |
| User request | Put every Right Dock component tool except Terminal and Mailbox in the environment-information popover shown by the supplied Codex reference, with the same presentation and opening behavior as Goals, Architecture, and Requirements. |
| Acceptance criteria | Browser, Review, Files, and Screenshots appear as peer environment navigation rows beside the existing task-scope shortcuts. Activating any row closes the popover, opens the canonical Right Dock, and selects the existing panel. Requirements, Architecture, and Goals retain their data-owned visibility and summaries. Terminal and Mailbox remain excluded from the environment list. No second panel state, panel body, catalog, or navigation event is introduced. Focused source tests, Overlay TypeScript/internationalization/build, Node-launched browser behavior, a task-scoped screenshot, manual visual review, document health, and a second diff review pass. |
| Hard constraints | Desktop-only. Keep `RIGHT_DOCK_CATALOG`, `centerWorkbenchPanels`, `openRightActivity`, Kobalte Popover, and shared Button as the only catalog/state/interaction owners. Reuse the existing environment row geometry; do not add a second Dock registry, duplicated component body, fallback, temporary iframe, or synthetic UI state. Playwright runs with Node. Do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus/Overlay. Preserve unrelated dirty worktree changes and stage only task-owned files/hunks. Commit subjects use `dsw-33987`; push only to `myhexin`. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-9dcaeddc-df53-4f39-b075-4a9250f4a16c.png` shows the compact Environment information surface and the navigation/resource region immediately before Sources. |
| Sources read | `AGENTS.md`; Browser skill; `specs/current/architecture/{07-panel,99-principles}.md`; `2026-07-08-right-toolbar-runtime-status-panel-merge.md`; `2026-07-15-codex-sidebar-search-environment-parity.md`; `2026-07-16-overlay-worktree-shortcuts-chat-files-and-button-system.md`; `2026-07-17-environment-popover-codex-completion.md`; `2026-07-17-right-dock-add-menu-disabled-state-color.md`; current `App`, `main`, `RightDock`, `TaskDirBar`, environment styles, source tests, and browser tests. |
| Whole-repository grep | Enumerated every `onOpenTaskScopePanel`, `ProjectTaskScopePanel`, `taskScopeShortcuts`, `project-task-scope-*`, `RIGHT_DOCK_CATALOG`, `RightDockPanel`, `openRightActivity`, `openCenterWorkbenchPanel`, environment-popover style/test selector, and Browser/Review/Files/Screenshots locale label call site. `TaskDirBar` is the only environment renderer; `RightDock` owns the only user-addable catalog; `main.openRightActivity` owns the canonical open/select path. |
| Independent agent feedback | None. The user did not request sub-agents, and current collaboration policy does not authorize unrequested delegation. |
| Git baseline | After fetching `myhexin`, `HEAD` and `myhexin/work-v0.0.8beta-yr-0717` are equal (`0 0`) at `0b0c686c8`. The worktree already contains unrelated Overlay style/browser/spec changes; they are preserved and excluded from this task's commit. |

## Root cause

The environment popover currently models only task-scope navigation as shortcuts even though those rows already invoke the canonical Right Dock open function. Browser, Review, Files, and Screenshots are registered in `RIGHT_DOCK_CATALOG` but are projected only through the Dock's `+` menu. The missing surface is therefore a catalog projection gap, not a missing panel or state problem. Copying tool metadata or inventing an environment-specific open event would create a second source; the repair must derive the additional rows from the existing catalog and thread the existing typed Right Dock callback through `App`.

## Call-site disposition

| Owner / call site | Decision |
| --- | --- |
| `RightDock.RIGHT_DOCK_CATALOG` | Remain the sole user-addable tool metadata source. Export a derived environment catalog that excludes only the explicit Terminal and Mailbox exceptions and task-scope entries whose visibility/summary remains board-owned. |
| `TaskDirBar.taskScopeShortcuts` | Preserve Requirements/Architecture/Goals data-owned visibility and summaries. Combine them with the derived Browser/Review/Files/Screenshots metadata into one generic environment tool list. |
| `TaskDirBar.ProjectRuntimeStatusPanel` | Render every shortcut through one shared row primitive/loop. Each row calls the threaded Right Dock callback and closes the Kobalte popover. Remove task-scope-only class/data naming from this now-generic surface. |
| `App` and `main` | Widen the existing callback type to `RightDockPanel` and keep `openRightActivity` as the implementation. Do not add an event bus or store. |
| `conversation.css` | Rename only the shortcut selectors to generic environment-tool ownership; retain the accepted geometry and tokens. |
| `task-cwd-row-layout.test.ts` | Assert the derived catalog, exclusions, typed callback, generic one-loop rendering, and absence of duplicated metadata/open logic. |
| `browser/task-dirbar-keyboard.test.ts` | Assert the seven visible rows and peer geometry, verify empty task data still leaves the four static tools, activate a static tool through the real page, confirm popover close/canonical Dock selection, and refresh the scoped screenshot. |
| Spec indexes | Index this record without rewriting unrelated in-progress entries. |

## Implementation plan

1. Derive the environment tool metadata from `RIGHT_DOCK_CATALOG`, excluding Terminal, Mailbox, and the separately summarized task-scope entries.
2. Replace task-scope-only shortcut naming with one generic environment tool list and widen the existing callback type through `TaskDirBar`, `App`, and `main`.
3. Update source and Node-launched browser regressions for all visible tools, exclusions, board-owned task-scope visibility, static-tool navigation, and screenshot evidence.
4. Run focused tests, Overlay type/i18n/build checks, document health, and the real browser scenario; inspect the screenshot and correct visual defects before acceptance.
5. Perform a second source/diff review, update this record with evidence, selectively commit task files with `dsw-33987`, and push the current branch to `myhexin`.

## Verification plan

```powershell
bun test packages/overlay/test/task-cwd-row-layout.test.ts packages/overlay/test/right-dock-panel-ownership.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay check:i18n
bun run --cwd packages/overlay build
$env:OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER='1'
node --test --test-concurrency=1 --test-name-pattern="chat header environment panel matches" packages/overlay/test/browser/task-dirbar-keyboard.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```

## Progress

- [x] Recalled constraints, inspected supplied evidence, and enumerated call sites.
- [x] Implemented the single-source environment tool projection.
- [x] Updated focused and real-browser regressions.
- [x] Completed screenshot review; the accepted row geometry required no further visual correction.
- [x] Completed second diff/source review and isolated the task-owned index for git-cc delivery.

## Verification evidence

- Focused source tests passed: 9 tests, 227 expectations.
- Overlay TypeScript and panel internationalization checks passed.
- The production Vite build passed after transforming 2,492 modules.
- The Node-launched real-browser scenario passed and covered populated task-scope data, an empty task-scope state, and canonical Review/Goals Right Dock activation.
- Task-scoped screenshots confirm Browser, Review, Files, and Screenshots share the accepted Requirements/Architecture/Goals alignment, font weight, spacing rhythm, icon-free presentation, and scrollable popover ownership. The empty-data screenshot confirms those four static tools remain visible without synthesizing task-scope rows.
- `git diff --check` passed. The historical-links, document-health, and product-documentation single-source suite passed: 81 tests, 1,282 expectations.
