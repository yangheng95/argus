# Config dialog resizer accessibility

## Problem

The config dialog sidebar resizer is a pointer-only `div`. Keyboard users cannot
resize the settings navigation pane, and assistive technologies do not receive
separator semantics or current width values.

## Call-point Sweep

| Call point | Decision |
| --- | --- |
| `ConfigDialogHost.tsx` pointer drag | Keep existing pointer behavior, but route width clamping through shared helpers. |
| `ConfigDialogHost.tsx` resizer element | Add `role="separator"`, `aria-orientation`, `aria-controls`, `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, `tabIndex`, title, and keyboard handling. |
| `services/dialog.ts` | Keep `setConfigSidebarWidth` as the single persistence/update path. |
| `config-panel-sizing.test.ts` | Add structural and helper tests proving keyboard resize and ARIA semantics exist. |

## Design

Keyboard behavior:

- `ArrowLeft` decreases width by one step.
- `ArrowRight` increases width by one step.
- `Home` sets the minimum width.
- `End` sets the maximum width.

All values are clamped with the same min/max bounds as pointer resizing.

## Verification

- Unit/static tests for ARIA attributes, keyboard handlers, and helper math.
- Existing overlay typecheck.
