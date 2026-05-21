# Notification Click Task Routing

- Date: 2026-05-21
- Scope: overlay in-app notifications, task unread highlight, existing desktop notification send gate.
- Prior design recalled: `specs/notification-reliability-2026-05-18.md` owns event tiering, single task-list notification owner, and badge projection. This change must extend that projection, not add a second notification ledger.

## Requirements

- Clicking a task notification opens the corresponding task conversation.
- After the task switch succeeds, the clicked notification is removed.
- Tasks with unclicked notification facts stay highlighted in the task list.
- Desktop/system notifications must be attempted through the existing Tauri notification channel when enabled; no startup or SSE-time permission prompt is allowed.

## Call-Site Inventory

| Surface | File | Decision |
|---|---|---|
| Task-list notification owner | `packages/overlay/src/services/events.ts::handleTaskListNotification` | Keep as the only live notification caller; no per-task stream notification side effects. |
| Notification routing | `packages/overlay/src/services/notify.ts::routeNotification` | Attach `taskID` to in-app notification items and derive unread facts from the same badge ack projection. |
| Badge projection | `packages/overlay/src/services/notify.ts::computeBadge` | Extend typed ack keys with pending-interaction task facts; failed task and rejected evaluation keys remain unchanged. |
| Notification UI | `packages/overlay/src/components/NotificationCenter.tsx` | Click task-bound notifications, call `selectTask(taskID)`, refresh task summary, ack task notification facts, then dismiss. Close button remains a dismiss-only control. |
| Task row UI | `packages/overlay/src/components/TaskList.tsx` | Render `data-notification-unread` from the exported projection helper. |
| Task row style | `packages/overlay/src/styles/surfaces/sidebar.css` | Add a visible unread notification highlight distinct from `data-active`. |
| Desktop send gate | `packages/overlay/src/services/notify.ts` and `tauri-transport.ts` | Preserve no-prompt rule. Tauri send path can attempt `notification.send` directly after focus/settings checks; browser host still requires granted Web Notification permission. |

## Acceptance

- A routed task notification creates an in-app item with `taskID`.
- Clicking that item selects the task and only then dismisses it.
- Failed task, rejected evaluation, and pending interaction facts keep the task highlighted until the task notification is acked.
- Acking one fact type does not clear another task's fact.
- `routeNotification` still does not call `notification.requestPermission`.
- When desktop notifications are enabled and tier/focus allow it, Tauri host sends a native notification without being blocked by a `default` permission probe.
