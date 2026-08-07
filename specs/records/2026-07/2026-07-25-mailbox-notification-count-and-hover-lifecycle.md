# Mailbox Notification Content, Count, and Hover Lifecycle Repair

## Recall

### User requirements

1. Repair system notifications whose long event summary is truncated as the
   title while the body exposes an internal event type instead of task details.
2. Add the canonical unread-message count to the Mailbox launcher in the upper
   right of the left Dock; counts above 99 display as `99+`.
3. A Mailbox opened by launcher hover closes when the pointer leaves the whole
   left Dock, while an explicitly clicked Mailbox remains open.
4. Closing a hover-opened Mailbox must preserve the mounted Mailbox list,
   pagination cursor, loaded pages, disclosure state, and scroll position.

### Acceptance criteria

- Canonical system Mailbox items use the owning Task title as their short
  subject and a real user-facing event message as their body; no projected
  system item falls back to a raw protocol event type.
- Native/browser/Visual Studio Code delivery continues through the single
  `notification.send` command and uses the repaired Mailbox subject/body.
- Desktop popups are limited to unread active items whose backend-owned
  projection is a notification or requires attention; ordinary progress/status
  rows remain durable in Mailbox without becoming host popups.
- The launcher count is sourced from the backend `MailboxPage.unreadCount`,
  renders `1` through `99`, caps display at `99+`, and exposes the exact count to
  assistive technology.
- Hover open, pointer-leave close, click-to-pin, pagination identity, and scroll
  continuity pass in an isolated real Vite page launched with Node. A desktop
  screenshot is reviewed and corrected if necessary.
- Focused backend, Overlay, host-transport, type, build, documentation, second
  review, commit, and legacy remote push checks pass without touching unrelated work.

### Hard constraints

- Keep protocol events plus the backend Mailbox projection as the single durable
  notification/count source; do not add local storage, a second notification
  feed, synthetic messages, event-name keyword matching, a toast center, or an
  iframe/query/signal preview substitute.
- Reuse the canonical `Badge`, `Button`, Mailbox request owner, mounted
  `MailboxPanel`, HostTransport, and Node browser runner.
- Do not remount Mailbox to implement hover close. Do not reset or recreate its
  cursor or list state when only the selected left-side activity changes.
- Preserve every concurrent worktree modification. Do not restart, refresh, or
  terminate a running OpenCorvus/overlay process and do not create a worktree.

### Sources read

- Root `AGENTS.md` supplied in the current task context.
- Browser control skill.
- `specs/current/architecture/07-panel.md` and
  `07-panel-reactivity.md`.
- `2026-07-17-cross-platform-mailbox-notification-repair.md`,
  `2026-07-20-left-sidebar-mailbox-mark-all-read.md`,
  `2026-07-22-mailbox-single-row-expanding-search.md`,
  `2026-07-23-mailbox-system-message-projection.md`, and
  `2026-07-24-mailbox-global-native-notification-projection.md`.
- Current protocol event definitions and emitters, backend Mailbox projector and
  tests, Overlay Mailbox panel/projector/host transports, left-Dock app shell,
  shared UI primitives/styles, and existing Mailbox browser fixtures.
- The live read-only SQLite event/task projection that produced the reported
  screenshot.

### Whole-repository grep

