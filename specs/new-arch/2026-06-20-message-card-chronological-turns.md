# Message Card Chronological Turns Repair - 2026-06-20

## Problem

Mission, coding assistant, and orchestrator cards are currently not a real message timeline. Later messages in the same runtime session can be folded back into the first visible card, so the UI deletes the later card identity and renders the content out of chronological position. The visible symptom is systemic:

- Mission user messages can be merged into the first user card.
- Coding assistant multi-turn user/assistant history can lose the later turn card identity.
- Orchestrator/scheduler messages around child agents render as one earlier parent card instead of `O1 -> child -> O2`.
- Agent rail can point at a card id derived from the latest message while `tree-writer` has already remapped that message to the first card.

This is not a Mission-only prompt issue and not a scheduler-only issue. The shared projection layer is merging message identities.

## Recall

Read before this repair:

- `specs/new-arch/2026-05-16-overlay-message-turn-agent-cards.md`: initial invariant was per-message turn cards; later correction said a resumed original session opens a new card when another visible session appears in between.
- `specs/new-arch/2026-06-13-conversation-contiguous-timeline-live-message.md`: visible timeline is sorted by real `Message.info.time.created`; display grouping is only contiguous visible timeline.
- `specs/new-arch/2026-06-15-orchestrator-workflow-alignment.md`: later changed root/orchestrator grouping to preserve one complete card across child interruptions.
- `specs/new-arch/2026-06-19-tree-writer-contiguous-segment-regroup.md`: retained `currentSegmentBySession`, which reuses a card after other sessions have appeared.

The 2026-06-15 / 2026-06-19 behavior conflicts with the current bug report and with the older message-turn invariant. The repair chooses chronological message identity as the governing invariant.

## Call Points

| Area                      | File / symbol                                                                                                                                                                                                                              | Decision                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Non-phase card projection | `packages/overlay/src/services/tree-writer.ts` `ensureMessageTurnProjection`, `regroupTimelineSegments`, `timelineCardID`                                                                                                                  | Every visible non-phase message owns one deterministic card id: `<stage>:session:<sid>:message:<mid>`, except integrity's dedicated card. No same-session regroup. |
| Part relocation           | `collectTimelineParts`, `clearTimelinePartIndexes`, `upsertPart`                                                                                                                                                                           | Rebuild parts by message owner; never move parts from a later message into an earlier message card.                                                                |
| Usage/model projection    | `projectUsageOntoCard`, `projectModelOntoCard`                                                                                                                                                                                             | Since non-phase cards are one message each, usage/model are projected to that message card. Phase cards may still aggregate.                                       |
| Hierarchy/order           | `sessionOwnedCardIDs`, `rebuildCardHierarchy`, `rebuildTopLevelOrder`                                                                                                                                                                      | All non-phase message cards stay top-level unless claimed by existing hierarchy rules; global card order remains real time.                                        |
| Hydration                 | `hydrateConversationView`                                                                                                                                                                                                                  | Hydrate first creates per-message cards, then regroup verifies per-message ownership from transcript time.                                                         |
| Agent rail                | `packages/overlay/src/store/conversation-agents.ts`                                                                                                                                                                                        | Hydrated rail targets must use message-level view entries when available, not session-level `lastDisplayMessageID` heuristics.                                     |
| Backend view              | `packages/opencorvus/src/conversation/view.ts`, `packages/opencorvus/src/engine/model.ts`                                                                                                                                                  | Add `messages[]` as the canonical render/rail projection. `sessions[]` remains session metadata and aggregate indexing.                                            |
| Routes                    | `packages/opencorvus/src/server/routes/orchestrator.ts`, `packages/opencorvus/src/server/routes/session.ts`                                                                                                                                | They already call `projectConversationView`; schema and tests cover the new view shape.                                                                            |
| Tests                     | `packages/overlay/test/tree-writer-*`, `packages/overlay/test/conversation-agent-rail-records.test.ts`, `packages/opencorvus/test/server/conversation-view.test.ts`, `packages/opencorvus/test/server/session-conversation-routes.test.ts` | Replace tests that assert same-agent merging; add multi-turn Mission/coding/orchestrator coverage.                                                                 |

## New Invariant

For any displayable non-phase message:

1. The render card id is a function of the real message id.
2. A later message never reuses an earlier non-phase message card, even if both messages share `sessionID`, `stage`, and `goalID`.
3. User cards are never merged.
4. Orchestrator/root cards do not absorb child-agent-interrupted resumes.
5. Phase-absorbed goal sessions continue to render inside the phase card and use boundary parts there.
6. Integrity keeps its dedicated integrity card identity.
7. Hydrated transcript and live SSE produce the same card ids and the same chronological order.
8. Agent rail target ids must refer to an actually renderable card for the target message.

## Acceptance

- Live `user -> assistant -> user -> assistant` in one coding-assistant session renders four cards in timestamp order.
- Live Mission `user -> mission -> user -> mission` renders four cards in timestamp order.
- Live orchestrator `O1 -> child -> O2` renders three top-level cards in timestamp order.
- Out-of-order arrival still reorders by `info.time.created`.
- Hydration produces the same result as live projection.
- Backend `ConversationView.messages` lists displayable messages in timestamp order with placement and phase metadata.
- Agent rail hydrated target for a top-level agent uses the target message card id, not a session aggregate guess.
- Tests that previously expected same-agent top-level message merging are replaced with per-message expectations.
