# Mailbox Contextbar Attention Launcher

## Recall

### User requirement

- Move Mailbox to a clean independent icon immediately to the right of the
  workspace search action.
- Keep Mailbox collapsed by default. A newly arriving message should make the
  icon blink, and the existing Mailbox panel should expand only after the user
  clicks the icon.
- Choose an appropriate restrained icon and visually verify the result against
  the supplied desktop screenshot.

### Acceptance criteria

1. The workspace context bar renders Search followed by one independent
   Mailbox button; both use the shared `Button` and `Icon` primitives and the
   existing compact icon-action geometry.
2. The Mailbox button uses Lucide `Inbox`, already available through the
   installed `lucide-solid` package and the private Overlay icon registry.
3. The existing canonical Mailbox notification projection remains the sole
   message source. A newly presented Mailbox notification sets a transient
   context-bar attention presentation but does not open or select a Right Dock
   panel.
4. Clicking the Mailbox button clears that presentation and opens/selects the
   existing Mailbox Right Dock tab. If the Mailbox is already the visible Dock
   panel, a newly projected item does not create an unseen-attention signal.
5. The normal icon is quiet and neutral. Attention uses a restrained
   scale-aware opacity blink and accent colour; `prefers-reduced-motion:
   reduce` disables animation while retaining a static accent indication.
6. The rightmost Mailbox icon takes over the established project-row action
   axis. Search remains immediately to its left with the shared context-bar
   action gap.
7. Focused unit/source-contract tests, Overlay typecheck/build/i18n, historical
   document health, Node-started Playwright interaction, task-scoped screenshot
   inspection, keyboard activation and console/page/request diagnostics pass.
   This remains a desktop-only change.

### Hard constraints

- Reuse `MailboxPanel`, `projectMailboxNotifications`, the existing Right Dock,
  Solid signals, central `Button`, central `Icon`, Lucide, and design tokens.
  Do not create a second Mailbox store, unread-count copy, route, panel,
  notification centre, hand-authored SVG, local-storage state, or fallback.
- The visual attention signal is presentation state for newly presented
  messages, not a durable read/archive fact and not a replacement for the
  backend-owned Mailbox projection or host badge.
- Remove the current automatic Dock reveal. Do not retain automatic and
  click-owned reveal as two paths.
- Do not add responsive/tablet/mobile scope. Do not touch or restart a running
  OpenCorvus/Overlay; use the isolated Node browser fixture and headed browser.
- Work in the current worktree without reset, stash, history rewriting or a new
  worktree. Preserve unrelated changes. Commit subjects use `dsw-33987` and
  push to legacy remote.

### Sources read before implementation

- Root `AGENTS.md` rules and `specs/current/architecture/99-principles.md`.
- `2026-07-16-squad-mailbox-and-right-dock.md` for the canonical Mailbox/Dock
  ownership and its desktop visual acceptance.
- `2026-07-17-notification-ui-retirement.md` for the removal boundary around
  legacy Notification UI and the retained Mailbox presentation callback.
- `2026-07-17-workspace-search-project-plus-alignment.md` for the existing
  right-action optical axis in the workspace context bar.
- `App.tsx`, `main.tsx`, `MailboxPanel.tsx`, `RightDock.tsx`,
  `desktop-notifications.ts`, the central `Icon`/`Button` primitives,
  `titlebar.css`, Mailbox/titlebar tests, and the existing Node browser fixture.
