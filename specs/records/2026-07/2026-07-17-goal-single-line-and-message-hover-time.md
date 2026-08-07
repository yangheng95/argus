# Goal Single-Line Density and Message Hover Time

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User request | Compress the floating Goal list to single-line spacing. Inside one Agent message card, remove repeated role names such as `Architect`; hovering a specific chronological message must reveal that message's exact timestamp at its trailing edge. |
| Acceptance criteria | Goal pills use one fixed single-line row height with a 1px row gap instead of stretching across the floating window; each Agent card retains one role identity in its header; flattened message boundaries no longer render repeated role text; every timestamp remains bound to its exact persisted message and is hidden at rest, visible on that message's hover/focus; light/dark real-browser screenshots are reviewed. |
| Hard constraints | Keep `TaskProgressBar` as the only floating Goal renderer and preserve drag, resize, vertical-first column flow, locate, state, and keyboard behavior. Keep boundary/message identity and chronology in the existing projected parts; change presentation grouping rather than deleting persisted metadata. No alternate card renderer, timestamp synthesis, fallback clock, running-process restart, or viewport-only patch. Node launches browser tests. |
| Sources read | `AGENTS.md`; Browser skill; supplied screenshot; July 9 floating-window redesign and edge-resize records; July 15 Agent message-card reference record; July 17 Goal density record; `TaskProgressBar.tsx`; `task-progress-floating-frame.ts`; `CardParts.tsx`; `message-part.ts`; `card.css`; `chat-bubble.css`; focused source and browser tests. |
| Whole-repository search | `.task-progress__pills` has one production CSS owner in `card.css`; its row count is projected only by `TaskProgressBar`, while row-height/gap capacity is calculated only in `task-progress-floating-frame.ts`. The excessive spacing comes from `minmax(26px, 1fr)`, which distributes rows over the full fixed-height resize frame. `CardParts.tsx` is the only production `.card-boundary` renderer and is shared by generic `Card` and `ChatBubble`; its boundary precedes each flattened message and already carries exact `messageID` and `time`. Direct consumers/tests are `chat-bubble.test.ts`, `task-progress-collapse.test.ts`, the Agent-card browser fixture, the message chronology browser fixture, the floating-window browser fixture, and static historical visual HTML that is not a runtime source. |
| Independent agent feedback | No sub-agent was started because the user did not request delegation and current collaboration policy forbids unrequested sub-agents. |

## Plan

1. Make the existing TypeScript Goal-grid constants the sole row-height/gap values, project them as floating-frame CSS variables, and render fixed single-line grid rows aligned to the start instead of `1fr` rows.
2. Partition the existing flattened card parts into exact chronological message runs at boundary parts. Retain each boundary's exact message ID/time, omit its repeated role label, and render one trailing timestamp owned by that message run.
3. Add shared message-run styling that keeps the timestamp non-layout-shifting and hidden at rest, then reveals it on the exact run's hover or keyboard focus without changing the top-level card identity.
4. Update focused source and real browser contracts for single-line Goal geometry, absence of repeated role nodes, exact per-message timestamps, hover isolation, chronology, and both themes; inspect goal-scoped and card-scoped screenshots.
5. Run typecheck, internationalisation validation, production build, documentation health, diff checks, commit with the required prefix, integrate the latest git-cc branch, and push without touching the running application.

## Diagnosis

- The Goal list did not have a large `gap`; its grid declared every row as `minmax(26px, 1fr)`. Because the resize frame has a fixed height, the `1fr` maximum distributed all remaining vertical space across the rows and produced the screenshot's exaggerated rhythm.
- Flattened message boundary parts rendered `roleLabel` and `time` as a visible line before every narrative message. The role label duplicated the card header even though boundary parts already carried exact message identity and chronology.
- Tool-only boundaries are intentionally transparent to the collapsed execution projection. Splitting every boundary into a separate visual message would regress two aggregated execution disclosures into five, so only boundaries with visible narrative content own a hover-time run.

## Result

- The canonical Goal rhythm is now a 22px single-line row with a 1px gap. The same exported constants drive TypeScript capacity calculation and the CSS variables projected by `TaskProgressBar`; rows use fixed tracks with `align-content: start` and never consume `1fr`.
- `CardParts` now uses one pure `partitionCardMessageRuns` projection. Narrative boundaries retain their persisted message ID and exact timestamp, their repeated role label is omitted, and tool-only boundaries remain transparent to execution aggregation.
- Each narrative message run owns one non-layout-shifting trailing `<time>` element. It is invisible at rest and appears only for that exact run on hover or keyboard focus; the card header remains the only always-visible Agent identity.
- The Agent fixture proves isolated hover opacity (`hovered > 0.95`, non-hovered `0`) and saves light/dark card-scoped evidence. The Goal fixtures prove 22px rows, 1px gaps, vertical-first flow, minimum-size collapse, keyboard focus, and dark/light screenshots.
- A stale focus fixture expected a non-`none` CSS outline even though the current Button primitive deliberately uses `outline: none` plus a two-pixel `box-shadow` focus ring. The test now verifies the actual canonical focus primitive instead of weakening focus visibility.
