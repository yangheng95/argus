# Overlay Card Projection Fragility Audit

Date: 2026-06-02
Status: Phase 1 implementation planned
Owner: Codex

## Trigger

User report:

`review.stream.chunk arrived before started`

The immediate symptom was fixed in `2026-06-02-review-stream-start-reconstruction.md`, but the more important issue is systemic: the card projection layer is fragile because it often requires the current frontend process to have observed a complete event prefix.

## What Is Actually Fragile

The problem is not the visual card component. It is the event-to-card projection model in `packages/overlay/src/services/tree-writer.ts`.

`tree-writer` currently owns four responsibilities at once:

1. Protocol validation: reject malformed or retired events.
2. Projection state indexing: `sessions`, `messages`, `partIndex`, `runningReviews`, `pendingIntegrity`, `pendingSessionStatus`.
3. Card materialization: create/update `CardNode` objects.
4. Placement and hierarchy: top-level ordering, session nesting, phase absorption, integrity reviewer nesting.

That mix makes every handler easy to write as "assume prior event X already ran", which is not true under tail hydrate, paged history, live replay, reconnect, or task-list selected-task recovery.

## Call-Site Sweep

Search basis:

```text
rg -n "\.get\(|throw new Error\(|pending|Map<|ensure|missing|before|reconstruct|materialize|activeCardID|partIndex|runningReviews|sessions|messages" packages/overlay/src/services/tree-writer.ts
```

### Fragility Classes

| Class | Current examples | Current behavior | Correct direction |
| --- | --- | --- | --- |
| Reconstructable identity missing from memory | `runningReviews.get(reviewID)` before review `progress/chunk`; `sessions.get(sessionID)` before some lifecycle events. | Previously threw for review chunks; lifecycle status buffers in `pendingSessionStatus`. | Every event with enough durable identity must route through an explicit `ensure*Projection` primitive. |
| Non-reconstructable stream delta | `message.part.delta` requires `session.partIndex.get(partID)`. | Throws and selected-task recovery must replay from live cursor. | Keep loud; no frontend reconstruction because delta lacks durable full part shape. |
| Part/message removal without local index | `message.removed`, `message.part.removed` require `sessions` and `partIndex`. | Throws if local tree has not loaded the target. | If event is older than selected cursor, drop before writer; if live selected event, recover from server tail. Do not create placeholder deletes. |
| Completion before running state | `integrity.review.completed` can materialize the card from `sessionID`. | Already uses `ensureIntegritySession`. | This is the pattern to reuse: completion/progress/chunk should not depend on a started side effect when identity is present. |
| Board/test active-source drift | Tests wrote `selectedTaskID` while runtime uses `selectedSource` as active task truth. | Recovery tests falsely failed because `activeTaskID()` returned empty. | Tests must use the same source selector as runtime; do not reintroduce dual selected-task sources. |
| Card protocol drift | `CardNode` still uses `kind`, `stepPayload`, `toolPart`, `integrity`, ad-hoc fields despite `12-overlay-card-system.md` target. | Business semantics leak into renderer/writer branches. | Implement the Shell / Variant / Payload / Policy split or explicitly retire that target spec. |

## What Must Stay Loud

Not every throw is fragility. These must remain hard errors:

- Unknown event type.
- Retired event family accidentally reaching the writer.
- Unknown `review.stream.phase`.
- Unknown `review.stream.kind`.
- Missing required payload identity (`taskID`, `reviewID`, `messageID`, `sessionID`, `partID`) when no durable reconstruction path exists.
- Missing server-owned timestamps where the backend contract says they are required.

The fix is not a permissive fallback card and not silently ignoring events.

## Principle

Projection should follow this decision order:

1. Is the event malformed by schema or retired contract? Throw.
2. Does the event contain enough durable identity to materialize the target card from a single source? Reconstruct through an explicit `ensure*Projection`.
3. Does the event depend on unavailable volatile stream state, such as `message.part.delta` without a known part target? Trigger selected-task recovery before writer or throw if directly invoked in tests.
4. Never invent a generic unknown card.

## Required Follow-Up

### Phase 1: Projection Primitive Extraction

Add explicit projector primitives in `tree-writer`:

