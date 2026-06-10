# Cancelled Task Message Rejection

Date: 2026-06-10

## Symptom

After cancelling a task, sending another task-level message can create an empty user message card and other conversation cards, while the task stays `cancelled` and does not resume.

## Evidence

Full-repo call-site grep before implementation:

| Surface | Current owner | Decision |
| --- | --- | --- |
| `EngineService.handleTaskMessage` | `/task/:taskID/message` | Reject cancelled tasks before notes, attachments, or session messages are persisted. |
| `EngineService.injectMessage` | `/task/:taskID/inject` | Reuse the same task-level append path; cancelled tasks must reject before session persistence. |
| `appendAndWakeTaskOperatorMessage` | Shared task-level session message writer | Move cancelled-task rejection before `appendTaskSessionMessage`. |
| `recordOperatorNote` | Operator note/progress snapshot API | Leave unchanged; it is not the chat transcript writer and does not create message cards. |
| `TaskMessageInput` | API payload schema | Keep shape; add semantic validation at the task writer because attachments make plain `text.min(1)` too narrow. |

Root cause: `appendAndWakeTaskOperatorMessage` persisted a root-session user message first, then checked `isTaskCancelled(task)` and returned `resumed:false`. The UI received a successful `/message` response with `user_message`, projected it into the conversation, and then the task remained cancelled because no dispatch happened.

## Design

Cancelled tasks are terminal by explicit operator intent. The only continuation path is explicit `retryTask`; `/message` and `/inject` must not silently mutate the cancelled task transcript.

Empty task-level messages are also rejected before persistence. A user message with no text and no attachments has no displayable content and creates empty cards.

## Tests

- Update cancelled `/task/:taskID/message` route coverage to expect `409 TaskCancelledMessageError`.
- Assert cancelled task session transcript length is unchanged.
- Assert no orchestrator dispatch occurs.
- Add empty `/task/:taskID/message` coverage to expect `400 TaskEmptyMessageError`.
