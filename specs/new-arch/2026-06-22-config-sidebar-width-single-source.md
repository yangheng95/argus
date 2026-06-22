# Config Sidebar Width Single Source

Date: 2026-06-22
Status: Verified

## Acronyms

- GUI: Graphical User Interface, the browser-rendered overlay surface.
- UI: User Interface, visible controls and layout surfaces.
- ARIA: Accessible Rich Internet Applications, the browser accessibility attributes used by the settings sidebar separator.

## Task Definition

Prevent illegal settings dialog sidebar widths by making persisted width,
rendered CSS width, and separator ARIA value share one clamped width source.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback, no duplicate source, recall before edits, test every change, visually verify UI changes, commit and push every round. |
| `2026-06-15-config-dialog-resizer-accessibility.md` | `setConfigSidebarWidth` is the single persistence/update path; pointer and keyboard resizing must share clamp bounds. |
| Independent GUI audit 2026-06-22 | `sidebarStyle` rendered raw `dialogStore.config.sidebarWidth`, while `aria-valuenow` used a clamped `currentSidebarWidth()`. |
| User constraint 2026-06-22 | Illegal aspect ratios and illegal panel sizes are not allowed. |

## Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| Width writer | `services/dialog.ts#setConfigSidebarWidth` only rejected non-positive values and wrote any positive finite number. | Clamp through `clampConfigSidebarWidth(width, configSidebarResizeBounds(currentUIScale()))` before writing the store. |
| Rendered style | `ConfigDialogHost.sidebarStyle` used raw `dialogStore.config.sidebarWidth`. | Introduce `configuredSidebarWidth` as the clamped memo and render style from it. |
| ARIA value | `ConfigDialogHost.currentSidebarWidth()` already clamped store values and DOM fallback values. | Reuse `configuredSidebarWidth` so ARIA and style cannot diverge. |
| Pointer drag | `ConfigDialogHost` already clamps pointer movement before calling `setConfigSidebarWidth`. | Keep behavior; service clamp is the single write guard. |
| Keyboard resize | `nextConfigSidebarKeyboardWidth()` already clamps. | Keep behavior; service clamp is the single write guard. |
| Tests | `config-panel-sizing.test.ts` covers helper math and static ARIA semantics; `config-dialog-resizer.test.ts` covers real keyboard resize. | Add a static contract that writer, style, and ARIA all use the clamped source. |

## Root Cause

The settings dialog had two width interpretations. The visual sidebar style
trusted the store value, while the separator's ARIA value clamped the same
store value before exposing it. Any direct call to `setConfigSidebarWidth()` or
hydrated invalid store value could therefore render an illegal sidebar width
while assistive semantics reported a legal width.

## Fix Plan

1. Clamp `setConfigSidebarWidth()` at the single writer path using the same
   helper and current UI scale as the component.
2. Add `configuredSidebarWidth` in `ConfigDialogHost` and use it for both style
   and `currentSidebarWidth()`.
3. Keep pointer and keyboard resize helpers unchanged.
4. Extend `config-panel-sizing.test.ts` to pin the single clamped width source.
5. Run focused config tests, browser resizer test, typecheck, and screenshot
   visual review.

## Acceptance

- `setConfigSidebarWidth()` cannot write a positive width outside current
  min/max bounds.
- `configSidebar` style and `configResizer[aria-valuenow]` read the same
  clamped source.
- Pointer and keyboard resizing remain accessible and bounded.
- No fallback width path, second bounds source, or compatibility branch is
  introduced.

## Implementation

| Change | Reason |
| --- | --- |
| Moved config sidebar resize helpers to `src/utils/config-sidebar-resizer.ts`. | The service writer and Solid component both need the helper; keeping it under `components/` would create a service-to-component dependency. |
| `setConfigSidebarWidth()` clamps through `configSidebarResizeBounds(currentUIScale())` before writing `dialogStore.config.sidebarWidth`. | The single writer path can no longer persist illegal positive widths. |
| `ConfigDialogHost` added `configuredSidebarWidth`. | Sidebar style and `aria-valuenow` now read the same clamped memo. |
| Browser fixture now serves `/config/prompt-profile` and asserts there are no alert toasts. | Visual settings-dialog acceptance should not hide fixture errors under the dialog. |
| Browser resizer test saves `.scratch/config-dialog-resizer.png`. | Keeps visual evidence attached to the settings dialog surface. |

## Verification

- `bun test packages/overlay/test/config-panel-sizing.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/config-dialog-resizer.test.ts`
- Visual QA: viewed `.scratch/config-dialog-resizer.png`; the settings dialog
  sidebar, separator, content fields, and footer background are visually
  coherent, and no error toast is present.

## Self Review

- Rechecked `rg` for the old helper path; only `../utils/config-sidebar-resizer`
  remains in source and tests.
- Rechecked `setConfigSidebarWidth`; it rejects non-positive values and clamps
  positive finite values through the current UI scale before writing.
- Rechecked `ConfigDialogHost`; `sidebarStyle()` and `currentSidebarWidth()`
  share `configuredSidebarWidth()`.
- No fallback width or second bounds source was introduced.
