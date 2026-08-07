# Mailbox All-New-Mail System Notification

Date: 2026-07-27

Status: Implemented, verified, and delivered

Owner: Codex

## Recall

### User requirement

When Mailbox receives a new message, OpenCorvus must raise an operating-system
notification like the Codex desktop task-completion notification shown in the
supplied Windows screenshot. The current symptom is that the Mailbox row appears
without a system notification.

### Acceptance criteria

1. Every newly observed unread, active canonical Mailbox item, including
   `task.completed` status items and progress items, is submitted through the
   existing `notification.send` host command.
2. The first global Mailbox snapshot remains a no-replay baseline so opening
   OpenCorvus does not replay historical mail.
3. Read, archived, and already-presented items remain ineligible; repeated
   change-stream refreshes do not duplicate a notification.
4. Disabled settings, denied permission, superseded projections, deferred
   delivery, and native send failures retain their current retry and ownership
   semantics.
5. The canonical Mailbox stream/list remains the only event source. No second
   notification feed, local store, polling path, synthetic message, keyword
   matcher, or in-app toast center is introduced.
6. Focused unit and host-transport tests, Overlay typecheck/build, a real
   Node-launched browser flow, task-scoped screenshot review, documentation
   health, second review, commit, and legacy remote push pass.

### Hard constraints

- Desktop-only scope; the supplied Codex screenshot is behavior reference, not
  a request to clone Windows Notification Center UI inside OpenCorvus.
- `desktop-notifications.ts` remains the only eligibility, badge, permission,
  retry, presentation, and native-delivery projector.
- `notification.send` remains the only host submission command. The existing
  registered Windows Application User Model ID (AUMID) and result-bearing
  Windows Runtime adapter remain unchanged.
- Mailbox source admission stays backend-owned in
  `packages/opencorvus/src/engine/mailbox.ts`; the frontend must not infer new
  Mailbox rows from task names or event-name keyword rules.
- Preserve all pre-existing uncommitted Overlay work. Do not restart, refresh,
  terminate, or otherwise interfere with the user's running OpenCorvus/Overlay,
  and do not create a worktree.
- Playwright runs only through Node.

### Sources read

- Root `AGENTS.md` and the Browser control skill.
- Supplied Windows Notification Center screenshot at original resolution.
- `specs/current/architecture/07-panel.md`.
- `2026-07-23-overlay-interaction-settings-and-mailbox-refinement.md`.
- `2026-07-24-mailbox-global-native-notification-projection.md`.
- `2026-07-25-mailbox-notification-count-and-hover-lifecycle.md`.
- Current Mailbox engine/routes, Overlay Mailbox service/panel/request owner,
  desktop notification projector, Tauri/browser host transport, settings store,
  transport protocol, focused unit tests, and real browser fixtures.
- Git baseline `ed5d5de6e2` on
  `work-v0.0.19beta-yr-0727`, confirmed equal to
  `legacy-remote/work-v0.0.19beta-yr-0727` after the required pre-change push.

### Whole-repository search evidence

| Surface | Complete call sites and disposition |
| --- | --- |
| `isMailboxNotification` | Defined only in `packages/overlay/src/services/desktop-notifications.ts`; consumed only by the same projector and its focused test. Replace the category/attention filter with the canonical unread-active predicate. |
| `MailboxNotificationProjector` | One production singleton plus focused tests. Preserve its global baseline, serialized effects, presentation set, delivery retry, and projection-ownership behavior. |
| `projectMailboxNotifications` | Called only after a committed non-append canonical refresh in `MailboxPanel.tsx`. Keep this path and its complete active-page pagination. |
| `projectMailboxNotificationScopeReplacement` | Called only by `MailboxPanel.tsx` for scope/disconnection badge resets. Keep it; it does not reset the global no-replay baseline. |
| `openMailboxChangeStream` | Defined in `services/mailbox.ts` and owned in production only by the always-mounted `MailboxPanel.tsx`; `mailbox.connected` and `mailbox.changed` refetch the canonical list. Keep unchanged. |
| Mailbox route/source predicate | `packages/opencorvus/src/server/routes/mailbox.ts` owns `/mailbox` and `/mailbox/events`; `packages/opencorvus/src/engine/mailbox.ts` owns which protocol facts become Mailbox items. Keep unchanged because the missing host notification occurs after a canonical row already exists. |
| `notification.send` | One production caller in `desktop-notifications.ts`; browser and Tauri branches in `tauri-transport.ts`; Rust `overlay_notification_send`; protocol and host capability contracts; focused transport/source tests. Keep the command and adapters unchanged. |
| Settings/permission | `settingsStore.desktopNotifications` defaults to true; `GeneralPanel.tsx` owns the explicit toggle and permission request. Preserve the opt-out and permission semantics. |
| Browser evidence | `mailbox-concurrency-browser.test.ts` owns the real canonical Mailbox stream/refetch browser fixture. Add an independent non-attention `task.completed` status case so pagination concurrency remains isolated while the widened system-notification path, no-replay baseline, duplicate suppression, unread count, visible row, and task-scoped screenshot are all proved together. |
| Documentation | `specs/current/architecture/07-panel.md` currently states the narrower notification/attention eligibility. Update it and both spec indexes in the same delivery. |

