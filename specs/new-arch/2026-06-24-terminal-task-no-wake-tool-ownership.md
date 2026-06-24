# Terminal Task No-Wake And Task Tool Ownership

Date: 2026-06-24

## Objective

Restore one task lifecycle invariant:

- task-level tools are owned by the Orchestrator scheduler only;
- completed, failed, and cancelled tasks are terminal and must not be woken by
  ordinary operator messages, API injection, queued wakes, or same-turn tool
  continuations;
- scheduler activity is legal only while the task is active. Queued tasks become
  active through the directory queue before the scheduler acts.

## Recall

- `2026-06-05-terminal-task-wake-p0.md` already stated the correct terminal
  invariant: terminal task messages append visible conversation records but do
  not wake or reactivate the task.
- `2026-06-09-operator-message-add-goal-dispatch.md` and the later
  BH-033 repair changed completed follow-up messages into requeue/wake events.
  That created a second lifecycle meaning for completed tasks and conflicts with
  the current requirement.
- `orchestrator/tools.ts` owns the task-level private tool implementations.
  `agent/tool-pool-contract.ts` must expose those tools only through the
  Orchestrator role.

## Call-Point Sweep

Command basis:

```powershell
rg -n "handleTaskMessage|appendAndWakeTaskOperatorMessage|recordOperatorNote|injectMessage|dispatchTaskLoop|cancel_task|retry_task|inject_operator_message|fail_task|build: tool|integrity: tool" packages/opencorvus/src packages/opencorvus/test -S
```

| Surface | Decision |
| --- | --- |
| `AgentToolPool.ORCHESTRATOR_PRIVATE_TOOL_IDS` | Keep task-level lifecycle tools in the Orchestrator private list only. |
| `createOrchestratorTools()` | Add a terminal-task tool execution guard so same-turn continuations after success/failure/cancel cannot mutate terminal tasks. |
| `dispatchTaskLoop()` / `runTaskLoop()` | Ignore terminal tasks before queue/active dispatch handling or orchestrator processing. |
| `appendAndWakeTaskOperatorMessage()` | Append visible operator messages on terminal tasks, but return `resumed=false` and do not reactivate or dispatch. |
| `recordOperatorNote()` | Record the note on terminal tasks, but return `resumed=false` and do not dispatch. |
| `injectMessage()` | Reuse the same append/no-wake behavior; terminal tasks return `orchestratorWoken=false`. |
| `orchestrator-core.txt` | Teach the scheduler that task lifecycle/control tools are scheduler-owned and terminal statuses never restart from text. |

## Acceptance

- `/task/:taskID/message` against completed, failed, or cancelled tasks appends
  the user message, preserves terminal facts, returns `should_resume=false`, and
  does not call `dispatchTaskLoop`.
- `/task/:taskID/inject` against terminal tasks appends the user message,
  preserves terminal facts, returns `orchestratorWoken=false`, and does not call
  `dispatchTaskLoop`.
- `recordOperatorNote()` against terminal tasks records the note, preserves
  terminal facts, returns `resumed=false`, and does not call `dispatchTaskLoop`.
- Direct `dispatchTaskLoop()` against terminal tasks returns `ignored`.
- A same-turn Orchestrator continuation after `integrity`, `fail_task`, or
  `cancel_task` cannot call another task-mutating tool to reactivate or change
  the terminal task.
- Prompt and tool-pool tests document that task-level lifecycle tools belong to
  the Orchestrator scheduler, not worker agents.
