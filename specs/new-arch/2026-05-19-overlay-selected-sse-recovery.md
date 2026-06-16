# Overlay Selected-Task SSE Recovery — Make-Before-Break + Live Cursor

- Date: 2026-05-19
- Status: design proposal, revised after multi-agent + second adjudication review (see §13 Review Feedback), not implemented
- Scope: selected-task conversation stream only (`GET /task/:taskID/events`)
- Non-scope: global task-list notification stream (`GET /task/events`), OS notifications, message rendering redesign

## 0. Recall / Existing Constraints

Read before writing this plan:

- `CLAUDE.md`: no fallback, no blind patches, tests required, grep all call sites before changing semantics.
- `specs/new-arch/07-panel-reactivity.md`: overlay conversation source of truth is `cardTreeStore`; SSE events must write precise paths; no full-tree rebuild on the hot path.
- Retired external note specs/notification-reliability-2026-05-18.md: per-task stream writes the tree; task-list stream owns global notifications; replay/hydration must not fire notification side effects.
- `packages/opencorvus/src/session/index.ts:886-908`: `updatePartDelta` is a pure `Bus.publish(Message.Event.PartDelta)` — it never writes PartTable. `session/processor.ts:413-464`: a streaming text part is written to PartTable only as empty at `text-start` and as final text once at `text-end`; `text-delta` only emits ephemeral deltas (no mid-stream flush, no flush point).
- `packages/opencorvus/src/orchestrator/protocol/message-bridge.ts:395-420,438-473`: all `message.*` events (including `message.part.delta`) flow through `bridgeEvent` → `ProtocolStore.dispatchEphemeral({aggregate:"task"})`. This — not `session/index.ts` — is the single ephemeral seam. The earlier draft mis-attributed it; corrected here per rule 35.
- `packages/opencorvus/src/protocol/store.ts`: persisted events use `sequence` assigned under `withKeyedLock(eventLocks, eventKey)` (`store.ts:189`); `dispatchEphemeral()` currently emits `sequence: 0` with no replay cursor and no lock. Current callers treat it as synchronous (`message-bridge.ts:406`). This is why the design keeps `dispatchEphemeral()` synchronous and serializes upstream via a per-task FIFO bridge queue (§7.1) rather than making the store async / lock-gated — the latter would change the bridge caller contract and still not fix the disorder, which originates before any store-side lock (§13 defect B/F).
- `packages/overlay/src/services/selected-task-recovery.ts`: current recovery is `stopSSE() -> hydrateTaskConversation() -> startSSE()`.

## 1. Problem

The current selected-task recovery path can lose realtime message deltas:

```text
stop selected-task SSE
hydrate canonical conversation snapshot
start selected-task SSE after hydrated persisted sequence
```

This is safe for persisted task events, but unsafe for live-only events:

- `message.updated` / `message.part.updated` can be recovered from message/part tables or persisted boundaries.
- `message.part.delta` is emitted through `ProtocolStore.dispatchEphemeral()` and has `sequence: 0`.
- During the stop/hydrate/start window, live-only deltas have no replay source.

Established by code audit (see §13): an in-flight assistant text part has **no mid-stream persistence**. PartTable holds `""` from `text-start` until `text-end` writes the final text once. `hydrateTaskConversation()` calls `resetWriter()` which clears the entire `cardTreeStore`, then rebuilds from persisted transcript — so an in-flight message is rebuilt as an **empty** part. The loss window is therefore not "the tail since the last flush" (there is no flush point); it is **the entire visible body of the in-flight message**. Any correct design must treat the per-task open-delta replay buffer as the only replay source for currently open volatile text/raw fields.

The replay buffer must not retain closed parts. `text-end` / `reasoning-end` / tool-call boundary events write a durable `message.part.updated` (`session/processor.ts:151-180,220-318,442-461`). After hydrate, those parts already contain canonical final state. Replaying their old `message.part.delta` events would append stale token chunks to the final text/raw field because `tree-writer.ts:667-705` applies deltas by string append. Therefore recovery replay is **not** "all ephemeral events in the current epoch"; it is "all retained deltas for fields that are still open at replay time."

Therefore a frontend-only make-before-break stream swap is not enough to make a strict guarantee. If two streams overlap, live-only deltas can duplicate. If the old stream is invalidated before the new stream is ready, live-only deltas can be lost. Without an event identity, the client cannot distinguish duplicate deltas from distinct equal text chunks. Crucially, anchoring the replacement stream's live cursor at "current live cursor" still loses every already-displayed in-flight delta, because `resetWriter()` discards them and the server replay (`live_sequence > after_live`) would not re-send them.

## 2. Goal

Guarantee, within a defined in-process replay window, that selected-task recovery:

1. Does not lose live-only `message.part.delta` events.
2. Does not double-append live-only deltas.
3. Does not duplicate persisted events already covered by hydrate.
4. Keeps normal UI updates incremental: event -> `tree-writer` -> exact `cardTreeStore` leaf path.
5. Fails loudly if the guarantee cannot be met; it must not pretend a silent full hydrate preserved live-only deltas.

## 3. Non-Goals

- Do not persist every token delta into `protocol_event`.
  The existing design deliberately avoids DB write amplification for high-volume deltas.
- Do not add debounce/throttle to hide jitter.
- Do not route task-list stream events into the selected conversation tree.
- Do not create a second UI data source beside `cardTreeStore`.
- Do not retry by silently dropping the live-only window. Recovery retry is allowed only as an explicit recovery lifecycle, not as a correctness fallback.
- Do not serialize `live_sequence` / `live_epoch` on the global task-list stream (`GET /task/events`). It is not needed for selected-conversation correctness and adding it would be speculative. (Resolved YAGNI; was Open Decision 3.)

## 4. Call-Site Inventory

Generated with:

```text
rg -n "startSSE\\(|stopSSE\\(|performSseReconnect\\(|recoverSelectedTaskConversation\\(|hydrateTaskConversation\\(|routeSSEEvent\\(|handleEventStreamEvent\\(|replayTaskEventToTree\\(|setTaskSequence\\(|taskSequence|dispatchEphemeral\\(|message\\.part\\.delta|ProtocolStore\\.listTaskEventsAfter|ProtocolStore\\.subscribeEvents|protocolTaskEvent|taskListProtocolEvent" packages/overlay/src packages/overlay/test packages/opencorvus/src packages/opencorvus/test -g "*.ts" -g "*.tsx"
```

### Overlay selected stream

Line numbers are exhaustive per rule 35 (full-repo grep, every call site listed with treatment). Earlier drafts under-listed `stopSSE` / `startSSE` and collapsed the recovery fan-out; corrected here.

