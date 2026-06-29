# Task Cron Nonblocking Wait - 2026-06-26

## Acronyms

- DB: Database, the persisted SQLite state owned by OpenCorvus.
- LLM: Large Language Model, the model that makes orchestrator decisions.
- UI: User Interface, the overlay and browser-visible task surfaces.

## Objective

Replace task-scoped `wait` from an in-process blocking sleep with a durable
task-level cron wake. A task wait must return immediately after scheduling a
future wake, release the current orchestrator/tool process, and re-enter the
task through the canonical `dispatchTaskLoop` path when the scheduled time is
due.

The existing 20-minute recommendation remains the default wait duration, but it
becomes a scheduled delay, not a long `await setTimeout(...)` inside the tool.

## Recall

- `AGENTS.md` forbids fallback logic, gate-style host routing, hidden synthetic
  messages, state-machine control flow, and dual sources. The implementation
  must replace the blocking wait path for task-scoped waits instead of adding a
  compatibility branch.
- `2026-06-26-wait-tool-twenty-minute-recommendation.md` made the old blocking
  wait longer to avoid repeated 60-second waits. This is superseded for task
  waits: the same 20-minute value is now a scheduled one-shot cron delay.
- `2026-06-22-orchestrator-live-build-park-prompt.md` says `wait` must not be
  used for live build or sibling goal completion. That remains true; task cron
  wait is only for a named external event.
- `2026-06-24-read-context-drilldown-only.md` removed `read_context` as the
  normal post-wait refresh path. The next scheduled wake gets a fresh rendered
  task snapshot automatically.
- `2026-06-24-terminal-task-no-wake-tool-ownership.md` makes task-level tools
  scheduler-owned and suppresses passive terminal wakes. A due wait wake must
  route through `dispatchTaskLoop`, which already handles terminal suppression.
- Existing `CronService` is the mature scheduler implementation with lease
  claims, one-shot jobs, project scoping, retry backoff, and a `Scheduler`
  registration. Reusing it is the single-source path.

## Call-Point Sweep

Command basis:

```powershell
rg -n "\bwait\b|Wait|WAIT|sleep|delay" packages/opencorvus/src packages/opencorvus/test specs -g "*.ts" -g "*.txt" -g "*.md"
rg -n "cron|schedule|timer|wake|resume|yield|task queue|taskQueue|setTimeout|setInterval" packages/opencorvus/src packages/opencorvus/test specs -g "*.ts" -g "*.txt" -g "*.md"
rg -n "ORCHESTRATOR_WAIT|WAIT_MAX|WAIT_MIN|duration_ms|wait\(" packages/opencorvus/src packages/opencorvus/test -g "*.ts" -g "*.txt"
rg -n "withDecisionEffectMetadata|orchestratorDecisionEffect|dispatchTaskLoop|queued_operator_wake|CronService" packages/opencorvus/src packages/opencorvus/test -g "*.ts"
```

