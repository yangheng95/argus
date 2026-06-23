# Image Preview Wheel Frame Owner

Date: 2026-06-23
Status: Verified

## Acronyms

- GUI: Graphical User Interface, the visible overlay surface.
- RAF: RequestAnimationFrame, the browser callback phase used for visual-frame work.
- UI: User Interface, visible controls and interaction surfaces.

## Task Definition

Remove synchronous layout reads and scale writes from Image Preview ctrl-wheel
zoom bursts. Wheel input must keep cursor-anchored zooming, but high-frequency
wheel events must only record the latest zoom intent. Body geometry reads,
scale changes, and scroll correction must run from the Image Preview frame
owner.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback logic, no duplicate source, recall before edits, test every change, visually verify UI work, commit and push every round. |
| `2026-06-23-dialog-drag-frame-owner.md` | High-frequency dialog pointer streams record the latest input and defer layout reads/writes to RAF, then flush on end when needed. |
| `2026-06-23-overlay-panel-legal-size-contract.md` | Dialogs and overlay panels must use the legal overlay shell and token-owned sizes, not raw viewport fallback dimensions. |
| `2026-06-22-screenshot-browser-thumbnail-decode-budget.md` | Screenshot thumbnails reuse `PreviewableImage`; the modal preview remains the shared zoom/copy surface. |
| `2026-06-23-screenshot-thumbnail-load-queue-cancellation.md` | Screenshot browser must keep `PreviewableImage` as the shared preview path and avoid second image sources. |
| Independent read-only audit 2026-06-23 | `ImagePreview.tsx` reads `.image-preview-dialog__body.getBoundingClientRect()` and `clientWidth/clientHeight` inside ctrl-wheel zoom handling. |

## Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| Wheel handler | `handleWheel()` reads `body.getBoundingClientRect()` and calls `applyScale()` during the wheel event. | Change it to record a pending wheel zoom and schedule one RAF commit. |
| Scale commit | `applyScale()` reads `body.clientWidth/clientHeight` when no anchor is supplied and writes scale immediately. | Keep discrete button calls synchronous, but make wheel pass cached geometry-owned anchors from RAF. |
| Viewport scale math | `viewportSize()` reads computed padding plus body client size for open/fit/width scales. | Cache body viewport size in a signal updated by the same body-geometry frame owner. |
| Body resize | `ResizeObserver(applyOpenScaleOnFrame.schedule)` currently triggers open-scale recomputation. | Route ResizeObserver through the body-geometry frame owner before open-scale computation. |
| Shared preview callers | `FilePart.tsx`, `InlineToolPart.tsx`, `BrowserPreviewPanel.tsx`, and `ScreenshotBrowserPanel.tsx` use `PreviewableImage`. | Do not add another image preview component or screenshot-specific zoom path. |
| Static tests | `message-image-preview.test.ts` pins Image Preview ownership and UI contract. | Extend it to reject wheel handler layout reads and require RAF scheduling. |
| Browser tests | `image-preview-copy.test.ts` opens a real Image Preview dialog. | Extend it with ctrl-wheel burst instrumentation and a screenshot artifact. |

## Root Cause

The modal preview has a shared image surface, but its ctrl-wheel path still
uses an event-owned geometry model. Each wheel event reads the body rect to
convert viewport coordinates to local coordinates, then `applyScale()` may read
body dimensions and writes Solid scale state immediately. Under a burst this
creates repeated input-task layout work and scroll correction scheduling.

## Fix Plan

1. Add a body-geometry cache updated from a RAF scheduler.
2. Make ResizeObserver schedule that body-geometry owner before open-scale
   recomputation.
3. Change `handleWheel()` to record the latest cursor position and accumulated
   scale delta, then schedule a single wheel-scale RAF commit.
4. In the RAF commit, read body geometry once, convert the last cursor position
   to a local anchor, apply one accumulated scale delta, and clear the pending
   wheel state.
5. Keep button zoom, fit, width, original-size, copy, pan, `PreviewableImage`,
   and legal dialog shell ownership unchanged.
6. Extend static and real browser tests, inspect the generated screenshot, then
   self-review, commit, and push.

## Acceptance

- Ctrl-wheel bursts over `.image-preview-dialog__body` perform no
  `getBoundingClientRect()`, `clientWidth`, or `clientHeight` reads during the
  wheel event task.
- A burst of wheel events produces one frame-owned scale commit using the latest
  cursor anchor and accumulated wheel delta.
- ResizeObserver remains the body geometry source; no raw viewport fallback,
  second image preview owner, debounce gate, or alternate zoom source is added.
- Shared `PreviewableImage` adoption remains unchanged for message/file/browser
  evidence/screenshot surfaces.
- Focused unit/static tests, overlay typecheck, node browser test, visual QA,
  self-review, commit, and push pass.

## Implementation

- `ImagePreviewHost` now stores body geometry in a single Solid signal:
  `{ left, top, viewportSize }`. The previous mirror between a non-reactive
  geometry object and a separate viewport-size signal was removed.
- Body geometry is read only from the frame owner. ResizeObserver schedules the
  open-scale frame, and wheel bursts schedule `applyWheelScaleOnFrame`.
- The wheel owner moved from Solid's delegated `onWheel` path to one native
  non-passive wheel listener on `.image-preview-dialog__body`. Modified wheel
  events are consumed at the body before document-level delegated/scroll-lock
  listeners can add layout reads.
- Ctrl and Meta/Cmd wheel both use the same pending-wheel accumulator. A burst
  stores the latest cursor coordinate plus accumulated scale delta, then one RAF
  reads body geometry and applies the scale.
- `PreviewableImage`, copy, pan, fit-width, fit-image, original-size, and
  dialog shell ownership are unchanged.

## Verification

- PASS: `bun test packages/overlay/test/message-image-preview.test.ts --timeout 30000`.
- PASS: `bun test packages/overlay/test/resize-observer-frame-scheduler.test.ts packages/overlay/test/message-image-preview.test.ts --timeout 30000`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/image-preview-copy.test.ts`.

## Visual QA

- Reviewed `.scratch/image-preview-wheel-zoom.png`; the Image Preview dialog
  remains inside the legal shell after Ctrl zoom-in and Meta zoom-out bursts,
  toolbar controls stay aligned, and the scale label shows `300%`.

## Self Review

- Rechecked `handleWheel()`: it has no `getBoundingClientRect()`,
  `clientWidth`, `clientHeight`, or direct `applyScale()` call.
- Rechecked wheel ownership: the rendered body has no Solid `onWheel`
  delegated handler; native listener cleanup removes the same handler on
  component cleanup.
- Rechecked the browser probe: Ctrl and Meta bursts each report zero body rect,
  width, and height reads during the wheel event task, and exactly one body
  rect/clientWidth/clientHeight read in RAF.
- Rechecked shared preview ownership: `FilePart`, `InlineToolPart`,
  `BrowserPreviewPanel`, and `ScreenshotBrowserPanel` still use
  `PreviewableImage`; no second preview component or screenshot-specific zoom
  path was introduced.
