# Left Pane Drag Frame Coalescing

Date: 2026-06-22
Status: Verified

## Acronyms

- GUI: Graphical User Interface, the browser-rendered overlay surface.
- UI: User Interface, visible controls and layout surfaces.
- RAF: Request Animation Frame, the browser callback used to run visual work once per frame.
- DOM: Document Object Model, the browser element tree.

## Task Definition

Remove default left pane drag jank caused by synchronous layout reads and writes
on every pointermove.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback, no duplicate resize owner, test every change, visually verify UI changes, and commit/push each round. |
| `2026-06-17-left-pane-resizer-accessibility.md` | `renderPaneLayout()` is the single CSS width and separator semantics writer for pane resizing. |
| `2026-06-22-overlay-resize-frame-coalescing.md` | High-frequency resize work must be coalesced through the shared RAF scheduler. |
| `2026-06-22-window-resize-center-layout-frame.md` | Window resize already schedules pane layout; this round targets pointer drag inside `services/pane.ts`. |
| Faraday GUI audit | `onPaneResizeMove -> resizePane` synchronously reads pane bounds and writes layout for every pointermove. |

## Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| Pointer drag owner | `initPaneResizers()` attaches pointerdown listeners for left/right handles and closes over pane callbacks. | Keep this service as the only default pane drag owner. |
| Pointermove path | `onPaneResizeMove()` calls `resizePane()` directly for every event. | Store latest `clientX` and schedule one RAF resize. |
| Bounds/layout path | `resizePane()` calls `paneResizeBounds()` and `renderPaneLayout()`. | Keep this math and renderer unchanged; only change when it runs. |
| Pointerup/cancel | `stopPaneResize()` persists rendered widths. | Cancel scheduled RAF and flush the last pending `clientX` before persistence. |
| Keyboard resize | `resizePaneByKeyboard()` is immediate and accessibility-driven. | Leave keyboard behavior immediate. |
| Tests | `pane-config.test.ts` and `browser/left-pane-resizer-browser.test.ts` cover pane service ownership and real separator behavior. | Extend both to prove pointermove work is RAF-coalesced and visually unchanged. |

## Root Cause

During drag, every `pointermove` enters `resizePane()`, which reads
`#panelBody.getBoundingClientRect()` through `paneResizeBounds()` and writes CSS
variables plus ARIA values through `renderPaneLayout()`. Pointermove can fire
far more often than the display frame rate, so rapid drags create read/write
layout pressure inside the event stream.

## Fix Plan

1. Reuse `createAnimationFrameScheduler` inside `services/pane.ts`.
2. Extend the module drag record with callbacks, latest pending `clientX`, and
   a per-drag RAF scheduler.
3. Keep pointerdown's initial resize immediate, then coalesce subsequent
   pointermove events to the latest `clientX`.
4. On pointerup/cancel/cancelPaneResize, cancel any scheduled RAF and run the
   final pending resize before persisting widths.
5. Add static tests rejecting direct pointermove-to-`resizePane()` regression.
6. Extend the real browser left-pane test to dispatch a pointermove burst,
   prove no layout writes happen until RAF, prove final pointerup flushes, and
   capture visual screenshots.

## Acceptance

- Pointermove no longer calls `resizePane()` synchronously.
- Drag still uses `renderPaneLayout()` as the single pane layout/ARIA writer.
- Pointerup/cancel persists the final rendered width, not a stale frame.
- Keyboard resize remains immediate and accessible.
- Focused unit tests, real browser test, typecheck, visual screenshots,
  self-review, commit, and push all pass.

## Verification

- `bun test packages/overlay/test/pane-config.test.ts packages/overlay/test/resize-observer-frame-scheduler.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/left-pane-resizer-browser.test.ts`
- `bun test packages/overlay/test/acceptance-panel-mount.test.ts --timeout 30000`

## Visual Review

- `.scratch/left-pane-resizer-accessibility.png`: desktop overlay remains coherent after keyboard and pointer resizing; left separator focus ring is visible, the Mission rail is narrowed, chat content stays aligned, and the right toolbar does not shift incorrectly.

## Self Review

- `onPaneResizeMove()` now only records the latest `clientX` and schedules the
  per-drag RAF; it does not call `resizePane()` synchronously.
- `flushPendingPaneResize()` still uses the existing `resizePane()` math and
  `renderPaneLayout()` renderer, so pane CSS variables and ARIA values keep one
  owner.
- `stopPaneResize()` cancels any scheduled frame and flushes the pending
  pointer position before persisting rendered widths.
- Keyboard resize is unchanged and remains immediate for accessibility.
- The browser probe dispatches 30 pointermove events in one task and proves no
  pane CSS/ARIA writes happen before RAF, then proves pointerup flushes the
  final pending width synchronously before persistence.
