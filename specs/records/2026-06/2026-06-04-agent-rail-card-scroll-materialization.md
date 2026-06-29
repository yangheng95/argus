# Agent Rail Card Scroll Materialization

Date: 2026-06-04

## Problem

Clicking an agent avatar in the conversation rail can show "Agent card
unavailable" on the first click, then work after several clicks.

Root cause: the rail has a `renderedCardID`, but the target card can be outside
the currently hydrated or currently materialized virtual-list window. The click
path loads the missing history and requests a scroll, but
`Conversation.tsx::scrollCardIntoView` only waits two animation frames after
`virtualizer.scrollToIndex`. The store can already contain the card while the
Document Object Model (DOM) node is still not mounted by the virtualizer. The
first click therefore writes enough data for the next click, then reports a
false negative.

## Callsite Audit

| Callsite                                  | Role                                                                                           | Disposition                                                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `ConversationAgentRail.tsx::locateRecord` | Loads session/history, expands parent cards, and dispatches `requestConversationCardScroll`.   | Keep this as the rail owner; do not invent a second scrolling path.                                         |
| `Conversation.tsx::scrollCardIntoView`    | Single listener that turns card-scroll requests into virtualizer scroll + DOM focus/highlight. | Fix here so every card-scroll caller gets render-aware behavior.                                            |
| `conversation-scroll.ts`                  | Event contract for card-scroll requests.                                                       | Keep unchanged; the contract is already correct.                                                            |
| `TaskProgressBar.tsx`                     | Another caller of `requestConversationCardScroll`.                                             | Beneficiary of the same fix; no callsite-specific workaround.                                               |
| `conversation-agent-rail.test.ts`         | Source-contract tests for rail behavior.                                                       | Add coverage that the scroll handler waits for target materialization rather than a fixed two-frame lookup. |

## Acceptance

- A rail click waits for the virtualized card DOM to materialize after history
  hydration.
- The warning is emitted only after the scroll handler has genuinely failed to
  locate the target after the bounded materialization wait.
- Existing card-scroll callers still use the same `requestConversationCardScroll`
  event contract.
