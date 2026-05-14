# Task Inject Root Session Poisoning

## Symptom

Appending `继续完成G3` to task `tsk_e25f7ccce001axv5eALmdXaswP` left the task active but unusable:

- `/task/:taskID/progress` reports `Orchestrator error: agent report summary is empty`.
- `/task/:taskID/conversation` fails because assistant output was written to the root session.
- The active G3 goal-run remains running, but no new activity is written to its build child session.

## Root Cause

`EngineService.injectMessage` calls `injectRunningTaskMessage`, which resumes the active run executor with `run.session_id`.

For workflow runs, `run.session_id` is the task root session. Resuming `opencorvus` against that id starts a build agent turn in the root session, violating the invariant that root sessions only hold user-authored task messages.

This also misses the actual goal child session, so the user input neither safely steers G3 nor stays visible to the orchestrator as the single task entry agent.

## Design

Task-level user input has one owner: the orchestrator wake path.

- `/task/:taskID/message` and `/task/:taskID/inject` both persist a root user message.
- Both routes call `openTaskForOperatorMessage` and `dispatchTaskLoop` with `OrchestratorEventNote.operatorMessage`.
- Task-level inject must not call `ExecutorRegistry.require(...).resume(...)`.
- Scoped agent steering remains the responsibility of `/task/:taskID/session/:sessionID/reply`, which targets a non-root child session explicitly.

This keeps the root session invariant, preserves conversation history, and avoids a second hidden input path.

## Acceptance

- A running task with an active run no longer causes executor `resume` when `/task/:taskID/inject` is called.
- The appended user message is persisted on the root session.
- No assistant message is written to the root session by task-level inject.
- The orchestrator scheduler is interrupted with the operator message.