| Surface                                                   | Call sites and disposition                                                                                                                                                                                        |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mailboxItemFromRow`                                      | Sole backend projection from protocol facts to system Mailbox rows. Repair system subject/body here; preserve agent-authored `mailbox.message` content.                                                           |
| `canonicalMailboxPresentation` / `BusEvent.notifyTypes()` | Sole source admission and category/attention policy. Keep admission, remove raw event-type display fallback, and require a user-facing message from the real payload.                                             |
| `sendHostNotification` / `notification.send`              | One Overlay caller and browser/Tauri/Visual Studio Code host adapters. Keep the command and consume repaired fields without a second formatter.                                                                   |
| `MailboxNotificationProjector` / `isMailboxNotification`  | Production singleton plus focused tests. Restore backend category/attention eligibility while preserving global baseline, retry, and badge ownership.                                                             |
| `MailboxPanel`                                            | Sole mounted Mailbox UI and owner of `items`, pagination `cursor`, counts, selection, expansion, stream, and scroll DOM. Add a count callback only at committed backend-page boundaries; never remount for hover. |
| `main.tsx`                                                | Sole application-level owner of left activity selection and launcher attention. Add one unread-count signal and pass it from the mounted panel to `App`.                                                          |
| `App.tsx`                                                 | Sole Search/Mailbox launcher cluster and hover timer. Add canonical Badge rendering plus transient hover ownership and whole-left-Dock leave close; a click pins a hover-opened Mailbox.                          |
| `titlebar.css`                                            | Sole launcher geometry and attention animation owner. Add bounded Badge geometry without a new icon/button primitive.                                                                                             |
| Mailbox source/unit/browser tests                         | Update the old raw-event fallback expectation; cover repaired content, eligibility, exact count capping, hover close, click pin, cursor/list identity, scroll continuity, and screenshot evidence.                |

No sub-agent is used because the user did not request delegation.

## Causal chain

Observed notification: a long coordination reason is truncated as the first
line, Chrome/localhost occupies platform attribution, and the last line is
`agent.coordination.responded`.

Direct trigger: the coordination emitter stores the complete reason in
`summary`; `mailboxItemFromRow` promotes that summary to `subject` and falls back
to `event.type` for `body`; `sendHostNotification` forwards both strings
unchanged.

Deep cause: protocol lifecycle payloads and user-facing Mailbox presentation
were conflated. The backend projection guessed optional detail fields and used
an internal identifier as display content instead of making Task identity plus
the real event message the canonical presentation.

Amplifier: the July 22 delivery-policy change made every unread active Mailbox
row eligible for a host popup, so low-value progress/status protocol events
exposed the malformed presentation more frequently.

Why CSS cannot repair it: browser and operating-system notification surfaces
own their layout. Overlay CSS can improve the left-Dock launcher, but system
notification semantics must be corrected before the host command.

## Implementation plan

1. Add failing backend and projector regressions for the exact coordination
   payload shape and notification eligibility.
2. Repair canonical system Mailbox subject/body projection and remove the raw
   protocol-type display fallback.
3. Project committed unread count to the left-Dock launcher through the mounted
   Mailbox owner, cap only its visual label at `99+`, and preserve the exact
   accessible count.
4. Add hover ownership so whole-left-Dock pointer leave closes only a
   hover-opened Mailbox; keep click-open persistent and preserve the mounted list
   and cursor.
5. Run focused checks, real Node/Vite interaction and screenshot review, then
   second-review the full diff and update this record with exact evidence.
6. Commit only task-owned files with the `dsw-33987` prefix, fetch the latest
   legacy remote branch, rerun required checks, and push the main branch through hooks.

## Progress

- [x] Recall, causal chain, live evidence, and full call-site inventory recorded.
- [x] Regressions added and observed against the old implementation.
- [x] Backend and Overlay implementation complete.
- [x] Real Vite visual/interaction acceptance complete.
- [x] Second review complete.
- [x] Commit and legacy remote push complete.

## Verification evidence

- The pre-implementation focused regression run produced 10 expected failures
  across system message presentation, host-popup eligibility, launcher count,
  and hover ownership.
- The completed focused suite passes 61 tests with 591 expectations, including
  coordination presentation, summary-free structured session errors, popup
  eligibility, count projection, and mounted Mailbox ownership.
- `node packages/overlay/test/browser-runner.mjs
  packages/overlay/test/browser/mailbox-concurrency-browser.test.ts` passes in
  a real production Vite build. It verifies exact count `120`, visual `99+`,
  hover-open and whole-Dock leave-close, click-to-pin, the retained
  `old-cursor` action, 24 loaded rows, and exact scroll continuity after reopen.
- The desktop screenshot at
  `.scratch/mailbox-concurrency-browser/mailbox-launcher-count-and-hover.png`
  was reviewed both directly and in the in-app Browser: the Badge remains
  attached to the canonical launcher without obscuring the Mailbox glyph, the
  compact list remains readable, and the browser reported no warning/error
  logs.
- Overlay and backend package type checks pass.
- The task-owned staged snapshot passes all 91 historical-link,
  document-health, and product-doc single-source tests with 1,461 expectations.
- Implementation commit `977e223b7b` passed the normal pre-push hook and was
  pushed to `legacy-remote/v0.0.18beta`; the hook passed the 11-package typecheck,
  SDK import/runtime checks, 32-file API route inventory, 291-operation API docs
  check, Overlay i18n, and secret scan.
