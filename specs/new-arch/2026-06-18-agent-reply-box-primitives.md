# Agent Reply Box Primitive Adoption

Date: 2026-06-18
Status: implemented

## Problem

Independent GUI review found `AgentSessionReplyBox` still hand-renders its reply
textarea and action buttons while the overlay already has shared
`AutoGrowTextarea` and `Button` primitives.

This affects every non-root agent session reply surface rendered from `Card.tsx`
and `ChatBubble.tsx`. The risk is not route behavior; it is UI drift: textarea
height, focus behavior, disabled state, icon sizing, and button hover/focus
styling can diverge from the rest of the overlay.

## Evidence Sweep

| Sweep | Evidence | Decision |
| --- | --- | --- |
| `rg -n "AgentSessionReplyBox|card__agent-reply|<textarea|<button" packages/overlay/src packages/overlay/test specs/new-arch specs` | `AgentSessionReplyBox.tsx` owns one reply textarea and two local buttons. `Card.tsx` and `ChatBubble.tsx` are the only component callsites. | Migrate only this component; do not touch unrelated raw textareas in interaction/settings surfaces. |
| `rg -n "AutoGrowTextarea|composer-textarea-unification|Button primitive" packages/overlay/src packages/overlay/test specs/new-arch` | Goal/chat/mission already use `AutoGrowTextarea`; many action surfaces style `Button` through `data-ui`. | Use `AutoGrowTextarea` with the existing two-row cap and `Button` with `data-ui` selectors. |
| `rg -n "card__agent-reply" packages/overlay/src/styles packages/overlay/test` | `card.css` owns the inline overlay layout for the send control and the error chip. | Preserve layout classes but point action styling at `.oc-button[data-ui=...]`. |

## Constraints

- Keep routing unchanged.
- Keep structured errors as dismissible visible diagnostics; do not restore a
  terminal disabled UI state.
- Keep the reply input compact: two visible rows, scrolling after overflow.
- Do not add fallback behavior or terminal disabled gates.
- Do not create a second button/textarea primitive.
- Browser visual acceptance must render the reply box and save a screenshot.

## Tests

- Extend `composer-textarea-unification.test.ts` so `AgentSessionReplyBox` is
  covered by the `AutoGrowTextarea` guard.
- Extend `agent-session-controls.test.ts` so send/dismiss actions use `Button`
  and no local raw `<button>` remains in this component.
- Add a browser visual test for active, disabled, long-text, and error states.

## Verification

- `bun test packages/overlay/test/composer-textarea-unification.test.ts packages/overlay/test/agent-session-controls.test.ts packages/overlay/test/agent-reply-box-structured-errors.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `$env:OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER='1'; node --test --test-reporter=dot --test-timeout=60000 packages/overlay/test/browser/agent-reply-box-primitives.test.ts`
- Screenshot reviewed: `.scratch/agent-reply-box-primitives.png`
