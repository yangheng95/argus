# Notification UI retirement

## Recall

### User requirement

- Retire the existing event-oriented Notification UI as a whole.
- Keep notification delivery open to the agent-oriented Mailbox pipeline,
  including the host badge and native system notifications.
- Do not modify the backend.

### Acceptance criteria

- Overlay renders no NotificationCenter or toast and performs no task-event OS
  notification dispatch.
- Delete the retired notification component, transient state, stylesheet and
  event-oriented translation copy rather than retaining hidden state or a
  compatibility facade.
- Preserve the desktop-notification setting, permission flow, native delivery
  transport and badge transport for unread agent-authored Mailbox notices and
  attention requests only.
- Migrate frontend action/runtime diagnostics to the existing `AppLog` source so failures remain inspectable in Logs without a second visible Notification surface.
- Keep OpenCorvus backend event schemas, `notify` metadata, Mailbox
  `category: notification`, Mailbox UI, and Tauri backend startup-failure
  notification implementation unchanged.
- Use `eventType === "mailbox.message"` as the existing backend-owned agent
  message discriminator. Canonical task-event projections in the same Mailbox
  must not drive the badge or native notifications.
- Add negative regression coverage proving the retired UI and automatic behavior cannot reappear; pass type, i18n, document, browser and visual verification.
- Commit with the `dsw-33987` prefix and push `v0.0.7beta` to git-cc remote `myhexin` without bypassing hooks.

### Hard constraints

- Use the current main worktree; do not reset, stash, rebase, rewrite history, create another worktree, or modify the existing untracked Darwin package artifacts.
- Do not add a hidden notification store, no-op compatibility notification API, fallback UI, alternate message feed, route gate, or state machine.
- Mailbox remains the only durable operator-facing agent message surface and
  the single source of badge/native notification facts; AppLog remains the only
  frontend diagnostic history.
- Do not change `packages/opencorvus/**`, backend routes, protocol schemas, or Tauri Rust startup-notification behavior.
- Use the repository Node browser runner for desktop visual verification and do not touch a running OpenCorvus/Overlay process.

### Sources read

- Root `AGENTS.md` instructions supplied in the task context.
- `specs/current/architecture/07-panel.md`, `07-panel-reactivity.md`, and `13-agent-communication-matrix.md`.
- `packages/overlay/src/components/NotificationCenter.tsx`, `services/notification-state.ts`, `services/notify.ts`, `utils/log.ts`, `store/settings.ts`, `components/settings/GeneralPanel.tsx`, `services/host-transport.ts`, `services/tauri-transport.ts`, `services/window.ts`, `components/App.tsx`, and `index.html`.
- Notification-focused Overlay tests, browser fixtures, package manifests, Tauri capability/plugin ownership, current Git status/history, and the existing Mailbox delivery record.

### Whole-repository search evidence

- Case-insensitive inventory found 581 Notification references across frontend, backend, tests and current specs; frontend-only UI inventory contains 293 references.
- Thirty-one production Overlay modules import `services/notify.ts`. Direct UI ownership is split across `NotificationCenter.tsx`, `notification-state.ts`, `notifications.css`, `App.tsx`, Settings, event routing, foreground badge lifecycle, task acknowledgement, and host transport notification commands.
- The existing `AppLog` currently writes Logs and then mirrors every error into
  `notification-state`, proving a real double projection. That promotion must
  be deleted; call sites migrate to explicit AppLog diagnostics.
- `desktopNotifications` has four persisted settings owners: store
  type/default/sanitizer, settings storage read/write, General settings UI, and
  tests. These remain for the agent Mailbox native delivery path.
- The Mailbox API exposes both agent-authored `mailbox.message` rows and
  canonical task-event projections. Its total unread count cannot be reused for
  the agent badge, so the frontend projection scans active pages and filters the
  stable event discriminator plus notification/attention semantics.
- Native Tauri Rust owns a separate backend-startup failure notification and plugin initialization. The user prohibited backend changes, so those Rust/Cargo/capability paths remain unchanged and are not reused by Overlay UI.
- Backend uses of “notification” include event delivery, JSON-RPC, Task lifecycle and Mailbox category semantics. They are outside this frontend retirement and remain unchanged.

### Independent agent feedback

- No subagent was launched because the active multi-agent boundary forbids spawning unless the user explicitly requests delegation. The inventory, implementation and second review are performed directly in the shared main worktree.

## Implementation plan

1. Commit and push this Recall/plan alone, excluding untracked packaging artifacts.
2. Replace Notification-shaped frontend diagnostics with `AppLog`, remove log-to-toast promotion, and delete notification state/component/style/i18n ownership.
3. Remove task-event notification routing and tray attention while preserving
   Settings, native notification commands and the Tauri badge command. Project
   only unread active agent Mailbox notices/attention requests; seed the first
   snapshot without replaying historical popups and deduplicate subsequent
   native sends by canonical message ID.
4. Rewrite focused tests as retirement guards and update affected browser fixtures so they assert Logs/inline error ownership and the absence of Notification UI.
5. Run focused tests, typecheck, API/docs/i18n checks, a Node-launched real desktop browser scenario, scoped screenshots and visual review; then perform a whole-repository retired-symbol scan and second Git review.
6. Record evidence, commit only task-owned files, re-fetch, merge any concurrent remote change without losing it, and push `v0.0.7beta` through hooks.

## Result

- Deleted the in-app Notification Center, transient notification state and
  notification stylesheet. Frontend diagnostics now write only to `AppLog`.
- Removed task-event notification routing and event-specific notification copy.
  The Tauri badge and native notification transports now project only unread
  active `mailbox.message` notices and attention requests.
- The first Mailbox snapshot seeds delivery identity without replaying
  historical native notifications. Later snapshots deduplicate by canonical
  message ID, while the badge reflects the full active agent message set across
  Mailbox pages.
- Verified focused protocol/projection/retirement tests, forced Overlay /
  transport protocol / Visual Studio Code typechecks, Overlay production build,
  i18n checks, historical-doc links and document health.
- Node-launched Playwright scenarios passed for the remaining shared loading
  spinner and General Settings failure behavior. Visual review of
  `.scratch/general-settings-surface-headers.png` confirmed the agent-specific
  desktop-notification copy and absence of any Notification Center surface.
