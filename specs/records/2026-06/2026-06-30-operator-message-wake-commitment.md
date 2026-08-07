# Operator Message Immediate Wake Commitment

Date: 2026-06-30

DB means Database. API means Application Programming Interface. UI means User
Interface.

## Recall

- User request: "我发消息为什么调度器没有立即响应？" followed by
  "修复问题".
- Observed task: `tsk_f175ee0cc001ZEV3S05eVFSVGi`.
- Runtime evidence:
  - `2026-06-30T08:30:23.728Z`: root session user message
    `msg_f17a69ff00010xq1L8PlD52ZPy` persisted with text
    `直接标准g2完成`.
  - `2026-06-30T08:30:23.735Z`: protocol event `task.message`
    persisted with summary `Operator note recorded`.
  - `2026-06-30T08:30:23.735Z` through `2026-06-30T08:46:43.775Z`:
    no orchestrator `session.status` streaming event and no
    `queued_operator_wake` artifact.
  - `2026-06-30T08:46:44.986Z`: later orchestrator wake came from
    `goal_refill_notification`, not from the operator message.
  - `a2a_task_queue` had no rows for the relevant sessions or time window.
- Running server evidence:
  - `http://127.0.0.1:7878/global/health` uses
    `C:\Users\chuan\.local\share\opencorvus\opencorvus.db`.
  - Port 7878 is owned by embedded sidecar
    `C:\Users\chuan\AppData\Local\ai.opencorvus.overlay\embedded\sidecar-12073-c7dfe10c4222e03c\opencorvus.exe`,
    started `2026-06-30 15:11:33 +08:00`.
- Acceptance criteria:
  - `/task/:taskID/message` must start a task-root orchestrator wake
    immediately when the task is active, even if child build/goal tool
    ownership is live.
  - `/task/:taskID/inject` uses the same task-root operator-message wake
    contract.
  - A user operator message must not be persisted as a pending
    `queued_operator_wake` solely because live child ownership exists.
  - The immediate root wake must not call `interruptTaskLoop`, must not close
    live child ownership, and must leave running goal runs running.
  - Non-message internal events may still queue behind live ownership.
  - `/task/:taskID/message` must not produce a durable visible task-root user
    message plus `task.message` event without a corresponding durable wake
    acceptance fact or a synchronous error.
  - Active task re-entry must have a durable wake commitment before the API
    reports `wake_status: "started"`.
  - Live ownership queueing for non-message events must keep the existing single
    durable `queued_operator_wake` source.
  - No polling fallback, no UI retry, no sidecar restart, no process kill, and no
    hidden synthetic message.
  - Add targeted regression tests.
- Hard constraints:
  - No fallback/compatibility path.
  - Do not restart, refresh, kill, or otherwise interfere with the running
    OpenCorvus or overlay process.
  - Do not create a new worktree.
  - Do not revert unrelated dirty worktree changes.
- Disk records read before implementation:
  - `specs/records/2026-06/2026-06-30-mcp-goal-worktree-convergence.md`
  - `specs/records/2026-06/2026-06-30-overlay-goal-phase-board-sync-recovery.md`
  - `specs/current/architecture/01-agents.md`
  - `specs/current/architecture/03-control.md`
  - `specs/records/2026-06/2026-06-13-build-steer-live-ownership-interrupt-fix.md`
  - `specs/records/2026-06/2026-06-29-operator-steer-single-source.md`
- Whole-repository grep evidence:
  - `POST /task/:taskID/message` is the strict task-root input route in
    `packages/opencorvus/src/server/routes/orchestrator.ts`.
  - `EngineService.handleTaskMessage` calls `continueTaskMessage`, which calls
    `appendAndWakeTaskOperatorMessage`.
  - `appendAndWakeTaskOperatorMessage` currently persists the visible user
    message and `TaskMessageRecorded` event before invoking `dispatchTaskLoop`.
  - `dispatchTaskLoop` persists `queued_operator_wake` only for queued tasks or
    live orchestrator tool ownership; active re-entry starts the loop without a
    durable acceptance artifact.
  - Existing tests cover natural-language dispatch and live-ownership queueing,
    but not the active started wake commitment or dispatch failure after message
    persistence.
