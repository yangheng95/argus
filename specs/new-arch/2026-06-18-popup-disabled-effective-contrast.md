# Popup Disabled Effective Contrast

Date: 2026-06-18

CSS means Cascading Style Sheets.

## Problem

The light popup contrast matrix covered visible popup text colors, but disabled
popup/menu rows still reduced whole controls with `opacity`. On a white popup
panel, `--text-muted` and `--text-soft` are readable by themselves; multiplying
them by disabled opacity makes the effective rendered text unreadable.

This is the same class of visual defect as the Expert Squad white-background
readability report, but it affects disabled menu and popup states rather than
unselected Select options.

## Recall

| Source                                            | Existing decision                                                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `2026-06-18-popup-contrast-light-palette.md`      | Popup readability belongs to shared popup surfaces and light-theme tokens, not local component color patches. |
| `2026-06-18-light-popup-active-state-contrast.md` | Popup contrast tests must include stateful rows, not only resting popup copy.                                 |
| `2026-06-17-select-popup-opaque-surface.md`       | Popup surfaces must be opaque so readable foreground tokens are not blended with underlay text.               |

## Impact Sweep

| Sweep                                                         | Result                                                                                                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rg -n "titlebar-menubar-item:disabled                        | executor-popover-model:disabled                                                                                                        | project-worktree-remove:disabled | recent-dir-edit-submit:disabled" packages/overlay/src/styles/surfaces packages/overlay/test` | Disabled titlebar menu items, executor models, worktree remove buttons, and recent-directory submit buttons used whole-element opacity or lacked effective-opacity coverage. |
| `packages/overlay/test/browser/popup-contrast-matrix.test.ts` | The matrix sampled popup text colors, but did not include disabled controls or multiply ancestor opacity into the measured foreground. |

## Fix

- Remove whole-element disabled opacity from popup/menu disabled controls.
- Keep disabled rows visually inert through cursor and explicit readable muted
  foreground tokens.
- Extend the popup contrast matrix with disabled samples and effective
  foreground compositing that multiplies ancestor opacity.

## Acceptance

- Disabled popup/menu text on light opaque panels keeps at least 4.5:1 effective
  contrast.
- The popup contrast matrix fails if a future disabled state uses opacity to
  make text unreadable.
- No fallback or component-local alternate popup source is introduced.
