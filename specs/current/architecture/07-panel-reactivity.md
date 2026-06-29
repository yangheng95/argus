# 07-panel-reactivity — Overlay Reactive Projection

> 对应代码（真源）：`packages/overlay/src/store/card-tree.ts` ·
> `packages/overlay/src/store/messages.ts` · `packages/overlay/src/services/tree-writer.ts` ·
> `packages/overlay/src/services/events.ts` · `packages/overlay/src/services/sse.ts` ·
> `packages/overlay/src/services/chat.ts` · `packages/overlay/src/components/Conversation.tsx` ·
> `packages/overlay/src/components/Board.tsx` · `packages/overlay/src/utils/card-tree.ts` ·
> `packages/overlay/src/utils/workflow-step.ts`

This chapter describes the current Overlay projection contract. Migration
plans, stale root-cause snapshots, and deleted-symbol cleanup logs belong in
the matching month under `specs/records/YYYY-MM/**`, not in this current architecture chapter.

## Current Stores

| Source                    | Current responsibility                                                                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `store/card-tree.ts`      | Store-backed card tree used by the rendered conversation and workflow surfaces. It owns card identity, parent/child edges, top-level order, status fields, parts, and payloads.                                                                              |
| `store/messages.ts`       | Active message-content and chat/request state bridge. It still owns `messages`, `messagesBySession`, pending chat state, transcript hydration state, and helper indexes used by services and tests. It is not deleted and must not be documented as deleted. |
| `services/tree-writer.ts` | Single writer that projects backend events, board data, message segments, interactions, and pending display entries into `cardTreeStore`.                                                                                                                    |
| `utils/card-tree.ts`      | Active render-side helper/type re-export surface used by card rendering and tests. It is not a retired file.                                                                                                                                                 |

## Message Timeline Contract

- Visible message cards follow backend `orderKey` timeline order.
- Adjacent segments may be coalesced only when they share the same aggregation
  key and preserve chronological order.
- `message.part.updated` top-level / `payload.orderKey` is the owning
  message-domain key; `payload.part.orderKey` is the part-domain key.
- Session lifecycle events use session-domain identity and must not force a
  global "one session equals one card" aggregation.
- Hydration and live SSE updates must converge on the same card tree instead of
  maintaining separate UI truth sources.

## Session And Goal Placement

Card IDs are stable and assigned by the tree writer:

- `<stage>:session:<sessionID>:message:<messageID>` for materialized
  message-turn cards.
- `step:<goalID>:<stepID>` for workflow step cards.
- `step:<goalID>:<stepID>:phase:<phaseID>` for backend-declared phase cards.
- `integrity:session:<sessionID>` for the integrity protocol card that groups
  integrity review stream events before message-turn projection.
- `ctx:user-request` for the task request card.
- `interaction-card:<messageID>` for interaction cards that cannot yet be
  attached to a session.

Only goal-owned sessions may be nested under goal step/phase containers. A
session with `parentSessionID` but without `goalID` remains a top-level session
card; parent session metadata does not create visual nesting.

`executor` sessions are container/runtime ownership rows and do not render as
independent agent cards. The build step card represents the visible goal-scope
execution surface.

## Top-Level Order

`rebuildTopLevelOrder` produces the top-level card order from the backend
`orderKey` carried by each projected top-level card. All top-level card kinds
share that single ordering axis:

1. `ctx:user-request`
2. top-level message-turn cards not claimed by a goal phase
3. goal-scope `step:<goalID>:<stepID>` cards
4. orphan `interaction-card:*`

The numbered list above names the participating card families; it is not a
kind-specific ordering rule. Sessions claimed by a goal phase are excluded from
the top-level stream, and every remaining family is sorted on the same backend
`orderKey` value rather than by a family-specific board sequence or local
insertion order.

SSE ordering can be temporarily incomplete. The tree writer records the best
current projection and re-runs ordering when later facts arrive; it must not
create a second hidden projection source.

## Non-Negotiable Constraints

- `cardTreeStore` is the rendered card tree source; no component may maintain a
  parallel rendered tree.
- `tree-writer.ts` is the only service allowed to create or mutate store-backed
  cards.
- `store/messages.ts` remains active for message-content state and cannot be
  documented as deleted while code imports it.
- `utils/card-tree.ts` remains active for renderer helpers and cannot be
  documented as deleted while code imports it.
- Unknown event payloads or impossible card identities must surface as errors;
  current architecture must not document silent fallback, compatibility proxy,
  or hidden alternate rendering paths.

## Verification

- `bun test packages/overlay/test/conversation-hydrate-replay.test.ts`
- `bun test packages/overlay/test/sse-active-elapsed.test.ts`
- Browser tests under `packages/overlay/test/browser/**` that exercise card
  rendering, task switching, MCP/settings panels, and conversation stress.
- `bun test packages/opencorvus/test/script/document-health.test.ts`
