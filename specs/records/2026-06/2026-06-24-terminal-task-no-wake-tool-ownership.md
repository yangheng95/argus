# Terminal Task No-Wake And Task Tool Ownership

Date: 2026-06-24

## Objective

Restore one task lifecycle invariant. Correction from 2026-06-25: the invariant
is about self-wake suppression, not about refusing explicit operator wakes.

- task-level tools are owned by the Orchestrator scheduler only;
- completed, failed, and cancelled tasks are terminal for passive/internal
  self-wakes and same-turn tool-result continuations;
- ordinary operator messages, API injection, retry, and replan are explicit
  external wake requests and may reopen a terminal task through the directory
  queue;
- scheduler activity is legal only while the task is active. Queued tasks become
  active through the directory queue before the scheduler acts.

## Recall

- `2026-06-21-dispatch-algorithm-agent-audit.md` SCHED-009 already drew the
  correct boundary: passive self-wakes are suppressed, but structured operator
  events (`operatorMessage` / `operatorIntent`) still pass through.
- `2026-06-09-operator-message-add-goal-dispatch.md` and the later
  BH-033 repair changed completed follow-up messages into requeue/wake events;
  that part is correct for external operator intent, but must still flow through
  the queue before the scheduler acts.
- `orchestrator/tools.ts` owns the task-level private tool implementations.
  `agent/tool-pool-contract.ts` must expose those tools only through the
  Orchestrator role.

## Call-Point Sweep

Command basis:

```powershell
rg -n "handleTaskMessage|appendAndWakeTaskOperatorMessage|recordOperatorNote|injectMessage|dispatchTaskLoop|cancel_task|retry_task|inject_operator_message|fail_task|build: tool|integrity: tool" packages/opencorvus/src packages/opencorvus/test -S
```

| Surface                                       | Decision                                                                                                                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AgentToolPool.ORCHESTRATOR_PRIVATE_TOOL_IDS` | Keep task-level lifecycle tools in the Orchestrator private list only.                                                                                                            |
| `createOrchestratorTools()`                   | Add a terminal-task tool execution guard so same-turn continuations after success/failure/cancel cannot mutate terminal tasks.                                                    |
| `dispatchTaskLoop()` / `runTaskLoop()`        | Ignore passive terminal wakes. Accept structured operator wake events by reopening the terminal task to `queued`, then let the directory queue activate it.                       |
| `appendAndWakeTaskOperatorMessage()`          | Append visible operator messages, reopen terminal tasks to `queued`, and dispatch through the queue.                                                                              |
| `recordOperatorNote()`                        | Record the note, reopen terminal tasks to `queued`, and dispatch through the queue.                                                                                               |
| `injectMessage()`                             | Reuse the same append/operator-wake behavior; terminal tasks can be woken by explicit injection.                                                                                  |
| `orchestrator-core.txt`                       | Teach the scheduler that task lifecycle/control tools are scheduler-owned, terminal self-wakes are suppressed, and external operator wakes restart only through queue activation. |

## Acceptance

- `/task/:taskID/message` against completed, failed, or cancelled tasks appends
  the user message, clears terminal facts through the explicit operator-wake
  path, and calls `dispatchTaskLoop`.
- `/task/:taskID/inject` against terminal tasks reuses the same explicit
  operator-wake path.
- `recordOperatorNote()` against terminal tasks records the note, clears
  terminal facts through the explicit operator-wake path, and calls
  `dispatchTaskLoop`.
- Passive direct `dispatchTaskLoop()` against terminal tasks returns `ignored`.
- Direct `dispatchTaskLoop()` against terminal tasks with `operatorMessage` or
  `operatorIntent` reopens the task to `queued` and dispatches through the
  directory queue.
- A same-turn Orchestrator continuation after `integrity`, `fail_task`, or
  `cancel_task` cannot call another task-mutating tool to reactivate or change
  the terminal task.
- Prompt and tool-pool tests document that task-level lifecycle tools belong to
  the Orchestrator scheduler, not worker agents.
