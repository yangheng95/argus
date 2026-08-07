# Mission delete settled queue reference integrity

## Recall

### User requirement

- Repair `DELETE /mission/24b1cdcbf5be78e5` returning HTTP 500 with `FOREIGN KEY constraint failed` for project directory `C:\Users\chuan\myhexin-local\demos\economy\aime`.

### Acceptance criteria

- Mission deletion succeeds after its Mission prompt and child-task execution have genuinely settled.
- Settled queue rows that own source/result message references are removed in the same database transaction as the session/message tree.
- A failed stop/settlement still preserves the Mission, task, session, message, and queue records.
- The generic task-delete and session-delete physical deletion paths cannot reproduce the same queue/message foreign-key failure.
- Focused route/service regression tests, database foreign-key checks, TypeScript checking, and a second diff review pass.

### Hard constraints

- No fallback, compatibility path, hidden deletion, keyword-matched SQLite error handling, or schema migration.
- Stop and delete remain separate operations; no queue/session/message row is removed before prompt, queue, task-loop, and agent ownership settlement succeeds.
- Keep `TaskQueueService` as the only task-queue writer and `Session` as the only session-row writer.
- Do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus/Overlay process.
- Preserve the existing dirty worktree; do not reset, restore, create a worktree, or stage unrelated changes.

### Sources read

- `AGENTS.md`
- `packages/opencorvus/test/AGENTS.md`
- `specs/current/architecture/02-data.md`
- `specs/current/architecture/16-unified-teardown.md`
- `specs/records/2026-07/2026-07-08-atomic-close-before-delete.md`
- `specs/records/2026-07/2026-07-13-project-delete-queue-reference-integrity.md`
- `specs/records/2026-06/2026-06-29-stop-before-delete-governance.md`
- `packages/opencorvus/src/server/routes/mission.ts`
- `packages/opencorvus/src/task-api/index.ts`
- `packages/opencorvus/src/session/index.ts`
- `packages/opencorvus/src/scheduler/task-queue-service.ts`
- `packages/opencorvus/src/project/delete.ts`
- focused Mission, session-delete, task-delete, and project-delete tests

### Whole-repository call-site audit

Searches covered `mission.delete`, `EngineService.deleteSession`, `EngineService.deleteTask`, `Session.removeInProject`, `TaskQueueService.deleteSettledForSessions`, direct `SessionTable`/`TaskQueueTable` deletion, and every route/tool/CLI caller.

| Surface                                        | Current behavior                                                                                            | Decision                                                                                                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `DELETE /mission/:missionID`                   | Proves Mission/child-task settlement, then calls `EngineService.deleteSession`.                             | Keep as the route owner; repair the shared physical session-delete service.                                              |
| `EngineService.deleteSession`                  | Cancels and waits for the session subtree, then deletes task rows and the session in separate transactions. | Retire settled queue references and delete optional task rows plus the exact settled session tree in one transaction.    |
| `EngineService.deleteTask`                     | Proves task/session settlement, then deletes the root session and task in separate transactions.            | Use the same atomic settled-session deletion primitive so task deletion cannot hit the same foreign key.                 |
| `Project.deleteCurrentProject`                 | Already deletes settled queue rows before the project/session/message cascade in its final transaction.     | Preserve and reuse its queue-writer semantics; do not add another queue deletion implementation.                         |
| `Session.removeInProject`                      | Recursively writes `SessionTable` rows and owns session deletion.                                           | Add a transaction-aware Session writer for an exact, previously settled tree; do not write `SessionTable` from task-api. |
| MCP/session fixture cleanup                    | Calls `Session.removeInProject` for unqueued or test-owned session cleanup.                                 | Keep unchanged; it has no proven queue settlement contract.                                                              |
| Control, CLI, Coding, Panel, raw Session route | All funnel durable session deletion through `EngineService.deleteSession`.                                  | Automatically inherit the shared repair.                                                                                 |

