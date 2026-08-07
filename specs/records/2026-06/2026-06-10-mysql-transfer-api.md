# MySQL Transfer API - 2026-06-10

## Goal

Provide a one-shot data-center transfer surface without making MySQL a runtime database source:

- Export the current OpenCorvus table structure as MySQL-compatible staging DDL.
- Export current SQLite data into a strict JSON snapshot format.
- Import that snapshot back into the local SQLite database, rebuilding the DB from the current code schema.

This is not a SQLite/MySQL dual-runtime adapter. SQLite remains the only runtime DB.

## Call-Site Evidence

Whole-repo checks before implementation:

| Concern                 | Evidence                                                                                                                  | Decision                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Global DB routes        | `/global/db/reset` lives in `packages/opencorvus/src/server/routes/global.ts`.                                            | Add MySQL transfer routes to the same control-plane route module.                                                   |
| Route directory policy  | `packages/transport-protocol/src/index.ts` bypasses `/global/*`; overlay and contract tests enumerate `/global/db/reset`. | Add tests for `/global/db/mysql/schema`, `/global/db/mysql/export`, and `/global/db/mysql/import` as global routes. |
| Schema source           | `packages/opencorvus/src/storage/ddl.ts` already derives SQLite DDL from `packages/opencorvus/src/storage/schema.ts`.     | Reuse the same collected Drizzle table metadata for MySQL DDL and snapshot table order.                             |
| Reset semantics         | `Database.reset(projectDir)` also removes project scratch.                                                                | Import should only rebuild DB files; it must not delete project worktrees/scratch.                                  |
| FTS                     | `memory_fts` is a SQLite FTS5 virtual table populated from `memory_chunk`.                                                | Do not import/export `memory_fts` rows; rebuild it from `memory_chunk` after import.                                |
| SQLite-specific indexes | `part_message_tool_call_idx` is a partial/expression index.                                                               | MySQL staging DDL reports unsupported indexes explicitly instead of hiding them.                                    |

## API

### `GET /global/db/mysql/schema`

Returns:

- `format`: `opencorvus.mysql-transfer.v1`
- `schemaFingerprint`: hash of current table/column/type shape
- `mysqlDDL`: MySQL-compatible staging DDL
- `tables`: canonical table names and columns
- `derivedTables`: currently `memory_fts`
- `skippedIndexes`: SQLite indexes that cannot be represented safely in MySQL staging DDL

### `GET /global/db/mysql/export`

Returns the schema envelope plus a `snapshot` in the import format. The snapshot includes all 42 ordinary tables, every current column, and rows as objects.

### `POST /global/db/mysql/import`

Accepts:

```json
{
  "snapshot": {
    "format": "opencorvus.mysql-transfer.v1",
    "schemaFingerprint": "...",
    "tables": [{ "name": "project", "columns": ["id", "..."], "rows": [{ "id": "..." }] }]
  }
}
```

Rules:

- Active executor sessions return `409`.
- The snapshot must include exactly the current ordinary table set.
- Every table must carry exactly the current column list.
- `schemaFingerprint` must match the current code schema.
- Unknown row columns are rejected.
- BLOB cells are encoded as `{ "opencorvusType": "blobBase64", "base64": "..." }`.
- JSON column object/array values are serialized to SQLite JSON text during import.
- Import rebuilds inside one SQLite transaction: the old DB is replaced only after drop-schema, create-schema, row insert, and derived FTS rebuild all succeed. Failure rolls back instead of leaving a partial rebuilt DB.

## Tests

- Storage unit: MySQL DDL exposes project table, reports derived FTS table, and rejects stale/mismatched snapshots.
- Storage round-trip: seed SQLite rows, export snapshot, import snapshot, verify rows and rebuilt `memory_fts`.
- Server route: schema/export/import are reachable without project directory and import blocks active executor sessions through existing runtime check path where practical.
- Transport/overlay policy: new global routes do not receive project directory injection.
