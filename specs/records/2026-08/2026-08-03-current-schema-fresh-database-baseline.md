# Current-schema fresh database baseline

## Recall

### User requirement

- Systematically remove database patching.
- Make the current `0.0.28-beta` schema the only database baseline.
- Keep future schema changes migration-free: a changed schema requires an
  explicit rebuild rather than a compatibility reader or row-copy migration.
- Update the root `AGENTS.md` so future work follows the same database policy.
- Do not open, migrate, delete, reset, or otherwise mutate the current on-disk
  database instance during this task.

### Acceptance criteria

- An empty database is created directly from the current `SCHEMA_DDL`.
- A non-empty database whose table, column, index, trigger, and virtual-table
  contract exactly matches the current DDL remains readable and writable
  without rebuild.
- Any non-empty schema drift fails closed as typed
  `DatabaseUnavailableError(code="SCHEMA_RESET_REQUIRED")`.
- Drift detection does not rename, delete, recreate, restore, or partially
  mutate the database, WAL (Write-Ahead Log), or SHM (Shared Memory) files.
- The generic current-table/current-column restore algorithm, special restore
  ordering, refresh backup metadata, health projection, Overlay diagnostic, and
  stale tests are removed.
- The explicit destructive maintenance command remains available but is not
  invoked in this task.
- All verification uses in-memory or task-created temporary databases.

### Hard constraints

- No migration framework, migration scripts, compatibility reader, fallback,
  dual schema, automatic reset, or automatic backup-and-rebuild path.
- `SCHEMA_DDL`, generated from the Drizzle declarations plus storage-extension
  DDL, remains the single schema definition.
- Preserve every unrelated dirty-worktree change.
- Do not start or restart the user's OpenCorvus process.
- Do not run UI automation tests. The removed Overlay diagnostic has no
  remaining renderer or interaction surface; its obsolete non-rendering unit
  test is deleted with the retired behavior.
- Commit subjects start with `dsw-33987` and the completed change is pushed to
  `myhexin/v0.0.28beta`.

### Sources read

- `AGENTS.md`
- `packages/opencorvus/src/storage/db.ts`
- `packages/opencorvus/src/storage/ddl.ts`
- `packages/opencorvus/src/storage/database.sql.ts`
- `packages/opencorvus/src/storage/mysql-transfer.ts`
- `packages/opencorvus/src/cli/cmd/db.ts`
- `packages/opencorvus/src/server/routes/global.ts`
- `packages/overlay/src/services/connection.ts`
- `packages/overlay/src/i18n/en-US.json`
- `packages/overlay/src/i18n/zh-CN.json`
- `packages/opencorvus/test/storage/db-path.test.ts`
- `packages/opencorvus/test/server/directory-required.test.ts`
- `packages/overlay/test/database-schema-refresh-diagnostic.test.ts`
- `specs/current/architecture/02-data.md`
- `specs/current/architecture/16-unified-teardown.md`
- July 2026 schema-refresh, health, runtime-isolation, and reset-retirement
  records.

### Whole-repository search evidence

The pre-change repository searches enumerated:

- `findSchemaDrift`, `ensureCurrentSchema`, `refreshSchemaDatabase`,
  `restoreCurrentSchemaData`, `databaseSchemaBackupPath`,
  `rotateDatabaseSchemaFiles`, `LOSSLESS_SCHEMA_REFRESH_COLUMN_GROUPS`,
  `Database.schemaRefresh`, `SCHEMA_REFRESH_REQUIRED`, and all direct tests;
- `/global/health`'s `databaseSchemaRefresh` response, generated OpenAPI,
  generated Software Development Kit (SDK) types, public API docs, Overlay
  health consumer, diagnostic translations, and diagnostic tests;
- every current `no migration`, `reset DB`, and schema-refresh architecture
  statement;
- the internal `Database.resetFiles`, `Database.reset`, CLI reset command, and
  their isolated tests.

The generic refresh implementation has one production entry:
`Database.Client()` calls `refreshSchemaDatabase` after `findSchemaDrift`.
Health and Overlay are downstream observations of its success metadata, not
independent migration owners. The internal reset primitives are explicit
maintenance operations and remain outside the automatic open path.

