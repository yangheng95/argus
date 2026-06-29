# Project Delete Unhandled Rejection 2026-06-29

## Requirement

Deleting a project must not leave any project-owned prompt, queue wake, task loop, or session-side async work running after the project/session rows are removed. A project delete failure must be a handled route error; it must never surface as process-level `unhandledRejection` / `uncaughtException` that restarts the backend.

## Recall

- User original request: "现在删除项目经常会出现unhandeledexception，导致后端重启，怎么彻底解决问题".
- Acceptance:
  - Reproduce the delete-project async-lifecycle gap with a regression test.
  - `DELETE /project/current` waits for task-owned and non-task project queue wakes before deleting rows.
  - No process-level `unhandledRejection` / `uncaughtException` occurs during or shortly after deletion.
  - Existing project delete behavior remains: source files stay, `.opencorvus` runtime state is removed, project/task/session rows are removed.
- Hard constraints:
  - No fallback, no compatibility branch, no process-level swallow of unhandled errors.
  - Do not restart or touch a live OpenCorvus / overlay process.
  - Do not use git reset or revert unrelated worktree changes.
  - Do not create a new git worktree.
  - Every code change needs focused tests.
- Existing records read:
  - `specs/current/architecture/10-worktree-lifecycle.md`
  - `specs/current/architecture/16-unified-teardown.md`
  - `specs/records/2026-06/task-project-archive-export-2026-06-04.md`
  - `specs/records/2026-06/mission-project-archive-export-2026-06-18.md`
  - `specs/records/2026-06/2026-06-27-bug-hunt-residual-convergence.md`
- Source files read:
  - `packages/opencorvus/src/project/delete.ts`
  - `packages/opencorvus/src/server/routes/project.ts`
  - `packages/opencorvus/src/task-api/index.ts`
  - `packages/opencorvus/src/scheduler/task-queue-service.ts`
  - `packages/opencorvus/src/engine/cancellation-scope.ts`
  - `packages/opencorvus/src/engine/task-agent-lifecycle.ts`
  - `packages/opencorvus/src/engine/pipeline.ts`
  - `packages/opencorvus/src/orchestrator/loop.ts`
  - `packages/opencorvus/src/session/prompt/state.ts`
  - `packages/opencorvus/test/server/project-routes.test.ts`
  - `packages/opencorvus/test/fixture/process-errors.ts`
- Full-repo grep performed:
  - `rg -n "Delete current project|project\\.current\\.delete|current project|delete.*project|cleanup-candidates|remove.*project|Instance\\.dispose|project/current" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test specs/current specs/records/2026-06 -S`
  - `rg -n "Project deletion|DELETE /project/current|deleteCurrentProject|project deleted|non-task project queue wake|unhandled|Unhandled|queue wake" specs/records/2026-06/2026-06-27-bug-hunt-residual-convergence.md packages/opencorvus/src packages/opencorvus/test -S`
  - `rg -n "export async function deleteTask|async function deleteTask|deleteTask\\(|deleteSession\\(|requestTaskAgentLifecycleCancellation|awaitTaskQueuePromptsIdle|awaitPipelineSettled|awaitTaskLoopIdleForDelete|recordTaskPhysicalDeleteBreadcrumb|Session.removeInProject|TaskQueueService.cancelSessionPrompts|TaskQueueService.awaitSessionPromptsIdle" packages/opencorvus/src/task-api/index.ts -C 4`
  - `rg -n "TaskQueueTable|a2a_task_queue|session_id.*references|onDelete|task_queue" packages/opencorvus/src/scheduler packages/opencorvus/src/storage packages/opencorvus/src/session packages/opencorvus/src/engine -S`
- Independent agent feedback:
  - No sub-agent was spawned. The available multi-agent tool explicitly forbids spawning unless the user asks for sub-agents/delegation/parallel agent work, and the user did not authorize that. This record uses direct main-agent audit evidence instead.

## Root-Cause Chain

Observable symptom:

