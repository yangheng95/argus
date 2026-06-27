# Persisted Tool Part OrderKey Hydrate Root Repair

## Failure

The active task `tsk_f081eb57a001n3C27LyqLht49b` fails during overlay initialization:

```text
Error: tool part prt_f08275473001fp8e2dh8J6Fpgj missing orderKey
```

Read-only database inspection shows `prt_f08275473001fp8e2dh8J6Fpgj` is a persisted `PartTable` tool row for message `msg_f082739e3001MQM1mTIv8UH5r9`. The part JSON has no `orderKey`; the owning message has no part-level substitute. The task row itself is still active and has no task error, so this is a conversation hydrate projection bug, not a failed task-run state.

A second live failure on the replacement task proved the first repair was incomplete:

```text
Error: tool part prt_f083fdf8f001oNkO1R2Fz0LUxz missing orderKey
```

The live `message.part.updated` SSE event carried `payload.orderKey`, but it was the owning message key:

```text
v1:...:message:msg_f083fbe980015U92Bk4PwQUqj6
```

and `payload.part.orderKey` was still missing. The overlay correctly failed when `toolToCardNode()` tried to render the tool part, because the tool part itself had no durable part key. This means the root surface is broader than persisted hydrate: every live/replay/hydrate displayable part projection must carry a part-owned key.

## Prior Constraints Recalled

| Record | Constraint |
| --- | --- |
| `2026-06-26-message-card-adjacent-segment-timeline.md` | Backend `timeline/order.ts` is the single source for durable timeline ordering. Overlay must require backend `orderKey` and must not infer it. |
| `2026-06-27-board-task-orderkey-projection.md` | Missing backend `orderKey` must be fixed in backend projections, not hidden in frontend fallback code. |
| `2026-06-27-bug-hunt-residual-convergence.md` | `message.part.updated` and hydrate fixtures require tool part `orderKey`; each displayable part event has its own order key and does not reuse the message key. |

## Call Point Inventory

| Call point | Current behavior | Required behavior |
| --- | --- | --- |
| `Message.stream()` | Reads `PartTable` rows and returns `{ ...row.data, id, sessionID, messageID }`. | Return each persisted part with a durable part `orderKey`. |
| `Message.latestAcrossSessions()` | Uses a separate copy of the same raw part projection. Task hydrate reads through this path. | Use the same persisted part projection helper. |
| `Message.parts()` | Returns direct part lookup without `orderKey`. Processor and route code can later feed this back to visible projection. | Use the same persisted part projection helper. |
| `Message.Part` schema | Part base has ids only. | Accept projected `orderKey` as part of the public DTO. |
| `timeline/order.ts` | Has domains for task/control/message/protocol/session/board/interaction, but no part domain. | Add `part` as a first-class domain ordered after message headers and before protocol events. |
| `Session.updatePart()` | Publishes the caller's raw part after writing `PartTable`, so live `Message.Event.PartUpdated` lacks `part.orderKey`. | Publish and return the projected part with `orderKey` derived from the written row's `time_created + partID`; do not persist the derived field in `PartTable.data`. |
| `orchestrator/protocol/message-bridge.ts::enrichProperties()` | For part events, route `orderKey` is copied from the owning message metadata. | For `message.part.updated`, require/stamp `payload.part.orderKey` and route `payload.orderKey` from the part key, not the message key. |
| `protocol/session-mirror.ts::mapSessionBusEvent()` | Standalone session mirror stamps only message route metadata; part payload lacks part key. | Stamp `payload.part.orderKey` and `payload.orderKey` from the persisted part row or already projected part. |
| `overlay/src/services/events.ts::convertExecutorEventToMessages()` | Converts `run.progress` into synthetic `message.part.updated` events whose part lacks `orderKey`. | Use the backend `run.progress` event `orderKey` as the synthetic part/event key; do not invent a browser-side timestamp/id key. |
| `overlay/src/services/tree-writer.ts::ensurePartProjection()` | Requires route meta `orderKey` but upserts the raw part; `toolToCardNode()` later fails if `part.orderKey` is absent. | Require displayable part `orderKey`, require it equals route meta `orderKey`, and upsert that validated part. |
| `overlay/src/utils/tool-card-node.ts` | Fails fast when tool part lacks `orderKey`. | Keep strict; no fallback. |

## Repair

Add a single backend part projection helper beside the persisted message read paths:

- Compute `timelineOrderKey({ domain: "part", time: row.time_created, id: row.id })`.
- Attach that key to every part returned from `Message.stream()`, `Message.latestAcrossSessions()`, and `Message.parts()`.
- Extend the part DTO schema with optional `orderKey`; write callers are not required to persist it into `PartTable.data`.
- Add a shared `timelinePartOrderKey()` helper in `timeline/order.ts` so hydrate, live bridge, and tests do not duplicate the part domain/rank contract.
- Publish `Message.Event.PartUpdated` with the projected part key after `Session.updatePart()` writes or updates the row.
- Make live bridge and session mirror part events carry the same part key at both `payload.orderKey` and `payload.part.orderKey`.
- Keep overlay strict by validating route/part key equality before rendering.
- Keep the overlay strict. Missing `orderKey` remains a backend contract violation.

## Acceptance

- A persisted tool part read through `Session.messages()` has an `orderKey`.
- The same persisted tool part read through `Message.latestAcrossSessions()` has the identical `orderKey`, covering task hydrate.
- The same persisted tool part read through `Message.parts()` has the identical `orderKey`, covering direct part lookups.
- The repaired active task conversation API returns tool parts with backend `orderKey` and no longer triggers `tool part ... missing orderKey`.
- A live `Message.Event.PartUpdated` dispatched through the task bridge exposes `payload.part.orderKey` and `payload.orderKey` with the same part-domain key, not the owning message key.
- A standalone session mirror `message.part.updated` exposes `payload.part.orderKey` and `payload.orderKey` with the same part-domain key.
- Overlay tree-writer rejects a `message.part.updated` whose route key and part key differ, and accepts the corrected backend shape.
- Executor `run.progress` conversion emits synthetic tool parts with a backend-sourced `orderKey`.
