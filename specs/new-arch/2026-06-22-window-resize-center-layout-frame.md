# Window Resize Center Layout Frame

Date: 2026-06-22
Status: Implemented

## Acronyms

- GUI: Graphical User Interface, the browser-rendered overlay surface.
- UI: User Interface, visible controls and layout surfaces.
- RAF: Request Animation Frame, the browser callback used to run visual work once per frame.
- DOM: Document Object Model, the browser element tree.

## Task Definition

Continue the overlay resize performance audit by removing the center workbench
geometry read from the same RAF callback that applies window resize zoom and
pane layout writes.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback, no duplicate layout source, test every change, visually verify UI work, and commit/push every round. |
| `2026-06-22-overlay-resize-frame-coalescing.md` | Window resize work is already coalesced through `createAnimationFrameScheduler`; keep one resize listener path. |
| `2026-06-22-center-workbench-open-layout-frame.md` | Center workbench panel weights and separator geometry are rendered by one layout helper. |
| `2026-06-22-center-workbench-deferred-reveal-single-layout-owner.md` | `renderCenterWorkbenchPanelLayoutOnFrame` is the single RAF owner for center workbench layout and reveal. |
| `2026-06-17-left-pane-resizer-accessibility.md` | `renderPaneLayout()` remains the pane service's single width and separator semantics renderer; do not add pane ARIA writers in `main.tsx`. |

## Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| Window resize event | `main.tsx` has the only `window.addEventListener("resize", applyWindowResizeOnFrame.schedule)` and `visualViewport.resize` path. | Keep the existing event path and scheduler. |
| Window resize callback | `applyWindowResize()` calls `applyZoom`, `renderPaneLayout`, and directly calls `renderCenterWorkbenchPanelSeparators()`. | Replace the direct center separator render with the existing center layout RAF owner. |
| Center workbench geometry | `renderCenterWorkbenchPanelSeparators()` reads `getBoundingClientRect()` through `centerWorkbenchPanelResizeMetrics()`. | Keep the same geometry code, but run it outside the resize write callback. |
| Pane service | `renderPaneLayout()` owns pane CSS variables and pane separator ARIA semantics. | Leave pane internals unchanged in this round; record them for a separate audit if resize jank remains. |
| Tests | `resize-observer-frame-scheduler.test.ts` guards scheduler ownership; `center-workbench-separator-browser.test.ts` opens the real overlay and resizes the viewport. | Extend both to prove center geometry is not read in the resize write callback. |

## Root Cause

The previous resize fix moved the browser resize event into RAF, but the RAF
callback still mixed window resize writes with center workbench geometry reads.
`applyZoom()` writes `--ui-scale`, `renderPaneLayout()` writes pane width CSS
variables, and `renderCenterWorkbenchPanelSeparators()` immediately reads
center panel rectangles. During live resize this write-then-read chain can force
layout in the resize callback and make the overlay feel stuck.

## Fix Plan

1. Keep `applyWindowResizeOnFrame` as the only window resize scheduler.
2. Keep `renderCenterWorkbenchPanelLayoutOnFrame` as the only center workbench
   layout/reveal owner.
3. Change `applyWindowResize()` to apply zoom and pane layout, then schedule
   `renderCenterWorkbenchPanelLayoutOnFrame.schedule()`.
4. Extend the static architecture test to forbid a direct
   `renderCenterWorkbenchPanelSeparators()` call inside `applyWindowResize()`.
5. Extend the browser separator test to instrument real viewport resize and
   assert center workbench rect reads do not share the resize style-write RAF
   callback.
6. Capture desktop and narrow resize screenshots for visual review.

## Acceptance

- Window resize still has one listener path and one `applyWindowResizeOnFrame`
  scheduler.
- Center workbench layout still has one RAF owner and one persisted weight
  source.
- `applyWindowResize()` no longer calls `renderCenterWorkbenchPanelSeparators()`
  or `renderCenterWorkbenchPanelLayout()` directly.
- Browser instrumentation shows no center workbench rect read in the same RAF
  callback as resize style writes.
- Focused unit tests, typecheck, real browser test, screenshots, and self-review
  pass before commit/push.

## Verification

- `bun test packages/overlay/test/resize-observer-frame-scheduler.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/center-workbench-separator-browser.test.ts`
- `bun test packages/overlay/test/acceptance-panel-mount.test.ts packages/overlay/test/pane-config.test.ts --timeout 30000`
- `bun run --cwd packages/overlay build:vite`
- Visual QA: viewed `.scratch/center-workbench-separator-focus.png`,
  `.scratch/center-workbench-separator-desktop-resize.png`,
  `.scratch/center-workbench-separator-narrow-resize.png`, and
  `.scratch/center-workbench-separator-restored-desktop-resize.png`.

## Self Review

- Rechecked `applyWindowResize()`; it applies zoom and pane layout, then
  schedules `renderCenterWorkbenchPanelLayoutOnFrame.schedule()` instead of
  directly calling center separator geometry.
- Rechecked scheduler ownership; no second
  `createAnimationFrameScheduler(renderCenterWorkbenchPanelSeparators)` path was
  introduced.
- Rechecked visual evidence; 1180px keeps the desktop right-toolbar layout,
  500px uses the existing responsive column/bottom-toolbar layout, and the
  restored desktop screenshot returns to the right-toolbar layout with the
  separator enabled.
- No high-confidence dead code was identified in this resize path. The next
  high-confidence audit item is screenshot browser full-tree collection.
