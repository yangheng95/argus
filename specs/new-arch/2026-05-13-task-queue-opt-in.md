# Task Queue Opt-In

> Superseded by `2026-05-14-directory-queue-hard-gate.md` for same-directory
> concurrency. Omitted `queue` / `queue:false` now means immediate eligibility:
> the task starts only when its directory has no active task. It must not bypass
> an active same-directory task.

## Requirement

- New task creation defaults to no queue: omitted `queue` is `false`.
- A newly created task enters the directory-scoped serial queue only when creation input sets `queue: true`.
- A newly created task starts immediately when creation input omits `queue` or sets `queue: false`, even if another task is active in the same directory.
- User-originated panel task creation may ask the user whether to queue, but the default selected behavior is immediate start.
- LLM-created follow-up tasks may include or omit the `queue` property. Omission means immediate start.
- Existing retry and operator-message behavior remains unchanged: retry is a deliberate requeue of the same task; operator messages reopen and interrupt the existing task.

## Acceptance

- Calling `EngineService.createTask` without `queue` starts immediately.
- Panel `create_task` with omitted `queue` asks the user to choose immediate start or queue; the default selection is immediate start.
- Creating a task while another task is active in the same directory starts the new task immediately when `queue` is omitted or `queue: false`.
- Creating a task with `queue: true` while another task is active in the same directory leaves the new task queued until the active task exits.
- Panel `create_task`, gateway `enqueue_task`, and orchestrator `propose_task` expose the optional `queue` creation property.
- The queue reordering endpoint still applies only to tasks that are actually queued.
