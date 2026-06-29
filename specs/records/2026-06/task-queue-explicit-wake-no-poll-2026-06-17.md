# Task Queue Explicit Wake, No Background Poll - 2026-06-17

## Problem

`TaskQueueService.init()` registers `task-queue-service.poll` every 500 ms.
That makes A2A session prompt work advance from a background timer instead of
from a real enqueue, user message, tool result, or queue completion event.

The same service also turns failed or stale running work into `retrying`, so the
next timer tick can re-run the same prompt without a new operator or tool
event. That is a hidden retry loop, not an observable fact.

## Call Point Inventory

Command:

```powershell
rg "Scheduler\.register|TaskQueueService|\.runNow\(|runNow\(|poll|queued|running|failed|completed|retrying" packages/opencorvus/src packages/opencorvus/test -n
```

Relevant findings:

| Surface                 | Evidence                                                                                                                                         | Decision                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Resource timers         | `project/gc.ts`, `worktree/gc.ts`, `tool/truncation.ts`, `scheduler/cron-service.ts` use `Scheduler.register`.                                   | Keep. They are resource cleanup or user-authored cron jobs, not task/agent flow admission.                                                      |
| A2A queue timer         | `scheduler/task-queue-service.ts::init` registers `task-queue-service.poll` with 500 ms interval.                                                | Delete the registration. Init must not start a task-flow poller.                                                                                |
| Queue enqueue           | `enqueuePrompt` is used by `executor/opencorvus.ts` and tests. `enqueuePromptAfterPersistingUserMessage` is used by `/session/:id/prompt_async`. | Enqueue is the explicit wake boundary; it should request a queue drain after persisting the row/message.                                        |
| Executor submit         | `executor/opencorvus.ts::submit` calls `enqueuePrompt` and then `TaskQueueService.runNow()`.                                                     | Remove the second trigger after enqueue becomes the single source.                                                                              |
| Queue completion        | After a prompt task completes, same-session or cross-session queued work should not wait for a timer.                                            | Completion is a real event; request another drain after completion/failure.                                                                     |
| Failure / stale running | `fail()` and `recover()` used to move the same queue row back into an automatic retry path.                                                      | Do not auto-retry. Mark the queue task failed and publish the visible session error. A later user message or explicit enqueue creates new work. |
| Engine task queue       | `engine/queue.ts` starts loops through `dispatchTaskLoop`, `advanceQueue`, operator messages, retry, and loop completion.                        | Keep. It is already event/submit driven; this change must not add status gates there.                                                           |

## Fix

1. Remove `Scheduler.register({ id: "task-queue-service.poll", ... })` from
   `TaskQueueService.init()`.
2. Rename the internal poll path to an explicit drain path. Keep
   `TaskQueueService.runNow()` only as a deterministic explicit drain helper
   for tests/admin callers.
3. Call the explicit drain request from:
   - `enqueuePrompt`;
   - `enqueuePromptAfterPersistingUserMessage`;
   - queue task completion/failure.
4. Mark prompt execution failure and no-activity timeout as `failed`, not
   `retrying`.
5. Keep `Scheduler.register` available for non-flow timers.

## Acceptance

- `TaskQueueService.init()` does not call `Scheduler.register`.
- `rg "task-queue-service\.poll" packages/opencorvus/src packages/opencorvus/test`
  has no match.
- Enqueueing a prompt explicitly starts execution without a background poll or
  a separate caller-side `runNow()`.
- `OpencorvusExecutor.submit/resume` do not call `TaskQueueService.runNow()`.
- Prompt failure does not write `retrying` and does not auto-retry the same
  prompt.
- A no-activity timeout is based on the last observed progress timestamp and
  produces a visible failed queue task without auto-retry.
- Failed/completed/active engine tasks still accept user messages and dispatch
  through `dispatchTaskLoop`.
