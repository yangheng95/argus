# Session Background Execution Ownership Repair

Status: complete

## Recall

### User request

- Investigate why sending a message to OpenCorvus can produce no reply.
- Determine whether Mission and Task have the same problem.
- Remove the complete class of hazards instead of applying one symptom-level patch.

### Acceptance criteria

1. A `POST /session/:sessionID/prompt_async` request may return and close its request-scoped `Instance` lease without invalidating the queued execution that it started.
2. The queue owns every asynchronous drain, inactivity-recovery timer callback, completion publication, and terminal-error publication through one explicit project-scoped background lifetime.
3. Successful execution persists exactly one user turn and produces the expected assistant/session events; failed execution persists a failed queue row and a visible terminal assistant error instead of becoming silent.
4. Mission follow-up messages and right-sidebar assistant messages, which share `prompt_async`, are covered by the same production-shaped regression. Mission initial wake and Task follow-up paths are separately audited and retain their independent owners.
5. Timeout behavior remains activity-based: a running task expires only after the configured interval with no observed activity.
6. Current protocol events include authoritative role, author, agent, channel, resolved-role, and origin metadata; a stale packaged runtime is not mistaken for a missing source repair.
7. Focused route, queue, lifecycle, protocol, documentation, and type-check verification passes; an isolated real backend chain confirms durable rows and observable events.

### Hard constraints

- Do not weaken the closed/closing lease assertion, add retry/fallback behavior, add a route bypass, or introduce a second queue/state source.
- Do not restart, stop, refresh, or otherwise interfere with the user's running OpenCorvus/Overlay process.
- Preserve unrelated dirty-worktree changes and stage only this repair.
- Use inactivity-based timeouts, not wall-clock time measured from process start.
- Every behavior change requires a regression test. New records remain under the root `specs/` single source and must pass document-health checks.
- Commit and push the finished repair to the legacy remote with a `dsw-33987` subject prefix.

### Sources read before implementation

- `AGENTS.md`
- `specs/artifacts/长程编排测试.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-11-platform-runtime-external-goal-team.md`
- `specs/records/2026-07/2026-07-14-iwc-opentest-latest-protocol-e2e.md`
- `packages/opencorvus/src/project/instance.ts`
- `packages/opencorvus/src/scheduler/task-queue-service.ts`
- `packages/opencorvus/src/server/server.ts`
- `packages/opencorvus/src/server/routes/session.ts`
- `packages/opencorvus/src/session/wake.ts`
- `packages/opencorvus/src/engine/queue.ts`
- `packages/opencorvus/src/engine/service.ts`
- `packages/opencorvus/src/executor/opencorvus.ts`
- `packages/opencorvus/src/protocol/session-mirror.ts`
- `packages/opencorvus/src/orchestrator/protocol/message-bridge.ts`
- `packages/overlay/src/services/task.ts`
- `packages/overlay/src/services/chat.ts`
- `packages/opencorvus/test/server/session-prompt-async.test.ts`
- `packages/opencorvus/test/server/session-conversation-routes.test.ts`

### Whole-repository search and call-point inventory

