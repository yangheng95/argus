# Task List Timeout Index Fix

## Evidence

- UI error: `Failed to load tasks: signal timed out`.
- Overlay task list calls `loadTasks()` in `packages/overlay/src/store/board.ts`, which requests `global/tasks`.
- Transport default timeout is `DEFAULT_REQUEST_TIMEOUT_MILLISECONDS = 15_000` in `packages/overlay/src/services/host-transport.ts`.
- Live request on `http://127.0.0.1:7878/global/tasks` returned 200 in about 12.1s for 15 tasks and 117KB.
- Read-only SQLite timing showed the base task query is fast:
  - `engine_task` rows: 15.
  - `protocol_event` rows: 17,583.
  - global task row query: about 1.5ms.
- Slow path is `listActiveSessionsForTask()` in `packages/opencorvus/src/engine/store.ts`, called by `taskItems()` in `packages/opencorvus/src/task-api/index.ts` for every listed task.
- `EXPLAIN QUERY PLAN` showed SQLite using `protocol_event_type_idx(type)` for the active-session query and for its correlated newer-event subquery. Individual task timings ranged from about 53ms to 24.7s.
- On a DB copy, adding task/type/session and session/type/order protocol indexes reduced the same active-session queries to about 2-24ms each.

## Call Points

| Surface                 | Call point                                                           | Decision                                                           |
| ----------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Overlay sidebar         | `packages/overlay/src/store/board.ts::loadTasksOnce`                 | Keep `global/tasks`; do not increase timeout.                      |
| Task API list rows      | `packages/opencorvus/src/task-api/index.ts::taskItems`               | Keep `active_sessions` projection; fix query support.              |
| Task progress           | `packages/opencorvus/src/task-api/index.ts::getProgress`             | Keep `listActiveSessionsForTask(taskID)`; same index fix applies.  |
| Active-session query    | `packages/opencorvus/src/engine/store.ts::listActiveSessionsForTask` | Keep SQL semantics; add covering indexes for existing query shape. |
| Bootstrap schema        | `packages/opencorvus/src/storage/ddl.ts`                             | Add indexes so existing/current DBs can apply them on startup.     |
| Engine Drizzle schema   | `packages/opencorvus/src/engine/engine.sql.ts`                       | Add matching task-list indexes to prevent schema drift.            |
| Protocol Drizzle schema | `packages/opencorvus/src/protocol/protocol.sql.ts`                   | Add matching event indexes to prevent schema drift.                |

## Fix

Add these indexes as schema, not timeout/gate logic:

- `engine_task_time_updated_idx` on `(time_updated, id)` for cross-project task list ordering.
- `engine_task_project_time_updated_idx` on `(project_id, time_updated, id)` for project task list ordering.
- `protocol_event_task_type_session_status_idx` on `(task_id, type, session_id, emitted_at, seq)` for active-session candidate lookup.
- `protocol_event_session_type_status_order_idx` on `(session_id, type, emitted_at, seq)` for the correlated newer-event exclusion.

## Verification

- Add a storage regression test that builds `SCHEMA_DDL` in memory and asserts all indexes exist.
- Assert the Drizzle schema source contains the same index names so the schema sources do not drift.
- Re-run the targeted storage test and re-measure live `/global/tasks` after restart/schema apply.