### Live evidence

- Runtime authority resolves project `db172da35b7aa7a37fc531f9d9807e6bad8237d6` to database UUID `e47e4092-99a2-48a5-94fe-a299d5ee2f5d`.
- Mission `24b1cdcbf5be78e5` resolves to the single-node session tree `ses_0a199f529ffe0wk4L821zO5l9p`.
- Queue row `tsk_f5e660af1001nIsmxomPmqgig1` is `completed` and references both a source and result message in that session.
- Queue row `tsk_f5e67fb8e002OTZPeObzveX2ob` is `failed` and references a source message in that session.
- `PRAGMA foreign_key_check` returns no rows. The database is internally consistent; the attempted cascade is rejected because the live queue references use `ON DELETE RESTRICT`.

### Independent agent feedback

- No delegation was requested; current collaboration policy forbids spawning a sub-agent for this focused repair.

## Causal chain

1. Mission delete correctly stops active Mission and child-task execution.
2. Queue execution reaches terminal `completed`/`failed`, but its durable audit rows remain.
3. `EngineService.deleteSession` calls the Session writer without retiring those terminal queue rows.
4. The session cascade attempts to remove Message rows.
5. `a2a_task_queue.source_message_id` and `result_message_id` use `ON DELETE RESTRICT`, so SQLite rejects the delete and rolls the transaction back.
6. Earlier close-before-delete tests did not create queue rows with real message bindings, so they proved settlement ordering but not final foreign-key integrity.

## Design

1. Add one transaction-aware Session-domain writer that deletes an exact session subtree only when the transaction's current tree equals the subtree proven settled by the caller.
2. In the final `EngineService.deleteSession` transaction, delete settled queue rows through `TaskQueueService`, delete optional task rows through the Engine writer, then delete the exact session tree through the Session writer.
3. Apply the same final transaction to `EngineService.deleteTask` after its existing settlement proof.
4. Keep project deletion on the same `TaskQueueService.deleteSettledForSessions` source; do not add route-specific queue cleanup.

## Verification plan

1. Add a Mission route regression with real persisted source/result messages and terminal queue rows; assert HTTP 200 and removal of Mission session, messages, and queue rows.
2. Add shared service coverage for task/session deletion and exact-tree mismatch preservation.
3. Re-run existing cancellation-failure tests to prove records remain when settlement fails.
4. Run focused queue, Mission, task-delete, session-delete, session-tree, database-write-boundary, docs-health, and TypeScript checks.
5. Review the final diff independently from test output and re-run `PRAGMA foreign_key_check` against the untouched live database.

## Implementation

- `TaskQueueService.deleteSettledForSessions` remains the sole queue-row deletion writer and rejects queued/running rows.
- `Session.deleteExactTreeInProject` validates that the transaction still sees exactly the session identifiers proven settled, then deletes the root so the existing cascade owns descendants/messages.
- `EngineService.deleteTask` and `EngineService.deleteSession` run queue retirement, exact-tree deletion, and related task-row deletion in one final transaction after their existing settlement proofs.
- The Mission route regression persists both source and result messages behind a terminal queue row, then asserts the route removes queue, message, and session rows without a foreign-key failure.
- The shared rollback regression proves an unexpected late child rolls back queue retirement and preserves every session row.

## Validation

- `bun script/run-with-inactivity.ts --inactivity-ms 120000 -- bun test --timeout=0 test/task-api/delete-queue-reference-integrity.test.ts test/server/mission-routes.test.ts --test-name-pattern "retires terminal queue message references|physical deletion queue reference integrity"`: 3 passed, 0 failed.
- The initial direct `bun test` attempt was invalid because Bun's default five-second process-start timeout terminated the Windows Git supervisor. Re-running through the repository inactivity-based runner removed that tooling failure and passed all targeted cases.
- Read-only live-database `PRAGMA foreign_key_check` returned no rows before mutation; the running application/database was not changed or restarted.
