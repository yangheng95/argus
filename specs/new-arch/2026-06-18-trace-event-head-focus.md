# Trace Event Head Focus

Date: 2026-06-18

GUI means Graphical User Interface. CSS means Cascading Style Sheets.

## Problem

Independent GUI review found `TracePanel` event disclosure rows render as
`button.trace-event-head`, but the surface only has a hover background. Keyboard
users can tab to a trace event head and toggle it, but the active row has no
visible focus treatment in long trace lists.

## Recall

| Source                                            | Relevant constraint                                                                                                   |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `2026-06-18-card-trace-action-button-owner.md`    | TracePanel header actions already moved to the Button primitive; event heads are disclosure rows, not action buttons. |
| `2026-06-18-trace-panel-icon-guard-retirement.md` | TracePanel icons already use the shared Icon primitive.                                                               |
| `2026-06-03-overlay-workbench-page-prd.md`        | TracePanel must keep a keyboard path and visible state.                                                               |
| `changes.css` `.change-row:focus-visible`         | Similar row-disclosure controls use an inset focus ring to avoid clipped outlines.                                    |

## Impact Sweep

| Sweep                                                        | Result                                                                              | Decision                                                                                                                                             |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `rg -n "trace-event-head                                     | TracePanel" packages/overlay/src packages/overlay/test specs/new-arch`              | The live event disclosure owner is `TracePanel.tsx`; `card.css` owns `.trace-event-head`; tests cover Panel/Button adoption but not event row focus. | Add focused CSS and tests at the existing owner. |
| `packages/overlay/src/styles/surfaces/card.css`              | `.trace-event-head:hover` sets background only; no `:focus-visible` rule exists.    | Share hover background with focus and add an inset focus ring.                                                                                       |
| `packages/overlay/test/browser/rewind-visual-stress.test.ts` | Existing stress test captures TracePanel actions, not keyboard focus on event rows. | Add a focused browser fixture for trace event head keyboard behavior.                                                                                |

## Fix Plan

1. Extend `.trace-event-head:hover` to include `:focus-visible`.
2. Add `.trace-event-head:focus-visible` with inset accent box-shadow.
3. Add static regression coverage in the TracePanel primitive test group.
4. Add browser coverage that tabs to the event head, asserts focus-visible
   styles, presses Enter, and screenshots the focused trace panel.

## Acceptance

- Trace event heads show a visible keyboard focus ring.
- Keyboard activation still toggles `aria-expanded`.
- TracePanel action-button primitive ownership remains unchanged.
