# 2026-05-16 — Overlay Message-Turn Agent Cards

## 0. Problem

当前 overlay 把一个 agent session 投影成一张 `kind="agent"` card：

```text
<stage>:session:<sessionID>
```

这对短生命周期 specialist agent 可用，但对 long-lived orchestrator 不成立。Orchestrator 每次恢复推理都会在同一个 session 下产生新的真实 `message.updated`，当前 writer 继续把所有后续 parts append 到最早那张 card。结果是：

```text
O card (turn 1 + turn 2 + turn 3 ...)
child agent card
child agent card
```

用户看到的是母卡片一直停在时间线最前面，即使后续 orchestrator 输出发生在 child agent 之后。现有 `boundary` 只能解决卡内文本分隔，不能改变顶层时间线排序。

正确显示模型必须由真实 message turn 驱动：

```text
orchestrator message turn 1 card
child agent message turn card
orchestrator message turn 2 card
child agent message turn card
orchestrator message turn 3 card
```

禁止方案：

- 禁止插入 synthetic separator/message/card。
- 禁止根据 tool name 或 agent name 做关键字分割。
- 禁止用 CSS 或 boundary 加粗伪装为轮次修复。
- 禁止新增一个 UI-only session 容器再把真实 turn card 塞进去；这会重新制造“母卡片聚合”。

## 1. Source Inventory

落盘前按 rule 35 穷举与本设计相关的调用点。

| Area                    | Current source                                                                                                            | Current assumption                                                         | Required decision                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Card identity           | `packages/overlay/src/store/card-tree.ts` ID comment: `<stage>:session:<sid>`                                             | Agent card is session-scoped                                               | Replace display agent card identity with contiguous-session segment ID                                             |
| Card payload            | `CardNode` lacks explicit `sessionID` / `messageID`                                                                       | UI derives session from `card.id`                                          | Add explicit `sessionID` and `messageID`; stop parsing IDs                                                         |
| Writer session index    | `packages/overlay/src/services/tree-writer.ts` `SessionInfo.cardID`                                                       | One session has one render card                                            | Split runtime session index from display card ids                                                                  |
| Writer part index       | `SessionInfo.partIndex: Map<string, number>`                                                                              | Part id targets `session.cardID.parts[index]`                              | Change to `Map<string, { cardID, index }>`                                                                         |
| Message creation        | `handleMessageUpdated`                                                                                                    | `ensureSessionCard` creates/reuses one card then `ensureBoundaryPart`      | Reuse the current session card for consecutive messages; open a new segment after another session interrupts       |
| Part creation           | `handlePartUpdated`                                                                                                       | Missing session creates session card, then writes part to `session.cardID` | Route part by `messageID`; create pending turn card if message metadata has not arrived                            |
| Delta routing           | `handlePartDelta` / `validatePartDeltaTarget`                                                                             | Lookup part index only within session card                                 | Lookup exact `{cardID,index}` target                                                                               |
| Status routing          | `handleSessionStatus` / `handleSessionError` / `drainPendingSessionStatus`                                                | Session lifecycle mutates `info.cardID`                                    | Mutate the current active turn card for that session                                                               |
| Usage routing           | `handleUsageUpdated`                                                                                                      | Session usage mutates `info.cardID`                                        | Mutate current active turn card; do not try to retroactively distribute cumulative usage                           |
| Integrity               | `materializeRunningIntegrity` / `materializeIntegrity` use `session.cardID`                                               | Integrity verdict lives on the session card                                | If integrity remains single-message in practice, it still uses turn card; otherwise verdict applies to active turn |
| Hydrate                 | `hydrateConversationView` iterates `sessionView.messageIDs` but writes into one session card                              | Hydration re-aggregates an entire session into one display card            | Hydrate must mirror live contiguous-session segmenting                                                             |
| Backend view            | `packages/opencorvus/src/conversation/view.ts` groups by session and carries `messageIDs`                                 | Frontend currently re-aggregates those IDs into one display card           | P1 must stop using session grouping as render identity; prefer message-level view                                  |
| Hierarchy               | `rebuildCardHierarchyImpl` iterates `sessions.values()` and uses `info.cardID`                                            | Session card is the node to claim / hide / attach interactions to          | Hierarchy must operate over session-owned turn card ids                                                            |
| Top-level order         | `rebuildTopLevelOrder` sorts cards by `time`                                                                              | Session card birth time equals session first message                       | Turn card birth time is message creation time; existing sorter becomes correct                                     |
| Executor visibility     | `syncExecutorTopLevelVisibility` checks `session.cardID`                                                                  | Empty executor container has one card                                      | Check active/current executor turn card or all session turn cards                                                  |
| Interactions            | `rebuildInteractionCards` attaches by `session.cardID`                                                                    | Interactions attach to the session card                                    | Attach to the active turn card at interaction time; if unavailable, pending until a turn exists                    |
| Chat bubble trace/reply | `ChatBubble.tsx` `sessionIDFromCardID`                                                                                    | Card id format contains session id as suffix                               | Use `node.sessionID`                                                                                               |
| Workflow projection     | `utils/agent-workflow.ts` `sessionIDFromCardID`                                                                           | Card id format contains session id as suffix                               | Use `node.sessionID`, with `phaseSessionID` for phase cards                                                        |
| Board streams           | `Board.tsx` `cardToMessageSegments` splits one agent card by `boundary`                                                   | One card may contain N messages                                            | Keep boundary splitting because a contiguous segment can contain multiple real messages                            |
| Transcript              | `utils/transcript.ts` flatten card parts                                                                                  | One session card exports as one message with boundary parts inside         | Segment cards export in display order; boundary parts preserve grouped message turns                               |
| Tests                   | `tree-writer-hierarchy`, `conversation-view-hydrate`, `delta-coalesce`, `tool-call-generation-stream`, `tree-writer-perf` | Assert `<stage>:session:<sid>` card ids and one-card aggregation           | Update to message-turn card ids and add orchestrator interleaving regression                                       |

