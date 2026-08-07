# Task Message Immediate Stream

Date: 2026-07-02

SSE means Server-Sent Events. UI means User Interface. DB means Database. API
means Application Programming Interface.

## Recall

- User request:
  - "为什么现在的用户消息会阻塞，而不是立马进入消息流？"
  - "我记得我修复过这个问题，是不是有代码没有提交被丢弃了"
  - "修复问题"
- Current finding: the 2026-06-30 fix was not lost. Commit
  `21ed94328e` repaired the scheduler wake commitment: once a task-root user
  message is durably persisted, `/task/:taskID/message` must either record an
  accepted `operator_message_wake` fact or return a synchronous error.
- Current acceptance criteria:
  - A selected task user message must enter the existing conversation stream as
    soon as the real persisted message/part rows are committed.
  - The message must not wait for the `/task/:taskID/message` HTTP response to
    settle when that response is still waiting on scheduler wake acceptance.
  - Do not add local optimistic placeholders, synthetic messages, hidden UI-only
    messages, retry loops, or a second message source.
  - Keep the 2026-06-30 wake-commitment contract intact.
  - Add a regression test that keeps the message POST unresolved and proves the
    selected task SSE stream emits the real message-change signal first.
- Hard constraints:
  - No fallback or compatibility branch.
  - Do not restart, refresh, kill, or otherwise interfere with the running
    OpenCorvus or overlay process.
  - Do not create a new worktree.
  - Do not revert unrelated dirty worktree changes.
  - Every code change needs focused tests.
- Disk records read before implementation:
  - `specs/records/2026-06/2026-06-30-operator-message-wake-commitment.md`
  - `specs/records/2026-06/2026-06-13-conversation-contiguous-timeline-live-message.md`
  - `specs/records/2026-06/2026-06-24-agent-rail-live-message-stream.md`
  - `specs/records/2026-06/2026-06-23-agent-rail-visibility-regression.md`
  - `specs/README.md`
  - `specs/records/2026-07/README.md`
- Whole-repository search evidence:
  - `packages/overlay/src/services/chat.ts::panelMessage()` awaits
    `apiJson(taskPath(taskID, "/message"), ...)` and only then calls
    `ingestPersistedConversationMessage(result.user_message)`.
  - `packages/opencorvus/src/task-api/index.ts::appendAndWakeTaskOperatorMessage()`
    persists the visible root-session user message before calling
    `dispatchTaskLoop()`.
  - `packages/opencorvus/src/engine/queue.ts::dispatchTaskLoop()` preserves the
    `beforeAcceptedWake` acceptance callback required by the 2026-06-30
    contract.
  - `packages/opencorvus/src/server/routes/orchestrator.ts` emits
    `task.messages.changed` from the selected task SSE stream, but the current
    change detector is timer driven by `TASK_MESSAGE_CHANGE_POLL_MS = 2_000`.
  - `packages/overlay/src/services/events.ts` already treats
    `task.messages.changed` as the selected task tail-merge trigger.
  - `packages/opencorvus/src/session/index.ts::Session.persistMessage()` emits
    real `Message.Event.Created`, `Message.Event.Updated`, and
    `Message.Event.PartUpdated` after the DB transaction commits.
  - `packages/opencorvus/src/orchestrator/task-event.ts::taskIDForSession()`
    maps any session in a task tree back to its owning task from DB state.
- Independent agent feedback: not delegated in this turn; the direct evidence
  above identifies a single route-level notification edge, and creating
  parallel agents was not necessary for this bounded fix.

## Root Cause

The current UI has two real projection paths for a task-root user message:

1. the `/task/:taskID/message` response body, which `panelMessage()` projects
   through `ingestPersistedConversationMessage()`;
2. the selected task SSE stream, which can already render `message.*` live
   events and can trigger DB tail merge through `task.messages.changed`.

The route response path is intentionally behind scheduler wake acceptance after
the 2026-06-30 repair. That acceptance boundary is correct because the API must
not report success after writing a visible user message unless the scheduler
has accepted or rejected the wake.

The missing edge is that the DB-tail notification for selected task messages is
not event driven. It is emitted by a periodic watermark check, so the durable
message can exist while the frontend still waits for either the POST response
or the next timer tick.

