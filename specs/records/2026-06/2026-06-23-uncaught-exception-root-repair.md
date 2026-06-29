# Uncaught Exception Root Repair

Date: 2026-06-23
Status: Fixed and verified

## Requirement

Find and fix process-level `uncaughtException` / `unhandledRejection` paths that can restart the cloud container. The immediate user-visible trigger is deleting a right-sidebar Coding Assistant session, but the repair scope is all equivalent process-error leaks.

## Recall

| Source                                                            | Constraint                                                                                                                  |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                                       | No fallback, no gate, no masking crashes in UI retries. Root-cause repair only.                                             |
| `specs/records/2026-06/2026-06-11-coding-assistant-session-history.md`   | Coding Assistant delete must use canonical session history and queue cancellation, not parallel message APIs.               |
| `specs/records/2026-06/2026-06-22-delete-active-task-record-context.md`  | Active deletion paths must resolve task/session context explicitly and must not crash with `No context found for instance`. |
| `specs/records/2026-06/2026-06-12-deleted-project-task-record-routes.md` | Record-level delete paths must not depend on stale physical project bootstrap.                                              |

## Current Evidence

`installProcessErrorLogging()` in `packages/opencorvus/src/util/process-error-logging.ts` logs any `unhandledRejection` and then rethrows it. That means an unhandled promise rejection from any background listener is deliberately converted into a process-level throw and reported as `uncaughtException`.

This is correct fail-loud behavior for cloud restarts. The repair must prevent background promises from becoming unhandled and must make deletion paths wait for their owned live work before physical deletion.

## Confirmed P0 Call Points

| Surface                       | File                                                      | Evidence                                                                                                                           | Risk                                                                                     |
| ----------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Coding Assistant delete route | `packages/opencorvus/src/server/routes/coding.ts`         | `DELETE /coding/session/:sessionID` calls `EngineService.deleteSession(sessionID)`.                                                | Deletes canonical session history for right-sidebar assistant.                           |
| Canonical session delete      | `packages/opencorvus/src/task-api/index.ts`               | `deleteSession()` cancels prompts and queue rows, then immediately calls `Session.remove(sessionID)`.                              | Active `SessionPrompt` can still unwind after its DB row/messages are gone.              |
| Prompt cancellation           | `packages/opencorvus/src/engine/cancellation-scope.ts`    | `cancelSessionPromptByID()` calls `cancelSessionPromptInScope()` but does not wait for prompt finish.                              | Physical deletion can race late prompt finalizers.                                       |
| Queue cancellation            | `packages/opencorvus/src/scheduler/task-queue-service.ts` | `cancelSessionPrompts()` only updates queued/running rows to failed.                                                               | In-flight `execute()` still completes/fails later and may publish/update after deletion. |
| Session mirror                | `packages/opencorvus/src/protocol/session-mirror.ts`      | `subscribeSessionMirror()` does `void mirrorSessionBusEvent(event, sessionID)` without `.catch()`.                                 | Any DB enrichment error becomes unhandled rejection.                                     |
| Session event SSE             | `packages/opencorvus/src/server/routes/session.ts`        | session event route calls `void writeData(...)`; heartbeat and protocol subscriber writes are not catch-bound.                     | Aborted streams can leak rejected writes into process error handling.                    |
| Global event SSE              | `packages/opencorvus/src/server/routes/global.ts`         | `GlobalBus.on("event", async handler)` awaits `stream.writeSSE()` inside EventEmitter listener.                                    | Rejected async listener promises are not caught by EventEmitter.                         |
| Project event SSE             | `packages/opencorvus/src/server/routes/app.ts`            | `Bus.subscribeAll(async event => stream.writeSSE(...))` relies on bus catch, but heartbeat uses `stream.writeSSE()` without catch. | Stream-close races can still leak through heartbeat writes.                              |

## Causal Chain For Coding Assistant Delete

1. User deletes a right-sidebar Coding Assistant row.
2. Overlay calls `DELETE /coding/session/:sessionID?directory=...`.
3. Server validates right-sidebar session and calls `EngineService.deleteSession(sessionID)`.
4. `deleteSession()` requests cancellation but does not await every cancelled prompt loop to finish.
5. `Session.remove()` physically deletes the session tree and emits `session.deleted`.
6. A still-open `GET /session/:sessionID/events` stream keeps a `subscribeSessionMirror()` GlobalBus listener alive.
7. Late prompt/status/message events or stream-close writes trigger async mirror/SSE promises after the session row/stream is gone.
8. Those promises are not caught at their fire-and-forget boundary.
9. `installProcessErrorLogging()` rethrows the unhandled rejection, so the process reports `uncaughtException` and the cloud container restarts.

## Repair Direction

