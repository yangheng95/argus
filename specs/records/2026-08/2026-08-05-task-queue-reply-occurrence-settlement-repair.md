# Task Queue Reply Occurrence Settlement Repair

Status: Completed
Date: 2026-08-05
Owner: Codex

## Recall

### User requirement

- Explain why Work Session `ses_02e54cd92ffew7XzHtbbFxT3i1` displayed
  `timed out`, identify a repair that does not trade one lifecycle defect for
  another, obtain an independent Agent challenge, then implement and review the
  complete repair.

### Acceptance criteria

- Queue task `tsk_fd1ab35430013Md6u4Y6Y46by8` is explained from durable
  message, log, queue-row, and code-path evidence rather than from its terminal
  label.
- A queue occurrence completes when its exact visible user message receives a
  persisted final assistant reply, even while the reusable Session prompt owner
  remains in standby.
- A queued wake that attaches after its reply was already persisted still
  resolves from the same user-message-to-assistant-message relation.
- A queued wake that attaches to an existing standby owner captures that exact
  physical owner for cancellation and timeout cleanup.
- Cancellation, timeout, and exceptional rejection wait for the captured owner
  to finish before the next same-Session queue occurrence starts.
- No timeout increase, unconditional heartbeat, idle-status gate, hidden
  message, database migration, compatibility path, or second lifecycle source
  is introduced.
- Positive non-User-Interface (UI) contracts cover successful standby
  settlement, persisted-reply attachment, exact-owner cancellation ordering,
  and the existing two-occurrence recovery contract.
- Relevant focused tests, package typecheck, document health checks, and a
  second code review pass complete before commit and legacy remote push.

### Hard constraints

- Preserve unrelated dirty worktree changes and stage only this repair.
- Do not create a worktree, reset, stash, restart OpenCorvus/Overlay, or run UI
  automation tests.
- `SessionPromptState` remains the only physical owner authority. The persisted
  visible user/assistant parent relation remains the only reply occurrence
  authority. The queue row remains the only queue terminal authority.
- Successful occurrence settlement and destructive owner cleanup are distinct
  facts. Only destructive or exceptional settlement waits for owner teardown.
- Commit subjects start with `dsw-33987` and push to the legacy remote
  remote without bypassing hooks.

### Sources read

- `AGENTS.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-08/2026-08-03-agent-session-continuation-and-prism-planner.md`
- `specs/records/2026-08/2026-08-04-task-lifecycle-session-closure-system-repair-plan.md`
- `specs/records/2026-08/2026-08-04-single-runtime-owner-and-phase-closure-recovery.md`
- `specs/records/2026-08/2026-08-04-task-resume-occurrence-and-overlay-recovery.md`
- Production log
  `C:/Users/hengu/AppData/Local/opencorvus/log/2026-08-05T105509-29436-1.log`
- The production Session conversation response for
  `ses_02e54cd92ffew7XzHtbbFxT3i1`.
- Queue, Session loop, prompt-state, prompt-run, wake, cancellation-scope,
  message-store, route, and focused test sources named below.

### Incident evidence

- The final assistant message `msg_fd1b195260010WSgIvF4rCirMN` is durably
  complete with `finish=stop` at `2026-08-05T11:32:07.709Z` and contains the
  requested report plus four interactive artifacts.
- The Session entered normal standby at `11:32:07.725Z`.
- The queue row remained `running` because `TaskQueueService.execute()` waited
  unconditionally for the reusable prompt owner to finish after the reply
  callback had resolved.
- The configured `600000` millisecond inactivity window expired at
  `11:42:07Z`; recovery cancelled the owner and wrote
  `task timed out while running`.
- Commit `4cd09a7ef1` introduced the unconditional owner-finish wait while
  repairing the valid cancellation invariant that a cancelled owner must
  physically finish before a later occurrence begins.

### Whole-repository call-site inventory

| Surface | Call sites | Decision |
| --- | --- | --- |
| `SessionPrompt.withPromptOwnerCapture` | `control/message.ts`, `scheduler/task-queue-service.ts` | Preserve both; prompt attachment must report an existing owner through the same capture channel. |
| `SessionPrompt.waitForOwnedFinish` | `engine/cancellation-scope.ts`, `scheduler/task-queue-service.ts` | Preserve destructive cleanup; remove the queue's unconditional success wait and retain the wait only after occurrence rejection. |
| `SessionPromptState.attach` | `session/loop.ts`, `session/prompt/index.ts`, and focused Session tests | Extend the canonical callback record with an optional exact reply-parent anchor; production prompt and queued-wake paths always supply it, and the public prompt namespace exposes exact current-owner capture. |
| `SessionPromptState.flushCallbacks` | reply/summary closure in `session/loop.ts` and focused tests | Resolve reply callbacks only when the assistant `parentID` matches their anchored user message; summary callbacks keep their summary result mode. |
| `SessionPrompt.loop` | Agent runner, Orchestrator, task queue, prompt runtime, Session wake, focused tests | `prompt/run.ts` supplies the freshly persisted user message ID; task-queue `session_wake` supplies its stored `messageID`; Session wake supplies its injected message ID. Runtime-owned direct continuation calls retain their existing active-Turn contract. |
| `enqueuePromptAfterPersistingUserMessage` | public `/:sessionID/prompt_async` route | Preserve the atomic visible-user-message plus queue-row write; use the already persisted `session_wake.messageID` as the queue occurrence anchor. |
| `executeSessionWake` | task queue only | Accept and forward the stored wake message ID instead of discarding it. |
| assistant reply parent | `session/loop.ts:processTurn` | Preserve `assistant.parentID = lastUser.id`; use this durable relation as the reply authority. |

