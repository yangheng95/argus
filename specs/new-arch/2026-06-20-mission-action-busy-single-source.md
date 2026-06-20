# Mission Action Busy Single Source

Date: 2026-06-20

## Problem

Independent GUI review found that `Mission.tsx` serializes mission row actions
through `withBusy(actionKey, fn)`, but `MissionList.tsx` still presents several
actions as clickable while another action is already running.

Current disk state already includes mission project archive download work:

- `Mission.tsx` sets `actionBusy` and passes it to `MissionList`.
- `MissionList.tsx` disables only the matching download button.
- Abort, rename, and delete buttons remain enabled even though `withBusy()`
  will return before invoking their handlers when `actionBusy()` is non-empty.

That creates a visible no-op for mouse and keyboard users.

## Sources Of Truth

| Domain | Source |
| --- | --- |
| Mission action concurrency | `packages/overlay/src/components/Mission.tsx` `actionBusy` / `withBusy()` |
| Mission row actions | `packages/overlay/src/components/MissionList.tsx` `MissionAbortButton`, `MissionDownloadButton`, `MissionRenameButton`, `MissionDeleteButton` |
| Button disabled visuals | `packages/overlay/src/styles/primitives/button.css` and `packages/overlay/src/styles/surfaces/sidebar.css` |

`withBusy()` remains the program-level single source for active mission action.
The row must not invent per-button local busy state.

## Call-Site Inventory

`rg -n "actionBusy|withBusy|onAbortMission|onDownloadMission|onDeleteMission|onRenameMission|task-row-(cancel|download|rename|delete)" packages/overlay/src/components packages/overlay/test packages/overlay/src/services`

| Call site | Decision |
| --- | --- |
| `Mission.tsx` `withBusy()` | Keep the guard. It protects programmatic concurrency and reports action errors. |
| `Mission.tsx` `<MissionList actionBusy={actionBusy()} />` | Keep as the only UI busy source. |
| `MissionList.tsx` `MissionAbortButton` | Add `disabled` and current-action `busy` props. |
| `MissionList.tsx` `MissionDownloadButton` | Use global disabled for every active action; keep `data-busy=true` only for the current download. |
| `MissionList.tsx` `MissionRenameButton` | Add `disabled` and current-action `busy` props. |
| `MissionList.tsx` rename editor | Disable the input from the same action source and do not commit while an action is busy. |
| `MissionList.tsx` `MissionDeleteButton` | Add `disabled` and current-action `busy` props. |
| `mission-launcher-component.test.ts` | Add source guards that every action button consumes the shared disabled signal. |
| `side-activity-toolbar-browser.test.ts` | Hold mission archive download open, assert all row action buttons are disabled, and screenshot the busy row. |

## Design

In `MissionRow`, derive:

- `missionActionDisabled()` from `Boolean(props.actionBusy)`.
- `missionActionBusy(action)` from `props.actionBusy === "<action>:<missionID>"`.

Pass `disabled={missionActionDisabled()}` to abort, download, rename, and delete.
Pass `busy={missionActionBusy(action)}` to expose `data-busy=true` only on the
button whose action is actually in progress.

When the rename editor is already open, use the same `missionActionDisabled()`
source to disable the input and make `commitRename()` return before clearing the
draft. This prevents an Enter/blur commit from disappearing into `withBusy()`
while another action is active.

The main row selection button is not an action handled by `withBusy()` and must
remain selectable while an action is busy.

## Tests

- Static/source test verifies all Mission row action buttons receive disabled
  from the shared action state and that `withBusy()` remains isolated from row
  selection.
- Browser test verifies a held mission download disables abort/download/rename
  and delete buttons in the real Mission ledger and captures a screenshot of
  the disabled row.

## Non-Goals

- Do not change project archive download service behavior.
- Do not remove the program-level `withBusy()` guard.
- Do not touch unrelated world-economy or OpenCorvus architecture work already
  dirty in the worktree.
