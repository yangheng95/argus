# Cancelled Task Message Input Fix (2026-06-10)

## Problem

Existing task selection can load a cancelled task and render the main composer disabled. The task debug attachment proves the failing task is `status: cancelled`, with a root session and project directory present.

The implementation had split contracts:

| Surface                   | Evidence                                                            | Old behavior                                                            | Change                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overlay compose predicate | `packages/overlay/src/services/chat.ts::canComposeChat`             | Blocked `selectedTaskStatus() === "cancelled"`                          | Remove the cancelled-only block. Connection and task selection remain the compose availability facts.                                                            |
| Overlay send path         | `packages/overlay/src/services/chat.ts::panelMessage`               | Already sent every status to `/task/:id/message`                        | Keep as the single send path.                                                                                                                                    |
| Backend task message path | `packages/opencorvus/src/task-api/index.ts::handleTaskMessage`      | Threw `TaskCancelledMessageError` before appending the operator message | Reopen cancelled tasks the same way failed tasks are reopened: clear `metadata.cancelled`, clear `error`, queue the task, append the user message, and dispatch. |
| Route tests               | `packages/opencorvus/test/server/task-message-routes.test.ts`       | Pinned cancelled task rejection                                         | Replace with cancelled task continuation assertions.                                                                                                             |
| Overlay predicate test    | `packages/overlay/test/chat-compose-cancelled-task.test.ts`         | Pinned disabled cancelled task compose                                  | Replace with enabled cancelled task compose.                                                                                                                     |
| Browser UI test           | `packages/overlay/test/browser/task-composer-existing-task.test.ts` | Missing                                                                 | Add a real browser focus/type assertion for a selected cancelled task.                                                                                           |

## Acceptance

- Selecting an existing cancelled task does not disable the main message textarea.
- Clicking and typing in the selected task composer focuses the textarea and updates its value.
- Sending to a cancelled task appends the user message, clears the cancelled metadata flag, requeues the task, and dispatches the task loop.
- Empty messages are still rejected before message persistence.
