# Goal Batch Notification Must Preserve Stream Error Block

Date: 2026-06-07

## Evidence

Live task `tsk_ea213bc3b001JL4X4FOIXD8dED` shows:

- `progress.run.status = running`, `phase = dispatch`
- `progress.activeSessions = []`
- all goals still derive as `pending`
- latest visible task error: `Orchestrator error: session prompt loop finished`
- latest terminal batch notification fingerprint records three goal runs as `aborted`
- artifact order: `run-blocked` with `blocking_reason=orchestrator_stream_error`, then `run-running` with no new goal attempt

The user-visible symptom is: build appears started, but no goal is executing.

## Root Cause

`EngineRuntime.syncGoalRuns` checks terminal goal batches. When no live goal run remains and no interaction is pending, it currently changes every blocked parent run back to `running` before checking whether this exact terminal batch has already dispatched a wake.

That is correct for the first terminal batch wake, but wrong after the batch notification already exists. In the observed task, the orchestrator wake failed with `session prompt loop finished`, which wrote `run-blocked/orchestrator_stream_error`. A later monitor tick saw the same already-notified terminal batch and rewrote the run to `running`, clearing the error without creating a new build session or goal attempt.

## Call-Point Audit

| Surface | Evidence | Decision |
| --- | --- | --- |
| `packages/opencorvus/src/engine/runtime.ts::syncGoalRuns` | Performs terminal batch wake, records `goal_batch_notification`, and currently clears blocked before the notification check. | Move the existing notification check before blocked-run resume. |
| `packages/opencorvus/src/engine/state.ts::blockActiveRunForTask` | Writes the real `orchestrator_stream_error` block. | Leave unchanged. |
| `packages/opencorvus/src/orchestrator/agent.ts` | Converts `session prompt loop finished` into stream-error block. | Leave unchanged. |
| `packages/opencorvus/src/session/prompt/state.ts` | Emits the concrete `session prompt loop finished` error to pending callers. | Leave unchanged. |
| `packages/opencorvus/test/engine/runtime-goal-run-convergence.test.ts` | Existing terminal batch tests cover first wake and duplicate notification. | Add regression for already-notified terminal batch preserving stream-error blocked run. |

## Fix

`goal_batch_notification` remains the single durable source for “this terminal batch already woke the orchestrator.” Once that fact exists, `syncGoalRuns` returns before mutating the parent run. First-time terminal batch behavior stays unchanged.
