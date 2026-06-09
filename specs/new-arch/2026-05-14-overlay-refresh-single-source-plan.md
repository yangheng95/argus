# Overlay Refresh Single Source Plan

> Date: 2026-05-14
> Status: revised after independent review

## Context

The overlay conversation UI renders from `cardTreeStore`, but the refresh
pipeline still carries older `messages`-store paths and broad board refreshes.
Recent ChatBubble work exposed that some expensive recursive reads were also
acting as accidental subscriptions for live child updates. The fix must keep
live streaming responsive without reintroducing render-time subtree scans.

This plan follows the project rule that there must be one source of truth and
no fallback or compatibility path. The target source for visible conversation
state is `cardTreeStore`.

## Current Problems

1. Visible conversation rendering reads `cardTreeStore`, while
   `syncTask()` and `loadConversation()` still refresh only the legacy
   `messages` store. These calls cannot be trusted to repair the visible UI.

2. SSE message events double-write: `routeSSEEvent()` writes to
   `cardTreeStore`, then enqueues the same event into the legacy message
   queue. This keeps two sources alive and spends main-thread time on state
   that no longer owns the conversation surface.

3. Message and run events schedule board refreshes even when the visible
   card update already landed incrementally. During streaming, this produces
   repeated HTTP board sync, JSON diffing, and board-derived reprojection.

4. Stage cards still compute `collectActivityCounts()` while expanded. That
   recursively scans descendants on every relevant store update and can make
   WebView2 miss frames.

5. Store child dereferencing is inconsistent. ChatBubble now dereferences a
   child through an accessor component; Card still passes
   `cardTreeStore.cards[id]!` inline from the `For` callback. This invites
   another accidental subscription gap.

6. Recovery is not atomic. `hydrateTaskConversation()` can reset and rebuild
   the visible tree while the existing selected-task SSE handle keeps
   dispatching live events into the same writer.

7. Hydration reports success before background event replay is complete.
   Reconnecting SSE from the returned `lastSequence` while replay is still
   running can leave a partial tree or race persisted replay against live
   events.

## Requirements

1. `cardTreeStore` is the only visible conversation source.
2. Live `message.part.delta` and `message.part.updated` must update visible
   cards without waiting for board refresh or transcript reload.
3. Hydration, reconnect, and replay-expired recovery must rebuild the visible
   `cardTreeStore`, not only the legacy `messages` store.
4. Board refreshes must be reserved for board-owned data: task metadata,
   goal workflows, interactions, files, changes, and acceptance state.
5. Expanded cards must not run recursive activity/todo/preview scans.
6. Collapsed cards may compute collapsed summaries, because the collapsed body
   is hidden and the summary is the visible representation.
7. No fallback path should silently coerce failed refreshes into stale or empty
   UI. Contract drift should throw or surface an explicit error.

## Proposed Architecture

### 1. Selected-task hydration owns visible state

Use a new selected-task recovery entry as the only visible conversation
recovery path. The entry owns the whole sequence:

1. verify the requested task is still selected
2. stop the selected-task SSE handle
3. cancel any in-flight conversation replay
4. hydrate the complete visible conversation into `cardTreeStore`
5. replay persisted events to completion
6. only after the tree is complete, restart SSE from the returned sequence

Remove selected-task recovery paths that only call `syncTask()` or
`loadConversation()` for visible repair. Replace their call sites with
the selected-task recovery entry when the selected conversation must be
recovered.

The recovery entry must be single-flight per selected task. A newer recovery
request supersedes the older one by bumping a generation and aborting the older
hydrate/replay. Old handles must not be allowed to dispatch after the generation
changes.

The existing `hydrateTaskConversation(taskID)` must be changed or wrapped so it
does not return success while `continueConversationReplay()` is still running.
Replay failure must reject the recovery; logging and continuing with a partial
tree is not acceptable.

Required call-site changes:

- `task.replay_expired` in `events.ts`: call selected-task recovery, which
  stops SSE, hydrates/replays completely, then restarts SSE from the recovered
  sequence.
- message events that cannot be safely written incrementally: perform the
  recovery decision before `writeToTree(event)`. Do not call tree-writer first
  when the writer lacks the session/part prerequisites.
