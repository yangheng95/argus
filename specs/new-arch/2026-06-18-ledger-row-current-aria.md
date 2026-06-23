# Ledger Row Current ARIA

Date: 2026-06-18

## Problem

Mission and Coding Assistant ledger rows visually mark the selected row with
outer `.task-row-mini[data-active="true"]`, but their focusable main row buttons
did not expose the same current-item state. Keyboard and assistive-tech users
could activate the row but could not identify the current Mission or assistant
session from the control itself.

## Recall

| Source                                         | Existing decision                                                                                                                                           |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-18-ledger-row-nested-interactions.md` | The outer Mission/Assistant row is a non-semantic container; `.mission-row-main` and `.coding-assistant-row-main` are the only keyboard selection controls. |
| `TaskList.tsx::TaskRow`                        | The canonical task row keeps outer `data-active` for visual styling and puts `aria-current="page"` on `.task-row-main`.                                     |
| `2026-06-01-mission-panel-mission-list.md`     | Mission row selection opens the selected session history and the selected row remains a first-class ledger affordance.                                      |

## Impact Sweep

| Sweep                                                                 | Result                                                                           | Decision                                                                      |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `rg -n 'data-active=\\{                                               | aria-current=                                                                    | task-row-main                                                                 | mission-row-main | coding-assistant-row-main' packages/overlay/src/components packages/overlay/test specs/new-arch/2026-06-18-ledger-row-nested-interactions.md -S` | `TaskList` already mirrors active state to `aria-current`; Mission and Coding Assistant only had outer `data-active`. | Mirror `props.selected` to the focusable main buttons. |
| `packages/overlay/test/browser/side-activity-toolbar-browser.test.ts` | Real overlay flow already clicks Mission and Coding Assistant rows.              | Extend this path with selected-row `aria-current` checks.                     |
| `packages/overlay/test/browser/ledger-row-interactions.test.ts`       | Browser fixture validates row actions and screenshot for the shared row grammar. | Add current-state assertions while preserving the non-nested-button contract. |

## Fix

- Add `aria-current={props.selected ? "page" : undefined}` to
  `.mission-row-main`.
- Add the same attribute to `.coding-assistant-row-main`.
- Keep outer `data-active` as the shared visual CSS hook.
- Add static and browser checks so visual current state and focusable control
  semantics cannot drift again.

## Acceptance

- Selected Mission and Coding Assistant rows have `data-active="true"` on the
  outer row and `aria-current="page"` on the corresponding main button.
- Unselected rows omit `aria-current`.
- The outer row remains non-interactive; row action buttons stay siblings of
  the main selection button.
- Static tests, browser interaction screenshot review, real overlay side
  activity browser coverage, typecheck, docs check, and i18n check pass before
  commit and push.
