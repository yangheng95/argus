# Cross-platform Mailbox notification repair

## Recall

### User requirement

- Repair every current Mailbox-to-system-notification problem across supported
  Tauri desktop, browser, and Visual Studio Code hosts.
- Fix the root ownership and transport contracts rather than adding an event-name
  gate, fallback notification feed, or second notification state store.

### Acceptance criteria

- Every new unread, unarchived Mailbox item whose canonical backend projection
  has `category: notification` or `attention: true` contributes to the host badge
  and is delivered once through the active host notification surface.
- Status/progress-only, read, and archived Mailbox items do not notify.
- Tauri follows the official notification-plugin permission contract on macOS,
  Windows, and Linux; browser delivery requires the Web Notification permission;
  Visual Studio Code uses its supported notification API without inventing an
  operating-system permission prompt.
- A host-side no-op or lost permission is reported as deferred rather than being
  recorded as delivered. Scope replacement, reconnect, retry, deduplication, and
  first-snapshot no-replay behavior remain deterministic.
- Tests cover the real canonical Mailbox event families, all three hosts,
  transport validation, permission denial/default/grant, and send races.
- The remaining General Settings notification control is rendered and visually
  reviewed in an isolated Node-launched browser target. The running user
  OpenCorvus/Overlay process is not restarted, refreshed, or reused for testing.
- Focused tests, type checks, build, API/document checks, second review, commit,
  and git-cc push complete on `v0.0.8beta`.

### Hard constraints

- Preserve the Mailbox as the only durable notification source and `AppLog` as
  the only frontend diagnostic history; do not restore NotificationCenter,
  toasts, tray attention, or task-event routing outside the Mailbox projection.
- Use backend-owned Mailbox presentation fields as the single policy source.
  Do not introduce an event-name allowlist, compatibility alias, fallback, gate,
  state machine, or hidden notification state.
- Keep the first snapshot as a baseline so installing or reconnecting does not
  replay historical notifications.
- Preserve unrelated dirty worktree changes. Do not reset, stash, create a
  worktree, or interfere with the running application.
- Launch browser verification with Node, never Bun.

### Sources read

- Root `AGENTS.md` supplied in task context.
- `specs/current/architecture/07-panel.md`,
  `07-panel-reactivity.md`, `13-agent-communication-matrix.md`,
  `specs/records/2026-07/2026-07-17-notification-ui-retirement.md`, and
  `2026-07-16-squad-mailbox-and-right-dock.md`.
- `packages/opencorvus/src/engine/mailbox.ts`, Mailbox routes/tools/tests,
  Overlay Mailbox panel, projector, transports, settings and tests,
  transport-protocol command schema/tests, and Visual Studio Code bridge/tests.
- Official Tauri notification-plugin documentation and source, plus the official
  Visual Studio Code notification API and user-experience guidance.
- Browser control skill instructions for the required isolated visual review.

### Whole-repository search evidence

- The backend has one canonical Mailbox presentation table. It projects
  `task.failed`, `goal.failed`, `interaction.requested`, and
  `agent.coordination.requested` as notification/attention items, alongside
  agent-authored `mailbox.message` rows.
- The live project Mailbox returned twelve unread active rows during diagnosis;
  every notification/attention row used a canonical event type rather than
  `mailbox.message`, proving ingestion and rendering work while delivery filters
  every real row.
- Overlay `isAgentNotification` requires `eventType === "mailbox.message"`
  before consulting the canonical fields. Its tests use a `mailbox.message`
  fixture by default and explicitly reject task events, so the regression is
  encoded as expected behavior instead of covered by a real mixed projection.
- Tauri, browser, and Visual Studio Code all expose the same three notification
  commands. Tauri incorrectly declares that permission inspection is unnecessary;
  browser send silently returns after a permission race; Visual Studio Code maps
  delivery to `showInformationMessage` but has no notification bridge test.
- Tauri capabilities and plugin registration are present. The official plugin
  contract checks permission before calling `sendNotification` on every supported
  desktop platform.

### Call-site disposition

