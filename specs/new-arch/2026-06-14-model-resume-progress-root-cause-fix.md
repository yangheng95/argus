# Model, Resume, and Task Progress Root-Cause Fix - 2026-06-14

## Trigger

Task `tsk_ec0cb576e0015fATkAUK2oYT10` exposed three linked failures:

- task and mission execution could be created without a durable model reference;
- cancelled task continuation could reopen the task but attach the new wake to a cancelled prompt owner;
- build child activity remained internal while the task card looked stuck.

Independent read-only agents confirmed the provider catalog defect separately:
`CUSTOM_LOADERS.opencorvus` exists while the model catalog does not define an
`opencorvus` provider.

## Recalled Constraints

- No implicit runtime model default. `agent/model.ts` resolves explicit model,
  task/session root overlay, then live project config; otherwise it throws.
- `TASK_SNAPSHOT_KEY` is audit-only and is not a runtime config source.
- Cancelled task messages should reopen the task and continue naturally.
- Activity timeouts must be inactivity based, not wall-clock from process start.
- Do not reuse port 7878 for validation; WSL validation uses port 7879.

## Callsite Census

| Surface | Required decision |
| --- | --- |
| `packages/overlay/src/services/task.ts::panelRequestBody` | Include the selected explicit OpenCorvus model when sending control panel messages that can create tasks. |
| `packages/opencorvus/src/control/message.ts` | Resolve the control-plane model from `ControlMessageInput.model` before project config. |
| `packages/opencorvus/src/server/routes/mission.ts` | Accept and pass explicit model to `SessionWake.wake` for mission wake. |
| `packages/opencorvus/src/orchestrator/tools.ts::propose_task` | Child task creation must inherit the current task resolved model when no explicit child model is provided. |
| `packages/opencorvus/src/task-api/index.ts::createTaskInner` | If no explicit model is provided, validate that the effective project config can resolve a model before persisting a task. |
| `packages/opencorvus/src/provider/models.ts` | Define `opencorvus` in the single local catalog source or delete all related provider logic. This repair keeps the provider and registers it in the catalog. |
| `packages/opencorvus/src/orchestrator/agent.ts::orchestratorSessionForTask` | Do not reuse terminal/cancelled orchestrator child sessions as the execution owner for a new wake. |
| `packages/opencorvus/src/session/prompt/state.ts` / `session/loop.ts` | A prompt call arriving while an old slot is cancelling must not be rejected by the old slot's final `session prompt loop finished`. |
| `packages/opencorvus/src/orchestrator/task-event.ts` and overlay event consumers | Persist and expose task-scoped child activity/progress rather than relying only on live-only watermark events. |

## Acceptance

- Creating or waking task/mission flows with explicit model preserves that model through control, mission, and child task creation.
- Creating a task with neither explicit model nor resolvable config fails before task persistence with `MissingModelConfigError`.
- `opencorvus/...` models resolve from the provider catalog, and provider state no longer logs a missing `opencorvus` catalog entry.
- Cancel followed by an operator message starts a valid new orchestrator execution owner and does not produce `session prompt loop finished`.
- Task progress surfaces child session/tool activity in a task-scoped durable source.
- Targeted tests cover each behavior before WSL sync.
