# Conversation Artifact Event Routing Repair

## Recall

| Item                           | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| User requirement               | Find and repair why refreshing a Task conversation shows the empty “Conversation updates will appear here” surface even though messages exist. The user explicitly confirmed the display failure is unrelated to restarting the service.                                                                                                                                                                                                                                                                                                                                                                                 |
| Acceptance criteria            | Refreshing the affected Task projects its persisted messages; a persisted `artifact.persisted` event refreshes Board data without entering the message-card writer; hydration and live Server-Sent Events use the same ownership decision; truly unknown events still fail explicitly.                                                                                                                                                                                                                                                                                                                                   |
| Hard constraints               | Repair the root event-routing boundary without fallback, compatibility parsing, a workflow gate, database mutation, or service-restart reasoning. Preserve unrelated worktree changes. Do not add, modify, or run User Interface automated tests. Delete the task-relevant obsolete User Interface/negative tree-writer test encountered during investigation. Add only positive non-User Interface protocol-contract coverage. Validate the visible result through a real page and screenshot. Commit subjects start with `dsw-33987`; push the current main branch to `legacy-remote`.                                       |
| Sources read                   | User screenshot; `AGENTS.md`; `specs/current/architecture/07-panel-reactivity.md`; `packages/opencorvus/src/server/routes/orchestrator.ts`; `packages/opencorvus/src/conversation/view.ts`; `packages/overlay/src/services/conversation.ts`; `packages/overlay/src/services/events.ts`; `packages/overlay/src/services/event-policy.ts`; `packages/overlay/src/services/tree-writer.ts`; selected-Task recovery and selection lifecycle services; live read-only database/API/log evidence.                                                                                                                              |
| Whole-repository grep evidence | Searches covered every `commitConversationEvents`, `replayTaskEventToTree`, `applyTreeWriterEvent`, `routeSSEEvent`, `handleEventStreamEvent`, `artifact.persisted`, `isTreeWriterKnownEventType`, `isBoardInvalidatingEventType`, and tree-writer unknown-event call point. Hydration has one shared persisted-event replay function used by initial hydration, paged replay, tail merge, history/session loading, and rewind recovery. Live task events have one `routeSSEEvent` projection entry. `artifact.persisted` is emitted by the engine and classified as Board-invalidating, but is not a tree-writer event. |
| Independent agent feedback     | None. The user did not request sub-agents, and current collaboration policy forbids unrequested delegation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Evidence and cause chain

1. The affected Task's root session itself has no messages, but its descendant orchestrator/worker sessions own persisted messages and parts.
2. The canonical `GET /task/:taskID/conversation` route correctly aggregates that session tree. A read-only reproduction returned a successful response with 88 transcript messages, 88 view messages, four projected sessions, and six agent-view sessions.
3. The packaged Overlay requested the same conversation route and received HTTP 200, so persistence, Task/session aggregation, authentication, and the response transport were not the empty-state cause.
4. During refresh, `hydrateConversation()` commits the prepared message view and then calls `commitConversationEvents()` for persisted Task events.
5. Commit `f2b3d8e1d2` introduced `artifact.persisted` as a Board-invalidating control-plane event for the Delivery Slice architecture. It did not add that event to the tree-writer contract, which is correct because Artifact persistence does not create a message card.
6. Both hydration replay and live routing still called the tree-writer unconditionally before consulting the Board-invalidating policy. The observed runtime error was `tree-writer: unhandled event type "artifact.persisted"`.
7. Hydration treats a projection exception atomically and calls `rollbackConversationProjection()`. It therefore removes the messages that were successfully prepared milliseconds earlier and leaves the generic empty state.
8. The regression is data-dependent: Tasks without a persisted Artifact do not encounter that event during replay. The previous coverage file also mixed User Interface store assertions and prohibited negative assertions; it is not a valid regression barrier under the current test policy.

## Call-site disposition

| Owner / call site                             | Decision                                                                                                                                                                                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `event-policy.ts`                             | Add the single event-ownership decision: known tree-writer events belong to the conversation tree; recognized Board-invalidating events belong to the Board; anything else remains an explicit error.                              |
| `conversation.ts::commitConversationEvents()` | Route every persisted hydration/replay event through the shared ownership decision and call the tree-writer only for tree-owned events. Continue recording Task activity for every replayed event.                                 |
| `events.ts::routeSSEEvent()`                  | Use the same ownership decision after the existing dedicated message/browser paths. Tree-owned events project before their side effects; Board-owned events bypass the tree and continue to Board refresh handling.                |
| `tree-writer.ts`                              | Preserve its strict event contract unchanged. Do not disguise `artifact.persisted` as a tree-writer no-op.                                                                                                                         |
| `tree-writer-event-coverage.test.ts`          | Delete the encountered obsolete test because it asserts User Interface store absence and contains negative tests prohibited by the current repository rules.                                                                       |
| Positive protocol regression                  | Replace it with a pure event-policy contract that classifies all OpenAPI-declared Task events and positively proves `artifact.persisted` is Board-owned while message and dual-owned lifecycle events have their canonical owners. |

## Implementation plan

1. Introduce one shared conversation-event ownership classifier in `event-policy.ts`.
2. Apply it at the persisted hydration/replay and live Task-event projection boundaries.
3. Replace the obsolete tree-writer User Interface/negative test with positive pure protocol classification coverage.
4. Run the targeted non-User Interface contract test, Overlay typecheck/build, and required document-health checks.
5. Build/serve the updated Overlay, refresh the affected real Task page, inspect the message region, and capture a screenshot for manual visual review.
6. Perform a second diff and event-call-site review, commit only task-owned paths, fetch the latest remote branch, and push `v0.0.28beta` to `legacy-remote`.

## Progress

- [x] Prove the backend returns the affected Task's persisted messages.
- [x] Capture the exact frontend exception and identify the introducing commit.
- [x] Repair the shared event ownership boundary.
- [x] Complete non-User Interface contract/static validation.
- [x] Complete real-page screenshot acceptance.
- [x] Prepare the precise reviewed change set for commit and push.

## Validation record

- The positive pure protocol regression classifies every OpenAPI-declared Task event through the shared ownership decision. It proves `message.updated` and `task.completed` are tree-writer owned, while `artifact.persisted` and `run.progress` are Board owned.
- Overlay TypeScript checking passes.
- The production Vite bundle builds successfully.
- Historical links, product-document single-source, and document-health verification pass: 70 tests, 1,188 assertions.
- A real updated Vite page connected to the already-running production API on port 7878 without restarting or replacing that service. Selecting `Phase 01: TED采购数据采集分析与本地网站` hydrated the exact failed Task and visibly rendered its orchestrator messages, three sub-agent progress surfaces, tool activity, and terminal delivery failure instead of the empty state.
- Manual visual review passed against [the Task-bound screenshot](../../artifacts/2026-08-01-conversation-phase-01-messages-restored.png). The screenshot shows the selected Phase 01 row and the restored base-researcher, base-planner, base-developer, and orchestrator conversation content in the central message region.
