# Database Schema Refresh FTS Shadow Repair

Date: 2026-07-25

Status: Health projection repaired and reloaded; replacement connection is
healthy under bounded verification, while the prior vnode revocation trigger
remains under monitoring.

## Recall

| Item | Details |
| --- | --- |
| User requirement | Immediately repair any evidenced shared infrastructure defect while monitoring the fresh TradingView Spaces Mission; intervene and restart only when necessary. The user explicitly rejected the false claim that the temporary port-7879 server database was healthy. |
| Acceptance criteria | Schema refresh restores user tables without writing SQLite Full-Text Search (FTS) shadow tables, preserves the immutable stale-image backup, leaves one usable current-schema database, and allows a fresh Mission to proceed. `/global/health` must project the durable `Database.unavailable()` state instead of hard-coding health, while remaining readable without opening SQLite so operators retain the exact reset path. Overlay connection monitoring must treat `healthy=false` as offline after retaining the runtime paths. The failures have regression tests and exact runtime evidence. |
| Hard constraints | Follow `AGENTS.md`; no fallback database, compatibility reader, host gate, retry loop, hidden data source, broad reset, or destructive cleanup. Preserve the failed active image and immutable schema backup until recovery is verified. Preserve all unrelated worktree changes. Commit subject starts with `dsw-33987`; push to `legacy-remote`. |
| Runtime evidence | After safely settling polluted Mission `a0326f635c659e7a`, PID 92398 restarted on commit `bbfc5a14a6`. At `2026-07-25T11:58:32.574Z`, the first project-open request entered `refreshSchemaDatabase` and failed in `restoreCurrentSchemaData` with exact SQLite error `table memory_fts_config may not be modified` at `storage/db.ts:349`. The stale image was preserved as `/Users/yangheng/.local/share/opencorvus/opencorvus.schema-backup-2026-07-25T11-58-32.540Z-f0c2213b-5102-4a58-ae7d-c11ce64847f0.db`. The partial current image later became process-wide unavailable with `SQLITE_IOERR_VNODE` errno 6922, causing Mission status and scheduler polling to return `DatabaseUnavailableError`. Fresh Mission `b47c6e85d5995014` had bootstrapped fresh-09 but had not created a Task. A repaired temporary PID 98603 initially completed schema refresh and served `/mission`, but at `2026-07-25T12:21:33.495Z` its cron poll recorded the same durable `SQLITE_IOERR_VNODE` state. At the same time `/mission` returned 503 while `/global/health` incorrectly returned HTTP 200 with `healthy=true`; the process had already closed its failed SQLite handle. |
| Sources read | `AGENTS.md`; `2026-07-20-database-schema-backup-restore.md`; `storage/db.ts`; `storage/ddl.ts`; `memory/memory.sql.ts`; `storage/db-path.test.ts`; runtime terminal output; active and backup database file metadata. |
| Whole-repository grep | `rg -n "restoreCurrentSchemaData\|refreshSchemaDatabase\|memory_fts_config\|fts_config\|sqlite_schema\|shadow"` across storage source, storage tests, and July records; `rg -n "schema drift\|memory_fts\|schemaRefresh"` across the focused database test; `git log` and `git diff` for `storage/db.ts`. `restoreCurrentSchemaData` is the sole backup-copy loop and `readOrdinaryTableShape` is its shared current-schema inventory owner. For the reopened health defect, `rg -n "global.health\|/global/health\|databaseSchemaRefresh\|healthy"` covered the route, server route tests, packaged health tests, Overlay connection service, connection lifecycle browser tests, API clients, and reset UI. The server route and Overlay `checkConnection` are the two shared projection owners to replace; healthy packaged startup consumers remain unchanged. |
| Independent agent feedback | No independent Agent was requested or used. |

## Causal chain

1. SQLite FTS5 creates protected shadow tables such as
   `memory_fts_config`, `memory_fts_data`, and `memory_fts_idx`.
2. `readOrdinaryTableShape` and the attached-backup inventory selected
   `sqlite_schema` rows whose SQL starts with `CREATE TABLE`.
3. FTS shadow rows satisfy that textual condition even though SQLite classifies
   them as `type=shadow`.
4. Schema restore therefore attempted a direct `INSERT` into
   `memory_fts_config`; SQLite correctly rejected the write.
5. The failed initialization closed and invalidated the process-owned SQLite
   handle while concurrent project traffic continued, after which the database
   was marked unavailable with `SQLITE_IOERR_VNODE`.

