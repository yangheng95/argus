# Delete Running Task No Premature Queue Terminalization - 2026-06-28

## Problem

Deleting a task while owned work is still running can still leave the backend
in an unsafe state. The focused regression suite currently proves the queue
branch is broken: `TaskQueueService.cancelSessionPrompts()` marks in-flight
`running` queue rows `failed` before the prompt path has actually stopped, then
`cancelTask()` / `deleteTask()` waits for the in-memory promise and times out if
the prompt has not unwound. This splits durable queue status from the real
execution handle.

## Recall

| Source | Constraint |
| --- | --- |
| `AGENTS.md` | No fallback, no masking, no database status pretending a live handle has stopped. |
| `specs/records/2026-06/2026-06-22-delete-active-task-record-context.md` | Record-level `DELETE /task/:taskID` must work without ambient `Instance` and must not crash with `No context found for instance`. |
| `specs/records/2026-06/2026-06-23-delete-running-task-settle-root-repair.md` | Physical delete must wait for task loop, session prompt, queued prompt, and cleanup writers to settle before deleting task/session rows. |
| `specs/records/2026-06/2026-06-27-bug-hunt-residual-convergence.md` lines 747 and 774 | Queue cancellation must not mark task-owned running queue rows failed before cancellation completion is proven; in-flight rows terminalize only after the prompt path observes cancellation. |
| `specs/records/2026-06/2026-06-27-bug-hunt-residual-convergence.md` lines 1447-1449 | Later change reversed that contract by immediately failing in-flight rows; this is the contradictory design that reintroduced the bug class. |

## Call-Point Inventory

Command:

```powershell
rg -n "failInFlightSessionPrompts\(|requestInFlightCancellation|awaitSessionPromptsIdle|cancelSessionPrompts\(|TaskQueueService\.failInFlightSessionPrompts|TaskQueueService\.awaitSessionPromptsIdle|TaskQueueService\.cancelSessionPrompts" packages/opencorvus/src packages/opencorvus/test specs -S
```

| Surface | Current behavior | Repair decision |
| --- | --- | --- |
| `TaskQueueService.cancelSessionPrompts()` | Fails queued rows, requests in-flight cancellation, then also calls `failInFlightSessionPrompts()` to mark running rows failed immediately. | Keep queued-row failure and in-flight cancellation request. Remove immediate in-flight durable failure. The in-flight promise remains the single live owner. |
| `TaskQueueService.failInFlightSessionPrompts()` | Public helper that writes `running -> failed` for in-flight rows without proof the prompt stopped. | Remove this helper and its call sites; it is a duplicate terminalization owner. |
| `TaskQueueService.execute()` | After the prompt/wake/compaction path returns, `assertInFlightNotCancelled()` throws when cancellation was requested; `.catch(fail)` writes the queue row failed. | Keep as the sole durable terminalization path for in-flight cancellation. |
| `TaskQueueService.awaitSessionPromptsIdle()` | Waits for matching in-flight promises and rejects if DB still has `running` rows without matching in-flight state. | Keep; this is the deletion safety proof. |
| `EngineService.cancelTask()` / `deleteTask()` / `deleteSession(deleteTasks)` | Request queue cancellation, wait for prompt idle, then mark task terminal or physically delete. | Keep waiting. With premature queue failure removed, durable queue state remains running until the real handle exits. |
| `project/delete.ts` | Calls both `cancelSessionPrompts()` and `failInFlightSessionPrompts()` before project row deletion. | Remove the direct in-flight failure call; project deletion must use the same wait-and-settle proof. |
| Scheduler regression | One test still asserts immediate failed row from the contradictory later contract. | Update it to assert running while Session.get is blocked, then failed only after the blocked execution releases and observes cancellation. |
| Task delete regression | Already asserts delete/cancel keep rows while in-flight queue prompt is running and fail them after release. | Keep and make it pass. |

## Acceptance

- `cancelSessionPrompts()` requests cancellation for in-flight prompts but does
  not mark their queue rows terminal while their in-memory promise is still
  running.
- `cancelTask()` and `deleteTask()` preserve task/session rows while a
  task-owned queue prompt is still running.
- Once the in-flight prompt path unwinds after cancellation, the queue row is
  marked failed with the cancellation reason and physical deletion may proceed.
- If a running queue prompt cannot be proven idle before timeout,
  `TaskCancellationIncompleteError` is returned and task/session rows are not
  deleted.
- Project deletion uses the same queue-settlement path; it has no separate
  running-row failure shortcut.
- No fallback directory, retry gate, UI masking, or duplicate queue
  terminalization source is introduced.

## Verification Plan

```powershell
bun test packages/opencorvus/test/task-api/delete-running-task-settle.test.ts packages/opencorvus/test/task-api/delete-session-delete-tasks-settle.test.ts --timeout 60000
bun test packages/opencorvus/test/scheduler/task-queue-service.test.ts --test-name-pattern "claimed wake|inactivity|publishes session error" --timeout 60000
bun test packages/opencorvus/test/server/directory-required.test.ts --test-name-pattern "record-level DELETE" --timeout 60000
bun run --cwd packages/opencorvus typecheck
```

## Verification Completed

```powershell
bun test packages/opencorvus/test/task-api/delete-running-task-settle.test.ts packages/opencorvus/test/task-api/delete-session-delete-tasks-settle.test.ts --timeout 60000
bun test packages/opencorvus/test/scheduler/task-queue-service.test.ts --test-name-pattern "cancelSessionPrompts stops claimed in-flight wake before it starts a loop|recovery releases stale in-flight prompt promises that stop producing activity|publishes session error when stale running task reaches terminal failure|timer recovery publishes cancellation failure and re-arms the running row" --timeout 60000
bun test packages/opencorvus/test/server/directory-required.test.ts --test-name-pattern "record-level DELETE" --timeout 60000
bun test packages/opencorvus/test/server/project-routes.test.ts --test-name-pattern "DELETE /project/current waits for non-task project queue wake before removing state" --timeout 60000
bun run --cwd packages/opencorvus typecheck
```

All listed commands passed. A mistyped exploratory command against
`packages/opencorvus/test/project/project.test.ts` did not run the intended
project-delete route test and exposed a one-off log path initialization error;
the correct route regression above passed.
