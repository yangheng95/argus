# Message Hover Timestamp Removal

## Recall

| Item                       | Evidence and requirement                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request               | Hide the relative timestamp that appears at the trailing edge of conversation text after hovering a message.                                                                                                                                                                                                                                                                                                                                       |
| Acceptance criteria        | Hovering or keyboard-focusing a chronological message never renders a trailing timestamp; message text, chronological grouping, persisted message identity, top-level Agent metadata, actions, and execution disclosures remain unchanged; a real isolated Overlay page is inspected in the browser.                                                                                                                                               |
| Hard constraints           | Remove the obsolete presentation path instead of retaining an opacity-based hidden node. Preserve backend message timestamps used for ordering and all top-level identity timestamps. Do not disturb the running OpenCorvus or Overlay process; use Node-started isolated browser fixtures.                                                                                                                                                        |
| Sources read               | Supplied screenshot; `AGENTS.md`; `CLAUDE.md`; `2026-07-17-goal-single-line-and-message-hover-time.md`; `2026-07-15-user-message-hover-metadata.md`; `CardParts.tsx`; `card-message-run.ts`; `card.css`; focused source and browser tests.                                                                                                                                                                                                         |
| Whole-repository search    | `CardParts.tsx` is the only production creator of `.card-message-time`; `card.css` is its only style owner; `timePartID` exists only to attach that node to the final narrative text. Direct test consumers are `chat-bubble.test.ts`, `card-message-run.test.ts`, `message-part-chronology-browser.test.ts`, and `agent-card-separation-browser.test.ts`. The top-level `.chat-bubble__stamp` is a separate Agent identity timestamp and remains. |
| Independent agent feedback | No child agent was needed because the production and test ownership is bounded and non-overlapping. The main agent performs implementation and second review.                                                                                                                                                                                                                                                                                      |

## Plan

1. Remove the trailing `<time>` projection and its formatting imports from the single `CardParts` renderer.
2. Delete `time` and `timePartID` from the presentation-only message-run model while preserving exact message IDs, context ownership, chronology, and execution aggregation.
3. Delete the dedicated hover/focus CSS and change source/browser tests to assert that no `.card-message-time` node exists.
4. Run focused unit tests, Overlay typecheck/build, documentation-health tests, and both Node-started browser fixtures; inspect the resulting conversation screenshots and review the final diff.

## Decision

This record supersedes only the per-message hover-timestamp portion of `2026-07-17-goal-single-line-and-message-hover-time.md` and the message-run timestamp refinements in `2026-07-21-tool-message-mailbox-dialog-refinement.md`. Their Goal-density, role-deduplication, Tool presentation, Mailbox, and Dialog decisions remain valid.

## Validation note

The chronology fixture passed with zero timestamp nodes. The Agent-card fixture also reached and passed its zero-node assertion, then exposed two pre-existing fixture drifts. First, its Composer alignment section mounted a bare `.chat-scroll`, so cards expanded to the 1160-pixel fixture shell while the real Composer kept the canonical 853-pixel reading width. Production owns that centering through `conversation-body`; adding that existing production class to the fixture restores the intended single-source card/Composer geometry without changing product CSS or weakening the assertion. Second, the fixture still expected a visible reasoning event even though `2026-07-20-mirror-watch-display-and-card-reasoning-retirement.md` removed reasoning from message-card rendering; its assertion now requires only the visible Tool and Patch events and proves the reasoning prose is absent.

## Result

- The production renderer no longer creates `.card-message-time`; its formatter imports, final-text attachment field, hover/focus CSS, and presentation-only message-run timing fields are deleted.
- Message IDs, chronological grouping, delegated-context ownership, Tool/Patch aggregation, top-level Agent timestamps, and backend ordering data remain unchanged.
- Focused source tests passed: 8 tests, 0 failures. Overlay typecheck, internationalisation validation, production build, and diff hygiene passed.
- Documentation health passed: 87 tests, 0 failures.
- Both Node-started browser fixtures passed. `message-part-chronology-browser.test.ts` proves zero timestamp nodes before and after disclosure expansion; `agent-card-separation-browser.test.ts` proves zero timestamp nodes across complete Agent cards and both themes.
- Original-resolution review of `.scratch/message-part-chronology-component.png`, `.scratch/message-part-chronology-collapsed.png`, `.scratch/agent-card-separation-light.png`, `.scratch/agent-card-separation-dark.png`, and `.scratch/composer-message-card-width-alignment-light.png` confirms no trailing hover time, no layout gap, retained Agent-header time, and aligned card/Composer geometry.
