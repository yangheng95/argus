# World Economy Stuck Adversarial Goal Review

Date: 2026-06-21

## Scope

This note records the adversarial repair-review goal for the world-economy clone
task class after task `tsk_ee601ebe400176W5YPgE5bHDqY` appeared stuck.

The goal is not to make runtime liveness silently resume failed orchestrator
runs. The goal is to prove whether the current code still contains the
operator-message abort bug, whether explicit operator recovery reopens stale
blocked runs, and whether prompt-budget failures remain visible instead of
being retried into noise.

## Incident Evidence

Observed task debug data:

| Field | Value |
| --- | --- |
| Task | `tsk_ee601ebe400176W5YPgE5bHDqY` |
| Directory | `C:\Users\chuan\myhexin-local\demos\economy\economy_2` |
| Active run | `run_ee64523d3001JFtZbDYvu2MI3e` |
| Run status | `blocked` |
| Blocking reason | `orchestrator_stream_error` |
| Error | `OrchestratorAborted: orchestrator aborted` |
| Active sessions | none |
| Pending interactions | none |

Current read-only service check against `http://127.0.0.1:7878` after the
review started:

| Field | Value |
| --- | --- |
| Query time | 2026-06-21 |
| Summary | `running_tasks=1`, `blocked_tasks=0` |
| Task status | `active` |
| Active run status | `running` |
| Active session | `ses_1197d6635ffePz6KqY5ZkYN8sQ` |

This means the provided debug snapshot was stale by the time of this review.
The original stuck state still explains the incident, but the live server no
longer needs a blind recovery message for this exact task. Further action
should watch the current run evidence instead of re-posting the same wake.

Trace evidence reconstructed before this review:

- `2026-06-20T19:29:39Z`: live build sessions for HeaderNavigation,
  Breadcrumb, and SectionTabs were cancelled.
- `2026-06-20T19:29:39Z`: orchestrator wake failed with
  `orchestrator aborted`.
- Later goal retries completed Breadcrumb and SectionTabs.
- HeaderNavigation later failed with `PromptBudgetOverflowError` after a valid
  same-source structured compaction summary already existed.

## Root Cause Classification

The 04:39Z debug snapshot was a residual blocked task state from the already
repaired wake/cancel bug class, plus a secondary deterministic prompt-budget
failure. It is not a new generic-wake-aborts-live-owner regression in current
HEAD.

The causal chain is:

1. A task-level wake was historically able to interrupt the root orchestrator
   loop.
2. `Orchestrator.abort` cascaded into descendant build sessions, which explains
   the cancelled live build sessions at `2026-06-20T19:29:39Z`.
3. The task run was left in `blocked/orchestrator_stream_error`.
4. Runtime refill correctly refused to auto-resume that blocked run. This is a
   safety invariant, not the bug: stream-error recovery must be explicit
   operator action.
5. HeaderNavigation then hit a deterministic prompt-budget overflow. Retrying
   the same bloated context is expected to fail fast; the proper repair is a
   lean fresh build context or goal rewrite, not hidden retry.

## Call-Point Audit

Commands used:

```powershell
rg -n "dispatchTaskLoop|interruptTaskLoop|reopenActiveRunForOperatorWake|syncTerminalGoalRefills|orchestrator_stream_error|PromptBudgetOverflowError|abortLiveOrchestratorToolOwnership" packages/opencorvus/src packages/opencorvus/test specs/new-arch
rg -n "abortLiveOrchestratorToolOwnership\(|abortLiveExecutionForTask\(|abortDeadOwnerLiveExecutionForTasks\(|interruptTaskLoop\(" packages/opencorvus/src packages/opencorvus/test
rg -n "dispatchTaskLoop\(\{[^\n]*(interrupt|operatorMessage|operatorIntent)|interrupt:" packages/opencorvus/src packages/opencorvus/test
```

Relevant production surfaces:

