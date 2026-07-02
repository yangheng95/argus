# Runtime Status Timing Root Repair

Date: 2026-07-02

## Problem

The current elapsed-time display is not a cosmetic timer bug. It is a lifecycle
model leak:

- the task header renders terminal duration from `task.time.created` to
  `task.time.completed`, so queued time is counted as runtime;
- active SSE (Server-Sent Events) runtime is keyed by `task.time.created` while
  the calculation baseline is `task.time.started`, so retry/re-entry windows are
  mixed;
- reactivating a terminal task clears `time_completed` without resetting
  `time_started`, so a later completion can join an old failed start to a new
  terminal timestamp and inflate by hours;
- task queue failure and recovery paths clear `time_started`, erasing the
  actual running window;
- stale terminal writes can still rewrite task terminal facts because the low
  level task update writes by task id only.

## Recall

### User Request

The user reported that elapsed time is "乱七八糟": it is not based on real
runtime, keeps counting after stop, resets on open, and can jump by dozens of
hours when status changes from failed to completed. The follow-up directive was
"拨乱反正，正本清源".

### Acceptance Criteria

1. Task runtime duration is derived from one durable runtime window:
   `task.time.started` to `task.time.completed` for terminal tasks, and
   selected-task activity minus `task.time.started` for active tasks.
2. `task.time.created` is never used as runtime start. It remains ordering and
   creation evidence only.
3. Reactivating a terminal task creates a new runtime window by resetting
   `time_started` when the caller does not provide an explicit new start.
4. Terminal task writes do not rewrite an already terminal durable fact from a
   stale row.
5. Agent-to-Agent queue terminal rows preserve their actual `time_started`.
6. Missing or invalid runtime timestamps are surfaced as data-contract errors,
   not silently inferred from another timestamp.
7. Regression tests cover active, terminal, reactivation, stale terminal, and
   queue failure timing behavior.

### Hard Constraints

- No fallback, compatibility path, double source, or status gate is allowed.
- The repair must be based on the current stored plan and repository evidence
  before code changes.
- Tests must use real inactivity semantics where timeouts are involved.
- Existing user changes must not be reverted.
- No OpenCorvus or overlay process may be restarted or killed without explicit
  user approval.

### Sources Read

- `AGENTS.md`
- `specs/README.md`
- `specs/current/architecture/02-data.md`
- `specs/current/architecture/03-control.md`
- `specs/current/architecture/16-unified-teardown.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-06/2026-06-04-overlay-tool-agent-timer-single-source.md`
- `specs/records/2026-06/2026-06-28-tool-pending-start-time-contract.md`
- `specs/records/2026-06/2026-06-29-task-active-sse-elapsed.md`
- `specs/records/2026-06/2026-06-29-task-active-sse-runtime-elapsed.md`
- `specs/records/2026-06/2026-06-30-retire-live-run-control-source.md`
- `packages/opencorvus/src/engine/state.ts`
- `packages/opencorvus/src/engine/task-status.ts`
- `packages/opencorvus/src/engine/store.ts`
- `packages/opencorvus/src/task-api/index.ts`
- `packages/opencorvus/src/scheduler/task-queue-service.ts`
- `packages/overlay/src/components/TaskStatusHeader.tsx`
- `packages/overlay/src/services/task-runtime-activity.ts`
- `packages/overlay/src/services/sse.ts`
- `packages/overlay/src/components/CardHeaderChrome.tsx`

### Whole-Repository Search Evidence

- `rg -n 'time_started|time_completed' packages specs -g '*.ts' -g '*.tsx' -g '*.md'`
  found the task lifecycle facts, run artifacts, Agent-to-Agent queue rows,
  frontend projection sites, and existing timing records.
- `rg -n 'taskRuntimeActivityKey|selectedTaskSseActiveElapsedMs|advanceSseActiveElapsed|recordSelectedTaskSse' packages/overlay packages/opencorvus -g '*.ts' -g '*.tsx'`
  found the single selected-task SSE runtime activity owner and all callers.
- `rg -n 'useNowTick|time\.created|time\.started|timeCompleted|completedTime|startedTime|status === "running"' packages/overlay -g '*.ts' -g '*.tsx'`
  found the task header duration bug and card duration surfaces.
- `rg -n 'terminalTask|updateTask|updateRun|updateGoalRun|abortRun|TaskQueue|task_queue|a2a' packages/opencorvus/src packages/opencorvus/test -g '*.ts'`
  found the backend mutation seams and Agent-to-Agent queue failure paths.

### Independent Agent Feedback

- Backend review: `updateTask(status: "active")` clears `time_completed`
  without resetting old `time_started`; low-level terminal task writes are not
  first-terminal-wins; queue failure erases `time_started`.
- Frontend review: `TaskStatusHeader` terminal duration uses `created` instead
  of `started`; active elapsed is keyed by `created`; card duration can keep
  ticking when a card remains marked `running` without a terminal timestamp.
- Scheduler/event review: protocol event emitted time is not a runtime window;
  task terminal facts need durable ownership, and retry/reopen must be modeled
  as a new runtime window rather than a mutation of the old terminal window.

## Decision

The source of truth is the durable backend runtime window:

```text
queued:    time_started = null, time_completed = null
active:    time_started = attempt start, time_completed = null
terminal:  time_started = attempt start, time_completed = terminal time
```

Frontend runtime display consumes those facts directly:

- active task header: selected-task activity watermark minus
  `task.time.started`;
- terminal task header: `task.time.completed - task.time.started`;
- invalid or missing `started/completed` is a contract error;
- `task.time.created` is only for ordering and identity of created records.

Backend mutation rules:

- reactivating a terminal task without explicit `time_started` stamps a new
  `time_started`;
- stale terminal task writes cannot overwrite a row that has already become
  terminal;
- Agent-to-Agent queue failure/recovery preserves `time_started` and stamps only
  `time_completed`, `status`, `error_message`, and `time_updated`.

This is a data-integrity repair, not a gate: no transition matrix is introduced.

## Verification Plan

- Add backend regression tests for terminal reactivation start reset, stale
  terminal write refusal by durable fact, and queue failure preserving
  `time_started`.
- Add overlay unit/static tests proving runtime keys and terminal duration use
  `task.time.started`, not `task.time.created`.
- Run the historical docs link test after adding this record.
- Review the diff after tests to ensure no compatibility path or fallback was
  introduced.
