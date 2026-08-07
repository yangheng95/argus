# Browser Preview Live Input Rect Cache

Date: 2026-06-23
Status: Verified

## Acronyms

- API: Application Programming Interface, the backend route contract consumed by the overlay.
- DOM: Document Object Model, the browser element tree.
- GUI: Graphical User Interface, the visible overlay surface.
- RAF: Request Animation Frame, the browser callback used to run visual work once per frame.
- UI: User Interface, visible controls and layout surfaces.

## Task Definition

Remove synchronous live screenshot layout reads from high-frequency Browser
Preview input events. Click and wheel events on `.browser-preview-live-frame`
must use a cached screenshot rect owned by the live preview component instead
of querying the DOM and calling `getBoundingClientRect()` in every event
handler.

## Recall

| Source                                                          | Constraint carried forward                                                                                                                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                                     | No fallback, no dual source, test every change, visually verify UI work, and use Node for Playwright browser tests on Windows.              |
| `2026-06-11-browser-preview-interactive-live-session.md`        | Live preview is task-scoped and backend-owned; the overlay computes coordinates from the displayed screenshot bounds and selected viewport. |
| `2026-06-19-browser-preview-live-frame-application-role.md`     | The live frame is an interactive application region and must preserve click, wheel, and keyboard routing.                                   |
| `2026-06-22-browser-preview-live-input-batch-owner.md`          | The overlay already owns request batching; this round must not reintroduce one-request-per-input behavior.                                  |
| `2026-06-22-browser-preview-evidence-live-snapshot-boundary.md` | Persisted evidence remains the preview owner when available; live input changes must not request hidden evidence capture.                   |
| Confucius read-only audit                                       | `livePoint()` still used `querySelector` and `image.getBoundingClientRect()` for every click/wheel event.                                   |

## Call Point Inventory

| Search                                                  | Findings                                                                                                                                           | Decision                                                                                             |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `livePoint`, `handleLiveWheel`, `handleLivePointerDown` | Both click and wheel handlers called `livePoint(event, event.currentTarget)`, and `livePoint()` queried the image and read its rect synchronously. | Make input handlers call `livePoint(event)` and read only cached rect state.                         |
| `browserPreviewLivePoint`                               | Pure helper maps event coordinates and image rect into viewport coordinates.                                                                       | Keep the pure helper; change only the rect owner.                                                    |
| `flushLiveInputOnFrame`, `pendingLiveInputs`            | Existing batch owner coalesces requests but still depends on event-time point calculation.                                                         | Keep batching and move only screenshot rect measurement out of input events.                         |
| `browser-preview-live-input-batch.test.ts`              | Browser test already opens a real live preview and dispatches mixed input plus wheel bursts.                                                       | Add layout-read instrumentation to assert live input event handlers do not read screenshot geometry. |
| `browser-preview-panel.test.ts`                         | Static guard covers live input ownership and no iframe.                                                                                            | Add guard that `livePoint` has no `querySelector` or `getBoundingClientRect`.                        |

## Root Cause

The 2026-06-22 batch owner fixed request backlog pressure, but coordinate
calculation still did layout work in the input event itself. Wheel bursts could
therefore dispatch fewer backend requests while still forcing repeated layout
reads on the overlay thread. The visual symptom is toolbar/live preview input
feeling sticky even after request batching.

## Fix

1. Add a component-owned live screenshot rect cache.
2. Bind the current live screenshot image with `ref={bindLiveImageElement}`.
3. Measure the image rect through a RAF scheduler after image ref, image load,
   and `ResizeObserver` notifications.
4. Clear the cached rect when the live image/scope is cleared.
5. Make `livePoint()` consume the cached rect and schedule a measurement when
   the cache is missing, without reading layout in the event handler.
6. Extend the browser live-input batch test with an instrumentation probe that
   records `getBoundingClientRect()` calls on the live screenshot and marks
   input-event dispatch depth.

No fallback coordinate path, iframe, URL override, hidden capture trigger, or
secondary preview source is introduced.

## Verification

- PASS: `bun test packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/browser-preview-live-point.test.ts --timeout 30000`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/browser-preview-live-input-batch.test.ts`.

## Visual Review

- `packages/overlay/.scratch/browser-preview-live-input-batch.png`: live preview
  renders the backend-owned screenshot after mixed input and wheel burst; status,
  viewport selector, and capture command remain visible.

## Self Review

- Rechecked `BrowserPreviewPanel.tsx`: `livePoint()` no longer contains
  `querySelector` or `getBoundingClientRect`; the only live screenshot rect read
  is the RAF-owned measurement callback.
- Rechecked browser instrumentation: the test helper reads geometry once to
  choose dispatch coordinates, but the input event handler depth records zero
  live screenshot rect reads for mixed click/wheel/key input and the wheel burst.
- Rechecked request batching: the existing `inputs[]` batch path and wheel delta
  coalescing assertions still pass.
