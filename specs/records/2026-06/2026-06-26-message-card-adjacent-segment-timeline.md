# Message Card Adjacent Segment Timeline

Date: 2026-06-26
Status: P1 implemented and verified; 2026-06-27 build part-first repair verified; cross-domain orderKey convergence continues in `2026-06-27-message-card-orderkey-convergence.md`

## Acronyms

- UI: User Interface, the visible overlay surface.
- SSE: Server-Sent Events, the live task/session event stream.
- DB: Database, the persisted project state.
- ID: Identifier, a stable row or event identity.

## Problem

The current conversation card projection has two incompatible display models:

- Goal phase cards aggregate multiple goal-scoped messages into one process
  card.
- Ordinary non-phase user and agent messages render as one card per displayable
  message after the 2026-06-20 chronological-turn repair.

The older global aggregation model also failed: later user, Mission, coding
assistant, and orchestrator messages could be folded back into the first card
for the same session/stage, so the visible timeline lost the real chronological
position. The new target is stricter:

1. Cards appear according to the real message timeline.
2. Only adjacent messages with the same display segment key are absorbed into
   one card.
3. A later message must never be folded into an earlier card after another
   visible segment has appeared between them.

This supersedes only the "every displayable non-phase message owns one card"
part of `2026-06-20-message-card-chronological-turns.md`. It keeps that spec's
root repair: no session-global regrouping and no rail target guesses that point
at a non-rendered card.

## Recall

