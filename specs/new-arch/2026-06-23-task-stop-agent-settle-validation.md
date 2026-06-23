# Task Stop Agent Settle Validation

Date: 2026-06-23

## Problem

Clicking task stop can report success after `SessionPrompt.cancel` writes
`SessionStatus` terminal, while the owning prompt loop is still unwinding and
the prompt state remains live. That is a validation bug: terminal status is a
User Interface (UI) projection, not proof that every owned agent stopped.

## Recall

| Source                                                 | Relevant decision                                                                                                                                          |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-19-task-mission-agent-cancellation-scope.md`  | Stop success must mean all owned Large Language Model (LLM) loops, executor runs, queued prompts, tool calls, and processes are interrupted or terminated. |
| `2026-06-20-task-actions-cancel-button-owner.md`       | The overlay must keep one stop route and must not invent a second User Interface (UI)-only cancel path.                                                    |
| `2026-06-21-operator-message-live-goal-abort-audit.md` | Generic wake and explicit cancellation must remain separate; only explicit target-scoped cancellation may abort live ownership.                            |
| `session/prompt/state.ts`                              | `cancel()` intentionally keeps the busy slot until `finish()` observes the same abort signal.                                                              |

## Call-Point Sweep

Command used before implementation:

```powershell
rg -n "cancelTask\\(|cancelAgentSession|abortMission|cancelMissionScope|cancelTaskScope|cancelSessionScope|TaskCancellationScope|TaskCancellationIncomplete|SessionPrompt\\.cancel|abortChildExecutionForSession|abortGoalRunExecution|abortLiveExecutionForTask|abortLiveOrchestratorToolOwnership|terminateTaskOwnedSessionsAndFail|interruptTaskLoop|abortTaskPipeline" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test
```

| Call point                      | Decision                                                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `EngineService.cancelTask`      | Keep as the task stop Application Programming Interface (API), but after sending cancel to the whole session tree, verify prompt state settlement before marking the task cancelled. |
| `abortChildExecutionForSession` | Cancel the target session subtree, not only the selected session.                                                                                                                    |
| `SessionPrompt.cancel`          | Keep it as a signal sender; do not make every caller wait implicitly.                                                                                                                |
| `cancellation-scope.ts`         | Own subtree cancellation and settle verification as the stop-path single source.                                                                                                     |
| Route and overlay services      | Keep existing route names; success continues to mean backend stop success.                                                                                                           |

## Acceptance

- Task stop sends cancel to every session in the task-owned session tree before
  awaiting any one of them.
- Child agent stop sends cancel to the selected session and all descendants.
- Stop success waits until each cancelled prompt state is gone; `SessionStatus`
  terminal alone is not sufficient evidence.
- A live session with no directory-matched prompt state still returns typed
  `TaskCancellationIncompleteError`.
- Tests prove descendant sessions are cancelled and that a prompt state left
  live after terminal status causes incomplete cancellation instead of success.
