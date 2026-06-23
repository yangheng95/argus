# Connection Badge Button Diagnostics

Date: 2026-06-19

UI means User Interface. PRD means Product Requirements Document.

## Problem

Independent GUI review found `ConnectionBadge` is documented as a clickable
connection status badge, but it renders a non-focusable `<span>` with only an
`onDblClick` restart handler. The titlebar CSS also defines
`.conn-badge:focus-visible`, but the element cannot normally receive focus and
that rule suppresses the outline.

This violates the PRD requirement that `ConnectionBadge` has a keyboard path
and regression test. It also leaves a hidden server restart action behind a
mouse-only double-click gesture.

## Recall

| Source                                                 | Relevant constraint                                                                                                                                                                                       |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-03-overlay-workbench-page-prd.md`             | `COMPONENT-002 ConnectionBadge` must have visible state, keyboard path, API/store source, and regression test. `SURFACE-003` says the badge represents server connection and exposes restart diagnostics. |
| `packages/overlay/src/components/ConnectionBanner.tsx` | The existing offline connection surface uses the shared `Button` primitive and opens the general configuration diagnostics action.                                                                        |
| `packages/overlay/src/components/ui/Button.tsx`        | `Button` is the canonical owner for real overlay buttons and now supports composing a surface class with `.oc-button`.                                                                                    |
| `packages/overlay/src/styles/primitives/button.css`    | Keyboard focus should come from `.oc-button:focus-visible`; surface CSS should not suppress it.                                                                                                           |

## Impact Sweep

| Sweep                   | Result                | Decision                                                                           |
| ----------------------- | --------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `rg -n "ConnectionBadge | conn-badge            | connection badge                                                                   | handleRestart                                                                                                                                                              | solidConnBadge                                                                             | onDblClick" packages/overlay/src packages/overlay/test specs/new-arch` | `App.tsx` mounts `ConnectionBadge` once into `#solidConnBadge`. `ConnectionBadge.tsx` owns the hidden double-click restart. `titlebar.css` owns the visual style. Existing tests only assert mount/status, not keyboard semantics. | Fix the single owner and add source/browser coverage. |
| `rg -n "restart         | apiJson\\(\"restart\" | connection_diagnostics" packages/overlay/src packages/overlay/test specs/new-arch` | `/restart` is not covered as a visible badge contract. `titlebar.connection_diagnostics` already exists and `ConnectionBanner` uses it for the explicit connection action. | Convert the badge action to diagnostics instead of preserving hidden double-click restart. |
| `rg -n "connBadge       | conn-badge            | ConnectionBadge                                                                    | keyboard                                                                                                                                                                   | focusVisible                                                                               | tab                                                                    | role                                                                                                                                                                                                                               | primitive                                             | Button" packages/overlay/test` | Current tests do not pin button semantics, tab focus, or primitive reuse. | Add static primitive guards and a Node browser test with screenshot evidence. |

## Fix Plan

- Replace the `span` root with `Button`.
- Use `data-ui="connection-badge"` and keep `id="connBadge"` for existing
  status selectors.
- On click/keyboard activation, open the existing general configuration
  diagnostics surface.
- Remove the hidden `/restart` double-click code path from this badge.
- Keep status text, title detail, port, PID, and `aria-live`.
- Move `.conn-badge` styling onto `.oc-button[data-ui="connection-badge"]`
  and preserve token-derived colors through `--oc-button-*` variables.
- Remove the unreachable focus rule that set `outline: none`.

## Acceptance

- `ConnectionBadge` renders a native button via the shared `Button` primitive.
- The badge is focusable and keyboard activation opens the diagnostics dialog.
- The connection status text and `data-status` remain unchanged.
- `.conn-badge` no longer suppresses the shared Button focus ring.
- Browser screenshot confirms the titlebar utility cluster remains visually
  coherent after the primitive migration.
