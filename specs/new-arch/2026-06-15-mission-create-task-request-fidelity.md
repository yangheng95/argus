# Mission create_task request fidelity — 2026-06-15

## Requirement

- Mission-created engine tasks must receive Mission's complete `panel.create_task.request`, including the verbatim `Original user input` section and Mission's execution brief.
- The tool execution layer must not replace that request with ambient `ctx.extra.originalText`; `params.request` is the single task-request source.
- Control-plane task creation must still carry user text by making the control prompt require the model to write the verbatim user message into `create_task.request`.
- Streaming tool-call raw JSON is diagnostic only. It may be shown while a tool call is pending, but it must not be treated as the canonical task request.

## Call-point inventory

| Surface                    | File                                                   | Decision                                                                                                                    |
| -------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | --- | -------------------------------------------------------------------------------------- |
| Mission dispatch prompt    | `packages/opencorvus/src/prompt/core/mission-core.txt` | Already requires `Original user input` verbatim in `create_task.request`; keep it as the Mission-side contract.             |
| Panel tool execution       | `packages/opencorvus/src/tool/panel.ts`                | Replace `originalText                                                                                                       |     | params.request`with`params.request`; text attachments append after that single source. |
| Control-plane prompt       | `packages/opencorvus/src/control/message.ts`           | Add an explicit requirement that `create_task.request` carries the user's task text verbatim plus needed execution details. |
| Mission wake route         | `packages/opencorvus/src/server/routes/mission.ts`     | No change; it injects the operator prompt as the Mission user message.                                                      |
| Task creation API          | `packages/opencorvus/src/task-api/index.ts`            | No change; receives `request` from `panel.create_task` and persists it.                                                     |
| Tool raw stream projection | `packages/overlay/src/services/tree-writer.ts`         | No request-source change; existing deltas only update UI raw display.                                                       |
| Tool body rendering        | `packages/overlay/src/components/InlineToolPart.tsx`   | No canonical request change; raw input body remains a pending diagnostic.                                                   |

## Tests

- `packages/opencorvus/test/panel/actor-provenance.test.ts`: assert `panel.create_task` uses explicit `params.request` even when `ctx.extra.originalText` exists.
- Existing Mission prompt tests continue to assert the verbatim original-input contract.