## Repair Plan

1. Keep `/task/:taskID/message` response semantics and the
   `operator_message_wake` acceptance fact unchanged.
2. In the selected task SSE route, subscribe to real `Message.Event.*` DB-write
   events already emitted by `Session.persistMessage()`, `updateMessage()`,
   `updatePart()`, and delete operations.
3. For each message mutation, resolve the event session to its owning task via
   `taskIDForSession()` and only notify the matching open task stream.
4. Emit the existing `task.messages.changed` event from the current
   `taskMessageWatermarkCursor()`; do not invent a new event or message source.
5. Coalesce same-turn message/part writes before reading the watermark so the
   UI tail merge sees the committed message bundle.
6. Add a route test where `/task/:taskID/message` is deliberately held before
   returning, while `/task/:taskID/events` must emit `task.messages.changed`
   for the persisted message first.

## Validation Plan

- `bun test --timeout 70000 --max-concurrency 1 packages/opencorvus/test/server/task-message-routes.test.ts --test-name-pattern "emits task.messages.changed before scheduler response settles"`
- `bun test --timeout 70000 --max-concurrency 1 packages/opencorvus/test/server/task-conversation-routes.test.ts --test-name-pattern "task.messages.changed"`
- `bun run --cwd packages/opencorvus typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`

## Implementation

- `GET /task/:taskID/events` now subscribes to same-instance
  `Message.Event.Created`, `Message.Event.Updated`,
  `Message.Event.PartUpdated`, `Message.Event.Removed`, and
  `Message.Event.PartRemoved`.
- The stream resolves each mutation's `sessionID` through
  `taskIDForSession()` and only schedules a notification when that session
  belongs to the open task stream.
- New first-write `message.created` events force one
  `task.messages.changed` emission from the current
  `taskMessageWatermarkCursor()` even if the existing live `message.updated`
  path has already marked the same watermark as seen.
- Non-first-write mutations still use the existing watermark/signature
  comparison, preserving the old suppression behavior for ordinary live
  message updates.
- The notification is coalesced through a zero-delay timer so the persisted
  message row and its committed parts are visible to the tail-merge reader.
- Added a route regression that opens `/task/:taskID/events`, starts
  `/task/:taskID/message`, deliberately keeps the mocked scheduler response
  unresolved, and asserts `task.messages.changed` plus the real DB user
  message arrive before the POST response settles.

## Verification

- PASS:
  - `bun test --timeout 70000 --max-concurrency 1 packages/opencorvus/test/server/task-message-routes.test.ts --test-name-pattern "emits task.messages.changed before scheduler response settles"`
  - `bun test --timeout 70000 --max-concurrency 1 packages/opencorvus/test/server/task-conversation-routes.test.ts --test-name-pattern "task.messages.changed"`
  - `bun test --timeout 70000 --max-concurrency 1 packages/opencorvus/test/server/task-conversation-routes.test.ts --test-name-pattern "message watermark|same-millisecond DB writes"`
  - `bun test --timeout 70000 --max-concurrency 1 packages/opencorvus/test/server/task-conversation-routes.test.ts --test-name-pattern "reports DB message writes after"`
  - `bun run --cwd packages/opencorvus typecheck`
  - `bunx prettier --check packages/opencorvus/src/server/routes/orchestrator.ts packages/opencorvus/test/server/task-message-routes.test.ts specs/records/2026-07/2026-07-02-task-message-immediate-stream.md specs/records/2026-07/README.md`
  - `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  - `git diff --check -- packages/opencorvus/src/server/routes/orchestrator.ts packages/opencorvus/test/server/task-message-routes.test.ts specs/records/2026-07/2026-07-02-task-message-immediate-stream.md specs/records/2026-07/README.md`

## Self Review

- No optimistic UI placeholder, synthetic message, or hidden message branch was
  added.
- `/task/:taskID/message` still waits for the scheduler acceptance contract and
  still returns `user_message` for the existing response projection path.
- `task.messages.changed` remains the existing selected-task DB-tail signal;
  the repair adds an event-driven notification edge from real DB write events,
  not a second content source.
- Existing raw DB watermark polling tests still pass, including
  same-millisecond signature detection.