Independent agent feedback: none. The user did not request sub-agents, and the
active collaboration boundary forbids unrequested delegation.

## Causal chain

Observable symptom: a new Mailbox row appears, but Windows receives no
OpenCorvus system notification.

Direct trigger: `isMailboxNotification()` rejects canonical unread active items
unless `category === "notification"` or `attention === true`. In particular,
the backend projects `task.completed` as `category: "status"` and
`attention: false`, so the item is filtered before permission inspection and
before `notification.send`.

Deep cause: the frontend host-popup eligibility policy is narrower than the
user-visible Mailbox contract. The row's backend category was repurposed as a
second delivery-admission decision, so “new Mailbox mail” and “new system
notification” diverged.

Why the existing native repair does not solve it: the registered Windows
Runtime adapter only runs after `notification.send`. Rejected status/progress
items never reach that command, so native identity and submission are not the
failing layer.

## Implementation and verification plan

1. Update focused regressions first so `task.completed` status and progress
   Mailbox items are required to be eligible, and the production projector must
   request permission and issue one exact native send for a newly added status
   item.
2. Replace the category/attention eligibility check with unread-active Mailbox
   eligibility while preserving the existing global no-replay and retry logic.
3. Exercise the real change-stream/refetch flow with a non-attention
   `task.completed` browser fixture; capture and inspect the task-scoped Mailbox
   screenshot without touching the user's running process.
4. Update current architecture and verification evidence, then run focused
   tests, Overlay typecheck/build, API/docs health, and a second diff/call-site
   review.
5. Stage only task-owned files, commit with the `dsw-33987` prefix, fetch and
   reconcile the legacy remote branch if needed, push to `legacy-remote`, and verify local
   and remote equality.

## Progress

- [x] User evidence, historical decisions, current owners, Git baseline, and
  whole-repository call sites inspected.
- [x] Recall, causal chain, and implementation plan recorded before production
  edits.
- [x] Focused regression updated and observed against the old implementation:
  the status/progress eligibility assertions failed, and the projector emitted
  only badge commands instead of permission and `notification.send` commands.
- [x] Production implementation completed: every unread, active canonical
  Mailbox item now enters the existing notification projector.
- [x] Real Node browser acceptance completed: 2/2 cases passed; the new
  `task.completed` case observed one exact browser system notification, retained
  a zero-popup historical baseline, refetched on a duplicate change without a
  second notification, and captured
  `.scratch/mailbox-concurrency-browser/mailbox-task-completed-system-notification.png`.
- [x] Screenshot inspected at original resolution: the task-completed Status
  row, historical Progress row, two-item unread count, launcher count, active
  Mailbox surface, and desktop layout are coherent.
- [x] Focused notification/stream/transport tests passed: 32 tests and 121
  assertions.
- [x] Overlay typecheck passed, and the production browser runner completed the
  Vite build before executing the browser acceptance.
- [x] Documentation health passed: 92 tests and 1,445 assertions across
  historical links, document health, and product single-source checks.
- [x] Second diff and call-site review passed; task-owned changes remain limited
  to the projector, its unit/browser regressions, current architecture, and
  indexed task record. Pre-existing user work remains unstaged.
- [x] Implementation commit `7369ead6b8` (`dsw-33987 notify for every new
  Mailbox item`) passed the repository pre-push typecheck, API route, generated
  API documentation, Overlay internationalization, and secret-scan hooks, then
  reached `legacy-remote/work-v0.0.19beta-yr-0727`.
