# Popup Contrast Matrix Entrypoint CSS

Date: 2026-06-18

## Problem

The non-Select popup contrast browser matrix sampled executor popovers,
worktree panels, recent-directory menus, workspace launchers, titlebar menus,
and the Command Palette, but it loaded a hand-written subset of CSS files. That
subset did not match `packages/overlay/src/index.html`: for example `field.css`
was loaded before `composer.css` in the test while the real overlay loads it
later. A contrast matrix using a partial cascade can pass while the real
entrypoint would fail after a stylesheet-order regression.

## Recall

| Source | Relevant decision |
| --- | --- |
| `2026-06-18-popup-contrast-light-palette.md` | Popup readability must be verified by browser matrix coverage over shared popup surfaces, not by component-local color patches. |
| `2026-06-18-light-popup-active-state-contrast.md` | The non-Select popup matrix is the guard for active popup rows and workspace launcher menu labels. |
| `2026-06-18-popup-disabled-effective-contrast.md` | The same matrix must catch effective disabled opacity and contrast regressions on real popup panels. |
| `2026-06-18-expert-squad-unselected-option-contrast-guard.md` | The Select popup matrix already reads stylesheet order from `src/index.html`; non-Select popup coverage must use the same source. |

## Impact Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n 'overlayCss\\(|src/index.html|popup-contrast-matrix|select-popup-contrast-matrix' packages/overlay/test` | `select-popup-contrast-matrix.test.ts` reads `src/index.html`; `popup-contrast-matrix.test.ts` still hard-coded a CSS array. | Reuse the real entrypoint source in both matrices. |
| `packages/overlay/src/index.html` | Real CSS order includes `titlebar.css`, `composer.css`, `conversation.css`, many panel surfaces, then `field.css`, `dialog.css`, and `cmdk.css`. | Add order assertions for representative dependencies so future drift fails clearly. |
| `packages/overlay/test/browser/popup-contrast-matrix.test.ts` | The test already writes a screenshot and measures text contrast; no production CSS change is needed unless the real cascade exposes a failure. | Change only the test CSS source and static guard. |

## Fix

- Parse stylesheet hrefs from `packages/overlay/src/index.html`.
- Load popup matrix CSS using that exact order.
- Assert representative ordering relationships in the browser matrix.
- Add a static test that rejects returning to a hand-written partial CSS array
  in either popup matrix.

## Acceptance

- Non-Select popup contrast matrix uses the real overlay entrypoint cascade.
- Select and non-Select popup matrices share the same CSS-order source pattern.
- Browser matrix still passes and writes `popup-contrast-matrix.png` for visual
  review.
- No production CSS fallback or component-local color override is introduced.