| Symbol                             | Current owners / callers (file:line)                                                                                                                                                                                                                                                                                                                                | Required treatment                                                                                                                                                                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `startSSE`                         | def `services/sse.ts:105`; callers `services/task.ts:276`, `services/selected-task-recovery.ts:40`, `services/sse.ts:174` (the `restart: startSSE` dep injected into `performSseReconnect`); tests `selected-task-recovery.test.ts:94,157`, `sse-reconnect.test.ts:261`                                                                                             | Replace with a selected-stream controller that tracks persisted and live cursors. Public name kept; all 4 call sites route through the new controller. The `sse.ts:174` restart dep is **deleted** (subsumed by the recovery primitive).                                                         |
| `stopSSE`                          | def `services/sse.ts:190`; callers `services/sse.ts:106` (self-call inside `startSSE`), `services/selected-task-recovery.ts:33`, `services/sync.ts:67`, `services/task.ts:230`, `services/workspace.ts:317` (`closeProject`), `services/workspace.ts:536` (`applyDir` directory switch); tests `selected-task-recovery.test.ts:70`, `sse-reconnect.test.ts:231,270` | Keep as hard teardown — kept at all 6 sites. It must close active **and** replacement handles and invalidate their generation. The `sse.ts:106` self-call must tear down both handles before re-open.                                                                                            |
| `performSseReconnect`              | def `services/sse.ts:48`; self-recursive `services/sse.ts:73`; scheduled `services/sse.ts:165` (onClose retry timer); tests `sse-reconnect.test.ts:91,113,150,168,190,217`                                                                                                                                                                                          | **Delete** the `hydrate -> restart(after)` body and route onClose through `recoverSelectedTaskSSE()`. No parallel reconnect path may remain (rule 8). `SseReconnectDeps` interface and the `restart`/`hydrate` deps are deleted.                                                                 |
| `recoverSelectedTaskConversation`  | def `services/selected-task-recovery.ts:18`; called via `services/events.ts:103` `scheduleSelectedTaskRecovery` (dynamic import at `events.ts:108`) which fans out to **11 trigger sites**: `events.ts:501,509,519,533,564,695,702,714,762,773` + `services/sync.ts:17`; tests `selected-task-recovery.test.ts:99,134,158`                                          | Becomes the only selected-task recovery entry point for **all 11 triggers** (sequence gap, writer prereq, replay-expired, rewind-cleared, task-list-driven selected gap, reconnect, explicit). Opens replacement stream before hydrate, drains after hydrate. §6.3 must enumerate all 11, not 4. |
| `hydrateTaskConversation`          | def `services/conversation.ts:147`; callers `services/task.ts:273` (task selection), `services/sse.ts:170` (reconnect dep — deleted with `performSseReconnect` rewrite), `services/selected-task-recovery.ts:38`; tests `conversation-hydrate-replay.test.ts:153`                                                                                                   | Keep canonical snapshot/replay loader. It must not open or close streams. It returns the hydrated persisted sequence. `resetWriter()` wiping all ephemeral parts is expected; the recovery primitive — not hydrate — restores in-flight text.                                                    |
| `markSelectedTaskSequenceConsumed` | def `services/events.ts:81`; callers `events.ts:522,561,579,588,602`                                                                                                                                                                                                                                                                                                | Exists today (confirmed; §6.2 assumption valid). Remains the persisted-cursor advance point. Unchanged.                                                                                                                                                                                          |

### Overlay event routing

| Symbol                                        | Current owners / callers                   | Required treatment                                                                                                 |
| --------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `routeSSEEvent`                               | selected stream event handler, tests       | Must return or expose enough information to advance persisted and live cursors only after a successful tree write. |
| `handleEventStreamEvent`                      | fallback for non-message board/task events | Must continue to advance persisted `taskSequence` only after valid selected-task handling.                         |
| `replayTaskEventToTree`                       | conversation hydration replay              | Must never update live cursor and must never emit notifications.                                                   |
| `setTaskSequence` / `boardStore.taskSequence` | board store, events, conversation hydrate  | Remains the persisted task-event cursor. Do not overload it with live-only delta position.                         |

### Engine / protocol

