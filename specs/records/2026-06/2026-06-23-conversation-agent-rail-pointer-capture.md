# Conversation Agent Rail Pointer Capture

Date: 2026-06-23
Status: Verified

## Acronyms

- CSS: Cascading Style Sheets, the browser styling and layout language.
- GUI: Graphical User Interface, the visible overlay surface.
- QA: Quality Assurance, the verification pass that checks delivered behavior.
- UI: User Interface, visible controls and layout surfaces.

## Task Definition

ConversationAgentRail horizontal drag scrolling must keep pointer ownership from
the first drag frame. A press that begins on a rail avatar and immediately moves
outside the thin rail strip must still become a drag, set `data-dragging`, scroll
the lanes, and release cleanly without breaking a plain click on the avatar.

## Recall

| Source                                                   | Constraint carried forward                                                                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AGENTS.md`                                              | No fallback logic, no duplicate owner, test every code change, visually verify UI work, and commit/push every round.                                   |
| `2026-05-13-conversation-agent-workflow-rail.md`         | ConversationAgentRail is an independent bottom strip, not part of the message scroll flow.                                                             |
| `2026-06-18-conversation-agent-rail-button-primitive.md` | Avatar locate controls must stay on the shared `Button` primitive with explicit `aria-label`.                                                          |
| `2026-06-20-agent-rail-drag-scroll-regression.md`        | `attachRailDragScroll` is the single rail drag-scroll implementation; browser coverage must assert real drag, click-not-drag, and screenshot evidence. |
| Read-only independent audit 2026-06-23                   | `setPointerCapture` currently happens only after the movement threshold, so the first move can be lost if it leaves the rail before capture.           |

## Call Point Inventory

| Surface          | Evidence                                                                                                                                         | Decision                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Drag owner       | `packages/overlay/src/components/ConversationAgentRail.tsx` `attachRailDragScroll` owns pointerdown/move/up/cancel and click suppression.        | Capture the original pointer target on pointerdown in this function and release on pointerup/cancel. Do not add document listeners or a second scroll owner. |
| Click navigation | `AgentRailRow` renders `.oc-button[data-ui="conversation-agent-rail-locate"]` and calls `locateRecord`.                                          | Preserve click behavior by keeping the 4px drag threshold and click suppression only after threshold crossing.                                               |
| Browser guard    | `packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts` currently moves inside the rail before asserting `data-dragging`. | Add an escape-drag path whose first move leaves the rail and must still scroll due pointer capture.                                                          |
| Source guard     | `packages/overlay/test/conversation-agent-rail.test.ts` checks structure and drag-to-scroll ownership.                                           | Add a structural assertion that capture is established before threshold-driven dragging.                                                                     |
| CSS state        | `conversation.css` styles `.conversation-agent-rail__lanes[data-dragging="true"]`.                                                               | Keep the same dataset state; no CSS owner change is needed.                                                                                                  |

## Root Cause

The rail waits until `pointermove` crosses the drag threshold before calling
`setPointerCapture`. That works only when the threshold-crossing move is still
delivered to `.conversation-agent-rail__lanes`. Because the rail is a thin bottom
strip, a normal diagonal drag can leave the lanes before the first threshold
move. Without capture established at pointerdown, that first move is delivered
to another element, so `data-dragging` is never set and `scrollLeft` does not
change.

## Fix Plan

1. Move pointer capture to `onPointerDown` after storing the active pointer id.
2. Capture the original pointer target, not `.conversation-agent-rail__lanes`,
   so plain clicks keep their normal `Button` path while pointermove still
   bubbles through the lanes handler.
3. Release capture on `pointerup` and `pointercancel` whenever the active
   pointer ends, independent of whether the 4px drag threshold was crossed.
4. Keep the threshold as the only click-vs-drag boundary so plain clicks still
   reach the locate `Button`.
5. Extend static and browser tests to cover pointerdown capture before dragging
   and the escape-drag path.
6. Run focused static tests, browser drag test, inspect the rail screenshot,
   self-review, commit, and push.

## Acceptance

- First pointer movement may leave the rail and still start a drag.
- Drag sets and clears `data-dragging`.
- Drag changes `.conversation-agent-rail__lanes.scrollLeft`.
- Plain click still reaches the locate button.
- No document-level fallback listeners, duplicate rail scroll owner, or
  alternate navigation path is introduced.

## Verification

- PASS: `bun test packages/overlay/test/conversation-agent-rail.test.ts --timeout 30000`
  - `10 pass`, `0 fail`, `106 expect() calls`.
- PASS: `bun run --cwd packages/overlay typecheck`
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts`
- Visual QA: reviewed
  `.scratch/conversation-agent-rail-scroll-browser/rail-after-drag.png`.

## Self Review

- Capturing `.conversation-agent-rail__lanes` on pointerdown made the browser
  test fail because it broke the plain avatar `Button` click path. The final
  code captures the original pointer target instead, so click and drag stay on
  the same DOM ownership path.
- `attachRailDragScroll` remains the only rail drag-scroll implementation.
  There are no document-level fallback listeners and no second navigation or
  scroll path.
- The browser test now starts from a coordinate proven by `elementFromPoint` to
  hit a visible locate button, then moves outside the thin rail on the first
  drag move. That covers the original failure mode rather than only dragging
  inside the rail.