- User correction after the first repair: "你在改什么？我说的是用户消息不能立即响应".
  The first repair made wake acceptance observable, but did not change the
  scheduler behavior that queued operator messages behind live ownership. The
  current repair supersedes the old live-ownership queue expectation for
  `event.operatorMessage`.
- Independent agent feedback: a read-only follow-up review after implementation
  found one missed old contract in
  `packages/opencorvus/test/engine/queued-wake-ownership-drain.test.ts`: it
  still expected live-ownership `operatorMessage` wakes to return `queued` and
  drain after ownership completion. That test was revised to assert immediate
  `started` root wakes while keeping retry/replan and non-message wake queueing.

## Root Cause

The direct scheduler root cause is the live ownership branch in
`dispatchTaskLoop`. It treated `event.operatorMessage` the same as internal
coordination/passive wakes: when any live `orchestrator_tool_ownership` existed,
it enqueued the event and returned `queued` without launching a task-root loop.
That behavior makes user messages wait for child build/goal ownership closure,
so the root orchestrator has no immediate visible response.

The first repaired issue remains real but secondary: the task-message route had
a split commit boundary. It committed the visible operator message and the
`task.message` protocol event before the scheduler accepted the wake. Without a
durable acceptance artifact, runtime evidence could not distinguish a scheduler
skip from an accepted active re-entry. That did not by itself fix immediate
response.

## Repair Plan

1. Keep the durable `operator_message_wake` artifact written only when
   `dispatchTaskLoop` accepts an operator message wake.
2. Record the artifact from `dispatchTaskLoop.beforeAcceptedWake`, so the wake
   commitment is written inside the canonical scheduler acceptance path for
   `started` and `queued`.
3. Change `dispatchTaskLoop` so live child ownership does not queue
   `event.operatorMessage`; it must continue into the active re-entry branch and
   return `started`.
4. Keep live child ownership and running goal runs intact; do not call
   `interruptTaskLoop` for ordinary task-root user messages.
5. Keep `queued_operator_wake` as the only queued event source for non-immediate
   queued events. The new artifact
   is an acceptance/diagnostic commitment, not a second event queue.
6. If `dispatchTaskLoop` returns `ignored` or throws, the API must surface the
   failure rather than report success.
7. Add regression tests for:
   - active started operator message writes `operator_message_wake`;
   - live ownership plus operator message starts the root wake immediately and
     does not write a pending queued event;
   - live ownership plus non-message events still queues through the existing
     durable queue;
   - dispatch rejection after message write returns an error and does not claim
     `wake_status: "started"`.

## Validation Plan

- `bun test packages/opencorvus/test/server/task-message-routes.test.ts --test-name-pattern "operator message"`
- `bun test packages/opencorvus/test/engine/queue.test.ts --test-name-pattern "operator wake with multiple live owners|task message response starts immediate root wake|waking a live-owned active task queues"`
- `bun test packages/opencorvus/test/server/task-message-routes.test.ts --test-name-pattern "inject starts root wake|message starts root wake|does not interrupt async goal"`
- `bun run --cwd packages/opencorvus typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`

## Implementation

- Added `engine_artifact.kind = "operator_message_wake"`.
- `appendAndWakeTaskOperatorMessage` now passes a `beforeAcceptedWake` callback
  to `dispatchTaskLoop`.
- When the scheduler accepts the operator wake, the task API writes one
  `operator_message_wake` artifact with label `started` or `queued` and payload
  fields `task_id`, `message_id`, `source`, `wake_status`,
  `time_recorded`, and `recorded_by_process_id`.
- If `dispatchTaskLoop` throws or returns `ignored`, the API writes
  `operator_message_wake` with label `failed` and returns the error instead of
  reporting a successful wake.
- Route tests now mock accepted scheduler wakes by invoking
  `beforeAcceptedWake`; a mock may no longer return `started` while skipping
  the acceptance callback.
