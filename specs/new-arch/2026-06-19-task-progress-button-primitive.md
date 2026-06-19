# Task Progress Button Primitive

## Context

Independent GUI review found `TaskProgressBar` still renders three raw button
surfaces: the whole-strip fold control, each goal pill, and the overflow
expand/collapse toggle. Their chrome is duplicated in `card.css` through
`.task-progress__fold`, `.task-progress__pill`, and `.task-progress__toggle`.

The earlier `2026-06-18-task-progress-pill-focus.md` fix correctly added
keyboard focus visibility, but it left the progress controls outside the shared
`Button` primitive. That means future button density, focus, hover, disabled, or
theme changes can drift from the rest of the overlay.

## Recall

| Source | Constraint |
| --- | --- |
| `packages/overlay/src/components/ui/Button.tsx` | `Button` owns the canonical `.oc-button` class and `data-variant`, `data-size`, `data-tone` attributes. |
| `packages/overlay/src/styles/primitives/button.css` | `.oc-button:focus-visible` owns the shared keyboard focus ring and base hover policy. |
| `2026-06-18-retire-conversation-goal-strip-residue.md` | `TaskProgressBar` is the single live conversation goal progress surface; retired `goal-chip`/`chatGoalsStrip` selectors must not return. |
| `2026-06-18-task-progress-pill-focus.md` | Goal pill keyboard focus must stay visible and pill click must keep the existing card-scroll request path. |
| `packages/overlay/test/browser/task-progress-pill-focus-browser.test.ts` | Existing browser evidence fixture checks real focus styling and Enter activation for a progress pill. |
| `rg -n "task-progress__fold|task-progress__pill|task-progress__toggle" packages/overlay/src packages/overlay/test specs/new-arch` | The old private selectors are owned by `TaskProgressBar`, `card.css`, and tests. |

## Fix

- Replace raw progress controls in `TaskProgressBar.tsx` with `Button`.
- Use stable `data-ui` owners:
  `task-progress-fold`, `task-progress-pill`, and `task-progress-toggle`.
- Move local geometry/state styling from private button classes to scoped
  `.task-progress .oc-button[data-ui="..."]` rules.
- Update measurement and observer selectors from `.task-progress__pill` to
  `[data-ui="task-progress-pill"]`.
- Keep pill inner spans for id/title typography.
- Keep the progress-bar fill and status color logic unchanged.

## Tests

- Static source test rejects raw `<button` in `TaskProgressBar.tsx`.
- Static CSS test rejects private button owner selectors and requires
  `.oc-button[data-ui="..."]` owners.
- Browser focus test fixture uses `.oc-button[data-ui="task-progress-pill"]`,
  validates Button data attributes, focus-visible styling, and Enter activation.

## Acceptance

- All TaskProgressBar interactive controls render as `.oc-button`.
- No live source or test contract keeps `.task-progress__fold`,
  `.task-progress__pill`, or `.task-progress__toggle` as button owners.
- Goal pill keyboard focus remains visible and card-scroll click semantics stay
  unchanged.
