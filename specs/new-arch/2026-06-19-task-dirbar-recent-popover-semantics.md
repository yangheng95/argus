# TaskDirBar Recent Popover Semantics

## Recall

- `2026-06-18-task-dirbar-recent-trigger-semantics.md` separated breadcrumb path buttons from the recent-directory trigger.
- `2026-06-18-recent-directory-actions-button-primitive.md` moved edit-submit and remove controls to the shared `Button` primitive.
- `2026-06-19-cwd-recent-trigger-button-primitive.md` moved the recent trigger itself to `Button`.
- `2026-06-19-dropdown-menu-highlighted-contrast-source.md` added Kobalte DropdownMenu highlighted-state coverage when recent rows were still menu items.

## Problem

The recent-directory popup became an editable panel: it contains a path input, submit button, discovered project rows, recent directory rows, and remove buttons. Keeping that surface inside `DropdownMenu.Content` made Kobalte expose menu semantics for non-menu form content and kept `Tab` under menu behavior.

## Design

- Keep `ProjectWorktreeDropdown` on Kobalte DropdownMenu because it is still a command menu.
- Move only the CWD recent/edit popup to Kobalte Popover and mark the panel as a dialog.
- Preserve the old shell-scoped `sameWidth` visual contract by sizing the dialog to the current CWD shell when it opens.
- Render discovered/recent directory choices as normal row buttons inside `role="list"` containers.
- Remove recent-row `data-highlighted` styling because Kobalte no longer owns those rows; keyboard visibility is owned by `:focus-visible` and `:focus-within`.
- Preserve the existing single CWD owner, workspace services, and shared `Button` primitive for edit-submit/remove actions.

## Verification

- Static tests reject `DropdownMenu.Content class="recent-dir-panel"` and recent-row `DropdownMenu.Item`.
- Browser test opens the real CWD panel, verifies `role="dialog"` with no nested menu roles, proves shell alignment, and proves `Tab` can reach the input submit, directory row, and remove action.
- Popup contrast matrix focuses the recent sample row before measuring focused-row contrast.