- Engine tests now cover active re-entry `started` commitment and live-ownership
  `queued` commitment while keeping `queued_operator_wake` as the only queued
  event source.
- `dispatchTaskLoop` now treats `event.operatorMessage` as an immediate
  task-root wake even while child `orchestrator_tool_ownership` remains live.
  The non-message live-ownership branch still queues through the existing
  durable queue.
- Route and engine tests now assert that `/message` and `/inject` return started
  wakes under live child ownership, launch another root loop, do not interrupt
  the running child, and do not create a pending queued wake for the user
  message.
- The old queued-wake ownership drain regression now distinguishes message
  wakes from other operator events: `operatorMessage` starts immediately, while
  retry/replan intents and non-message wakes still use the durable queue.

## Verification

- Passed:
  - `bun test packages/opencorvus/test/server/task-message-routes.test.ts --test-name-pattern "POST /task/:taskID/message triggers scheduler|records failed wake commitment|forwards attachment summary"`
  - `bun test packages/opencorvus/test/engine/queue.test.ts --test-name-pattern "operator wake with multiple live owners|task message response starts immediate root wake|waking a live-owned active task queues"`
  - `bun test --timeout 70000 --max-concurrency 1 packages/opencorvus/test/server/task-message-routes.test.ts --test-name-pattern "inject starts root wake|message starts root wake|does not interrupt async goal|POST /task/:taskID/message triggers scheduler"`
  - `bun test --timeout 70000 --max-concurrency 1 packages/opencorvus/test/engine/queued-wake-ownership-drain.test.ts --test-name-pattern "operator message wakes start immediately|retry and replan operator intents queued|non-operator wake behind live ownership"`
  - `bun test --timeout 70000 --max-concurrency 1 packages/opencorvus/test/engine/queued-wake-ownership-drain.test.ts --test-name-pattern "advanceQueue keeps durable wake pending"`
  - `bun run --cwd packages/opencorvus typecheck`
  - `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
  - `bunx prettier --check packages/opencorvus/src/engine/queue.ts packages/opencorvus/src/engine/engine.sql.ts packages/opencorvus/src/task-api/index.ts packages/opencorvus/test/engine/queue.test.ts packages/opencorvus/test/engine/queued-wake-ownership-drain.test.ts packages/opencorvus/test/server/task-message-routes.test.ts specs/records/2026-06/2026-06-30-operator-message-wake-commitment.md specs/records/2026-06/README.md`
  - `git diff --check -- packages/opencorvus/src/engine/queue.ts packages/opencorvus/src/engine/engine.sql.ts packages/opencorvus/src/task-api/index.ts packages/opencorvus/test/engine/queue.test.ts packages/opencorvus/test/engine/queued-wake-ownership-drain.test.ts packages/opencorvus/test/server/task-message-routes.test.ts specs/records/2026-06/2026-06-30-operator-message-wake-commitment.md specs/records/2026-06/README.md`
- Residual test-runner issue:
  - `bun test --timeout 70000 --max-concurrency 1 packages/opencorvus/test/engine/queue.test.ts`
    passed 31 assertions tests and failed only in the final `afterEach` while
    `resetDatabase()` removed `opencorvus.db-wal` on Windows with `EBUSY` after
    its own 60 second diagnostic timeout. The two new queue regressions passed
    independently.
  - `bun test --timeout 70000 --max-concurrency 1 packages/opencorvus/test/server/task-message-routes.test.ts`
    also hit the same Windows `resetDatabase()` WAL removal lock during
    `afterEach` after unrelated existing route tests. The targeted route tests
    covering the changed behavior passed.
  - `bun test --timeout 70000 --max-concurrency 1 packages/opencorvus/test/engine/queued-wake-ownership-drain.test.ts`
    ran all seven queued-wake tests; six passed and one failed in `afterEach`
    with the same Windows `opencorvus.db-wal` `EBUSY` removal lock. The failed
    test passed when run independently, and the revised operator-message
    regression passed in both targeted and full-file runs before cleanup failed.
