# File Explorer Button Primitive Visual Regression

Date: 2026-06-22

## Problem

The File Explorer regressed visually after the rows moved from bare buttons to
the shared `Button` primitive. The user-visible symptoms are oversized file and
folder icons, heavy row text, and a less dense file-manager feel.

The regression starts with commit `424d932543` (`fix: share file explorer row
sizing`, 2026-06-20 07:33:13 +0800). That commit correctly centralized row
height and kept the shared Button primitive, but it missed two inherited Button
primitive defaults:

- `.oc-button > svg` sizes direct child SVG icons to `--oc-density-chip-height`.
- `.oc-button` sets `font-weight: var(--ui-font-weight-strong)`.

File Explorer rows need the Button primitive behavior and accessibility, but
their visual hierarchy is a dense file list, not a toolbar button group.

## Recall

| Source | Constraint |
| --- | --- |
| `2026-06-01-overlay-file-explorer-editor.md` | Explorer rows are flat, dense, and icon-led. No nested cards. |
| `2026-06-18-file-explorer-row-button-semantics.md` | Rows are command buttons, not an incomplete ARIA tree widget. |
| `2026-06-20-file-explorer-row-focus-visible.md` | Keep independent keyboard focus outline. |
| `2026-06-20-file-explorer-row-button-size-source.md` | Rows must keep using `Button`; row geometry source stays in `FileExplorerPanel.tsx`. |

## Impact Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n "file-explorer-row|oc-button > svg|font-weight" packages/overlay/src packages/overlay/test` | Production owner is `inspector.css`; global Button icon and font-weight rules are the inherited source. | Override only `.file-explorer-row`, not the primitive. |
| `git show 424d932543 -- FileExplorerPanel.tsx inspector.css` | The migration introduced `<Button>` rows and CSS variables but no row-local SVG/font overrides. | Add missing visual isolation. |
| `file-explorer-accessibility.test.ts` | Browser fixture already opens Explorer in an isolated page and records screenshots. | Extend it to assert row icon width and body font weight. |

## Implementation

1. Keep `FileExplorerPanel` row markup on `Button`.
2. Add row-local `font-weight: var(--ui-font-weight-body)`.
3. Add `.file-explorer-row > svg` sizing based on
   `--file-explorer-row-icon-width`, overriding the global Button icon size.
4. Preserve current row height, virtualizer item size, focus ring, ARIA current,
   and lazy loading behavior.

## Acceptance

- Row direct SVG icons render at the Explorer row icon width, not the global
  Button chip height.
- Row text uses body weight, not strong Button weight.
- Existing row geometry and accessibility tests still pass.
- Dark-theme browser evidence is captured from an isolated test page; no running user
  OpenCorvus / overlay process is restarted, closed, or refreshed.
