# Ledger Row Main Button Primitive

Date: 2026-06-19

GUI means Graphical User Interface. CSS means Cascading Style Sheets. DOM means
Document Object Model. ARIA means Accessible Rich Internet Applications.

## Problem

Independent GUI review found the three task-style ledgers still rendered their
main row selection control as raw `<button class="task-row-main ...">`
elements:

- `TaskList.tsx`
- `MissionList.tsx`
- `CodingAssistantSessionList.tsx`

The CSS then treated `.task-row-main` as a private button primitive with its own
display, padding, border, background, cursor, color, and focus-visible rules.
That kept row selection outside the shared `Button` primitive and meant fixes to
`.oc-button` density, disabled state, hover, and focus rings would not naturally
cover ledger row selection.

## Recall

| Source                                                        | Relevant constraint                                                                                                    |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `2026-06-19-ledger-row-action-rail-keyboard-single-source.md` | Task, Mission, and Coding Assistant ledgers should share row action keyboard behavior instead of drifting per surface. |
| `2026-06-19-mission-task-projection-button-primitive.md`      | Mission projection selection already moved from raw row-like buttons onto `Button`.                                    |
| `2026-06-19-task-row-children-toggle-button-primitive.md`     | Task row controls should route through the shared `Button` primitive where they are real buttons.                      |
| `packages/overlay/src/components/ui/Button.tsx`               | `Button` owns `.oc-button` plus variant, size, tone, disabled, and focus-visible behavior.                             |
| `packages/overlay/src/styles/primitives/button.css`           | `.oc-button:focus-visible` is the shared button focus source.                                                          |

## Evidence Sweep

| Sweep                             | Result                                                                                                   | Decision                                                                                                                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `rg -n "<button                   | task-row-main" packages/overlay/src/components packages/overlay/src/styles packages/overlay/test`        | The three production raw row-main buttons were the only active row-main button creation points; edit-state containers reuse `.task-row-main--editing` but are not selection controls. | Replace production row-main buttons in one shared component, keep `.task-row-main` as a stable row hook. |
| `git diff -- MissionList.tsx`     | `MissionList.tsx` already has unrelated mission download edits in the current worktree.                  | Work with the current file, only replacing the main selection control.                                                                                                                |
| `sidebar.css`                     | The root `.task-row-main` selector was a private button shell and duplicated `.oc-button:focus-visible`. | Move root button layout variables to `.oc-button[data-ui="ledger-row-main"]`; leave content truncation under the same contract.                                                       |
| `ledger-row-interactions.test.ts` | The browser fixture still rendered old raw row buttons.                                                  | Update fixture to render `.oc-button.task-row-main[data-ui="ledger-row-main"]`.                                                                                                       |

## Fix

1. Add `LedgerRowMainButton`, a narrow wrapper around `Button`.
2. The wrapper emits `.oc-button.task-row-main` with `data-ui="ledger-row-main"`
   and preserves caller classes such as `mission-row-main`.
3. Replace Task, Mission, and Coding Assistant row-main raw buttons with the
   wrapper.
4. Retarget root row-main CSS to `.oc-button[data-ui="ledger-row-main"]`.
5. Update static and browser tests so they protect primitive ownership instead
   of the old raw-button shape.

## Acceptance

- `TaskList.tsx`, `MissionList.tsx`, and `CodingAssistantSessionList.tsx` use
  `LedgerRowMainButton` for the row selection control.
- Production row-main controls render through `.oc-button`.
- `.task-row-main` remains available as a stable row hook, but the root button
  shell is owned by `.oc-button[data-ui="ledger-row-main"]`.
- Row action buttons remain siblings outside the main selection control.
- Browser evidence verifies Mission and Coding Assistant row keyboard selection
  and action rail behavior against the `.oc-button[data-ui="ledger-row-main"]`
  runtime contract.
