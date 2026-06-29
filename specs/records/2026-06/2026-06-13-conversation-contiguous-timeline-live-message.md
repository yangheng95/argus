# Conversation Contiguous Timeline And Live User Message

Date: 2026-06-13

## Problem

User-authored messages in session and workflow conversations can be visually
pulled to the top of the conversation instead of staying at the point where
they were sent. The same symptom affects assistant turns because the overlay
regroups all messages from the same `sessionID + stage` into one global card.

Session-backed surfaces such as Mission and Coding Assistant also do not show
the sent user message immediately. The async prompt route queues work but
returns only a queue task id, so the frontend has no durable message id to
project until the queue runs or a later hydrate happens.

## Grep Evidence

| Surface                                                                 | Evidence                                                                                                                          | Decision                                                                                                                                                                                  |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/services/tree-writer.ts::regroupTimelineSegments` | Uses one `Map<sessionID:stage, TimelineSegment>` for the whole ordered transcript.                                                | Replace global session-stage grouping with contiguous timeline segmentation. Reuse a segment only when the immediately previous visible non-phase message has the same session and stage. |
| `packages/overlay/src/services/tree-writer.ts::hydrateConversationView` | Calls the same regroup path after replaying transcript.                                                                           | The regroup fix must cover live SSE and hydrate together.                                                                                                                                 |
| `packages/overlay/src/services/chat.ts::panelMessage`                   | Task messages ingest `result.user_message`; session `prompt_async` returns without ingest.                                        | Session `prompt_async` must return a real persisted user message and feed it into the same tree-writer ingestion path.                                                                    |
| `packages/overlay/src/services/task.ts::submitMessage`                  | Selected session branch posts `prompt_async` and returns without local projection.                                                | Use the same persisted-message ingestion path for Mission/session composer sends.                                                                                                         |
| `packages/opencorvus/src/server/routes/session.ts::prompt_async`        | Response schema is `{ taskID }`; no message body.                                                                                 | Extend the contract to `{ taskID, user_message }`.                                                                                                                                        |
| `packages/opencorvus/src/scheduler/task-queue-service.ts`               | `enqueuePrompt()` persists only queue metadata; `execute()` later calls `SessionPrompt.prompt()`, which creates the user message. | Add an async-session enqueue path that persists the user message before queueing and later runs `SessionPrompt.loop()` without creating a duplicate message.                              |

## Invariants

- The visible timeline is chronological by real `Message.info.time.created`.
- A display segment groups only contiguous visible messages from the same
  runtime session and stage.
- The frontend must never create synthetic user-message placeholders.
- The real user message id is the single source for immediate UI projection and
  later SSE/hydrate idempotency.
- `prompt_async` queue execution must not insert a second user message.
- No fallback or text-parsing routing is introduced.

## Acceptance

- A transcript ordered `U1, A1, U2, A2` renders in that exact top-level order.
- Live `message.updated` events with the same pattern render in that exact
  top-level order.
- Mission and Coding Assistant session sends display the persisted user message
  immediately after the POST succeeds.
- `prompt_async` response includes `user_message` and queue execution calls the
  session loop without duplicating that message.
- Existing task `/message` real-message ingestion continues to use the same
  tree-writer path.
