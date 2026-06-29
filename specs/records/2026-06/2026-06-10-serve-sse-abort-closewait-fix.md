# Serve SSE Abort CloseWait Fix

## Evidence

Live `opencorvus.exe serve --hostname 127.0.0.1 --port 7878` PID 14068 was started at 2026-06-10 16:41:37 from the packaged sidecar path and reached 4.2-4.8 GB working set, 5.6 GB private memory, and 20.4 GB virtual memory. The process had only about 335 handles, so this is not a handle explosion.

`Get-NetTCPConnection -LocalPort 7878` showed 8 `CloseWait` sockets and 6-7 established sockets. `CloseWait` means the peer already closed and the server process has not closed its side of the connection.

The prior memory-retention fix in `2026-06-09-serve-memory-retention-p0.md` is already present in the current worktree: `ProtocolStore` has live replay compaction and `workbench/board.ts` no longer has `boardCache`. The remaining live signal points at streaming connection cleanup rather than the old unbounded board cache.

Hono 4.10.7 `streamSSE()` only binds `c.req.raw.signal.abort` to `stream.abort()` for Bun 1.0/1.1. The live packaged binary reports Bun 1.3.14, so OpenCorvus currently depends on response `ReadableStream.cancel()` to reach `stream.onAbort()` in all SSE routes. The live `CloseWait` sockets show that dependency is not sufficient in the packaged Windows sidecar.

## Grep Coverage

| Symbol / path                            | Call points                                                                                | Decision                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `streamSSE` import from `hono/streaming` | `server/routes/app.ts`, `global.ts`, `orchestrator.ts`, `panel.ts`, `session.ts`           | Replace with one OpenCorvus server SSE helper. No route-local duplicate cleanup.                              |
| `stream.onAbort`                         | `app.ts`, `global.ts`, `orchestrator.ts` task list and selected task streams, `session.ts` | Preserve route cleanup callbacks; helper makes late `onAbort` subscribers observe an already-aborted request. |
| `writeSSE`                               | Same SSE routes plus `panel.ts` stream response                                            | Preserve write behavior; helper only owns abort propagation.                                                  |
| `EventSource` client                     | `overlay/src/services/tauri-transport.ts`                                                  | No frontend change. Client already calls `source.close()`; the server must release its side.                  |

## Implementation

1. Add `packages/opencorvus/src/server/sse.ts` as the single server-side SSE primitive.
2. Wrap Hono `streamSSE()` and always connect `c.req.raw.signal.abort` to `stream.abort()` for all Bun versions.
3. Patch `stream.onAbort()` so callbacks registered after the request was already aborted still run once.
4. Replace all server route imports to use the local helper.
5. Add a Bun HTTP integration test that opens an SSE response, aborts the fetch signal, and asserts server cleanup runs.

## Acceptance

- `bun test packages/opencorvus/test/server/sse-abort.test.ts`
- `bun test packages/opencorvus/test/engine/protocol.test.ts packages/opencorvus/test/workbench/board.test.ts`
