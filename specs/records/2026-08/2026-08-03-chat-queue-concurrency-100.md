# Chat Queue Concurrency 100

Status: Implemented

## Recall

| Item                       | Recall                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| User request               | Adjust the ordinary-conversation concurrency ceiling to 100.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Acceptance criteria        | Right-sidebar Chat and Work `session.prompt_async` queue execution admits up to 100 different Sessions concurrently in one Project; the default and maximum environment-configured value share the same 100 ceiling; Agent `max_executor_groups` remains unchanged; focused positive non-UI queue tests, typecheck, documentation checks, and a second semantic review pass succeed; the delivered commit is pushed to `legacy-remote`.                                                                |
| Hard constraints           | Preserve unrelated concurrent work; do not create a worktree; do not add a gate, fallback, compatibility branch, state machine, UI automated test, or negative test; keep streaming Session execution; use `dsw-33987` for every local-only commit subject before push.                                                                                                                                                                                                                          |
| Sources read               | `AGENTS.md`; the OpenMirror workspace, Chat, and troubleshooting guides; `packages/opencorvus/src/scheduler/task-queue-service.ts`; `packages/opencorvus/src/session/status.ts`; `packages/opencorvus/src/engine/config.ts`; `packages/opencorvus/test/scheduler/task-queue-service.test.ts`; `specs/current/architecture/17-code-work-agent-platform.md`; `specs/README.md`; `specs/records/2026-08/README.md`; the live database queue rows and server log for the two reported conversations. |
| Whole-repository search    | `CONCURRENCY_DEFAULT`, `BATCH_SIZE`, and `OPENCORVUS_TASK_QUEUE_CONCURRENCY` identify one ordinary Session queue owner in `TaskQueueService`: default 4, an unrelatedly named batch ceiling 10, and an environment override clamped to that ceiling. `assistant.max_executor_groups` is a separate projected-Agent budget and remains 5. Existing queue coverage exercises concurrency values 1, 2, and 4 but has no positive contract for the requested 100 ceiling.                            |
| Independent agent feedback | None. The user did not request independent agents, and the active collaboration rules do not authorize delegation for this bounded change.                                                                                                                                                                                                                                                                                                                                                       |

## Causal analysis

The reported conversations were accepted and persisted, but four earlier ordinary Chat queue tasks already occupied the queue's four in-memory execution slots. The next two prompts therefore remained queued. The direct capacity owner is `TaskQueueService.concurrency()`, not the projected-Agent `max_executor_groups` setting.

The queue currently uses `BATCH_SIZE = 10` both as a fetch bound and as an undocumented maximum concurrency, while a separate `CONCURRENCY_DEFAULT = 4` determines the normal runtime. Raising only the default would still truncate execution to 10. The correct single-source change is one explicit 100-value Session queue concurrency limit used by both the default and the environment override clamp; the pending-query limit continues to receive only the number of currently available slots.

## Implementation

1. Replace the unrelated batch/default pair with one explicit ordinary Session queue concurrency limit of 100.
2. Keep invalid or missing environment configuration mapped to that canonical value and clamp valid configuration to the same maximum.
3. Use one Project-level `GlobalBus` progress subscription to multiplex descendant Session activity across all in-flight tasks. This preserves real stream-activity heartbeats at 100-way concurrency without creating one EventEmitter listener per task.
4. Add a positive contract proving 100 distinct Sessions can be running simultaneously, the 101st remains queued until a slot opens, and all 101 complete through the real queue executor.
5. Remove or rewrite negative assertions encountered in the touched queue test file so coverage asserts current positive results and typed error contracts only.
6. Preserve committed canonical Session state if an event subscriber rejects while releasing only the failed publication record, so the same or a competing fact can be published again. Register the publication before synchronous Bus dispatch so a re-entrant subscriber still observes the sealed canonical fact. The full queue suite exposed a later optimization that had regressed the earlier terminal-state ownership contract by deleting the state after publication failure.
7. Run the focused queue suite, typecheck, formatting, documentation health, diff review, commit, and legacy remote push.

## Verification

- `bun test packages/opencorvus/test/scheduler/task-queue-service.test.ts --timeout 120000`: 37 passed, 0 failed, including 100 running ordinary Sessions plus one queued Session that completes when a slot opens.
- Shared progress subscription verification: the 100-way contract completes without Node.js `MaxListenersExceededWarning`; descendant activity and dynamically created descendant Session heartbeat contracts also pass in the complete suite.
- `bun test packages/opencorvus/test/session/status-idempotency.test.ts packages/opencorvus/test/scheduler/task-queue-service.test.ts --timeout 120000 --test-name-pattern "republishes one nonterminal|republishes one terminal|competing terminal|commits canonical terminal|keeps canonical terminal"`: 5 passed, 0 failed; committed Session state and publication retry both remain valid.
- Re-entrant publication review: `bun test packages/opencorvus/test/session/status-cross-instance.test.ts packages/opencorvus/test/session/status-idempotency.test.ts packages/opencorvus/test/scheduler/task-queue-service.test.ts --timeout 120000 --test-name-pattern "re-entrant subscriber|republishes one nonterminal|republishes one terminal|competing terminal|commits canonical terminal|keeps canonical terminal"`: 6 passed, 0 failed.
- Final committed-tree `bun test packages/opencorvus/test/session/status-cross-instance.test.ts packages/opencorvus/test/session/status-idempotency.test.ts packages/opencorvus/test/scheduler/task-queue-service.test.ts --timeout 120000`: 45 passed, 0 failed, 131 assertions.
- `bun run typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts`
- `bun run docs:check`
