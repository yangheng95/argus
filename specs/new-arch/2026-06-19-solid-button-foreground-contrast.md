# Solid Button Foreground Contrast

Date: 2026-06-19

GUI means Graphical User Interface. CSS means Cascading Style Sheets. CTA means
Call To Action.

## Problem

Independent GUI review found the shared `Button` primitive rendered solid
accent and danger buttons with `--oc-button-color: var(--surface)`. `--surface`
is a background token, not an on-solid foreground token. Existing static tests
had incorrectly made that background token the canonical readable foreground.

The issue is systemic because `Button variant="solid"` is used by the chat
composer, agent reply box, settings confirmations, onboarding actions, dialog
confirm actions, and the left-sidebar Task/Mission/Assistant creation CTAs.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `packages/overlay/src/components/ui/Button.tsx` | `Button` is the shared primitive for operation buttons. |
| `packages/overlay/src/styles/primitives/button.css` | Solid tone foreground belongs in the primitive, not per caller. |
| `packages/overlay/src/styles/cascade/*.css` | Theme palettes already declare `--text-on-accent`; on-solid foreground must be theme-owned. |
| `2026-06-18-chat-composer-button-primitive-owner.md` | Chat composer send/stop actions consume `Button`; local contrast fixes would fragment the primitive. |
| `2026-06-12-task-ledger-chat-to-task-button-parity.md` | Sidebar new Task/Mission/Assistant CTAs should share Button chrome. |

## Evidence Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n -- '--oc-button-color:\s*var\(--surface\)|variant="solid"|data-variant="solid"' packages/overlay/src packages/overlay/test` | `button.css` and sidebar solid CTA rules were the active foreground owners; many TSX callers consume `variant="solid"`. | Fix the primitive and sidebar shared CTA rule, not each caller. |
| `button-primitive.test.ts` | The test name claimed readable foreground but asserted `--surface`. | Invert the test to require on-solid foreground tokens. |
| Theme contrast calculation | White text works on light accent but fails dark accent/danger; dark text works on dark/vscode accent/danger but fails light accent. | Keep foreground tokens theme-specific instead of hard-coding one value in `button.css`. |
| Sidebar CTA CSS | `sidebar-new-task-button`, `mission-new`, and `coding-assistant-new` locally repeated solid foreground. | Retarget them to the same `--text-on-accent` token. |

## Fix

1. Keep `--text-on-accent` as the accent foreground token and make it
   theme-correct.
2. Add `--text-on-strong` and `--text-on-danger` for solid neutral and danger
   foregrounds.
3. Update `button.css` solid normal, hover, and focus-visible states to consume
   these tokens by tone.
4. Update sidebar solid CTA overrides to use `--text-on-accent`.
5. Add a real browser contrast matrix that renders solid neutral/accent/danger
   buttons under `light`, `dark`, and `vscode-dark`, samples normal, hover, and
   keyboard focus-visible states, and asserts contrast at least `4.5`.

## Acceptance

- Solid accent and danger Button foreground no longer use `--surface`.
- All three themes define the on-solid foreground tokens.
- Sidebar solid CTA overrides do not reintroduce `--surface` foreground.
- Real browser evidence verifies solid tone contrast under light, dark, and
  VS Code dark themes for normal, hover, and focus-visible states.
