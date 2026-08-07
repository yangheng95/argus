# Work Ledger Pin And Automatic Right Dock Reveal

## Recall

| Item | Detail |
| --- | --- |
| User requirement | `pin` still does not work; a new Mailbox message does not produce its popup, the Right Dock does not expand, and Browser or the corresponding right-side component does not open automatically when its backend evidence becomes ready. |
| Acceptance criteria | Project and Mission/Chat pin requests use the backend JSON contract and the refreshed canonical Work Ledger projection exposes the new pin state. A newly arriving unread active Mailbox notification/attention item keeps the existing host popup delivery and also opens/selects the canonical Mailbox tab in the existing Right Dock exactly once. A ready task-scoped Browser Preview target can be discovered while the Dock is closed, opens/selects Browser, and only then mounts the native preview surface. Existing historical Mailbox items do not interrupt startup; status/progress-only, read, and archived rows retain the existing non-notification policy. Focused contract, unit, type, build, Node-started browser interaction, screenshot, console, document-health, second-review, commit, and legacy remote push checks pass. |
| Hard constraints | Keep `protocol_event` plus the backend Mailbox presentation fields as the only durable notification source, `centerWorkbenchPanels` as the only Right Dock tab/selection source, and the task-scoped backend Browser Preview target/evidence as the only preview source. Do not add a toast history, local-storage copy, temporary iframe, local query/signal target override, second Dock, compatibility fallback, gate, state machine, mobile/tablet scope, new worktree, or process restart/refresh. Use the existing Solid/Kobalte/RightDock/HostTransport owners and Node for Playwright. Preserve unrelated work, use `dsw-33987` commit subjects, and push only to `legacy-remote`. |
| Sources read | Root `AGENTS.md`; Browser control skill; `specs/current/architecture/07-panel.md`, `07-panel-reactivity.md`, and `99-principles.md`; the 2026-07-12/13/17 Work Ledger pin records; `2026-07-16-squad-mailbox-and-right-dock.md`; `2026-07-17-cross-platform-mailbox-notification-repair.md`; `2026-07-14-right-dock-panel-ownership-and-browser-draft.md`; current Work Ledger service/component/routes, Mailbox service/panel/projector, Right Dock state/component, Browser Preview panel/service, host transports, and focused source/browser tests. |
| Whole-repository search evidence | `setWorkLedgerPinned` and `setWorkLedgerProjectPinned` are the only Overlay pin writers and both omit the JSON content type; `api.ts::bodyFromInit` therefore encodes both bodies as text, while Tauri/browser/Visual Studio Code transports send text as `text/plain` and the Hono routes require `validator("json", WorkLedgerPinInput)`. Backend route tests construct JSON directly and the browser fixture calls `req.json()` without asserting the request content type, so both miss the production mismatch. `MailboxPanel` is the sole Mailbox hydrator/change-stream consumer and calls the sole `MailboxNotificationProjector`; that projector owns new-item/badge/host-popup delivery but has no UI presentation callback. `centerWorkbenchPanels`, `openCenterWorkbenchPanel`, and `setRightToolbarVisible` are the sole Dock tab, selection, and visibility owners. `BrowserPreviewPanel` is the only right-side component with an `onReady` auto-open contract; its target resource currently requires `props.active()`, while `props.active()` requires the Dock and Browser tab already to be open/selected, making `onReady` unreachable from the closed state. No other right-side component declares a backend-ready auto-open callback. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration boundary forbids unrequested delegation. |
| Git baseline | Clean `work-v0.0.9beta-yr-0718` at `201907f89`, equal to `legacy-remote/work-v0.0.9beta-yr-0718` after fetch. |

## Evidence And Causal Chain

1. **Pin observable:** the action is clickable but the persisted row does not change.
   **Direct trigger:** the two writers serialize JSON without declaring JSON, so
   `bodyFromInit` deliberately produces a text transport body and the server's
   JSON validator rejects it. **Why prior tests missed it:** route tests bypass
   the Overlay transport and the browser fixture parses text as JSON without
   verifying the protocol content type.
2. **Mailbox observable:** the canonical list may refresh, but neither the Dock
   nor its Mailbox tab is revealed. **Direct trigger:** the sole new-item
   projector ends at badge/native-popup delivery and cannot call the canonical
   Dock owner. The repair must extend that existing delivery projection rather
   than create a second event listener or notification store.
3. **Browser observable:** a persisted ready target does not open Browser from a
   closed Dock. **Direct trigger:** target discovery is conditioned on panel
   activation, while activation is conditioned on discovery's `onReady` callback.
   Split background target discovery from active native-surface mounting; do not
   create another preview target or load path.

## Call-Site Disposition

