# Task Actions Cancel Button Owner

Date: 2026-06-20

## Report

Independent GUI review found the right-side task action panel receives the
task cancel callback and backend `controls.canCancel`, but the panel only
renders retry and replan. The same surface also overrides the shared Button
primitive into a text-link-sized target, weakening click and focus affordance.

## Recall

| Source                                                | Relevant decision                                                                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `2026-05-14-gateway-task-management-prd.md`           | Task management includes cancel, retry, replan, and message actions.                                                                                                           |
| `2026-06-18-notification-live-region-task-action.md`  | Task activation/action controls should be explicit Button-owned controls, not hidden container behavior.                                                                       |
| `2026-06-19-task-mission-agent-cancellation-scope.md` | Overlay task cancel remains the same route name while backend cancellation semantics continue moving to the canonical scope. This UI fix must not invent a second cancel path. |

## Impact Sweep

| Sweep                                            | Result                                                                                       | Decision                                                                                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `rg -n "TaskActionsPanel                         | canCancel                                                                                    | canRetry                                                                                                                                         | canReplan                                                                      | cancelSelectedTask                                                                                                           | data-task-action" packages/overlay/src packages/overlay/test packages/opencorvus/src/workbench/board.ts` | `workbench/board.ts` emits `canCancel`, `main.tsx` passes `cancelSelectedTask`, and `TaskActionsPanel` accepts `onCancel` but never renders it. | Render cancel from the existing controls/callback contract. |
| `rg -n "task-actions-buttons                     | \\.oc-button" packages/overlay/src/styles/surfaces/inspector.css packages/overlay/test`      | `inspector.css` sets `--oc-button-height:auto`, `min-height:auto`, border/background removal, and zero vertical padding for TaskActions buttons. | Keep shared Button primitive dimensions; only apply local layout/tone accents. |
| `rg -n "task.action.cancel                       | task.action.retry                                                                            | task.action.replan                                                                                                                               | task.cancel_button_title" packages/overlay/src/i18n packages/overlay/test`     | Retry/replan action keys exist. The existing cancel key is for row-level two-click confirmation and has different semantics. | Add `task.action.cancel` and `task.action.cancel_title` for the right-side one-click task action.        |
| `packages/overlay/test/browser/controls.test.ts` | Fixture has `canCancel:true` but does not assert the right-side cancel button or POST route. | Extend the real mounted browser fixture instead of adding a static-only test.                                                                    |

## Fix Plan

1. Include `controls().canCancel` in `TaskActionsPanel` visibility.
2. Render `Button[data-task-action="cancel"]` using the existing
   `task.action.cancel` and `task.action.cancel_title` keys and the existing
   `onCancel` callback.
3. Remove the TaskActions override that collapses Button dimensions to a text
   link. Use shared Button size and local tokenized accent/danger color only.
4. Extend the real browser controls test to assert retry/replan/cancel
   visibility, focusable dimensions, and one matching POST per action.

## Acceptance

- Right-side TaskActions shows cancel when `overview.controls.canCancel` is
  true, even when retry/replan are false.
- Cancel is a real shared `Button` with `data-task-action="cancel"`, localized
  accessible label/title, hover/focus affordance, and a minimum touch target
  consistent with Button primitive sizing.
- Clicking cancel calls the existing overlay task service route; no duplicate
  API path or state source is introduced.
- The same real browser path also proves retry and replan still call their
  existing service routes after the Button primitive ownership change.
- Browser screenshot evidence verifies the cancel button is visible and
  focused without overlapping sibling controls.
