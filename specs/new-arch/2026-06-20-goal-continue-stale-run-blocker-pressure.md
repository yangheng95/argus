# Goal Continue Stale Run Blocker Pressure

Date: 2026-06-20

## Acronyms

- G2: Goal 2, the task goal that was manually resumed and later completed in the observed economy clone task.
- API: Application Programming Interface, the HTTP route and generated contract exposed by OpenCorvus.

## Evidence

Observed task `tsk_ee0f11c510011D4AnsTMGr0bh7` had:

- A run artifact `run-blocked` at local `2026-06-20 03:02:36` with `blocking_reason=orchestrator_stream_error`.
- A later operator message at local `2026-06-20 09:59:11` that successfully started G2 retry.
- A completed G2 retry at local `2026-06-20 10:07:38`.
- No later `goal_refill_notification`.

The earlier G1/G2 repair intentionally preserved the rule that runtime liveness must not implicitly resume `orchestrator_stream_error` blocked runs. That rule is still correct. The missing case is explicit operator recovery: once the operator posts a task-level message and the orchestrator is woken, the stale blocked run must be reopened before later terminal goal attempts can drive refill scheduling.

## Call-Point Audit

Commands:

```powershell
rg -n "appendAndWakeTaskOperatorMessage|reopenActiveRunForOperatorWake|reactivateTaskForOperatorWake|recordOperatorNote|/message" packages/opencorvus/src packages/opencorvus/test
rg -n "goal_refill|syncTerminalGoalRefills|orchestrator_stream_error|blocked" packages/opencorvus/src/engine/runtime.ts packages/opencorvus/test/engine
```

Relevant call points:

| Surface                                 | Existing behavior                                                                                                               | Repair decision                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `/task/:id/message`                     | Appended the operator message and dispatched the task loop, but left a stale active run in `blocked/orchestrator_stream_error`. | Reuse `reopenActiveRunForOperatorWake` after task reactivation and before dispatch.                    |
| `EngineService.recordOperatorNote`      | Woke the orchestrator but preserved the stale blocked run.                                                                      | Reuse the same run reopen helper for operator notes.                                                   |
| `EngineRuntime.syncTerminalGoalRefills` | Correctly refuses to wake when the parent run is still `blocked/orchestrator_stream_error`.                                     | Keep this guard; recovery must come from explicit operator action, not liveness fallback.              |
| Completed-task continuation             | Terminal completed tasks must remain behind the directory queue when another same-cwd task is active.                           | Completed tasks reactivate to `queued`; failed and cancelled tasks continue to reactivate to `active`. |

## Tests

- `packages/opencorvus/test/engine/task-message-revive.test.ts`
  - Operator notes reopen stale run blockers.
  - Service-level task messages reopen stale run blockers.
  - Pressure case: a `blocked/orchestrator_stream_error` run receives a task-level continue message, a completed G2-style retry goal run is present, and `EngineRuntime.syncRun` must emit the next `goal_refill_notification`.
  - Pending interaction blockers remain blocked.
- `packages/opencorvus/test/engine/runtime-goal-run-convergence.test.ts`
  - Stream-error blocked runs still do not liveness-dispatch without explicit recovery.

## Acceptance

- Explicit task-level operator continuation reopens stale active run blockers when there is no pending interaction.
- A completed terminal goal run after explicit continuation triggers the next refill wake.
- Runtime liveness still does not implicitly resume `orchestrator_stream_error` runs.
- Completed-task continuation still respects the directory queue.
