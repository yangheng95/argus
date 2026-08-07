# Browser Preview Pane Width Autoscale

Date: 2026-06-28
Status: Verified

## Acronyms

- DOM: Document Object Model, the browser element tree used for layout and input events.
- GUI: Graphical User Interface, the visible overlay surface.
- PNG: Portable Network Graphics, the image format returned by the live preview routes.
- RAF: Request Animation Frame, the browser callback used to run visual work once per frame.
- UI: User Interface, visible controls and layout surfaces.

## Task Definition

The overlay browser preview live surface must automatically fit the current pane
width. The current live screenshot can keep its viewport-sized intrinsic width
through the flex/grid layout, causing the preview to clip instead of scaling and
making pane interactions feel slow. The fix must keep the task-scoped backend
preview target/live PNG as the only source and must not reintroduce iframe,
local URL override, transform scaling, hidden evidence capture, or input-event
layout reads.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback, no duplicate preview source, no blind patching, test every change, and visually verify overlay/preview work with screenshots. |
| `2026-06-04-right-panel-frontend-preview-mature-toolchain.md` | The current right preview contract rejects iframe rendering and local query/signal overrides; preview state must come from backend task artifacts/evidence. |
| `2026-06-22-browser-preview-viewport-source.md` | Overlay must trust backend-supplied viewport dimensions and must not keep frontend viewport constants. |
| `2026-06-22-browser-preview-live-input-batch-owner.md` | Live input stays batched; no one-request-per-wheel/event path may return. |
| `2026-06-23-browser-preview-live-input-rect-cache.md` | Pointer and wheel handlers must not call `querySelector` or `getBoundingClientRect`; rendered image rect measurement stays RAF-owned. |
| `2026-06-23-browser-preview-live-snapshot-scope-owner.md` | Live snapshot requests are owned by the live scope and must not duplicate when images load or layout updates. |
| `2026-06-22-overlay-resize-frame-coalescing.md` | High-frequency resize/pointer work must remain frame-coalesced. |

## Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| Panel mount | `packages/overlay/src/main.tsx` mounts `<BrowserPreviewPanel>` in the center workbench and passes `.center-workbench-body` as the scroll owner. | Keep mount and scroll owner unchanged; do not touch running overlay processes. |
| Live component | `packages/overlay/src/components/BrowserPreviewPanel.tsx` renders `.browser-preview-live-frame` and the live PNG image. | Add layout variables derived from `selectedViewport()` to the frame. Keep backend `viewports` as the single dimension source. |
| Live rect cache | `BrowserPreviewPanel.tsx` stores `liveImageRect`, measures it through `createAnimationFrameScheduler`, and observes the image with `ResizeObserver`. | Keep the cache owner; scaling still maps input through the rendered image rect. |
| Coordinate helper | `packages/overlay/src/components/browser-preview-live-point.ts` maps client coordinates and image rect to viewport coordinates. | Keep unchanged; pane-width scaling is already represented by the measured rect. |
| CSS live surface | `packages/overlay/src/styles/surfaces/inspector.css` sets `.browser-preview-live { flex: 1 0 auto; }`, which lets intrinsic image width keep the flex item wider than the pane. | Replace with shrinkable width-fill sizing and frame containment; no CSS transform scaling. |
| Static tests | `packages/overlay/test/browser-preview-panel.test.ts` already guards no iframe, no polling, no input-event layout read, and browser-preview CSS ownership. | Extend it to require backend-derived live frame CSS variables, shrinkable width-fill live surface, and no `transform: scale`. |
| Browser test | `packages/overlay/test/browser/browser-preview-live-input-batch.test.ts` currently forces horizontal scroll to validate rect recalc after scroll. | Replace that obsolete expectation with real browser assertions that live frame/image fit pane width without horizontal overflow, then verify visual-center clicks still map to viewport center after resize. |
| Visual stress test | `packages/overlay/test/browser/browser-preview-visual-stress.test.ts` screenshots live/evidence/failure states and checks no control overlap. | Leave broad coverage unchanged; the focused live-input browser test owns the scaling assertion. |
| Backend live routes | `packages/opencorvus/src/browser-preview/live.ts` resolves viewport dimensions from the persisted target and returns PNG snapshots/input responses. | Leave backend unchanged; the defect is the overlay layout using the intrinsic image width incorrectly. |

