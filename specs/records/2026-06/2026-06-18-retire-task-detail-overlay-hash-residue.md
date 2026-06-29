# Retire Task Detail Overlay Hash Residue

Date: 2026-06-18

CSS means Cascading Style Sheets.
DOM means Document Object Model.

## Problem

`TaskDetailOverlay.tsx` was a legacy hash-route task overlay. It was no longer
imported, mounted, or reachable from the current Mission and task-selection
runtime, but it still kept:

- a dead component that called `selectTask`;
- `task_overlay.*` locale strings;
- `.task-overlay-error*` workspace CSS;
- hotkey tests and comments preserving the old component name.

Keeping this surface suggested there was a second task detail route beside the
current `selectTask` / `selectMissionTask` path.

## Recall

| Source                                                  | Existing decision                                                                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `2026-06-11-mission-left-activity-retire-panel.md`      | Mission task clicks go through `selectMissionTask`, which activates workflow and calls `selectTask(task.id)`.                  |
| `2026-06-05-overlay-deleted-session-stale-card-plan.md` | Task row select and delete keep `selectTask()` as the canonical selected-task clearing and hydration path.                     |
| `2026-06-15-task-list-lean-projection.md`               | Task list rows are lean; selected task detail belongs to selected task board/conversation routes, not a parallel list overlay. |

## Impact Sweep

| Sweep                     | Result                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rg -n "TaskDetailOverlay | task_overlay                                                                        | task-overlay                                                                                     | location\\.hash | hashchange" packages/overlay/src packages/overlay/test specs/new-arch specs` | Runtime hits were limited to the component itself, locale strings, workspace CSS, hotkey test/comment residue, and a Conversation comment. No JSX mount or import existed. |
| `rg -n "selectTask        | selectMissionTask" packages/overlay/src packages/overlay/test specs/new-arch specs` | `selectTask` and `selectMissionTask` are live canonical paths and are not part of this deletion. |

## Fix

- Delete `TaskDetailOverlay.tsx`.
- Delete its `task_overlay.*` locale strings.
- Delete `.task-overlay-error*` from workspace CSS.
- Remove old `TaskDetailOverlay` hotkey adoption expectations and comments.
- Add a guard that rejects the retired component, locale key, class prefix, and
  component-name residue from runtime source owners.

## Acceptance

- `packages/overlay/src` has no `TaskDetailOverlay`, `task_overlay`, or
  `task-overlay` runtime owner.
- `selectTask` and `selectMissionTask` remain untouched and covered by existing
  task/mission tests.
- Targeted hotkey, mission, browser-preview, task-selection, typecheck, docs
  check, and second review pass succeed before commit and push.