| Surface | Review result |
| --- | --- |
| `packages/opencorvus/src/engine/queue.ts::dispatchTaskLoop` | Accepts only `taskID` and optional event. Live `orchestrator_tool_ownership` queues the wake and returns `queued`; it does not call abort. |
| `packages/opencorvus/src/task-api/index.ts::appendAndWakeTaskOperatorMessage` | Persists the operator message, clears rewind cursor, reactivates terminal tasks, reopens stale blocked runs, then dispatches a non-destructive wake. |
| `packages/opencorvus/src/engine/task-message-open.ts::reopenActiveRunForOperatorWake` | Reopens live blocked runs only when there is no pending interaction. Pending user/tool blockers stay blocked. |
| `packages/opencorvus/src/engine/runtime.ts::syncTerminalGoalRefills` | Preserves the `blocked/orchestrator_stream_error` guard. Explicit operator recovery, not runtime liveness, reopens this state. |
| `packages/opencorvus/src/orchestrator/tools.ts::cancel_subagent` | Uses `abortLiveOrchestratorToolOwnership` for explicit child cancellation only. |
| `packages/opencorvus/src/orchestrator/tools.ts::restartTaskFromStage` | Uses task-scoped abort for explicit restart. |
| `packages/opencorvus/src/task-api/index.ts::cancelTask` | Uses task-scoped abort for explicit task cancellation. |
| `packages/opencorvus/src/engine/queue.ts::convergeDeadOwnerActiveTasksForCwd` | Uses dead-owner convergence only for orphaned execution state. |
| `packages/opencorvus/src/agent/runner.ts::classifyAttemptOutcome` | `PromptBudgetOverflowError` and `ToolSchemaBudgetError` are deterministic fail-fast errors. |

No production `POST /task/:id/message` or `/inject` path calls
`abortLiveOrchestratorToolOwnership`, `abortLiveExecutionForTask`, or
`interruptTaskLoop`.

## Benchmarks

Targeted commands executed on Windows host with `bun test`, because this project
declares Bun as the package manager and the tests are not Playwright browser
sessions:

```powershell
bun test packages/opencorvus/test/server/task-message-routes.test.ts --test-name-pattern "message.*live|live.*message|async goal|queues behind live|does not interrupt" --timeout 60000
bun test packages/opencorvus/test/engine/queue.test.ts --test-name-pattern "live ownership|interrupt|queued wake|multiple live" --timeout 60000
bun test packages/opencorvus/test/engine/task-message-revive.test.ts --timeout 60000
bun test packages/opencorvus/test/engine/runtime-goal-run-convergence.test.ts --test-name-pattern "stream-error|refill|goal" --timeout 60000
bun test packages/opencorvus/test/agent/runner-retry-classify.test.ts packages/opencorvus/test/session/predictive-compaction-decision.test.ts --test-name-pattern "PromptBudgetOverflow|prompt budget|same-source|empty assistant" --timeout 60000
```

Results:

| Area | Result |
| --- | --- |
| `/message` and `/inject` live-owner routes | 3 passed |
| Queue live-owner wake semantics | 2 passed |
| Explicit operator wake reopens stale blocked runs | 12 passed |
| Runtime terminal-goal refill and stream-error guard | 14 passed |
| Prompt-budget fail-fast and transcript hygiene | 4 passed |

## Acceptance Result

Accepted:

- Generic task-level wake no longer has a cancellation flag.
- Live orchestrator-owned build/integrity children are not aborted by
  `/message` or `/inject`.
- A real `POST /task/:taskID/message` route with multiple live build owners is
  covered and keeps both goal runs `running`.
- The async gap after ownership closes is covered; a message starts another
  orchestrator wake but does not abort the still-running build goal.
- Explicit task-level operator continuation reopens stale
  `blocked/orchestrator_stream_error` runs when there is no pending
  interaction.
- Runtime liveness still does not implicitly resume stream-error blocked runs.
- Prompt-budget overflow is visible and fail-fast, with no hidden retry loop.

Not a source-code gap after this review:

- A task still showing `blocked/orchestrator_stream_error` after this repair
  requires an explicit operator wake or task retry on a server running the fixed
  code. Direct database mutation would hide the scheduling evidence and is not a
  valid repair.
- The provided task no longer showed that blocked state during the read-only
  service check in this review; it had already re-entered `running`.
- HeaderNavigation's later prompt-budget failure is a deterministic build-agent
  context problem. It should be resumed with a fresh lean build context or a
  rewritten goal; it should not be handled by automatic retry of the same
  transcript.

## Remaining Risk

If the live server at `http://127.0.0.1:7878` is still running an older binary,
the fixed source and passing tests do not change that running process. The
server must be restarted or redeployed from a commit containing the wake/cancel
repair before resuming the task.