| Surface | Call points and disposition |
| --- | --- |
| Queue producers | `executor/opencorvus.ts` calls `enqueuePrompt` for engine tasks; `server/routes/session.ts` calls `enqueuePromptAfterPersistingUserMessage` for `prompt_async`. Both must use the same queue-owned background lifetime. `enqueueCompaction` currently has test callers but no production caller; it remains unchanged because deleting a possibly public dormant API requires separate approval. |
| Drain requests | `task-queue-service.ts` requests drains after prompt/compaction enqueue, persisted-user enqueue, claim contention, completion, failure, cancellation, and recovery. Every call must converge on one owner rather than inheriting the caller's request/session context. |
| Queue execution | `drainReadyTasks` starts promises and returns before they settle. Therefore merely wrapping that function in a fresh `Instance.provide` still closes too early; the background owner must remain alive until `drainUntilIdle` has awaited the execution promises. |
| Timers/activity | `scheduleRunningRecoveryTimer` creates asynchronous setup and a later timer callback; `touch` reschedules it from GlobalBus activity. Timer callbacks must re-enter the queue project's own lifetime rather than inherit the lease active at timer creation. |
| Error visibility | `fail` persisted the failed row, then `clearRecoveryTimer` accessed a closed lease and prevented `publishTerminalTaskError`. Failure persistence and terminal publication must settle inside the valid queue owner. |
| Mission | Initial `/mission/wake` is already detached through `Database.runOutsideContext`, `runOutsideInstanceContext`, and a fresh `Instance.provide`. Open Mission follow-ups use the session `prompt_async` route and share the proven defect. |
| Task | Task panel/chat follow-ups use `panel/message/stream` or `/task/:taskID/message`, then awaited `EngineService` dispatch. They do not use the defective route, but internal engine agent prompts enqueue through the same task queue and therefore benefit from the ownership repair. |
| Assistant | Right-sidebar assistant submission uses `/session/:sessionID/prompt_async` and directly shares the proven defect. |
| Protocol metadata | Current `session-mirror.ts` and `message-bridge.ts` enrich message and part events with agent/role/author/channel/resolved-role/origin fields. Existing route tests assert this. Runtime logs came from an older packaged process and require verification, not a duplicate implementation. |
| Existing detached owners | `session/wake.ts`, `session/status-publication.ts`, and `engine/queue.ts` already establish explicit out-of-context owners. They are comparison evidence and are not replaced by a second lifecycle mechanism. |

### Independent agent feedback

No sub-agent was created because the user did not request delegation and the active collaboration instruction forbids implicit spawning. The evidence chronology, call inventory, implementation, and secondary review remain the primary agent's responsibility.

## Evidence chronology

1. Runtime health identified the durable database at `C:\Users\chuan\.local\share\opencorvus\opencorvus.db`.
2. Affected sessions contain the persisted user message and a queue task but no assistant turn, tool call, worker descriptor, or protocol completion.
3. Logs show `prompt_async` returned `202`, after which the request-scoped cache lease entered closing state.
4. The detached queue drain then failed first while scheduling inactivity recovery and again while providing the session wake: `Cannot access instance context through a closing instance cache lease` / `Cannot provide an instance through a closed instance cache lease`.
5. The failure handler persisted the failed queue status but threw while clearing its recovery timer, before it could publish the terminal assistant error. This explains both the missing reply and the missing visible failure.
6. A recent Mission initial wake persisted assistant/tool-call messages, establishing that the exact defect is the session queue owner rather than every Mission dispatch. Task follow-ups use a different awaited route, while engine task agents still share the queue.

## Benchmark contract

- Input: production-shaped HTTP requests whose middleware-owned request lease closes immediately after `202`, plus deterministic successful and failing loop implementations.
- Output: terminal queue state, exact transcript cardinality, visible assistant success/error event, and no process-level unhandled error.
- Environment: isolated temporary project/database and server app; no interaction with the running user process.
- Timeout: polling is tied to observable queue/session activity and fails only after an inactivity interval, not a fixed duration from process launch.
- Success threshold: all focused regressions and verification commands pass with zero silent terminal path.

## Implementation and verification log

### Implemented ownership model

- Added `runWithIndependentProjectIdentity` as the single owner for work that intentionally outlives its caller. It removes inherited database and instance ownership, then enters only the already-initialized project identity; it does not rerun project startup.
- Changed every task-queue drain, task execution, progress callback, inactivity callback, recovery, completion publication, and terminal-error publication to settle under that queue-owned lifetime. The inactivity timer keeps its original activity-based deadline; only the short timer-configuration step retains the scheduling lease.
- Canonicalized `/session/:sessionID/prompt` and `prompt_async` identities before persistence. Fixed Mission sessions retain the runtime-contract Mission agent, ordinary assistant sessions resolve the configured primary agent, and worker sessions remain bound to their projected contract.
- Changed project SSE callbacks to bind the stream owner explicitly. Protocol, mirror, heartbeat, GlobalBus, panel, task-event, session-event, and work-ledger callbacks can no longer reuse the closed HTTP request/database effect owner.
- Replaced detached full project startup in engine task loops, loop-completion advancement, Mission wake, MCP connection startup, and agent-coordination continuation with the independent identity owner. Nested queue compaction and prompt loops now project the already-active identity instead of rerunning startup.
- Kept cross-instance protocol persistence inside its authoritative database lifecycle activity while replacing only its nested full startup with project identity projection. This preserves serialized persistence ownership instead of stripping the database owner.
- Corrected awaited terminal status publication separately: it now calls `Instance.provideProjectIdentity` directly, so same-project calls reuse the caller lease and cross-project calls acquire the target identity. A secondary A/B review proved that escaping the caller here deadlocked after the assistant reply but before terminal status.
- Repaired the projected-agent test execution lease fixture, which had passed the runner's `onSessionCreated` callback to both the execution lease and the runner. The runner is again the single observer owner, so reopening a session does not synthesize a duplicate creation notification.

