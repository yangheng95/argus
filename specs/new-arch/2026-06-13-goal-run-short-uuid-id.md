# Goal Run Short UUID ID

## Requirement

New goal run attempt identifiers must be exactly the first 8 hexadecimal characters of a UUID4 (Universally Unique Identifier version 4). Do not keep the current long `glr_...` ID shape for newly created goal runs.

## Call-Site Audit

| Call site | Decision |
| --- | --- |
| `packages/opencorvus/src/engine/persist.ts::createGoalRun` | Replace logical goal run id generation with the short UUID4 helper. |
| `packages/opencorvus/src/engine/persist.ts::beginBuildAttempt` | Replace logical goal run id generation with the same helper; this is the main build dispatch path. |
| `packages/opencorvus/src/engine/persist.ts::appendGoalRunArtifact` | Use the same short UUID4 helper for append-only artifact row ids for `goal_run_attempt` rows, so the process table does not keep producing long goal-run-shaped artifact ids. |
| `packages/opencorvus/src/id/id.ts::Identifier.schema("goal_run")` | Replace the old `glr_` prefix validator with the 8-hex UUID4-first-segment schema so protocol/model validation has the same single source as persistence. |
| `packages/opencorvus/src/engine/model.ts` / `packages/opencorvus/src/protocol/schema.ts` | Keep call sites; they already route through `Identifier.schema("goal_run")`. |
| `packages/opencorvus/src/engine/store.ts::findGoalRun` and list helpers | Keep; they query by stored `goal_run_id` and do not assume a prefix. |
| `packages/opencorvus/src/server/routes/orchestrator.ts` `/goal-run/:goalRunID/acceptance` | Keep; route validation is `z.string().min(1)` and does not assume a prefix. |
| `packages/overlay/src/services/diff.ts` goal-run acceptance fetch | Keep; it passes through the board-provided id. |
| `packages/opencorvus/src/project/runtime-paths.ts` worktree path/branch segment | Keep; it accepts any id string and short 8-hex ids make the path shorter. |

## Acceptance

- `beginBuildAttempt` returns `/^[0-9a-f]{8}$/`.
- The persisted running `goal_run_attempt.goal_run_id` equals that 8-character id.
- `createGoalRun` returns a row whose `id` is `/^[0-9a-f]{8}$/`.
- Updating a goal run appends a `goal_run_attempt` artifact row whose artifact `id` is also `/^[0-9a-f]{8}$/` while preserving the stable logical `goal_run_id`.
- `Identifier.schema("goal_run")` accepts `/^[0-9a-f]{8}$/` and rejects the old `glr_...` shape.