- The official [Lucide Inbox icon](https://lucide.dev/icons/inbox), which
  documents the `Inbox` export for `lucide-solid`.
- User-supplied desktop screenshot
  `codex-clipboard-ff9f3318-e841-49f8-90b4-7b5d968bd085.png`.

### Whole-repository search evidence

Commands:

- `rg -n -S "mailbox|MailboxPanel|onNotification" packages/overlay/src packages/overlay/test`
- `rg -n -S "workspace-contextbar|workspace-command-search|work-ledger-search-toggle" packages/overlay/src packages/overlay/test`
- `rg -n -S "RIGHT_DOCK_CATALOG|openRightActivity|selectedCenterWorkbenchPanel" packages/overlay/src packages/overlay/test`
- `rg -n -S "lucide-solid|notifications:|Inbox|prefers-reduced-motion" packages/overlay/src packages/overlay/test`

Call-site disposition:

| Owner / call site | Current evidence | Decision |
| --- | --- | --- |
| `MailboxPanel.tsx` | Owns canonical hydration/live refresh and forwards `projectMailboxNotifications(... onNotification)` without a local message copy. | Preserve. Keep `onNotification` as the single presentation callback. |
| `desktop-notifications.ts` | Seeds initial message identities without replaying historical popups, then invokes `presentNotification` once per newly presented canonical item. | Preserve. Reuse the callback for context-bar attention instead of inventing another stream or count. |
| `main.tsx` | Mounts one force-mounted Mailbox panel and currently maps every presentation callback directly to `openRightActivity("mailbox")`. | Replace automatic reveal with one `mailboxAttention` signal; suppress attention when Mailbox is already visible and clear it on the explicit launcher click. |
| `App.tsx` | Owns the workspace context bar; Search is its sole trailing action. | Add a shared trailing action cluster containing Search then Mailbox and expose only attention plus click intent as props. |
| `RightDock.tsx` | Owns the canonical Mailbox tab/catalog and currently uses the generic Bell glyph. | Keep one Mailbox entry and switch it to the same semantic `mailbox`/Inbox icon. Do not remove Mailbox from the Dock catalog or create another panel. |
| `Icon.lucide.ts` | Private registry already owns all commodity Lucide glyphs; `lucide-solid` is installed. | Add the official `Inbox` export once as the `mailbox` icon name. |
| `titlebar.css` | Owns the 32-pixel context action geometry and current right-axis padding. | Generalize the shared button rule, add a compact action cluster, attention keyframes and reduced-motion override; keep the rightmost button on the existing axis. |
| Static Mailbox/titlebar/startup tests | Assert the old direct auto-open callback and single trailing Search action. | Replace those assertions with the explicit launcher/attention contract and shared geometry. |
| `titlebar-toolbar-toggle-browser.test.ts` | Already simulates a real Mailbox SSE change and asserts automatic Dock reveal. | Turn the same E2E path into proof that Dock stays closed, the icon animates, a screenshot is captured, and click/keyboard activation alone opens the Mailbox. |
| Mailbox backend/API/SDK/host badge | Canonical projection, read/archive state, native delivery and badge are already complete. | Preserve unchanged; no backend or generated-contract work is required. |

### Independent agent feedback

- No subagent was launched because the active collaboration boundary permits
  delegation only when the user explicitly requests it. Investigation,
  implementation and second review remain in the primary agent.

## Root-cause chain

Observed state: the workspace context bar shows only Search, while a new
Mailbox notification immediately expands and selects the Mailbox Right Dock.

Direct trigger: the sole `MailboxPanel` mount wires its canonical
`onNotification` callback to `openRightActivity("mailbox")`.

Deeper cause: delivery presentation and navigation intent are conflated. The
Mailbox projector correctly detects each newly presented canonical message,
but the only UI response available to that callback is an intrusive navigation
side effect.

Root repair: retain the canonical presentation callback while projecting it
into one transient context-bar attention signal. Make the new Inbox button the
only owner of navigation from this surface. This separates “new information is
available” from “the operator chose to inspect it” without duplicating Mailbox
data or read state.

## Implementation plan

1. Register the Lucide Inbox glyph as the semantic `mailbox` icon and use it in
   the existing Right Dock catalog.
2. Add Search + Mailbox as one context-bar action cluster in `App`, with
   localized labels and a reactive `data-attention` contract.
3. Replace Mailbox automatic reveal in `main.tsx` with a transient attention
   signal, a visible-panel suppression check, and one click-owned open path.
4. Add scale-aware neutral/attention styling, reduced-motion coverage and
   regression assertions for icon ordering, no automatic reveal, and one panel
   source.
5. Rewrite the existing real SSE browser scenario to prove the Dock remains
   closed, inspect blink styles and geometry, capture the task-scoped context
   bar, activate the button, inspect the expanded Mailbox, and retain keyboard
   and diagnostic checks.
6. Run focused tests, Overlay typecheck/build/i18n, historical document checks
   and `git diff --check`; inspect screenshots and iterate. Re-read this Recall,
   perform a second code/visual review, record evidence, commit and push.

## Progress

- [x] Existing implementation, historical decisions, call sites, icon library,
  fixture and user screenshot investigated.
- [x] Plan committed and pushed.
- [x] Implementation and regression tests complete.
- [x] Real visual acceptance and second review complete.
- [x] Final commit and legacy remote push complete.

## Verification evidence

- Plan commit `d3d0b19a0` (`dsw-33987 plan Mailbox contextbar attention
  launcher`) was pushed to `legacy-remote/work-v0.0.9beta-yr-0718` before the code
  change.
- `App.tsx` now renders one shared trailing action cluster in Search-then-
  Mailbox order. Both actions use the existing 32-pixel `Button` contract; the
  new launcher uses the central `mailbox` icon registry entry backed by Lucide
  `Inbox`.
- `main.tsx` replaces the previous automatic `openRightActivity("mailbox")`
  presentation callback with one transient attention signal. It suppresses
  attention while the Mailbox is already visible and clears attention when
  Mailbox is explicitly opened or the active directory changes. The existing
  force-mounted `MailboxPanel` remains the sole projection owner.
- The focused source-contract suite passed with 28 tests and 267 expectations,
  covering launcher ordering, one Mailbox surface, no automatic Dock reveal,
  attention lifecycle, semantic icon registration, geometry, motion and
  reduced-motion behavior.
- Overlay TypeScript checking passed with no diagnostics. The production Vite
  build transformed 2,497 modules successfully; the only output was the
  existing chunk-size advisory. Overlay localization validation passed at
  revision `8086d1b8b04d6219`.
- Historical/document-health/product-document single-source tests passed with
  84 tests and 1,333 expectations. `git diff --check` passed.
- The Node-started headed browser test passed both scenarios. Its controlled
  Server-Sent Events (SSE) mailbox change proved the Right Dock stayed closed,
  the launcher reached `data-attention="true"`, the exact theme accent, the
  named 1.6-second double-blink animation, and the canonical hidden Mailbox
  projection. Under reduced motion the animation was `none` while the static
  accent remained. Click and Enter alone opened and selected Mailbox, cleared
  attention, and preserved focus behavior.
- Browser geometry measured Search before Mailbox, a 2-pixel action gap,
  32-by-32-pixel controls, 14-by-14-pixel glyphs, and the rightmost Mailbox
  center on the project plus-action axis. Console, page-error, failed-request
  and response diagnostics remained clean.
- Task-scoped screenshots were captured and personally inspected:
  `.scratch/workspace-mailbox-attention-launcher.png`,
  `.scratch/right-dock-mailbox-click-open.png`, and
  `.scratch/workspace-search-mailbox-project-plus-alignment.png`. The launcher
  is visually quiet at rest, clearly accented for attention, cleanly spaced
  beside Search, and the existing Mailbox panel remains unchanged apart from
  the semantic Inbox tab glyph.
- Second review caught and corrected the attention selector's interaction with
  the shared icon-action primitive. Exact browser color verification also
  waits for the primitive's intentional 80-millisecond color transition before
  sampling the settled theme accent, avoiding a first-frame false result.
- Implementation commit `789d477da` (`dsw-33987 add Mailbox contextbar
  attention launcher`) was pushed to
  `legacy-remote/work-v0.0.9beta-yr-0718`. The legacy remote pre-push hook passed all 10
  typecheck tasks plus Software Development Kit (SDK) imports, artificial
  intelligence runtime, application programming interface route inventory,
  documentation rendering, Overlay localization and secret scanning.
