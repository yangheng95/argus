# Shutdown Interrupted Task Semantics - 2026-06-22

## Problem

Task `tsk_eeec2f883001yaehi4rF9Sg0oZ` was reported as failed after its active
run was aborted with `Server shutdown: SIGINT`. The run row was `aborted`, goal
#2 had no build failure report, but the board projected the terminal task as
`Current attempt failed acceptance` and marked the goal-scope build step failed.

## Recall

| Source                                                                     | Constraint                                                                                                                             |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `specs/task-execution-terminalization-2026-06-16.md`                       | Shutdown must terminate process-owned live task/session/goal state so restarted servers do not show zombie active tasks.               |
| `specs/event-log-task-project-directory-2026-06-16.md`                     | Shutdown/event-log code must resolve task project context from task/project rows, not ambient `Instance`.                              |
| `specs/new-arch/2026-06-22-delete-active-task-record-context.md`           | Process-lifecycle terminalization is distinct from user cancellation and may mark task-owned sessions aborted while the process exits. |
| `specs/new-arch/2026-06-21-world-economy-stuck-adversarial-goal-review.md` | Runtime must not hide failures with automatic resume/retry. Recovery must remain explicit operator action.                             |

## Call Point Inventory

| Surface                | Evidence                                                                                                                               | Decision                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Shutdown entry         | `packages/opencorvus/src/cli/cmd/serve.ts` calls `abortCurrentProcessLiveExecution({ reason: "Server shutdown: <trigger>" })`.         | Keep process-owned shutdown convergence.                                                          |
| Task terminalization   | `packages/opencorvus/src/engine/writer.ts::terminateTaskOwnedSessionsAndFail` marks active tasks as failed after session/tool cleanup. | Preserve terminal fact, but stamp `metadata.interrupted=true` for process lifecycle interruption. |
| Task status projection | `packages/opencorvus/src/engine/task-status.ts` derives only `queued/active/completed/failed/cancelled`.                               | Do not introduce a sixth `status`; add a separate terminal-reason projection.                     |
| Board overview         | `packages/opencorvus/src/workbench/board.ts` maps any failed task to `Current attempt failed acceptance`.                              | Render interrupted tasks as interrupted, with retry-oriented next step.                           |
| Goal-scope workflow    | `deriveGoalScopeStatusFromProjection` treats terminal failed task as failed even when the goal run was only interrupted.               | Exclude interrupted terminal tasks from acceptance/build failure projection.                      |
| Debug clipboard        | `packages/overlay/src/utils/debug-info.ts` prints only `task.status`.                                                                  | Include `task.terminalReason` so diagnostics can distinguish failed vs interrupted.               |

## Acceptance

- A shutdown-interrupted active task still terminalizes sessions/tool parts and
  does not remain zombie active.
- The task board exposes `terminalReason="interrupted"`.
- The board overview says the task was interrupted, not acceptance failed.
- Goal-scope build steps are not marked failed solely because shutdown
  interrupted a live build.
- Normal failed tasks still render as failed acceptance.
- No retry/fallback loop is added; retry remains an explicit operator control.
