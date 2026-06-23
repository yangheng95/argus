# Agent Rail Drag Scroll Regression - 2026-06-20

## Problem

The bottom ConversationAgentRail still declares `overflow-x: auto` and
`attachRailDragScroll`, but the regression was not guarded by a real browser
test. The existing coverage only checks source strings, so the rail can appear
to keep scroll support while user-visible drag/scroll interaction is broken.

## Recall

- `2026-06-04-agent-rail-card-scroll-materialization.md` owns click-to-card
  navigation through `requestConversationCardScroll`; do not add a second card
  scroll path.
- `2026-06-10-agent-rail-identity-empty-card-fix.md` makes hydrated agent rail
  records message-backed and canonical by stage.
- `2026-06-20-message-card-chronological-turns.md` requires agent rail target
  ids to point at renderable message cards.
- Commit `2b6474d32e` added `attachRailDragScroll` but tested it with source
  assertions only.
- Commit `7f86237b06` moved avatar controls to the Button primitive and kept
  the same thin source assertions.

## Call Points

| Surface            | File / symbol                                                                                    | Decision                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Rail drag owner    | `packages/overlay/src/components/ConversationAgentRail.tsx` `attachRailDragScroll`               | Keep this as the single drag-scroll implementation. Fix event capture here if needed.                             |
| Rail scroll layout | `packages/overlay/src/styles/surfaces/conversation.css` `.conversation-agent-rail__lanes`        | Keep one horizontal scroll container; no alternate scrollbar host.                                                |
| Chat rail parent   | `packages/overlay/src/styles/surfaces/workspace.css` `.chat-content-frame`, `.chat-message-pane` | Constrain the parent flex column so rail content cannot expand the workbench instead of overflowing inside lanes. |
| Source guard       | `packages/overlay/test/conversation-agent-rail.test.ts`                                          | Keep lightweight structure checks, but do not rely on them for behavior.                                          |
| Browser guard      | new `packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts`               | Add real fixture, screenshot, overflow assertion, drag assertion, and click-not-drag assertion.                   |

## Acceptance

- With enough records, `.conversation-agent-rail__lanes.scrollWidth` exceeds
  `clientWidth`.
- Mouse drag across an avatar row changes `scrollLeft`.
- The drag sets and then clears `data-dragging`.
- A normal click without drag still reaches the locate button.
- A screenshot of the rail is written for visual review.
