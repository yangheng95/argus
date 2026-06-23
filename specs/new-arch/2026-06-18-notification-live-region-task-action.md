# Notification Live Region Task Action

Date: 2026-06-18

DOM means Document Object Model. UI means User Interface.

## Problem

Independent GUI review found `NotificationCenter` exposes each
`.app-notification` section as an alert/status live region and also as a
keyboard/click activation target when `taskID` exists. The same section contains
real `Button` controls for details, copy, and toast dismiss. That mixes live
region semantics with hidden button behavior and relies on child controls to
stop event propagation.

This is the notification equivalent of the row/header nested interaction issues
already fixed on 2026-06-18.

## Recall

| Source                                                      | Relevant constraint                                                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `notification-center-history-contract-2026-06-09.md`        | Toast and panel must share the same notification source; panel uses `centerHistoryNotificationItems()`.            |
| `2026-06-07-right-toolbar-inspector-notification-center.md` | `NotificationCenter` is reused by toast and right-panel surfaces; do not add a second notification data source.    |
| `task-row-action-rail-visual-alignment-2026-06-05.md`       | Notification close already opts into the shared `Button` icon-action chrome; do not weaken the primitive globally. |
| `2026-06-18-card-header-nested-interactions.md`             | Containers with sibling action buttons must not also be keyboard buttons.                                          |

## Impact Sweep

| Sweep                                                                                                                                               | Result                                                                                                                                        | Decision                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `rg -n -e "NotificationCenter" -e "app-notification" -e "activateTaskNotification" packages/overlay/src packages/overlay/test specs/new-arch specs` | `NotificationCenter.tsx` is the only creator of `.app-notification`; it is mounted by `main.tsx` for toast and `App.tsx` for the right panel. | Fix the shared component once; do not create toast/panel branches.                           |
| `rg -n -e "notify.dismiss" -e "notify.show_details" -e "notify.copy_details" -e "open" packages/overlay/src/i18n/*.json`                            | Existing `common.open` is available in both locales.                                                                                          | Use `common.open` for the task action button to avoid editing already dirty i18n files.      |
| `packages/overlay/test/notification-center-primitive.test.ts`                                                                                       | Static tests currently pin `data-clickable` instead of explicit task action semantics.                                                        | Replace with guards that the section is not interactive and task activation is button-owned. |
| Browser tests under `packages/overlay/test/browser`                                                                                                 | Existing notification tests inspect details/copy and screenshots but do not validate task-action focus order.                                 | Add focused browser coverage for notification keyboard semantics and screenshot evidence.    |

## Fix Plan

- Keep `.app-notification` as a non-interactive live-region section.
- Remove section-level `data-clickable`, `tabIndex`, `onClick`, and
  `onKeyDown`.
- Render an explicit `Button[data-ui="app-notification-open-task"]` when the
  notification has a `taskID`.
- The task action calls `activateTaskNotification(props.item)`.
- Keep details/copy/dismiss buttons as sibling controls and keep the existing
  notification store/history semantics unchanged.
- Add CSS only for the local notification action row, using existing token
  variables and the shared Button primitive.

## Acceptance

- Source guard proves `.app-notification` is not a keyboard/click target.
- Source guard proves task selection is only invoked by
  `Button[data-ui="app-notification-open-task"]`.
- Browser validation proves the notification section has no role conflict beyond
  live-region semantics, the task action is a native button, details/copy/close
  are sibling controls, and task activation happens only through the task
  action.
- Screenshot verifies toast and panel notification controls do not overlap.
