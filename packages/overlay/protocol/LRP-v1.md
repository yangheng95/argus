# Loop Runtime Protocol (LRP) v1

This protocol defines durable task lifecycle signaling for bot-aware coding loops.

## Goals

- Make task state authoritative (`task.status`) instead of inferring from text streams.
- Make event streams recoverable after disconnects (`seq` ordering).
- Keep compatibility with current overlay chat event kinds (`start`, `delta`, `image`, `done`).

## Envelope

Every loop-aware chat event carries `loop_event`:

```json
{
  "v": "1.0",
  "seq": 42,
  "event_id": "evt_2a",
  "loop_id": "loop_...",
  "turn_id": "turn_...",
  "task_id": "task_...",
  "kind": "task.status",
  "status": "running",
  "terminal": false,
  "ts": 1760000000,
  "source": "manager"
}
```

## Submit Acknowledgement

`manager_send` should return:

```json
{
  "accepted": true,
  "loop_id": "loop_...",
  "turn_id": "turn_...",
  "task_id": "task_..."
}
```

Clients should treat `task_id` as the optimistic active task immediately, then reconcile with `task.status` events.

## Kinds

- `task.status`
- `output.delta`
- `output.replace`
- `output.image`
- `system.message`

## Task States

- Non-terminal: `created`, `accepted`, `running`, `waiting_permission`, `waiting_input`, `paused`
- Terminal: `completed`, `failed`, `cancelled`, `timed_out`, `stalled`

`terminal=true` must appear exactly once per `task_id`.

## Ordering and Recovery

- `seq` is monotonic per `loop_id`.
- Clients should dedupe by `event_id` and ignore events with `seq <= last_seq`.
- UI should always reconcile with snapshot state (`prompt_running`, `active_task_id`) as a fallback.

## Compatibility

- Legacy fields (`kind`, `text`, `url`, `success`, `code`) stay unchanged.
- Consumers unaware of `loop_event` continue to work.
- New consumers should prioritize `loop_event.kind=task.status` for lifecycle truth.
