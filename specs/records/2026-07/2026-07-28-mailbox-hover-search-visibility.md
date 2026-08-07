# Mailbox hover search visibility repair

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User request | After the pointer hovers the upper-left Mailbox launcher and opens the Mailbox preview, the adjacent Work Ledger search button must be hidden. |
| Supplied evidence | `codex-clipboard-45b3d206-70f6-421b-87b4-d13816a1f7ec.png` was inspected at original resolution. It shows the Search and Mailbox launchers remaining visible together while Mailbox is hovered. |
| Acceptance criteria | The Search launcher remains visible in the normal Work Ledger view; after the existing delayed Mailbox hover preview becomes visible, Search is hidden from layout, pointer interaction, keyboard focus, and the accessibility tree; leaving the complete left activity region restores both Work Ledger and Search. The right-anchored Mailbox launcher keeps the same rendered position across the transition so hiding Search cannot cancel the hover preview. A real desktop page verifies the interaction and task-scoped screenshots are inspected. |
| Hard constraints | Reuse `mailboxVisible()` as the only preview visibility source, the native `hidden` contract, the existing Button primitives, and the existing Node-launched Playwright fixture. Do not add CSS opacity masking, a second hover signal, a route, fallback, feature gate, iframe, query override, or responsive scope. Do not restart, refresh, terminate, or reuse the user's running OpenCorvus/Overlay process. |
| Sources read | Root `AGENTS.md`; Browser control skill; supplied screenshot; `specs/current/architecture/07-panel.md`, `07-panel-reactivity.md`, and `99-principles.md`; `2026-07-25-conversation-environment-mailbox-hover-repair.md`; `2026-07-25-mailbox-notification-count-and-hover-lifecycle.md`; `2026-07-27-mailbox-hover-region-lifecycle.md`; current `App.tsx`, titlebar styles, and focused source/browser tests. |
| Whole-repository grep | `App.tsx` is the only producer of `work-ledger-search-toggle`, `mailbox-toggle`, and `mailboxHoverPreview`. `TitlebarMenubar.tsx` is the only production caller that forwards the menu Search action to the Search launcher. `mailbox-contextbar-launcher.test.ts`, `titlebar-brand.test.ts`, `overlay-startup-chrome-parity.test.ts`, and `overlay-left-rail-density.test.ts` assert static launcher ownership/order/geometry. `command-palette.test.ts` covers ordinary Search activation and focus restoration. `titlebar-toolbar-toggle-browser.test.ts` and `mailbox-left-sidebar-browser.test.ts` explicitly assert that Search remains visible during Mailbox hover and are the interaction contracts to replace. Other Mailbox browser fixtures hover the launcher but do not inspect Search visibility. |
| Independent agent feedback | None. The user did not request sub-agents, so the primary agent owns implementation and second review. |
| Git baseline | The clean `work-v0.0.23beta-yr-0728` branch was fast-forwarded from `myhexin/v0.0.23beta` and pushed to `myhexin/work-v0.0.23beta-yr-0728` at `b0754fdc0c` before task changes. |

## Causal chain

1. `App.tsx` already derives the visible left activity from the single local
   `mailboxHoverPreview` signal through `mailboxVisible()`.
2. The Search Button is rendered unconditionally and therefore ignores that
   canonical visibility projection.
3. Two real browser fixtures preserve the previous requirement that Search
   remain mounted during transient preview, so the defect is both implemented
   and encoded as an acceptance contract.
4. The earlier geometry concern does not justify a second state or an opacity
   mask. Mailbox is the rightmost child of an end-aligned action cluster, so
   hiding its preceding Search sibling should leave the Mailbox launcher's
   right-anchored bounds unchanged; the real browser test must prove that
   geometry instead of assuming it.

## Call-site disposition

