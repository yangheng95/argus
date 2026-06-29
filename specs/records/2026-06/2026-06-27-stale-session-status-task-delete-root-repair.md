# Stale Session Status Task Delete Root Repair - 2026-06-27

## Glossary

- DB means Database.
- API means Application Programming Interface.
- WAL means Write-Ahead Log.
- LLM means Large Language Model.

## Incident Evidence

- Runtime DB path inspected read-only: `C:\Users\chuan\.local\share\opencorvus\opencorvus.db`.
- The DB had two `engine_task` rows, both for
  `C:\Users\chuan\myhexin-local\demos\economy\world-economy`.
- Both rows were derived `active`: `time_started IS NOT NULL` and
  `time_completed IS NULL`.
- Both rows had `engine_task.error` set to
  `Orchestrator error: ENOENT: no such file or directory, scandir
  '...\world-economy\ainvest'`.
- Both rows had no `engine_artifact.kind="run"` and no
  `engine_artifact.kind="goal_run_attempt"` rows. They only had
  `orchestrator-stream-error` artifacts.
- `DELETE /task/tsk_f0763e442001x0P85bK1Aadvt4` returned 409. Server log:
  `TaskCancellationIncompleteError: Cancellation did not complete for
  SessionPrompt.cancel: ... no live prompt state matched session directory`.
- The task's orchestrator session had a latest `session.status` event of
  `streaming`, but there was no corresponding in-process prompt state.

## Call-Site Audit

Commands:

```powershell
rg -n "SessionPrompt.cancel|no live prompt state matched session directory|assertSessionPromptSubtreeFinished|requestTaskAgentLifecycleCancellation|SessionStatus.set|SessionPromptState.finish" packages/opencorvus/src packages/opencorvus/test -S
rg -n "deleteTask\(|deleteSession\(|awaitTaskLoopIdle\(|orchestrator-stream-error|streaming|terminal" packages/opencorvus/src packages/opencorvus/test specs/new-arch -S
```

Relevant surfaces:

| Surface | Current behavior | Repair decision |
| --- | --- | --- |
| `session/loop.ts` prompt loop catch | Rejects waiting callers and calls `SessionPromptState.finish()`, but leaves `SessionStatus` at `streaming` for non-abort exceptions. | Mark the session `terminal/error` before finishing prompt state when the loop exits by exception. Abort paths remain `terminal/aborted` through the existing cancellation writer. |
| `session/prompt/state.ts` | Can check prompt state only by directory-specific cancel/isActive. | Expose a read-only `isActiveInAnyDirectory(sessionID)` so cancellation can distinguish stale status from a real directory mismatch. |
| `engine/cancellation-scope.ts::cancelSessionPromptInScope` | If `SessionPrompt.cancel(sessionID, directory)` returns false while status is `streaming`, throws `TaskCancellationIncompleteError`. This treats stale process status and real live directory mismatch the same. | Keep strict failure for real live prompt state in another directory or live activity gate. If no prompt state exists anywhere and no activity gate exists, seal stale `streaming/retry` status as `terminal/aborted` and continue. |
| `task-api/index.ts::deleteTask` | Cancels active tasks before physical delete; it inherits the stale status false-positive. | No raw DB delete path. Reuse cancellation after stale status convergence, then existing breadcrumb/session/task deletion. |
| Overlay delete button | Calls record-level `DELETE /task/:id` without `directory`. | Keep. This matches the record-level delete design from `2026-06-22-delete-active-task-record-context.md`. |

## Acceptance

- A prompt loop exception leaves the session terminal with reason `error`, not
  indefinitely `streaming`.
- `cancelSessionPromptInScope` still rejects a real prompt state owned under a
  different directory.
- `cancelSessionPromptInScope` can converge a stale `streaming` or `retry`
  status with no prompt state and no activity gate.
- `EngineService.deleteTask()` deletes an active task whose task-owned session
  tree only has stale streaming status and no live prompt state.
- No host path marks `engine_task.time_completed` as failed for orchestrator
  stream errors; explicit scheduler lifecycle ownership from
  `2026-06-26-explicit-terminal-task-lifecycle.md` remains intact.
