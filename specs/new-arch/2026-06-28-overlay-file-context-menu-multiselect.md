# Overlay File Context Menu Multiselect

Date: 2026-06-28

## Requirement

Move overlay file management actions to right-click context menus and support multi-selection in the Explorer.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `AGENTS.md` | No fallback logic, no dual-source UI, every code change needs tests, and overlay UI changes need real screenshot review. |
| `2026-06-01-overlay-file-explorer-editor.md` | `FileExplorerPanel` is the Explorer owner; rows stay flat dense buttons; file APIs remain project-scoped. |
| `2026-06-26-overlay-full-file-browser.md` | File create, rename, move, delete, refresh already use backend `/file/item` and context menu semantics; a single generic menu is not enough. |
| `2026-06-22-file-explorer-button-primitive-visual-regression.md` | Rows keep the shared `Button` primitive and dense row sizing. |
| `2026-06-20-file-explorer-row-focus-visible.md` | Rows remain native buttons with explicit focus-visible styling, not a partial ARIA tree. |

## Impact Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n "file-explorer-(new-menu|rename|move|delete|refresh|command-surface|selection)" packages/overlay/src packages/overlay/test specs/new-arch` | The only product owner is `FileExplorerPanel`; CSS and browser/static tests still assert the visible toolbar. | Remove toolbar markup and CSS. Update tests to assert only context-menu management entries. |
| `rg -n "ContextMenu|DropdownMenu|ArmedConfirmButton|selectedItem|renameItem|moveItem|deleteItem" packages/overlay/src/components/FileExplorerPanel.tsx` | Rows already use Kobalte `ContextMenu`; `DropdownMenu` and `ArmedConfirmButton` exist only for the visible toolbar path. | Keep Kobalte ContextMenu; remove DropdownMenu and ArmedConfirmButton imports. |
| `rg -n "selectedFileTarget|openFileEditor|closeFileEditorIfDeleted|updateOpenFilePathAfterMove" packages/overlay/src packages/overlay/test` | Editor state is single-source in `file-workbench`; Explorer maintains only row selection. | Keep editor source unchanged; multi-select is local Explorer UI state only. |
| `rg -n "POST /file/item|PATCH /file/item|DELETE /file/item|file/item" packages/opencorvus/src packages/overlay/src packages/overlay/test` | Backend already supports single create/move/delete operations. | Implement multi-move and multi-delete by issuing the existing single-item API per selected item; no new backend route or fallback path. |

## UI Contract

- All file management commands are reachable through right-click menus:
  - empty/root area: upload files, new file, new folder, refresh;
  - directory row: expand/collapse, upload files, new file, new folder, rename, move, delete;
  - file row: open, upload files to the parent directory, rename, move, delete.
- There is no visible New / Upload / Refresh / Rename / Move / Delete toolbar or dropzone in Explorer.
- Left click keeps the existing open/toggle behavior for single activation.
- Ctrl/Meta-click toggles a row in the selection.
- Shift-click selects the visible range between the anchor row and clicked row.
- Right-click on an unselected row makes that row the active selection before opening the menu.
- Right-click on a selected row keeps the current multi-selection and applies supported actions to the selected set.
- Rename and Open are single-target operations; Move and Delete support multi-selection.
- Multi-move asks for a destination directory and preserves each selected item name.
- Multi-delete uses the shared AppDialog confirmation and deletes each selected path through the existing project-scoped API.
- When the selected set contains both a directory and descendants inside that directory, move/delete execute only against the selected top-level directory because the descendant is already covered by that subtree operation.

## Acceptance

- `FileExplorerPanel.tsx` has no `DropdownMenu` import, no `ArmedConfirmButton` import, and no toolbar management buttons.
- Context menus use Kobalte `ContextMenu` primitives and `Button` row triggers.
- Multi-selection is visible through row state and `aria-current`, without introducing tree roles or custom ARIA tree semantics.
- Browser test uploads, creates, renames, moves, multi-moves, and multi-deletes through context menus only.
- Batch move/delete filters nested selected descendants behind selected directories before issuing backend mutations.
- Node-runner Playwright captures and reviews Explorer context menu screenshots.