| Owner / consumer | Decision |
| --- | --- |
| `packages/overlay/src/components/App.tsx` | Bind the Search Button's native `hidden` property directly to `mailboxVisible()`. Preserve ordinary Search click behavior and the existing Mailbox hover lifecycle. |
| `packages/overlay/src/styles/surfaces/titlebar.css` | Preserve the end-aligned action cluster and existing Button geometry; no masking or visibility-specific CSS is required. |
| `packages/overlay/src/components/titlebar/TitlebarMenubar.tsx` | Preserve the canonical Search forwarding action. When the transient Mailbox preview closes, it continues to target the same one Search launcher. |
| `packages/overlay/test/mailbox-contextbar-launcher.test.ts` | Replace the stale always-visible assertion with a source contract that Search visibility is derived from the existing Mailbox preview signal. |
| `packages/overlay/test/browser/titlebar-toolbar-toggle-browser.test.ts` | Replace the stale `hidden === false` hover assertion with `hidden === true`, verify computed `display: none`, and retain attention/count/preview coverage. |
| `packages/overlay/test/browser/mailbox-left-sidebar-browser.test.ts` | Assert Search is visible before hover, hidden during the real Mailbox preview, restored after shell leave, absent from sequential keyboard focus while hidden, and that the Mailbox launcher's bounds remain unchanged. Update compact Mailbox layout expectations. |
| Other Search/Mailbox source and browser tests | Preserve. They cover ordinary Search activation, titlebar ownership/order, action geometry at rest, or Mailbox behavior unrelated to Search visibility. |

## Implementation plan

1. Change the focused source and real browser assertions to the requested
   visibility contract and observe the old implementation fail.
2. Bind Search `hidden` to the existing `mailboxVisible()` projection.
3. Run focused source tests, the Node-launched real Mailbox browser fixture,
   Overlay typecheck/build, documentation health, and diff hygiene.
4. Inspect the task-scoped hover-open and restored screenshots at original
   resolution; correct any geometry or interaction regression.
5. Re-grep owners, second-review the exact diff, update this record with
   evidence, commit with the `dsw-33987` prefix, converge with git-cc, and push.

## Progress

- [x] Recall, causal chain, and full call-site inventory recorded.
- [x] Failing regressions observed.
- [x] Implementation complete.
- [x] Real browser and screenshot acceptance complete.
- [ ] Second review, commit, convergence, and git-cc push complete.

## Result

The Work Ledger Search Button now binds its native `hidden` property directly
to the existing `mailboxVisible()` projection. The button therefore leaves
layout, pointer hit-testing, sequential keyboard focus, and the accessibility
tree only while the Mailbox hover preview is visible. Leaving the complete left
activity shell restores Work Ledger and the same Search launcher.

No CSS visibility rule, opacity mask, extra signal, route, or compatibility path
was added. The end-aligned action cluster keeps Mailbox as its rightmost child,
and the real browser geometry assertion proves the launcher's left edge, right
edge, and width are identical before and after Search is hidden.

## Verification evidence

- The new source regression failed against the old implementation because the
  Search Button had no `hidden={mailboxVisible()}` binding, then passed after
  the production change.
- `bun test packages/overlay/test/mailbox-contextbar-launcher.test.ts` passes
  all three focused launcher/attention/icon tests.
- `bun run --cwd packages/overlay typecheck` and
  `bun run --cwd packages/overlay build:vite` pass.
- The Node-launched real browser fixture
  `mailbox-left-sidebar-browser.test.ts` passes. It verifies Search visible at
  rest, native hidden plus computed `display: none` during hover preview,
  sequential keyboard traversal skipping Search, exact Mailbox launcher
  geometry stability, restoration after shell leave, and the compact Mailbox
  view with Search still hidden.
- The browser fixture's initial stale build was identified by inspecting the
  compiled asset, explicitly rebuilt, and rerun. A later cleanup-only failure
  exposed the fixture's missing canonical `/chat/capability` response; the
  fixture now uses the same strict response contract as the other Overlay
  browser fixtures and the unchanged original checker passes.
- `.scratch/left-sidebar-mailbox-hover-preview.png` and
  `.scratch/left-sidebar-mailbox-hover-restored.png` were inspected at original
  resolution directly and through the in-app Browser. The hover-open context
  bar contains only the right-anchored Mailbox launcher; the Mailbox panel's own
  message-search action remains visible. The restored Work Ledger view contains
  both the global Search and Mailbox launchers.

## Codex second review

The first keyboard regression correctly proved that `Shift+Tab` skipped the
hidden Search button, but also opened the preceding titlebar menu and blocked a
later pointer action. The test now closes that legitimate menu with `Escape`
before continuing, retaining the real sequential-focus proof. The second review
also confirmed that the only production diff is the native visibility binding,
the previous Search action and command-palette focus contract remain unchanged,
and no visibility-specific CSS or second Mailbox state was introduced.
