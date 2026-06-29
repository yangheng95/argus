# Dialog Drag Frame Owner

Date: 2026-06-23
Status: Verified

## Acronyms

- GUI: Graphical User Interface, the visible overlay surface.
- RAF: RequestAnimationFrame, the browser callback phase used for visual-frame work.
- UI: User Interface, visible controls and interaction surfaces.

## Task Definition

Remove synchronous layout reads from shared dialog header drag pointermove
events. Dialog drag must keep the legal overlay-shell clamp, but high-frequency
pointermove bursts must not read `.dialog-form` or `document.body` geometry or
write dialog offset during the input event task.

## Recall

| Source                                            | Constraint carried forward                                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Arendt read-only audit                            | Shared `Dialog.tsx` reads form/body rects and writes offset on every window `pointermove`.                                      |
| `2026-06-23-overlay-panel-legal-size-contract.md` | Dialog clamp must remain based on the legal overlay shell, not raw viewport dimensions.                                         |
| `2026-06-22-left-pane-drag-frame-coalescing.md`   | Pointer drag streams should retain the latest pointer value, coalesce on RAF, and flush on pointerup.                           |
| `dialog-primitive.test.ts`                        | Shared Dialog primitive is the only Kobalte dialog owner used by settings, image preview, log viewer, and other modal surfaces. |

## Call Point Inventory

| Surface              | Evidence                                                                                                  | Decision                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Clamp owner          | `Dialog.tsx#clampDialogOffset()` reads `.dialog-form` and `document.body` rects.                          | Keep the clamp owner but call it from the frame owner.                                    |
| Pointermove listener | `moveDialog()` currently calls `clampDialogOffset()` and `setDialogOffset()` directly.                    | Store the latest client position and schedule one RAF.                                    |
| Pointerup cleanup    | `finishDialogDrag()` calls `stopDragging()`.                                                              | Flush the pending point before removing listeners so the final drag position is not lost. |
| Static test          | `dialog-primitive.test.ts` pins the existing `window.addEventListener("pointermove", moveDialog)` string. | Update it to reject direct pointermove clamp/write and require RAF scheduling.            |
| Browser coverage     | `config-dialog-resizer.test.ts` already opens a real Settings dialog.                                     | Extend it to drag the shared dialog header with layout-read instrumentation.              |

## Root Cause

Previous legal-shell repairs changed the clamp source from raw viewport geometry
to `document.body`, but the drag timing remained event-owned. Every pointermove
therefore forced form/body geometry reads and a Solid offset write before the
browser could batch layout work.

## Fix Plan

1. Add pending dialog drag coordinates and a RAF id to `Dialog.tsx`.
2. Change `moveDialog()` to record the latest pointer coordinates and schedule
   a single `applyPendingDialogDrag()` frame.
3. Flush the pending drag frame from `stopDragging()` before listeners are
   removed.
4. Keep `clampDialogOffset()` and the legal shell clamp unchanged.
5. Extend static and browser tests to prove no layout reads happen inside a
   dialog pointermove burst and that the frame owner performs the clamp/write.

## Acceptance

- Pointermove bursts over a dialog header do not call `getBoundingClientRect()`
  for the dialog form or `document.body` during the input event task.
- The pending drag is applied once in RAF and still clamps to the legal overlay
  shell.
- Pointerup flushes the last pending pointer coordinate.
- Shared Dialog adoption and Kobalte semantics remain unchanged.
- No fallback clamp, alternate viewport source, second dialog implementation, or
  compatibility branch is introduced.

## Implementation

- `Dialog.tsx` now keeps a single pending dialog drag point and schedules
  `applyPendingDialogDrag()` through `requestAnimationFrame`.
- `moveDialog()` only records the latest pointer coordinates and prevents the
  browser's default drag selection; it no longer reads layout or writes offset.
- `stopDragging()` flushes the pending drag point before listener cleanup, so
  pointerup/pointercancel retain the final clamp.
- `clampDialogOffset()` still owns the legal overlay-shell form/body geometry
  clamp; only the timing owner changed.
- The real Settings dialog browser test now instruments `.dialog-form` and
  `document.body` rect reads during a 30-event header pointermove burst.

## Verification

- PASS: `bun test packages/overlay/test/dialog-primitive.test.ts packages/overlay/test/config-panel-sizing.test.ts --timeout 30000`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/config-dialog-resizer.test.ts`.

## Visual QA

- Reviewed `.scratch/config-dialog-resizer.png`; after sidebar resize and shared
  dialog drag, the Settings dialog remains inside the legal `1120px` frame with
  coherent sidebar, separator, content fields, footer overlay, and close button.

## Self Review

- Rechecked `Dialog.tsx`: `moveDialog()` contains no `getBoundingClientRect()`,
  `clampDialogOffset()`, or `setDialogOffset()` call.
- Rechecked browser probe output through the passing assertion: pointermove
  burst layout reads are empty, while the RAF pass reads form/body once each.
- Rechecked shared primitive adoption: Kobalte Dialog ownership and existing
  Dialog callers are unchanged.
