# File Explorer Retry Button Primitive

Date: 2026-06-18

GUI means Graphical User Interface. CSS means Cascading Style Sheets. DOM means
Document Object Model.

## Problem

Independent GUI review found `FileExplorerPanel` still renders the root
load-failed retry action as a raw `<button class="file-explorer-retry">`.
`inspector.css` duplicates button border, background, color, padding, cursor,
hover, and focus styling for that class and clears the focus outline.

The retry action is an ordinary operation button. It should use the shared
`Button` primitive, like the task ledger load-failed retry action.

## Recall

| Source                                                        | Relevant constraint                                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `2026-06-18-file-explorer-row-button-semantics.md`            | File explorer rows are intentionally dense row buttons; that decision does not cover the load-failed retry action. |
| `2026-06-18-file-explorer-drag-upload.md`                     | `FileExplorerPanel` owns lazy directory browsing and current directory resource state.                             |
| `TaskList.tsx`                                                | `task-list-error-retry` already uses `<Button variant="outline" size="md" tone="danger">`.                         |
| `components/ui/Button.tsx` and `styles/primitives/button.css` | The shared primitive owns operation button hover, focus-visible, disabled, size, and tone.                         |

## Impact Sweep

| Sweep                                                                                        | Result                                                                                                                               | Decision                                                                                |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `rg -n -F "file-explorer-retry" packages/overlay/src packages/overlay/test specs`   | Live production owners are `FileExplorerPanel.tsx` and `inspector.css`; `file-explorer-editor.test.ts` currently pins the old class. | Migrate this action directly; no broader explorer row rewrite.                          |
| `rg -n -F "task-list-error-retry" packages/overlay/src packages/overlay/test specs` | Task list retry uses the Button primitive and a stable `data-ui` selector.                                                           | Follow the same pattern for file explorer.                                              |
| `packages/overlay/test/browser/file-explorer-accessibility.test.ts`                          | Existing browser fixture opens the real File Explorer but only covers successful directory listing, upload, and editor states.       | Add a focused browser test for load-failed retry, hover/focus, and screenshot evidence. |

## Fix Plan

1. Replace the raw retry button with `<Button variant="outline" size="md"
tone="danger" data-ui="file-explorer-retry">`.
2. Remove `.file-explorer-retry` private shell and focus outline rules from
   `inspector.css`.
3. Add a scoped `.file-explorer-empty .oc-button[data-ui="file-explorer-retry"]`
   variable/layout rule only if the local error state needs spacing.
4. Update static tests to reject `class="file-explorer-retry"` and require the
   shared Button primitive.
5. Add browser coverage for the load-failed File Explorer state with visual
   screenshot and focus/hover checks.

## Acceptance

- `FileExplorerPanel.tsx` no longer emits `class="file-explorer-retry"`.
- Retry action renders as `.oc-button[data-ui="file-explorer-retry"]`.
- `inspector.css` no longer owns private retry button chrome or `outline: 0`.
- Browser evidence proves the load-failed state has a readable retry button and
  visible primitive focus/hover affordance.
