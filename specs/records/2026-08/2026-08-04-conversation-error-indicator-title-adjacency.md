# Conversation Error Indicator Title Adjacency

Date: 2026-08-04

UI means User Interface. DOM means Document Object Model.

## Recall

| Item                    | Evidence and requirement                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request            | The supplied desktop screenshot marks the failed Conversation card's red exclamation icon in the trailing time/action area. The user requires that icon to follow the `CHAT` title instead.                                                                                                                                                                                                                                                                            |
| Acceptance              | On a failed top-level Conversation card, the persistent red error-reason indicator is visually adjacent to the title group while the timestamp and overflow actions remain right-aligned. Existing hover Tooltip, focus access, and double-click copy behavior remain unchanged. Nested failed Agent rows retain their already-adjacent placement.                                                                                                                     |
| Hard constraints        | Reuse `CardErrorReasonIndicator`; do not add another icon, Tooltip, copy action, absolute-positioned overlay, UI automated test, fixture, or screenshot baseline. Do not alter or restart the user's running OpenCorvus/Overlay process. Desktop-only scope.                                                                                                                                                                                                           |
| Sources read            | `AGENTS.md`; `CLAUDE.md`; supplied screenshot; `specs/records/2026-08/2026-08-03-conversation-error-indicator.md`; `ChatBubble.tsx`; `CardHeaderChrome.tsx`; `chat-bubble.css`; and `card.css`.                                                                                                                                                                                                                                                                        |
| Whole-repository search | `CardErrorReasonIndicator` has one definition in `CardHeaderChrome.tsx` and three mounts: shared structured-card chrome, top-level Conversation identity row, and nested Agent identity row. `ChatBubbleIdentity` is local to `ChatBubble.tsx`. The top-level indicator is already the immediate DOM sibling after the title/disclosure owner, but `.chat-bubble__head-main` or `.chat-bubble__head-static` grows across the available row, producing the visible gap. |
| Independent review      | This is a single-owner CSS geometry correction. The primary Agent will perform the required scoped diff review and real-page screenshot review.                                                                                                                                                                                                                                                                                                                        |
| Git baseline            | `work-v0.0.29beta-yr-0803` is clean and equal to `myhexin/work-v0.0.29beta-yr-0803` at `7c8d961de5` before this plan.                                                                                                                                                                                                                                                                                                                                                  |

## Causal Chain

1. `ChatBubble.tsx` correctly mounts the one canonical error indicator between the
   title/disclosure owner and `ChatBubbleActions`.
2. The title/disclosure owner has `flex: 1 1 auto`, so it consumes all free
   horizontal space before the error indicator.
3. The row's `space-between` distribution therefore paints the indicator beside
   the right-side timestamp rather than beside the title.
4. The root correction is to make the title owner content-sized only when the
   row contains the persistent error indicator, then give the trailing
   time/action group the remaining auto margin.

## Call-Site Disposition

| Owner / call site                             | Decision                                                                                                                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CardErrorReasonIndicator` definition         | Keep unchanged; it remains the single Tooltip and copy implementation.                                                                                                  |
| `CardHeaderChrome` structured-card mount      | Keep unchanged; structured cards use their own header geometry.                                                                                                         |
| `ChatBubbleChild` nested Agent mount          | Keep unchanged; its compact identity row already paints the indicator adjacent to its title group.                                                                      |
| `ChatBubble` top-level mount                  | Keep the indicator outside the disclosure Button, but move failed-card duration to a following sibling so the order is title → indicator → duration → trailing actions. |
| `chat-bubble.css` top-level identity geometry | Replace free-space growth on failed title owners with content sizing and make the existing hover-action group the right-aligned owner.                                  |
| UI tests                                      | Do not add, modify, update, or run.                                                                                                                                     |

## Implementation And Verification Plan

1. Commit and push this plan before editing product styles.
2. Apply the scoped failed-row flex correction in `chat-bubble.css` without
   changing indicator behavior or normal/running card geometry.
3. Run Overlay typecheck and Vite build, document-health and historical-link
   checks, and `git diff --check`; do not run UI tests.
4. Start an isolated current-source desktop Vite page, reach a real failed
   Conversation card, and personally inspect a screenshot showing the title,
   error indicator, timestamp, and overflow action together.
5. Re-read the scoped diff and rendered evidence, commit task-owned files with
   the `dsw-33987` prefix, push `myhexin`, and verify remote equality.

## Visual Review Correction

The first real-page review found that removing title-owner flex growth painted
`CHAT → duration → error indicator`. That still violated the user's explicit
title adjacency because `CardDurationChip` remained inside
`ChatBubbleIdentity`. The corrected structure suppresses the duration only in a
failed top-level identity, then remounts the same duration component after the
error indicator. This preserves one duration implementation and valid
interactive markup while producing `CHAT → error indicator → duration`.

## Verification Evidence

- `bun run --cwd packages/overlay typecheck` passed after the final component
  correction.
- `bun run --cwd packages/overlay build:vite` passed after transforming 7,061
  modules. Existing third-party module-directive and large-chunk warnings
  remained warnings.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  passed both contracts.
- A headed Node-driven Playwright session operated the isolated current-source
  Vite page at 1440 × 900 without adding or running a UI test. It opened the
  real historical failed Chat titled `刷新的时候这两个图标不会转动`, which
  contained two canonical error indicators.
- Final measured geometry on the first failed card was: title right edge
  `515.82`, alert left edge `525.82`, duration left edge `561.82`, timestamp
  left edge `1126.42`, and overflow action left edge `1241.07` CSS pixels.
  This proves the visible order `CHAT → 10px gap → alert → duration`, while
  timestamp and overflow actions remain right-aligned.
- Hover displayed the complete canonical `AI_InvalidPromptError` reason and the
  double-click copy instruction. Personally reviewed
  `.scratch/conversation-error-title-adjacency-rest-final.png` and
  `.scratch/conversation-error-title-adjacency-tooltip-final.png`.
- The isolated Vite service exited, port 5194 had no listener, and both
  Task-context attempts that never allocated a worker Session were explicitly
  cancelled without deleting their records.
