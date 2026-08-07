# Task Message Queued Feedback

## Recall

| Item                       | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement           | After a Task failed, the operator entered `重试`; the Conversation rendered the user bubble but no response, leaving the operator unable to tell whether the message was accepted.                                                                                                                                                                                                                                                                                                                                          |
| Acceptance criteria        | A follow-up accepted into the same-directory root wake queue immediately exposes a visible queued fact in the selected Conversation; the fact comes from the canonical Task Board, disappears when the Task starts, remains separate from assistant speech, and does not bypass directory serialization. The real desktop-width Overlay must be opened, interacted with, screenshotted, and manually reviewed.                                                                                                              |
| Hard constraints           | Preserve unrelated dirty TaskQueueService, test, and specification work. Do not create a worktree, restart or mutate the installed OpenCorvus database, add a fallback, gate, state machine, synthetic/hidden message, duplicate status store, or User Interface (UI) automation test. Browser control uses Node.js, never Bun. Keep public Task activity semantics binary (`running` / `inactive`) and retain `queued` only as a physical scheduling fact.                                                                 |
| Supplied evidence          | The original-resolution screenshot `codex-clipboard-35e944ea-8c50-4190-a498-9365fec66815.png` shows Task `初始化页 @ 菜单视觉复核`, a final user bubble `重试`, and no subsequent visible acknowledgement.                                                                                                                                                                                                                                                                                                                  |
| Sources read               | Root `AGENTS.md`; Browser control Skill; `specs/current/architecture/03-control.md`, `07-panel.md`, and `16-unified-teardown.md`; the prior task-message immediate-stream, retry-schema, queue-question-retirement, Task activity-semantics, and selected-title lifecycle-chrome records; current task message route, Task API, queue, Board/store, Conversation shell, Composer, Work Ledger status service, shared `StatusIndicator`, styles, and locale catalogs.                                                        |
| Whole-repository search    | Searches covered `panelMessage`, `wake_status`, `operator_message_wake`, `queued_operator_wake`, `task.message`, `TaskStatusHeader`, `chat-header-status`, Task lifecycle labels, Composer submission state, native notifications, and every visible queued/status projection under the Overlay. The route response, durable wake Artifacts, Task Board, Work Ledger, hidden selected-title status, and modal app dialog are the existing owners; there is no current non-modal queued acknowledgement in the Conversation. |
| Independent agent feedback | None. The user did not request sub-agents, so no delegation was used.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Incident evidence and causal chain

The installed runtime database was opened read-only with SQLite query-only mode. No row or process was changed.

1. Task `tsk_fc67c2a3c001d4P0MnV7fe6LJV` was cancelled at `2026-08-03T15:30:10`.
2. Root message `msg_fc6b7b02d001rNhLlXMp6ijp8e` containing `重试` was persisted at `16:22:34.797`.
3. The runtime emitted `task.message`, reopened the Task as `queued`, and persisted both `queued_operator_wake` and `operator_message_wake` evidence with `wake_status: queued`.
4. Another Task in the same project directory retained the one root wake queue owner until it failed at `16:34:11.607`. The reported Task became active at `16:34:11.826` and its Orchestrator began streaming at `16:34:12.272`.
5. Therefore the message and wake were not lost. The visible silence lasted about eleven minutes and thirty-seven seconds because `panelMessage` projected only the persisted user message, refreshed the Board, and discarded the successful route acknowledgement from presentation. The title status mount was intentionally clipped by an earlier visual requirement, so the canonical `queued` Board fact had no visible Conversation consumer.

The observable symptom is an unanswered user bubble. The direct trigger is correct same-directory serialization. The deeper product defect is the missing presentation of an already-authoritative scheduling fact. Bypassing the queue or manufacturing assistant prose would corrupt the real execution and message boundaries rather than repair that defect.

## Implementation plan

1. Keep `POST /task/:taskID/message`, Task reopening, and root wake queue behavior unchanged.
2. Add one selected-Task queued notice immediately above the existing Composer. Read only the matching `boardStore.board.task.status` and reuse the shared `StatusIndicator`; do not persist local acknowledgement state.
3. Describe the queue as physical scheduling feedback rather than a public Task outcome. Keep the previously requested selected-title lifecycle point absent.
4. Add English and Chinese copy through the existing locale catalogs and document the projection in current Panel architecture.
5. Run formatting, Overlay typecheck/build, focused non-UI route contracts, document health checks, and `git diff --check`. Do not run UI tests.
6. Start an isolated real Overlay through the Node browser toolchain, reach a genuine queued Task state, capture current-goal screenshots, inspect them at original resolution, and correct visual problems before delivery.
7. Review the complete diff and evidence a second time, commit with the `dsw-33987` prefix, fetch/converge the delivery branch, and push it to `legacy-remote`.

## Verification

- Focused positive route contract passed: `bun test test/server/task-message-routes.test.ts --test-name-pattern "POST /task/:taskID/message queues a completed same-cwd task behind active work" --timeout 30000` (`1 pass`, `23 filtered`, `0 fail`).
- Overlay `bun run typecheck` passed.
- Overlay production `bun run build:vite` passed (`7061 modules transformed`). Only the existing Radix `use client` and large-chunk warnings were reported.
- The first visual pass exposed the untranslated `chat.task_queue_notice` key during locale startup. The projection now waits for the canonical `appStore.i18nReady` fact; the corrected real-page pass rendered the English queue sentence.
- The isolated server projected a genuine same-directory queued Task through the Task Board. The real desktop Overlay was opened through the Node browser toolchain, the Mission and queued child Task were selected through visible controls, and the notice was inspected at original resolution. It is a compact status row above the Composer, does not cover content or controls, and remains visibly separate from assistant speech.
- Visual evidence: [queued Task Conversation](../../artifacts/2026-08-03-task-message-queued-feedback.png).
- Prettier passed for every touched source, locale, architecture, index, and record file.
- Documentation checks passed: `historical-docs-links.test.ts` (`2 pass`), `document-health.test.ts` (`60 pass`), and `product-docs-single-source.test.ts` (`8 pass`).
- `git diff --check` passed before delivery. The delivery commit and `legacy-remote` push provide the immutable final record.
