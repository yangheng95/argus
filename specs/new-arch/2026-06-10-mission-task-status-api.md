# Mission / Task Status API

## Acronyms

- API: Application Programming Interface, the HTTP route and generated client contract exposed by OpenCorvus.

## Evidence

| Surface                      | Existing owner                                                                   | Decision                                                                                      |
| ---------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `/mission` routes            | `packages/opencorvus/src/server/routes/mission.ts`                               | Keep mission session and mission task membership here. Add mission-scoped status endpoint.    |
| `/task/:taskID` routes       | `packages/opencorvus/src/server/routes/orchestrator.ts`                          | Add task-scoped status endpoint beside existing task routes.                                  |
| Task status                  | `deriveTaskStatus` from `packages/opencorvus/src/engine/task-status.ts`          | Reuse as raw task lifecycle source; do not add a stored status column.                        |
| Goal progress                | `compileBoard().goalWorkflows` from `packages/opencorvus/src/workbench/board.ts` | Reuse board projection as the only goal detail/progress source.                               |
| Mission task membership      | `listMissionTasks` from `packages/opencorvus/src/engine/store.ts`                | Reuse existing mission provenance query.                                                      |
| Existing mission list schema | `MissionTaskProjection` in `mission.ts`                                          | Keep its raw lifecycle `status`; add `executionStatus` for normalized success/failed/running. |

## API

- `GET /mission/:missionID/status`
  - Returns one mission aggregate with `status: success | failed | running`.
  - Includes `taskCounts`, `progress`, and detailed task snapshots.
  - Task snapshots include normalized `status`, raw lifecycle status, workflow step progress, and per-goal step progress.

- `GET /task/:taskID/status`
  - Returns the same task snapshot used by mission status aggregation.
  - This is the task-level API so clients do not need a mission context to inspect one task.

## Projection Rules

- `success`: completed raw lifecycle, or all task/goal steps completed when aggregating.
- `failed`: failed or cancelled raw lifecycle, or any goal step failed.
- `running`: queued/active/pending/running/incomplete.

No persistence is added. The API automatically collects current state from existing task rows and board projections on each request.

## Tests

- Extend `packages/opencorvus/test/server/mission-routes.test.ts`.
- Cover mission aggregate counts/progress, task details, goal progress, and `status` normalized to success/failed/running.
- Cover task endpoint schema on the same source task.
