# Mailbox Single-Row Expanding Search

## Recall

### User requirement

- Merge the two Mailbox header rows shown in the supplied desktop screenshot into one resting row.
- When Search opens, show no separate X/close action.
- Collapse Search automatically when the pointer leaves the expanded header.
- While Search is expanded, hide every other Mailbox header control and let the SearchField occupy the complete row.
- Remove the Archived view from the left-sidebar Mailbox and replace the Inbox word label with an icon.
- Follow-up clarification: keep the Inbox icon but show the active Mailbox total beside it; the earlier count-free interpretation was incorrect.
- When any new unread active Mailbox item arrives, raise a native system notification; the default-enabled setting must acquire permission on the real delivery path even if the user has never toggled it.
- The user allowed a right-side popup only if desktop notification support did not exist. The Tauri host already has a real native notification plugin and canonical commands, so no duplicate in-app popup surface is introduced.

### Acceptance criteria

- The resting Mailbox header is one horizontal row containing the selection/unread summary, mark-all-read action, one Inbox icon with the active total, and Search launcher without wrapping.
- No Archived control or client-side Mailbox view-switching state remains in this Overlay surface; `page.activeCount` is the single source for the visible Inbox total.
- Activating Search focuses one canonical SearchField whose shell spans the complete available header width; the summary, actions, view control, launcher, and standalone close button are absent.
- The expanded SearchField does not render a clear/close X. Escape or pointer leave invokes the same close operation, clears the query, restores the single resting row, and leaves no invisible filter.
- Keyboard focus, view selection, mark-all-read behavior, and existing Mailbox data ownership remain unchanged.
- Focused source tests, Overlay typecheck/build, Node-launched browser interaction, and task-scoped screenshot review pass without interacting with the user's running OpenCorvus process.
- The initial Mailbox snapshot remains a no-replay baseline, while each later unread active item is delivered once through the host notification command regardless of Mailbox category.

### Hard constraints

- Keep `MailboxPanel`, `SearchField`, `SegmentedControl`, `Button`, and `mailbox.css` as the only existing owners; add no duplicate renderer, local durable state, fallback, gate, responsive/mobile branch, or handwritten substitute primitive.
- Keep `/mailbox` plus acknowledgement events as the single durable Mailbox source. Search open/query remain ephemeral component presentation state.
- Desktop-only scope. Playwright runs through Node.js, not Bun.
- Preserve unrelated dirty work, do not create a worktree or restart/refresh/close the user's live OpenCorvus/Overlay, and push only task-owned changes to `myhexin` with the `dsw-33987` prefix.

### Supplied evidence

- `codex-clipboard-ec42e776-53ec-44c3-9316-294bb9da5d0b.png` shows the unread/mark-read summary on one row, the view/search controls on a second row, and a standalone X beside the expanded SearchField.

### Sources read

- Root `AGENTS.md` and the Browser control skill.
- `specs/current/architecture/07-panel.md` and `07-panel-reactivity.md`.
- `2026-07-22-mailbox-reading-and-compact-controls.md`, `2026-07-20-desktop-left-rail-and-mailbox-refinement.md`, and `2026-07-21-mailbox-global-project-grouping-and-action-geometry.md`.
- `MailboxPanel.tsx`, `mailbox.css`, the shared `SearchField`, focused Mailbox tests, and the Node browser Mailbox fixture.

### Whole-repository search evidence

Searches covered `searchOpen`, `openSearch`, `closeSearch`, `mailbox-panel__header`, `mailbox-panel__title-row`, `mailbox-panel__controls`, `mailbox-panel__search-shell`, `mailbox-search-toggle`, and `mailbox-search-close` across production, tests, current architecture, and July records.

The total-count correction searched `counts().active`, `activeCount`, `mailbox.active`, `.mailbox-panel__inbox`, count/badge patterns, and all Mailbox source/browser assertions. `MailboxPanel.refresh` already commits `page.activeCount` into the component's sole `counts` signal, so the repair only projects that existing canonical value beside the Inbox icon; it does not derive a count from the loaded page or introduce another request/state owner.

The follow-up search covered `projectMailboxNotifications`, `isMailboxNotification`, `ensureDesktopNotificationPermission`, `requestNotificationPermission`, `notification.permission`, `notification.requestPermission`, `notification.send`, and `desktopNotifications` across the Overlay component, projector, settings panel, host transports, capability declarations, tests, and current architecture. It found one delivery path: `MailboxPanel.refresh` projects the canonical active page into `MailboxNotificationProjector`, which calls the host transport and then the Tauri notification plugin. The default-enabled path checked a `default` permission but never requested it; permission acquisition existed only behind a manual settings-toggle gesture.

