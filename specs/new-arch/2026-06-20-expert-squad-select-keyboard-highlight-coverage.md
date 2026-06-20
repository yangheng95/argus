# Expert Squad Select Keyboard Highlight Coverage

Date: 2026-06-20

## Report

Independent GUI review found no current source defect for the reported
white-popup Expert Squad option readability issue. The remaining coverage gap
is that the real browser test proves hover-highlighted readability, but not
the keyboard ArrowDown path that Kobalte Select exposes for listbox navigation.

## Recall

| Source | Relevant decision |
| --- | --- |
| `2026-06-17-expert-squad-select-readability-impact.md` | Expert Squad must use Kobalte Select and shared `.oc-select-*` styling. |
| `2026-06-18-popup-contrast-light-palette.md` | Select popup readability belongs to the shared popup contract, not local color overrides. |
| `2026-06-20-expert-squad-zh-select-readability-coverage.md` | English and Chinese runtime Expert Squad screenshots are the direct evidence for the user-reported surface. |

## Impact Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n "prompt-profile-selector|prompt-profile-select-option|ArrowDown|data-highlighted" packages/overlay/test/browser/prompt-profile-selector-browser.test.ts packages/overlay/src/components` | The real Expert Squad browser test already opens the live selector and asserts `data-highlighted` after hover. No keyboard path exists. | Extend this test instead of creating a second selector fixture. |
| `packages/overlay/src/components/ui/SelectControl.tsx` | Kobalte owns option state and applies `data-highlighted`; overlay only composes classes and option content. | Do not change production code unless the keyboard test fails. |
| `select-popup-contrast-matrix.test.ts` | Shared Select matrix covers static plain/selected/highlighted/combined states. | Keep matrix unchanged; it is not a keyboard behavior test. |

## Fix Plan

1. Open the real Expert Squad selector in `prompt-profile-selector-browser.test.ts`.
2. Use keyboard ArrowDown navigation to reach the unselected `backend` option.
3. Assert `data-highlighted` and `aria-selected="false"` before the existing
   contrast measurement.
4. Keep existing screenshot and contrast assertions so visual evidence remains
   tied to the keyboard-highlighted state.

## Acceptance

- The real Expert Squad browser test passes in `en-US` and `zh-CN`.
- The highlighted unselected option is reached by keyboard navigation, not only
  pointer hover.
- Contrast checks still prove option labels and descriptions remain readable on
  the light popup surface.
- No production CSS, raw color, local prompt-profile color override, fallback,
  or duplicate Select implementation is introduced.
