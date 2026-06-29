# Message Card Chronological Turns Repair - 2026-06-20

Status: Superseded by `2026-06-26-message-card-adjacent-segment-timeline.md`
and `2026-06-27-message-card-orderkey-convergence.md`.

This document is historical. Its per-message-card conclusion was replaced by
the adjacent same-segment projection: cards are ordered by backend message
timeline order, and adjacent compatible messages can be absorbed into the
first message's segment card. Interleaved sessions, user/agent role changes,
and goal phase exceptions still prevent incorrect cross-turn merging.

## Problem

Mission, coding assistant, and orchestrator cards are currently not a real message timeline. Later messages in the same runtime session can be folded back into the first visible card, so the UI deletes the later card identity and renders the content out of chronological position. The visible symptom is systemic:

- Mission user messages can be merged into the first user card.
- Coding assistant multi-turn user/assistant history can lose the later turn card identity.
- Orchestrator/scheduler messages around child agents render as one earlier parent card instead of `O1 -> child -> O2`.
- Agent rail can point at a card id derived from the latest message while `tree-writer` has already remapped that message to the first card.

This is not a Mission-only prompt issue and not a scheduler-only issue. The shared projection layer is merging message identities.

## Recall

Read before this repair:

- `deleted pre-June record 2026-05-16-overlay-message-turn-agent-cards`: initial invariant was per-message turn cards; later correction said a resumed original session opens a new card when another visible session appears in between.
- `specs/records/2026-06/2026-06-13-conversation-contiguous-timeline-live-message.md`: visible timeline is sorted by real `Message.info.time.created`; display grouping is only contiguous visible timeline.
- `specs/records/2026-06/2026-06-15-orchestrator-workflow-alignment.md`: later changed root/orchestrator grouping to preserve one complete card across child interruptions.
- `specs/records/2026-06/2026-06-19-tree-writer-contiguous-segment-regroup.md`: retained `currentSegmentBySession`, which reuses a card after other sessions have appeared.

The 2026-06-15 / 2026-06-19 behavior conflicts with the current bug report and with the older message-turn invariant. The repair chooses chronological message identity as the governing invariant.

## Call Points

| Area                      | File / symbol                                                                                                                                                                                                                              | Decision                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Non-phase card projection | `packages/overlay/src/services/tree-writer.ts` `ensureMessageTurnProjection`, `regroupTimelineSegments`, `timelineCardID`                                                                                                                  | Adjacent compatible display messages share the first message's segment card. Interleaved sessions or role changes start a new card. |
| Part relocation           | `collectTimelineParts`, `clearTimelinePartIndexes`, `upsertPart`                                                                                                                                                                           | Rebuild parts by message owner; never move parts from a later message into an earlier message card.                                                                |
| Usage/model projection    | `projectUsageOntoCard`, `projectModelOntoCard`                                                                                                                                                                                             | Usage/model are projected onto the rendered owner card for each message; segment cards may aggregate compatible adjacent messages.                                  |
| Hierarchy/order           | `sessionOwnedCardIDs`, `rebuildCardHierarchy`, `rebuildTopLevelOrder`                                                                                                                                                                      | All non-phase message cards stay top-level unless claimed by existing hierarchy rules; global card order remains real time.                                        |
| Hydration                 | `hydrateConversationView`                                                                                                                                                                                                                  | Hydrate consumes backend `view.messages[]` order keys and transcript payload, then applies the same adjacent segment projection as live events.                     |
| Agent rail                | `packages/overlay/src/store/conversation-agents.ts`                                                                                                                                                                                        | Hydrated rail targets must use message-level view entries when available, not session-level `lastDisplayMessageID` heuristics.                                     |
| Backend view              | `packages/opencorvus/src/conversation/view.ts`, `packages/opencorvus/src/engine/model.ts`                                                                                                                                                  | Add `messages[]` as the canonical render/rail projection. `sessions[]` remains session metadata and aggregate indexing.                                            |
| Routes                    | `packages/opencorvus/src/server/routes/orchestrator.ts`, `packages/opencorvus/src/server/routes/session.ts`                                                                                                                                | They already call `projectConversationView`; schema and tests cover the new view shape.                                                                            |
| Tests                     | `packages/overlay/test/tree-writer-*`, `packages/overlay/test/conversation-agent-rail-records.test.ts`, `packages/opencorvus/test/server/conversation-view.test.ts`, `packages/opencorvus/test/server/session-conversation-routes.test.ts` | Replace per-message-card expectations with adjacent-segment expectations plus interleaving separation coverage.                                                    |

## New Invariant

For any displayable non-phase message:

1. Global card order follows backend message `orderKey`.
2. Adjacent compatible messages in the same rendered segment share the first
   message's card ID.
3. Interleaved sessions, user/agent role changes, and filtered/hidden
   placements start separate cards.
4. Phase-absorbed goal sessions continue to render inside the phase card and
   use boundary parts there.
5. Integrity keeps its dedicated integrity card identity.
6. Hydrated transcript and live SSE produce the same segment card ids and the
   same chronological order.
7. Agent rail target ids come from the actual tree-writer rendered target for
   the target message.

## Acceptance

- Live `user -> assistant -> user -> assistant` in one coding-assistant session renders four cards in timestamp order.
- Live Mission `user -> mission -> user -> mission` renders four cards in timestamp order.
- Live orchestrator `O1 -> child -> O2` renders three top-level cards in timestamp order.
- Out-of-order arrival still reorders by `info.time.created`.
- Hydration produces the same result as live projection.
- Backend `ConversationView.messages` lists displayable messages in timestamp order with placement and phase metadata.
- Agent rail hydrated target for a top-level agent uses the target message card id, not a session aggregate guess.
- Tests that previously expected same-agent top-level message merging are replaced with per-message expectations.