## 2. Target Protocol

### 2.1 CardNode fields

Extend the canonical `CardNode` in `packages/overlay/src/store/card-tree.ts`:

```ts
interface CardNode {
  id: string
  kind: CardKind
  sessionID?: string
  messageID?: string
  // existing fields...
}
```

Rules:

- `sessionID` is the runtime session id for trace/reply/cancel/agent workflow.
- `messageID` is the durable message id that owns this display card.
- Renderer and workflow utilities must never parse `sessionID` from `id`.
- Phase cards keep `phaseSessionID` because they are not message-turn cards; they absorb a goal-scoped runtime session.

### 2.2 Display segment card ids

Use deterministic turn card ids:

```ts
function messageTurnCardID(stage: string, sessionID: string, messageID: string): string {
  return `${stage}:session:${sessionID}:message:${messageID}`
}
```

Rationale:

- Keeps old prefix recognizable for diagnostics.
- Adds the first message id in the segment without requiring backend schema changes.
- Sorting is still by `CardNode.time`, not by ID.
- Consecutive messages from the same session can map to the same card id; a later resume after another session interrupts uses that later message id to open a new segment.

### 2.3 Runtime session index

Replace the single display-card pointer with session-owned turn pointers:

```ts
interface PartTarget {
  cardID: string
  index: number
}

interface SessionInfo {
  sessionID: string
  stage: string
  parentSessionID: string
  goalID: string
  messageIDs: Set<string>
  messageCardIDs: Map<string, string>
  activeMessageID?: string
  activeCardID?: string
  partIndex: Map<string, PartTarget>
  executorTopLevelVisible: boolean
}
```

Rules:

- `activeCardID` is the latest message-turn card for session-level events.
- `partIndex` is part-owned, not session-card-owned.
- `messageCardIDs` is the display-card ownership index for hierarchy and hydrate.