| Surface                                    | Current responsibility                                  | Disposition                                                                                       |
| ------------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `engine/mailbox.ts` canonical presentation | Computes Mailbox category and attention                 | Keep as the only notification policy source.                                                      |
| `MailboxPanel.tsx`                         | Hydrates pages and reacts to the project change stream  | Keep; continue invoking one projector after committed refreshes.                                  |
| `desktop-notifications.ts`                 | Filters, badges, deduplicates, checks permission, sends | Replace event-name filtering with canonical field filtering; retain lifecycle logic.              |
| `host-transport.ts` capability matrix      | Declares per-host permission behavior                   | Correct Tauri to require permission inspection; retain browser true and Visual Studio Code false. |
| `tauri-transport.ts` browser path          | Web Notification API                                    | Return explicit accepted/deferred delivery evidence and preserve the tag.                         |
| `tauri-transport.ts` Tauri path            | Tauri notification plugin                               | Verify granted permission before send and return explicit acceptance.                             |
| `vscode-extension/transport/bridge.ts`     | Visual Studio Code notification API                     | Return explicit acceptance and add bridge coverage.                                               |
| transport protocol                         | Validates notification command shape                    | Keep one command shape; add missing positive/negative notification cases.                         |
| General Settings                           | Explicit enable/permission gesture                      | Preserve and visually verify; surface permission failures through its existing inline owner.      |

### Independent-agent feedback

- No subagent was launched because the active developer boundary permits agents
  only when the user explicitly requests delegation. The main agent owns the
  inventory, implementation, tests, visual review, and second review.

## Implementation plan

1. Make canonical Mailbox `category`/`attention` plus acknowledgement state the
   only eligibility predicate and add real event-family regression fixtures.
2. Correct the host capability matrix and make notification send return explicit
   accepted/deferred evidence across Tauri, browser, and Visual Studio Code.
3. Cover permission checks, browser permission races, Tauri send failures,
   Visual Studio Code bridge delivery, protocol validation, reconnect and
   deduplication behavior.
4. Update current architecture wording so it matches the backend-owned policy.
5. Run focused and package checks, build, isolated Node browser Settings visual
   acceptance, and a second source/diff review; record exact evidence here.
6. Commit only task-owned paths with the `dsw-33987` prefix, fetch/merge the
   latest git-cc branch if needed, rerun affected checks, and push
   `v0.0.8beta` through hooks.

## Result

- Replaced the frontend `mailbox.message` event-name filter with the canonical
  backend projection fields: every unread, unarchived `notification` or
  attention item now contributes to the badge and notification delivery. This
  includes real `task.failed`, `goal.failed`, `interaction.requested`, and
  `agent.coordination.requested` rows without introducing a second allowlist.
- Changed the projector's seen set from a current-snapshot mirror to an
  append-only delivery identity set, so reading, archiving, restoring, or
  temporarily removing an item cannot redeliver the same Mailbox message.
- Tauri now participates in permission inspection on every desktop platform,
  distinguishes denied permission, rechecks permission at send time, and
  reports accepted delivery explicitly. Browser delivery returns `false` after
  a permission race instead of silently no-oping; Visual Studio Code returns
  explicit acceptance after its supported notification API resolves.
- General Settings now keeps a denied/default/unsupported permission result
  visible in its existing inline error owner. The retired Notification Center,
  toast history, tray attention, task-event router, and hidden notification
  state remain absent.
- Added canonical event-family, retry, partial-batch, restored-item,
  browser/Tauri transport, capability-matrix, Visual Studio Code bridge, and
  transport-protocol regressions. The focused backend/frontend/host suite passed
  with 87 tests; three affected TypeScript package checks, Overlay i18n, Vite
  production build, 78 document-health tests, and the pre-push quality suite
  passed.
- `node packages/overlay/test/browser-runner.mjs
  packages/overlay/test/browser/general-panel-fail-fast-browser.test.ts` passed.
  Visual review of `.scratch/general-settings-fail-fast.png` and
  `.scratch/general-settings-notification-owner.png` confirmed the switch,
  inline permission failure, section rhythm, and disabled state remain legible
  without restoring a second notification surface.
