# Right Toolbar Inspector And Notification Center - 2026-06-07

## Problem

The right vertical toolbar opens Explorer, Diff, Browser, and Assistant, but the always-mounted Inspector is not represented in the same toolbar. Notifications also use the top-level `NotificationCenter` as a transient toast viewport; successful/info notifications auto-dismiss from the store, so there is no center that collects all notifications.

## Call Points

| Area | File | Decision |
| --- | --- | --- |
| Right activity source | `packages/overlay/src/main.tsx` `RightActivity`, `RIGHT_ACTIVITIES`, `activeRightActivity()`, `selectRightActivity()` | Add `inspector` and `notifications` to the existing toolbar source. Keep Explorer/Diff/Browser as center workbench entries and Assistant as the coding-assistant selector. |
| Inspector body | `packages/overlay/src/index.html` `rightPanelInspector` | Keep Board as the Inspector implementation and make its active state driven by the selected right side panel. |
| Notification body | `packages/overlay/src/index.html` new right panel body | Mount a panel-mode `NotificationCenter` in the right pane. Do not add a second notification data source. |
| Toast viewport | `packages/overlay/src/main.tsx` top-level notification host | Keep the fixed toast viewport, but render only non-dismissed items there. |
| Notification store | `packages/overlay/src/services/notify.ts` | Preserve notification history in `notificationStore.items`; auto-dismiss and manual toast close mark items dismissed instead of deleting them. `clearNotifications()` remains the explicit history reset for tests/settings. |
| Notification component | `packages/overlay/src/components/NotificationCenter.tsx` | Reuse the component with a `surface` prop: `toast` filters visible toast items, `panel` lists all collected notifications grouped by task and exposes an empty state. |
| Notification CSS | `packages/overlay/src/styles/surfaces/notifications.css` | Keep fixed toast styling under `data-surface="toast"` and add contained right-panel styling under `data-surface="panel"`. |
| I18n | `packages/overlay/src/i18n/*.json` | Add concise empty-state copy. |
| Tests | `packages/overlay/test/*notification*`, `acceptance-panel-mount`, `coding-assistant-panel`, `side-activity-toolbar-browser` | Pin inspector/notification toolbar entries, panel mount, and notification history retention. |

## Constraints

- Single source: notification history and toast visibility are one store, not parallel stores.
- Task aggregation: the center groups notification history by `taskID`; notifications without a task go under a system group.
- No compatibility mapping from an old right tab system; the existing right toolbar primitive remains the control.
- Browser preview remains task-scoped and center-workbench backed.
- Dismissing a managed-server failure must still hide its toast; a later failure with the same id replaces and re-shows the same history entry.

## Verification

- `bun test --timeout 120000 packages/overlay/test/notify-error-persistence.test.ts packages/overlay/test/notification-center-primitive.test.ts packages/overlay/test/acceptance-panel-mount.test.ts packages/overlay/test/coding-assistant-panel.test.ts`
- `bun test --timeout 120000 packages/overlay/test/side-activity-toolbar-browser.test.ts`
- `bun run --cwd packages/overlay typecheck`
