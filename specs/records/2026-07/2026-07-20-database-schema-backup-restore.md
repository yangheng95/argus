# Database Schema Backup and Restore

## Recall

### User Request

- Replace the schema-change policy that backs up the database and rebuilds an empty database with a policy that backs up the database and restores its data into a new database instance.

### Acceptance Criteria

- Schema drift never discards rows merely because the current DDL creates a new database file.
- The old SQLite image remains an immutable, readable timestamped backup.
- The active path is a separately created database with the current DDL, populated from the backup through one strict restore path.
- Restore copies only current tables and shared columns; a required new column without a default makes restore fail visibly.
- Restore is transactional, preserves foreign-key integrity, rebuilds the derived FTS (Full-Text Search) table, and verifies the final schema.
- A restore failure publishes no success evidence and leaves the backup readable.
- Current-schema databases remain unchanged and create no backup/restore evidence.

### Hard Constraints

- Never restore the stale image wholesale because that reactivates the stale schema.
- No compatibility reader, fallback database, silent row skip, second active source, gate, or runtime restart.
- This is one schema-aware data restore into current DDL, not a persisted migration/version framework.
- Legacy-only tables remain in the backup but are not projected into the current database.
- Constraint, type, required-column, or foreign-key incompatibility aborts restore visibly.
- Preserve unrelated `C:/` worktree content and do not touch running OpenCorvus/Overlay processes.
- Commit subjects use `dsw-33987`; push the current main branch to `legacy-remote`.

### Sources Read

- `AGENTS.md`
- `specs/current/architecture/02-data.md`
- `specs/current/architecture/16-unified-teardown.md`
- `specs/records/2026-07/2026-07-16-gui-installer-matrix-and-db-schema-backup.md`
- `specs/records/2026-07/2026-07-19-cms-java-write-side-refactor-expert-squad.md`
- `packages/opencorvus/src/storage/db.ts`
- `packages/opencorvus/src/storage/ddl.ts`
- `packages/opencorvus/src/storage/mysql-transfer.ts`
- `packages/opencorvus/test/storage/db-path.test.ts`
- `packages/opencorvus/src/server/routes/global.ts`
- `packages/overlay/src/services/connection.ts`

### Whole-Repository Search Evidence

Searches: `rg "databaseSchemaRefresh|SchemaRefresh|backupPath|schema refresh"`; `rg "replaceDatabaseSchemaFiles|rotateDatabaseSchemaFiles|findSchemaDrift|ensureCurrentSchema"`; `rg "SCHEMA_DDL|memory_fts|rebuildMemoryFts"`.

| Owner / call site                             | Decision                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `storage/db.ts::Database.Client`              | Keep as the single lazy initialization caller; use strict restore into a new current-schema instance.        |
| `storage/db.ts::refreshSchemaDatabase`        | Replace empty recreation semantics; success occurs only after restore and verification.                      |
| `storage/db.ts::rotateDatabaseSchemaFiles`    | Keep atomic old-image backup rotation and companion cleanup.                                                 |
| `storage/db.ts::replaceDatabaseSchemaFiles`   | Delete/replace the misleading empty-rebuild helper; no second path remains.                                  |
| `storage/ddl.ts::SCHEMA_DDL`                  | Keep as the only new-instance schema source.                                                                 |
| `storage/mysql-transfer.ts::rebuildMemoryFts` | Reuse its canonical `memory_chunk -> memory_fts` behavior, without importing MySQL orchestration.            |
| `test/storage/db-path.test.ts`                | Replace the zero-row assertion with retained-row/current-column assertions and add restore-failure evidence. |
| `server/routes/global.ts` and tests           | Keep stable process-owned health evidence shape.                                                             |
| `overlay/services/connection.ts`, i18n, tests | Keep one notification per backup; update copy to say data was restored.                                      |
| explicit `Database.resetFiles/reset`          | Unchanged user-authorized destructive debugging operations.                                                  |

### Independent Agent Feedback

- No sub-agent was used because the user did not request delegation or parallel agents.

## Design

1. Checkpoint and close the stale connection, then atomically rename the main image to the timestamped backup.
2. Create a distinct active SQLite image and apply current `SCHEMA_DDL`.
3. Attach the immutable backup read-only. In one transaction, inspect each current ordinary table, calculate its exact shared columns, reject absent required columns without defaults, and copy its rows.
4. Exclude derived `memory_fts`, then rebuild it once from restored `memory_chunk`.
5. Run foreign-key and exact current-schema verification before commit and before publishing refresh evidence.
6. On failure, close the partial active instance, retain the backup, publish no success evidence, and surface the error. Do not reactivate the stale database automatically.

## Verification Plan

- Focused storage tests: retained rows/new columns, current-schema no-op, rename failure, DDL failure, required-column failure, foreign-key/schema verification.
- Health and Overlay notification contract tests with updated localized copy.
- OpenCorvus/Overlay typechecks, i18n, document health/historical links, and `git diff --check`.
- Exact diff review and obsolete empty-rebuild grep before commit/push.

## Implementation and Verification Evidence

- `Database.Client` now converts the checkpointed stale image from WAL (Write-Ahead Log) mode to a standalone readable backup, creates the current DDL instance, attaches the backup read-only/immutable, and restores shared table columns transactionally.
- New columns with SQLite defaults receive those defaults; missing required current columns, insert constraints, foreign-key violations, or final schema drift abort restoration. `memory_fts` is rebuilt from restored `memory_chunk` rows.
- Refresh metadata and the success log occur only after restore and verification. Failure tests prove the partial new instance has no restored rows, the backup remains readable, and no success metadata is published.
- Focused storage and connection diagnostics: 42/42 passed (`db-path` 34, connection startup 5, schema-refresh diagnostic 3).
- Repository typecheck passed for all 9 executed workspace tasks; Overlay i18n validation passed.
- Historical links passed 21/21. Document health passed 81/82; its sole failure was pre-existing concurrent untracked `2026-07-20-empty-workspace-provider-chat-control-plane.md` already linked from the July index, not this change. Once this record is staged, it is no longer an additional offender.
- The broader `directory-required.test.ts` health-route suite passed its health/schema-refresh case but has two pre-existing Task DELETE failures (HTTP 400 and invalid actor fixture) on the unchanged baseline; no database-refresh assertion failed.
