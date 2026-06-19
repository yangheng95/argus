# Interaction Card Textarea Primitive

Date: 2026-06-19

CSS means Cascading Style Sheets. DOM means Document Object Model.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `AGENTS.md` | Reuse mature UI primitives; do not keep duplicate CSS or component primitives. |
| `2026-06-18-agent-reply-box-primitives.md` | Agent reply textareas already migrated to `AutoGrowTextarea` plus primitive-backed buttons. |
| `composer-textarea-unification.test.ts` | `AutoGrowTextarea` and `.composer-textarea` are the single source for form-surface auto-growing textareas. |
| `InteractionDialogHost.tsx` | The popup dialog reuses `InteractionCard`, so fixing the shared card fixes inline and dialog interaction surfaces together. |

## Evidence Sweep

| Target | Result | Decision |
| --- | --- | --- |
| `InteractionCard.tsx` | `rg -n "interaction-card__custom-input|<textarea" packages/overlay/src/components/InteractionCard.tsx` shows a raw custom reply textarea. | Replace it with `AutoGrowTextarea`. |
| `card.css` | `.interaction-card__custom-input` defines width, font, padding, border, background, color, resize, and box-sizing. | Delete the duplicate textarea chrome and compose the shared `.composer-textarea` class. |
| `AutoGrowTextarea.tsx` / `field.css` | The primitive owns auto-grow behavior; `.composer-textarea` owns form textarea chrome and visible overflow scrollbar. | Reuse both for interaction question custom replies. |
| Browser coverage | Existing interaction browser coverage only exercises permission actions; no question custom input screenshot exists. | Add a focused browser fixture for inline and dialog question custom textareas. |

## Fix

- Import and render `AutoGrowTextarea` in `InteractionCard`.
- Use `class="composer-textarea interaction-card__custom-input"` so the shared form textarea chrome is the single source.
- Remove the `.interaction-card__custom-input` CSS rule from `card.css`.
- Extend static textarea-unification guards and add a real browser test covering inline and dialog surfaces.

## Acceptance

- `InteractionCard.tsx` has no raw `<textarea>`.
- `card.css` has no `.interaction-card__custom-input` textarea chrome rule.
- The browser fixture proves both inline and dialog custom reply fields use `.composer-textarea`, have `resize: none`, keep `overflow-y: auto`, and auto-grow when text spans multiple lines.