- `task.rewound` with `cursorTime === 0`: use the same selected-task recovery
  path, not `syncTask()`.
- `handleEventStreamEvent()` and `handleTaskListNotification()` replay-expired
  branches: use the same selected-task recovery path.
- `sync.ts` selected-task refresh: use selected-task hydration for the
  conversation surface.

The phrase "let the live stream continue" is explicitly rejected. Live stream
continuation during reset is the race this plan removes.

### 2. Remove legacy message queue from live conversation routing

Remove `enqueueEvent()` from visible conversation routing. A selected-task
message event is written to `cardTreeStore` or it triggers the selected-task
recovery entry before any tree write. It is not also mirrored into a complete
legacy message queue.

If a remaining non-conversation consumer needs session/message data, move that
consumer to `cardTreeStore` or a narrowly scoped projection derived from
`cardTreeStore`. Do not keep the full mirrored message queue as a parallel
source.

`messageStore` may retain non-conversation state such as composer state,
connection state, attachments, and request abort handles. It must not retain
`messages` / `messagesBySession` as a complete selected-task conversation
mirror after this work is complete.

The following legacy pieces should be deleted once unused:

- `messages`
- `messagesBySession`
- `enqueueEvent`
- `flushEvents`
- `eventQueue`
- `coalesceDeltas`
- `FLUSH_INTERVAL`
- `loadConversation`
- `syncTask` selected-task conversation reload behavior

### 3. Narrow board refresh triggers

Do not call `scheduleBoard()` for every `message.*`, `run.progress`, or
`run.output` event. The tree writer already applies pure visible deltas.

Do not blanket-remove every run refresh either. Some `run.progress` subtypes
currently do not convert to message events and may represent board-owned state.
Introduce a single predicate, for example `boardRefreshReasonForEvent(event)`,
that classifies events explicitly:

- no board refresh: pure `message.updated`, `message.part.updated`,
  `message.part.delta`, and converted text/tool/reasoning output that only
  affects `cardTreeStore`
- board refresh: task lifecycle, goal workflow, interaction, file/change,
  acceptance, replay, sequence gap, and executor status/progress subtypes that
  are proven to update board-owned data
- unknown board-impacting subtype: throw or add an explicit mapping; do not
  silently treat it as "probably no refresh"

Keep board refresh for events that affect board-owned data:

- task lifecycle changes
- goal workflow changes
- interaction changes
- file/change/acceptance snapshot changes
- explicit replay expiration or sequence gap recovery

For sequence gaps, use selected-task hydration as the recovery path, because a
gap means the incremental conversation stream may be incomplete. Board refresh
alone is not sufficient to repair visible conversation state.

### 4. Make child card dereferencing explicit and validated

Introduce a small dereference primitive for store-backed cards:

```tsx
function storeCardNode(id: string): CardNode {
  const value = cardTreeStore.cards[id]
  if (!value) throw new Error(`card-tree: missing rendered child ${id}`)
  return value
}

function StoreCard(props: { id: string; depth: number }) {
  const node = () => {
    return storeCardNode(props.id)
  }
  return renderAsBubble(node()) ? (
    <ChatBubble node={node()} depth={props.depth} />
  ) : (
    <Card node={node()} depth={props.depth} />
  )
}
```

Use `StoreCard` in `Conversation` and generic `Card` children instead of
grabbing `cardTreeStore.cards[id]!` inside each `For` callback.

Do not use generic `StoreCard` for `ChatBubble` children. ChatBubble has a
narrow ownership contract: it may render message parts and integrity bodies,
and it must throw on unexpected step/phase/tool children. Keep
`ChatBubbleChild`, but make it use the same dereference primitive and its own
allowed-kind validator.

### 5. Restrict recursive summaries to collapsed state

For both `ChatBubble` and stage `Card`:

- `collectActivityCounts()` runs only when collapsed and summary UI is visible.
- `collectLatestActivityText()` runs only when collapsed.
- `collectTodoSummary()` runs only when collapsed.

