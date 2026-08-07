# Large MySQL transfer statement closure

## Recall

### User requirement

- Back up the database that cannot open under the newly compiled OpenCorvus package.
- Export the old data and import it into a current database so the new package opens with the historical data present.
- Continue after the fresh empty database proved that startup alone did not satisfy the data-restoration requirement.

### Acceptance criteria

- Preserve the original database and the unmodified MySQL transfer export before any destructive action.
- Recover each pre-contract immutable `dispatch_lineage.adapter_input` only from its exact persisted `dispatch_agent` Tool input or from its closed continuation-source chain; do not guess values.
- Make the recovered snapshot pass the current strict transfer preflight, current dispatch-lineage parser, foreign-key validation, and current DDL import.
- Make a large official MySQL transfer import close every owned SQLite statement before checkpoint and database close.
- Keep the current empty active database recoverable until an isolated restored database has passed integrity and application-startup checks.
- Add positive non-User Interface regression coverage, run focused verification, review, commit with the required `dsw-33987` prefix, and push to the `myhexin` git-cc remote.

### Hard constraints

- `SCHEMA_DDL` remains the only physical database schema source; do not add a migration, compatibility reader, fallback, schema patch, or second runtime database path.
- Do not rewrite the original database or its immutable Artifact rows. Recovery operates on the explicit transfer artifact authorized by the user and retains a row-level evidence audit.
- Do not bypass foreign-key checks, current payload validation, catalog digests, WAL checkpointing, hooks, or the official import contract.
- UI automation is out of scope and must not be added, modified, or run.
- Preserve unrelated repository and user files.

### Sources read

- `AGENTS.md`, especially rules 1, 3.1, 6.1, 7, 8, 18, 23.1, 28, 28.1, 32, and 33.
- `specs/current/architecture/02-data.md`.
- `specs/records/2026-08/2026-08-03-current-schema-fresh-database-baseline.md`.
- `specs/records/2026-08/2026-08-05-task-hydration-payload-contract-and-debug-copy-repair.md`.
- `packages/opencorvus/src/storage/db.ts`, `storage/mysql-transfer.ts`, `engine/dispatch-lineage.ts`, `engine/artifact-catalog-metadata.ts`, and the historical `dispatch-agent-tool.ts` implementation that created the affected rows.
- `packages/opencorvus/test/storage/mysql-transfer.test.ts` and the existing SQLite lifecycle tests.

### Whole-repository search evidence

- The old database contains 152 `dispatch_lineage` rows; all 152 lack `adapter_input` and all 152 retain the exact referenced Tool Part.
- Of those rows, 105 are initial dispatches whose adapter input is the persisted parsed dispatch object after removing the historical common dispatch fields.
- The remaining 47 rows are continuations; every continuation source identity resolves inside the same Task, no continuation cycle or coordination-action lineage exists, and worker identity, work scope, workflow binding, node, occurrence, Delivery Slice revisions, and child Session all match their source.
- The evidence-recovered transfer snapshot passes `preflightMysqlTransferSnapshot`, including current payload/catalog metadata, current DDL insertion, and foreign-key validation.
- Both direct `applyMysqlTransferPlan` and the real `/global/db/mysql/import` route reproduce `database is locked` only when closing the restored multi-page database.
- `Database.rebuildSqlite` and MySQL transfer validation each executed `PRAGMA foreign_key_check` through an unfinalized raw statement even though `db.ts` already contained the correct finalized-query ownership pattern.

### Independent agent feedback

No sub-agent was commissioned because the user did not request delegation. The primary agent owns the evidence mapping, implementation, validation, and final review.

## Causal chain

1. The current DDL correctly rejects the old database because its immutable dispatch-lineage payload contract predates `adapter_input`.
2. Exact persisted Tool Parts and continuation identities make the affected payload authority recoverable into a new transfer artifact without mutating the original database.
3. The recovered artifact passes current semantic and relational preflight, but importing its multi-page payload leaves the raw `PRAGMA foreign_key_check` statement alive.
4. `Database.rebuildSqlite` then reaches `PRAGMA wal_checkpoint(TRUNCATE)` while that statement still owns a read cursor, so SQLite returns `database is locked` and the official import fails after data insertion.
5. Small transfer tests do not reliably retain the statement long enough to expose this lifecycle error; a multi-page positive round trip does.

