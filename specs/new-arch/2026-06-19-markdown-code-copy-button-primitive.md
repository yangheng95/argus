# Markdown Code Copy Button Primitive

Date: 2026-06-19

GUI means Graphical User Interface. CSS means Cascading Style Sheets. DOM means
Document Object Model. HTML means HyperText Markup Language.

## Problem

Independent GUI review found Markdown fenced-code copy controls are still
rendered as raw HTML buttons with the private `.md-code-copy` shell. The
Markdown path cannot use the JSX `Button` component directly, but it can still
emit the same `.oc-button` contract that `Button` owns. Today `markdown.css`
duplicates icon-button border, background, hover, and focus-visible styling.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `2026-06-01-overlay-mature-ui-primitives-refactor.md` | Markdown code-copy already moved to shared `iconHtml("copy")`; icon source is not the remaining issue. |
| `2026-06-17-icon-html-single-source.md` | `utils/markdown.ts` keeps `iconHtml("copy", 12)` and generated HTML must use the central Icon source. |
| `packages/overlay/src/main.tsx` | Code-copy behavior is delegated through `button[data-md-copy]`, not through `.md-code-copy`. |
| `packages/overlay/src/styles/primitives/button.css` | `.oc-button:focus-visible` and `data-chrome="icon-action"` own icon-button focus and hover chrome. |

## Evidence Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n -e "md-code-copy" -e "data-md-copy" -e "markdown-code-copy" packages/overlay/src packages/overlay/test specs specs/new-arch` | Production ownership is `wrapCodeBlock` and `markdown.css`; click behavior only uses `button[data-md-copy]`. | Add `.oc-button` and data attributes without changing clipboard delegation. |
| `markdown.css` inspection | `.md-code-copy`, `.md-code-copy:hover`, and `.md-code-copy:focus-visible` duplicate button chrome. | Retire private hover/focus shell; keep only code-toolbar geometry/success token overrides. |
| `markdown-safety.test.ts` inspection | Current tests cover copy payload budget, not the emitted button primitive contract. | Extend the existing Markdown test file. |

## Fix Plan

1. Change `wrapCodeBlock` output to
   `class="oc-button md-code-copy"` with `data-variant="ghost"`,
   `data-size="icon"`, `data-tone="neutral"`, `data-chrome="icon-action"`,
   and `data-ui="markdown-code-copy"`.
2. Preserve `data-md-copy`, `title`, `aria-label`, and `iconHtml("copy", 12)`.
3. Delete `.md-code-copy` private button shell, hover, and focus-visible
   rules from `markdown.css`.
4. Keep success state as
   `.oc-button[data-ui="markdown-code-copy"][data-copied="true"]` using
   existing palette tokens.
5. Add browser fixture coverage that focuses and clicks the Markdown code-copy
   button, validates the `.oc-button` contract, and saves a screenshot.

## Acceptance

- Rendered Markdown code-copy buttons are `.oc-button` controls with the full
  `data-*` Button contract.
- `.md-code-copy:hover` and `.md-code-copy:focus-visible` no longer exist.
- Clipboard listener behavior remains keyed by `data-md-copy`.
- Copied state still uses `data-copied="true"` with token colors.
- Browser screenshot evidence shows a visible shared focus ring and no overlap
  with code text.
