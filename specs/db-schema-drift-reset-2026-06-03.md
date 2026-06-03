# DB Schema Drift Reset - 2026-06-03

## Root Cause

`engine_artifact.acceptance_id` is part of the current single-source DDL and Drizzle schema, but `CREATE TABLE IF NOT EXISTS` does not alter an existing SQLite table. A local database created before the column existed can therefore keep the old `engine_artifact` shape and later crash every query that reads `EngineArtifactTable.acceptance_id`.

## Call-Site Sweep

`rg -n "acceptance_id" packages/opencorvus/src packages/opencorvus/test -S` shows the runtime uses `acceptance_id` from workbench board projection, verification persistence, acceptance manifests/reviews, engine persistence/store, orchestrator tools, engine git, and state-invariant tests. These are all legitimate consumers of the current schema; changing them would create a second source instead of fixing storage initialization.

`rg -n "ensureSchemaCompatibility|queue_order|ALTER TABLE|SCHEMA_DDL|Database\\.Client\\(" packages/opencorvus/src packages/opencorvus/test -S` shows the only startup schema compatibility hook is `storage/db.ts::ensureSchemaCompatibility`, currently hard-coded for `engine_task.queue_order`.

## Decision

Remove per-column compatibility. On DB open, if ordinary tables already exist, compare the on-disk ordinary table shape against a fresh in-memory database created from the same `SCHEMA_DDL` before applying DDL to the existing file. If the existing DB does not match the current schema, close and recreate the DB files, then apply `SCHEMA_DDL` only to the fresh file. This keeps `SCHEMA_DDL` as the single schema source and follows the project rule that this unpublished project resets DB state instead of migrating it.

## Verification

Add a storage test that creates a stale `engine_artifact` table without `acceptance_id`, opens `Database.Client()`, and asserts the DB was recreated with `acceptance_id` and without stale rows.
