# Trace Event Head Button Primitive

Date: 2026-06-20

GUI means Graphical User Interface. CSS means Cascading Style Sheets.

## Problem

Independent GUI review found `TraceEventRow` still renders its disclosure head
as a bare `<button class="trace-event-head">`, while the same `TracePanel`
already uses the shared `Button` primitive for header actions.

This creates a button primitive split: future contrast, density, or focus-ring
fixes in `Button` will not automatically cover trace event heads.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `2026-06-18-card-trace-action-button-owner.md` | TracePanel header actions already route through `Button` with `data-ui` selectors. |
| `2026-06-18-trace-event-head-focus.md` | Trace event heads are disclosure rows with visible keyboard focus. |
| `2026-06-19-trace-event-disclosure-controls.md` | The row must preserve `aria-expanded`, expanded-only `aria-controls`, and a matching body id. |
| `Button.tsx` / `button.css` | Shared button chrome owns focus, hover, border, radius, and disabled states through `oc-button`. |

## Impact Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n 'trace-event-head|TracePanel' packages/overlay/src packages/overlay/test specs/new-arch` | Live production row owner is `TracePanel.tsx`; style owner is `card.css`; browser fixture and primitive tests pin the old bare class contract. | Migrate the live row and test fixture together. |
| `TracePanel.tsx` | Header actions already import and use `Button`; event heads are the only bare button in the component. | Reuse the existing import; no new primitive. |
| `card.css` | `.trace-event-head` directly sets background, border, hover, and focus-visible box-shadow. | Keep row layout/log typography only; let `.oc-button` own hover/focus chrome. |
| `trace-event-head-focus-browser.test.ts` | Fixture manually renders a bare button and asserts the old inset box-shadow focus. | Render `.oc-button.trace-event-head`, assert primitive class/data attrs, background on focus, and visible outline. |

## Fix Plan

1. Replace the bare trace event head `<button>` with `<Button>`.
2. Add `data-ui="trace-event-head"` and preserve `type`, `aria-expanded`,
   expanded-only `aria-controls`, and click toggling.
3. Update `.trace-event-head` CSS to express row layout through Button
   variables and row-specific typography, without private background/border
   or focus-visible button chrome.
4. Update static tests to reject bare trace event buttons and require
   `.oc-button` plus `data-ui="trace-event-head"`.
5. Update the Node browser fixture and screenshot assertion to validate the
   shared Button focus path.

## Acceptance

- `TraceEventRow` renders through `Button` while keeping disclosure semantics.
- `.trace-event-head` no longer defines private hover/focus button chrome.
- Browser evidence proves keyboard focus and Enter toggling still work.
- Static tests fail if the bare button returns.