| Source                                                        | Constraint carried forward                                                                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AGENTS.md`                                                   | No fallback, no double source, no blind patching, inspect disk plans before edits, and visually verify UI changes.                               |
| `12-overlay-card-system.md`                                   | Store-backed cards must go through the writer/reconciler; renderer components must not invent placement, sorting, or aggregation.                |
| `2026-05-16-overlay-message-turn-agent-cards.md`              | The first correct model was contiguous segment cards, not whole-session cards; late deltas must target the exact owner card.                     |
| `2026-06-13-conversation-contiguous-timeline-live-message.md` | The visible timeline is sorted by real message creation time; grouping is only contiguous visible timeline grouping.                             |
| `2026-06-19-tree-writer-contiguous-segment-regroup.md`        | Consecutive same-stage messages can share one card, but the implemented `currentSegmentBySession` still allowed bad reuse across interruptions.  |
| `2026-06-20-message-card-chronological-turns.md`              | Per-message cards fixed the regrouping bug and added `ConversationView.messages[]`; this design must not reintroduce the old global aggregation. |
| `2026-06-25-agent-rail-execution-ledger-source.md`            | Agent rail existence comes from the durable session ledger; message cards only provide navigation targets.                                       |

## Independent Audit Consensus

Three read-only sub-agent audits converged on these facts:

- Ordinary user/agent cards are projected in
  `packages/overlay/src/services/tree-writer.ts` and rendered from
  `cardTreeStore.order` by `Conversation.tsx`.
- Goal timeline cards are board-derived `step` / `phase` process cards, not the
  same object as a normal message card. `TaskProgressBar` is a separate surface
  and does not write `cardTreeStore`.
- Historical ordinary message projection was one displayable non-phase message
  per card. That behavior is superseded here: adjacent same-segment messages
  merge into the first message's rendered card, while interrupted messages stay
  separate in chronological order.
- The real double-source risk is projection duplication: backend
  `ConversationView.messages[]` already contains display metadata, while
  overlay hydrate currently recalculates stage, placement, phase, goal, and card
  target from transcript/session metadata.
- Agent rail duplicates tree-writer card target formulas in
  `conversation-agents.ts`; any card ID semantics change must remove that copy
  or rail navigation will drift.
- The backend does not currently expose one canonical global order stream for
  messages, protocol lifecycle, control timeline, goal board rows, and rail
  ledger rows. A full cross-domain timeline needs an explicit backend order
  contract; it cannot be inferred safely in the renderer.

## Root Cause

The system has alternated between two incomplete extremes:

- Global session/stage aggregation preserves fewer cards but destroys
  chronological identity when later messages are separated by other visible
  messages.
- Per-message rendering preserves chronology but loses the intended adjacent
  absorption behavior and diverges from goal phase presentation.

The missing abstraction is a single display-segment projector:

```text
ordered display messages -> adjacent segments -> card tree + message target map
```

Renderer components should receive the result. They must not decide grouping.

## Required Semantics

### 1. Display Timeline Source

For message-backed conversation cards, the projection source is the ordered
display message list:

- Hydrate path: `ConversationView.messages[]` is the display metadata source.
  Transcript rows provide parts and per-message payload only. A transcript row
  missing from `view.messages[]`, or a `view.messages[]` row missing a matching
  transcript message when parts are required, is a loud contract error.
- Live path: accepted `message.updated` / displayable `message.part.updated`
  events update the same message index and then run the same segment projector.
- `view.sessions[]` remains session metadata for parentage, lifecycle, and rail
  seeding. It must not drive render grouping.

For P1, message order is:

```text
Message.info.time.created ascending, then messageID ascending
```

The backend and frontend must use the same tie-break. A later P2 can replace
this with a durable backend `orderKey`, but P1 must not leave hydrate/live with
different same-millisecond ordering.

### 2. Segment Key

A non-phase message can absorb into the immediately previous visible segment
only when all fields in the segment key match:

```text
placement
sessionID
stage
goalID
parentSessionID
```

Consequences:

- Consecutive user messages in the same runtime session and stage share one
  user bubble.
- Consecutive assistant/agent messages in the same runtime session and stage
  share one agent bubble.
- Alternating `user -> assistant -> user -> assistant` remains four cards
  because `stage` differs.
- `orchestrator O1 -> child agent -> orchestrator O2` remains three cards
  because O2 is not adjacent to O1 after global sorting.
- Same-stage messages from different sessions never merge.
- Same session/stage messages with different goal or parent context never
  merge.

### 3. Segment Identity

The segment card ID is the first message in the segment:

```text
<stage>:session:<sessionID>:message:<firstMessageIDInSegment>
```

Every message in the segment maps to that card in `SessionInfo.messageCardIDs`.
Late part deltas keep using `partIndex: { cardID, index }`, so an update for a
message absorbed into a segment writes to the segment card that owns the part.

Segment cards must add a real `boundary` part before every absorbed message
after the first, not only for integrity cards. Board/transcript utilities that
read `cardMessageSegments` must treat boundary parts as the intra-card message
split source.

### 4. Goal Phase And Integrity

Goal phase cards remain explicit exceptions:

- Goal-scoped build/planner/evaluator messages are absorbed into the phase card.
- Phase card internal parts are ordered by the same message order key and use
  boundary parts per message.
- Do not create nested message-turn cards under phase cards in P1.

Integrity remains a protocol exception until its progress/verdict arrives as
normal durable message rows. Its dedicated `integrity:session:<sessionID>` card
can continue to aggregate integrity review stream events.

### 5. Rail Target Ownership

Agent rail existence remains ledger-owned. Message and part events only attach
or refine navigation targets.

The rail must not duplicate the card ID formula. The tree-writer segment
projector must expose the actual message target map:

```ts
{
  messageID: string
  sessionID: string
  renderedCardID: string
  cardID?: string
  time: number
}
```

`conversation-agents.ts` consumes that target map. If `msg_b` is absorbed into
the card opened by `msg_a`, rail target for `msg_b` must point at
`...:message:msg_a`, not a guessed `...:message:msg_b`.

### 6. Usage And Model Metadata

Usage is segment-scoped:

- Sum input, output, total, and cost for all assistant messages in the segment.
- Context token hint uses the latest message in the segment that reports a
  context count.

Model display must not lie:

- If all model-bearing assistant messages in a segment have the same
  provider/model, show that model.
- If a segment contains multiple distinct provider/model values, do not show a
  single latest model as if it applies to the whole segment. P1 should clear the
  card-level `model`; a later UI can add an explicit multi-model detail.

### 7. Part-First Events

A part-first display event may create or update the message index, but final
ordering cannot use `Date.now()` as a hidden order fallback.

Required rule:

- Prefer the server-stamped message time when `message.updated` exists.
- For part-first live display before `message.updated`, use an explicit event
  emitted timestamp if present and mark the message as pending server time.
- When `message.updated` arrives, regroup by server time.
- If neither server message time nor event emitted time exists for a displayable
  part, fail loudly or trigger the existing selected-task recovery path; do not
  silently park the card at local observation time.

## Call Point Inventory

| Surface                                                                        | Current evidence                                                                        | Required change                                                                                                     |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `tree-writer.ts::regroupTimelineSegments`                                      | Builds one segment per displayable non-phase message except integrity.                  | Replace with linear adjacent segment scan over the ordered message list.                                            |
| `tree-writer.ts::ensureMessageTurnProjection`                                  | Creates deterministic per-message card IDs before regrouping.                           | Keep deterministic pending IDs, but after regroup all message IDs map to the segment's first-message card.          |
| `tree-writer.ts::collectTimelineParts` / `partIndex`                           | Already gathers parts by message and indexes exact `{cardID,index}` targets.            | Rebuild segment parts with boundary rows for absorbed messages and repoint all part targets.                        |
| `tree-writer.ts::hydrateConversationView`                                      | Recomputes projection from transcript and uses session metadata as backup.              | Use `view.messages[]` as display metadata; transcript is part payload. Missing or conflicting metadata is an error. |
| `conversation/view.ts::projectConversationView`                                | Sorts by created time only.                                                             | Add the same message ID tie-break used by overlay.                                                                  |
| `server/routes/orchestrator.ts`, `server/routes/session.ts`                    | Some transcript loads sort by created time only.                                        | Align transcript ordering with the message order key.                                                               |
| `conversation-agents.ts::renderedTargetForMessage` / `liveMessageRecordTarget` | Copies the message-card ID formula.                                                     | Consume tree-writer/shared segment targets instead of guessing.                                                     |
| `utils/card-tree.ts::cardMessageSegments`                                      | Existing boundary semantics are mostly phase/integrity oriented.                        | Treat ordinary segment boundaries as first-class message splits.                                                    |
| `CardNode` comments in `store/card-tree.ts`                                    | Comments currently describe segment semantics while tests enforce per-message behavior. | Update comments to the new adjacent segment contract.                                                               |
| `events.ts` executor `run.progress` / `run.output` handling                     | Historical conversion produced synthetic conversation messages from executor protocol events. | Removed by `2026-06-27-message-card-orderkey-convergence.md`; executor-visible conversation content must come from durable backend `message.*` rows. |

## Non-Goals

- Do not create a renderer-level aggregation layer in `Conversation.tsx`,
  `ChatBubble.tsx`, or `Card.tsx`.
- Do not keep both per-message card IDs and segment card IDs as alternate
  navigation targets.
- Do not add "try old ID if new ID is missing" compatibility.
- Do not use `view.sessions[]` to hide missing message metadata.
- Do not make `ConversationAgentRail` scan `cardTreeStore`.
- Do not attempt a full cross-domain timeline for protocol events, control
  timeline, board goal rows, and message rows until the backend exposes a
  canonical order contract for all of them.

## Multi-Stage Goal

Long-lived goal:

> Deliver one enterprise-grade message-card projection design where visible
> message cards are ordered by the conversation timeline, adjacent compatible
> messages are absorbed into one segment card, goal phase cards keep their
> explicit exception, and rail navigation targets come from the same projection
> source as rendered cards.

Enterprise-grade code here means deterministic ordering, one projection source,
typed contracts, focused regression coverage, visual verification for the
overlay surface, and deletion of the obsolete double-source logic touched by
the change. It does not mean adding compatibility paths, renderer-side policy,
runtime gates, or hidden alternate card targets.

### Stage 0. Evidence Lock And Scope Freeze

Deliverables:

- Preserve this spec as the active implementation contract.
- Keep the call point inventory current before editing any implementation file.
- Record every newly discovered caller, test, or historical contradiction in
  this file before changing behavior.

Acceptance:

- The implementation scope remains the ordinary display-message card path,
  goal phase absorption, rail message targets, and the backend/overlay display
  ordering contract listed above.
- Cross-domain ordering now uses backend-owned `orderKey` where each surface
  enters the UI. Remaining per-surface convergence is tracked by
  `2026-06-27-message-card-orderkey-convergence.md`.

### Stage 1. Canonical Display Message Ordering

Deliverables:

- Add one shared ordering helper for display messages: `time.created`, then
  message ID.
- Use that order in backend conversation projection, task/session transcript
  routes, overlay hydration, and live tree-writer regrouping.
- Remove any final-order dependency on local `Date.now()` for converted
  executor messages.

Acceptance:

- Backend and overlay tests prove equal timestamps are ordered identically.
- Hydrate and live streaming produce the same ordered message list before
  segment aggregation is considered.

### Stage 2. Single Segment Projector

Deliverables:

- Introduce one pure projector that scans the ordered display-message list and
  returns segment cards plus the `messageID -> renderedCardID` map.
- Replace per-message card creation and session-global regrouping with adjacent
  segment scanning.
- Add ordinary message boundaries for absorbed messages after the first
  message in a segment.

Acceptance:

- Consecutive compatible same-session messages merge only when they are
  adjacent in the ordered display timeline.
- Interleaved sessions, different stages, different placements, different
  goals, or different parent sessions never merge.
- `O1 -> child -> O2` stays three cards even when O1 and O2 share the same
  session ID.

### Stage 3. Hydrate And Live Convergence

Deliverables:

- Make hydration use `ConversationView.messages[]` as the message metadata
  source and transcript payloads only as payloads.
- Ensure late `message.updated` and displayable `message.part.updated` events
  update the segment card that already owns the message.
- Fail visibly in tests on metadata drift instead of silently reconstructing
  order from transcript traversal.

Acceptance:

- Replay/hydrate tests and live SSE tests assert identical card IDs, root order,
  part boundaries, and target maps for the same fixture.

### Stage 4. Rail Target Convergence

Deliverables:

- Keep rail session existence sourced from the execution ledger.
- Remove duplicated message-card ID formulas from rail target construction.
- Feed rail message targets from the tree-writer/shared segment target map.

Acceptance:

- Rail entries for absorbed messages scroll to the actual segment card whose ID
  uses the first message in the segment.
- Lifecycle-only sessions remain visible in the rail without producing blank
  conversation cards.

### Stage 5. Renderer And Metadata Cleanup

Deliverables:

- Keep `Conversation.tsx`, `Card.tsx`, and `ChatBubble.tsx` free of grouping
  policy.
- Update transcript/copy helpers to treat ordinary message boundaries as
  first-class segment splits.
- Sum usage across all messages in a segment and clear card-level model
  metadata when the segment contains multiple distinct models.
- Delete obsolete comments, tests, and helper paths that still describe
  per-message cards as the target behavior.

Acceptance:

- Rendering components receive already-projected cards and do not infer
  timeline grouping.
- Multi-message segment metadata is not misleading.

### Stage 6. Visual QA And Merge Readiness

Deliverables:

- Update focused unit tests and browser tests from "no same-session merging" to
  "adjacent segment aggregation".
- Run isolated browser visual QA with Node-based Playwright runner.
- Review screenshots for chronological order, merged boundaries, rail scrolling,
  and absence of duplicated or missing cards.

Acceptance:

- The focused test list in this spec passes.
- Browser screenshots show the accepted card chronology and segment absorption
  behavior.
- A second code review confirms no renderer aggregation, fallback target lookup,
  or parallel old/new projection path remains.

### Stage 7. Durable Cross-Domain Order Contract

Status on 2026-06-27:

- Backend durable `orderKey` exists for UI-facing message, part, protocol,
  board, interaction, control, and rail/session projections.
- Overlay message-card, hydrate, rail, and history surfaces consume backend
  `orderKey` rather than local timestamp comparators.
- Executor `run.progress` / `run.output` conversion to synthetic message cards
  is removed; durable message rows are the only visible executor-content
  source.
- Remaining work is per-surface cleanup and verification tracked in
  `2026-06-27-message-card-orderkey-convergence.md`, not a pending license for
  renderer-side inference.

Deliverables:

- Design and implement a backend-owned durable `orderKey` for all timeline
  domains only after the message-card surface has converged.
- Replace display-message-only ordering with the durable order contract where
  board rows, protocol events, control timeline entries, and message rows must
  share one visible chronology.

Acceptance:

- No caller sorts cross-domain timeline items by partial local fields.
- Existing message-card segment semantics continue to pass unchanged on top of
  the broader order contract.

#### Stage 7 Implementation Decision

The first Stage 7 delivery is a backend projection contract, not a read-time UI
patch and not a protocol-event reuse:

- `timeline/order.ts` owns the only `orderKey` formatter and comparator.
- `orderKey` is derived from persisted row fields that already survive DB
  reset/import: durable time, explicit domain rank, durable domain sequence
  when the domain has one, and stable row ID.
- Message-backed rows use `message.info.time.created + messageID`.
- Protocol rows use `protocol_event.emitted_at + seq + eventID`; ephemeral live
  replay rows do not pretend to be durable timeline rows.
- Control rows use `control_message.time_created + control_message.id`.
- Board workflow/goal rows use the backend board projection source fields:
  task time for task workflow rows, goal `time_created + goalID` for goal rows,
  and goal-step `startedAt/completedAt` when present or the owning goal order key
  time otherwise.
- Rail ledger rows use session ledger `timeCreated + sessionID`; status updates
  can update observed status but must not invent rail existence or row identity.

This deliberately does not add a write-time global sequence table in this
stage. A write-time table would require updating every direct `MessageTable`,
`ControlMessageTable`, `ProtocolEventTable`, and `EngineGoalTable` seed/write
path in one transaction-sized change. Doing only part of that would create the
exact dual-source state this spec is removing. The accepted Stage 7 root repair
is therefore: every UI-facing timeline projection carries and sorts by the same
backend `orderKey`; no renderer or route keeps its own timestamp/id comparator.

#### Stage 7 Additional Call Points

| Surface                                                                     | Current evidence                                                                               | Required Stage 7 change                                                                                                                  |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `control/timeline.ts::ControlTimeline.list`                                 | Sorts control rows by `time_created, id` and returns only `info.time`.                         | Return `info.orderKey` from the shared backend helper; keep SQL order aligned with that helper.                                          |
| `engine/model.ts::TaskEvent` / `SessionEvent`                               | Event DTOs expose `timestamp` and `sequence` only.                                             | Add durable `orderKey` to persisted protocol-event DTOs. Synthetic connect/heartbeat rows remain outside the durable contract.           |
| `orchestrator.ts::protocolTaskEvent` and `session.ts::protocolSessionEvent` | Convert protocol rows to task/session events with local timestamp fields.                      | Stamp `orderKey` from `protocol_event.emitted_at + seq + id`.                                                                            |
| `orchestrator.ts::compareConversationItems`                                 | Cross-domain transcript/timeline history sorting uses timestamp + item ID.                     | Replace with backend `orderKey` comparison; cursor state keeps timestamp/message ID for HTTP compatibility but ordering uses `orderKey`. |
| `conversation/view.ts::ConversationMessageView`                             | View messages expose `time` only; overlay re-sorts by `time/messageID`.                        | Add message `orderKey`; backend and overlay sort by it.                                                                                  |
| `conversation/view.ts::ConversationSessionView`                             | Agent rail rows expose observed times but no stable row order contract.                        | Add session/rail `orderKey` sourced from first observed persisted session/message time.                                                  |
| `workbench/board.ts::buildWorkflowFields`                                   | Board workflow/goal rows expose `orderIndex`, `startedAt`, `completedAt`, but no timeline key. | Add backend-owned order keys to task workflow steps, goal rows, and goal workflow steps.                                                 |
| `tree-writer.ts::messageTimeOrder` / hydrate meta parser                    | Sorts by `time` then message ID.                                                               | Require `view.messages[].orderKey` and sort live/hydrate messages by it.                                                                 |
| `conversation-agents.ts`                                                    | Rail records sort by `startedAt` and consume message targets from tree-writer.                 | Preserve target ownership; add/pass `orderKey` so rail can move to the shared contract without local guessing.                           |

#### Stage 7 Verification

2026-06-26 implementation verification:

- `timeline/order.ts` owns the single backend `orderKey` formatter/comparator.
- Backend conversation, protocol, control, board, task, interaction, session
  ledger, and history projections now expose `orderKey` where they enter a
  UI-facing timeline.
- Overlay tree-writer, conversation history paging, agent rail, interaction
  cards, and executor event conversion now require `orderKey` instead of
  sorting by local timestamp/id fields.
- Focused checks passed:
  `bun run --cwd packages/overlay typecheck`,
  `bun run --cwd packages/opencorvus typecheck`,
  `bun run api:routes-check`,
  `bun run check:sdk-imports`,
  `bun test packages/opencorvus/test/server/conversation-history-window.test.ts packages/opencorvus/test/server/task-conversation-routes.test.ts packages/opencorvus/test/server/conversation-view.test.ts packages/opencorvus/test/protocol/session-mirror.test.ts`,
  `bun test packages/overlay/test/conversation-agent-rail-records.test.ts packages/overlay/test/conversation-hydrate-replay.test.ts packages/overlay/test/tree-writer-hierarchy.test.ts`, and
  `node test/browser-runner.mjs test/browser/message-card-chronological-turns-browser.test.ts`.

2026-06-27 build-agent part-first repair:

- Root cause: live `message.part.updated` bridge/mirror enrichment stamped the
  top-level event `orderKey` with the part row order key. The overlay consumes
  top-level `orderKey` as the display message order key, so part-first build
  messages could be positioned as independent per-part cards before
  `message.updated` arrived. This reintroduced a dual-source ordering contract:
  top-level part events meant "message order" to the card projector but "part
  order" to the backend bridge.
- Contract repair: for `message.part.updated`, top-level `payload.orderKey` is
  the owning message order key. `payload.part.orderKey` is the part order key.
  Both are derived from persisted DB row time plus stable row ID, and any
  provided conflicting key fails loudly.
- Projection repair: displayable part-first events now insert a pending
  message record into the same message index used by `message.updated`, marked
  as pending server time. The writer runs the adjacent segment projector
  immediately, so consecutive build messages merge before `message.updated`.
  The later `message.updated` confirms server time and regroups without
  resetting already-confirmed message start time on repeated updates.
- Route repair discovered during verification: task conversation hydrate keeps
  the deep-link contract and reads by task project, while legacy
  `/task/:taskID/transcript` and direct session controls remain
  current-project scoped. SSE tests now wait for `task.connected` with an
  inactivity timeout because durable `task.lifecycle` replay may precede the
  synthetic connection event.
- Focused checks passed:
  `bun test packages/overlay/test/tree-writer-hierarchy.test.ts packages/overlay/test/conversation-hydrate-replay.test.ts packages/overlay/test/conversation-agent-rail-records.test.ts`,
  `bun test packages/opencorvus/test/protocol/message-bridge.test.ts`,
  `bun test --timeout 30000 packages/opencorvus/test/protocol/session-mirror.test.ts`,
  `bun test --timeout 30000 packages/opencorvus/test/server/task-conversation-routes.test.ts`,
  `bun run --cwd packages/opencorvus typecheck`,
  `bun run --cwd packages/overlay typecheck`, and
  `node test/browser-runner.mjs test/browser/message-card-chronological-turns-browser.test.ts`.
- Visual screenshots reviewed:
  `packages/overlay/.scratch/message-card-chronological-turns-browser/timeline-top.png`,
  `packages/overlay/.scratch/message-card-chronological-turns-browser/timeline-bottom.png`,
  `packages/overlay/.scratch/message-card-chronological-turns-browser/first-user-card.png`,
  and
  `packages/overlay/.scratch/message-card-chronological-turns-browser/usage-header.png`.

## Implementation Order

1. Add a pure display message order helper used by backend projection tests and
   overlay tests: `time.created`, then message ID.
2. Make `projectConversationView()` and route transcript ordering use that
   helper.
3. Introduce a tree-writer segment projector that returns both card mutations
   and `messageID -> renderedCardID` targets.
4. Update `regroupTimelineSegments()` to use adjacent segment scan and boundary
   rows for absorbed non-phase messages.
5. Make hydrate consume `view.messages[]` as display metadata and fail on drift.
6. Replace rail target formula duplication with the writer/shared target map.
7. Update usage/model projection for multi-message segments.
8. Update `cardMessageSegments`, transcript/copy helpers, and browser
   expectations for ordinary segment boundaries.
9. Rewrite tests that currently assert "same session consecutive messages stay
   separate" into adjacent aggregation tests.
10. Run focused unit tests, overlay typecheck, then isolated browser visual QA
    for chronological message cards and rail scroll targets.

## Acceptance

- Live consecutive same-session same-stage messages render as one top-level
  card with boundary-separated message parts.
- Live `user -> assistant -> user -> assistant` in one shared session renders
  four top-level cards in order.
- Live `orchestrator O1 -> child -> orchestrator O2` renders three top-level
  cards in order; O2 does not fold into O1.
- Hydrate produces the same segment cards and message target map as live SSE.
- Late part deltas for an absorbed message update the segment card that owns the
  original part.
- Rail targets point at actual rendered segment cards, including absorbed
  messages whose card ID uses an earlier message ID.
- Goal phase cards still absorb phase messages and do not create nested
  ordinary message cards.
- Lifecycle-only agent sessions can appear in the rail but never create blank
  message cards.
- Browser visual QA screenshots show chronological order and no duplicated or
  missing cards.

## Verification Plan

Targeted tests to update or add:

```bash
bun test packages/overlay/test/tree-writer-message-tokens.test.ts packages/overlay/test/tree-writer-hierarchy.test.ts
bun test packages/overlay/test/conversation-view-hydrate.test.ts packages/overlay/test/conversation-hydrate-replay.test.ts
bun test packages/overlay/test/conversation-agent-rail-records.test.ts packages/overlay/test/selected-task-recovery.test.ts
bun test packages/overlay/test/tree-writer-perf.test.ts packages/opencorvus/test/server/conversation-view.test.ts packages/opencorvus/test/server/session-conversation-routes.test.ts
bun test packages/opencorvus/test/engine/agent-coordination.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/opencorvus typecheck
```

Frontend visual verification must run in an isolated browser runner, not by
refreshing the user's live overlay:

```bash
$env:OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER='1'; node --test --test-concurrency=1 packages/overlay/test/browser/message-card-chronological-turns-browser.test.ts
$env:OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER='1'; node --test --test-concurrency=1 packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts
```

The browser test names and expected screenshots should be updated from
"without same-session merging" to "adjacent segment aggregation".

## Implementation Verification 2026-06-26

Stages 1-6 are implemented for the ordinary display-message path:

- Backend conversation projection and task/session transcript routes share
  `conversationTranscriptMessageOrder` (`time.created`, then message ID).
- Overlay hydration requires `ConversationView.messages[]` for display
  metadata and uses transcript rows as payload only.
- Tree-writer projects ordered display messages into adjacent segment cards and
  maps every absorbed message ID to the actual first-message segment card.
- Agent rail consumes the tree-writer rendered target map instead of duplicating
  message-card ID formulas.
- Part-first display messages require server/event time
  (`timestamp`/`emittedAt`/`emitted_at`) before materializing a card.
- Browser screenshots were checked for top timeline aggregation, bottom
  chronological continuation, usage header spacing, and rail locate/drag
  behavior.

Verified commands:

```bash
bun test packages/overlay/test/tree-writer-message-tokens.test.ts packages/overlay/test/tree-writer-hierarchy.test.ts packages/overlay/test/conversation-view-hydrate.test.ts packages/overlay/test/conversation-hydrate-replay.test.ts packages/overlay/test/conversation-agent-rail-records.test.ts packages/overlay/test/selected-task-recovery.test.ts packages/overlay/test/tree-writer-perf.test.ts packages/opencorvus/test/server/conversation-view.test.ts packages/opencorvus/test/server/session-conversation-routes.test.ts packages/opencorvus/test/engine/agent-coordination.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/opencorvus typecheck
$env:OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER='1'; node --test --test-concurrency=1 packages/overlay/test/browser/message-card-chronological-turns-browser.test.ts
$env:OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER='1'; node --test --test-concurrency=1 packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts
```

Stage 7's durable order-key contract has been delivered for the UI-facing
message-card surfaces covered by this spec. Residual cleanup for executor
protocol consumption, standalone session event envelopes, hydrate strictness,
rail target ownership, and build-phase renderer convergence is tracked by
`2026-06-27-message-card-orderkey-convergence.md`; renderer-side inference is
still forbidden.
