# Screenshot Browser Thumbnail Decode Budget

Date: 2026-06-22
Status: Verified

## Acronyms

- GUI: Graphical User Interface, the browser-rendered overlay surface.
- UI: User Interface, visible controls and layout surfaces.
- RAF: Request Animation Frame, the browser callback used to run visual work once per frame.
- LCP: Largest Contentful Paint, a browser paint metric; screenshot browser thumbnails are not LCP candidates for this overlay workflow.

## Task Definition

Keep screenshot toolbar open responsive under large screenshot histories by
moving thumbnail image decode/fetch priority out of the toolbar-open critical
path and tightening the real browser benchmark so it measures visible toolbar
response separately from image decode completion.

## Recall

| Source                                                     | Constraint carried forward                                                                                                                                        |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                                | No fallback, no duplicate source, recall before edits, test every change, visually verify UI changes, commit and push every round.                                |
| `2026-06-22-screenshot-browser-open-jank.md`               | Screenshot rendering is virtualized and thumbnail fetches are lazy and frame-batched.                                                                             |
| `2026-06-22-screenshot-browser-defer-initial-measure.md`   | Toolbar open must not synchronously read screenshot list width outside RAF.                                                                                       |
| `2026-06-22-screenshot-browser-top-level-index.md`         | Screenshot panel reads `cardTreeStore.screenshotItems`; no panel-local source or traversal fallback.                                                              |
| `2026-06-22-screenshot-browser-virtual-row-measurement.md` | CSS and `virtua/solid` own row geometry; no fixed TypeScript row-height source.                                                                                   |
| Live 7878 audit 2026-06-22                                 | Existing in-app tab can be stale and slow; isolated new browser pages on current assets are the authoritative code verification path unless user permits refresh. |

## Call Point Inventory

| Surface                  | Evidence                                                                                                                                         | Decision                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Screenshot thumbnail     | `ScreenshotBrowserPanel.tsx` renders `PreviewableImage` without `imageAttributes`.                                                               | Add `decoding="async"` and `fetchpriority="low"` only for screenshot thumbnails.                                               |
| Shared preview component | `ImagePreview.tsx` already exposes `imageAttributes?: JSX.ImgHTMLAttributes<HTMLImageElement>`.                                                  | Reuse the existing shared primitive; do not add a second image path.                                                           |
| Browser preview evidence | `BrowserPreviewPanel.tsx` already passes `decoding: "async"` to `PreviewableImage`.                                                              | Keep evidence screenshots unchanged; screenshot thumbnails have their own lower priority because they are dense list content.  |
| Message/file images      | `FilePart.tsx`, `InlineToolPart.tsx`, and markdown image rendering also use image preview paths.                                                 | Leave them unchanged; user-facing inline message images should not inherit screenshot-browser thumbnail priority.              |
| Static screenshot test   | `screenshot-browser-panel.test.ts` already checks shared preview reuse, lazy loading, bounded requests, and forbidden local storage/fetch paths. | Extend it to pin screenshot thumbnail async decode and low fetch priority.                                                     |
| Browser benchmark        | `screenshot-browser-panel-browser.test.ts` currently asserts `openElapsed < 5000` after waiting for image decode.                                | Split visible toolbar response from image decode completion, add long-task and frame-gap budgets, and tighten the open budget. |

## Root Cause

The previous screenshot browser fixes removed synchronous tree traversal,
full-list rendering, eager thumbnail requests, synchronous list measurement,
and fixed virtual row geometry. The remaining benchmark gap is that the real
browser test waits for the first image to finish decoding before evaluating
`openElapsed`, while also allowing five seconds. That makes the test too loose
to catch a slow toolbar reveal and too noisy to identify decode-specific cost.

At the code level, screenshot thumbnails reuse `PreviewableImage` but do not
provide the async decode hint already used by browser preview evidence images.
For a dense thumbnail list, synchronous decode is not needed for interaction
correctness and can compete with the toolbar reveal frame.

## Fix Plan

1. Pass `imageAttributes={{ decoding: "async", fetchpriority: "low" }}` from
   screenshot thumbnails to the shared `PreviewableImage`.
2. Keep `PreviewableImage`, `fetchResourceAsObjectUrl`, IntersectionObserver
   lazy loading, frame-batched load permission, `virtua/solid`, and
   `cardTreeStore.screenshotItems` unchanged.
3. Extend the static screenshot panel test to reject thumbnails without async
   decoding and low fetch priority.
4. Extend the real browser test with `PerformanceObserver("longtask")` when
   supported, RAF-frame gap sampling, a tight first-card-visible open budget,
   and a separate image-decode completion budget.
5. Capture and inspect the existing screenshot browser visual artifacts again.

## Acceptance

- Screenshot thumbnails still render through shared `PreviewableImage`.
- Screenshot thumbnails declare async image decoding and low fetch priority.
- Toolbar open benchmark measures first visible card separately from image
  decode completion.
- Browser test fails on long main-thread tasks or excessive RAF gaps during
  screenshot toolbar open.
- No fallback traversal, duplicate screenshot source, iframe, local storage,
  direct object URL path, or direct `<img>` thumbnail path is introduced.

## Implementation

| Change                                                                                                                                          | Reason                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `ScreenshotBrowserPanel` now passes `imageAttributes={{ decoding: "async", fetchpriority: "low" }}` to screenshot thumbnail `PreviewableImage`. | Keeps the shared preview primitive while moving dense thumbnail decode/fetch priority off the toolbar-open critical path. |
| `SCREENSHOT_BROWSER_THUMBNAIL_LOADS_PER_FRAME` changed from 3 to 1.                                                                             | Large screenshots should not start multiple full-image fetch/decode operations in the same visual frame.                  |
| The browser fixture now generates distinct 1440x900 PNG attachments per screenshot index.                                                       | Prevents the benchmark from being satisfied by a tiny repeated 320x180 PNG or decode cache.                               |
| Browser perf sampling waits for conversation data before timing toolbar open and runs until all mounted first-screen thumbnails complete.       | Separates toolbar response from initial data load, then still covers visible thumbnail decode pressure.                   |
| The narrow-panel screenshot uses the computed `--ui-workbench-panel-min-width` instead of a hard-coded 320px.                                   | Prevents the test from creating an illegal panel width below the project size contract.                                   |

## Verification

- `bun test packages/overlay/test/screenshot-browser-panel.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/screenshot-browser-panel-browser.test.ts`

The real browser benchmark passed with the heavier fixture and generated fresh
visual artifacts:

- `.scratch/screenshot-browser-panel-browser.png`
- `.scratch/screenshot-browser-panel-browser-high-zoom.png`
- `.scratch/screenshot-browser-panel-browser-narrow.png`
- `.scratch/screenshot-browser-panel-browser-narrow-panel.png`

## Self Review

- Rechecked `ScreenshotBrowserPanel`; screenshot thumbnails still use
  `PreviewableImage`, `fetchResourceAsObjectUrl`, object URL cache peeking,
  IntersectionObserver lazy loading, and `cardTreeStore.screenshotItems`.
- Rechecked the browser benchmark; it still asserts zero layout work outside
  RAF, bounded attachment requests, virtualized rows, no horizontal escape, and
  oldest-row materialization without fetching the full 120-image history.
- Rechecked visual artifacts; desktop and high-scale screenshots show decoded
  1440x900 thumbnails, and the narrow-panel crop now fully contains title,
  count, and a 2x2 thumbnail grid without left clipping.
- Follow-up findings from independent GUI audit are queued for the next round:
  config sidebar width clamping double source, left header action button
  primitive ownership, and dead `data-resizing="row"` CSS.
