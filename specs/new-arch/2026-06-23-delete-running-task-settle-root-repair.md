# Delete Running Task Settle Root Repair

Date: 2026-06-23
Status: Fixed and verified

2026-06-24 follow-up: user reported deleting a task that has not stopped can
still restart the service. Re-inspection found the remaining race in
`TaskQueueService`: `cancelSessionPrompts()` marks queued/running rows failed,
but a row already claimed into the in-memory `inFlight` map can continue into
`SessionPrompt.loop()` while `deleteTask()` proceeds to physical
`Session.removeInProject()` / task deletion.

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

| Surface                            | File                                                                   | Decision                                                                                                                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task delete service                | `packages/opencorvus/src/task-api/index.ts::deleteTask`                | Add a final task-loop idle proof after cancellation and pipeline abort, before `Session.removeInProject` and task row deletion.                                                              |
| Task cancel service                | `packages/opencorvus/src/task-api/index.ts::cancelTask`                | Cancel task-owned queued/running `TaskQueueService` prompts for the task session tree, then wait for matching in-flight queue handles to settle before terminal status or physical deletion. |
| Task queue service                 | `packages/opencorvus/src/scheduler/task-queue-service.ts`              | Keep the in-memory `inFlight` map as the single source for claimed queue execution; cancellation must mark matching handles cancelled and expose an awaitable idle proof.                    |
| Task loop idle owner               | `packages/opencorvus/src/orchestrator/loop.ts::awaitTaskLoopIdle`      | Reuse; do not add a second task-loop tracking source. Convert timeout/failure to `TaskCancellationIncompleteError` at the delete boundary.                                                   |
| Task route                         | `packages/opencorvus/src/server/routes/orchestrator.ts`                | Keep route shape unchanged and record-level.                                                                                                                                                 |
| Existing active-delete route tests | `packages/opencorvus/test/server/directory-required.test.ts`           | Keep as no-directory route coverage; it is too shallow to prove live loop settlement.                                                                                                        |
| New regression                     | `packages/opencorvus/test/task-api/delete-running-task-settle.test.ts` | Prove physical deletion waits for the task loop to exit and does not emit process-level unhandled errors.                                                                                    |

## Acceptance

- `deleteTask()` does not remove the root session or task row while the task
  loop is still live.
- If the task loop cannot be proven idle, `deleteTask()` returns
  `TaskCancellationIncompleteError` and leaves the rows intact.
- Task-owned queued prompts are marked failed as part of task cancellation.
- Task-owned in-flight queue prompts are cancelled before they can start a new
  prompt loop after the task cancellation decision, and physical deletion waits
  for their promise to settle.
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

2026-06-24 follow-up verification:

```powershell
bun test packages/opencorvus/test/task-api/delete-running-task-settle.test.ts packages/opencorvus/test/scheduler/task-queue-service.test.ts --timeout 60000
bun test packages/opencorvus/test/server/directory-required.test.ts --test-name-pattern "record-level DELETE" --timeout 60000
bun test packages/opencorvus/test/task-api/cancel-task-live-ownership.test.ts packages/opencorvus/test/task-api/cancel-task-abort-timeout.test.ts --timeout 60000
bun run --cwd packages/opencorvus typecheck
```

Results: all commands passed. The new queue regression proves `deleteTask()`
keeps task/session rows while a task-owned in-flight queue wake is still
settling. The scheduler regression proves cancelling a claimed queue wake
before it enters `SessionPrompt.loop()` prevents a new loop from starting after
the cancellation decision. The record-level route check caught and verified the
fix for stale DB records whose session directory has no active `Instance`.
