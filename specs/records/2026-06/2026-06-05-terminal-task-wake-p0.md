# Terminal Task Wake P0

Date: 2026-06-05

## Problem

A completed task must not be reactivated by an operator wake, API injection, queued wake, or a tool-result continuation. If the runtime wakes the orchestrator while a task is still active, the prompt must say plainly that the input is a wake message, not user-authored text.

Observed incident `tsk_e97a4a5d5001GP4TGo3tcP25M0`:

- No persisted root, operator, or orchestrator user message contains the exact text `End`.
- The first `End` appears inside an orchestrator assistant reasoning part, after the task had already passed post-build integrity.
- `integrity.review.completed` marked the run and task completed.
- The same orchestrator session then continued from the integrity tool result and called `build`.
- `build` created a new run and called `updateTask(... status: "active" ...)`, clearing `time_completed`.

This is a lifecycle integrity bug, not a string parsing bug.

## Call-Site Census

Deleted terminal-reopen entry point:

- The old `openTaskForOperatorMessage` abstraction reopened terminal tasks and is removed.
- `packages/opencorvus/src/engine/queue.ts` must reject terminal tasks before any operator-message dispatch work.
- `packages/opencorvus/src/task-api/index.ts` must append visible messages directly and decide wake/no-wake from the task's current derived status.

Operator message/API routes:

- `continueTaskMessage` always returns `resumed: true`.
- `appendAndWakeTaskOperatorMessage` always dispatches `dispatchTaskLoop`.
- `injectMessage` always returns `orchestratorWoken: true`.

Orchestrator build/run creation:

- `ensureDispatchableRunForSingleGoal` can create a fresh run after the prior run is terminal, then marks the task active.
- `ensureTaskLevelBuildRun` can create a direct run and marks the task active.
- `integrity` completes task/run on post-build pass, but `SessionLoop` continues after normal tool results unless a processor explicitly stops.

Existing tests pinning the old behavior:

- `packages/opencorvus/test/engine/task-message-revive.test.ts`
- `packages/opencorvus/test/engine/queue.test.ts`
- `packages/opencorvus/test/server/task-message-routes.test.ts`
- `packages/opencorvus/test/orchestrator/tools.test.ts`

## Design

Operator messages are visible conversation messages and durable notes. They are not lifecycle restarts.

Terminal task lifecycle may change only through explicit restart paths such as `retryTask` or `restart_from_stage`. Ordinary wake paths must preserve terminal facts: `time_completed`, `error`, `metadata.cancelled`, completed run status, and task context.

Build dispatch must respect the same invariant. A tool-result continuation after task completion must not create a new run for that task. The build tool should return an explicit rejection explaining that the task is terminal and no build was dispatched.

Internal engine wakes are not hidden user messages. For every non-user wake into the orchestrator prompt, the runtime system context must include the plain marker:

> 这是一条 wake 消息，不是用户发送的新消息。

The marker is runtime provenance, not a flow-control gate. The actual lifecycle protection is the terminal task data invariant above.

## Acceptance

- Posting `/task/:taskID/message` to completed, failed, or cancelled tasks appends the visible user message, returns `should_resume: false`, does not dispatch the task loop, and preserves terminal task facts.
- Posting `/task/:taskID/inject` to a terminal task appends the visible user message, returns `orchestratorWoken: false`, and preserves terminal task facts.
- Queue dispatch with `operatorMessage` against a terminal task ignores the wake and preserves terminal task facts.
- The old operator-message task reopen entry point is deleted.
- Build cannot create or activate a run when the task is terminal.
- Internal orchestrator wakes include the exact wake-provenance marker above in system context.