## Implementation plan

1. Promote the existing finalized SQLite query helper to the shared storage surface and use it for both rebuild-level and transfer-level foreign-key checks.
2. Add a positive multi-page MySQL transfer round trip that verifies successful import, exact Project row count, and a closed database connection.
3. Re-run the recovered 35,120-row snapshot through an isolated official import, verify all tables, dispatch-lineage rows, foreign keys, integrity, and current triggers, then start a current isolated server against it.
4. Stop the current empty client only after isolated acceptance, preserve its database, install the validated restored database through the explicit import path, and restart the `0.0.32-beta` client.
5. Run focused tests, typecheck, documentation health checks, review the diff, commit, and push to git-cc.

## Validation record

- The original database remains byte-for-byte preserved at `%LOCALAPPDATA%/opencorvus/data/maintenance-backups/schema-reset-20260805-195414/opencorvus.db`; its SHA-256 (Secure Hash Algorithm 256-bit) digest is `1A80C233FDE0E431ABC6475D6BEB9A47C81D4DB360A17991FB046B0FBE168B1C`.
- The unmodified export remains at `mysql-transfer-export.json` with 40 tables, 35,120 rows, and SHA-256 digest `4F0B06A498C7FD979528F954B9C16B8430C4A663A0173C7A458129CC3402490F`.
- `mysql-transfer-recovered.json` and `dispatch-lineage-recovery-audit.json` retain the evidence-recovered transfer plus every row-level source identity and original/recovered digest. The current transfer preflight and all 152 current dispatch-lineage payload parses pass.
- An isolated import at `recovered-import-runtime-v2/data/opencorvus.db` completed with 40 tables and 35,120 rows. SQLite reported `integrity_check=ok`, zero foreign-key violations, and both current dispatch-lineage triggers.
- Before replacing the active empty database, its DB (Database), WAL (Write-Ahead Log), and SHM (Shared Memory) files were copied to `pre-restore-empty-0.0.32-20260805-202828`. The failed oversized HTTP (Hypertext Transfer Protocol) request scene was separately copied to `failed-http-import-20260805-204045`; neither scene is used as the restored authority.
- The explicit current import function rebuilt the active database from the recovered snapshot and returned `ok=true` for all 40 tables. A separate read-only connection then reported 144 Projects, 34 Tasks, 244 Sessions, 4,726 Messages, 26,035 Parts, 520 Artifacts, `integrity_check=ok`, zero foreign-key violations, 152 parseable dispatch-lineage rows, and both required triggers.
- `bun test packages/opencorvus/test/storage/mysql-transfer.test.ts` passes 6 tests with 81 expectations, including the positive multi-page regression.
- The documentation suite passes 69 of 70 tests after replacing the two private lockfile URLs; its remaining failure names only record files from concurrent uncommitted work plus this record until the files are staged. Full package typecheck is currently blocked by a concurrent edit in `src/plugin/openai/codex.ts`; the reported error is outside this change set and must not be hidden by modifying or staging that user's work.
- The sidecar embedded by the packaged `0.0.32-beta` client starts against the restored active database, reports healthy, returns all 34 Tasks, and hydrates the recovered Task `tsk_fd0edda4a001JBp9VdEG1wMlHE` with HTTP 200 and a 1,621,397-byte conversation payload. The verification sidecar was then shut down through its normal `/shutdown` route.
- After the concurrent isolated visual-acceptance runtimes released the database lease, their orphaned debug Overlay was stopped by its exact verified executable identity. The visible `0.0.32-beta` packaged client then started on port 7878 against the restored active database, reported healthy, returned all 34 Tasks, and hydrated the same recovered conversation with HTTP 200 and a 1,621,397-byte payload. The packaged client remains open for the operator.