## 3. Writer Design

### 3.1 Message creation path

`handleMessageUpdated(event)` becomes:

1. Validate `info.id`, `info.sessionID`, `info.role`, `info.channel`, `info.time.created`.
2. Derive stage from channel exactly as today.
3. Ensure `SessionInfo` exists without creating a display card by session id.
4. Upsert the active segment card: reuse the previous card if the previous visible session is the same session; otherwise create `messageTurnCardID(stage, sessionID, messageID)`.
5. Stamp `sessionID`, `messageID`, `stage`, `role`, `time = info.time.created`, `status = running`.
6. Set `session.activeMessageID` and `session.activeCardID`.
7. Add `messageID -> cardID` to `messageCardIDs`.
8. Reconcile any parts that arrived before message metadata by updating the pending card's title/time/stage.

Newly split cards do not need a `boundary` part at the top. When a consecutive message is grouped into an existing card, insert a `boundary` part before that message's parts.

### 3.2 Part creation path

`handlePartUpdated(event)` must route by `part.messageID`.

If `message.updated` already ran:

- Get `cardID = session.messageCardIDs.get(messageID)`.
- Upsert part into that card.

If part arrives before message metadata:

- Use part-stamped `channel`, `goalID`, `parentSessionID` and `messageID`.
- Create a pending turn card with the same final deterministic id because messageID is already known.
- Use observation time only until `message.updated` overwrites `time` with server `time.created`.

No rename is needed for pending turn cards because `messageID` is stable.

### 3.3 Delta routing

`validatePartDeltaTarget` and `handlePartDelta` must resolve:

```ts
const target = session.partIndex.get(partID)
setCardTreeStore("cards", target.cardID, "parts", target.index, ...)
```

This is mandatory. If delta keeps using `session.activeCardID`, late deltas for an older message can corrupt the newest turn card.

### 3.4 Session status / error

Session lifecycle remains session-scoped in the backend. Display routing:

- `streaming` / `retry`: apply to `session.activeCardID` when present.
- `idle`: apply to `session.activeCardID`.
- `terminal.completed/error/aborted`: apply to `session.activeCardID`.
- If no active card exists yet, buffer in `pendingSessionStatus` as today.

Old turn cards should not be retroactively changed by later session statuses. A new `message.updated` should freeze the previous active card if it is still `running`:

```ts
if (previousActiveCard?.status === "running") {
  previousActiveCard.status = "completed"
}
```

This is not a synthetic lifecycle event; it is a display projection invariant: when a newer real message in the same session starts, the older turn is no longer the active stream.

### 3.5 Usage

`usage.updated` is cumulative for the runtime session. For P1:

- Write usage only to `session.activeCardID`.
- Do not attempt to split usage across historical turn cards.
- A later usage event naturally moves the visible usage chip to the active turn.

Trying to distribute cumulative usage per turn would require backend per-message accounting and is out of scope.

### 3.6 Integrity

Integrity review is already a real session and should follow the same mechanism when it emits normal message rows. If integrity produces one message, it will produce one segment card. `materializeIntegrity(session, payload)` must target `session.activeCardID`, not `session.cardID`.

If an integrity completed event arrives before message metadata, keep the existing pending map keyed by `sessionID`; drain it after the first turn card materializes.

### 3.7 Goal phase absorbed sessions

Goal phase cards are the exception already present in the system: build/planner/evaluator goal-scoped sessions write parts directly into a `kind="phase"` card. P1 keeps that behavior unchanged because the visible boundary is the phase card, not a top-level session agent card.

Rule:

- If `resolvePhaseOrSessionCardID` resolves to a phase card, route parts to that phase card as today.
- Add `sessionID` / `messageID` only if useful for diagnostics, but keep `phaseSessionID` as the reply/trace target.
- Do not create nested message-turn cards under phase cards in P1. That would expand the goal card hierarchy and has separate visual implications.