### Independent agent feedback

No sub-agent was commissioned because the user did not request delegation.
The primary agent owns implementation and the required second review.

## Root cause

The current open path treats any structural mismatch as permission to invent a
generic data transformation: it rotates the old file, creates the latest DDL,
copies every shared table/column, adds DDL defaults for missing columns, then
repairs selected derived structures. That is an implicit migration engine even
though project policy says the unpublished database is rebuilt instead of
migrated. Domain-specific exception lists and restore ordering prove that
physical column overlap cannot establish semantic compatibility.

The same implicit behavior is projected as a successful health event and
Overlay diagnostic, so deleting only the row-copy loop would leave a false
product contract.

## Call-point disposition

| Call point | Disposition |
| --- | --- |
| `storage/db.ts::findSchemaDrift` | Keep as the current DDL comparison owner and extend it to indexes and exact table SQL where required. |
| `storage/db.ts::createCurrentSchema` | Keep for transactional fresh creation and exact post-create validation. |
| `storage/db.ts::refreshSchemaDatabase` and restore helpers | Delete completely. |
| `storage/db.ts::Database.Client` | Empty DB: create current DDL. Non-empty exact DB: open unchanged. Drift: throw typed `SCHEMA_RESET_REQUIRED` without file mutation. |
| `storage/db.ts::Database.schemaRefresh` | Delete. |
| `server/routes/global.ts` | Remove `databaseSchemaRefresh`; retain durable `databaseUnavailable` health projection and database paths. |
| `overlay/services/connection.ts` | Remove refresh parsing/logging; retain unavailable-database handling. |
| Overlay locale keys | Delete the retired refresh diagnostic strings. |
| Generated OpenAPI, SDK, API reference | Regenerate from the reduced health contract. |
| Storage tests | Delete restore-success/ordering/failure tests; add positive contracts for fresh DDL, exact-schema reopen, and typed drift rejection with unchanged data/files. |
| Server health tests | Replace refresh-success projection with the surviving exact health contract. |
| Overlay refresh diagnostic test | Delete with the retired behavior; do not replace it with a UI or absence test. |
| `Database.resetFiles`, `Database.reset`, CLI `db reset --force` | Preserve; do not invoke against the hard-disk database. |
| `AGENTS.md` rule 18 | Specify current-schema rebuild, explicit operator authorization, no automatic mutation, and isolated verification. |
| Current architecture | Replace lossless-refresh wording with fresh-or-exact-open and typed reset-required semantics. |

## Verification plan

- Focused storage tests use only unique `OPENCORVUS_HOME` temporary
  directories.
- Fresh database creation proves the complete current DDL.
- Exact-schema reopen proves rows and `database_authority.instance_id` remain
  stable.
- Missing table, altered column, missing index, and changed trigger fixtures
  each produce typed `SCHEMA_RESET_REQUIRED`; the original rows and file path
  remain readable and no schema-backup/current replacement appears.
- Cancellation causal-integrity validation remains a separate typed
  `DATA_INTEGRITY_RESET_REQUIRED` contract.
- Run focused server health and route-generation checks, OpenCorvus/Overlay
  typechecks, i18n check, documentation health checks, and `git diff --check`.
- Do not resolve `Database.Path()` under the ordinary user environment, start
  the product, or run the reset command.

## Implementation and verification

The automatic refresh, backup rotation, shared-column restore, health success
metadata, Overlay success diagnostic, locale strings, and obsolete diagnostic
test were removed. Schema comparison now derives an exact catalog from the
current DDL and checks every application-owned SQLite schema object before
runtime configuration or business reads. Fresh creation runs in one immediate
transaction and validates the resulting catalog before commit.

Verification completed without opening or resetting the ordinary hard-disk
database:

- 62 focused storage and server tests passed with 236 assertions.
- 70 documentation health tests passed with 1,188 assertions.
- OpenCorvus and Overlay TypeScript typechecks passed.
- Overlay localization, API route inventory, generated API documentation, and
  staged-diff whitespace checks passed.
