# Right Dock Launcher Normal Font Weight

## Recall

| Item | Detail |
| --- | --- |
| User requirement | “字体不用加粗。” The supplied desktop screenshot identifies the nine labels in the empty Right Dock tool launcher. |
| Acceptance criteria | Every empty-launcher label computes to the canonical body font weight (400), while its font size, icon geometry, centered group, shared left columns, row order, hover/focus behavior, and click behavior remain unchanged. A task-scoped desktop screenshot is opened and visually reviewed after the change. |
| Hard constraints | Keep the shared Button primitive and the existing Right Dock catalog; do not weaken all Button typography, add another component/variant, introduce a fallback, touch mobile/tablet behavior, create a worktree, or restart/refresh the user's running OpenCorvus/Overlay. Playwright is launched by Node in an isolated fixture. |
| Sources read | `AGENTS.md`; Browser control skill; `specs/current/architecture/99-principles.md`; `2026-07-14-right-dock-panel-ownership-and-browser-draft.md`; `2026-07-16-review-changes-and-empty-dock-alignment.md`; `2026-07-16-squad-mailbox-and-right-dock.md`; `2026-07-17-overlay-primitive-system-convergence.md`; current Right Dock, Button primitive, workspace style, and focused/browser tests. |
| Whole-repository grep | `RIGHT_DOCK_CATALOG` and the empty launcher render only in `RightDock.tsx`; `.right-dock-empty__item` styling exists only in `workspace.css`; Button's shared `.oc-button` rule supplies strong weight; focused assertions live in `right-dock-panel-ownership.test.ts`; computed geometry is measured in `review-changes-empty-dock-browser.test.ts` and `titlebar-toolbar-toggle-browser.test.ts`; the dedicated screenshot is written only by `review-changes-empty-dock-browser.test.ts`. |
| Independent agent feedback | None. The user did not request sub-agents, and the current collaboration policy forbids unrequested delegation. |

## Root Cause

The launcher correctly reuses the canonical Button primitive, but the primitive
assigns the strong font-weight token to every button. That emphasis is suitable
for action buttons and wrong for a persistent navigation/catalog list, so all
nine labels render at 600. The Right Dock item boundary already owns this
catalog's left alignment; it is also the narrow semantic boundary at which the
list can consume the canonical body-weight token without changing unrelated
buttons or creating a second component.

## Call-Site Disposition

| Owner / call site | Decision |
| --- | --- |
| `components/RightDock.tsx` | Preserve the one catalog, Button composition, label DOM, order, icons, and behavior. |
| `styles/primitives/button.css` | Preserve the shared strong default for actual action buttons. |
| `styles/surfaces/workspace.css` | Extend the existing `.right-dock-empty__item.oc-button` semantic boundary to consume `--ui-font-weight-body`. |
| `test/right-dock-panel-ownership.test.ts` | Assert the source-level body-weight ownership beside the existing alignment contract. |
| `test/browser/review-changes-empty-dock-browser.test.ts` | Measure every launcher's computed weight against the root body-weight token, retain the existing geometry assertions, and capture the scoped Dock screenshot. |
| `test/browser/titlebar-toolbar-toggle-browser.test.ts` | Preserve its broader geometry coverage; no duplicate font-weight assertion is needed because the dedicated fixture owns this regression. |

## Implementation And Verification Plan

1. Add the canonical body-weight token to the existing empty-launcher Button rule and add focused source/computed-style regressions.
2. Run the focused ownership test, Overlay TypeScript check, and the dedicated Node browser test, then open its current-goal screenshot and correct any visual mismatch.
3. Run documentation-health checks required for this new record, review the complete diff a second time, update this record with evidence, commit with the required prefix, and push the current branch to `myhexin`.

## Progress

- [x] Read governing decisions and enumerate every current launcher/style/test call site.
- [x] Implement the semantic font-weight correction and regressions.
- [x] Run focused, visual, and documentation verification.
- [x] Inspect the screenshot and complete second review.
- [x] Commit and push the verified delivery.

## Verification Result

- The existing `.right-dock-empty__item.oc-button` semantic boundary now
  consumes `--ui-font-weight-body`; the canonical Button primitive retains its
  strong default for action controls, and no new component, variant, token, or
  fallback was introduced.
- The dedicated Node browser fixture proves all nine label `font-weight`
  computed values equal the root body-weight token. Its existing assertions
  also prove the catalog remains centered within one pixel, with matching icon
  and label left axes and left-aligned label text.
- The first browser run reached and rendered the target but exposed a stale
  fixture contract: the post-Mailbox Overlay requested `/mailbox` and
  `/mailbox/events`, which the older Review fixture answered with 404. The
  fixture now reuses the existing `emptyMailboxResponse` and
  `mailboxEventStreamResponse` helpers; the unchanged original test then
  passed without ignoring console or response failures.
- Focused Right Dock and font-token tests plus historical/document-health
  checks passed: 82 tests, 1,324 expectations, zero failures. Overlay
  TypeScript passed, the production Vite build passed with 2,492 modules, the
  Node browser scenario passed, and `git diff --check` is clean.

## Visual Review

- Opened and inspected
  `.scratch/right-dock-empty-tools-left-aligned.png` at its original
  resolution. The Terminal, Browser, Review, Files, Screenshots, Requirements,
  Architecture, Goals, and Mailbox labels visibly use regular weight; glyphs
  and text share stable columns, the list remains centered, and the Dock header
  controls are unchanged.
- No visual correction beyond the requested weight change was necessary.

## Second Review

- The root cause is resolved at the narrow catalog semantic boundary rather
  than by weakening every Button or styling nine labels individually.
- `RIGHT_DOCK_CATALOG`, label rendering, order, icons, events, focus behavior,
  hover behavior, and panel selection are unchanged.
- Source and browser regressions cover both token ownership and actual rendered
  weight. The Mailbox fixture update only brings the isolated test target to
  the current shared startup contract.
- Concurrent left-rail scrollbar/workspace-shadow changes remain outside this
  task's staged file set.

## Delivery Result

- Implementation commit `5ed6e1faa` (`dsw-33987 use regular right dock
  launcher labels`) is present on
  `myhexin/work-v0.0.8beta-yr-0717`.
- The git-cc pre-push hook passed the SDK import check, AI runtime check,
  repository typechecks, route inventory, generated API documentation,
  Overlay i18n check, and tracked-source secret scan without bypasses.
