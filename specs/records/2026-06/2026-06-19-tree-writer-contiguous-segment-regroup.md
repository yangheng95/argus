# Tree Writer Contiguous Segment Regroup

Date: 2026-06-19

UI means User Interface.

## Problem

`regroupTimelineSegments` grouped non-phase messages by the global key
`sessionID + stage + goalID`. That fixed root/orchestrator cards that span
child-agent work, but it broke shared-session Mission/Coding Assistant
timelines: if one runtime session emits `user -> assistant -> user ->
assistant`, the second user message and the second assistant message are merged
back into the first user/assistant cards.

The visible timeline then drops real later turns from top-level order. The
stable failure was:

```text
bun test packages/overlay/test/tree-writer-message-tokens.test.ts
```

where both live replay and hydrate replay only rendered the first two message
cards.

## Recall

| Source                                                  | Relevant constraint                                                                                                                                  |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-05-16-overlay-message-turn-agent-cards.md` §13    | Correct display target is one card for a contiguous visible run, not one card per whole session/stage.                                               |
| `2026-06-15-orchestrator-workflow-alignment.md`         | Root/orchestrator turns remain one complete session card across child/phase interruptions, and `session.status` terminal updates that complete card. |
| `2026-06-05-mission-card-explore-agent.md`              | Shared standalone sessions must split semantic speakers, but this does not permit merging non-contiguous turns.                                      |
| `2026-06-02-overlay-card-projection-fragility-audit.md` | Tree writer projection must preserve durable message identity and stay loud on malformed inputs.                                                     |

## Impact Sweep

| Sweep                                                      | Result                                                                                                     | Decision                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `rg -n "regroupTimelineSegments                            | hydrateConversationView                                                                                    | message.updated                                                                        | cardTreeStore.order" packages/overlay/src packages/overlay/test specs` | `regroupTimelineSegments` is the shared live/hydrate regroup owner. `hydrateConversationView` calls it after replay. | Fix the owner once; do not add a hydrate-only path. |
| `packages/overlay/test/tree-writer-message-tokens.test.ts` | Existing live and hydrate tests already assert alternating user/assistant turns stay on the real timeline. | Keep those tests and add a narrower contiguous-run regression.                         |
| `2026-06-05-mission-card-explore-agent.md`                 | Mission needed split by semantic speaker in a shared session.                                              | Preserve split by stage inside that runtime session.                                   |
| `2026-06-15-orchestrator-workflow-alignment.md`            | Child agents are separate runtime sessions and must not split the parent/root card.                        | Track the current segment per `sessionID`, not as one process-global adjacent segment. |

## Fix Plan

- Replace the global `segmentBySessionKey` map with `currentSegmentBySession`.
- Reuse a segment only when the current semantic run for that same `sessionID`
  still has the same `stage` and `goalID`.
- Keep consecutive same-stage messages grouped inside one card with boundary
  parts.
- Open a fresh card when the same runtime session switches semantic stage/goal
  and later returns to the old stage.
- Keep root/orchestrator parent cards complete when the interleaving work comes
  from a different child runtime session.

## Acceptance

- Live alternating user/assistant messages in one session render four top-level
  message cards in chronological order.
- Hydrated alternating user/assistant messages render the same four cards.
- Consecutive assistant messages still share one card; after a user
  interruption, a later assistant message opens a new card.
- Root/orchestrator messages still share one complete card across child-agent
  interruptions from other sessions, and terminal status updates that complete
  card.
- No synthetic cards, gates, or fallback routes are introduced.

## Verification

- `bun test packages/overlay/test/tree-writer-message-tokens.test.ts`
- `bun test packages/overlay/test/conversation-view-hydrate.test.ts packages/overlay/test/conversation-hydrate-replay.test.ts packages/overlay/test/tree-writer-hierarchy.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `$env:OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER='1'; node --test --test-concurrency=1 packages/overlay/test/browser/rewind-visual-stress.test.ts`
- Visual screenshot inspected: `packages/overlay/.scratch/rewind-visual-stress/01-baseline.png`
