# Mailbox Global Native Notification Projection

## Recall

### User requirement

When a new item appears in Mailbox, OpenCorvus must also raise the operating
system notification shown at the bottom-right of the desktop.

### Acceptance

1. The first global Mailbox snapshot remains a no-replay baseline.
2. Every subsequently observed unread active Mailbox item is submitted once
   through the existing host `notification.send` command.
3. Changing the selected project directory while the new item arrives must not
   turn that item into a new per-directory baseline or suppress its system
   notification.
4. Read and archived items remain ineligible, deferred/failed native delivery
   remains retryable, and no in-app toast center is reintroduced.
5. Focused projector, HostTransport, Windows identity, type, build, and document
   checks pass. Existing running OpenCorvus/Overlay processes are not restarted,
   refreshed, or terminated.

### Hard constraints

- Mailbox is one global registered-project projection. The selected directory
  is transport context and row grouping metadata, not notification identity.
- `desktop-notifications.ts` remains the only eligibility, badge, permission,
  retry, presentation, and native-delivery projector.
- `notification.send` remains the only host submission command; Windows keeps
  the registered `ai.opencorvus.overlay` Application User Model ID (AUMID).
- No fallback, second notification store, polling source, gate, compatibility
  branch, or UI-only synthetic message is added.
- Tests use Bun only for focused non-browser suites. Playwright is launched
  with Node when browser evidence is required.

### Read records and evidence

- `specs/current/architecture/07-panel.md`: Mailbox is global; every unread
  active item owns badge/native delivery; the first **global** snapshot is the
  no-replay baseline.
- `2026-07-17-cross-platform-mailbox-notification-repair.md`: defines canonical
  Mailbox eligibility, permission, retry, and host delivery.
- `2026-07-23-overlay-interaction-settings-and-mailbox-refinement.md`: replaces
  the false-positive Windows plugin submission with registered AUMID and
  result-bearing Windows Runtime delivery.
- `2026-07-23-mailbox-system-message-projection.md`: tier-1/tier-2 system
  protocol notifications now enter the same canonical Mailbox projection.
- Running-process inspection found `desktopNotifications: true`, the packaged
  binary contains `overlay_notification_send`, and the AUMID is registered.
- The live Mailbox contained items created after Overlay startup and the
  canonical refresh/pagination requests ran, while the user observed no
  bottom-right notification. This places the defect after ingestion and before
  visible native delivery.
- Microsoft documents app notifications as the bottom-right transient surface
  and associates classic desktop toast delivery with AppUserModelID. The
  existing host adapter already owns that platform contract; this change does
  not replace it.

### Whole-repository grep

| Surface                                      | Call sites / disposition                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MailboxNotificationProjector`               | Production singleton and focused tests only. Replace its per-directory delivery/presentation maps with one global baseline and global presentation set. |
| `projectMailboxNotifications`                | Called only after canonical non-append Mailbox refresh in `MailboxPanel.tsx`; keep the current call and request ownership.                              |
| `projectMailboxNotificationScopeReplacement` | Called on disconnected/empty transport scope and scope replacement; keep badge reset only and do not reset the global delivery baseline.                |
| `openMailboxChangeStream`                    | `MailboxPanel.tsx` is the only production owner; retain the canonical event-triggered refresh.                                                          |
| `notification.send`                          | `desktop-notifications.ts` is the only production caller; `tauri-transport.ts` and Rust `overlay_notification_send` remain unchanged.                   |
| `seenByDirectory` / `presentedByDirectory`   | Exist only in `desktop-notifications.ts`; delete both because they contradict the global Mailbox contract.                                              |

No sub-agent was used because the user did not request delegation.

## Causal chain

Observable symptom: a new canonical Mailbox row appears without a bottom-right
system notification.

Direct trigger: notification projection can receive the same global Mailbox
after the selected project directory changes, but looks up a fresh
directory-keyed `seen` set. It treats the entire snapshot, including the new
item, as history and returns before native delivery.

Deep cause: the projector models global Mailbox delivery identity as
per-directory UI context even though `/mailbox` does not filter by the selected
directory. That turns a transport parameter into a second notification scope.

Why the previous Windows repair did not cure it: it repaired native submission
after the projector calls `notification.send`; this path suppresses the item
before that host call, so the correct AUMID adapter never runs.

## Implementation plan

1. Add a regression that seeds the global baseline under one selected directory
   and then projects a newly arrived item under another directory.
2. Replace directory-keyed delivery/presentation bookkeeping with one global
   baseline and one global presentation set, and remove the obsolete directory
   argument from the projector in the same change.
3. Run focused projector/transport/native tests, typecheck, build, and required
   spec health suites.
4. Re-grep owners, review the exact diff, record verification evidence, commit,
   fetch, and push the main-worktree branch to `myhexin`.

## Progress

- [x] Recall, call-site inventory, live evidence, and causal chain recorded.
- [x] Regression added and observed against the old implementation.
- [x] Production implementation complete.
- [x] Focused and repository verification complete.
- [x] Second review, commit, and git-cc push complete.

## Verification evidence

- The new cross-directory regression failed against the previous implementation:
  after `/project-a` seeded the first snapshot, a new `/project-b` item produced
  no delivery. It passes with one global baseline and confirms one exact send.
- Mailbox notification, change-stream, HostTransport, and retired-UI boundary
  suites pass: 31 tests and 119 expectations.
- Overlay TypeScript check passes.
- The production Vite build passes after transforming 4,952 modules.
- Windows notification-identity Rust tests pass: 2 tests, including configured
  AUMID registration and missing-display-name rejection.
- A live Windows submission under `ai.opencorvus.overlay` advanced
  `LastNotificationAddedTime` to `2026-07-24 11:18:30.199`, proving that the
  current host accepted the task-scoped notification. The desktop capture did
  not show a transient banner, so it is retained only as host-submission
  evidence and is not misreported as visual banner acceptance.
- Historical-links and product-documentation single-source suites pass. The
  combined document-health run has 84/87 passing; two failures are in the
  concurrently edited `07-panel.md`, and the tracked-record check also lists
  other concurrently untracked July records. This task does not overwrite or
  stage those owners' changes.
- Functional delivery is commit `06af2025a`; byte-safe index repair is
  `10417d7a1`. Both are published on
  `myhexin/work-v0.0.17beta-yr-0723`.