This means the first deliverable fixes top-level orchestrator/specialist interleaving. Phase-internal multi-turn display can be a later, separate design if needed.

## 4. Hierarchy and Ordering

### 4.1 Top-level order

`rebuildTopLevelOrder` can remain mostly unchanged. Once each turn card has `time = message.info.time.created`, chronological sorting naturally yields:

```text
orchestrator turn 1
requirements turn
orchestrator turn 2
architect turn
orchestrator turn 3
```

No special "move parent after child" logic is allowed.

### 4.2 Child ownership

For non-phase sessions, turn cards are top-level by default. Child sessions are also top-level by design today; this plan does not introduce parent nesting.

Interactions currently attach to `session.cardID`. Replace with:

- Prefer the latest turn card at or before the interaction creation time.
- If no such turn exists, keep as orphan top-level until hierarchy rebuild after message hydration.

This prevents interaction prompts from attaching to an arbitrary first session card.

### 4.3 Hidden executor containers

The executor container session is hidden unless it has display parts. With turn cards:

- Hide executor turn cards with no display parts.
- Surface executor turn cards that receive visible parts.
- `executorTopLevelVisible` should be derived from all visible turn cards for the session or dropped in favor of direct `rebuildTopLevelOrder`.

## 5. Renderer and Utility Changes

### 5.1 ChatBubble

`ChatBubble.tsx` must remove local `sessionIDFromCardID`.

```ts
const traceSessionID = createMemo(() => (props.node.kind === "agent" ? props.node.sessionID : undefined))
```

Reply/cancel remains session-scoped and uses `node.sessionID`.

### 5.2 Agent workflow

`utils/agent-workflow.ts` must remove card-id parsing:

```ts
const sessionID = card.kind === "phase" ? String(card.phaseSessionID || "") : String(card.sessionID || "")
```

Multiple turn cards for the same session should merge into one workflow record keyed by `sessionID`, with:

- `startedAt = min(card.time)`
- `lastObservedAt = max(card.time, card.timeCompleted)`
- `cardID` / `renderedCardID` pointing to latest observed card unless a phase owner overrides it

### 5.3 Board requirements stream

`Board.tsx` currently splits one card into N message segments by boundary. After P1:

- New turn cards should produce one segment directly.
- Keep boundary split only for legacy/hydrated cards if any remain during transition tests.
- Once all writer paths produce turn cards, delete the boundary grouping requirement for agent cards.

### 5.4 Transcript

`flattenCardToMessages` should treat each message-turn card as one transcript message. Boundary parts should not be included for new turn cards.

The transcript order becomes more faithful because top-level card order now matches actual message chronology.

## 6. Hydrate and Backend Contract

Subagent breakage audit found the highest replay risk here: if live SSE creates message-turn cards but hydrate still consumes `ConversationSessionView.messageIDs` as a session aggregate, refresh/reconnect will collapse history back into one card. Therefore P1 cannot leave hydrate semantics unchanged.

### 6.1 Required hydrate invariant

Hydrate must rebuild the exact same visible card identity that live SSE would have built:

```text
transcript message id -> contiguous session segment card id
```

It must not use `sessionView.messageIDs` as permission to aggregate an entire session into one card. It may aggregate only contiguous messages from the same session, matching live SSE projection.

### 6.2 Preferred P1 contract

Change `packages/opencorvus/src/conversation/view.ts` from session-render view to message-render view:

```ts
interface ConversationMessageView {
  messageID: string
  sessionID: string
  stage: string
  parentSessionID?: string
  goalID?: string
  createdAt: number
  placement: "top_level" | "goal_phase" | "hidden" | "filtered"
  phase?: ConversationPhaseLocation
}

interface ConversationView {
  messages: ConversationMessageView[]
}
```