- `EngineService.deleteSession()` must cancel and await prompt subtree settlement before physical session deletion. If cancellation cannot be proven, deletion must fail loudly and leave the session row intact.
- Queue cancellation must account for in-flight rows: either abort the matching prompt state and wait, or expose a helper that cancels and settles session queue work before deletion.
- Session mirror and SSE routes must never leave fire-and-forget promises without a catch. Expected stream-close errors should terminate the local stream subscription; unexpected errors should be logged with request/session context.
- Bus event publishing must remain fail-loud for synchronous callers, but background subscribers must convert their own rejected promises into logged failures at the subscription boundary.

## Acceptance

- Deleting a running right-sidebar Coding Assistant session does not emit process-level `unhandledRejection` or `uncaughtException`.
- Deleting any active standalone session follows the same settlement contract.
- Open session event streams for a deleted session do not leak unhandled rejections.
- Aborted global/project/session SSE clients do not leak unhandled rejections from heartbeats or async EventEmitter listeners.
- Targeted tests prove these paths without UI retry masking or fallback behavior.

## Verification Plan

1. Add a process-error trap helper for tests that records `unhandledRejection` / `uncaughtException` while preserving test control.
2. Add a running Coding Assistant prompt delete regression.
3. Add a session mirror rejection regression for deleted/missing session enrichment.
4. Add SSE abort/write rejection regressions for session and global event routes where practical.
5. Run targeted server/protocol/scheduler tests.
6. Run focused typecheck for changed packages.

## Parallel Audit

Four independent read-only agents are auditing:

| Agent | Scope                                        |
| ----- | -------------------------------------------- |
| A     | Coding Assistant/session delete chain.       |
| B     | Bus/SSE/void Promise async error boundaries. |
| C     | Scheduler/runtime long-lived services.       |
| D     | Test gaps and regression design.             |

Final reconciled findings:

| Agent | Result                                                                                                                                                                                          |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A     | Confirmed delete race: `EngineService.deleteSession()` cancelled prompt state but deleted the session tree before prompt settlement. Also found direct external cleanup/delete call sites.      |
| B     | Confirmed naked async boundaries in session mirror, global/project/session/orchestrator SSE, panel streaming, and `GlobalBus` EventEmitter listeners.                                           |
| C     | Confirmed runtime boundaries in engine queue `.finally()`, LSP process errors, browser preview live sidecar, MCP browser cleanup, task queue completion publishing, and memory metrics logging. |
| D     | Confirmed regression coverage gaps and recommended a process-error test helper plus targeted delete/SSE/runtime tests.                                                                          |

## Implemented Repair

- `EngineService.deleteSession()` now resolves the root session project first, requests subtree prompt cancellation, cancels queue rows, awaits cancelled prompt settlement, and only then physically removes the session tree. Incomplete cancellation returns `TaskCancellationIncompleteError` and leaves the session row intact.
- Right-sidebar Coding Assistant delete, canonical `/session/:sessionID` delete, CLI session delete, mission session delete, MCP cleanup, and panel control cleanup now use the same `EngineService.deleteSession()` contract instead of parallel `Session.remove` entry points.
- `subscribeSessionMirror()` catches and logs mirror enrichment failures at the GlobalBus subscription boundary.
- `GlobalBus.emit("event", ...)` catches synchronous listener throws and rejected listener promises.
- `Bus.publish()` observes its own returned promise so fire-and-forget validation failures do not become process-level unhandled rejections while awaited callers still receive the rejection.
- Session/global/project/orchestrator/panel SSE streams now serialize writes, catch stream write failures, clear heartbeat/poll timers, unsubscribe listeners, and close only their local stream state.
- Engine queue, orchestrator loop, LSP spawn, CLI shutdown, background bash readiness, TaskQueueService completion publishing, MCP browser cleanup, browser preview live sidecar, LSP child process errors, and runtime memory metrics now observe background promise failures at their owning lifecycle boundary.
- The flaky Coding Assistant cursor test now asserts the documented `time_updated DESC, id DESC` ordering instead of assuming creation order when timestamps collide.

## Verification Result

- `bun run typecheck` from `packages/opencorvus`: pass.
- Targeted regression suite from `packages/opencorvus`: `145 pass`, `0 fail`, `559 expect() calls`, `15 files`, `167.36s`.
- Targeted suite command:
  `bun test --timeout 60000 test/server/coding-routes.test.ts test/protocol/session-mirror.test.ts test/server/sse-abort.test.ts test/bus/bus.test.ts test/scheduler/task-queue-service.test.ts test/lsp/client.test.ts test/browser-preview/live-lifecycle.test.ts test/mcp/browser-node-launcher.test.ts test/mcp/browser-session-lifecycle.test.ts test/runtime/memory-metrics.test.ts test/runtime/promise-boundaries.test.ts test/engine/queue.test.ts test/engine/protocol.test.ts test/server/session-conversation-routes.test.ts test/server/panel-stream-boundary.test.ts`

## Residual Review

The remaining `Session.remove` call sites are either the canonical implementation inside `EngineService.deleteSession()` / task deletion internals or unit tests for the lower-level session API. User-facing and service cleanup delete paths covered by this investigation now route through `EngineService.deleteSession()`.
