# Task Row Action Keyboard Rail

Date: 2026-06-19

GUI means Graphical User Interface. CSS means Cascading Style Sheets. DOM means
Document Object Model. ARIA means Accessible Rich Internet Applications.

## Recall

- `AGENTS.md` requires root-cause fixes, no fallback logic, no double source,
  mature primitives, and tests for every code change.
- `2026-06-19-task-row-children-toggle-button-primitive.md` keeps task row
  operations on shared `Button` controls and verifies the real browser tree
  flow with Playwright.
- `task-row-actions-hover-only.test.ts` documents the hover-only visual
  contract: row action buttons should not consume resting row layout or pointer
  hit targets while hidden.
- `2026-06-18-ledger-row-current-aria.md` keeps `.task-row-main` as the
  canonical row selection command. This pass preserves that owner and adds a
  deliberate keyboard path into the contextual actions.

## Evidence

| Sweep                                                        | Result                                                                                                                                                            | Decision                                                                                           |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Halley explorer report, 2026-06-19                           | `.task-row-actions .oc-button` controls are hidden with `opacity: 0` and `pointer-events: none`, but remain sequentially focusable.                               | Remove hidden actions from default Tab order.                                                      |
| `rg -n "task-row-actions                                     | task-row-main                                                                                                                                                     | task-row-delete                                                                                    | task-row-rename | TaskList" specs packages/overlay/test packages/overlay/src --glob '\*.{md,ts,tsx,css}'` | `TaskList.tsx` is the canonical task row owner; Mission and Coding Assistant reuse the same action class names but are separate ledgers. | Fix `TaskList` first, without changing unrelated Mission/Coding Assistant dirty work. |
| `packages/overlay/test/browser/task-list-tree-click.test.ts` | Existing browser fixture mounts real TaskList rows, verifies child toggle keyboard behavior, row hit testing, and action clicks.                                  | Extend this fixture to cover Tab skipping hidden actions and ArrowRight/Escape action rail access. |
| `task-row-actions-hover-only.test.ts`                        | Current CSS contract reveals actions via `:focus-within`, which makes hidden action buttons become part of plain Tab traversal after the row main receives focus. | Replace focus-within action reveal with explicit `data-actions-keyboard-open`.                     |

## Root Cause

The visual contract hid the action rail with CSS only. Because the buttons
remained ordinary focusable controls, keyboard Tab visited contextual actions
even when the row action area had not been intentionally opened.

## Fix Plan

1. Add row-local `actionsKeyboardOpen` state in `TaskRow`.
2. Keep action buttons rendered through `Button`, but set their `tabIndex` to
   `-1` until the row action rail is opened for keyboard use.
3. From `.task-row-main`, handle `ArrowRight` to open the action rail and focus
   the first enabled action button.
4. From the action rail, handle `Escape` and `ArrowLeft` to close the rail and
   return focus to `.task-row-main`.
5. Change CSS reveal/layout selectors from `:focus-within` to
   `[data-actions-keyboard-open="true"]`, while preserving mouse hover reveal.
6. Extend static and browser tests.

## Acceptance

- Hidden task row action buttons have `tabindex="-1"` and are skipped by
  default sequential Tab navigation.
- `ArrowRight` on `.task-row-main` opens the rail and focuses the first enabled
  action.
- `Escape` and `ArrowLeft` close the keyboard rail and return focus to the row
  main button.
- Mouse hover action behavior and two-step cancel/delete flow remain working.
