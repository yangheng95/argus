# Left Pane Resizer Browser Max Contract

Date: 2026-06-18

## Problem

The titlebar browser shell test used a fixed assertion that the rendered
`.sidebar` width must be greater than 600px after dragging `#leftPaneResizer`.
In the same fixture, the pane service computed the reachable separator maximum
as 600px, while `getBoundingClientRect()` reported the rendered sidebar as
599px because of flex/grid rounding. The pointer drag worked and the width was
at the service maximum, but the benchmark demanded a value above the maximum.

This made the browser test a misleading tool failure rather than product
evidence.

## Recall

| Source                                          | Existing decision                                                                                                    |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `2026-06-17-left-pane-resizer-accessibility.md` | `aria-valuemax` is the actual width reachable by one handle under `resolvedPaneWidths()`, not a theoretical maximum. |
| `packages/overlay/src/services/pane.ts`         | Pointer and keyboard resizing share `paneResizeBounds()` and `resolvedPaneWidths()`.                                 |

## Fix

Keep the pointer drag path in the real browser test, but assert against the
separator's live maximum:

- record the initial sidebar width before drag;
- require the drag to widen the sidebar by more than 200px;
- require the rendered width to land within 2px of `aria-valuemax`;
- require `aria-valuenow` to land within 1px of `aria-valuemax`.

This preserves the broad-width contract without hardcoding a value above the
service's own reachable maximum.

## Acceptance

- `titlebar-menubar.test.ts` still uses real mouse drag on `#leftPaneResizer`.
- The test proves the pane reaches the service-advertised maximum.
- The test no longer encodes an impossible `> 600px` threshold.
