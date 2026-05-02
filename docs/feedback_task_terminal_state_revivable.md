# Task Message Continuation Is State-Independent

Date: 2026-05-02

User correction: cancelled, completed, failed, and any other task lifecycle label
must still accept follow-up messages. The label is only a dispatch/display hint,
not a message reachability gate.

## Root Cause

The message path treated terminal task facts as control states:

- `handleTaskMessage` rejected failed/cancelled tasks before persisting the user
  message.
- `injectMessage` required an active run before appending the message.
- `EngineRuntime.createOperatorRun` rejected completed/cancelled tasks.

That made conversation continuation depend on lifecycle labels instead of the
actual event: a new user message.

## Correct Contract

User messages are real conversation events. On any task row, the system must:

1. Persist the user message into the existing task session.
2. Keep decision logs, goals, runs, worktrees, and artifacts intact.
3. Clear only the completion facts that prevent the task from being dispatched.
4. Dispatch the same task loop with the operator message event.

No code path may require manual retry before accepting a follow-up message.