The frontend `hydrateConversationView(view, transcript)` then iterates `view.messages` and writes cards by the same contiguous-session segmenting rule used by live SSE. Session metadata remains available, but it is no longer the render grouping key.

### 6.3 Acceptable fallback only if backend contract churn is deferred

If changing the backend route in the same PR is too broad, the frontend must ignore `view.sessions[].messageIDs` for render grouping and instead derive message views directly from `transcript`. In that variant, `view.sessions` may only provide phase/session metadata. It must not drive card identity.

This is not a compatibility fallback; it is a temporary implementation ordering choice. The render identity is the first `messageID` in a contiguous segment, not the whole session id.

### 6.4 Existing backend evidence

The backend already has the raw data needed for message-level hydrate:

- `packages/opencorvus/src/orchestrator/protocol/message-bridge.ts` stamps `resolvedRole`, `channel`, `goalID`, and `parentSessionID` onto message events.
- `message.updated` carries `info.id`, `info.sessionID`, and `info.time.created`.
- `message.part.updated` carries `part.messageID` and `part.sessionID`.
- `projectConversationView` already sorts transcript by `info.time.created`; it only needs to stop collapsing rows into `bySession`.

## 7. Test Plan

Must update or add tests before implementation is complete.

### 7.1 New regression tests

1. `tree-writer` interleaves orchestrator turns with child agent cards:

```text
message.updated O1 at t=100
message.updated child at t=200
message.updated O2 at t=300
expect(order).toEqual([O1Card, childCard, O2Card])
expect(O1Card.parts).not.toContain(O2 parts)
```

2. Delta routing targets original turn card after a newer message starts:

```text
O1 part P1
O2 starts
delta for P1
expect(delta lands in O1Card)
```

3. `session.status terminal` updates only active turn card.

4. Hydrate with two consecutive messages in one session creates one card with a boundary; hydrate with another session between them creates two cards.

5. `ChatBubble` trace/reply uses `node.sessionID`, not card id parsing.

6. `agent-workflow` merges multiple cards with same `sessionID` into one workflow record.

### 7.2 Existing tests expected to change

- `packages/overlay/test/tree-writer-hierarchy.test.ts`
- `packages/overlay/test/conversation-view-hydrate.test.ts`
- `packages/overlay/test/conversation-hydrate-replay.test.ts`
- `packages/overlay/test/delta-coalesce.test.ts`
- `packages/overlay/test/tree-writer-perf.test.ts`
- `packages/overlay/test/tool-call-generation-stream.test.ts`
- `packages/overlay/test/chat-bubble-routing.test.ts`
- `packages/overlay/test/agent-workflow*.test.ts`
- `packages/overlay/test/copy-actions.test.ts`

### 7.3 Perf acceptance

Current `tree-writer-perf` protects against O(N²) message/part handling. P1 must preserve:

- Part delta update is O(1) via `partIndex`.
- Creating a new turn card does not scan all cards except existing top-level order rebuild paths already covered by tests.
- Hydrate may be O(messages log messages) for sorting, but not O(messages²).

## 8. Rollout Order

1. Add `CardNode.sessionID/messageID` and update renderer utilities to prefer explicit fields while still tolerating existing test fixtures.
2. Refactor `SessionInfo` and `partIndex` in `tree-writer`.
3. Implement message-turn card creation for non-phase sessions.
4. Update delta/status/usage/integrity routing to active/target turn cards.
5. Update hydrate/backend conversation view so replay creates the same contiguous-session segments as live SSE.
6. Update Board/transcript/workflow utilities.
7. Update tests and add the interleaving regression.
8. Remove boundary insertion for new non-phase agent cards after tests no longer rely on it.

## 9. Risk Assessment

破坏性等级：中高。

Why not high:

- Backend already emits required message/session metadata.
- Card tree is already a projection layer; DB migration is not required.
- Existing top-level chronological sort becomes more correct, not more complex.

Why not low:

