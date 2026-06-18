# Task Progress Pill Focus

Date: 2026-06-18

GUI means Graphical User Interface. CSS means Cascading Style Sheets.

## Problem

Independent GUI review found `TaskProgressBar` goal pills are clickable
`button.task-progress__pill` controls, but `card.css` only gives them a hover
state. The neighboring fold and expand controls already have `:focus-visible`
outline rules, so the pill buttons are the missing keyboard focus case inside
the same progress strip.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `2026-06-18-retire-conversation-goal-strip-residue.md` | `TaskProgressBar` is the single live conversation goal progress surface; old `goal-chip`/`chatGoalsStrip` selectors are retired. |
| `2026-06-04-agent-rail-card-scroll-materialization.md` | `TaskProgressBar` is a card-scroll caller and should keep the existing scroll request path. |
| `TaskProgressBar.tsx` | Pill clicks call `onPillClick(g.goalID)` and should remain real button controls. |
| `card.css` | `.task-progress__fold` and `.task-progress__toggle` already expose visible `:focus-visible` outlines. |

## Impact Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n "task-progress__pill|TaskProgressBar" packages/overlay/src packages/overlay/test specs/new-arch` | `TaskProgressBar.tsx` is the live surface; `card.css` owns pill styling; tests only cover structure/collapse. | Add focused CSS and tests at the existing owner. |
| `packages/overlay/src/styles/surfaces/card.css` | `.task-progress__pill:hover` promotes background/border/text, but no focus-visible selector exists. | Share the hover visual state with keyboard focus and add an explicit outline. |
| `packages/overlay/test/task-progress-collapse.test.ts` | Existing static contract already pins TaskProgressBar as the single surface. | Extend it to pin pill focus-visible behavior. |

## Fix Plan

1. Change `.task-progress__pill:hover` to cover both hover and
   `:focus-visible`.
2. Add `.task-progress__pill:focus-visible` outline using existing accent token
   patterns from fold/toggle.
3. Add static regression coverage.
4. Add a browser test that keyboard-focuses a pill on light theme, checks
   computed focus outline, and saves a screenshot.

## Acceptance

- `.task-progress__pill:focus-visible` has a visible outline.
- Keyboard focus on a goal pill receives the same visual promotion as hover.
- Existing TaskProgressBar scroll/click semantics are unchanged.