## Repair

The shared table-shape reader now obtains the canonical SQLite classification
from `PRAGMA <schema>.table_list` and includes only `type=table`. It accepts the
main or attached backup schema and supplies both schema-drift comparison and
restore inventory. Virtual tables and their `type=shadow` internals are never
copied directly; the existing single-source `memory_chunk -> memory_fts`
rebuild remains the only FTS restoration path.

The regression creates a stale image containing both a restorable user table
and the real `memory_fts` virtual table. It proves schema refresh succeeds,
preserves the user row, and leaves SQLite's current FTS shadow structure
present without attempting to write it.

The reopened health defect is repaired at the two shared projection owners:

1. `/global/health` reads the already-recorded `Database.unavailable()` value
   without opening SQLite. It returns `healthy=false` plus the exact typed
   `databaseUnavailable` evidence while preserving the runtime paths required
   by the explicit reset flow.
2. Overlay connection monitoring stores those runtime paths first, then treats
   `healthy=false` as an offline probe instead of presenting the backend as
   online.

The OpenAPI document, generated TypeScript SDK, and API reference are rebuilt
from that single route contract. No scheduler exception, Agent, Squad, route,
or UI-specific compatibility path was added.

## Recovery

`bun test packages/opencorvus/test/storage/db-path.test.ts` passed all 35 tests
with 145 assertions, including the real FTS-shadow stale-image regression.
OpenCorvus typecheck and `git diff --check` passed. Historical links passed all
21 tests. Document health passed 61 of 62 checks; its sole failure is the
parallel untracked
`2026-07-25-research-deliverable-case-benchmark.md` already linked by another
working-tree owner, not this repair.

Commit `490aeb3066` was pushed to `legacy-remote/v0.0.18beta`. After PID 92398 exited,
the unusable partial current image was preserved as
`/Users/yangheng/.local/share/opencorvus/opencorvus.failed-partial-2026-07-25T11-58-32.db`;
the immutable 43 MB stale-image backup remained untouched and was copied back
to the canonical database path.

Port 7878 was already owned by an unrelated parallel benchmark with its own
isolated temporary database, so the repaired server was started on port 7879
without interrupting that work. Its first real `GET /mission` request at
`2026-07-25T12:16:22.199Z` entered schema refresh, preserved a second immutable
pre-refresh backup, restored the current schema, logged `schema applied`, and
completed with HTTP 200. It did not emit
`table memory_fts_config may not be modified`, `SQLITE_IOERR_VNODE`, or
`DatabaseUnavailableError`. `GET /global/health` then returned HTTP 200 with
`healthy=true` and the exact schema-refresh backup metadata; the canonical
database passed `PRAGMA integrity_check`, retained 108 sessions, and retained
all five SQLite-classified FTS shadow tables through the virtual-table rebuild.

That initial verification was insufficient: it sampled the control-plane
health response and an early Mission read but did not wait for the durable
database-unavailable signal. PID 98603 later failed as recorded in Recall, and
the user correctly rejected the healthy claim. The canonical database file
still passes SQLite integrity checks and retains 108 sessions; the failed
process has closed its SQLite handle, so the evidence currently distinguishes
a process-owned connection failure from on-disk corruption. A restart through
the new health projection is required before creating another Mission.

Focused server and Overlay connection tests cover healthy and durable-unhealthy
responses, including retention of runtime reset paths. Both package
typechecks pass. The Node/Playwright visual test was attempted but correctly
did not bypass the shared browser lock currently owned by the independent
research-deliverable benchmark PID 2194; no visual pass is claimed while that
external owner remains active.

Commit `8666610cdd` was pushed to `legacy-remote/v0.0.18beta` after the generated
OpenAPI document and TypeScript SDK were rebuilt and route/docs checks passed.
The failed PID 98603 had no database handle or supervised child process and
was stopped through its normal SIGINT settlement path. Replacement PID 8734
then opened the canonical database on port 7879 without schema refresh:
`/global/health` returned `healthy=true`, two bounded `/mission` reads returned
HTTP 200, periodic cron access remained error-free, and `lsof` showed that PID
8734 owned the main DB, WAL, and SHM handles. This proves current availability,
not the still-unknown historical cause of PID 98603's vnode revocation; the
monitor must continue checking both durable health and a real database-backed
route before declaring the backend healthy.
