# Popup Contrast Light Palette

Date: 2026-06-18

## Report

The Expert Squad selector was reported as showing unreadable unselected options
on a white background. Current source and bundle evidence show that Expert
Squad itself already uses Kobalte Select and the shared `.oc-select-*` popup
contract, but the report exposed a broader testing gap: non-Select popup-like
surfaces still used low-contrast light-theme secondary and warning tokens on
opaque white panels.

## Recall

| Source                                                   | Existing decision                                                                                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-17-prompt-profile-selector-select-primitive.md` | The Expert Squad picker must not use a hidden native `<select>` plus visual chrome. It delegates option rendering to Kobalte Select.                    |
| `2026-06-17-expert-squad-select-readability-impact.md`   | Shared `.oc-select-*` popup styling is the single source for Select popup readability.                                                                  |
| `2026-06-18-select-popup-readability-impact-review.md`   | The Select matrix covers Expert Squad, Agent Models, Settings, AppDialog, Browser Preview, and Log Level, but does not cover non-Select popup families. |
| `2026-06-18-command-palette-activedescendant.md`         | Command Palette has its own hand-written combobox/listbox surface, so it requires its own visual coverage if kept outside Select.                       |

## Impact Sweep

| Sweep                                                                              | Result                                                                                             | Decision                                                        |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `rg -n -F "<select" packages/overlay/src packages/overlay/test specs/new-arch`     | No active overlay component renders a native prompt-profile `<select>` or `<option>`.              | Do not reintroduce native select-specific CSS.                  |
| `rg -n -F "Select.Root" packages/overlay/src packages/overlay/test specs/new-arch` | Kobalte Select users are Expert Squad, LogViewer, BrowserPreview, AppDialog, and `SettingsSelect`. | Keep the existing Select contrast matrix.                       |
| `rg -n "executor-popover                                                           | project-worktree-panel                                                                             | recent-dir-panel                                                | titlebar-menubar-panel | cmdk-panel" packages/overlay/src packages/overlay/test` | Executor popover, worktree panel, recent directory panel, titlebar menus, and Command Palette are popup/dropdown-like surfaces outside `.oc-select-*`. | Add a separate popup contrast matrix for these families. |
| Light palette token contrast calculation                                           | `--text-muted` on white was about 3.02:1; `--warn` on white was about 2.96:1.                      | Fix the light palette source instead of local component colors. |

## Fix

- Keep Expert Squad on Kobalte Select and the `.oc-select-*` popup source.
- Add a browser `popup-contrast-matrix` that loads real overlay CSS and
  renders representative light-theme popup surfaces for:
  - executor popover;
  - worktree panel;
  - recent directory panel;
  - titlebar menu;
  - Command Palette.
- Adjust light-theme semantic text tokens so popup secondary and warning text
  remain readable on opaque white popup backgrounds:
  - `--text-soft`;
  - `--text-muted`;
  - `--warn`;
  - `--warn-dim`.
- Attach the Expert Squad option copy wrapper to the shared
  `.oc-select-option-copy` layout class while keeping its local sizing class.

## Acceptance

- The Expert Squad real browser selector test remains green and visually
  readable.
- The shared Select contrast matrix remains green.
- The non-Select popup matrix verifies every sampled visible text node has an
  opaque composited surface and at least 4.5:1 contrast.
- Static palette coverage prevents light popup `--text-soft`, `--text-muted`,
  and `--warn` from regressing below 4.5:1.
- No component-local color override is added to `.prompt-profile-select-*`.
