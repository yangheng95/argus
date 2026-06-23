# Select Popup Opaque Surface

Date: 2026-06-17

## Problem

Expert Squad and settings dropdowns render their listbox through the shared
Kobalte Select popup classes. The option text uses readable foreground tokens,
but `.oc-select-content` uses `background: var(--surface)`. In the light theme,
`--surface` is intentionally translucent (`rgba(255, 255, 255, 0.82)`), so
text and controls underneath the popup bleed through. When the popup overlaps a
field, unselected options can visually merge with the underlying field copy.

This is not a single component color bug. A component-local patch would leave
the same issue in other Select users and violate the shared `.oc-select-*`
contract.

## Evidence Sweep

| Search                                                                | Result                                                                                           | Decision                                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `rg -n "oc-select-content                                             | oc-select-option                                                                                 | Select\\.Root" packages/overlay/src packages/overlay/test specs/new-arch`       | Expert Squad, Agent Models, Skills/MCP, Log Viewer, App Dialog, and Browser Preview all share `.oc-select-content` / `.oc-select-option`.          | Fix the shared Select popup surface.            |
| `rg -n -- "--surface\\s\*:                                            | --menu-panel-bg                                                                                  | --dialog-bg" packages/overlay/src/styles/cascade packages/overlay/test`         | `--surface` is translucent in all themes; `--menu-panel-bg` is the existing opaque popup/menu token and is already pinned by palette intent tests. | Use `--menu-panel-bg` for Select popup content. |
| Visual script `.scratch/settings-select-primitive-screenshot.test.ts` | Light theme Skill/MCP dropdown screenshots show underlying input placeholders through the popup. | Add tests that reject translucent Select popup backgrounds, then re-screenshot. |

## Fix

- Change `.oc-select-content` from `background: var(--surface)` to
  `background: var(--menu-panel-bg)`.
- Keep foreground on `.oc-select-content` and `.oc-select-option` as
  `var(--text-strong)`.
- Extend static theme coverage to pin the opaque popup token.
- Extend the Expert Squad browser test so the light popup background must be
  fully opaque, not merely high-contrast in computed text color.

## Acceptance

- Expert Squad popup on light theme shows all unselected options over an
  opaque white popup surface.
- Skill/MCP and Agent Models Select popups use the same opaque surface.
- No component-specific Select background overrides are introduced.
- Static tests and browser tests pass.
- Manual screenshot review confirms no underlay text bleeds through Select
  popups.
