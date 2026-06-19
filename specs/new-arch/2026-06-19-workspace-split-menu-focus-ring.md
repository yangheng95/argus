# Workspace Split Menu Focus Ring

Date: 2026-06-19

CSS means Cascading Style Sheets. DOM means Document Object Model.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `AGENTS.md` | GUI fixes require real browser verification and screenshot review; keyboard focus must remain visible. |
| `2026-06-01-overlay-mature-ui-primitives-refactor.md` | Workspace split launchers were migrated to Kobalte `DropdownMenu` primitives; item focus is runtime-owned by the menu item button. |
| `2026-06-19-kobalte-selected-state-single-source.md` | Kobalte runtime states such as `[data-highlighted]` must be treated as the source for roving menu focus, not replaced with hand-rolled state. |
| `pane-collapse-layout.test.ts` | Existing browser coverage already opens the real workspace editor menu and can verify focused menu item geometry. |

## Evidence Sweep

| Target | Result | Decision |
| --- | --- | --- |
| `WorkspaceSplitLauncher.tsx` | `WorkspaceSplitLauncherItem` renders `DropdownMenu.Item as="button"`, so menu options are keyboard-focusable controls. | Keep the primitive; fix the visual focus contract. |
| `conversation.css` | `.workspace-terminal-option:focus-visible`, `.workspace-editor-option:focus-visible`, and `.workspace-coding-cli-option:focus-visible` are merged with hover/highlight and only set `outline: none`. | Split `:focus-visible` into its own rule and add a tokenized inset ring. |
| Browser coverage | The existing pane-collapse browser test opens the editor menu but only checks placement and icons. | Extend it to keyboard-focus an option, assert `:focus-visible`, non-empty `box-shadow`, and save a screenshot. |

## Fix

- Preserve hover and Kobalte `[data-highlighted]` background behavior.
- Add an explicit `:focus-visible` rule for all three workspace split menu option classes.
- Use a tokenized inset `box-shadow` focus ring so the keyboard state is distinct from pointer hover.
- Extend the real browser test for workspace editor menu focus and screenshot evidence.

## Acceptance

- Keyboard focus on a workspace split menu item has `:focus-visible`.
- The focused item has a non-empty `box-shadow` focus ring and visible background.
- Browser screenshot `.scratch/workspace-split-launcher-menu-item-focus.png` shows the focused editor menu row.