Expanded state renders the actual body and children, so footer rollups are not
required for correctness. Removing them from expanded state avoids repeated
subtree scans during streaming.

### 6. Keep board-derived projection explicit

Keep the board projection hook in `board.ts` / `tree-writer.ts`, because
`loadBoard()` applies fine-grained board fields and the projection must happen
after the complete board delta. Do not replace it with a broad reactive effect
over `boardStore.board`.

## Implementation Order

1. Add regression tests for live child updates:
   - stream a child `message.part.delta`
   - assert the rendered `ChatBubble`/`Card` child sees the updated text
   - assert no recursive summary is required for the update

2. Add static architecture tests:
   - `routeSSEEvent()` must not call `enqueueEvent()` for visible message flow
   - `task.replay_expired` must not call legacy `syncTask()`
   - `task.rewound` cleared state and task-list replay-expired paths must not
     call legacy `syncTask()`
   - `Conversation.tsx` and `Card.tsx` must not pass
     `cardTreeStore.cards[id]!` directly from `For` callbacks
   - `ChatBubble.tsx` must keep an allowed-kind child validator
   - message recovery decision must happen before `writeToTree(event)` for
     events that can arrive before writer prerequisites exist

3. Implement `storeCardNode` / `StoreCard` for `Conversation` and `Card`, and
   make `ChatBubbleChild` use the same dereference primitive with its stricter
   validator.

4. Restrict `Card.tsx` expanded footer summaries to collapsed state.

5. Implement selected-task atomic recovery:
   - stop selected SSE
   - cancel replay
   - hydrate visible tree
   - replay to completion
   - restart SSE from recovered sequence
   - reject on replay failure

6. Replace selected-task conversation recovery call sites with the atomic
   recovery entry.

7. Define and test board refresh classification. Remove message/run blanket
   `scheduleBoard()` only where the classifier says the event is pure visible
   conversation state.

8. Remove the legacy `messages` / `messagesBySession` complete conversation
   mirror after grep proves consumers are migrated to `cardTreeStore` or a
   narrow derived projection.

9. Run targeted overlay tests, typecheck, Vite build, then visually verify
   streaming output in the overlay/browser.

## Acceptance Criteria

1. Live message text appears incrementally in visible cards without a board
   refresh.
2. `task.replay_expired` and reconnect recovery rebuild visible
   `cardTreeStore` state atomically: no live selected-task SSE dispatches
   during reset/replay, and SSE resumes only after replay completion.
3. No selected-task conversation recovery path writes only to `messages`.
4. Streaming message events do not schedule board refresh unless they also
   carry board-owned state according to the explicit classifier.
5. Expanded cards do not recursively scan descendants for summary footer data.
6. Missing child cards throw explicit errors; no empty fallback UI hides the
   broken graph.
7. Legacy complete conversation mirrors (`messages` / `messagesBySession`) are
   removed or no longer populated for selected-task conversation state.
8. Tests, typecheck, build, and visual verification pass.

## Independent Review Result

An independent review rejected the first draft. The review identified these
mandatory corrections, all incorporated above:

1. selected-task recovery must stop or gate the current SSE handle before
   resetting `cardTreeStore`
2. hydration must not return success before persisted event replay completes
3. message recovery checks must run before `writeToTree(event)` when writer
   prerequisites may be missing
4. every selected-task recovery path, including `task.rewound` cleared state
   and task-list replay-expired notification, must use the same recovery entry
5. the legacy complete `messages` mirror must be removed, not merely ignored
6. board refresh removal must be event-classified, not a blanket removal of
   all `run.progress` / `run.output`
7. `ChatBubble` must keep its stricter child-kind ownership validation and
   must not use a generic child renderer that would hide invalid graph shape

## Historical No-Regression Audit

Before implementation, the following historical fixes must be treated as hard
constraints. Any implementation that violates them is a rollback, even if it
passes narrow tests.

### 2026-04-21: SSE sequence must not come from board state

Commits:

- `df89353ae` — "force after=0 when card tree is empty"
- `dbbb58812` — "SSE always replays from after=0"

Historical failure: `loadBoard()` populated `boardStore.taskSequence`, then
`startSSE()` used that sequence as `after`, causing SSE to skip the
protocol events that are the only source for step/part/message cards. The UI
kept only goal cards and lost conversation history.