### Secondary review findings

1. The first restored queue patch still contained a non-async recovery callback and had lost the common owner helper. The queue test exposed both; the implementation was corrected before any success claim.
2. A full-repository `Instance.provide`/`runOutsideInstanceContext` audit found one missed compaction call and the awaited status-publication deadlock. Remaining full providers are awaited CLI, request/bootstrap, configuration, worktree, or explicit foreground boundaries rather than detached work.
3. The runner continuation regression originally hung. Instrumented A/B execution showed prompt completion followed by a stop exactly at terminal status publication under both the old full-provider escape and the first independent-owner version. Direct identity projection removed the deadlock; the next assertion then exposed and led to repair of the test fixture's duplicate observer ownership.
4. A concurrent workspace task merged another branch and switched the shared worktree from `v0.0.5beta` to `v0.0.6beta` during verification. No reset, worktree creation, process restart, or unrelated staging was used; mixed files were staged by exact hunk.

### Verification evidence

- `bun test packages/opencorvus/test/scheduler/task-queue-service.test.ts --timeout 20000`: 33 passed.
- `bun test packages/opencorvus/test/server/session-prompt-async.test.ts --timeout 20000`: 12 passed, including request-lease closure success and visible terminal failure.
- `bun test packages/opencorvus/test/server/task-message-routes.test.ts packages/opencorvus/test/server/work-ledger-routes.test.ts --timeout 20000`: Task routes 26 passed; work-ledger coverage was subsequently run with the SSE/Wake group.
- `bun test packages/opencorvus/test/server/sse-abort.test.ts packages/opencorvus/test/server/work-ledger-routes.test.ts packages/opencorvus/test/session/wake.test.ts packages/opencorvus/test/mcp/status-lazy-start.test.ts --timeout 20000`: 26 passed.
- `bun test packages/opencorvus/test/protocol/message-bridge.test.ts packages/opencorvus/test/protocol/session-mirror.test.ts packages/opencorvus/test/session/dependency-boundaries.test.ts --timeout 20000`: 40 passed.
- Compaction-focused queue regression: 3 passed.
- Runner reopen/setup-failure continuation regressions: 2 passed after the status deadlock and fixture ownership repair.
- Cross-directory MirrorTest terminal lifecycle regression: 1 passed; first-turn instance lifecycle regressions: 3 passed.
- Final representative rerun: request-owned `prompt_async` 2 passed, queue background/timer 3 passed, project SSE abort 1 passed.
- `bunx tsc -p packages/opencorvus/tsconfig.json --noEmit`: passed.
- `bun run api:routes-check`: passed with 6 rules across 30 route files.
- `bun run docs:check`: passed with 255 operations in 24 groups.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts --timeout 20000`: 74 passed.

The user's running OpenCorvus/Overlay process was not stopped, restarted, refreshed, or reused for tests. The fix takes effect when that running installation is next updated/restarted by the user or its normal release lifecycle.

### Delivery

- Implementation commit: `a31fa3b133f6e62d922a843a7dee3f6b02ed84d2` (`dsw-33987 fix background message execution ownership`).
- Pushed to legacy remote branch `legacy-remote/v0.0.6beta`; `git ls-remote` returned the same commit hash.
- The successful pre-push hook ran all 10 package typechecks, API route checks, generated documentation checks, Overlay i18n validation, and the tracked-source secret scan without bypasses.
