# Center Workbench Panel Min Size Contract

Date: 2026-06-22
Status: Superseded 2026-06-23 by `2026-06-23-overlay-panel-legal-size-contract.md`

## Supersession Note

This note records the historical repair that first made `1120px` an exclusive
compact breakpoint. That intermediate breakpoint decision is no longer the
current contract. The 2026-06-23 legal shell cleanup removed production
`@media (width < 1120px)` and `@container overlay-shell (width < 1120px)`
branches entirely because `body` is already constrained to the legal
`1120x720` shell. Current runtime code must follow the 2026-06-23 contract:
legal shell compact branches stay absent, and open center workbench panels keep
their token-owned minimum width inside the legal shell.

## Acronyms

- CSS: Cascading Style Sheets, the browser styling and layout language.
- GUI: Graphical User Interface, the visible overlay surface.
- RAF: Request Animation Frame, the browser callback used to run visual work once per frame.
- UI: User Interface, visible controls and layout surfaces.

## Task Definition

Prevent center workbench peer panels from entering illegal widths when multiple
toolbar panels are open. Open panels must keep the token-owned minimum width and
the workbench body must scroll horizontally when the available inline space is
not enough.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback logic, no duplicate source, no blind patching, test every code change, visually verify UI changes, and commit/push each round. |
| `2026-06-22-overlay-viewport-size-contract.md` | The native overlay minimum is `1120x720`; center workbench panel minimum width is owned by `--ui-workbench-panel-min-width`. |
| `2026-06-22-overlay-resize-frame-coalescing.md` | Resize work is frame-coalesced through the shared RAF scheduler; do not add debounce or gate paths. |
| `2026-06-22-center-workbench-open-layout-frame.md` | Panel open writes DOM state immediately and schedules layout reads to RAF. |
| `2026-06-22-center-workbench-deferred-reveal-single-layout-owner.md` | Center workbench layout and reveal share one RAF owner; `centerWorkbenchPanelWeights` remains the only persisted width source. |
| Live `7878` evidence | With workflow, screenshots, and inspector open, the screenshots panel measured about `244px`, below the `280px` token, and the visual screenshot showed clipped panel content. |
| Popper read-only audit | Screenshot panel rendering is virtualized and lazy; remaining toolbar-open jank candidates are layout/reveal geometry and asset/source mismatch, not a second screenshot panel implementation. |
| Harvey read-only audit | `1120px` was both the native minimum width and an inclusive compact breakpoint, so the smallest legal native size entered compact layout. |

## Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| Minimum token | `design-language.css` defines `--ui-workbench-panel-min-width: calc(280px * var(--ui-scale))`. | Keep this as the only center panel minimum width source. |
| Resize math | `main.tsx` resolves `--ui-workbench-panel-min-width` in `centerWorkbenchPanelMinWidth()`. | Keep; this owns drag and keyboard separator constraints. |
| Base center body layout | `workspace.css` `.center-workbench-body` uses `overflow: hidden`. | Change base overflow to horizontal scroll and hidden vertical overflow so illegal compression is not the release valve. |
| Base open panel layout | `workspace.css` `.center-workbench-view` uses `min-width: 0`; only compact mode sets a token-based flex basis. | Add a base open-panel minimum width using the same token. |
| Compact workbench mode | `workspace.css` and `activity.css` used inclusive `@media (max-width: 1120px)` while native minimum width is `1120px`. | Historical intermediate step: make the compact breakpoint exclusive. Superseded by the 2026-06-23 legal shell cleanup, which removed these production branches. |
| Static tests | `workspace-surface-consistency.test.ts` currently only asserts compact open-panel scrolling. | Add assertions for the base desktop min-size contract. |
| Browser tests | `center-workbench-separator-browser.test.ts` covers two panels and resize screenshots, not three simultaneous peer panels. | Add a three-panel browser check that every open panel is at least the token width and capture a visual screenshot. |

## Root Cause

The previous size-contract round routed drag and compact-mode panel sizing
through `--ui-workbench-panel-min-width`, but the desktop natural flex layout
still allowed `.center-workbench-view` to shrink to `0`. With workflow,
screenshots, and inspector open at the same time, the flex algorithm compressed
the screenshots panel below the token before any separator resize logic was
involved. That left two effective size contracts: token-owned resize math and
unbounded natural layout.

The same size contract had a second boundary defect: `1120px` was both the
native minimum width and an inclusive compact breakpoint. That meant a legal
minimum `1120x720` native overlay entered the component-compact layout, causing a
large one-pixel layout flip between `1120px` and `1121px`.

## Fix Plan

1. Set base `.center-workbench-body` to horizontal scrolling with hidden
   vertical overflow.
2. Set base `.center-workbench-view[data-open="true"]` minimum width to
   `var(--ui-workbench-panel-min-width)`.
3. Keep `centerWorkbenchPanelWeights` as the only persisted width source and do
   not add panel-specific pixel state.
4. Extend static CSS tests for the base contract.
5. Historical intermediate step: change the compact workspace and right
   toolbar breakpoint to exclusive width syntax. Superseded by the 2026-06-23
   legal shell cleanup, which removes the production compact legal-shell
   branches instead.
6. Extend the browser separator test with a three-panel open layout assertion
   and screenshot.
7. Extend the browser titlebar test so `1120px` remains desktop row layout and
   `700px` remains compact component coverage.
8. Rerun focused unit/static tests, overlay typecheck, the browser visual test,
   and then self-review before commit/push.

## Acceptance

- No open center workbench panel can render below
  `--ui-workbench-panel-min-width` in desktop peer-panel layout.
- When multiple panels need more inline space than available, the workbench
  body scrolls horizontally instead of crushing panel content.
- `1120x720` stays in desktop layout. Current superseding contract removes the
  production compact legal-shell branches instead of applying them below the
  native legal minimum.
- Existing separator drag, keyboard resize, and RAF scheduling semantics remain
  unchanged.
- No alternate panel state, duplicate width source, hidden fallback layout, or
  special-case toolbar path is introduced.
- Focused tests and visual QA pass.

## Verification

- PASS: `bun test packages/overlay/test/workspace-surface-consistency.test.ts packages/overlay/test/overlay-window-size-contract.test.ts packages/overlay/test/overlay-architecture-guards.test.ts --timeout 30000`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/titlebar-menubar.test.ts packages/overlay/test/browser/center-workbench-separator-browser.test.ts`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/center-workbench-separator-browser.test.ts`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/screenshot-browser-panel-browser.test.ts`.
- Visual QA reviewed:
  `.scratch/overlay-minimum-1120-full.png`,
  `.scratch/center-workbench-three-panel-min-width.png`,
  `.scratch/screenshot-browser-panel-browser.png`, and
  `.scratch/screenshot-browser-panel-browser-narrow-panel.png`.

## Self Review

- Rechecked the runtime compact breakpoint call points in this historical
  round; at that point only `workspace.css` and `activity.css` used the
  `1120px` workbench breakpoint, and both were changed to exclusive
  `@media (width < 1120px)`. Superseding 2026-06-23 cleanup later deleted
  those production branches.
- Rechecked the open panel width source; CSS, separator math, and screenshot
  browser tests all resolve the same `--ui-workbench-panel-min-width` token.
- Rechecked the resize probe after the browser failure; the corrected assertion
  still forbids synchronous center workbench geometry reads and accepts the
  lighter no-read resize path.
- Rechecked narrow screenshot component coverage; below native legal width,
  page overflow is bounded by `--ui-overlay-min-width`, while screenshot cards
  and thumbnails remain inside their panel.
