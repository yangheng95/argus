# Task Agent Model Context

## Problem

The composer model chip shows and writes the top-level `model`, while task follow-up messages are resolved by the backend through `messageContext()`:

1. session-owned agent from `SessionAgentIdentity.ownedAgentForSessionKind(session.kind)`
2. latest session message agent
3. configured default agent
4. `resolveAgentModelRef(agent, { taskID })`

That resolver checks `agent.<name>.model` before top-level `model`. Therefore a configured Agent Models override can shadow the composer chip write, and the chip can display a model different from the one the task will actually use.

## Call Points

| Surface                                                         | Current behavior                                                                | Change                                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/task-api/index.ts::messageContext`     | Private single source for task operator `{agent, model}`                        | Reuse it through a new `getTaskOperatorModelContext()` service API                    |
| `packages/opencorvus/src/server/routes/orchestrator.ts`         | Exposes task board/message routes but not effective task operator model context | Add `GET /task/:taskID/operator-model-context`                                        |
| `packages/opencorvus/src/engine/model.ts`                       | Owns API schemas                                                                | Add `TaskOperatorModelContext` schema                                                 |
| `packages/overlay/src/components/ExecutorSelector.tsx`          | Reads/writes `config.model` or session overlay `model`                          | Read backend task operator context; write `agent.<agent>.model` in task session scope |
| `packages/overlay/src/components/settings/AgentModelsPanel.tsx` | Already writes `agent.<name>.model`                                             | Keep as source-compatible peer of composer model picker                               |
| `packages/overlay/test/executor-selector-redesign.test.ts`      | Covers project model display only                                               | Add task A/task B isolation and agent override write regression                       |

## Acceptance

- A selected task's composer chip displays the same effective model that `appendTaskSessionMessage()` will persist.
- Selecting a model in a selected task writes only that task root session overlay under `agent.<context.agent>.model`.
- Switching between two tasks in the same project shows their independent session-scoped models.
- No fallback from selected task to project config when the task root session context cannot be resolved.
