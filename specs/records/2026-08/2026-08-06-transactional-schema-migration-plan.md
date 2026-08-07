# Transactional schema migration plan

## Recall

- User request: determine whether changing `AGENTS.md` so future schema changes patch the database instead of resetting it can permanently stop repeated packaged-backend startup failures; if that alone is insufficient, design and implement the complete fix.
- Acceptance: preserve the existing database and database authority; upgrade the exact 0.0.32 schema to the current 0.0.33 DDL (Data Definition Language) without reset or export/import; make future known schema transitions follow one transactional migration chain; fail closed on unknown drift; back up DB (Database), WAL (Write-Ahead Log), and SHM (Shared Memory) before the first mutation; prove rollback, data preservation, exact final schema, application startup, and packaged Overlay health.
- Hard constraints: no arbitrary best-effort patch, compatibility reader, dual active schema, inferred column copying, automatic reset, or silent acceptance of drift. `SCHEMA_DDL` remains the only final/current physical schema. Every schema-changing release must add one exact predecessor-fingerprint migration and positive upgrade tests. Existing unrelated dirty workspace changes are preserved.
- Read sources: repository `AGENTS.md` rule 18; `specs/current/architecture/02-data.md`; `specs/current/architecture/16-unified-teardown.md`; `packages/opencorvus/src/storage/db.ts`; `packages/opencorvus/src/storage/ddl.ts`; current and 0.0.32 `memory.sql.ts`; current database schema and fatal backend log.
- Repository searches: `SCHEMA_RESET_REQUIRED`, complete SQLite schema comparison, `SCHEMA_DDL`, `memory_file_scope_idx`, `memory_file_session_idx`, `scratchpad`, database authority, database lifecycle ownership, package build scripts, and storage test surfaces.
- Independent agent feedback: none; the user did not request sub-agents or parallel review.

## Evidence and root cause

- The 0.0.33 backend log at `%LOCALAPPDATA%/opencorvus/log/2026-08-06T075548-27188-1.log` fails with `SCHEMA_RESET_REQUIRED` on unexpected `index:memory_file_scope_idx`.
- The complete predecessor schema fingerprint is `05480e3d530365e768b00218f24c4a8d7bb281538315b600dd70827c90e33212`; the current DDL fingerprint is `b8d6df10b9f174560b1ee2c90b10b87e039ef375c61b0ccdc8463d9d6c7ed9fd`.
- The exact transition removes the empty legacy `scratchpad` table, the `memory_file.scope` and `memory_file.session_id` columns, and their two indexes while preserving all 96 `memory_file` rows and their dependent chunks/embeddings.
- Editing instructions alone cannot change an already compiled runtime. The recurring failure is caused by the product's strict reset-boundary implementation, so the runtime and its delivery contract must both change.

## Implementation

1. Replace rule 18's reset-only contract with exact, ordered, transactional schema migrations and required predecessor-to-current tests.
2. Add one migration registry keyed by the complete predecessor schema fingerprint. The registry owns only historical transition SQL; current `SCHEMA_DDL` remains the sole final-schema source.
3. Before mutation, retain the managed exclusive read-only inspection connection while copying the exact DB/WAL/SHM set into a timestamped maintenance backup and writing a checksum manifest. This prevents SQLite from checkpointing or deleting the original WAL/SHM when the last connection closes. Close the inspection connection immediately after backup; backup failure aborts migration.
4. Reopen the database, execute the exact fingerprint-selected migration under `BEGIN IMMEDIATE`, run complete schema, foreign-key, and integrity validation, and commit only when every check passes. A failure rolls back and returns a typed migration error.
5. Iterate the fingerprint chain until it reaches the current DDL. Unknown fingerprints fail as `SCHEMA_MIGRATION_REQUIRED`; no migration guesses from object names or columns.
6. Add positive tests for the 0.0.32-to-0.0.33 transition, row and database-authority preservation, backup evidence, and rollback of a failing registered migration.
7. Update architecture single sources, build the Windows package, test it first against a copy of the real database, then launch the formal package and verify health and Work Ledger.

## Verification commands

- `bun test packages/opencorvus/test/storage/schema-migration.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run api:routes-check`
- `bun run docs:check`
- `bun run build:overlay`
- Real packaged sidecar and Overlay startup against isolated and formal copies of the 0.0.32 database.

The historical-doc links test named in rule 32.5 is not present on this delivery branch; the repository's current `docs:check` and pre-push document checks are the available documentation validators.

## Delivery evidence

- The final compiled sidecar migrated an untouched 139 MB copy of the formal predecessor database, then served `/global/health` and `/work-ledger` successfully on port 17884. Its backup at `C:/Users/10132/AppData/Local/opencorvus/data/maintenance-backups/transactional-migration-20260806-161844/final-trio-runtime-probe/data/maintenance-backups/schema-migration-20260806T093402Z-8ea4e1e5-a6c3-406e-8278-df99fb56d188/` contains the exact original DB/WAL/SHM hashes.
- The packaged desktop application at `packages/overlay/dist/opencorvus-overlay-windows-x64/opencorvus-overlay.exe` started the managed backend as version `0.0.33-beta`; `/global/health` was healthy and `/work-ledger` returned HTTP 200.
- The formal pre-migration trio was preserved at `C:/Users/10132/AppData/Local/opencorvus/data/maintenance-backups/schema-migration-20260806T084701Z-e1d230ba-802a-4050-a7ce-84f2c0f4544c/`. Its manifest records the exact predecessor fingerprint and SHA-256 hashes for the DB, WAL, and SHM files.
- The formal database reached fingerprint `b8d6df10b9f174560b1ee2c90b10b87e039ef375c61b0ccdc8463d9d6c7ed9fd` with 146 projects, 34 tasks, 248 sessions, 4,874 messages, 26,912 parts, 96 memory files, and 228 memory chunks. Database authority remained `465f569f-29e8-4bdd-8cad-00745b06c36b`; foreign-key violations were zero and integrity was `ok`.
- The packaged application remained responsive and rendered the existing conversation/project data without the backend-start failure dialog; final visual evidence was reviewed from `C:/Users/10132/AppData/Local/Temp/opencorvus-transactional-migration-final.png`.
- A second launch against the now-current formal schema was healthy, returned Work Ledger HTTP 200, and left the formal schema-migration backup count unchanged at one. Current-schema startup is therefore idempotent and does not rerun the migration.
- Final Overlay executable SHA-256: `BC34035B9D62F6876ED6E9084D78CE51B4C3D466AB8FD4CB837F286094BF34C1`. Final embedded sidecar SHA-256: `A968CE1350D2F33208FFF092F498E868DBA68E4A14270E903DCE998E5C4BA176`.
