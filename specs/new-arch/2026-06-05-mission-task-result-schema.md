# Mission Task Result Schema

Date: 2026-06-05

## Problem

Mission dispatches squad work through `panel.create_task` and reconciles through `panel.query_task`, but the query output only exposes basic task state plus partial acceptance/evaluation summaries. A mission wake cannot reliably consume the task outcome as a structured result: completed vs failed/cancelled, delivery details, failure details, and child tasks are spread across board fields or reduced to child IDs.

## Grep Coverage

| Surface | Findings | Decision |
| --- | --- | --- |
| `packages/opencorvus/src/tool/panel.ts` | `query_task` hand-builds output JSON; `create_task` returns only `{ kind, task_id, message }`. | Add a shared query result formatter/schema used by `query_task`; keep create output unchanged except existing task id contract. |
| `packages/opencorvus/src/panel/capability.ts` | `PanelActionSchema` validates query input only: `taskIDs`, `includeChildren`, `includeInteractions`. | No new input flags. `result` is always present so Mission does not have to know another mode. |
| `packages/opencorvus/src/prompt/core/mission-core.txt` | Prompt documents old query shape: `evaluation`, `acceptance`, `children?`. | Update prompt to the new canonical `result` shape. |
| `packages/opencorvus/test/panel/query-task.test.ts` | Existing unit tests cover schema limits, 1:1 row alignment, per-task errors, acceptance/evaluation, children IDs, interactions. | Extend tests to parse the new result schema and assert terminal completed/failed/cancelled plus child summaries. |
| `packages/opencorvus/src/engine/store.ts` | `findChildrenOfTask(parentTaskID)` returns child task IDs from `metadata.parent_task_id`. | Reuse it as the single child lineage source; do not add another parent lookup. |
| `packages/opencorvus/src/workbench/board.ts` | `compileBoard` already projects `task`, `overview.currentFailure`, `acceptance.result`, `evaluation`, `artifacts`. | Reuse board projection; no database schema or migration. |

## Contract

`panel.query_task` returns:

```json
{
  "tasks": [
    {
      "taskID": "tsk_...",
      "title": "...",
      "status": "completed",
      "created": 1,
      "started": 2,
      "completed": 3,
      "error": "...",
      "result": {
        "status": "completed",
        "summary": "...",
        "acceptance": { "status": "delivered", "summary": "...", "changedFiles": ["..."], "artifacts": [{ "kind": "report", "label": "..." }] },
        "evaluation": { "status": "passed", "verdict": "accepted", "summary": "..." }
      },
      "children": [
        {
          "taskID": "tsk_child",
          "title": "...",
          "status": "active",
          "created": 4,
          "result": { "status": "active", "summary": "Task is active." }
        }
      ],
      "pendingInteractions": 0
    }
  ]
}
```

Errors remain 1:1 row entries: `{ "taskID": "...", "error": "..." }`.

## Implementation Notes

- Use Zod for the output shape near `panel.query_task`; the formatter parses before stringifying.
- `result.status` mirrors `task.status` so Mission has one structured place to branch on terminal outcome.
- Completed tasks prefer `acceptance.result.summary`, then `acceptance.summary`, then `evaluation.summary`, then board overview summary.
- Failed/cancelled tasks include `failure` from `task.error` or `overview.currentFailure`.
- Children use the same compact summary formatter, avoiding ID-only second-source semantics.
