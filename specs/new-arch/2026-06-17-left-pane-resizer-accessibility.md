# Left Pane Resizer Accessibility

Date: 2026-06-17

## Problem

The default workspace left pane boundary is a real DOM separator, but it is
still pointer-only. `#leftPaneResizer` has `role="separator"` and
`aria-orientation="vertical"` in `index.html`, while `services/pane.ts`
attaches only `pointerdown` listeners. Keyboard users cannot focus or resize
the boundary, and assistive technologies do not receive controlled panel IDs or
current width values.

## Call Points

| Surface | File | Decision |
| --- | --- | --- |
| Default pane config | `packages/overlay/src/services/pane.ts` `PANEL_PANE_CONFIG` | Keep pane resize behavior in the shared pane service. Add controlled element IDs to the config so ARIA ownership is not hardcoded in `main.tsx`. |
| Left separator DOM | `packages/overlay/src/index.html` `leftPaneResizer` | Keep the real separator element. Add initial `tabindex`, `aria-controls`, and value attributes that the service refreshes after mount. |
| Reactive layout render | `packages/overlay/src/main.tsx` `renderPaneLayout(...)` effect | Continue to call the pane service as the single width renderer; do not add a second ARIA writer in `main.tsx`. |
| Pointer resize | `packages/overlay/src/services/pane.ts` `startPaneResize` | Preserve the existing pointer path. |
| Keyboard resize | `packages/overlay/src/services/pane.ts` new key handler | ArrowLeft/ArrowRight resize by the same clamp math as pointer drag; Home/End move to min/max. |
| Disabled/mobile state | `packages/overlay/src/services/pane.ts`, `workspace.css` | Hidden or zero-width handles are removed from tab order and expose no stale ARIA value attributes. Mobile CSS already hides pane handles. |
| Static tests | `packages/overlay/test/pane-config.test.ts`, `acceptance-panel-mount.test.ts` | Pin config controls, separator ARIA, and keydown ownership. |
| Browser test | `packages/overlay/test/browser/left-pane-resizer-browser.test.ts` | Open the real overlay, focus the separator, exercise Arrow/Home/End, and inspect screenshot. |

## Design

- `PaneConfig` owns the controlled panel IDs for each handle. The default left
  handle controls the adjacent `sidebar` and `workspaceMain` regions.
- `renderPaneLayout()` refreshes both CSS widths and handle semantics so every
  caller gets the same separator state.
- Enabled handles expose `tabIndex=0`, `aria-controls`, `aria-valuemin`,
  `aria-valuemax`, and `aria-valuenow`.
- Disabled or hidden handles expose `tabIndex=-1` and remove value attributes.
- Keyboard and pointer resizing share the same bounds and width update helper,
  then persist through the existing `onWidthsChanged` callback.
- `aria-valuemax` is the actual width reachable by moving that one handle under
  the existing `resolvedPaneWidths()` layout algorithm, not a theoretical max
  that would require simultaneously resizing another pane.
- Because `resolvedPaneWidths()` clamps persisted targets into rendered widths,
  the max calculation uses that same resolver until the target and rendered
  width converge. This keeps End key behavior, persisted width, and
  `aria-valuemax` aligned.

## Verification

- `bun test packages/overlay/test/pane-config.test.ts packages/overlay/test/acceptance-panel-mount.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `node packages\overlay\test\browser-runner.mjs packages\overlay\test\browser\left-pane-resizer-browser.test.ts`
- Manual visual review of `.scratch/left-pane-resizer-accessibility.png`
