# Serve Memory Retention P0

## Evidence

Live `opencorvus.exe serve --hostname 127.0.0.1 --port 7878` reached about 9.9 GB working set and 25.7 GB private memory after 9 hours, while `bun.exe` processes were under 1 GB total. The process had only 377 handles and 24 threads, so the failure shape is heap retention of JS objects, not OS handle or thread leakage.

## Root Cause

`packages/opencorvus/src/protocol/store.ts` keeps `taskLiveReplayEvents: Map<string, EventView[]>`. The entries contain full ephemeral message payloads. `trimTaskLiveReplay(taskID, now)` only runs when the same task receives another ephemeral event, so a completed or idle task can retain its replay array indefinitely.

`packages/opencorvus/src/workbench/board.ts` keeps `boardCache: Map<string, { tag, board }>` with no size or lifetime bound. A board contains task request, metadata, spec, goals, artifacts, workflow projections, and summaries. Every hydrated historical task can therefore leave a full board object resident for the process lifetime.

## Grep Coverage

| Symbol / path | Call points | Decision |
| --- | --- | --- |
| `taskLiveReplayEvents` | `protocol/store.ts` write, trim, prune, list | Add process-level compaction that removes expired replay arrays independent of future same-task events. |
| `listTaskLiveEventsAfter` | `server/routes/orchestrator.ts`, `test/engine/protocol.test.ts` | Preserve replay and expiry semantics; add compaction before reads. |
| `dispatchEphemeral` | `orchestrator/protocol/message-bridge.ts`, `protocol/session-mirror.ts`, `test/engine/protocol.test.ts` | Keep as single live-event writer; update cleanup inside store only. |
| `boardCache` | `workbench/board.ts` only | Remove the unbounded cache; `boardTag` remains the snapshot identity source. |
| `compileBoard` | server conversation hydrate, workbench tests, overlay hydration callers via API | Keep response shape and `lastSequence` behavior unchanged. |

## Implementation

1. Replace same-task-only replay trimming with store-wide live replay compaction.
2. Run compaction on live replay writes and reads, and install an unref'ed interval so idle completed tasks are released without another task event.
3. Remove the unbounded workbench board cache rather than replacing it with another in-memory source.
4. Add tests proving expired live replay payloads are dropped without same-task activity and board hydration does not reuse a stale process cache.

## Acceptance

- `bun test packages/opencorvus/test/engine/protocol.test.ts packages/opencorvus/test/workbench/board.test.ts`
- No unbounded full-payload per-task cache remains on the investigated paths.
