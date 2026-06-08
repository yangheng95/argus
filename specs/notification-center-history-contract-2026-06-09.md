# Notification center history contract - 2026-06-09

## Problem

The overlay notification center reads the same `notificationStore.items` array as transient toast rendering. Dismissing a notification only sets `dismissedAt`, so short-lived success toasts and manually dismissed notices still remain in the right-side notification center. Reusing an id replaces the existing row. The resulting center history is determined by toast lifetime side effects instead of an explicit capture rule.

The notification center panel also has horizontal padding around the list, so notification cards do not align to the panel edges when the right toolbar panel is open.

## Call-point inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| `packages/overlay/src/services/notify.ts` `showNotification()` | Single primitive used by helper functions, runtime diagnostics, task list actions, SSE, connection, and `routeNotification`. | Add an explicit `centerHistory` flag to the stored item. Non-history notifications are removed on dismiss; history notifications are retained with `dismissedAt`. |
| `packages/overlay/src/services/notify.ts` `notifyError()` / `notifyWarning()` | Used for operator-actionable diagnostics and blocked operations. | Default these helper paths to `centerHistory: true`, while allowing callers to opt out explicitly. |
| `packages/overlay/src/services/notify.ts` `notifySuccess()` / `notifyProgress()` | Used for transient completion/progress feedback. | Default these helper paths to `centerHistory: false`. |
| `packages/overlay/src/services/notify.ts` `routeNotification()` | Task-list aggregate event owner for task lifecycle and interaction notifications. | Store these events in center history explicitly with `centerHistory: true`. |
| `packages/overlay/src/components/NotificationCenter.tsx` | Panel currently reads `notificationStore.items`; toast reads `visibleNotificationItems()`. | Panel reads a dedicated `centerHistoryNotificationItems()` selector. |
| `packages/overlay/src/styles/surfaces/notifications.css` | `.app-notifications[data-surface="panel"]` adds padding around the list. | Remove panel list padding and move only empty-state padding to the empty state, so notification cards align with panel edges. |

## Contract

- Toast visibility is controlled by `dismissedAt`.
- Notification center capture is controlled only by `centerHistory`.
- Dismiss removes non-history notifications from the store.
- Dismiss keeps history notifications in the store and marks them dismissed, so the toast closes but the center row remains.
- The right-side center panel displays only `centerHistory` notifications.

## Verification

- `bun test packages/overlay/test/notify-error-persistence.test.ts packages/overlay/test/notification-center-primitive.test.ts packages/overlay/test/notification-reliability.test.ts`
- `bun test packages/overlay/test/notify-no-boot-prompt.test.ts packages/overlay/test/connection-startup-diagnostics.test.ts`
