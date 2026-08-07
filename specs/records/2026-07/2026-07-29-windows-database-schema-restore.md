# Windows Database Schema Restore

## Recall

### User Requirement

- Repair the packaged Windows client so it can read existing conversation history and model configuration.
- Do not delete or reset the database.

### Acceptance Criteria

- The intact timestamped schema backup remains unchanged and readable.
- Schema refresh restores the backup into a separately created current-schema database on Windows.
- The active database retains the observed historical Projects, Sessions, and Messages instead of opening as an empty database.
- Durable Work Ledger and conversation-history reads remain available when unrelated project runtime bootstrap integrity checks reject execution.
- Provider cache, authentication, and project model configuration remain present and their real server routes are readable.
- A restore failure remains visible, publishes no successful schema-refresh evidence, and never turns the backup into a writable or second active source.

### Hard Constraints

- Follow `AGENTS.md`; no database deletion, reset, migration, compatibility reader, fallback database, platform branch, route gate, or second active data source.
- Keep the current DDL (Data Definition Language) as the only active schema and the existing shared-table/shared-column projection as the only restore policy.
- Open the backup through Bun SQLite's constructor-level read-only mode; do not depend on `ATTACH` URI handling.
- Preserve all unrelated files and commits. Commit subjects start with `dsw-33987` and delivery is pushed to `legacy-remote`.

### Sources Read

- `AGENTS.md`
- `specs/current/architecture/16-unified-teardown.md`
- `specs/records/2026-07/2026-07-20-database-schema-backup-restore.md`
- `specs/records/2026-07/2026-07-25-database-schema-refresh-fts-shadow-repair.md`
- `specs/records/2026-07/2026-07-27-database-schema-health-false-positive.md`
- `specs/records/2026-07/2026-07-28-overlay-runtime-database-isolation.md`
- `packages/opencorvus/src/storage/db.ts`
- `packages/opencorvus/test/storage/db-path.test.ts`
- `packages/opencorvus/src/project/bootstrap.ts`
- `packages/opencorvus/src/server/project-route-context.ts`
- `packages/opencorvus/src/server/routes/right-sidebar-conversation.ts`
- `packages/opencorvus/src/server/routes/session.ts`
- `packages/opencorvus/src/task-artifact/recovery.ts`
- `packages/opencorvus/test/server/project-route-context.test.ts`
- `packages/opencorvus/test/server/provider-recovery-routes.test.ts`
- `packages/opencorvus/test/task-artifact/store.test.ts`
- Windows sidecar and main-process logs under the canonical OpenCorvus data directory
- The active database, its timestamped schema backup, `models.json`, `auth.json`, and project `opencorvus.jsonc`
- Bun SQLite documentation and SQLite URI/open documentation

### Whole-Repository Search Evidence

Searches: `rg "restoreCurrentSchemaData|refreshSchemaDatabase|pathToFileURL|schema_backup|readRestoreColumns|readOrdinaryTableShape"` across source, tests, and records.

| Owner / call site | Decision |
| --- | --- |
| `storage/db.ts::restoreCurrentSchemaData` | Replace the sole `ATTACH` copy loop with one independent read-only backup connection and parameterized row insertion into the active transaction. |
| `storage/db.ts::refreshSchemaDatabase` | Keep as the sole caller and current-schema reconstruction owner. |
| `storage/db.ts::readOrdinaryTableShape` | Retain as the shared ordinary-table inventory owner; each connection reads its own `main` schema. |
| `storage/db.ts::readRestoreColumns` | Retain as the shared column contract reader; each connection reads its own `main` schema. |
| `storage/db.ts::pathToFileURL` | Remove the storage-only import because SQLite attachment URI construction is eliminated. |
| `test/storage/db-path.test.ts` | Use the existing stale-schema restoration contract as the Windows regression and extend it to prove that the preserved backup rejects writes. |
| `server/project-route-context.ts` | Project exact persisted Chat/Work session list, claim, and conversation hydration reads through identity context without weakening execution routes. |
| `server/routes/right-sidebar-conversation.ts` | Keep the canonical persisted Chat/Work list and claim handlers; they need project identity and SQLite, not runtime bootstrap. |
| `server/routes/session.ts` | Keep conversation hydration as the canonical persisted transcript reader; its exact GET route needs project identity and storage only. |
| `task-artifact/recovery.ts` and strict recovery tests | Unchanged. Missing or invalid referenced Task Artifact bytes remain a visible runtime-integrity failure and are not fabricated, ignored, or rewritten. |
| `test/server/project-route-context.test.ts` and recovery route contract | Prove exact history reads remain reachable while a separate runtime route is blocked by bootstrap. |
| ACP, configuration, browser, LSP, Tool, and unrelated test URL conversions | Unchanged; they use file URLs outside SQLite schema restore. |

### Independent Agent Feedback

- No sub-agent was used because the user did not request delegation or parallel agents.

## Incident Evidence And Causal Chain

1. The packaged `0.0.24-beta` sidecar detected schema drift and safely rotated the old image to a timestamped schema backup.
2. The backup passed SQLite integrity checks and retained 24 Projects, 21 Sessions, and 335 Messages; the new active database contained no Sessions or Messages.
3. Restore constructed a valid SQLite file URI with `mode=ro&immutable=1` and passed it to `ATTACH`.
4. Bun `1.3.13` on Windows returned `SQLITE_CANTOPEN` for each tested read-only URI form, while opening the same path through `new Database(path, { readonly: true })` succeeded.
5. Therefore history loss in the client is an incomplete schema refresh caused by the Windows runtime's `ATTACH` URI path, not deletion or corruption of the historical data. Provider cache, authentication, and project model configuration files are also still present.