| Surface                                                                     | Decision                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/tool/wait.ts`                                      | Replace blocking sleep with scheduled cron creation. Task calls create `cron_job.task_id` rows; session calls create one-shot session cron rows through the same `cron_job` table. Keep schema bounds as the single duration source.     |
| `packages/opencorvus/src/scheduler/cron.sql.ts`                             | Add nullable `task_id` referencing `engine_task`. `cron_job` becomes the single persisted source for both generic scheduled session wakes and task wait wakes.                                                                           |
| `packages/opencorvus/src/scheduler/cron-service.ts`                         | Add `createTaskWake`, include `taskId` in list views, validate task/project ownership, and execute task jobs through `dispatchTaskLoop` instead of `SessionWake`. One-shot task jobs are disabled after an accepted or ignored dispatch. |
| `packages/opencorvus/src/orchestrator/tools.ts`                             | Stop awaiting `executeWait` for task waits. The existing decision-signature wrapper should see the new `cron_job.task_id` row as a task decision.                                                                                        |
| `packages/opencorvus/src/orchestrator/stateful-tool-names.ts`               | Remove `wait` from the no-decision observation list. A successful task wait schedules a future wake and is now a park decision, not a read-only observation.                                                                             |
| `packages/opencorvus/src/engine/describe.ts`                                | Render pending/recent task cron waits from `cron_job.task_id` so the next LLM wake sees why it was parked or woken.                                                                                                                      |
| `packages/opencorvus/src/session/wake.ts`                                   | Add `scheduler.task_cron` to the wake reason schema only if CronService continues to use `SessionWake` for session cron. Task cron does not append a synthetic user message.                                                             |
| `packages/opencorvus/src/tool/schedule.ts` and experimental schedule routes | Keep existing generic schedule behavior. They continue creating session cron rows without `task_id`; no parallel task schedule API is added.                                                                                             |
| `packages/opencorvus/test/orchestrator/wait-tool.test.ts`                   | Replace elapsed-duration assertions with immediate scheduling assertions and CronService due-wake assertions.                                                                                                                            |
| `packages/opencorvus/test/scheduler/cron-service.test.ts`                   | Add task job execution, project scoping, one-shot disable, and ignored terminal-task consumption coverage.                                                                                                                               |
| `packages/opencorvus/test/orchestrator/no-decision-stop.test.ts`            | Update wait-only stop expectations: scheduled wait is accepted as a decision; build followed by wait is still rejected if it tries to use wait for live build completion.                                                                |

## Design

1. `cron_job` owns scheduled task waits.
   - `task_id != null` means the row is a task cron wake.
   - `task_id == null` preserves existing generic session schedule behavior.
   - There is no second task-wait artifact or process-local timer source.

2. `wait` with `ctx.extra.taskID` calls `CronService.createTaskWake`.
   - The row is one-shot.
   - `next_run = Date.now() + duration_ms`.
   - `prompt` stores the rendered wake note for the future orchestrator turn.
   - The tool returns the job id and due timestamp immediately.

3. `CronService.execute` dispatches task jobs by task id.
   - It calls `dispatchTaskLoop({ taskID, event: { note } })`.
   - It commits the one-shot row after `dispatchTaskLoop` returns `started`,
     `queued`, or `ignored`.
   - `ignored` is a consumed terminal/no-op wake, not a retryable scheduler
     failure.
   - Real dispatch exceptions use the existing lease/backoff failure path.

4. Orchestrator no-decision handling treats scheduled wait as a decision.
   - `wait` is removed from `ORCHESTRATOR_NO_DECISION_OBSERVATION_TOOL_NAMES`.
   - The existing `withDecisionEffectMetadata` wrapper marks it as `decision`
     because `cron_job.task_id` changes the task decision signature.
   - No special-case classifier branch is added.

5. Non-task wait also schedules instead of sleeping.
   - Without `taskID`, the tool calls `CronService.createDelayedSessionWake`
     for the current session.
   - This removes the old blocking path globally and avoids a second wait
     semantic in generic agent/tool surfaces.

## Acceptance

- Calling task-scoped `wait(duration_ms=1200000)` creates exactly one enabled
  one-shot `cron_job` row with the current `task_id`, returns immediately, and
  does not block for the requested duration.
- Calling non-task `wait` creates exactly one enabled one-shot session
  `cron_job` row and does not block for the requested duration.
- A due task cron row calls `dispatchTaskLoop` with a natural wake note and is
  disabled after `started`, `queued`, or `ignored`.
- A due task cron row for a terminal task is consumed and does not create an
  immediate no-decision loop.
- Orchestrator wait-only stop after a successful scheduled wait is not recorded
  as an `orchestrator-decision-contract-failure`.
- `wait` remains forbidden for live build completion in prompt/tool text.
- Generic session cron schedules still pass existing CronService and route
  tests.
- Focused tests pass:
  `bun test packages/opencorvus/test/orchestrator/wait-tool.test.ts packages/opencorvus/test/scheduler/cron-service.test.ts packages/opencorvus/test/orchestrator/no-decision-stop.test.ts`.

## Independent Agent Consensus

Three read-only explorers reviewed the design boundary before implementation:

- Wait/tool surface explorer: confirmed the blocking chain is
  `WaitTool`/`executeWait` -> `await setTimeout`, and that `wait` is currently
  misclassified as observation in no-decision handling. It recommended a
  durable task wake as the only valid new behavior and warned against leaving
  global `wait` blocking while task `wait` is cron-based.
- Task/orchestrator lifecycle explorer: confirmed due task cron must call
  `dispatchTaskLoop({ taskID, event: { note } })`, not `SessionWake`,
  `SessionPrompt.loop`, or `Orchestrator.processTask`, so terminal suppression,
  directory queueing, and live ownership queueing remain single-source.
- Historical-spec explorer: confirmed `cron_job` is the right single persisted
  scheduler source, `wait` remains forbidden for live build or sibling-goal
  polling, and the future wake reason must be visible in task describe rather
  than hidden in overlay-local state.

No explorer reported a conflicting requirement. The only plan correction was
to remove the earlier "non-task wait fails" idea and schedule non-task waits
through the same `cron_job` table to eliminate the old blocking semantic
globally.
