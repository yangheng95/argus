# Command Palette Active Descendant

Date: 2026-06-18

## Problem

`CommandPalette` already renders a search input, a visible command list, and
arrow-key active option state. The active option was exposed only through
`aria-selected` on the option and `.cmdk-item--active` for sighted users. The
focused input did not expose a combobox relationship to the list, so assistive
technology could not follow the active command while the operator navigated
with ArrowUp and ArrowDown.

This is not a second command source or a new command primitive problem. The
command palette's data source and Dialog shell are already single-source. The
missing contract is the ARIA active-descendant link between the focused input
and the rendered listbox.

## Evidence Sweep

| Search | Result | Decision |
| --- | --- | --- |
| `rg -n "CommandPalette|cmdk-input|cmdk-list|cmdk-item|aria-activedescendant" packages/overlay/src packages/overlay/test specs/new-arch` | `CommandPalette.tsx` has the only `cmdk-*` listbox surface; no existing `aria-activedescendant` relation exists. | Fix in `CommandPalette.tsx`. |
| `rg -n "command-palette" packages/overlay/test specs/new-arch` | Existing browser coverage opens the real overlay palette, verifies Dialog primitive DOM, hotkey focus, Escape close, focus restore, and screenshot. | Extend that browser test with active-descendant keyboard assertions. |
| `2026-06-18-command-palette-dialog-primitive.md` | The Dialog shell was already centralized; command list semantics were outside that scope. | Keep Dialog primitive unchanged. |

## Fix

- Give the search input stable `role="combobox"`, `aria-autocomplete="list"`,
  `aria-expanded`, `aria-controls`, and `aria-activedescendant`.
- Give the command listbox a stable id.
- Give every visible option a deterministic id based on its current index and
  command id, matching the input's active descendant.
- Keep existing keyboard navigation, filtering, visual classes, and command
  execution behavior unchanged.

## Acceptance

- Cmd/Ctrl+K opens the palette and focuses the combobox input.
- The input's `aria-controls` points to the live listbox.
- The input's `aria-activedescendant` points to the currently
  `aria-selected="true"` `.cmdk-item`.
- ArrowDown changes both the active descendant id and the selected option.
- Existing screenshot evidence for the open command palette remains valid.