| Symbol                              | Current owners / callers                                                                                                                                                                                                         | Required treatment                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ProtocolStore.dispatchEphemeral`   | def `protocol/store.ts:268`; sole caller `orchestrator/protocol/message-bridge.ts:406` (inside `bridgeEvent`, for all `message.*`). Confirmed no non-`message.*` ephemeral path exists, so "task aggregate only" gating is safe. | Stays **synchronous** (contract at `message-bridge.ts:406` unchanged). Synchronous `++` live cursor + open-delta buffer mutate + dispatch in the body; ordering is provided by the upstream per-task FIFO bridge queue, not a lock. The retained `withKeyedLock(eventLocks, eventKey)` (mirroring `appendEvent` at `store.ts:189`) only totally-orders persisted vs ephemeral. See §5.2, §7.1, §13 defect B/F. |
| `ProtocolStore.subscribeEvents`     | `/task/events`, `/task/:taskID/events`, tests                                                                                                                                                                                    | Subscription acceptance should include live cursor on ephemeral task events.                                                                                                                                                                                                                                                                                                                                   |
| `ProtocolStore.listTaskEventsAfter` | persisted replay and conversation pages                                                                                                                                                                                          | No change for persisted events. It remains sequence-based.                                                                                                                                                                                                                                                                                                                                                     |
| `protocolTaskEvent`                 | per-task live/replay/conversation serializers                                                                                                                                                                                    | Serialize live cursor when present.                                                                                                                                                                                                                                                                                                                                                                            |
| `taskListProtocolEvent`             | global task-list stream                                                                                                                                                                                                          | Must not serialize `live_sequence` / `live_epoch`. The global stream remains notification-only; selected-conversation live replay is scoped to `/task/:taskID/events`.                                                                                                                                                                                                                                         |

## 5. Protocol Design

### 5.1 Two Cursors

Selected task needs two independent cursors:

```ts
type PersistedCursor = number // existing protocol_event seq, event.sequence > 0
type LiveCursor = number // new volatile cursor for ephemeral task events, event.sequence === 0
```

Rules:

- `boardStore.taskSequence` remains only the persisted cursor.
- Add an overlay-local selected-task live cursor, for example inside `sse.ts`, not in `boardStore`.
- Persisted events are deduped by `sequence`.
- Ephemeral live events are deduped by `live_sequence`.
- `message.part.delta` must not be applied twice unless it has a distinct `live_sequence`.

### 5.2 Engine Volatile Delta Replay Buffer

Extend `ProtocolStore.dispatchEphemeral()` for `aggregate: "task"`:

```ts
dispatchEphemeral({
  type,
  aggregate: "task",
  taskID,
  sessionID,
  source,
  payload,
})
```

`dispatchEphemeral` stays **synchronous** (signature unchanged — `message-bridge.ts:406` keeps its synchronous call contract; see §7.1). Its body, in order:

- Assign `liveSequence = ++taskLiveSequences[taskID]` (bare synchronous increment — JS is single-threaded; ordering is guaranteed by the upstream per-task FIFO bridge queue, §7.1, not by a lock here).
- Stamp `liveEpoch = BOOT_EPOCH` (process-start constant; see below).
- Include `liveSequence` and `liveEpoch` on the `EventView`.
- If the event is a replayable `message.part.delta`, append it to the in-memory per-task open-delta buffer.
- If the event is a durable boundary (`message.part.updated`, `message.part.removed`, `message.removed`), prune the affected open-delta entries before/while dispatching the boundary event.
- Dispatch to live subscribers as today.

The serialization point is the per-task FIFO bridge queue, not a lock (final adjudication, §13 defect B/F). Mechanism, established by code audit: `GlobalBus` is a single-process Node `EventEmitter` (`bus/global.ts:3`); `GlobalBus.emit` is synchronous and the `message-bridge.ts:489-495` listener's synchronous prefix runs in true source order. A single task never takes both producer paths — `message-bridge.ts:491` (`if (envelope.directory === hostDirectory) return`) means a main-Instance session uses only the in-process synchronous `Bus.subscribe` path and a worktree-executor session uses only the relay path; there is no dual-path race. The only disorder source is the relay's fire-and-forget `void Instance.provide({...})` whose `await existing` (`instance.ts:102`) reorders relayed events **only inside the instance-cache cold-start / rebuild window**. `withKeyedLock` (`util/lock.ts:14-23`) is a contended poll, not a FIFO queue: it _preserves_ arrival order, it does not _create_ it, and the reordering happens _before_ the lock (at `Instance.provide`), so a lock on `dispatchEphemeral` is both insufficient and over-engineered (rule 5/6.1). Instead, the `message-bridge.ts` `GlobalBus.on` and `Bus.subscribe` callbacks enqueue `(type, properties)` — in their synchronous segment, using the synchronous `taskIDForSession(sessionID)` (`message-bridge.ts:403`) as key — into a **per-task FIFO queue**; a single worker serially `await Instance.provide(...)` (relay path) then synchronously calls `dispatchEphemeral`. Per-task sharding avoids serializing unrelated tasks. The bridge subscriber still returns synchronously (only enqueues), so the `message-bridge.ts:406` contract is unchanged and no new fire-and-forget is introduced — the queue _replaces_ the existing `void Instance.provide().then()`, a net removal. The existing `withKeyedLock(eventLocks, eventKey)` that `appendEvent` uses (`store.ts:189`) is retained only to totally-order a task's persisted vs ephemeral events; it is not the relay-ordering mechanism.

`BOOT_EPOCH` is a single process-start value (`Date.now()` at module init; not persisted). Because the open-delta buffer and `taskLiveSequences` are in-memory and opencorvus ships as a packaged binary that restarts on every repackage/deploy, a client holding a large pre-restart `after_live` would otherwise have every post-restart delta (`liveSequence` restarting at 1) silently dropped as `<= after_live`. `liveEpoch` lets the server detect this epoch mismatch and fail loud (§5.3) instead of silently under-replaying (§13 defect C).

The replay buffer is a transport replay log, not a second UI source of truth. Canonical message state remains the message/part tables. The buffer only closes the reconnect gap for live-only deltas that are intentionally not persisted.

Replayable entries are keyed by:

```ts
type OpenDeltaKey = `${taskID}|${sessionID}|${messageID}|${partID}|${field}`
```

Only `message.part.delta` records enter this buffer. Durable boundary pruning is mandatory:

- `message.part.updated` with `part.type === "text" || part.type === "reasoning"` and numeric `part.time.end`: delete all open-delta entries for that part.
- `message.part.updated` with `part.type === "tool"` and `part.state.status !== "pending"`: delete that tool part's `raw` open-delta entry. At this boundary the durable structured input/output state supersedes the streaming raw preview.
- `message.part.removed`: delete all open-delta entries for that part.
- `message.removed`: delete all open-delta entries for every part under that message. If the store cannot resolve message-to-part entries from the key index, this branch must throw during implementation review rather than silently leave stale replay entries.

This pruning is load-bearing. Without it, `after_live=0` would replay stale deltas for already finalized parts; hydrate would build the final text from PartTable and the drain would append old token chunks again.

"Open vs closed" has exactly one source of truth: presence in the server-side open-delta buffer (maintained by the durable-boundary pruning above). The client performs **zero** open/closed judgment — it must not infer it from hydrate results (an in-flight part is rebuilt as empty, a closed part as final text; the client cannot distinguish them, so a client-side "skip already-hydrated partID" heuristic is forbidden as a second source — rule 8). The client drains the replayed set unconditionally; correctness is 100% the server buffer's responsibility.

Retention is explicit: the derivation formula is fixed now; the numeric constants are the measured outputs of the Phase A benchmark, committed in code with their measured inputs (rule 10/28b — stated honestly as a measurement dependency, not a deferred decision; see §11.1). They are derived, never guessed:

```ts
// Derivation: must hold every ephemeral delta produced during the worst-case
// recovery window so a recovery with after_live=0 (§5.3) can fully rebuild every
// still-open volatile field.
//   MAX_EVENTS >= peak_delta_rate (events/s) * p99_hydrate_duration (s) * SAFETY
//   MAX_AGE_MS >= p99_hydrate_duration (ms) * SAFETY
// hydrate is a multi-page paginated replay; under load it is seconds, not ms.
// Pin from measured peak token rate and measured p99 hydrate duration with
// SAFETY = 3. Record the measured inputs alongside the constants in code.
const TASK_EPHEMERAL_REPLAY_MAX_EVENTS = /* pinned from measurement, e.g. 4096 */
const TASK_EPHEMERAL_REPLAY_MAX_AGE_MS = /* pinned from measurement, e.g. 30_000 */
```

Loud failure (never silent):

- Epoch mismatch (client `after_live_epoch` != server `BOOT_EPOCH`): the server emits a loud `task.live_replay_expired` control event on the stream and does not attempt numeric `after_live` comparison against a reset counter.
- Cursor older than the retained minimum live sequence needed to replay the current open-delta set: same loud `task.live_replay_expired` control event.

In both cases the client treats it as a recovery failure surfaced through recovery diagnostics. The server must not silently continue as if live deltas were recoverable. `task.live_replay_expired` is the single chosen surface (resolves Open Decision 2); a stream-level error is rejected because it would trigger `onError`→reconnect storms and cannot be serialized/tested on the single router path.

### 5.3 Per-Task SSE Query Contract

Extend selected-task stream:

```text
GET /task/:taskID/events?after=<persistedSequence>&after_live=<liveSequence>&after_live_epoch=<epoch>
```

`after_live_epoch` is sent only after the client has consumed at least one ephemeral task event carrying `live_epoch`. If the selected stream has not yet observed any live epoch, omit `after_live_epoch` and use `after_live=0`; the server treats the request as "replay current process open deltas from the beginning" and stamps returned ephemeral events with the current `BOOT_EPOCH`. Once the client consumes one, future recovery requests must include it. A present mismatched epoch is fatal; an absent epoch is not a mismatch.

`after_live` semantics for recovery: the recovery primitive opens the replacement stream with **`after_live=0`** — full replay of the retained open-delta buffer for the task. This is mandatory, not an optimization: because `resetWriter()` discards the entire in-flight message text/raw preview and there is no persisted flush point (§1, §13), the only way to restore already-displayed open fields is to replay every retained delta for fields that are still open. There is no "last persisted boundary" to anchor a non-zero `after_live` to. Steady-state live acceptance (non-recovery) does not replay; `after_live` is a recovery-time parameter.

Server startup order:

1. Subscribe to live task events.
2. If `after_live_epoch` is present and != `BOOT_EPOCH`: emit loud `task.live_replay_expired`, close this replacement stream as fatal (do not numeric-compare `after_live`).
3. Replay persisted events `sequence > after`.
4. Replay retained open-delta events `live_sequence > after_live` (with `after_live=0`, the full retained open-delta buffer; if the requested cursor predates the retained minimum live sequence needed for any currently open field, emit `task.live_replay_expired` instead).
5. Drain live events captured by the subscription while steps 2-4 were running.
6. Switch to direct live acceptance.

During steps 2-4 the subscription sink must buffer **all** live events for the task. It must not immediately write ephemeral events the way the current route does for `sequence === 0` (`server/routes/orchestrator.ts:445-460`), because `live_sequence` now gives those events an order and an immediate write can deliver a new delta before the replayed open deltas it depends on. After open-delta replay, drain the startup buffer in subscription-arrival order, dropping persisted events with `sequence <= cursor` and ephemeral events with `live_sequence <= liveCursor`. Then set `ready = true`.

Persisted and live replay ordering:

- Preserve server emission order within each class.
- Do not sort live events client-side by text/time.
- Client drain preserves stream arrival order after the replacement stream is open.
- Persisted events with `sequence <= hydratedSequence` are dropped by client during recovery drain because hydrate already applied them.
- Server startup buffering is mandatory: no live event observed by `ProtocolStore.subscribeEvents(...)` may bypass the replay barrier.

### 5.4 Event Envelope

Per-task stream event shape becomes:

```ts
{
  event_id: string;
  task_id: string;
  type: string;
  sequence: number;       // persisted cursor; 0 for ephemeral
  live_sequence?: number; // present for ephemeral task events
  live_epoch?: number;    // present for ephemeral task events; server BOOT_EPOCH
  payload: object;
  timestamp: number;
}
```

Do not reuse `sequence` for ephemeral events. That would mix persisted and volatile order and corrupt existing replay logic.

## 6. Overlay Design

### 6.1 Selected Stream Controller

`packages/overlay/src/services/sse.ts` should own selected-task stream handles and cursors.

Public surface:

```ts
export function startSSE(taskID: string, after = 0): void
export function stopSSE(): void
export async function recoverSelectedTaskSSE(input: {
  taskID: string
  reason: string
  hydrate: (taskID: string, signal: AbortSignal) => Promise<number>
}): Promise<number>
```

Internal selected-stream resource:

```ts
type SelectedStreamSink = (event: any) => void

