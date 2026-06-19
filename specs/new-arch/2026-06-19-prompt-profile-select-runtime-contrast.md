# Prompt Profile Select Runtime Contrast

Date: 2026-06-19

GUI means Graphical User Interface. CSS means Cascading Style Sheets. DOM means
Document Object Model. ARIA means Accessible Rich Internet Applications, the
browser accessibility attribute family used by Kobalte primitives.

## Problem

The Expert Squad selector readability report is fixed in the shared
Kobalte-backed `SelectControl` styling, but one verification path still used a
hand-written popup DOM matrix. That matrix is useful for broad CSS sampling, but
it cannot prove Kobalte's runtime `data-selected` and `data-highlighted`
attributes are present on the real Expert Squad options.

## Recall

| Source | Relevant decision |
| --- | --- |
| `2026-06-17-expert-squad-select-readability-impact.md` | Expert Squad readability belongs to the shared Kobalte Select popup source. |
| `2026-06-18-expert-squad-unselected-option-contrast-guard.md` | Light popup unselected option contrast must be guarded by browser evidence. |
| `2026-06-19-dropdown-menu-highlighted-contrast-source.md` | Active popup states must use Kobalte runtime attributes, not local mirrors. |
| `2026-06-19-kobalte-selected-state-single-source.md` | Selected and highlighted visual state must come from Kobalte attributes. |
| `packages/overlay/src/components/ChatComposer.tsx` | Expert Squad renders through `SelectControl<PromptProfileOption>`. |
| `packages/overlay/src/components/ui/SelectControl.tsx` | Shared Select shell emits Kobalte Select items with `.oc-select-option`. |

## Impact Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n "expert-squad|Expert|专家|prompt-profile-select" packages/overlay/src packages/overlay/test` | The user-facing Expert Squad selector is the Chat Composer prompt profile picker. | Strengthen its existing real browser test instead of adding local CSS. |
| `rg -n "oc-select-option|data-highlighted|data-selected" packages/overlay/src packages/overlay/test` | Shared Select CSS already styles default, selected, and highlighted rows. | Keep `field.css` unchanged. |
| Real browser run of `prompt-profile-selector-browser.test.ts` | Current screenshot shows unselected options readable on a light popup surface. | Add keyboard-highlighted runtime assertions so the test proves Kobalte state attributes too. |

## Fix Plan

1. Keep Expert Squad on `SelectControl`; do not add component-local color
   overrides.
2. In the real browser prompt-profile selector test, open the popup and move the
   Kobalte highlight to an unselected option through the real option hover path.
3. Assert real option rows expose `role="option"`, selected rows expose
   `data-selected`, highlighted rows expose `data-highlighted`, and all option
   label/description text keeps at least 4.5:1 contrast on the light popup.
4. Keep the hand-written select matrix as supplemental broad CSS coverage only.

## Acceptance

- The Expert Squad selector runtime screenshot is taken from the real overlay,
  not a hand-written fixture.
- A real unselected option can be highlighted by Kobalte at runtime and remains
  readable on the light popup surface.
- No production CSS, raw color, or Expert Squad-specific style override is
  introduced.
