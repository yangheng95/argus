# Status Label Single Source

Date: 2026-06-20

## Problem

Independent GUI review found task and workflow statuses rendered from several
local label maps. Some maps returned the raw enum when a key was not known.
That leaks backend implementation strings such as `running` into visible UI and
makes task lifecycle status and workflow step status look like the same domain.

## Sources Of Truth

| Domain | Authoritative source | Allowed display statuses |
| --- | --- | --- |
| Task lifecycle | `packages/opencorvus/src/engine/task-status.ts`, `packages/opencorvus/src/engine/model.ts`, `packages/overlay/src/services/mission.ts` | `queued`, `active`, `completed`, `failed`, `cancelled` |
| Workflow step | `packages/opencorvus/src/status/task-status-snapshot.ts` and workflow step projections | `pending`, `running`, `completed`, `skipped`, `failed` |

`idle` is not a task lifecycle value. It is only the explicit UI text for "no
selected task".

## Call-Site Inventory

`rg -n "statusLabel|taskStatusLabel|missionTaskStatusLabel|task\\.status\\.\\$|task\\.status\\.running|workflow\\.status|return map\\[status\\]|translated === key|\\|\\| status" packages/overlay/src packages/overlay/test packages/opencorvus/src`

| Call site | Decision |
| --- | --- |
| `packages/overlay/src/components/Board.tsx` local `statusLabel` | Replace with strict task lifecycle helper for `StatusBadge`; render frontend research workflow badge with strict workflow helper. |
| `packages/overlay/src/components/TaskList.tsx` local `statusLabel` | Replace task row badges with strict task lifecycle helper. |
| `packages/overlay/src/components/MissionList.tsx` local `missionTaskStatusLabel` | Replace mission task projection labels with strict task lifecycle helper. Preserve unrelated mission download changes already in the worktree. |
| `packages/overlay/src/components/Conversation.tsx` local `taskStatusLabel` | Replace empty-state task labels with strict task lifecycle helper. |
| `packages/overlay/src/components/TaskStatusHeader.tsx` dynamic `t("task.status.${status}")` | Replace with strict task lifecycle helper. |
| `packages/overlay/src/components/titlebar/TitlebarMenubar.tsx` raw `activeTaskLabel` | Replace menu metadata with strict task lifecycle helper and give the menu row its own titlebar label. |
| `packages/overlay/test/browser/workflow-generating-status-browser.test.ts` fixture `task.status = "running"` | Change task fixture to lifecycle `active`; keep workflow steps as `running`; assert localized task and workflow labels. |
| `packages/overlay/test/task-lifecycle.test.ts` old pipeline lifecycle statuses | Align isolated classifier tests with the current task lifecycle: only `queued` and `active` are interruptible. |
| Browser/benchmark fixtures with `board.task.status = "running"` | Change only task lifecycle fixtures to `active`; keep workflow/goal/tool/run `running` values because those are separate status domains. |
| `packages/overlay/src/i18n/*` `task.status.running` and stale task pipeline keys | Do not remove in this iteration because other historical tests/translations still reference the namespace; add `workflow.status.*` as the correct display namespace for workflow steps. |
| `packages/overlay/src/utils/status-mapping.ts` icon aliases | Leave for a later icon-domain cleanup. It maps multiple UI domains to icons, but it is not a visible text source. |

## Design

Add `packages/overlay/src/utils/status-labels.ts`:

- `taskLifecycleStatusLabel(status)` accepts only
  `queued|active|completed|failed|cancelled`.
- `taskLifecycleStatusLabelFromString(status)` trims and rejects any empty or
  unknown non-lifecycle value.
- `taskLifecycleStatusOrIdleLabel(status)` returns `task.status.idle` only for
  the explicit no-selected-task case; unknown non-empty values throw.
- `workflowStepStatusLabelFromString(status)` accepts only
  `pending|running|completed|skipped|failed`.

No visible string path may return the input enum as display text.

## Tests

- New unit/static test for both helpers and adoption guards.
- Browser test asserts:
  - task header shows localized `Active`, not the raw `active` enum;
  - frontend research badge shows localized workflow `Running`, not the raw
    lowercase `running`;
  - task row badge uses the lifecycle label.
- Update lifecycle classifier tests to current `queued|active` semantics.

## Non-Goals

- Do not remove stale `task.status.running/planning/evaluating/delivering`
  keys in this round; that is a larger namespace cleanup.
- Do not change workflow state derivation or icon mapping.
- Do not touch unrelated Mission project archive download work in the dirty
  worktree.

## Independent Agent Review Feedback

Boyle found that several overlay browser/benchmark fixtures still used
`status: "running"` for `board.task.status`. With strict lifecycle labels, those
fixtures would throw when the task row or header renders. This is stale test
data, not a runtime fallback requirement. The fix is to update only task
lifecycle fixture objects to `active`, while preserving workflow/goal/tool/run
`running` values.