| Owner / call site                        | Decision                                                                                                                                                                                                                |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MailboxPanel.tsx`                       | Keep the sole `searchOpen`/`query` owner and existing `openSearch`/`closeSearch`; project either the complete resting toolbar or the complete expanded search row, retire Archived/view-switch state, and route pointer leave/Escape through `closeSearch`. |
| `SearchField.tsx`                        | Reuse unchanged. The Mailbox instance omits `onClear`, so this expanded surface has no clear X while other SearchField consumers retain their established behavior.                                                     |
| `mailbox.css`                            | Keep the header one-row geometry owner, size the compact Inbox icon/count pair, and make the expanded search shell fill the row. Delete obsolete two-row, segmented-view, and standalone-close geometry.                    |
| `mailbox-panel.test.ts`                  | Replace the retired close-button/two-row contract with structural assertions for one resting row, mutually exclusive expanded search, no X, and pointer-leave close.                                                    |
| `mailbox-left-sidebar-browser.test.ts`   | Measure one-row resting geometry, prove Archived absence and the Inbox icon/canonical active total pair, verify expanded Search hides all other controls and fills the header, test pointer-leave close/query reset, preserve Escape coverage, and capture task-scoped screenshots. |
| `07-panel.md` / `07-panel-reactivity.md` | Record the single-row/resting versus full-row/search presentation contract without changing durable Mailbox semantics.                                                                                                  |
| Other Mailbox/browser fixtures           | Preserve stable routes, response shape, and mount hooks; no other caller owns this header interaction.                                                                                                                  |
| `desktop-notifications.ts`               | Keep the sole serialized Mailbox projector and native sender; expand eligibility to every unread active item and reuse its existing permission helper when delivery requires a grant.                                    |
| `GeneralPanel.tsx`                       | Preserve the explicit settings-toggle permission request; it is not a substitute for permission acquisition when the default-enabled setting receives its first new Mailbox item.                                      |
| `tauri-transport.ts` / host capabilities | Preserve the canonical `notification.permission`, `notification.requestPermission`, and `notification.send` commands and Tauri plugin implementation; add no second notification API.                                 |
| Notification projection tests           | Prove status/progress Mailbox eligibility and the default-permission check → request → native-send sequence, while preserving no historical replay, ownership, retry, and setting-race contracts.                         |
| `en-US.json` / `zh-CN.json`              | Delete the four Archived/view labels retired with the selector; the canonical panel-i18n checker proves no orphaned locale contract remains.                                                                            |

### Independent agent feedback

- The read-only explorer independently confirmed `MailboxPanel.tsx` as the only state/render owner, `mailbox.css` as the only geometry owner, and `mailbox-left-sidebar-browser.test.ts` as the only rendered header/search interaction fixture.
- It identified both X sources: the explicit `mailbox-search-close` Button and the SearchField clear action enabled by this Mailbox instance's `onClear`. The shared text-field CSS already suppresses the browser-native search cancel decoration, so removing those two instance-level inputs produces no X without changing the shared primitive.
- It recommended binding pointer leave to the stable header rather than the replaced trigger/search child so DOM projection cannot close Search immediately during expansion. It also confirmed that the backend, transport, routes, translations, shared SearchField, and other browser fixtures require no semantic change.

## Root-cause chain

The visible two-line header is structural: `.mailbox-panel__header` is a grid with vertical gap and permanently mounts a title row followed by a controls row. Opening Search only replaces the Search launcher inside the second row, so the view toggle remains beside it and the first row remains above it. A separate `mailbox-search-close` Button creates the visible X even when the query is empty. The root repair is one mutually exclusive header projection, not additional CSS hiding rules: the resting toolbar owns every compact control on one row, while the expanded projection owns only the full-width shared SearchField and closes through the component's existing query-reset operation.

The native notification gap is separate from the header geometry. `desktopNotifications` defaults to true, but the production projector called `readHostPermission()` and accepted only `granted`; a fresh installation normally returns `default`, so it deferred forever unless the user first visited Settings and toggled the control. In addition, `isMailboxNotification` discarded ordinary status/progress Mailbox rows, contradicting the follow-up requirement to notify for a new Mailbox item. The root repair stays inside the existing single projector: all unread active items are eligible, and its permission check reuses `ensureDesktopNotificationPermission()` so the canonical host permission request precedes the first real send.

The missing total was caused by presentation removal, not missing data: the single-row refactor kept `counts().active` synchronized from the backend but removed every visible projection of that field together with the Inbox word label. The corrected surface keeps the word label retired while projecting `counts().active` through the existing Badge primitive next to the Inbox icon.

## Implementation plan

1. Update focused source and browser assertions so the current two-row/standalone-close behavior fails.
2. Refactor the canonical Mailbox header into mutually exclusive resting and expanded projections, retire the Archived/view-switch state, and simplify its sole CSS geometry owner.
3. Update current architecture wording and this record with the independent review and verification result.
4. Run focused tests, Overlay typecheck/build, required documentation checks, and the Node-launched Mailbox browser fixture; inspect task-scoped screenshots at original resolution and iterate on any mismatch.
5. Review the final diff and exact call-site grep, commit only task-owned files, push to `myhexin`, and verify local/remote equality.
6. Extend the same canonical projector to all new unread active Mailbox items, acquire default host permission on demand, and rerun notification projection/transport regression tests.
7. Restore the canonical active total beside the Inbox icon, then repeat compact-header geometry and screenshot verification.

## Status

- [x] User evidence, current source, historical decisions, and full call sites inspected.
- [x] Recall, root-cause chain, and implementation plan recorded.
- [x] Focused regressions updated.
- [x] Production implementation and architecture wording updated.
- [x] Static, browser, and screenshot verification passed.
- [x] Follow-up system-notification regressions and production implementation complete.
- [x] Second review complete; commit and git-cc push follow this recorded verification.
- [x] Inbox active-total correction and focused visual verification complete.

## Verification evidence

- Focused Mailbox source tests: 14 passed, including the single-row toolbar, active-Inbox-only projection, absent Archived/count/X controls, shared SearchField, and mouse-leave query reset contracts.
- Overlay TypeScript: passed with `tsc --noEmit`.
- Production Vite build: passed with 2,644 modules transformed.
- Node-launched Mailbox browser fixture: passed. The resting header measured about 42.6px high with all visible controls sharing one centerline; the DOM contained zero Archived controls and zero retired view-count elements, while the remaining Inbox rendered one Lucide icon and the canonical active total.
- The expanded SearchField occupied the complete header content width, unmounted the summary/actions/Inbox/Search launcher, rendered no Button/X, filtered the visible projection after typing, and restored all ten fixture messages after the mouse left the stable toolbar. Escape independently restored the resting toolbar.
- Original-resolution screenshots reviewed: `.scratch/left-sidebar-mailbox-focused-open.png` shows one compact row with the Inbox icon and no Archived control; `.scratch/left-sidebar-mailbox-search-expanded.png` shows the full-row SearchField with no X or competing controls.
- The user's running OpenCorvus/Overlay process was not restarted, refreshed, closed, or used as the test target; verification used the isolated Node fixture.
- Native notification projection/transport regressions: 39 passed across projector, host transport, retired-notification-surface, and Mailbox panel suites. The new regression proves a default permission is checked, requested, granted, and followed by exactly one `notification.send` for a newly arrived ordinary status Mailbox item; initial history is not replayed.
- Tauri delivery ownership was verified in the production transport: `notification.send` invokes `@tauri-apps/plugin-notification` after its permission check. Because native desktop support exists, no right-side popup or secondary notification source was added.
- Follow-up Overlay TypeScript, production Vite build, and Node browser fixture passed. The expanded screenshot is captured from the unchanged viewport after moving the test pointer into the Search shell, so the test harness does not emit mouse-leave while capturing; the original-resolution image shows a full-row query field with no X and all resting controls absent.
- Required documentation health suites passed: 87 tests / 1,415 expectations. `git diff --check` passed.
- The repository pre-push panel-i18n checker identified the four retired Archived/view locale keys; both canonical locales were cleaned together and the checker passed on the subsequent push.
- Inbox total correction source suite: 11 tests / 177 expectations passed, including the canonical `counts().active` projection and compact Badge styling contract; Overlay TypeScript passed.
- The Node-launched browser fixture passed after proving the fixture's backend `activeCount: 10` renders as visible Inbox text `10`, its accessible label includes both Inbox and 10, the icon/count/Search controls remain on one centerline, and Archived remains absent.
- Original-resolution resting screenshot review shows the Inbox icon followed by `10` without increasing the single-row header height. The Browser-guided full-viewport expanded screenshot shows Search still owns the row with no X or competing controls; using the viewport capture prevents screenshot setup from moving the pointer outside the auto-collapsing header.
- `bun run build:overlay` completed successfully for version `0.0.0-v0.0.15beta-202607221553`, including i18n, Vite (2,644 modules), SDK, Overlay Server, and Tauri release application stages.
