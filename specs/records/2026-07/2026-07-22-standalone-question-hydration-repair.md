# Standalone Question Hydration Repair

Date: 2026-07-22
Status: Verified
Owner: Codex

## Recall

| Item                       | Requirement or evidence                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement           | Explain why the Mission `question` regressed and repair the invisible question that left Chat showing only one active Agent card.                                                                                                                                                                                                       |
| Supplied evidence          | Chat `ses_0762ab5c7ffelxHi0i5IetySB7` showed one Agent card and no Message/Tool cards while active. Read-only server evidence proved that the session contained display messages and a running `question` tool with one question and two options.                                                                                       |
| Acceptance                 | A pending standalone Mission/Assistant question must be present after initial hydration, reconnect, or source reselection; it must use the existing InteractionCard and `/question/:id/reply` endpoint; another session's question must not leak into the selected session tree; live reply/reject must still settle the hydrated card. |
| Hard constraints           | Keep `Question` pending state as the sole runtime source. Do not add a second UI, synthetic message, fallback, polling, reconnect gate, local clock ordering, or task-question duplicate. Preserve the existing running OpenCorvus/Overlay processes.                                                                                   |
| Read records               | `specs/current/architecture/07-panel-reactivity.md`, `specs/records/2026-06/2026-06-04-mission-question-rendering.md`, `specs/records/2026-07/2026-07-19-question-timeline-order-source.md`, and the current session route/tree-writer code.                                                                                            |
| Git evidence               | `8f80d7d14` added live `question.*` rendering but no hydration contract. `081353b6c` both left session hydration without pending interaction state and explicitly excluded session sources from stream reconnect. Later session single-source and Overlay mirror-retirement work removed the accidental alternate visibility path, making the pre-existing omission reliably visible. |
| Independent agent feedback | None. The user did not request sub-agents and the active collaboration policy forbids inferred delegation. The primary agent owns implementation and second review.                                                                                                                                                                     |

## Causal chain

1. `Question.ask` stores a pending request and publishes the real `question.asked` event.
2. The session protocol bridge projects that live event with a backend-owned interaction `orderKey`.
3. Overlay stores the request only in `standaloneQuestionInteractions` and renders it through the shared InteractionCard path.
4. Session selection/hydration calls `resetWriter`, which clears that map.
5. `GET /session/:sessionID/conversation` returns transcript/view state but always returns `events: []` and no pending-question snapshot.
6. Session sources were also explicitly excluded from the selected-stream reconnect branch, so a dropped Mission stream never restored live question delivery.
7. A question emitted before stream attachment, during hydration, or while the disconnected stream remained closed could not be reconstructed. The model remained blocked in `Question.ask`, while the UI showed only the hydrated Agent card.
8. With `experimental.auto_question=true`, the invisible request is rejected after 300,000 ms and reported to the model as a user dismissal.

## Exhaustive call-point disposition

| Surface                                                                   | Current role                                                        | Disposition                                                                                                       |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `question/index.ts` `Question.ask/list/reply/reject`                      | Sole in-memory pending-question owner and lifecycle publisher.      | Preserve; expose the existing canonical Request schemas through the pure schema module.                           |
| `question/types.ts`                                                       | Pure schema boundary currently containing only Answer.              | Own Option, Info, Request, and Answer schemas so API models reuse one definition without importing runtime state. |
| `tool/question.ts`, `tool/panel.ts`, orchestrator question callers        | Create requests through `Question.ask`/`askAndFormat`.              | Preserve unchanged.                                                                                               |
| `server/routes/question.ts`                                               | Global pending list and reply/reject endpoints.                     | Preserve unchanged; session hydration must not call its HTTP route internally.                                    |
| `protocol/session-mirror.ts`                                              | Maps real live `question.*` events and owns interaction order keys. | Reuse the same backend timeline-order primitive for hydration snapshots.                                          |
| `server/routes/session.ts` conversation route                             | Hydrates a selected session tree, currently with empty events.      | Add session-tree-filtered `pendingQuestions`, each stamped with its canonical interaction `orderKey`.             |
| `server/routes/session.ts` event route                                    | Subscribes to live protocol events after hydration.                 | Subscribe first, then snapshot the same canonical pending store so the HTTP-hydrate-to-stream race is closed.     |
| `engine/model.ts` `SessionConversationHydration`                          | API schema and generated SDK source.                                | Add `pendingQuestions` using the canonical Question Request schema plus required `orderKey`.                      |
| `overlay/services/conversation.ts`                                        | Resets and hydrates the selected session conversation.              | Require `pendingQuestions` for session sources and seed the tree-writer projection immediately after reset.       |
| `overlay/services/tree-writer.ts`                                         | Live standalone-question map and InteractionCard projection.        | Factor one request-to-interaction mapper shared by live events and hydration; keep one map and one renderer.      |
| `overlay/services/sse.ts`                                                 | Owns selected Task and session stream lifecycle.                    | Reopen a disconnected current session stream; reject stale reconnects using the existing selection generation.   |
| `overlay/utils/interaction.ts`, `InteractionCard`, `interaction-reply.ts` | Shared visual and reply path.                                       | Preserve unchanged.                                                                                               |
| Task conversation `board.interactions`                                    | Canonical task-owned interaction projection.                        | Preserve unchanged and do not add pending standalone questions.                                                   |
| Generated OpenAPI/SDK artifacts                                           | Public contract mirrors.                                            | Regenerate from the updated schema.                                                                               |

Repository-wide searches covered `Question.Request`, `Question.ask`, `Question.list`, `question.asked/replied/rejected`, `standaloneQuestionInteractions`, `SessionConversationHydration`, both conversation routes, InteractionCard conversion/reply, and generated API types.

## Implementation plan

1. Move Question Option/Info/Request schemas into the existing pure schema module and re-export them through the `Question` namespace.
2. Add a canonical pending-question hydration row containing the exact request plus backend interaction `orderKey`.
3. Filter hydration rows to the selected session tree.
4. Seed the existing standalone-question map after writer reset and before transcript hierarchy rebuild.
5. Subscribe before reading the canonical pending store and replay current requests on every session-stream connection, closing the hydration-to-stream race without a second state owner.
6. Restore session stream reconnect without clearing the hydrated conversation and suppress stale reconnect after source changes.
7. Add server route, overlay hydration, live settlement, cross-session isolation, schema, reconnect, and browser rendering regressions.
8. Update current architecture, generated artifacts, and documentation indexes; run focused tests, type checks, document health, real Node/Playwright visual verification, and a second diff review.

## Verification evidence

- Server conversation/SSE regression: 15 passed, including a question already pending before stream connection.
- Expanded focused backend and Overlay regression: 132 passed before the race audit; the added reconnect/hydration subset passed 51 tests after the final repair.
- OpenCorvus and Overlay TypeScript checks passed.
- API route parity and documentation checks passed.
- Node-launched browser visual regression passed and produced `.scratch/interaction-response-chronology/mission-question-response.png`; direct inspection confirmed the hydrated Mission question, selected answer, and following turn render in order without clipping.
- Historical documentation links passed. Document health is clean for this tracked record; a concurrently authored untracked record remains outside this change's ownership until its author stages it.

## Verification plan

- `bun test packages/opencorvus/test/server/session-conversation-routes.test.ts`
- `bun test packages/opencorvus/test/question/question.test.ts packages/opencorvus/test/protocol/session-mirror.test.ts`
- `bun test packages/overlay/test/conversation-hydrate-replay.test.ts packages/overlay/test/tree-writer-hierarchy.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/mission-question-response-chronology-browser.test.ts`
- package type checks and generated API parity checks
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`
