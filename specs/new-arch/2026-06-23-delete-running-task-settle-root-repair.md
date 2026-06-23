# Delete Running Task Settle Root Repair

Date: 2026-06-23
Status: Fixed and verified

## Requirement

Deleting a task while it is still running must not restart the container. A
successful `DELETE /task/:taskID` must mean every owned live task loop,
orchestrator prompt, session prompt, queued prompt, run, and cleanup writer has
settled before task/session rows are physically deleted.

## Recall

| Source                                                           | Constraint                                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                                      | No fallback, no masking process crashes, no destructive git rollback, tests required for every change.        |
| `specs/new-arch/2026-06-22-delete-active-task-record-context.md` | Record-level `DELETE /task/:taskID` must work without `?directory=` and must not rely on ambient `Instance`.  |
| `specs/new-arch/2026-06-23-task-stop-agent-settle-validation.md` | Task stop success must wait for owned prompt state to disappear; terminal `SessionStatus` alone is not proof. |
| `specs/new-arch/2026-06-23-uncaught-exception-root-repair.md`    | Physical deletion must not race late prompt/session events into process-level unhandled rejections.           |

## Call Point Inventory

Command used before this plan:

```powershell
rg -n "deleteTask\(|cancelTask\(|awaitTaskLoopIdle\(|dispatchTaskLoop\(|runTaskLoop\(|TaskQueueService.cancelSessionPrompts\(|Session.removeInProject|DELETE /task/:taskID" packages/opencorvus/src packages/opencorvus/test specs/new-arch
```

| Surface                            | File                                                                   | Decision                                                                                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Task delete service                | `packages/opencorvus/src/task-api/index.ts::deleteTask`                | Add a final task-loop idle proof after cancellation and pipeline abort, before `Session.removeInProject` and task row deletion.               |
| Task cancel service                | `packages/opencorvus/src/task-api/index.ts::cancelTask`                | Cancel task-owned queued/running `TaskQueueService` prompts for the task session tree in the same branch that cancels `SessionPrompt` states. |
| Task loop idle owner               | `packages/opencorvus/src/orchestrator/loop.ts::awaitTaskLoopIdle`      | Reuse; do not add a second task-loop tracking source. Convert timeout/failure to `TaskCancellationIncompleteError` at the delete boundary.    |
| Task route                         | `packages/opencorvus/src/server/routes/orchestrator.ts`                | Keep route shape unchanged and record-level.                                                                                                  |
| Existing active-delete route tests | `packages/opencorvus/test/server/directory-required.test.ts`           | Keep as no-directory route coverage; it is too shallow to prove live loop settlement.                                                         |
| New regression                     | `packages/opencorvus/test/task-api/delete-running-task-settle.test.ts` | Prove physical deletion waits for the task loop to exit and does not emit process-level unhandled errors.                                     |

## Acceptance

- `deleteTask()` does not remove the root session or task row while the task
  loop is still live.
- If the task loop cannot be proven idle, `deleteTask()` returns
  `TaskCancellationIncompleteError` and leaves the rows intact.
- Task-owned queued prompts are marked failed as part of task cancellation.
- `DELETE /task/:taskID` remains record-level and still works without
  `?directory=`.
- No fallback directory, route gate, UI retry masking, or parallel delete path
  is introduced.

## Verification Plan

```powershell
bun test packages/opencorvus/test/task-api/delete-running-task-settle.test.ts --timeout 60000
bun test packages/opencorvus/test/server/directory-required.test.ts --test-name-pattern "record-level DELETE" --timeout 60000
bun test packages/opencorvus/test/task-api/cancel-task-live-ownership.test.ts packages/opencorvus/test/task-api/cancel-task-abort-timeout.test.ts --timeout 60000
```

Then run a focused typecheck for `packages/opencorvus` and manually review the
diff for premature physical deletion paths.

## Verification Result

```powershell
bun test packages/opencorvus/test/task-api/delete-running-task-settle.test.ts --timeout 60000
bun test packages/opencorvus/test/server/directory-required.test.ts --test-name-pattern "record-level DELETE" --timeout 60000
bun test packages/opencorvus/test/task-api/cancel-task-live-ownership.test.ts packages/opencorvus/test/task-api/cancel-task-abort-timeout.test.ts --timeout 60000
bun test packages/opencorvus/test/server/task-conversation-routes.test.ts --test-name-pattern "POST /task/:taskID/cancel" --timeout 60000
bun run --cwd packages/opencorvus typecheck
```

Results: all targeted tests passed and `tsc --noEmit` passed. The new
regression first failed against the previous implementation because task and
root session rows were removed while the task loop was still live; it passes
after `deleteTask()` waits for task-loop idle before physical deletion.
