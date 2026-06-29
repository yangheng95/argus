# Task Create Explicit Model - 2026-06-12

## Request

- Change the documented/default model declaration to `openai/gpt-5.5`.
- Support specifying an OpenCorvus model when publishing/creating a task.

## Existing Constraints Recalled

- `specs/records/2026-06/2026-06-09-task-agent-model-context.md`: task operator model resolution is backend-owned through `messageContext()` and `resolveAgentModelRef`; overlay must not guess.
- `specs/records/2026-06/2026-06-10-task-config-overrides-immediate-effect.md`: runtime task config is live project config plus task-root `configOverlay`; task snapshots are audit metadata only.
- `packages/opencorvus/src/agent/model.ts`: single resolver precedence is explicit model, task/session root overlay, then project base. No history/default fallback.
- `packages/opencorvus/src/config/config.ts`: `DEFAULT_MODEL` is not runtime fallback. It is used for schema/example text after the first-load auto-write behavior was removed.

## Callsite Census

| Surface                                                                                         | Decision                                                                                                                                                |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/engine/model.ts::CreateTaskInput`                                      | Add optional `model` in provider/model format.                                                                                                          |
| `packages/opencorvus/src/task-api/index.ts::createTaskInner`                                    | After root session creation, merge `{ model }` into the task-root session overlay when provided. Do not write metadata or config files.                 |
| `packages/opencorvus/src/server/routes/orchestrator.ts POST /task`                              | Reuse `CreateTaskInput`; no parallel schema.                                                                                                            |
| `packages/overlay/src/services/task.ts::CreateTaskOptions/createTask`                           | Accept and forward optional `model`.                                                                                                                    |
| `packages/opencorvus/src/panel/capability.ts` and `tool/panel.ts`                               | Let `panel.create_task` accept and forward `model`.                                                                                                     |
| `packages/opencorvus/src/control/message-schema.ts`, `control/message.ts`, `channel/ingress.ts` | Preserve explicit model through channel/control-plane task creation.                                                                                    |
| `packages/opencorvus/src/orchestrator/tools.ts::propose_task`                                   | Leave unchanged. Follow-up tasks only get a model overlay when a caller explicitly supplies `model`; otherwise they keep live project config semantics. |
| Docs/generated SDK                                                                              | `docs:api` regeneration must update OpenAPI and JS SDK types.                                                                                           |

## Acceptance

- Creating a task with `model: "openai/gpt-5.5"` stores the value only in the task root session `configOverlay`.
- `resolveConfiguredModelRef({ taskID })` returns the explicit task model even when project config has another model.
- Creating a task without `model` does not write a model overlay and continues to use project config through the existing resolver.
- Overlay `createTask({ model })` sends `model` in the POST body.
- Config schema/example default text uses `openai/gpt-5.5`; no runtime fallback is introduced.
