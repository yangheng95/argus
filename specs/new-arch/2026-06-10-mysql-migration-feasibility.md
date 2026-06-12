# MySQL Migration Feasibility - 2026-06-10

## Question

Investigate the feasibility and cost of replacing the current OpenCorvus SQLite storage with MySQL.

## Current Evidence

Repository grep on 2026-06-10 shows:

| Area                   | Evidence                                                                                                                                                                                                                 | Migration meaning                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Driver                 | `packages/opencorvus/src/storage/db.ts` imports `bun:sqlite`, `drizzle-orm/bun-sqlite`, `SQLiteTransaction`, and `SQLiteBunDatabase`.                                                                                    | The storage runtime is synchronous and SQLite-specific at the root.                                                                              |
| Schema                 | 17 schema files use `drizzle-orm/sqlite-core`; 42 `sqliteTable(...)` declarations exist under `packages/opencorvus/src`.                                                                                                 | Every table declaration must move to `drizzle-orm/mysql-core`; this is a full schema rewrite, not a config toggle.                               |
| DDL                    | `packages/opencorvus/src/storage/ddl.ts` uses `SQLiteSyncDialect`, `getTableConfig`, generated SQLite DDL, an explicit FTS5 virtual table, duplicate cleanup by `rowid`, and a SQLite trigger using `RAISE(ABORT, ...)`. | The bootstrap DDL generator is SQLite-specific and must be replaced with a MySQL dialect or a MySQL-native schema bootstrap.                     |
| Runtime API            | `Database.use/transaction/Client/Path/reset/vacuum` style calls appear 379 times in `packages/opencorvus/src`, across 69 files.                                                                                          | Drizzle MySQL with `mysql2` is async. Current sync call sites cannot be migrated by swapping the client type.                                    |
| Tests                  | 117 test files call `resetDatabase(...)`; storage tests directly inspect SQLite PRAGMA and `sqlite_schema`.                                                                                                              | Test infrastructure and storage assertions need a MySQL-backed reset fixture and different schema introspection.                                 |
| SQLite-only operations | 30 `json_extract` references, 14 `.returning(...)`, 9 `onConflictDo*` call sites, 12 `bun:sqlite` imports, PRAGMA/WAL/vacuum/checkpoint usage.                                                                           | SQL compatibility work is real: JSON query syntax, upsert/returning semantics, file reset semantics, and maintenance commands must be rewritten. |
| Product docs           | English and Chinese docs describe durable state as SQLite under `~/.opencorvus/opencorvus.db`; `/global/health` exposes `paths.database`.                                                                                | Product behavior and CLI/API wording must change, not only internals.                                                                            |

Relevant existing design history:

- `specs/db-schema-drift-reset-2026-06-03.md` intentionally removed compatibility migrations and chose reset-on-drift with `SCHEMA_DDL` as the single schema source.
- `specs/new-arch/16-unified-teardown.md` repeatedly treats schema changes as reset-DB work, not migration-script work.
- `packages/opencorvus/src/cli/cmd/db.ts` exposes a SQLite query shell and destructive reset around SQLite DB/WAL/SHM files.

External toolchain facts checked against official docs:

- Drizzle officially supports MySQL through `mysql2` and `drizzle-orm/mysql2`: https://orm.drizzle.team/docs/get-started-mysql
- Drizzle schemas are dialect-specific; there is no single shared table object across PostgreSQL, MySQL, and SQLite: https://orm.drizzle.team/docs/sql-schema-declaration
- MySQL JSON can query JSON paths and supports generated-column indexing for JSON-derived values: https://dev.mysql.com/doc/refman/8.4/en/json-search-functions.html and https://dev.mysql.com/doc/refman/8.4/en/create-table-secondary-indexes.html
- MySQL has InnoDB FULLTEXT support, but it is not SQLite FTS5-compatible and uses `MATCH() ... AGAINST`: https://dev.mysql.com/doc/refman/8.3/en/fulltext-search.html
- Drizzle Kit notes MySQL and SQLite DDL behavior differs around multi-statement alternations/transactions: https://orm.drizzle.team/docs/drizzle-config-file

## Feasibility

Technically feasible, but high-cost if the goal is a real replacement with no compatibility fallback.

The simplest viable interpretation under current project rules is **reset storage onto MySQL and delete SQLite as a runtime source**. A dual-mode SQLite/MySQL adapter is not acceptable here because it would create two behavior sources and long-term compatibility debt. Historical data migration is also out of scope under the local rule that unpublished schema changes reset DB state instead of migrating old databases.

## Main Blocking Work

1. Replace the storage runtime.
   - Add `mysql2`.
   - Replace `drizzle-orm/bun-sqlite` with `drizzle-orm/mysql2`.
   - Replace sync `Database.use` and `Database.transaction` with async equivalents.
   - Propagate `await` through all real call sites that touch DB state.