## Root Cause

The backend already supplies the preview viewport dimensions and the live image is
rendered as an `<img>` from the task-scoped live route. The layout layer then
wraps that image in `.browser-preview-live` with `flex: 1 0 auto`. In a flex
container, `flex-shrink: 0` plus an auto basis lets the live surface keep the
image's intrinsic width. The stage hides horizontal overflow, so the user sees a
clipped "unscaled" preview and the workbench carries unnecessary large paint and
scroll geometry. The input path is already using a cached rendered rect, so the
root fix is to make the rendered rect match the pane width instead of adding a
second scale calculation.

The same rect cache has a jank edge: when a pane/image resize invalidates the
rendered rect, queued point inputs may reach `pendingLiveInputsForScope()` before
the RAF measurement has produced a fresh rect. The current code schedules the
measurement and returns, but does not wake the pending input flush after the
measurement completes. That makes the first click/wheel after a resize feel
stuck until another input happens.

## Fix Plan

1. Add a `liveFrameStyle` memo in `BrowserPreviewPanel.tsx` that writes
   `--browser-preview-live-aspect-ratio` from the selected backend viewport.
2. Attach that style to `.browser-preview-live-frame` so the frame has a stable
   pane-width aspect before the PNG finishes loading.
3. Change `.browser-preview-live` and `.browser-preview-evidence` from
   non-shrinking auto-basis flex items to width-fill, shrinkable pane children.
4. Change `.browser-preview-live-frame` to width-fill with max-width, overflow
   containment, and the backend-derived aspect ratio. Keep the image at
   `width: 100%; height: auto;` and do not use transform scaling.
5. Invalidate the cached live rect when scroll/resize changes the rendered
   bounds, and after the RAF measurement writes a fresh rect, reschedule the
   pending live input flush for the same live scope.
6. Update source tests to guard the new sizing contract and the no-transform/no
   iframe constraints.
7. Update the real browser live-input test to assert the live frame and image fit
   the pane both before and after a viewport resize, then submit a visual-center
   click and verify backend viewport coordinates remain centered.

## Acceptance

- The live browser preview screenshot scales to the current pane width and does
  not create horizontal overflow inside `.browser-preview-stage`.
- The frame aspect comes from the selected backend viewport, not frontend
  constants.
- Pointer/wheel handlers still do not read DOM geometry; the existing RAF-owned
  rect cache remains the coordinate owner.
- Point inputs queued while a fresh rect is pending are flushed after the RAF
  measurement instead of waiting for a second user input.
- Live input batching and exact snapshot-scope ownership remain intact.
- No iframe, local preview source, hidden evidence capture, CSS transform scale,
  or fallback viewport size is introduced.
- Focused unit/source tests, overlay typecheck, Node browser test, screenshot
  review, and `git diff --check` pass.

## Verification Plan

- `bun test packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/browser-preview-live-point.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/browser-preview-live-input-batch.test.ts`
- Review `packages/overlay/.scratch/browser-preview-live-input-batch.png`.
- `git diff --check`

## Verification

- PASS: `bun test packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/browser-preview-live-point.test.ts --timeout 30000`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/browser-preview-live-input-batch.test.ts`.
- PASS: `git diff --check -- packages/overlay/src/components/BrowserPreviewPanel.tsx packages/overlay/src/styles/surfaces/inspector.css packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/browser/browser-preview-live-input-batch.test.ts specs/records/2026-06/2026-06-28-browser-preview-pane-width-autoscale.md`.

## Visual Review

- `packages/overlay/.scratch/browser-preview-live-input-batch.png` shows the live
  preview PNG filling the pane width without horizontal clipping, transform
  scaling, control overlap, or error toast pollution.

## Self Review

- Rechecked `BrowserPreviewPanel.tsx`: the live frame aspect ratio is derived
  from `selectedViewport()` and fails fast if the backend viewport is missing.
- Rechecked live input: pointer and wheel events enqueue client coordinates
  without layout reads; the RAF-owned rect measurement converts them and wakes
  pending input flushes after scroll/resize invalidation.
- Rechecked CSS: `.browser-preview-live` and `.browser-preview-evidence` are
  shrinkable pane-width children; `.browser-preview-live-frame` uses width-fill
  layout plus backend aspect ratio, not `transform: scale`.
