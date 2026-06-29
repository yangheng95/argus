# Active Run Projection Retry Convergence - 2026-06-27

## Incident

Task `tsk_f078b27df001eflBfYa6W04uKG` showed a mixed debug state after
operator cancellation and retry:

- task lifecycle projection was active/running;
- `task.activeRunID` still pointed at `run_f078f150b001s0N0Z93oqRhcOj`;
- that run's latest artifact was `status="aborted"` with `error="task cancelled"`;
- no new goal/run had replaced it yet.

The user-visible symptom was that a retriggered task still looked cancelled.

## Recall

- `specs/new-arch/16-unified-teardown.md`: `active_run_id` cache was removed,
  but stale active-run gates must not survive under a projection helper.
- `specs/operator-wake-status-facts-not-scheduler-2026-06-17.md`: explicit
  retry may reopen a blocked live run, but ordinary operator wakes and retry
  must not let status facts schedule by themselves.
- `specs/new-arch/2026-06-26-explicit-terminal-task-lifecycle.md`: task
  lifecycle facts stay derived from `(time_started, time_completed, error,
  metadata.cancelled)`; do not restore a task status column.

## Call-Point Audit

Command:

```powershell
rg -n "findActiveRunForTask\(|activeRunBySession\(|findRuns\(|LIVE_RUN_STATUSES|DISPATCHABLE_RUN_STATUSES" packages/opencorvus/src packages/opencorvus/test -g "*.ts" -S
```

Findings:

| Surface | Required role |
| --- | --- |
| `viewTask.activeRunID`, board/debug, blocking reason | live active run only; terminal aborted runs must not appear here |
| retry/cancel/session abort/runtime liveness | live active run only |
| orchestrator "Latest Run Result", brief/progress history | latest run tip, even when terminal |
| `/task/:taskID/runs` | full run history through `findRuns` |

## Repair

- Add an explicit `findLatestRunForTask(taskID)` for history/result context.
- Make `findActiveRunForTask(taskID)` return the latest run tip only when that
  tip is live.
- Keep task terminal projection unchanged; retry clears terminal task facts via
  `updateTask({ status: "queued" | "active" })` and explicit metadata cleanup.
- Update the few result/history call sites to read `findLatestRunForTask`.
- Add a regression: retrying a cancelled task whose newest run is aborted must
  clear task terminal state and must not expose the aborted run as
  `activeRunID`.

## Acceptance

- `viewTask(...).activeRunID` is undefined when the only latest run is aborted.
- `EngineService.retryTask` on a cancelled task with an aborted latest run
  returns a non-terminal task view and no stale `terminalReason`.
- Orchestrator still sees latest completed/failed/aborted run result through
  explicit latest-run context when it needs to decide the next step.
