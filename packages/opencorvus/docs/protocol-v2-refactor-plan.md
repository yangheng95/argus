# Protocol V2 Refactor Plan

Status: in_progress

This document defines the no-legacy-baggage refactor plan for a fully healthy internal protocol in `packages/opencorvus`.

## Goals

Protocol V2 must guarantee:
- no mutable wake/callback ownership across subsystems
- no unbounded waits without cancellation or deadlines
- no critical control-plane facts that exist only in memory
- no stream semantics that are lost on reconnect or restart
- no slow subscriber or tool call that can stall unrelated work

## Target Architecture

Protocol V2 replaces the current implicit runtime coupling with:
- actor mailboxes for task, run, interaction, session, and stream workers
- append-only persisted protocol events as the source of truth
- persisted inbox delivery for retries and crash recovery
- persisted stream chunks for resumable live output
- compatibility fan-out through the existing in-process `Bus` during migration

## Core Envelope

```ts
type Envelope<T = Record<string, unknown>> = {
  id: string
  kind: "command" | "event" | "reply"
  type: string
  aggregate_type: "task" | "run" | "goal_run" | "interaction" | "session" | "stream"
  aggregate_id: string
  task_id?: string
  run_id?: string
  goal_run_id?: string
  session_id?: string
  interaction_id?: string
  stream_id?: string
  source: string
  target?: string
  causation_id?: string
  correlation_id?: string
  reply_to?: string
  seq: number
  deadline_ms?: number
  emitted_at: number
  payload?: T
}
```

## Delivery Rules

1. Every command is persisted before delivery.
2. Every accepted command eventually resolves to one terminal reply:
   - `completed`
   - `failed`
   - `timed_out`
   - `cancelled`
3. Consumers must be idempotent by envelope `id`.
4. Actor mailboxes are bounded and lease-based.
5. Stream output is stored as ordered chunks keyed by `stream_id` and `chunk_seq`.
6. UI and SSE replay from persisted sequence, not from best-effort memory.

## Phases

### Phase 1: Protocol V2 Foundation

Status: complete

- [x] Define Protocol V2 envelope schema and enums
- [x] Add persistent tables:
  - `protocol_event`
  - `protocol_inbox`
  - `protocol_stream_chunk`
- [x] Export new tables from storage schema
- [x] Add regression tests for schema presence and envelope parsing

### Phase 2: Event Store and Stream Hub

Status: complete

- [x] Add `ProtocolStore.append()` with aggregate-local ordering
- [x] Add `ProtocolStore.listAfter()` for replay by `seq`
- [x] Add `StreamHub.appendChunk()` and `StreamHub.replay()`
- [x] Remove route-side fallback paths once all orchestrator events are produced from Protocol V2 only

### Phase 3: Actor Runtime

Status: complete

- [x] Replace `session/prompt-state.ts` callback ownership with actor mailboxes
- [x] Introduce `task-actor`, `run-actor`, `interaction-actor`, `session-actor`
- [x] Move standby, prompt reply, and cancellation semantics into actor inboxes
- [x] Remove `callbacks[]` and fire-and-forget loop ownership

### Phase 4: Delivery Guarantees

Status: pending

- [ ] Add lease-based inbox processing
- [ ] Add retry metadata and dead-letter handling
- [ ] Add idempotency keys and duplicate suppression
- [ ] Add explicit timeout and cancellation replies for all long-running commands

### Phase 5: Full Stream Recovery

Status: pending

- [ ] Persist raw output chunks instead of only aggregated text flushes
- [ ] Add `last_seq` or `last_event_id` replay to task event streams
- [ ] Remove reliance on in-memory stream buffers for correctness

### Phase 6: Compatibility Removal

Status: in_progress

- [~] Make `Bus` fan-out optional and non-authoritative
  - control-plane live consumers (`/task/:taskID/events`, `/channel/v1/thread/events`, Slack gateway) now subscribe to `ProtocolStore`
  - `OrchestratorProtocol.emit()` no longer mirrors control-plane events into `Bus`
  - remaining `Bus` usage is limited to non-control-plane live events such as session/message/file/tui signals
- [x] Remove route-side ephemeral protocol fallbacks for control-plane events
- [x] Delete Protocol V1-only helper paths after migration completes
  - `orchestrator_message` control-plane read/write paths removed
  - startup `runtime/shims` monkey patch path removed in favor of explicit bootstrap entrypoints
  - explicit bootstrap no longer mutates `process.env.AGENT` / `process.env.OPENCORVUS`

## Migration Notes

- Protocol V1 remains active during Phases 1-2.
- New tables are additive and do not change current runtime behavior.
- Runtime cutover should happen actor by actor, not as one big switch.
- Deleting V1 compatibility before Phase 5 is explicitly out of scope.

## Completion Notes

- [x] Phase 1 foundation landed without changing current orchestrator/session behavior.
- [x] Event store cutover
- [x] Actor runtime cutover
- [ ] Stream recovery cutover
- [ ] Compatibility removal
- [x] Session actor, run actor, interaction actor, and task actor landed.
- [x] Control-plane event reads and writes now use `ProtocolStore`; `orchestrator_message` is no longer authoritative.
- [x] Old `orchestrator_message` schema/code paths removed from active storage exports and DDL.
- [x] Control-plane live delivery no longer depends on `Bus` fan-out.
- [x] Task/channel SSE streams no longer emit synthetic `*.connected` handshake events.
