# Card CSS Duplicate Selector Debt

Date: 2026-06-18

## Problem

`overlay-architecture-guards.test.ts` reports `card.css` duplicate selector
debt as `10 > 8`. The guard counts selectors after splitting comma groups, so
adjacent hover/focus rules that repeat the same selector increase debt even when
the CSS behavior is otherwise valid.

## Recall

| Source | Existing decision |
| --- | --- |
| `overlay-architecture-guards.test.ts` | `card.css` has a duplicate-selector budget of 8 and the budget must not increase. |
| `2026-06-18-trace-event-head-focus.md` | Trace event heads need focus-visible styling with an inset accent ring. |
| `2026-06-18-task-progress-pill-focus.md` | Task progress pills need keyboard focus styling equivalent to hover plus a visible ring. |

## Evidence Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `bun test packages/overlay/test/overlay-architecture-guards.test.ts` | Fails at `surface stylesheet duplicate selector debt cannot increase`: `card.css: 10 > 8`. | Fix selector structure instead of raising the budget. |
| Guard parser reproduction | Repeated adjacent selectors include `.trace-event-head:focus-visible` and `.task-progress__pill:focus-visible`. | Merge adjacent focus-visible declarations into their hover/focus blocks. |
| `card.css` review | Both pairs are contiguous and use the same visual state, split only to add outline/box-shadow. | Combining them keeps behavior unchanged and lowers debt by two. |

## Fix

- Split `.trace-event-head:hover` and `.trace-event-head:focus-visible` so
  focus-visible owns background plus ring while hover stays background-only.
- Split `.task-progress__pill:hover` and `.task-progress__pill:focus-visible`
  so focus-visible owns hover-equivalent fill plus ring while hover stays
  ring-free.
- Do not raise the duplicate selector budget and do not add new selectors.

## Acceptance

- `overlay-architecture-guards.test.ts` passes the duplicate selector budget.
- Existing trace event and task progress focus tests remain green.
- No visual token, primitive, or behavior source changes are introduced.