interface SelectedStreamHandle {
  taskID: string
  generation: number
  close(): void
  setSink(next: SelectedStreamSink): void
}
```

Avoid a lifecycle enum. Generation ownership and the mutable sink are enough:

- Active stream sink dispatches to `routeSSEEvent`.
- Replacement stream sink appends parsed events to a buffer.
- Promotion is `replacement.setSink(dispatchSink)` plus replacing the active handle.

### 6.2 Cursor Advancement

Cursor advancement must happen only after successful application.

For persisted events:

- Existing `markSelectedTaskSequenceConsumed()` remains the point after successful write.
- Non-message board events continue through `handleEventStreamEvent()`.

For live events:

- Add `markSelectedTaskLiveSequenceConsumed(event)` in `services/events.ts` (single owner — colocated with `markSelectedTaskSequenceConsumed` at `events.ts:81`; not split across `sse.ts`/`events.ts`).
- It reads `event.live_sequence`.
- It updates the selected live cursor only after `routeSSEEvent` / `handleEventStreamEvent` returns without throwing.
- If tree-writer throws a prerequisite error and schedules recovery, the live cursor must not advance.

Critical: during recovery, the live cursor used for **drain dedup is not the steady-state `selectedLiveCursor`**. It is a drain-local high-water mark initialized to `after_live` (= 0). The steady-state cursor advanced by the about-to-be-superseded active stream must never be the dedup baseline — that is exactly the silent-loss path (§13 defect A): hydrate discards the active stream's pre-reset tree writes while the cursor it advanced would otherwise mask their re-replay. After drain completes, `selectedLiveCursor := liveHigh` so the promoted stream continues monotonically without gap or double-append.

### 6.3 Recovery Algorithm

The recovery primitive is the single entry point for **all 11 recovery triggers** enumerated in §4 (`scheduleSelectedTaskRecovery` fan-out): selected-task sequence gap, message-writer prerequisite, replay-expired, rewind-cleared, task-list-driven selected gap, SSE reconnect (`performSseReconnect` body deleted), and explicit `recoverSelectedTaskConversation()`. No trigger may compose recovery semantics by hand (rule 8).

It reuses the existing concurrency-epoch idiom (`selected-task-recovery.ts:5-16,28-44` — `recoveryGeneration` + `AbortController` + `assertCurrentRecovery`), not a lifecycle enum (see §6.5).

Algorithm:

```text
1. assertCurrentRecovery: if taskID !== boardStore.selectedTaskID -> abort (AbortError).
   recoveryAbort?.abort(); controller = new AbortController(); gen = ++recoveryGeneration.
2. afterPersisted = boardStore.taskSequence            // persisted baseline
   afterLive      = 0                                  // full retained open-delta replay
   afterLiveEpoch = client-held live epoch
3. Open replacement stream:
     GET ...?after=afterPersisted&after_live=0&after_live_epoch=afterLiveEpoch
   Replacement sink = buffer parsed events. (Server may emit task.live_replay_expired
   on epoch/retention failure -> client raises recovery failure, no silent continue.)
4. await replacement open (race against controller.signal); assertCurrentRecovery.
5. Invalidate old active stream generation (old events cannot write after hydrate).
6. hydratedSequence = await hydrate(taskID, controller.signal); assertCurrentRecovery.
   (hydrate runs resetWriter(): in-flight message rebuilt empty by design — step 7 restores it.)