### Independent Agent feedback

The explicitly requested one-level, read-only Agent independently confirmed the
production causal chain and the success-versus-cleanup lifecycle split. It also
found a deeper race omitted by the first proposal: the visible user message can
wake a standby owner before the queue executor attaches its callback. Because
current callbacks mean "next reply" rather than "reply to this user message",
an already completed Turn can leave a later queue attachment waiting forever.

The review therefore requires one message-anchored reply contract: register the
anchored callback, then reread the same durable parent relation. A reply found
during that reread resolves the registered callback; a later loop flush resolves
the same callback. This is one authority with race-safe observation, not a
fallback or a second result source.

## Causal repair

1. Extend prompt reply callbacks with the exact source user message ID.
2. Capture the active owner atomically while attaching the callback, including
   attachment to an existing standby owner.
3. After callback registration, reread the durable transcript for a completed,
   non-summary, non-tool-call assistant whose `parentID` equals the source user
   message ID; feed that message through the same callback resolver.
4. Pass the persisted user message ID from ordinary prompt execution and the
   stored `session_wake.messageID` from async queue execution.
5. Mark a queue occurrence completed immediately after its anchored result
   resolves. Wait for owner finish only when execution rejects.
6. Keep exact-owner cancellation in explicit failure and inactivity recovery;
   those paths still settle the owner before another same-Session row runs.

Independent review then challenged five additional races. The completed repair
also distinguishes a newly created observer owner from an already active owner:
only the new observer may replay a persisted failed assistant reply, after which
it is immediately released and the queue boundary maps the reply to a typed
failure. An active owner ignores recoverable intermediate errors such as context
overflow and continues to its real final reply. Owner capture is latest-owner
wins, captures cancelled owners before rejecting attachment, and immediately
applies an occurrence cancellation that arrived before a new owner existed.
Setup failures reject the exact attached callback and release any owner created
by that setup.

## Verification plan

- Focused positive scheduler contracts for:
  - a completed queue occurrence whose owner remains available for standby;
  - an async wake whose matching reply is persisted before queue attachment;
  - two same-Session occurrences preserving destructive owner-settlement
    ordering.
- Focused prompt-state contracts for exact parent-anchored callback resolution
  and existing-owner capture.
- `bun test --timeout 0 packages/opencorvus/test/scheduler/task-queue-service.test.ts`
- focused prompt-state test command after removal or conversion of any touched
  legacy negative test contracts required by repository rule 28.1.
- `bun run --cwd packages/opencorvus typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- applicable document-health and product-doc single-source checks.
- `git diff --check`, exact staged-diff review, commit, hook-driven push to
  `legacy-remote/v0.0.31beta`, and post-push status verification.

## Verification result

- `66` focused scheduler, prompt-state, and runtime wake contracts passed with
  `243` assertions. These include persisted success and failure replay,
  reply-before-attach, active-owner standby reuse, cancelled-owner capture,
  claim-before-attach cancellation, old-owner-to-execution-owner replacement,
  cancellation before owner creation, setup-failure release, context-overflow
  recovery, timeout cleanup, and same-Session successor ordering.
- Package TypeScript checking passed with the repository compiler and an
  explicit 8192-megabyte Node.js heap. The default package command first
  exhausted the process's approximately 4-gigabyte heap; a later bounded
  invocation also reached its command deadline without diagnostics, so neither
  was counted as a pass.
- Historical links, document health, and product-document single-source checks
  passed: `70` tests and `1180` assertions.
- `git diff --check` passed.
- The user-requested independent Agent performed three escalating read-only
  reviews. Its final review found no remaining actionable correctness issue
  after the persisted-error, context-overflow, owner-replacement, setup cleanup,
  exact replay, and post-cancellation owner-creation races were closed.
- A separate Claude Code read-only review attempt failed authentication with
  HTTP 403 before reading the diff and was explicitly excluded from review
  evidence.
