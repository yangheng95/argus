# Screenshot Browser Open Jank

Date: 2026-06-22
Status: Implemented

## Acronyms

- UI: User Interface, the visible overlay controls and panels.
- GUI: Graphical User Interface, the browser-rendered overlay surface.
- URL: Uniform Resource Locator, the stored attachment address rendered by image thumbnails.
- DOM: Document Object Model, the browser element tree.

## Task Definition

Investigate and repair the overlay screenshot toolbar jank reported when opening
the right-side screenshots activity, then verify resize behavior remains
responsive and visually correct.

## Input And Output

- Input: an active task conversation/card tree containing many stored screenshot
  attachment URLs.
- Output: opening the right screenshots activity renders a bounded visible set
  of thumbnail cards without issuing one attachment request per historical
  screenshot, while the panel still groups screenshots by canonical agent role
  and uses the shared image preview path.

## Environment

- Overlay browser tests run through `node`, not Bun, via
  `OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1 node --test --test-concurrency=1`.
- Static/unit tests may use focused `bun test` commands.
- Visual evidence is captured from the real overlay browser fixture.

## Timeout Policy

Browser benchmark commands use the existing overlay browser sidecar RPC timeout,
which is reset per RPC activity. Any new unattended benchmark wrapper must use an
inactivity timeout, not a process-start wall-clock timeout.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback, no gate, no hidden duplicate source, test every code change, and visually inspect UI fixes. |
| `2026-06-14-right-toolbar-screenshot-browser.md` | Screenshot browser must derive from the task card/message source, only accept stored `/attachment/<project>/<name>` URLs, reuse `PreviewableImage`, and avoid local screenshot storage. |
| `2026-06-18-right-activity-toolbar-responsive-rail.md` | Right toolbar must stay a single `SideActivityToolbar` source and remain hit-testable at responsive widths. |
| `2026-06-20-side-activity-toolbar-aria-semantics.md` | Right activity buttons keep `pressed-toggle` semantics; left navigation uses `current-page`. |
| `2026-06-19-deep-performance-investigation.md` | Always-mounted hidden panels must not prefetch or materialize resources. |
| `2026-06-19-system-performance-high-confidence-pass.md` | Previous backend diff/log hot spots are already fixed; do not reintroduce broad polling or completed-empty diff caches. |

## Call Point Inventory

| Surface | Current evidence | Decision |
| --- | --- | --- |
| Screenshot source | `ScreenshotBrowserPanel.tsx` gates item derivation on `active()` and calls `collectScreenshotBrowserItemsFromCardTree(cardTreeStore.order, cardTreeStore.cards)`. | Keep card tree as the single source; no second store or message mirror. |
| Thumbnail rendering | `ScreenshotThumbnail` creates one Solid resource per rendered item and calls `fetchResourceAsObjectUrl` for stored attachment URLs. | Do not render all 120 capped items at once; route visible thumbnail cards through the existing `virtua/solid` virtualizer. |
| Item cap | `screenshot-browser.ts` sorts and slices to `SCREENSHOT_BROWSER_ITEM_LIMIT = 120`. | Keep the cap as data protection, but do not rely on it as the render/request budget. |
| Shared preview | `ScreenshotThumbnail` renders `PreviewableImage`. | Preserve the shared preview path and object URL LRU; no direct `URL.createObjectURL` in the panel. |
| CSS owner | `activity.css` owns `.screenshot-browser-*` layout. | Add only structural virtual-window/item rules in the same owner. |
| Browser coverage | `screenshot-browser-panel-browser.test.ts` opens a one-image panel and screenshots desktop/narrow layout. | Extend it with many screenshot cards, request-count assertions, open latency, resize/scroll behavior, and screenshots. |
| Resize path | Center workbench resize lives in `main.tsx`; default pane resize lives in `services/pane.ts`. | Do not add a second resize implementation; verify screenshot panel remains stable under existing workbench resize. |

## Root Cause

The visible symptom is a slow right-toolbar screenshot open. The direct trigger
is that the screenshot browser maps every group item to `ScreenshotThumbnail`,
and each mounted thumbnail owns a `createResource` call that materializes a
stored attachment URL. With the current 120-item history cap, opening the panel
can immediately create up to 120 image resources and attachment requests in one
frame. The cap protects data size, not GUI responsiveness.

## Fix Plan

1. Replace the nested `For` rendering of screenshot cards with a virtualized
   flat row model backed by `virtua/solid`.
2. Keep agent grouping headers in the rendered model so visual grouping remains
   unchanged.
3. Render only visible card rows; hidden/offscreen thumbnails must not create
   `ScreenshotThumbnail` resources or fetch object URLs.
4. Use `IntersectionObserver` against the screenshot virtual window so mounted
   overscan thumbnails fetch object URLs only after entering the visible
   threshold.
5. Route screenshot panel and image preview `ResizeObserver` callbacks through
   the existing animation-frame scheduler.
6. Add source-level tests requiring `virtua/solid`, no nested full-item
   thumbnail `For`, and no direct object URL/storage/fetch paths.
7. Extend the real browser test with a large screenshot fixture that asserts
   initial attachment requests stay bounded, screenshots render, scrolling
   loads later thumbnails on demand, and resize/narrow layout remains clean.

## Acceptance

- Opening the screenshot activity with 120 screenshot records performs only a
  bounded visible subset of attachment requests before scroll.
- Scrolling the virtualized list materializes later thumbnails on demand.
- Screenshot grouping by agent role remains visible and uses the same labels.
- The panel still reuses `PreviewableImage` and `fetchResourceAsObjectUrl`.
- No direct `URL.createObjectURL`, local storage, iframe, fallback data source,
  or alternate toolbar source is introduced.
- Focused unit and browser tests pass.
- Browser screenshots for desktop and narrow/resize states are captured and
  reviewed.

## Implementation Notes

- `ScreenshotBrowserPanel` now builds a grouped row model and renders it through
  `virtua/solid`; the card tree remains the single screenshot source.
- The outer `.screenshot-browser-groups` element is the scroll container; the
  inner virtual window is only the spacer/content layer.
- Thumbnail object URL fetches require viewport intersection and are released
  in small animation-frame batches.
- Screenshot panel and image preview resize work now goes through the shared
  animation-frame scheduler.
- Browser verification exposed a Node sidecar screenshot wrapper defect where
  omitted screenshot options were forwarded as `null`; `launch.ts` now forwards
  explicit empty option objects for page and element screenshots.

## Verification

- `bun test packages/overlay/test/visual-browser-launch-contract.test.ts packages/overlay/test/screenshot-browser-panel.test.ts packages/overlay/test/resize-observer-frame-scheduler.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`
- `OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1 node --test --test-concurrency=1 packages/overlay/test/browser/screenshot-browser-panel-browser.test.ts`
- Visual evidence reviewed:
  `.scratch/screenshot-browser-panel-browser.png`,
  `.scratch/screenshot-browser-panel-browser-narrow.png`, and
  `.scratch/screenshot-browser-panel-browser-narrow-panel.png`.