2. Rewrite schema declarations.
   - Replace `sqliteTable`, SQLite `integer/text/blob/real`, SQLite boolean mode, and SQLite partial/expression index declarations with MySQL equivalents.
   - Decide JSON storage: use MySQL `json` where possible, or keep serialized text if query semantics need tighter control. Because current code uses `json_extract` heavily, native JSON plus explicit query helpers is preferable.

3. Replace bootstrap DDL.
   - Remove `SQLiteSyncDialect`, PRAGMA setup, `sqlite_schema`, WAL, SHM, vacuum, and incremental vacuum logic.
   - Introduce a MySQL schema reset/bootstrap path using a single source. Either generate DDL through Drizzle Kit artifacts or implement a MySQL dialect renderer from Drizzle metadata. The mature-toolchain option is Drizzle Kit-generated SQL, committed and loaded by bootstrap.

4. Rework SQL dialect hot spots.
   - `json_extract(...)` should become a storage helper that renders MySQL-compatible JSON path expressions and unquoting where needed.
   - FTS5 `memory_fts` must become a MySQL FULLTEXT table/index and query layer, or memory search should use a separate search component. The MySQL FULLTEXT route has language/tokenizer behavior differences and needs tests.
   - SQLite partial/expression index `part_message_tool_call_idx` must become a MySQL generated-column index or explicit indexed columns.
   - `.returning(...)` call sites need alternative read-after-write patterns because MySQL support differs from SQLite/PostgreSQL expectations in Drizzle.
   - `rowid` duplicate cleanup must use explicit primary keys or window/subquery logic.

5. Replace reset and observability semantics.
   - `Database.Path()` can no longer mean a local file path. Replace it with a database identity/connection summary in `/global/health`.
   - `opencorvus db query` can no longer spawn `sqlite3`; use a MySQL client or remove raw shell behavior.
   - `opencorvus db reset` should drop/recreate schema or truncate tables in dependency order. Under project rules, this is destructive and not a migration.

6. Rebuild tests.
   - Add a MySQL test fixture with deterministic reset.
   - Replace PRAGMA/`sqlite_schema` tests with `information_schema` or Drizzle-generated-DDL assertions.
   - Run targeted DB suites first, then broader engine/session/orchestrator suites.

## Cost Estimate

Assuming one experienced engineer already familiar with this codebase:

| Workstream                                        |                   Estimate |
| ------------------------------------------------- | -------------------------: |
| Storage runtime and async propagation spike       |       2-4 engineering days |
| Schema rewrite and MySQL DDL bootstrap            |       3-6 engineering days |
| JSON/upsert/returning/query dialect rewrites      |       4-8 engineering days |
| FTS/memory search replacement and parity tests    |       3-6 engineering days |
| CLI/API/docs reset and health semantics           |       1-3 engineering days |
| Test fixture rebuild and regression stabilization |       4-8 engineering days |
| Packaging/config/docs polish                      |       1-2 engineering days |
| **Total**                                         | **18-37 engineering days** |

The low end assumes no hidden driver/type issues and acceptable MySQL FULLTEXT behavior. The high end is more realistic if full memory search fidelity, packaged local developer setup, and broad test stabilization are required.

## Risk

High risk areas:

- Async propagation may touch user-facing request paths and background scheduler flows.
- MySQL connection lifecycle changes the product from a zero-dependency local DB to an external service dependency.
- JSON query behavior can differ subtly around quoted scalar values, booleans, nulls, and indexing.
- FULLTEXT behavior is not equivalent to SQLite FTS5; tokenization and ranking may affect memory search quality.
- Resetting a server DB is operationally more dangerous than deleting a local file, so destructive reset UX needs explicit confirmation but must not become a workflow gate.

Medium risk areas:

- Drizzle schema typing changes are mechanical but wide.
- `onConflictDoUpdate/DoNothing` can usually map to MySQL upsert semantics, but each conflict target must be verified.
- Test parallelism may need isolated schemas or disposable containers to avoid cross-test contamination.

## Recommendation

Do not migrate to MySQL unless there is a concrete requirement for multi-host/shared server state or hosted operational database management.

For the current product shape, SQLite is still the better fit: OpenCorvus is packaged as a local development tool, current docs and reset semantics assume a local DB file, and the codebase intentionally leans on reset-over-migration. MySQL would add operational dependency and async churn without obvious product value.

If MySQL is required, do it as a single-source replacement:

1. Land a short implementation spec before code changes with an exhaustive call-site table for `Database.*`, `sqliteTable`, `json_extract`, `.returning`, `onConflictDo*`, `bun:sqlite`, PRAGMA, and FTS5.
2. Build a disposable MySQL test fixture first.
3. Replace storage runtime and schema in one branch; do not keep SQLite fallback.
4. Reset DB under the new schema; do not migrate historical SQLite files.
5. Require targeted storage/session/engine/scheduler tests plus docs update before push.

## Decision

Feasible but not recommended right now. Estimated cost is **18-37 engineering days**, with the biggest cost coming from sync-to-async storage propagation, SQLite-specific DDL/FTS/JSON behavior, and test infrastructure rebuild.
