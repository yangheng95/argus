# Mission Task Projection Row Focus

Date: 2026-06-18

GUI means Graphical User Interface. CSS means Cascading Style Sheets. DOM means
Document Object Model.

## Problem

Independent GUI review found `MissionTaskProjectionRow` renders its task-select
control as `<button class="mission-task-projection-button">`. The matching CSS
duplicates a local row-command surface and clears the focus outline in
`:focus-visible`.

This control is not a generic operation button. It is a child row selection
command, so it should share the ledger row-select focus contract already owned
by `.task-row-main`.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `2026-06-05-mission-task-projection.md` | Mission task projections are compact child rows under the Mission ledger and select canonical tasks by task ID. |
| `2026-06-18-ledger-row-nested-interactions.md` | Ledger row containers are non-interactive; the row command owns keyboard selection. |
| `2026-06-18-ledger-row-current-aria.md` | `.task-row-main` is the shared row-select command with visible focus semantics. |
| `sidebar.css` | `.task-row-main:focus-visible` owns the tokenized outline for row selection controls. |

## Impact Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n -e "mission-task-projection" -e "task-row-main" packages/overlay/src packages/overlay/test specs/new-arch` | Projection select is the only Mission child task row command using `mission-task-projection-button`; Mission and Assistant main rows already use `.task-row-main`. | Replace the local class with `.task-row-main` plus a stable projection data-ui hook. |
| `packages/overlay/src/styles/surfaces/mission.css` | `.mission-task-projection-button:focus-visible` sets only background/color and `outline: none`. | Remove the local focus owner; keep projection-specific layout in a data-ui scoped rule. |
| `packages/overlay/test/browser/side-activity-toolbar-browser.test.ts` | Real browser flow already opens Mission ledger and clicks a projection select. | Extend this path to keyboard-focus the projection select and screenshot the focused row. |

## Fix Plan

1. Change the projection select button class to
   `task-row-main mission-task-projection-select`.
2. Move projection layout from `.mission-task-projection-button` to
   `.mission-task-projection-row .task-row-main[data-ui="mission-task-projection-select"]`.
3. Keep hover/background styling scoped to that data-ui selector, without
   overriding outline.
4. Update static tests to reject `mission-task-projection-button` and require
   `.task-row-main`.
5. Extend browser coverage to assert visible focus outline in light theme and
   save a Mission ledger screenshot.

## Acceptance

- `MissionList.tsx` no longer emits `class="mission-task-projection-button"`.
- Projection select uses `.task-row-main` and keeps
  `data-ui="mission-task-projection-select"`.
- `mission.css` no longer has a local `outline: none` focus rule for projection
  selects.
- Browser evidence proves a keyboard-focused projection select exposes a
  visible outline.

## Follow-Up

`2026-06-19-mission-task-projection-button-primitive.md` supersedes the
`.task-row-main` implementation detail. The live projection selector now
renders through `Button` as `.oc-button[data-ui="mission-task-projection-select"]`
while preserving the browser focus evidence from this pass.
