# Project actions secondary menu

## Recall

| Field | Evidence |
| --- | --- |
| User request | Make the OpenCorvus project row behave like the supplied Codex reference: keep only the new task/conversation action exposed and collect the other project actions in a secondary menu. The user clarified that “open in browser” was a slip and means “open in the file manager,” then approved the already-supported file-manager and rename capabilities as relevant menu actions. |
| Acceptance criteria | Each eligible project row shows an ellipsis menu trigger followed by the existing new-chat button; pin/unpin, open in file manager, rename, and remove are menu items when their capabilities are available; the actions keep canonical callbacks and error handling; pointer and keyboard operation work; a fresh desktop screenshot is visually reviewed against the supplied reference. |
| Hard constraints | Preserve `ProjectLedgerGroup` as the single project-heading owner and `WorkLedger` as its callback source; use the existing Kobalte dropdown and shared `Button`/`Icon` primitives; do not add reference-only actions without backend ownership; no fallback menu, hidden duplicate controls, mobile/tablet scope, new worktree, or interference with the running OpenCorvus process; browser fixtures run through Node. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-c6dcc4e4-87ee-4cc8-b0b3-cced653947e9.png`, inspected at original resolution. It shows a project heading with ellipsis first, new-conversation second, and project management actions in the ellipsis menu. |
| Sources read | `AGENTS.md`; Browser skill; `specs/current/architecture/07-panel.md`; `ProjectLedgerGroup.tsx`; `WorkLedger.tsx`; `Icon.tsx`; `sidebar.css`; existing Kobalte dropdown implementations in `RightDock.tsx`, `ChatComposer.tsx`, and `WorkspaceSplitLauncher.tsx`; focused source and Node browser tests. |
| Git baseline | `work-v0.0.6beta-yr-0716` at `4d2a92d7a`; `HEAD...legacy-remote/work-v0.0.6beta-yr-0716` is `0 0`. The worktree contains unrelated user changes, which remain unstaged and outside this task's commit. |
| Independent agent feedback | None. The user did not request delegation, and the active collaboration policy forbids unrequested sub-agents. |

## Whole-repository search evidence

- `ProjectLedgerGroup.tsx` is the only owner of `project-group-pin`, `project-group-new-chat`, `project-group-delete`, and the project action rail.
- `WorkLedger.tsx` is the only production caller of `ProjectLedgerGroup`; it supplies project pin persistence, new-chat creation, project selection, and project deletion callbacks.
- `workspace.ts::openDirectory` is the existing native file-manager owner and is capability-backed by the `open-path` host command. `PATCH /project/current` with `{ name }` is the existing canonical backend rename contract, but Overlay has no adapter or UI caller yet.
- `main.tsx` owns the canonical new-chat and deletion lifecycles and will own the new thin rename-dialog/open-directory adapters. No backend API semantics change.
- `sidebar.css` is the only production style owner for `.project-group-actions` and the three existing project action buttons.
- Kobalte `DropdownMenu` is already a dependency and is used by `RightDock`, `ChatComposer`, `TerminalPanel`, and `WorkspaceSplitLauncher`; it owns focus, dismissal, placement, and keyboard behavior.
- Static tests touching the project controls are `project-delete-button.test.ts`, `task-cwd-row-layout.test.ts`, `work-ledger-consolidation.test.ts`, `focused-popup-surface.test.ts`, and architecture/style guards.
- Node browser tests with direct project-action interaction or geometry are `project-ledger-group-browser.test.ts`, `project-directory-new-chat-browser.test.ts`, `command-palette.test.ts`, and `ledger-scrollbar-browser.test.ts`. HTML-only visual fixtures that embed the old direct rail are not production call sites and must be updated only if their asserted surface includes the changed control contract.

## Call-site disposition

| Owner / caller | Current behavior | Disposition |
| --- | --- | --- |
| `ProjectLedgerGroup` pin button | Direct glyph button in the hover rail | Replace with one dropdown menu item; keep `runProjectAction` and `onPinnedChange`. |
| `ProjectLedgerGroup` new-chat button | Direct glyph button in the hover rail | Keep as the only direct creation action and place it after the ellipsis trigger. |
| `ProjectLedgerGroup` file-manager action | Not exposed in the project row | Add a menu item only when `open-path` capability supplies the callback; call canonical `openDirectory(directory)`. |
| `ProjectLedgerGroup` rename action | Not exposed in Overlay although `PATCH /project/current` exists | Add a menu item, dialog adapter, strict Overlay response validation, refresh, and positive/negative contract tests. |
| `ProjectLedgerGroup` delete button | Direct danger glyph button in the hover rail | Replace with a danger-styled dropdown item; keep the existing confirmation lifecycle downstream. |
| `WorkLedger` project group wiring | Supplies pin/create/delete callbacks | Preserve unchanged. |
| `main.tsx` action owners | Creates Chat and confirms/deletes project state | Preserve unchanged. |
| Source/browser tests | Assume three simultaneously visible direct buttons | Update to assert the ellipsis-plus-new-chat hierarchy and open the menu before pin/remove interaction. |

## Implementation plan

1. Add the Lucide horizontal-ellipsis glyph to the existing `Icon` registry.
2. Replace the pin and delete direct buttons in `ProjectLedgerGroup` with Kobalte dropdown items, and add the capability-backed file-manager plus canonical project-rename items while preserving action/error ownership and stable `data-ui` selectors.
3. Replace the three-button rail styling with ellipsis/new-chat trigger styling and a focused-popup-token-backed menu surface whose rows align to the Codex reference.
4. Update focused source and Node browser regression coverage for hierarchy, visibility, menu geometry, keyboard focus, pin/unpin, remove, and direct new-chat behavior.
5. Run focused tests, Overlay typecheck/build/i18n, documentation health, a fresh Node browser fixture, inspect its screenshot at original resolution, correct visual issues, review the diff a second time, commit with `dsw-33987`, and push `legacy-remote`.

## Verification plan

```powershell
bun test packages/overlay/test/project-delete-button.test.ts packages/overlay/test/task-cwd-row-layout.test.ts packages/overlay/test/work-ledger-consolidation.test.ts packages/overlay/test/focused-popup-surface.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay check:i18n
bun run --cwd packages/overlay build
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/project-ledger-group-browser.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/project-directory-new-chat-browser.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```

## Validation record

- Overlay TypeScript typecheck and localization/hash validation passed (`6a8b3b1996db8977`).
- Focused service, action ownership, layout, popup, Work Ledger, and navigation-row tests passed: 26 passed, 0 failed.
- The Node-driven desktop project fixture passed with real menu geometry, keyboard focus return, native `open-path` invocation, rename dialog plus scoped `PATCH /project/current`, and delete-dialog cancellation coverage.
- The existing new-chat/project-delete desktop fixture was updated to enter the portaled menu before removal and passed end to end; command-palette action geometry and pinned-project interaction fixtures also passed.
- `.scratch/project-actions-secondary-menu.png` and the compact project-action screenshots were inspected at original resolution. The only direct row controls are ellipsis and new Chat; the popup aligns below the trigger and uses the shared focused-popup surface.
- Historical documentation links passed: 21 passed, 0 failed. `git diff --check` passed for both staged and unstaged changes.
