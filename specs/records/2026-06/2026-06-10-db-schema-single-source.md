# DB Schema Single Source - 2026-06-10

## Problem

The runtime currently has two independent ordinary-table schema sources:

- Drizzle table declarations in `packages/opencorvus/src/**/**.sql.ts`, re-exported by `packages/opencorvus/src/storage/schema.ts` and passed to `drizzle({ schema })`.
- Hand-written SQLite DDL in `packages/opencorvus/src/storage/ddl.ts`, executed by `Database.Client()` during startup and drift reset.

This lets columns, defaults, indexes, and foreign keys drift. `quick_note` is already a concrete symptom: it has a Drizzle table in `quicknote/quicknote.sql.ts`, but it is not exported from `storage/schema.ts`, while the hand-written DDL creates the table anyway.

## Call-Site Sweep

`rg -n 'SCHEMA_DDL|QuickNoteTable|quick_note|storage/schema|Database\.Path|Database\.reset|global/db/reset|db reset|drizzle-kit|sqliteTable\(' packages\opencorvus script packages\overlay specs -S`

- `packages/opencorvus/src/storage/db.ts` imports `SCHEMA_DDL` for startup apply and drift rebuild.
- `packages/opencorvus/test/storage/task-list-indexes.test.ts` and `packages/opencorvus/test/protocol/v2.test.ts` execute `SCHEMA_DDL` directly.
- `packages/opencorvus/src/quicknote/service.ts` uses `QuickNoteTable`, but `storage/schema.ts` did not re-export it.
- SQLite table declarations live under `packages/opencorvus/src/**/**.sql.ts` plus `decision-log/schema.ts`.
- `Database.Path()` / `Database.reset()` / `/global/db/reset` are DB-file location and wipe flows, not schema definition sources.

`rg -n 'sql`|sql<' packages\opencorvus\src -g '\*.sql.ts' packages\opencorvus\src\decision-log\schema.ts -S`

- The only Drizzle SQL expression index is `part_tool_call_session_idx` in `session/session.sql.ts`; generated DDL must preserve it from Drizzle metadata.

## Decision

Drizzle table declarations are the single source for ordinary tables, ordinary indexes, primary keys, unique constraints, defaults, and foreign keys.

`storage/ddl.ts` becomes a thin generator over `getTableConfig()` from `drizzle-orm/sqlite-core`, producing the startup `SCHEMA_DDL` string at module load. This keeps the existing `Database.Client()` flow and drift reset behavior, but removes the hand-written ordinary-table DDL.

SQLite objects that Drizzle table declarations cannot represent stay in an explicit storage-extension section:

- `memory_fts` FTS5 virtual table.
- `engine_metric_spec_baseline_no_update` trigger.
- `engine_channel_binding` duplicate cleanup before creating its unique thread index.

These extensions are not alternative definitions for ordinary tables.

## Tests

- Execute `SCHEMA_DDL` in memory and assert required indexes still exist.
- Assert `quick_note` is exported by `storage/schema.ts` and created from generated DDL.
- Assert the Drizzle expression/partial index on `part` exists with its `json_extract` SQL and `WHERE` clause.
- Keep stale schema reset test in `db-path.test.ts`; it continues to validate that drift rebuild uses generated current schema, not compatibility migration.
