# TaskDirBar Current Location ARIA

Date: 2026-06-18

## Problem

The Current Working Directory recent menu visually marks the active project
directory with `.recent-dir-row[data-active="true"]` and a hidden dot, but the
focusable `.recent-dir-item` command did not expose that current-location
state. Keyboard and assistive-technology users could open the Kobalte menu and
activate a directory row, but could not identify which row already represented
the active Current Working Directory.

## Recall

| Source                                                | Relevant decision                                                                                                                 |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-18-task-dirbar-recent-trigger-semantics.md`  | `TaskDirBar` owns the breadcrumb, editable path entry, detected-project rows, and recent-directory popup as one Kobalte dropdown. |
| `2026-06-11-cwd-project-discovery-and-edit.md`        | Detected projects and typed path submission share the same `setDirectory` switch path; no second directory source is allowed.     |
| `2026-06-12-editable-cwd-default-launch-directory.md` | `TaskDirContent` remains the shared cwd editor and discovery surface.                                                             |
| `2026-06-18-ledger-row-current-aria.md`               | Visual current-row state must be mirrored onto the focusable row control.                                                         |
| `2026-06-18-prompt-profile-list-current-aria.md`      | Command rows use `aria-current` for current-item state, not listbox-only `aria-selected` or toggle-only `aria-pressed`.           |

## Impact Sweep

| Sweep                                                        | Result                                                                                                       | Decision                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------ | ------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `rg -n 'recent-dir-item                                      | recent-dir-row                                                                                               | cwd-recent-trigger                                                                        | aria-current | aria-selected | aria-pressed' packages/overlay/src packages/overlay/test specs/new-arch` | `TaskDirBar` had two active-location row sources: detected projects and recent directories. Both used outer `data-active`; neither gave the `.recent-dir-item` ARIA current state. | Add the same current-location attribute to both `DropdownMenu.Item` instances. |
| `packages/overlay/src/styles/surfaces/conversation.css`      | `.recent-dir-row[data-active="true"]` is the visual active source and `.recent-dir-state` is `aria-hidden`.  | Preserve the visual source; add semantics on the focusable command.                       |
| `packages/overlay/test/browser/task-dirbar-keyboard.test.ts` | Existing real browser flow opens the cwd menu through `data-ui="cwd-recent-trigger"` and saves a screenshot. | Extend it to assert active rows have `aria-current="location"` and inactive rows omit it. |

## Fix

- Add `aria-current={isActive() ? "location" : undefined}` to detected-project
  `.recent-dir-item` menu commands.
- Add the same attribute to recent-directory `.recent-dir-item` menu commands.
- Do not add `aria-selected`, because these are menu commands, not listbox or
  tab selections.
- Do not add `aria-pressed`, because selecting a directory is not a toggle.

## Acceptance

- Current detected-project and recent-directory rows keep outer
  `data-active="true"` and expose `aria-current="location"` on the inner
  `.recent-dir-item`.
- Inactive directory rows omit `aria-current`.
- Rows do not use `aria-selected` or `aria-pressed`.
- Existing Kobalte dropdown trigger keyboard flow and screenshot review remain
  unchanged.