- `tree-writer` has many direct `session.cardID` assumptions.
- Tests assert old card IDs extensively.
- ChatBubble and workflow currently parse session from card ID.
- Hydrate currently re-aggregates session messages.

Primary failure modes:

- Late deltas written to newest turn card if `partIndex` is not target-card-aware.
- Terminal status updates old or missing card if `activeCardID` is not set correctly.
- Refresh/reconnect collapses history back into one card if hydrate still renders from session-grouped `messageIDs`.
- Trace/reply breaks if any renderer still parses `sessionID` from new card IDs.
- Workflow rail duplicates one session as multiple agents if records are keyed by cardID instead of sessionID.
- Board requirements stream double-splits or drops parts if boundary logic and turn-card logic both run.

## 10. Acceptance Criteria

- Long-lived orchestrator session with multiple real messages renders multiple top-level agent cards in chronological order.
- Child agent cards naturally appear between orchestrator turn cards by `time.created`.
- No synthetic messages/cards/separators are introduced.
- `message.part.delta` updates the card that owns the original part, even after newer messages start in the same session.
- Trace/reply/cancel work from message-turn agent cards.
- Hydrated historical transcript matches live SSE projection for multi-message sessions.
- Existing phase-absorbed build/planner/evaluator cards remain stable.

## 11. Subagent Breakage Review Integration

Independent subagent review classified the change as P0/P1-risky in the projection layer and identified three required corrections to the initial design:

1. `partIndex` must carry `cardID` as well as `index`; otherwise late deltas will write into the wrong turn card.
2. Hydrate cannot remain session-grouped. Either backend `ConversationView` becomes message-level, or frontend derives message views directly from transcript and treats session view as metadata only.
3. Phase-absorbed sessions must be explicitly scoped. P1 keeps current phase-card absorption unchanged; it must not create both phase-level parts and nested message cards for the same build/planner/evaluator session.

These findings are reflected in sections 3.2, 3.3, 3.7, and 6.

## 12. Implementation Review Follow-up

2026-05-16 independent Codex review found two P2 issues during implementation review:

1. `rebuildInteractionCards` still attached interaction cards to `session.activeCardID`. This was incorrect after message-turn cards because hierarchy rebuilds after a newer turn could move an older interaction prompt from the turn that was active at prompt time to the newest turn. Implementation now selects the latest session-owned turn card whose `CardNode.time` is less than or equal to the interaction message time, and `tree-writer-hierarchy.test.ts` includes a regression named `interaction remains attached to the turn active at interaction time`.
2. Integrity review events remain a protocol exception in P1. Backend `integrity.review.started`, `integrity.review.progress`, `integrity.review.chunk`, and `integrity.review.completed` carry `sessionID` but do not carry a durable `messageID`; `started/progress/chunk` can arrive before any message metadata for that integrity session. Therefore the overlay keeps the existing single `integrity:session:<sessionID>` card for `integrity.review.*` protocol events rather than inventing a synthetic message id. If the backend later emits integrity verdict/progress as normal `message.updated` / `message.part.updated` rows with real message ids, this exception must be removed and integrity must route through the standard message-turn mechanism.

## 13. User Correction: Segment, Not Every Message

Implementation review after visual inspection corrected the display target:

- Wrong: one card for every `message.updated`.
- Correct: one card for a contiguous visible run of the same runtime session.

Rules:

- Consecutive messages from the same session reuse the current agent card.
- If another session opens a visible agent card in between, the original session opens a new card when it resumes.
- The card id still uses the first message id in that segment:

```ts
;`${stage}:session:${sessionID}:message:${firstMessageIDInSegment}`
```

- `messageCardIDs` may therefore map multiple `messageID`s to the same display card.
- Grouped messages inside one card use a real `boundary` part so Board / rail previews can still split message segments without flattening distinct turns into one text blob.
- Hydrate must follow the same contiguous-session rule as live SSE replay.
