# Overlay Live Efficiency Safe Fix - 2026-06-06

## Problem

The overlay burns CPU during active tasks because several live update paths amplify small protocol changes into full list, board, or conversation projections.

Independent read-only reviews found three concrete sources:

- The global `/task/events` stream forwards every task-scoped notification to `handleTaskListNotification()`, and that handler refreshes `global/tasks` for any notification carrying `taskID`.
- `/task/:taskID/conversation?tail_limit=N` first calls `loadTaskTranscript(taskID)` for the full task session tree, then cuts the tail in memory.
- `boardTagForTask()` includes all task `protocol_event` count, seq, and timestamp values, so non-board-visible events such as `session.status` and `review.stream.chunk` invalidate the board ETag.

The selected task message stream is not the culprit: ordinary `message.*` events are consumed by `routeSSEEvent()` and written into tree-writer incrementally. This path must remain unchanged.

## Callpoint Inventory

| Surface | Current callpoints | Decision |
| --- | --- | --- |
| Global task-list stream | `packages/opencorvus/src/server/routes/orchestrator.ts` `/task/events` -> `packages/overlay/src/services/sse.ts::startTaskListSSE()` -> `packages/overlay/src/services/events.ts::handleTaskListNotification()` -> `loadTasks()` | Make `/task/events` a task-list projection stream. Keep front-end handling simple: if the stream emits a task-list event, refresh. Conversation stream/status noise remains on `/task/:taskID/events`. |
| Selected task stream | `packages/overlay/src/services/sse.ts::startSSE()` -> `routeSSEEvent()` -> tree-writer | Do not change selected `message.*`, `session.status`, cursor, reconnect, or recovery semantics. |
| Tail merge | `task.messages.changed` -> `scheduleLatestConversationTailMerge()` -> `/task/:id/conversation?tail_limit=32` | Keep client path intact; make server endpoint perform bounded transcript loading. |
| Conversation hydrate | `/task/:id/conversation`, `/conversation/session/:sessionID`, `/conversation/history` | Preserve response contract while replacing full transcript scans with bounded/session-scoped loading where possible. |
| Board tag | `EngineService.getBoardTag()` -> `boardTag()` -> `boardTagForTask()` | Remove all-event protocol aggregate from tag and replace it with board-visible protocol types only. Keep `lastSequence` in board payload for cursor compatibility. |
| Board route | `/task/:taskID/board` | Keep 304 contract and response schema. |

## Safety Rules

- Do not edit selected task live message event handling.
- Do not add front-end gates or fallback refreshes to hide missed updates.
- Preserve all existing response object shapes.
- Add tests that prove skipped global notifications do not stop selected stream messages from rendering.
- Verify each layer independently before combining.

## Acceptance

- Global task-list stream excludes `message.part.delta`, `session.status`, `review.stream.chunk`, and `task.messages.changed`.
- Task lifecycle notifications still call `loadTasks()`.
- Selected stream message events still update tree-writer without board refresh.
- Conversation tail endpoint returns the same semantic tail ordering and history metadata while avoiding full transcript loading.
- Board tag changes for board-visible workflow/goal/task events but not for `session.status` or `review.stream.chunk`.

## Implemented Result

- `/task/events` now emits only task-list projection events; selected task message/status streaming remains on `/task/:taskID/events`.
- `/task/:taskID/conversation?tail_limit=N` uses bounded per-session transcript reads for hydrate/tail merge while full transcript callers continue through `loadFullTaskTranscript()`.
- `boardTagForTask()` no longer invalidates the board ETag on session/review stream noise, while `compileBoard()` still returns the latest protocol `lastSequence`.
- Tests added for task-list projection event membership, bounded hydrate history, and board tag noise behavior.

## Verification

- `bun test packages/overlay/test/events-refresh.test.ts`
- `bun test packages/opencorvus/test/workbench/board.test.ts`
- `bun test --timeout 15000 packages/opencorvus/test/server/task-conversation-routes.test.ts -t "returns lifecycle-only agent sessions"`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/overlay typecheck`

`packages/opencorvus/test/server/task-conversation-routes.test.ts` passes the new assertions, but the whole file has pre-existing per-test timeout sensitivity on this machine because several route tests take 3-8s each and one lifecycle route test timed out when run in the full file. The timed-out test passes when run directly.