| Surface | Decision |
| --- | --- |
| `services/work-ledger.ts` | Add the required JSON content type to both canonical pin writers. Keep paths and backend identity unchanged. |
| Work Ledger service/browser tests and backend route tests | Add a transport-body regression that proves both pin bodies are JSON and preserve route tests; update the real browser pin path to assert the request content type and refreshed pin/reorder behavior. |
| `MailboxNotificationProjector` / `projectMailboxNotifications` | Keep backend eligibility, first-snapshot baseline, badge, retry, permission, and host delivery semantics. Add one arrival-presentation callback owned by the same serialized projector and record UI presentation separately from host delivery so a denied/deferred host popup can retry without repeatedly reopening the Dock. |
| `MailboxPanel` | Receive one `onNotification` callback and pass it to the canonical projector after committed refreshes. Keep one `/mailbox` page source and one `/mailbox/events` change trigger. |
| `main.tsx` Dock owners | Route the Mailbox presentation callback through `openRightActivity("mailbox")`; do not mutate DOM or add a second tab state. |
| `BrowserPreviewPanel` | Allow the existing target resource to discover the canonical target whenever task/directory scope exists. Keep evidence loading and native WebView lifecycle active-only. Fire `onReady` once per ready target, which opens Browser through the existing Dock owner. |
| Right Dock/Browser/Mailbox browser fixtures | Prove closed-Dock notification arrival opens Mailbox and produces the host send command; prove closed-Dock ready Browser target opens Browser and renders its panel; capture task-scoped desktop screenshots and check console errors. |
| Other right-side panels | Keep unchanged. They have explicit user/tool launchers but no backend-ready callback contract; inventing automatic behavior would expand scope and create a second trigger source. |

## Implementation And Verification Plan

1. Commit and push this Recall/index update before implementation.
2. Add failing pin transport, Mailbox presentation/deduplication, and closed-Dock
   Browser discovery regressions.
3. Repair the three canonical owners without changing backend schemas or adding
   another UI/event source.
4. Run focused Overlay/backend/transport tests, typecheck, i18n, and production
   build. Run the relevant real browser fixtures serially through Node.
5. Inspect pin, Mailbox-open, and Browser-open screenshots at original
   resolution; fix any focus, selection, clipping, or layout issue and rerun.
6. Run document health, exact call-site/diff review, fetch the latest legacy remote
   branch, rerun affected checks after any merge, commit, and push through hooks.

## Progress

- [x] Read governing rules, current architecture, historical decisions, current
  implementation, transports, and focused tests.
- [x] Enumerate pin, Mailbox delivery, Dock ownership, and Browser auto-open call
  sites and prove the three direct triggers.
- [x] Commit and push the Recall/index checkpoint (`71e1a119e`).
- [x] Add regressions and implement the repairs.
- [x] Complete real desktop browser/screenshot acceptance and second review.
- [x] Commit and push the verified implementation.

## Result And Verification

- Both pin writers now preserve the existing route and payload while declaring
  `application/json`. The service regression proves HostTransport receives a
  JSON body, and the real Work Ledger browser fixture proves the emitted PATCH
  request has the JSON content type before the row becomes pinned and reorders.
- The serialized Mailbox projector now owns both presentation deduplication and
  native-delivery retry bookkeeping. The initial page remains silent; one new
  eligible item reveals/selects Mailbox once; denied or deferred native delivery
  can retry without presenting the Dock again.
- Browser target discovery now follows task/directory scope while closed. Only a
  new ready target after the first scope snapshot reveals/selects Browser;
  evidence hydration and native WebView mounting remain active-only.
- `bun test packages/overlay/test/work-ledger-service.test.ts packages/overlay/test/agent-mailbox-notification-projection.test.ts packages/overlay/test/mailbox-panel.test.ts packages/overlay/test/browser-preview-panel.test.ts packages/opencorvus/test/server/work-ledger-routes.test.ts` passed 43 tests.
- `bun run --cwd packages/overlay typecheck` passed.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/project-ledger-group-browser.test.ts` passed with the pin content-type assertion and produced `.scratch/work-ledger-pin-click-result.png`.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/titlebar-toolbar-toggle-browser.test.ts` passed both real desktop tests and produced `.scratch/right-dock-browser-auto-open-ready-target.png` plus `.scratch/right-dock-mailbox-auto-open-notification.png`.
- All three screenshots were inspected at original resolution. Pin is visibly
  active and reordered; Browser and Mailbox each occupy the selected open Dock
  without clipping or focus/layout regressions.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts` passed 80 tests.
- The verification used isolated browser fixtures and did not restart, refresh,
  close, or otherwise interfere with the user's running OpenCorvus/overlay.
