# Card Header Nested Interaction Cleanup

Date: 2026-06-18

DOM means Document Object Model. UI means User Interface.

## Problem

Independent GUI review found `CardHeader` and `ChatBubble` expose the whole
header as `role="button"` with `tabindex=0` while rendering real buttons inside
the same header: error reason, inspect trace, session model settings, cancel,
and rewind. That creates nested interactive controls and can let keyboard events
from action buttons bubble into the header toggle path.

This is the same class of defect fixed by the ledger-row and memory-row cleanup
plans.

## Recall

| Source                                         | Relevant constraint                                                                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-18-ledger-row-nested-interactions.md` | Row containers must not be keyboard buttons when they contain sibling action buttons; the main row button owns selection.  |
| `2026-06-18-memory-row-nested-interactions.md` | Disclosure state belongs to a native main button; sibling actions must stay outside that button.                           |
| `2026-06-17-card-header-action-rhythm.md`      | `CardHeader` and `ChatBubble` share the same metadata/control action rail rhythm; do not introduce a second visual system. |
| `12-overlay-card-system.md`                    | `CardHeader.tsx` is the single structured card header implementation for non-message cards.                                |

## Impact Sweep

| Sweep                                                                                                                                                       | Result                                                                                                                                                                       | Decision                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `rg -n -e "card__head" -e "chat-bubble__head" -e "card__actions" -e "chat-bubble__actions" packages/overlay/src packages/overlay/test specs` | `CardHeader.tsx` and `ChatBubble.tsx` are the live creation points. `card.css` and `chat-bubble.css` own the visual contract. Static visual HTML contains old sample markup. | Fix the two live components and CSS first. Keep visual fixture updates scoped if tests require them.          |
| `rg -n -e "CardHeader" -e "ChatBubble" packages/overlay/test packages/overlay/src specs`                                                     | `chat-bubble.test.ts`, `card-header-chrome.test.ts`, and `card-expand-collapse-contract.test.ts` pin the header source contract.                                             | Turn old role/tabindex expectations into guards and pin the new native disclosure button.                     |
| `packages/overlay/src/styles/surfaces/card.css`                                                                                                             | Hover/focus styling is attached to `.card__head[role="button"]` and `.card__head[tabindex]`.                                                                                 | Move hover/focus affordances to `.card__head-main` while keeping the existing header spacing and action rail. |
| `packages/overlay/src/styles/surfaces/chat-bubble.css`                                                                                                      | Bubble header owns column layout and right/user alignment.                                                                                                                   | Add `.chat-bubble__head-main` as the native disclosure control without changing the action rail grouping.     |

## Fix Plan

- Keep `.card__head` and `.chat-bubble__head` as non-semantic layout
  containers.
- Add a native disclosure button in each header:
  - `.card__head-main` wraps the icon, main title stack, preview, and todo
    summary for structured cards.
  - `.chat-bubble__head-main` wraps the identity/title stack, preview, and todo
    summary for chat bubbles.
- Move `aria-expanded`, click toggle, and Enter/Space keyboard toggle to the
  native disclosure buttons.
- Keep `.card__actions` and `.chat-bubble__actions` as sibling controls outside
  the disclosure button.
- Reuse existing token-derived CSS; do not add raw colors or a parallel token
  set.

## Acceptance

- `.card__head` and `.chat-bubble__head` have no `role="button"` or
  `tabindex`.
- `.card__head-main` and `.chat-bubble__head-main` are native buttons with
  `aria-expanded`.
- Header action buttons are not descendants of the disclosure buttons.
- Keyboard focus can move from the disclosure button to action buttons without
  nested interactive semantics.
- Browser screenshot confirms expanded/collapsed headers remain visually
  coherent.