- Project deletion can finish the HTTP handler path while project-owned async prompt/queue work is still unwinding.
- A later rejection occurs outside the route promise and is caught by `installProcessErrorLogging()`, which rethrows process-level `unhandledRejection` / `uncaughtException`; the backend restarts.

Direct trigger:

- `deleteCurrentProject()` deletes task rows through `EngineService.deleteTask(taskID)` before it calls `cancelRemainingProjectSessionPrompts(projectID)`.
- `EngineService.deleteTask()` cancels and waits only when the task is non-terminal. Terminal tasks skip `cancelTask()`, then delete the root session tree.
- A terminal task can still own a queued/running `a2a_task_queue` wake for its root session. Deleting the session cascades the queue row while the in-flight prompt can still be running.

Deeper cause:

- The current delete path conflates "task is terminal" with "all task-owned session/queue/prompt work is idle". Those are different facts.
- The 2026-06-27 fix covered non-task project queue wakes after task deletion, but task-root sessions are removed inside `deleteTask()` before the project-level remaining-session pass can see them.

Why a global catch is not a valid fix:

- Swallowing `unhandledRejection` would hide the async owner leak and keep deleting rows under still-running code. The correct fix is to make physical deletion wait on the task-owned lifecycle proof before deleting the session/project facts.

## Call-Point Audit

| Surface | Current behavior | Required change |
| --- | --- | --- |
| `project/delete.ts::deleteCurrentProject` | Deletes every task, then cancels remaining project sessions, then removes runtime/project rows. | Keep order, but rely on `deleteTask()` to settle task-owned session prompts for both terminal and non-terminal tasks. |
| `task-api/index.ts::deleteTask` | Terminal tasks skip cancellation and queue wait. | Always collect/cancel task-owned session queue/prompt handles before `Session.removeInProject()`. Only terminal status mutation remains conditional. |
| `task-api/index.ts::cancelTask` | Full cancellation path for active tasks, including lifecycle collection, task queue cancellation, prompt settle, task loop idle, and terminal task update. | Reuse existing lifecycle primitives; do not duplicate a separate project-delete-only queue path. |
| `TaskQueueService.cancelSessionPrompts` | Marks queued rows failed and requests in-flight cancellation. | Use it for terminal task-owned sessions too before session deletion. |
| `TaskQueueService.awaitSessionPromptsIdle` | Waits for in-flight promises and verifies no running rows remain. | Must be reached before session cascade delete, otherwise the DB proof disappears. |
| `Session.removeInProject` | Physically deletes the session tree and cascades queue rows/messages/parts. | Must remain after queue/prompt idle proof. |
| `process-error-logging.ts` | Logs and rethrows unhandled process errors. | Keep unchanged; tests should prove no unhandled process error is produced. |

## Implementation Plan

1. Add a failing regression in `packages/opencorvus/test/server/project-routes.test.ts`:
   - Create a terminal task with a root session.
   - Start a running `TaskQueueService` wake for that session and hold `SessionPrompt.loop`.
   - Call `DELETE /project/current`.
   - Assert the delete route requests cancellation and does not delete project/session/runtime state until the wake settles.
   - Wrap with `expectNoProcessErrors()`.
2. Introduce a single task-owned prompt/queue settle helper in `task-api/index.ts` used by `deleteTask()` before `Session.removeInProject()`.
3. Keep active task cancellation through `cancelTask()`; for terminal tasks, perform lifecycle cancellation + queue prompt cancellation + idle wait + prompt subtree finish without changing terminal task status.
4. Run focused server tests and docs-health tests required by this spec addition.

## Verification

- `bun test packages/opencorvus/test/server/project-routes.test.ts -t "DELETE /project/current" --timeout 60000`
- `bun test packages/opencorvus/test/task-api/delete-running-task-settle.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/fixture/process-errors.ts` is not a standalone suite; project route tests use `expectNoProcessErrors`.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- If product/document-health scope is touched beyond this record, also run `document-health.test.ts` and `product-docs-single-source.test.ts`.
