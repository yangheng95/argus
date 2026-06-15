# Task List Lean Projection - 2026-06-15

## Trigger

The overlay becomes visibly slow when several active tasks update. Runtime
inspection showed that the global task-list endpoint was not lean:

- `GET /global/tasks?limit=11` returned only 8 tasks but about 221 KB.
- One list row included the full task request, mission metadata, active plan
  prompt, active run, and evaluation payloads.
- The overlay task list only renders id, title, status, directory, queue,
  timestamps, lineage, pending interaction count, and active-session summary.

## Root Cause

`packages/opencorvus/src/task-api/index.ts::taskItems()` reused full
`viewTask()`, `viewPlan()`, `viewRun()`, and `viewEvaluation()` for sidebar list
rows. That made list refreshes carry prompt/debug payloads that belong to the
selected task board, not to the list.

Task-list SSE then debounces to `loadTasks()`, so every lifecycle burst refreshes
the inflated list payload. This is a contract bug, not a rendering-only issue.

## Call Point Sweep

| Surface | Current use | Decision |
| --- | --- | --- |
| `/global/tasks` | Overlay sidebar list and task-list SSE refresh target. | Return lean rows only. |
| `/task` project board list | Same `taskItems()` helper. | Return lean rows only. |
| `/task/:taskID` | Direct full task lookup. | Keep full `viewTask()`. |
| `/task/:taskID/board` and conversation hydration | Selected task detail, request bubble, attachments, git metadata. | Keep full payload. |
| Overlay `TaskList.tsx` | Uses title/id/status/directory/time/queue/parentTaskID/pending count. | No frontend field-hiding workaround. |
| Overlay `tree-writer.ts` | Uses `boardStore.board.task.request` and attachments. | Unchanged; selected board remains full. |
| `config.ts` / `git.ts` | Read selected board task metadata. | Unchanged. |

## Design

Create a dedicated task-list projection in the backend:

- `viewTaskListTask()` returns only list-owned task fields.
- `taskItems()` stops attaching `plan`, `run`, and `evaluation` to list rows.
- `ProjectTaskSummary.task` / `GlobalTaskBoard.tasks[].task` use a lean schema
  instead of the full `Task` schema.
- Full task and board routes keep the existing `viewTask()` contract.

No fallback contract is added. If a UI surface needs full task detail, it must
use the selected task detail/board route.

## Acceptance

- `/global/tasks` rows do not contain `task.request`, `task.metadata`,
  `task.attachments`, `task.budget`, `plan`, `run`, or `evaluation`.
- Queue revision, pending interactions, active sessions, lineage, status,
  directory, and timestamps remain available to the sidebar.
- Full `/task/:taskID` still returns full task detail.
- Overlay pagination tests still pass.
- A real local `/global/tasks?limit=11` response is materially smaller after
  restarting the service with the patch.
