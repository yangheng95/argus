# Window Control Danger Foreground

Date: 2026-06-20

CSS means Cascading Style Sheets. GUI means Graphical User Interface. UI means
User Interface.

## Problem

Independent GUI review found the titlebar close button uses
`--oc-button-color: var(--surface)` for the danger window-control hover and
keyboard focus-visible state. `--surface` is a background token, not an
on-danger foreground token. In light theme the danger hover background mixes
`--bad` with `--surface`, making the close glyph fail the 3:1 UI icon contrast
threshold when the foreground also comes from `--surface`.

## Recall

| Source | Existing decision |
| --- | --- |
| `2026-06-19-solid-button-foreground-contrast.md` | Solid Button danger foregrounds already use theme-owned `--text-on-danger` instead of `--surface`. |
| `packages/overlay/src/components/ui/Button.tsx` | Button owns operation-button semantics and visual states. |
| `packages/overlay/src/components/WindowControls.tsx` | The close control already uses `Button variant="ghost" size="icon" tone="danger" data-chrome="window-control"`. |
| `packages/overlay/src/styles/cascade/*.css` | All themes already define `--text-on-danger`. |

## Impact Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n -- '--oc-button-color:\s*var\(--surface\)|data-chrome="window-control"|text-on-danger|window-control|btnClose|tone="danger"' packages/overlay/src packages/overlay/test specs/new-arch` | The only live `--surface` foreground owner in this path is `button.css` for danger window-control hover/focus; `WindowControls` is already using the shared Button primitive. | Fix the primitive CSS rule, not the component caller. |
| `packages/overlay/test/window-control-visibility.test.ts` | Static coverage incorrectly locks `--surface` as the expected hover/focus foreground. | Invert the guard to require `--text-on-danger` and reject `--surface`. |
| `packages/overlay/test/browser/button-solid-contrast-browser.test.ts` | Browser contrast matrix covers solid buttons but not titlebar danger window controls. | Extend the matrix with a window close control sample and screenshots for focus and hover. |

## Fix

- Retarget danger window-control hover/focus foreground to
  `--text-on-danger`.
- Keep the existing danger hover background and the quiet resting window-control
  chrome.
- Keep `WindowControls.tsx` unchanged because it already consumes the Button
  primitive correctly.
- Extend browser contrast coverage to verify normal, hover, and focus-visible
  states across `light`, `dark`, and `vscode-dark`.

## Acceptance

- Static tests reject `--oc-button-color: var(--surface)` in the danger
  window-control hover/focus rule.
- Real browser contrast coverage verifies the close control stays at least 3:1
  in normal, hover, and focus-visible states.
- Screenshots under `.scratch/button-window-close-contrast-*-focus.png` and
  `.scratch/button-window-close-contrast-*-hover.png` show the real rendered
  states.
