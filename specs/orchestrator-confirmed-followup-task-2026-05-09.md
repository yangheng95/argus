# Orchestrator Confirmed Follow-up Task

## Context

The orchestrator must not regain the control-plane `panel` tool. `panel` remains a gateway capability boundary. The generic `task` tool also remains invalid for orchestrator scheduling because it dispatches subagents, not engine tasks.

The product need is narrower: while executing a task, the orchestrator may identify a better follow-up request that completes or improves the previous request. That follow-up must be offered to the user as a new task option, and a new engine task is created only after explicit user confirmation.

## Design

- Add an orchestrator-local tool named `propose_task`.
- The tool accepts a polished candidate task title, request, priority, kind, and rationale.
- The tool asks one confirmation question with two fixed options: `创建任务` and `不创建`.
- If the user chooses `创建任务`, the tool calls `EngineService.createTask`.
- If the user dismisses or chooses `不创建`, the tool creates nothing.
- The created task stores metadata linking it to the source task:
  - `origin: "orchestrator_proposed_task"`
  - `parent_task_id`
  - `proposal_reason`
- The created task uses a deterministic `requestID` derived from parent task id, title, and request so repeated confirmation does not duplicate the task.

## Non-goals

- Do not restore `panel` to orchestrator tools.
- Do not expose the generic `task` subagent tool to the orchestrator.
- Do not create tasks silently without user confirmation.
- Do not turn this into a common stage in the normal workflow; it is for follow-up task candidates only.

## Acceptance

- Orchestrator available tools include `propose_task`.
- Orchestrator available tools still exclude `panel` and generic `task`.
- `propose_task` blocks on a user confirmation question before task creation.
- Confirmation creates exactly one engine task with parent metadata.
- Decline/dismiss creates no engine task.