### Reopened Historical-Selection Evidence

1. The repaired packaged server restored the canonical image and returned `healthy=true`; global Work Ledger history, the global Provider catalog, and project config/model routes returned real data.
2. Selecting the restored `test-E10` project entered full `InstanceBootstrap`.
3. The strict Task Artifact recovery stage found Engine Artifact `art_fad65e791001HvBDzdauUaawaK@18` referencing `resources/0000/docs/review/workspace-audit.md`, but the immutable referenced snapshot is absent from the project runtime tree.
4. The recovery owner correctly rejected that missing evidence. Its strictness must remain because the missing bytes cannot be reconstructed from the database without fabrication.
5. The same rejection incorrectly blocked persisted Chat/Work session claim and transcript hydration, even though those GET handlers use project identity and SQLite records rather than the missing runtime Artifact.
6. The root repair is therefore route ownership separation: durable history reads use identity context; project execution and recovery continue to require full bootstrap.

## Design

Open the timestamped backup as a separate constructor-level read-only SQLite connection. Inventory its ordinary tables and columns through that connection. For every shared current table, stream source rows and insert them with a prepared parameterized statement into the existing active-database transaction. Keep required-column checks, table precedence, FTS (Full-Text Search) rebuild, foreign-key verification, current-schema verification, data-integrity verification, rollback, and success publication unchanged. Always close the read-only source connection.

Project only the exact persisted Chat/Work session list, session claim, and conversation hydrate GET routes through `Instance.provideProjectIdentity`. These handlers keep their project-lineage checks and canonical database owners. Mutation, prompt, event-stream, Task Artifact, Agent, and execution routes remain on `InstanceBootstrap`; no missing resource is accepted and no alternate history source is introduced.

## Verification Plan

- Run the focused stale-schema test before implementation to retain the exact Windows `SQLITE_CANTOPEN` baseline.
- Run the complete storage database test suite after implementation.
- Run OpenCorvus typecheck, historical-links and document-health checks, and `git diff --check`.
- Run a server contract that makes full runtime bootstrap fail, then proves the exact persisted history routes still return their canonical rows while a runtime endpoint remains blocked.
- Build the Windows sidecar/client artifact through the repository toolchain.
- With no OpenCorvus process holding the files, preserve the current partial database under a recovery name, copy the intact backup to the canonical path, and let the repaired runtime perform the one current-schema refresh.
- Verify real health, history, Provider, and project configuration routes; inspect database integrity and retained row counts. Do not delete either preserved image.

## Implementation And Recovery Evidence

- `restoreCurrentSchemaData` now opens the immutable backup with `new Database(backupPath, { readonly: true })`, reads each connection's `main` schema, streams shared rows, and inserts them through prepared statements inside the existing active-database transaction.
- Source and destination statements are finalized deterministically. Restore, finalization, rollback, foreign-key, current-schema, and data-integrity failures remain visible; the read-only backup is always closed and never becomes an active source.
- Exact GET reads for `/coding/chat/sessions`, `/coding/work/sessions`, `/coding/chat/session/:id`, `/coding/work/session/:id`, and `/session/:id/conversation` use project identity context. POST, PATCH, abort, prompt, event-stream, Agent, Task Artifact, and execution routes still use full runtime bootstrap.
- The original historical backup remains unchanged at `opencorvus.schema-backup-2026-07-29T11-41-30.298Z-74bb9200-aeee-428d-a7b9-3649791f8e04.db`, with SHA-256 (Secure Hash Algorithm 256-bit) `104D7291517DA9D4275690016B02D2CFDF1E2E7C8CAA812834324BB9F6ECEF42`.
- The failed partial active image and its WAL (Write-Ahead Log) / SHM (Shared Memory) companions were moved, not deleted, to the `opencorvus.failed-partial-2026-07-29T20-24-00.*` recovery names.
- The repaired runtime rebuilt the canonical current-schema database and retained exactly 24 Projects, 1 Engine Task, 21 Sessions, and 335 Messages. `PRAGMA quick_check` returned `ok`.
- Real server reads returned 29 Work Ledger rows, 3 Chat sessions, 1 Work session, a claimed restored session, and its 2-message conversation transcript.
- Real configuration reads returned project model `hexin/gpt-5.6-sol`, 175 Provider catalog entries, and connected Provider `hexin`; `models.json`, `auth.json`, and project configuration were not replaced.
- Strict runtime bootstrap still reports the genuinely missing Task Artifact resource for the affected project. Persisted history and configuration are no longer coupled to that failure, while execution integrity remains unchanged.

## Verification Results

- `bun test packages/opencorvus/test/storage/db-path.test.ts`: 41 passed, 0 failed, 181 assertions.
- `bun test packages/opencorvus/test/server/project-route-context.test.ts packages/opencorvus/test/server/conversation-history-recovery-routes.test.ts`: 4 passed, 0 failed, 56 assertions.
- `bun run --cwd packages/opencorvus typecheck`: passed.
- `bun run --cwd packages/opencorvus build --overlay-server`: passed.
- The full Windows overlay build, documentation checks, route checks, final diff review, and main-branch delivery are recorded by the final task verification and Git history.
