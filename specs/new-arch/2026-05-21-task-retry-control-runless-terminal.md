# 2026-05-21 Task Retry Control For Runless Terminal Tasks

## Problem

A workflow task can become terminal before a run artifact exists. The observed
task `tsk_e4a74080d001DEkU1iZMGt3nxl` was cancelled after an orchestrator/provider
failure path and has no goals and no active run. Its board projects:

- `task.status = cancelled`
- `overview.nextStep.kind = retry`
- `overview.controls.canRetry = false`

That is a single-source violation. Retry availability is a task lifecycle
decision, not a run-existence decision. `EngineService.retryTask` already knows
how to reopen a terminal task with no live run by clearing `metadata.cancelled`,
queueing the task, and dispatching the task loop. The board blocked the operator
before that valid backend path could be used.

## Current Evidence

- `packages/opencorvus/src/workbench/board.ts::boardOverview` computes
  `canResume = Boolean(input.run) && !active && pendingInteractions.length === 0`
  and then uses it for `canRetry`.
- `packages/overlay/test/task-lifecycle.test.ts` documents the intended
  frontend contract: terminal statuses can retry when there are no pending
  interactions.
- `packages/opencorvus/test/gateway/e2e.test.ts` already proves
  `EngineService.retryTask` can flip a cancelled task back to queued/active.

## Decision

Make board controls derive from the task status projection and pending
interactions, not from active run presence.

Rules:

- `canRetry`: `completed | failed | cancelled` and no pending interactions.
- `canReplan`: same retry eligibility plus an active plan or run plan pointer.
- `canCancel`: `queued | active`, regardless of whether a run artifact exists.

This is not a fallback path. The retry endpoint remains the single backend
operation for task-level retry; the board simply stops hiding it for valid
terminal tasks that have no run row.

## Acceptance

1. A cancelled task with no run artifact projects `controls.canRetry=true`.
2. That board still projects `nextStep.kind="retry"`.
3. A queued task with no run artifact projects `controls.canCancel=true`.
4. Existing `EngineService.retryTask` terminal-task behavior remains passing.