7. Drain replacement buffer, liveHigh = 0 (drain-local high-water; see §6.4).
8. Promote replacement sink to dispatch mode; selectedLiveCursor := liveHigh.
9. Close old stream.
10. Return hydratedSequence.
```

Important ordering and why it is now correct:

- Replacement opens before hydrate, so live-only deltas during hydrate enter the replacement buffer.
- Old stream is invalidated before hydrate resets `cardTreeStore`, so stale events cannot write into a reset tree (per-event generation guard, mirroring `sse.ts:150,159` `handle !== sseHandle`).
- `after_live=0` makes the replacement replay the retained open-delta buffer, so in-flight text/raw previews that `resetWriter()` discarded are rebuilt. The earlier "`after_live = current cursor`" was the silent-loss bug (§13 defect A): it skipped exactly the already-displayed open deltas hydrate had just wiped.
- Dedup uses the drain-local `liveHigh` (init 0), never the steady-state `selectedLiveCursor` the dying active stream advanced. Re-applying the open-delta set is a rebuild, not a double-append, because durable boundary pruning (§5.2) removes deltas for parts that hydrate already rebuilt as final state.
- Task switch never relies on the §6.4 throw: it is caught by `assertCurrentRecovery` at steps 1/4/6 and aborts the whole recovery before drain.

### 6.4 Drain Rules

Do not special-case `message.part.delta` text content. The router remains the single application path.

Drain function:

```ts
function drainBufferedSelectedEvents(input: { taskID: string; hydratedSequence: number; buffer: any[] }): void
```

`liveHigh` is a drain-local variable initialized to `0` (= `after_live`). It is NOT the steady-state `selectedLiveCursor`.

Rules, per buffered event in stream-arrival order (no client-side re-sort):

- `task.connected`, `task.heartbeat`: ignore.
- `eventTaskID(event) !== taskID`: throw. This is a **data-integrity assertion only** (rule 6.1(a)) — a task-scoped stream delivering a foreign task is a server contract violation. It is NOT the task-switch path: a real task switch is already aborted by `assertCurrentRecovery` before drain runs, so this throw is unreachable under normal switching and signals a genuine bug when hit.
- `event.sequence > 0 && event.sequence <= hydratedSequence`: ignore (hydrate already applied it).
- `event.sequence > 0`: apply via `routeSSEEvent`; if it returns false, `handleEventStreamEvent`; on success `markSelectedTaskSequenceConsumed`. Reuse the existing `sse.ts:135-137` `routeSSEEvent || handleEventStreamEvent` router — do not build a parallel dispatch branch (rule 8).
- `event.sequence === 0` (ephemeral): if `event.live_sequence` is absent, throw (integrity). If `event.live_sequence <= liveHigh`: ignore (drain-internal overlap only). Otherwise apply via the same router; on success set `liveHigh = event.live_sequence` and `markSelectedTaskLiveSequenceConsumed`. For replayed `message.part.delta`, correctness depends on server-side durable-boundary pruning: only still-open volatile fields may appear in the replay set. Completed parts must be represented by hydrate or by a later live `message.part.updated`, never by stale replayed deltas.

No fallback branch may call `hydrateTaskConversation()` from inside drain. A drain failure means recovery failed and must be surfaced through recovery diagnostics (it must not re-hydrate to paper over the failure).

### 6.5 Why This Is Not a State Machine (rule 13)

The seven-step recovery is a linear procedure guarded by a monotone generation counter and an `AbortController`, structurally identical to the already-shipped idioms `selected-task-recovery.ts:5-16` and `conversation.ts:26-33,77-81` (`replayEpoch`/`assertActiveReplay`). Boundary criterion for reviewers:

- Compliant (this design): concurrency expressed as a monotone `recoveryGeneration`/epoch + abort signal + a two-valued mutable sink (`buffer` | `dispatch`) driven solely by the single recovery primitive. No `currentState`/`phase` enum, no business routing switched on a state value.
- Violation: introducing `phase: "opening" | "hydrating" | "draining" | "live"` and switching behavior on it. This is forbidden.

The spec explicitly rejects a lifecycle enum (§6.1). Implementations must not regress the linear steps into a `phase`-switched state machine; the sink toggle is resource ownership, not business state.

## 7. Server Design Details

### 7.1 ProtocolStore Changes

Add module-local state:

```ts
const BOOT_EPOCH = Date.now() // process-start, not persisted
const taskLiveSequences = new Map<string, number>()
const taskOpenDeltaReplay = new Map<string, EventView[]>()
```

`dispatchEphemeral()` stays **synchronous** — signature and the `message-bridge.ts:406` call contract are unchanged. The earlier draft's "make it async + await `withKeyedLock`" was rejected by final adjudication: `withKeyedLock` (`util/lock.ts:14-23`) is a contended poll, not a FIFO queue — it preserves arrival order but does not create it, and the relay reordering happens _before_ the lock at `Instance.provide`'s `await existing` (`instance.ts:102`). A lock on `dispatchEphemeral` is therefore both insufficient (does not fix pre-lock reorder) and over-engineered (rewrites the synchronous event-bus contract to fix one relay window — rule 5/6.1). The serialization point is the per-task FIFO bridge queue (below).

```ts
export function dispatchEphemeral(input: EphemeralInput) {
  // synchronous
  if (input.aggregate === "task" && input.taskID) {
    const liveSequence = (taskLiveSequences.get(input.taskID) ?? 0) + 1 // synchronous; ordered by the bridge queue
    taskLiveSequences.set(input.taskID, liveSequence)
    const eventView = buildEphemeralView(input, liveSequence, BOOT_EPOCH)
    mutateOpenDeltaReplay(input.taskID, eventView) // append/prune before dispatch
    dispatchEvent(eventView)
    return
  }
  dispatchEphemeralWithoutLiveCursor(input) // non-task behavior unchanged
}
```

The bridge queue is load-bearing, not the lock. `GlobalBus` is a single-process `EventEmitter` (`bus/global.ts:3`); its `emit` is synchronous and the `message-bridge.ts:489-495` listener's synchronous prefix runs in true source order, which is the reliable ordering anchor. A single task is never dual-path (`message-bridge.ts:491` directory guard). The only disorder is the relay's `void Instance.provide({...})` fire-and-forget resuming on an unordered microtask, and only within the instance-cache cold-start/rebuild window. The existing `withKeyedLock(eventLocks, eventKey)` (`store.ts:189`) is retained solely to totally-order a task's persisted vs ephemeral events (rule 9 — reuse, no parallel lock); it is explicitly _not_ the relay-ordering mechanism.

`message-bridge.ts` required treatment:

- Replace the direct `ProtocolStore.dispatchEphemeral(...)` call with `enqueueMessageBridgeEvent(type, properties)`.
- Enqueue happens in the **synchronous segment** of the `GlobalBus.on(...)` / `Bus.subscribe(...)` callback — before any `await Instance.provide(...)` — because that synchronous segment is the only reliable source-order anchor (`bus/index.ts:94` emit is synchronous; `message-bridge.ts:490-495` prefix is synchronous). The queue key is `taskIDForSession(sessionID)` (`message-bridge.ts:403`), which is synchronously available at enqueue time.
- The queue is **per-task FIFO** (sharded by taskID). A single worker per task serially `await Instance.provide(...)` on the relay path, then synchronously calls `dispatchEphemeral`. Per-task sharding prevents one task's cold-instance bootstrap from serializing unrelated tasks while still guaranteeing in-task source order through the cold-cache window.
- Queue errors are surfaced through the existing bridge log/error diagnostic path (`message-bridge.ts:414-418`); they must not be swallowed or converted into a best-effort skip.
- `Bus.subscribe(...)` and `GlobalBus.on(...)` both route through the same per-task queue. No second bridge path may remain. `dispatchEphemeral` stays synchronous — the queue, not an async signature, provides ordering.

Pruning must be deterministic:

- prune by max open-delta events,
- prune by max open-delta age,
- delete task buffer when task is deleted if a task-delete hook exists; otherwise age pruning is sufficient.

### 7.2 Route Changes

`server/routes/orchestrator.ts`:

- Extend the `/task/:taskID/events` query parser with `after_live` and `after_live_epoch` (mirror the existing `after` parsing at `orchestrator.ts:428`; reuse the same parser shape, no parallel implementation — rule 35).
- After `ProtocolStore.subscribeEvents(...)` is installed: if `after_live_epoch` present and `!== BOOT_EPOCH`, emit `task.live_replay_expired` and close this replacement stream as fatal (no numeric `after_live` compare against a reset counter).
- Replay persisted rows as today (`listTaskEventsAfter`, unchanged).
- Then replay `ProtocolStore.listTaskOpenDeltaEventsAfter(taskID, afterLive)`. With the recovery-time `after_live=0` this returns the full retained open-delta buffer; if the requested cursor predates the retained minimum live sequence required by any currently open field, emit `task.live_replay_expired` instead of a partial silent replay.
- Replace the current "ephemeral during replay writes immediately" branch with a unified startup buffer. While `ready === false`, both persisted and ephemeral live subscription events are buffered. After persisted replay and open-delta replay complete, drain the buffer once, then set `ready = true`.
- Serialize both through `protocolTaskEvent()`.

`protocolTaskEvent()`:

- Keep existing persisted fields.
- Include `live_sequence` and `live_epoch` only when the event view has them (ephemeral).

`task.live_replay_expired` handling:

- Add it to the overlay event policy / contract-name allowlists as an explicit control event.
- In the selected recovery replacement stream, this event is consumed before `writeToTree`. It records `conversation-recovery.failed` and marks the replacement handle fatal.
- A fatal replacement handle must not schedule `performSseReconnect` / `recoverSelectedTaskSSE` from its `onClose`. This is the concrete reason the design uses a serializable control event instead of a stream-level error; closing the stream without the fatal guard would recreate the reconnect storm this design rejects.
- The active old stream is not invalidated and `hydrateTaskConversation()` is not called after live replay expiry. The UI remains on the last known tree and surfaces recovery diagnostics.

Do not change `/task/:taskID/conversation` to include live-only deltas. Hydration remains canonical snapshot plus persisted replay.

## 8. Tests

### 8.1 Engine / Protocol

Add or extend `packages/opencorvus/test/engine/protocol.test.ts`:

1. `dispatchEphemeral({aggregate:"task"})` assigns strictly increasing `liveSequence` and stamps `liveEpoch = BOOT_EPOCH`.
2. `dispatchEphemeral` returns synchronously (signature unchanged); the bridge subscriber enqueues into the per-task FIFO queue in its synchronous segment. Assert: no caller makes `dispatchEphemeral` async; the `message-bridge.ts:406` contract is unchanged; every relay/in-process event goes through `enqueueMessageBridgeEvent` (no second bridge path).
3. T-cold (regression for §13 defect B): mock `Instance.provide` first call to return a delayed promise (cold bootstrap), then synchronously emit 5 worktree `message.part.delta` for one task. Assert `liveSequence` is strictly 1..5 and open-delta append order == emit order. Without the per-task FIFO queue (bare `void Instance.provide` fire-and-forget) this fails — the cold-cache window is the only window where bare `++` reorders. A keyed lock on `dispatchEphemeral` does **not** make this pass (reorder is pre-lock).
   3b. T-dispose (residual, rule 28b — no whitewash): emit 2 deltas → trigger `Instance.dispose()` → emit 2 deltas. Assert either `liveSequence` is continuous across the rebuild, or — if continuity cannot be guaranteed — the test explicitly asserts the discontinuity is allowed at this task-lifecycle boundary and that §5.3 epoch/retention loudly surfaces any resulting gap. The test must not assert "always continuous" to mask the known limit.
4. `listTaskOpenDeltaEventsAfter(taskID, 0)` returns the full retained open-delta buffer; `(taskID, n)` returns only retained open deltas with `live_sequence > n`.
5. Durable-boundary pruning: after two `message.part.delta` records for a text part, dispatch `message.part.updated` with numeric `part.time.end`; assert `listTaskOpenDeltaEventsAfter(taskID, 0)` no longer returns those deltas. Repeat for reasoning `time.end`, tool `state.status !== "pending"`, `message.part.removed`, and `message.removed`.
6. Completed-part duplicate guard: hydrate-equivalent final text plus `after_live=0` replay must not append old deltas after final text. This test fails if the buffer keeps closed-part deltas.
7. `protocolTaskEvent()` serializes `live_sequence` + `live_epoch` for ephemeral events and neither for persisted rows.
8. `taskListProtocolEvent()` never serializes `live_sequence` / `live_epoch`.
9. Retention expiry is loud: asking for a cursor below the retained minimum returns an explicit `task.live_replay_expired` event — assert it is that control event, **not** an empty array (empty vs expired must be distinguishable).
10. Epoch mismatch is loud: a request with present `after_live_epoch != BOOT_EPOCH` yields `task.live_replay_expired` and no numeric `after_live` comparison occurs (regression for §13 defect C). A request with omitted `after_live_epoch` and `after_live=0` is accepted and returns current-epoch open deltas.
11. Startup barrier: a live `message.part.delta` delivered by `ProtocolStore.subscribeEvents` while `/task/:taskID/events` is replaying persisted/open-delta history is buffered, not written immediately; output order is replayed open deltas first, then the captured live delta.
12. Non-task ephemeral events do not get task live cursor / epoch / buffer behavior.

### 8.2 Overlay SSE

Add or extend `packages/overlay/test/sse-reconnect.test.ts` and `selected-task-recovery.test.ts`:

1. Recovery opens the replacement stream with `after=<persisted>`, `after_live=0`, `after_live_epoch=<client epoch>` (assert the exact query, including `after_live=0`).
2. Core guarantee — use the injected `hydrate` callback as the timing barrier: hold `hydrate` unresolved (the `releaseConversation()` pattern at `selected-task-recovery.test.ts:108-141`), push a `message.part.delta` to the replacement sink, resolve `hydrate`, then assert the delta appears exactly once at the card part tail. Also assert a delta that was displayed _before_ recovery (live_sequence below the pre-recovery `selectedLiveCursor`) is rebuilt after `resetWriter()` when its part is still open (proves `after_live=0` open-delta replay restores already-shown in-flight text — §13 defect A regression).
3. A persisted event with `sequence <= hydratedSequence` is not applied twice.
4. Within drain, a buffered ephemeral event with `live_sequence <= liveHigh` (drain-local) is skipped; one with `live_sequence > liveHigh` is applied; `selectedLiveCursor` after drain equals max applied `live_sequence` (no gap, no double-append on promote).
5. Task switch during recovery, three timing points — (a) before replacement open, (b) after open before hydrate, (c) during drain — each: recovery aborts via `assertCurrentRecovery` (AbortError), replacement stream closed, **zero** mutation of the new task's tree. Assert the §6.4 wrong-task `throw` is NOT the path taken for a normal switch (it stays unreachable).
6. Replacement-stream open failure: tree is not reset (negative assertion — `cardTreeStore` cards unchanged) and the old stream's `close()` is not called; recovery surfaces failure via diagnostics, no silent re-hydrate.
7. Old-stream event delivered after generation invalidation is ignored (negative assertion: no tree write, `boardStore.taskSequence`/`selectedLiveCursor` unchanged).
8. Reentrancy: a second recovery triggered while the first is mid-drain — first is superseded (AbortError), its replacement handle is closed, buffers do not cross, no generation leak.
9. Restart epoch: client holds `after_live_epoch = E1`; server reports `BOOT_EPOCH = E2`. Assert the server emits loud `task.live_replay_expired` and the client raises a recovery failure — it must NOT silently continue (negative assertion: no partial apply, no silent cursor reset).
10. Live replay expired control event: replacement stream receives `task.live_replay_expired`; assert recovery records failure, does not call `hydrateTaskConversation`, does not invalidate the old active stream, and its close does not schedule another reconnect/recovery attempt.
11. Closed-part duplicate guard in overlay: hydrate rebuilds a completed text part with final `"hello"`; replacement replay contains stale deltas `"he"` + `"llo"` only if server pruning is broken. Assert the correct contract is zero stale deltas and rendered text remains exactly `"hello"`, never `"hellohello"`.
12. Removed-behavior assertions (rule 36): assert recovery no longer performs a bare `stopSSE() -> hydrate -> startSSE(after)` window (the old `recoverSelectedTaskConversation` body is gone — there is never a no-stream gap); assert `performSseReconnect` no longer independently hydrates+restarts but routes through `recoverSelectedTaskSSE`.
13. No accidental full-refresh (rule 36 / Phase D as automated assertion): spy that the drain path calls `hydrateTaskConversation` **zero** times; assert the recovery's opened `streams` set equals exactly the recovery request with no extra `/conversation` full-refresh.

### 8.3 UI / Incremental Projection

Existing tests to keep green:

- `packages/overlay/test/events-refresh.test.ts`
- `packages/overlay/test/delta-coalesce.test.ts`
- `packages/overlay/test/tree-writer-perf.test.ts`
- `packages/overlay/test/card-tree-visible-version.test.ts`

Add a source guard:

- `message.part.delta` recovery path must not call `hydrateConversationView()` except through the recovery primitive.
- Normal delta path must still write a leaf path under `cardTreeStore.cards[cardID].parts[index]`.

## 9. Acceptance Criteria

Functional:

- During selected-task recovery, live-only `message.part.delta` emitted while hydrate is in flight appears at the same card part tail.
- No duplicate token append when old and replacement streams overlap.
- Persisted events already included by hydrate are not replayed into the tree.
- Wrong-task buffered events throw and abort recovery.

Architecture:

- `boardStore.taskSequence` remains persisted-only.
- Live cursor is selected-stream-local and does not drive board refresh.
- Task-list SSE still never writes the selected conversation tree.
- `cardTreeStore` remains the single UI source for conversation cards.
- No debounce/throttle added for correctness.
- No silent full-refresh fallback for expired live replay.

Verification:

- Targeted overlay tests pass.
- Targeted protocol tests pass.
- `bun run --cwd packages/overlay typecheck` passes.
- `git diff --check` passes.
- A **visually-rendered** overlay message-streaming benchmark (not headless — rule 25) confirms visible tail streaming with no full refresh and no scroll jump during recovery. Benchmark artifacts (screenshots/recording) are committed for traceability (rule 26). "Manual inspection" is not an accepted substitute.
- Independent second review (codex / reviewer / user) signs off the diff for accidental fallback/full-refresh paths before the work is considered complete (rule 24). Self-review alone does not close acceptance.

## 10. Implementation Phases

### Phase A — Protocol Cursor

- Add live cursor + retained open-delta replay buffer in `ProtocolStore`.
- Serialize `live_sequence`.
- Add protocol tests.

### Phase B — Selected Stream Controller

- Refactor `sse.ts` selected-task stream opening into a reusable internal helper with mutable sink and generation guard.
- Keep `startSSE()` / `stopSSE()` public names for call-site stability.
- Add tests for generation invalidation and stream open failure.

### Phase C — Recovery Primitive

- Move selected-task recovery onto `recoverSelectedTaskSSE()`.
- Convert `performSseReconnect()` to use the same primitive.
- Add drain tests for persisted and live cursors.

### Phase D — Review + Benchmark

- Run targeted test set.
- Run typecheck.
- Re-run the visually-rendered overlay message-streaming benchmark to verify tail-only update; commit benchmark artifacts (rule 25/26). No headless or "visual smoke" shortcut.
- "Accidental fallback/full-refresh" is verified by the automated assertion in §8.2 test 13 (spy: zero `hydrateTaskConversation` from drain), not by eyeballing the diff.
- Independent second review gate (codex / reviewer / user) per rule 24 — required to close acceptance; record findings and any revision explicitly (rule 35), do not silently rewrite.

## 11. Resolved Decisions

Decisions resolved before landing (rule 31/32):

1. Retention constants: the **derivation formula is fixed** — `MAX_EVENTS >= peak_delta_rate * p99_hydrate_duration * 3`, `MAX_AGE_MS >= p99_hydrate_duration_ms * 3`. The **measured inputs** (peak delta rate, p99 hydrate duration) are produced by the Phase A benchmark and the resulting numeric constants + their measured inputs are committed in code then (§5.2). Stated honestly (rule 10/28b): the formula is decided now; the numbers are measurement outputs of Phase A, not guessable at design time — this is a measurement dependency, not a deferred decision.
2. Expired/epoch-mismatch surface: a single `task.live_replay_expired` control event (not a stream-level error — that would cause `onError`→reconnect storms and is not serializable/testable on the single router path). Loud and test-covered (§8.1 tests 9, 10; §8.2 test 10).
3. Task-list stream exposing `live_sequence`: resolved NO (YAGNI) — moved to §3 Non-Goals.
4. `liveSequence` serialization mechanism: a per-task FIFO bridge queue in `message-bridge.ts` (enqueue in the synchronous callback segment), **not** a keyed lock on `dispatchEphemeral` and **not** an async `dispatchEphemeral`. Rationale: `withKeyedLock` preserves but does not create order, the disorder is pre-lock at `Instance.provide`, and an async store body is an over-engineered contract change (rule 5/6.1; final adjudication, §13 defect B/F).

Known limitations (declared, not whitewashed — rule 28b):

- Single-process only: `GlobalBus` is an in-process `EventEmitter` (`bus/global.ts:3`). The ordering guarantee holds within one process. A future cross-process relay (IPC/network) would need re-evaluation; out of scope now (YAGNI), recorded as a boundary.
- Instance dispose/rebuild boundary: if the instance cache is disposed and concurrently rebuilt mid-stream for a task, `liveSequence` continuity across that rebuild boundary is not guaranteed. This is a task-lifecycle boundary event outside steady-state token flow; it is surfaced loudly via §5.3 epoch/retention rather than silently, and is quantified by §8.1 test 3b (T-dispose). It is not claimed to be impossible.

## 12. External Pattern References

- SSE supports event IDs / reconnect semantics: MDN Server-Sent Events.
- Socket.IO connection state recovery buffers missed packets for reconnect.
- Apollo subscriptions write external changes into normalized cache watched by UI.
- Apollo / Redux entity storage uses normalized lookup tables for precise entity updates.
- Yjs uses state vectors and incremental document updates for sync.

## 13. Review Feedback (multi-agent + second adjudication, rule 35)

This revision integrates six independent reviews, a first code-level adjudication, a second deep-dive adjudication (Y/X), and a third terminal adjudication that re-decided the X serialization mechanism. Defects and resolutions are recorded here rather than silently rewritten (rule 35).

- Defect A (fatal, confirmed, root cause corrected): the original `after_live = current live cursor` (old §6.3 step 2) silently lost the entire visible body of an in-flight assistant message. Code audit (`session/processor.ts:413-464`, `session/index.ts:886-908`, `tree-writer.ts:201-233`, `conversation.ts:147-185`, `orchestrator.ts:533-575,1369-1418`) established there is **no mid-stream PartTable flush** — `resetWriter()` wipes all in-flight text and hydrate rebuilds it empty. The earlier "old stream poisons the shared cursor" framing was over-stated/misattributed and is downgraded; the true fix is `after_live=0` retained open-delta replay + drain-local high-water dedup (§5.3, §6.2, §6.3, §6.4).
- Defect B (confirmed; fix re-decided by terminal adjudication): `liveSequence` from a bare `Map`-`++` is reordered by the relay's fire-and-forget `void Instance.provide()` — but only in the instance-cache cold-start/rebuild window, and a single task is never dual-path (`message-bridge.ts:491`). The earlier "fix inside `withKeyedLock`" was reversed: `withKeyedLock` (`util/lock.ts:14-23`) is a contended poll that preserves but does not create order, and the reorder is pre-lock at `Instance.provide`'s `await existing` (`instance.ts:102`). Adjudicator feedback (rule 35, not silently rewritten): the lock fix was both insufficient (pre-lock reorder) and over-engineered (rule 5/6.1). Final fix: keep `dispatchEphemeral` synchronous; serialize via a per-task FIFO bridge queue whose enqueue runs in the synchronous `GlobalBus.on`/`Bus.subscribe` segment (the reliable source-order anchor — `bus/global.ts:3` is a synchronous `EventEmitter`); `withKeyedLock(eventLocks)` is retained only for persisted-vs-ephemeral total order (§5.2, §7.1, §8.1 tests 3/3b, §11.4).
- Defect C (confirmed): in-memory counter reset on packaged-binary restart silently drops all post-restart deltas under a stale large client cursor. Fix: `BOOT_EPOCH` + `live_epoch` + server-side compare emitting loud `task.live_replay_expired` (§5.2, §5.3, §7.2).
- Defect D (downgraded): `§6.4` wrong-task `throw` does not conflict with task switch — `assertCurrentRecovery` aborts a real switch before drain. `throw` is retained only as a data-integrity assertion (§6.4).
- Defect E (fatal, confirmed): the revised "full current-epoch replay" over-replayed closed parts. `session/processor.ts:151-180,220-318,442-461` writes final durable parts, while `tree-writer.ts:667-705` appends deltas. Replaying old deltas after hydrate would duplicate final text/raw previews. Fix: replay buffer stores only open `message.part.delta` entries and prunes them on durable `message.part.updated` / removal boundaries (§1, §5.2, §8.1 tests 5-6, §8.2 test 11).
- Defect F (resolved by not making `dispatchEphemeral` async): the earlier draft proposed `dispatchEphemeral` becomes async + a single awaited bridge queue. Terminal adjudication established this async-ification was a connected over-engineering driven only by the (now-reversed) keyed-lock fix; the Bus can actually carry async subscribers (`bus/index.ts:52-61` `Promise.allSettled`), but that is moot. Adjudicator feedback (rule 35): `dispatchEphemeral` stays **synchronous**, the `message-bridge.ts:406` contract is unchanged, and ordering comes solely from the per-task FIFO bridge queue (§7.1, §8.1 test 2). The §0 wording "requires changing the bridge caller contract" is retained as the rationale for choosing the queue, not as an adopted async path.
- Defect G (confirmed): `task.live_replay_expired` as "emit then stop" can still create reconnect storms through selected-stream `onClose`. Fix: replacement handles that receive this control event are fatal; their close path does not schedule reconnect/recovery and does not invalidate the old active stream (§7.2, §8.2 test 10).
- Defect H (confirmed): task-list live cursor wording conflicted with the resolved non-goal. Fix: `taskListProtocolEvent()` must not serialize `live_sequence` / `live_epoch` (§3, §4, §8.1 test 8, §11).
- Defect I (fatal, confirmed): the current per-task route writes ephemeral events immediately while persisted replay is still in progress (`server/routes/orchestrator.ts:445-460`). With live replay this can deliver a new delta before older replayed open deltas. Fix: server startup buffers all live subscription events until persisted replay and open-delta replay finish, then drains once before direct live acceptance (§5.3, §7.2, §8.1 test 11).
- Rule 13 (cleared): generation + two-valued sink is the existing concurrency-epoch idiom, not a state machine; boundary criterion added (§6.5).
- Rule 35 (corrected): `message.part.delta` ephemeral seam is `message-bridge.ts`, not `session/index.ts` (§0); §4 call-site inventory completed with exhaustive line numbers (`stopSSE` 6 sites incl. the `sse.ts:106` self-call, `startSSE` 4, recovery 11-trigger fan-out).
- Rules 24/25/26/31/32/36 (closed): visual benchmark mandatory + artifacts committed, independent second-review gate, removed-behavior negative assertions, all open decisions resolved before landing (§8, §9, §10, §11).
