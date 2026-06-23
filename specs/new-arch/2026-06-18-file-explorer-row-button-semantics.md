# File Explorer Row Button Semantics

Date: 2026-06-18

## Problem

`FileExplorerPanel` rendered a dense VS Code-style file explorer as ordinary
row buttons, but the row container declared `role="tree"`. The rows themselves
were not `treeitem`s and the component did not implement a tree widget keyboard
model. At the same time, the currently opened file was only visible through
`.file-explorer-row[data-active="true"]`, so keyboard and assistive-technology
users could activate files but could not identify the current file from the
button semantics.

## Recall

| Source                                                | Relevant decision                                                                                                                                                    |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-01-overlay-file-explorer-editor.md`          | The explorer is a flat, dense, icon-led, lazily loaded file browser backed by project-scoped file APIs. It does not require a full ARIA tree widget.                 |
| `2026-06-01-overlay-mature-ui-primitives-refactor.md` | Mature primitives should own complex widget semantics when available. Current Kobalte dependencies include listbox/tabs/menubar, but no tree primitive is installed. |
| `2026-06-18-ledger-row-current-aria.md`               | Visual current-row state must be mirrored onto the focusable row control.                                                                                            |
| `2026-06-18-prompt-profile-list-current-aria.md`      | Plain command-button lists should use `aria-current` for current-item state, not listbox-only `aria-selected` or toggle-only `aria-pressed`.                         |

## Impact Sweep

| Sweep                                                           | Result                                                             | Decision                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `rg -n 'data-active=\{                                          | aria-current=                                                      | aria-selected=                                                          | aria-pressed=' packages/overlay/src packages/overlay/test`                    | Task, Mission, Coding Assistant, executor, file changes, and Prompt Profiles already mirror visual current/selected state to ARIA. File Explorer rows only had `data-active`. | Add current-file semantics to the row buttons.                              |
| `rg -n 'treeitem                                                | role="tree"                                                        | aria-expanded                                                           | file-explorer-row' packages/overlay/src packages/overlay/test specs/new-arch` | `FileExplorerPanel` was the only file explorer tree role owner; no test covered the role contract.                                                                            | Remove the incomplete tree role instead of inventing a partial tree widget. |
| `Get-ChildItem packages/overlay/node_modules/@kobalte/core/dist | ? Name -match 'tree                                                | listbox'`                                                               | Kobalte listbox is available; Kobalte tree is not.                            | Do not migrate the mixed directory/action file browser into an unavailable tree primitive.                                                                                    |
| `packages/opencorvus/src/server/routes/file.ts`                 | `/file` returns `File.Node[]` and `/find/file` returns `string[]`. | Browser fixture must use the real route shapes, not `{ entries: ... }`. |

## Fix

- Remove `role="tree"` from `.file-explorer-list`.
- Keep file and directory rows as real buttons.
- Add `aria-expanded` to directory row buttons only.
- Add `aria-current="true"` to the row button whose path matches
  `selectedFilePath()`.
- Do not add `aria-selected`, `aria-pressed`, or `treeitem` roles.

## Acceptance

- The file explorer no longer advertises an incomplete tree widget.
- Expanded directory buttons expose `aria-expanded`.
- The current file row has both `data-active="true"` and
  `aria-current="true"` on the same focusable button.
- Unselected file rows omit `aria-current`.
- Real browser coverage opens the Explorer panel through the right toolbar,
  renders real file API-shaped data, opens a file, asserts the DOM semantics,
  and writes a screenshot for visual review.
