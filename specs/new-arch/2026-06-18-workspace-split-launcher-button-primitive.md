# Workspace Split Launcher Button Primitive

Date: 2026-06-18

## Problem

`WorkspaceSplitLauncher` delegates menu behavior to Kobalte `DropdownMenu`, but
its visible split-button triggers still rendered local `<button>` elements with
`workspace-split-launcher-primary` and `workspace-split-launcher-menu-button`
classes. `conversation.css` duplicated button display, dimensions, hover,
disabled, and focus states.

That leaves terminal/editor/coding launcher controls outside the shared
`Button` primitive even though they are ordinary visible operation buttons. The
local focus-visible rule also set `outline: none`, so keyboard focus did not
use the shared `Button` focus ring.

## Evidence Sweep

| Search                                                 | Result                                                                               | Decision                                                                                                                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `rg -n "WorkspaceSplitLauncher                         | workspace-split-launcher" packages/overlay/src packages/overlay/test specs/new-arch` | Three call sites use the launcher: terminal, editor, and coding CLI. Historical Kobalte migration preserved local class hooks but did not route visible triggers through `Button`. | Keep Kobalte menu ownership, replace visible trigger chrome with `Button`. |
| `rg -n "<button\\b                                     | <Button\\b                                                                           | DropdownMenu\\.Trigger                                                                                                                                                             | as=\\{Button\\}" packages/overlay/src/components -g "\*.tsx"`              | `ProjectWorktreeDropdown` already proves `DropdownMenu.Trigger as={Button}` works locally. `WorkspaceSplitLauncher` still used local trigger buttons. | Follow the existing Kobalte + `Button` pattern.                              |
| `rg -n "workspace-terminal-open                        | workspace-editor-open-default                                                        | workspace-coding-cli-open-default                                                                                                                                                  | workspace-.\*-menu" packages/overlay/src packages/overlay/test`            | Browser tests and call sites already rely on stable `data-ui` selectors.                                                                              | Retarget CSS to `.oc-button[data-ui=...]`; no new public selector is needed. |
| `rg -n "workspace-split-launcher-primary:focus-visible | workspace-split-launcher-menu-button:focus-visible" packages/overlay/src/styles`     | Focus-visible explicitly removed outline.                                                                                                                                          | Let `.oc-button:focus-visible` own the visible ring.                       |

## Fix

- Import `Button` in `WorkspaceSplitLauncher`.
- Render the primary action through `<Button variant="ghost" size="icon" tone="neutral">`.
- Render the menu trigger through `DropdownMenu.Trigger as={Button}`.
- Remove `primaryClass` and `menuButtonClass` from the launcher API and call sites.
- Retarget workspace launcher CSS from local button classes to the existing
  `data-chrome` split-button selectors while preserving public `data-ui`
  selectors for browser tests and commands.

## Acceptance

- `WorkspaceSplitLauncher.tsx` contains no local trigger `<button>`.
- Terminal, editor, and coding CLI launcher triggers render with `.oc-button`.
- Focus-visible uses the shared `Button` outline instead of local `outline: none`.
- Existing menu positioning, launch behavior, and popup contrast coverage remain green.