- `ensureSessionProjection(sessionID, opts)`
- `ensureMessageTurnProjection(sessionID, messageID, opts)`
- `ensureIntegrityReviewProjection(reviewID, opts)`
- `ensurePartProjection(part, opts)`

Handlers should call these named primitives instead of open-coding assumptions about `sessions`, `messageCardIDs`, or `runningReviews`.

#### Phase 1 Implementation Boundary

This pass is deliberately limited to `packages/overlay/src/services/tree-writer.ts` plus direct tree-writer/router tests. It does not change `CardNode`'s public render protocol and does not introduce a second renderer.

Call-site inventory from 2026-06-02 sweep:

| Surface | Existing call sites | Phase 1 decision |
| --- | --- | --- |
| `applyEvent` | Single exported writer entry point; imported by `services/events.ts`, `services/chat.ts`, and tests. | Keep as the only mutation entry point. |
| `hasProjectedPart` | Imported only by `services/events.ts` for executor conversion. | Keep; it queries the same internal part index. |
| `hydrateConversationView` | Imported by `services/conversation.ts` and tests. | Route hydrate part insertion through the same part primitive used by live events. |
| `resetWriter` | Imported by task switching, mission, conversation hydrate, and tests. | Keep reset semantics; clear any new primitive-owned indexes here. |
| `runningReviews.get` | Used by review stream progress/chunk handlers. | Replace direct lookup with `ensureIntegrityReviewProjection` so reconstructable review events do not depend on observing `started`. |
| `sessions.get` in `message.*` removal/delta | Used for events without enough full payload to reconstruct. | Keep loud failure, but express it through `requireSessionProjection` / `requirePartProjection` so recovery-triggering errors stay intentional. |
| `ensureSession` / `ensureTurnCard` / `upsertPart` | Internal helpers currently form an implicit primitive set. | Rename/wrap into explicit projection primitives without changing card identity. |

Phase 1 code shape:

1. Add explicit primitive names in `tree-writer.ts`:
   - `ensureSessionProjection(...)` wraps the runtime session index.
   - `ensureMessageTurnProjection(...)` wraps deterministic card materialization for a message.
   - `ensurePartProjection(...)` validates full part payload, ensures the owning session/turn, and upserts the part.
   - `requireSessionProjection(...)` and `requirePartProjection(...)` make non-reconstructable deltas/removals loud by design.
   - `ensureIntegrityReviewProjection(...)` wraps started/progress/chunk running review lookup and reconstruction.
2. Rewrite `handleMessageUpdated`, `handlePartUpdated`, hydrate part replay, and review stream handlers to use those primitives.
3. Add regression tests for the boundary:
   - part-before-message still materializes one deterministic turn card.
   - delta/removal/message removal without projection still throws the exact prerequisite errors.
   - completed integrity verdict before started/progress/chunk remains terminal and is not downgraded by late running events.

Non-goals for Phase 1:

- No generic placeholder cards.
- No host-side gate to suppress tree-writer errors.
- No fallback role/channel inference.
- No Shell / Variant / Payload / Policy migration in this pass.

### Phase 2: Tail-First Contract Tests

For every event family with durable identity, add tests where the first visible event is not the first lifecycle event:

- `review.stream.chunk` before `review.stream.started` (done).
- `review.stream.progress` before `review.stream.started` (done).
- `integrity.review.completed` before any message stream (already covered).
- `session.status` before first message/card (already covered via pending status).
- `message.part.updated` before `message.updated` (already covered by part-before-message path).

For every event family without enough durable identity, tests must prove recovery or loud failure:

- `message.part.delta` before part target.
- `message.part.removed` before part target.
- `message.removed` before message target.

### Phase 3: Card Protocol Convergence

Resolve `12-overlay-card-system.md` drift:

- Either implement `shell + variant + payload + ui` as the real `CardNode` protocol.
- Or revise the spec to match current `kind + ad-hoc payload fields`.

Leaving target spec and implementation divergent is itself a source of repeated card bugs.

## Current Fix Status

The current review stream fix is valid but partial:

- It addresses one reconstructable identity path.
- It does not make `tree-writer` generally robust.
- It should be treated as Phase 0, not as completion of the card projection cleanup.
