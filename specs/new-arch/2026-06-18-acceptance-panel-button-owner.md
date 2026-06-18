# Acceptance Panel Button Owner

Date: 2026-06-18

CSS means Cascading Style Sheets. UI means User Interface.

## Problem

Independent review found AcceptancePanel action controls still render as raw
`<button>` elements while `Board.tsx` already uses the shared `Button`
primitive for task actions. The same panel also has acceptance-specific styles
in `settings.css`, and a residual acceptance selector in the generic
`messages.css` overflow guard.

This creates two ownership sources for the right inspector acceptance surface:
the card shell is in `inspector.css`, but its controls and summary layout are
owned by settings/message stylesheets.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `packages/overlay/src/components/ui/Button.tsx` | Operation controls must route through the `Button` primitive and its data attributes. |
| `packages/overlay/src/styles/primitives/button.css` | Button hover/focus/size/tone behavior is the shared control source. |
| `packages/overlay/test/overlay-architecture-guards.test.ts` | Acceptance panel chrome is intended to be owned by `surfaces/inspector.css`. |
| `2026-06-17-agent-card-css-retirement.md` | Retired or misplaced surface CSS must be deleted instead of preserved as dead/parallel ownership. |

## Impact Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n "acceptance-summary-toggle|acceptance-files-link|acceptance-evidence-goal-pill" packages/overlay/src packages/overlay/test` | `Board.tsx` renders three action controls; goal pill CSS is in `inspector.css`, summary/files CSS is in `settings.css`. | Convert all three to `Button`; keep operation semantics. |
| `rg -n "acceptance-panel|acceptance-summary|acceptance-files-link" packages/overlay/src/styles` | Acceptance panel shell is in `inspector.css`; summary/control rules are in `settings.css`; generic overflow guards in `messages.css` also include acceptance selectors. | Move acceptance-specific layout to `inspector.css`; remove acceptance selectors from settings/messages. |
| `rg -n "data-has-pill|acceptance-evidence-row" packages/overlay/src packages/overlay/test` | CSS has a no-pill branch, but the DOM never sets `data-has-pill`. | Add the row attribute when a goal pill exists and pin it in tests. |

## Fix Plan

- Replace AcceptancePanel raw operation buttons with `Button`.
- Use `data-ui` hooks for acceptance summary toggle, files changed, and goal
  run pill controls.
- Set `data-has-pill` on evidence rows with a goal run pill so the existing
  three-column layout is intentional.
- Move acceptance summary/meta/control rules from `settings.css` to
  `inspector.css`.
- Remove acceptance-specific selectors from `messages.css` and give the same
  overflow guarantees from the inspector owner.
- Add static guards for Button primitive usage and CSS ownership.
- Capture real browser screenshots of the acceptance panel after the change.

## Acceptance

- No raw AcceptancePanel action button remains in `Board.tsx`.
- `settings.css` and `messages.css` do not own acceptance-specific selectors.
- `inspector.css` owns acceptance panel, summary, meta, evidence rows, and
  Button data-ui control styling.
- Browser screenshot shows long summary, files changed action, and goal run
  pill without overlap.