Constraint:

- recovery may resume from a sequence only if that sequence was produced by
  the complete selected-task conversation hydrate/replay path
- do not derive visible-conversation SSE resume from `boardStore.taskSequence`
  or a board snapshot alone

### 2026-04-22 / 2026-04-27: conversation hydration must replay persisted events

Commits:

- `80f6be44c` — implemented task conversation hydration and event replay
- `8119070e8` — paged conversation event replay during task switch

Historical failure: a single `/conversation` payload could omit older
protocol events, so replay had to page through persisted events and project
them with `replayTaskEventToTree()`.

Constraint:

- selected-task recovery is incomplete until paged replay completes
- `hydrateTaskConversation()` returning while replay continues in the
  background is not an acceptable recovery contract

### 2026-04-29: reconnect must not restart stale task streams

Commit:

- `f5910d29f` — "catch hydrate throw + close task-switch race in reconnect"

Historical failure: a task switch during hydrate allowed the old task's
reconnect path to call `startSSE()`, which stops the current handle and killed
the new task's live stream.

Constraint:

- atomic recovery must retain both pre-await and post-await selected-task
  guards
- stale recovery generations must not restart SSE
- hydrate failures must be logged/surfaced and retried deliberately, not become
  unhandled promise rejections or silent frozen streams

### 2026-04-29: `loadConversation()` queue race was already fixed once

Commit:

- `c3095742e` — dropped stale task-id gate from `loadConversation()` loop

Historical failure: a queued load for task B was lost when task A's in-flight
load completed after the selection changed.

Constraint:

- replacing `loadConversation()` must not reintroduce a stale captured task id
  gate; recovery state must be generation-based and re-check the selected task
  after every await

### 2026-05-02: live parts update by replacing arrays, not mutating shared arrays

Commit:

- `6c4b15b74` — "update live message parts"

Historical failure: pushing into shared Solid arrays did not reliably update
the visible card tree and risked duplicated/missed parts.

Constraint:

- tree-writer append paths must keep replacing the `parts` array
  (`const next = [...current, part]`) or an equivalent explicit store write
- do not restore `produce(parts => parts.push(...))` for live message parts

### Existing diagnostics: `syncTask()` can wipe streamed text

Files:

- `packages/overlay/test/sse-doctor.ts`
- `packages/overlay/test/message-bench.ts`

Historical diagnostic: transcript snapshots can contain empty text for parts
while live deltas have already accumulated text. Calling `syncTask()` can
replace live state with stale/empty transcript content.

Constraint:

- `syncTask()` must not be used as a visible conversation recovery path
- any transcript-derived state must be reconciled through the event replay
  path that reconstructs `cardTreeStore`

### Remaining legacy consumers must be migrated before deleting `messages`

Current consumers found during audit:

- `packages/overlay/src/main.tsx` uses `messageStore.messages.length` for chat
  count / Copy All disabled state
- `packages/overlay/src/utils/section.ts` uses `messageStore.messages` for
  live section phase inference
- tests such as `delta-doubling.test.ts`, `message-store.test.ts`, and
  `messages-bucket-clear.test.ts` still pin legacy message-store behavior

Constraint:

- do not simply delete `messages` / `messagesBySession`
- first move these consumers to `cardTreeStore` or to a narrow projection
  derived from `cardTreeStore`
- then delete or rewrite the legacy tests so they guard the new single source
  instead of preserving the old mirror

## Review Questions

1. Are there remaining UI consumers that still require live `messages` updates
   after Conversation moved to `cardTreeStore`?
2. Does replacing `syncTask()` with `hydrateTaskConversation()` create a
   sequence-resume race with the current SSE handle?
3. Should sequence gaps immediately restart SSE from the hydrated sequence, or
   is hydrating visible state enough while the existing stream continues?
4. Is there any board-owned state currently emitted only through `message.*`
   events that would be missed if message events stop scheduling board refresh?
5. Is `StoreCard` enough for Solid subscription correctness, or do parts need
   a separate accessor component for deep updates?
