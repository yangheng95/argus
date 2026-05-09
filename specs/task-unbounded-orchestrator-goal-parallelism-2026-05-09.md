# Task Runtime Unbounded By Budget And Status - 2026-05-09

## Trigger

The operator asked to delete every run-budget parameter except goal parallelism, set goal parallelism default to 3, and stop using task lifecycle status as a scheduling rule. Task status may remain as a displayed fact, but no rule may depend on "active / failed / cancelled / completed" to decide whether a user can append more work to the same task.

## Decisions

1. `assistant.max_executor_groups` is the only retained task runtime knob.
2. `assistant.max_executor_groups` defaults to `3`.
3. `assistant.max_runs` is deleted from config schema, effective config, overlay controls, task budget input, task descriptions, and docs touched by this change.
4. `assistant.max_fix_runs` is deleted from config schema, effective config, overlay controls, task budget input, task descriptions, and delivery rework logic.
5. Delivery repeated-failure and task-scope rejection facts remain visible to the orchestrator through decision log / tool result text, but code must not force plan restart or terminal failure from those facts.
6. Task lifecycle state remains a projection for UI and audit. It must not block appending a user message, and a user message must wake the orchestrator for the same task regardless of the projected status.
7. Stop criteria belong in the orchestrator prompt: finish only through accepted delivery, or stop/escalate when the prompt judges that repeated attempts cannot improve the outcome.

## Implementation Targets

- Backend config:
  - Remove `max_runs` and `max_fix_runs` from `Config.Info["assistant"]`.
  - Remove `max_runs` and `max_fix_runs` from `EngineConfigType` and defaults.
  - Keep only `max_executor_groups`, default `3`.
- Task budget API:
  - `Budget` accepts only `maxExecutorGroups`.
  - `EngineBudget` stores only `max_executor_groups`.
  - `budgetRow`, `budgetModel`, and task creation/update paths stop reading or writing run/fix budgets.
- Describe / prompt:
  - Replace `Budget: runs/max runs, fixes/max fixes...` with facts that do not imply a hard cap: recorded run count, delivery iterations, and goal parallelism.
  - Orchestrator core prompt states that there is no numeric run/fix cap; repeated non-improving loops are judged from evidence and must trigger strategy change, question, or fail_task.
- Delivery tool:
  - Remove the `max_fix_runs` gate.
  - Remove code-forced plan restarts for repeated delivery signatures and task-scope rejection.
  - Preserve the signals as decision-log entries and tool-result fields.
- Overlay:
  - Run menu exposes only "Goal parallelism".
  - Delete max-run i18n keys and tests that assert max-run display.
- Task message lifecycle:
  - Appending an operator message must not clear `time_completed`, `error`, or `metadata.cancelled` just to make the task look active.
  - Dispatch with an operator event must invoke the orchestrator for the same task even when the projected status is completed, failed, or cancelled.

## Acceptance

- `rg "max_runs|max_fix_runs|maxRuns|maxFixRuns|maxReplans|maxEvaluations" packages/opencorvus/src packages/overlay/src` has no hits, except unrelated non-runtime token budget terminology.
- `rg "delivery_budget_exhausted|max_fix_runs" packages/opencorvus/src packages/opencorvus/test` has no hits.
- A terminal task receiving `/task/:taskID/message` records the user message, preserves terminal fact fields, and dispatches the orchestrator with the operator message event.
- `assistant.max_executor_groups` defaults to `3` and still gates `BuildSemaphore.acquire()`.
- Focused backend and overlay tests pass.
