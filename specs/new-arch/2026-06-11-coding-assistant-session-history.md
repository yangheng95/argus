# Coding Assistant Session History

Date: 2026-06-11

## Requirement

Build session history for the right-sidebar Coding Assistant:

- show assistant sessions in the left panel;
- click a session to switch the center message list to that session;
- reuse the task-list row interaction model for row actions instead of inventing a second interaction grammar;
- support rename, delete, and stop;
- keep messages on the canonical session conversation/event stream.

## Call-Site Evidence

| Area | Evidence | Decision |
| --- | --- | --- |
| Coding Assistant entry | `packages/overlay/src/main.tsx` uses the left `assistant` activity and calls `selectCodingAssistantSession({ signal })`. | Keep the left activity, but mount a real session list instead of auto-selecting `limit=1`. |
| Current assistant service | `packages/overlay/src/services/coding-assistant.ts` lists `coding/sessions?limit=1`, creates `coding/session`, then hydrates `{ kind: "session" }`. | Extend this service into the single frontend facade for list/create/select/rename/delete/stop. |
| Message source | `packages/overlay/src/services/conversation.ts` hydrates session sources through `session/:id/conversation` and subscribes through `session/:id/events`. | Do not add `/coding/.../messages`; selected assistant sessions continue through canonical session routes. |
| Row primitives | `packages/overlay/src/components/TaskList.tsx` owns inline rename, two-step delete/stop, and hover actions; `MissionList.tsx` already uses `LedgerList` and `.ledger-row`. | Reuse the mature ledger row grammar and shared confirm hook. Do not coerce sessions into task rows. |
| Backend facade | `packages/opencorvus/src/server/routes/coding.ts` already creates/lists/claims right-sidebar sessions. | Extend `/coding` only where project-bound validation is needed. |
| Session single source | `packages/opencorvus/src/session/index.ts` owns `Session.setTitle`, `Session.remove`, `Session.setArchived`, messages, and events. | Reuse session CRUD and events; no new DB table or parallel history store. |
| Prompt queue | `packages/opencorvus/src/scheduler/task-queue-service.ts` owns async prompt queue state. | Stop/delete must cancel queued/running async prompts, not just active model streams. |

## Backend Plan

1. Keep `SessionTable`, `MessageTable`, and `PartTable` as the only conversation history tables.
2. Extend `GET /coding/sessions` with search and cursor pagination while preserving `{ sessions }` and adding `nextCursor`.
3. Add project-bound coding facade routes:
   - `PATCH /coding/session/:sessionID` for title updates, internally calls `Session.setTitle`;
   - `DELETE /coding/session/:sessionID` for physical deletion, internally validates right-sidebar metadata then calls canonical delete logic;
   - `POST /coding/session/:sessionID/abort` for stop, internally validates right-sidebar metadata then cancels the session prompt queue.
4. Update `Session.setTitle` and `Session.setArchived` to touch `time_updated`, so list ordering and `session.updated` reflect rename/archive changes.
5. Add a single queue cancellation helper in `TaskQueueService`, reused by `POST /session/:id/abort` and delete paths.
6. Do not add coding-specific message routes, fallback selection, or frontend-only stop simulation.

## Frontend Plan

1. Extend `packages/overlay/src/services/coding-assistant.ts` into the single service for:
   - loading session pages;
   - creating a new assistant session;
   - selecting a specific session;
   - renaming, deleting, and stopping sessions.
2. Add a Solid store for assistant sessions with `sessions`, `selectedSessionID`, `loading`, `error`, pagination, and action busy state.
3. Add `CodingAssistantSessionList` mounted in a new `leftPanelAssistant` body.
4. Use `LedgerList`, `.ledger-row`, `useArmedConfirm`, `Button`, and `Icon` for the row grammar; do not import or feed session data into `TaskList`.
5. Selecting a row calls `hydrateConversation({ kind: "session", id })` and `startSSE(source)`; the center panel remains the existing `Conversation` and `ChatComposer`.
6. Deleting the selected session clears the selected source and message board if no replacement is selected.

## Tests

- Backend:
  - right-sidebar coding sessions list pagination/search/project isolation;
  - title updates change `time.updated`;
  - coding facade rejects non-right-sidebar sessions;
  - abort/delete cancel async prompts through the queue helper.
- Overlay:
  - service calls the coding facade and never retired coding message APIs;
  - component supports select, rename, delete, stop, empty/loading/error;
  - browser test clicks Assistant, switches between two sessions, sends a message to selected session, and verifies no `/task/:id/message`.
- SDK/OpenAPI:
  - regenerate after route schema changes.

## Review Notes

Codex/backend explorer agreed that adding coding-specific message APIs would violate single source and create a parallel history surface.
Codex/frontend explorer agreed that putting session rows into `TaskList` would violate task semantics; the reusable layer is ledger row actions, not task data.
