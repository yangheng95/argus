# Scheduler-Owned Child Task Lineage

## Problem

Child task lineage is the `engine_task.metadata.parent_task_id` field. The intended owner is the orchestrator scheduler through `propose_task`, but the generic task creation path accepts arbitrary metadata. That lets any tool or API caller that can create a task attach `parent_task_id` and manufacture an engine child task outside the scheduler.

## Recall And Call Sites

| Surface | Current role | Required change |
| --- | --- | --- |
| `packages/opencorvus/src/orchestrator/tools.ts::propose_task` | Scheduler-owned follow-up task decision. Writes `metadata.parent_task_id`. | Use a scheduler-only task creation API. Keep the code-module-specific requirement here. |
| `packages/opencorvus/src/task-api/index.ts::EngineService.createTask` | Generic public task creation. Persists `input.metadata` unchanged. | Reject any caller-supplied `metadata.parent_task_id`. Add a scheduler-only child creation API that injects lineage internally. |
| `packages/opencorvus/src/tool/panel.ts::create_task` | Control-panel and mission task creation. Forwards `params.metadata`. | Keep top-level task creation, but it cannot create child lineage because `EngineService.createTask` rejects `parent_task_id`. |
| `packages/opencorvus/src/server/routes/orchestrator.ts::POST /task` | API task creation. Accepts `CreateTaskInput`. | Public API remains able to create top-level tasks only; child lineage is rejected by the service. |
| `packages/opencorvus/src/visual-qa/schema.ts::follow_up_task` | Non-scheduler agent outputs a new-task-shaped request. | Replace with unresolved problem reporting; scheduler decides whether to call `propose_task`. |
| `packages/opencorvus/src/tool/task.ts` | Session-local subagent execution, not an engine task row. | No engine child task lineage change. |

## Plan

1. Add a task-api guard: public `createTask` refuses `metadata.parent_task_id`.
2. Add `createSchedulerChildTask` that accepts the parent task ID as an internal argument and writes `metadata.parent_task_id` itself.
3. Switch `propose_task` to the scheduler-only API and keep concrete code module problem input there.
4. Remove non-scheduler new-task-shaped Visual QA follow-up output; report unresolved code-module problems instead.
5. Cover public rejection, scheduler creation, panel metadata rejection, and prompt/schema regressions with tests.
