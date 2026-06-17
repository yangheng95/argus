# Dialog Header Drag Kobalte Regression

Date: 2026-06-18

## Problem

`Dialog` was migrated to `@kobalte/core/dialog`, but the shared primitive no
longer preserved header drag behavior. The existing browser test for the
settings dialog exposed the regression:

`providers panel renders stable height and equal same-row buttons` failed
because dragging `#configDialog .dialog-header` did not move the dialog.

This contradicted the mature primitive plan's phase-1 constraint: keep Kobalte
dialog semantics while preserving draggable dialog support.

## Evidence Sweep

| Source | Result | Decision |
| --- | --- | --- |
| `specs/new-arch/2026-06-01-overlay-mature-ui-primitives-refactor.md` | Dialog migration explicitly says not to remove draggable dialog support. | Restore drag in the primitive, not per dialog callsite. |
| `packages/overlay/test/browser/config-panel-sizing.test.ts` | Header drag assertion failed after Kobalte migration. | Keep this as browser acceptance. |
| `git show fc1eac9df3:packages/overlay/src/components/primitives/Dialog.tsx` | Historical native-dialog primitive had a viewport-clamped header offset implementation. | Reuse the offset model without reintroducing native `<dialog>`. |

## Fix

- Keep `KobalteDialogRoot`, `KobalteDialogContent`, and `KobalteDialogTitle` as
  the single semantic dialog owner.
- Add `draggable?: boolean` to `Dialog`, defaulting to enabled.
- Apply header pointer drag to the `.dialog-form` through
  `--dialog-drag-x` / `--dialog-drag-y` inline custom properties.
- Clamp the offset inside the viewport.
- Ignore interactive descendants inside the header so buttons and fields do
  not start a drag.
- Update the dialog primitive guard to reject native dialog APIs while
  requiring the preserved header drag behavior.

## Acceptance

- `Dialog` still does not render native `<dialog>` or call `showModal()`.
- Browser settings dialog drag moves and clamps the dialog.
- `dialog-primitive.test.ts`, overlay typecheck, and the config panel browser
  test pass.
