# Notification Panel Width Fill

Date: 2026-06-26

## Acronyms

- CSS: Cascading Style Sheets, the browser styling language.
- DOM: Document Object Model, the browser document tree.
- UI: User Interface, the visible overlay controls and panels.

## Task Definition

Notification center cards inside the right toolbar Notifications panel must
fill the panel width that the center workbench assigns. They must not shrink to
content width while the parent panel remains wider.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback logic, no duplicate width source, no blind patching, add tests, and visually verify frontend work with screenshots. |
| `specs/notification-center-history-contract-2026-06-09.md` | Toast and panel surfaces share `NotificationCenter`; panel list padding was removed so cards align to panel edges. |
| `specs/new-arch/2026-06-18-notification-live-region-task-action.md` | `NotificationCenter` remains one shared component; do not split toast and panel rendering. |
| `specs/new-arch/2026-06-26-right-toolbar-panel-initial-max-width.md` | Right toolbar panel width is controlled by center workbench tokens and initial-width caps, not by per-panel JavaScript constants. |

## Call Point Inventory

| Area | Evidence | Decision |
| --- | --- | --- |
| Notification mount | `packages/overlay/src/index.html` contains `#solidNotificationCenterMount.notification-center-panel` inside `#rightPanelNotifications`. | Keep the DOM mount. The host must stretch its child instead of creating a second wrapper. |
| Solid component | `packages/overlay/src/components/NotificationCenter.tsx` renders one `.app-notifications` root for toast and panel surfaces. | Keep the shared component and add no panel-specific render branch. |
| Notification CSS | `packages/overlay/src/styles/surfaces/notifications.css` owns `.notification-center-panel`, its direct child, `.app-notifications[data-surface="panel"]`, `.app-notification-group__items`, and `.app-notification`. | Make the mount, Solid Portal direct child, panel root, and notification rows stretch to the inherited panel width in the existing CSS owner. |
| Workbench sizing | `packages/overlay/src/styles/surfaces/workspace.css` owns `.center-workbench-view[data-initial-width-capped="true"]` and the right-toolbar max-width token. | Do not change workbench width ownership; the bug is descendant width fill, not panel max-width. |
| Static tests | `packages/overlay/test/notification-center-primitive.test.ts` guards shared component/CSS contracts. | Add source assertions that the panel root and rows fill available width. |
| Browser visual test | `packages/overlay/test/browser/notification-center-task-action-browser.test.ts` already opens the real Notifications panel and captures a panel screenshot. | Extend it to measure panel/card widths and save a current screenshot for visual review. |

## Root Cause

The center workbench now caps freshly opened right toolbar panels, but the
notification panel child chain does not explicitly consume the assigned inline
size. Browser evidence showed `#rightPanelNotifications` and
`#solidNotificationCenterMount` at 369 px while the portaled list and cards
stayed at 262 px. The direct child inserted by Solid Portal between
`.notification-center-panel` and `.app-notifications[data-surface="panel"]`
was the flex item resolving to content width. The result is a narrow card
column inside a wider right panel.

## Fix Plan

1. Keep `NotificationCenter` and center workbench logic unchanged.
2. In `notifications.css`, make `.notification-center-panel`, its direct
   child, and `.app-notifications[data-surface="panel"]` own `flex: 1 1 0`,
   `width: 100%`, `max-width: 100%`, and `min-width: 0` where they participate
   in flex sizing.
3. Make `.app-notification-group`, `.app-notification-group__items`, and
   `.app-notification` explicitly fill available width so grouped history rows
   cannot shrink to content width.
4. Extend static and browser tests with width-fill assertions.
5. Run focused tests, inspect the browser screenshot, and self-review the
   delivered CSS surface.

## Acceptance

- Notifications panel cards align with and fill the panel content width.
- Toast width behavior remains controlled by the existing toast rule.
- Center workbench right-toolbar width token and initial cap remain the single
  panel width source.
- No fallback, duplicate render branch, JavaScript width gate, or compatibility
  path is introduced.
- Focused tests and browser screenshot review pass.
