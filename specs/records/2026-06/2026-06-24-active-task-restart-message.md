# Active Task Restart Message - 2026-06-24

> Superseded on 2026-06-27 by
> `specs/records/2026-06/2026-06-26-enterprise-a2a-protocol-root-repair.md`.
> The visible restart operator-message behavior in this note is retired:
> restart/orphan recovery is now a durable `task.lifecycle` protocol fact plus
> a structured internal lifecycle wake, not a synthetic user/operator message.

## Requirement

When an OpenCorvus project instance restarts and durable task facts still
project a task as executing (`active`), the host must append a visible task
operator message whose text is `请继续执行剩余任务` and wake the orchestrator
through the existing task message path.

## Recall

| Source                                                         | Constraint                                                                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `specs/records/2026-06/task-queue-explicit-wake-no-poll-2026-06-17.md`         | Do not restore the A2A task-flow poller; queue work advances only from explicit enqueue/completion/message events.        |
| `specs/records/2026-06/operator-wake-status-facts-not-scheduler-2026-06-17.md` | Startup must not terminalize active tasks; status facts are context, and real operator messages are the wake boundary.    |
| `specs/records/2026-06/operator-wake-open-tool-facts-2026-06-17.md`            | Do not mutate lifecycle for run-less open tools; expose facts and let the next orchestrator wake decide.                  |
| `specs/records/2026-06/2026-06-21-dispatch-algorithm-agent-audit.md`  | Durable queued operator wakes drain through `engine/queue.ts`; cwd serialization remains the single queue admission path. |

## Call-Point Sweep

Command:

```powershell
rg -n "EngineService\.init\(|appendAndWakeTaskOperatorMessage\(|dispatchTaskLoop\(|drainPendingQueuedOperatorWakes|listOrphanedActiveInProject|deriveTaskStatus|taskStatusCondition|Instance\.state\(" packages/opencorvus/src packages/opencorvus/test specs -g "*.ts" -g "*.md"
```

| Surface            | Evidence                                                                                                                                                                 | Decision                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Startup hook       | `project/bootstrap.ts` calls `EngineService.init()` during `InstanceBootstrap()`.                                                                                        | Keep this as the project-instance startup boundary.                                                                          |
| Liveness scheduler | `EngineService.init()` registers `engine.liveness`; `Scheduler.register()` immediately runs once and then ticks.                                                         | Reuse the existing startup tick, guarded by per-instance state, instead of adding a second scheduler.                        |
| Task status        | `engine/task-status.ts` derives `active` from `time_started != null && time_completed == null`; no status column exists.                                                 | Identify executing tasks through existing derived facts only.                                                                |
| Active task query  | `engine/queue.ts::listOrphanedActiveInProject()` returns active tasks without a current in-process loop.                                                                 | Use this to target restart leftovers; current-process active loops are excluded.                                             |
| Message/wake path  | `task-api/index.ts::appendAndWakeTaskOperatorMessage()` appends a root-session user message, emits `TaskMessageRecorded`, clears rewind, and calls `dispatchTaskLoop()`. | Reuse it so restart recovery is a visible natural task message, not a hidden wake or fallback path.                          |
| Queued wake drain  | `engine/queue.ts::drainPendingQueuedOperatorWakes()` drains durable operator wakes through the canonical queue path.                                                     | Run restart messages before pending-wake drain in the first liveness pass; both still converge through `dispatchTaskLoop()`. |

## Implementation

1. Add a per-instance startup state in `task-api/index.ts` with
   `restartMessagesChecked`.
2. On the first `engine.liveness` run for an instance, list active tasks without
   a current loop via `listOrphanedActiveInProject(Instance.project.id)`.
3. For each task, call `appendAndWakeTaskOperatorMessage({
taskID,
text: "请继续执行剩余任务",
source: "server_restart",
})`.
4. Do not alter task/run/goal status directly and do not add a new scheduler,
   status gate, hidden message, fallback retry path, or compatibility branch.

## Acceptance

- Restart startup appends exactly one visible root-session user message
  `请继续执行剩余任务` for each active task without an in-process loop.
- The message carries operator-message source `server_restart`.
- The existing dispatch path receives an `operatorMessage` event with the same
  text/message id.
- Repeated liveness ticks in the same instance do not append duplicate restart
  messages.
- Tasks already driven by a current-process loop are not duplicated by the
  restart scan.
- Existing queued operator wake drain behavior still passes.
