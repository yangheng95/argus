# Overlay task and Mission page size

## Requirement

The overlay task panel and Mission ledger must load at most 10 records on first
render. Additional records must be fetched from the database only after the
operator clicks the visible load-more control.

## Call Point Audit

| Surface                                                               | Current owner                                                              | Action                                                                                                             |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `packages/overlay/src/store/board.ts#loadTasks`                       | Calls `global/tasks` without query.                                        | Add a 10-record window and `loadMoreTasks`; refreshes keep the current window size.                                |
| `packages/overlay/src/components/TaskList.tsx`                        | Renders a per-directory compact expansion over whatever is already loaded. | Keep directory compact expand as render-only; add global load-more that asks the store for the next database page. |
| `packages/opencorvus/src/server/routes/orchestrator.ts#/global/tasks` | Accepts `limit` and single `cursor`.                                       | Add compound cursor fields so equal `time_updated` rows page correctly.                                            |
| `packages/opencorvus/src/task-api/index.ts#getGlobalTaskBoard`        | Passes route query to `listGlobalTasks`.                                   | Forward compound cursor fields.                                                                                    |
| `packages/opencorvus/src/engine/store.ts#listGlobalTasks`             | Orders by `time_updated, id` but cursors only by `time_updated`.           | Filter by `(time_updated, id)` tuple.                                                                              |
| `packages/overlay/src/components/Mission.tsx`                         | Calls `loadMissions` without `limit` or cursor.                            | Maintain page state, fetch 10 plus one sentinel, append on load-more click.                                        |
| `packages/overlay/src/components/MissionList.tsx`                     | Renders all `props.missions`.                                              | Add load-more props and button below rendered groups.                                                              |
| `packages/overlay/src/services/mission.ts#loadMissions`               | Already supports `limit`, `cursorUpdated`, and `cursorSessionID`.          | Reuse existing contract.                                                                                           |

## Acceptance

- Initial task list request uses `limit=11` and renders/stores 10 records while
  keeping a has-more flag.
- Task load-more uses the last visible task as a compound cursor and appends the
  next 10 records.
- Initial Mission request uses `limit=11`; load-more passes the last visible
  Mission's `updated` and `sessionID`.
- Existing task list refresh triggers do not expand the database window unless
  the operator clicked load-more first.
