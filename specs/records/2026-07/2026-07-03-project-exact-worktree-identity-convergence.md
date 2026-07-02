# Project Exact Worktree Identity Convergence

Date: 2026-07-03
Status: Implemented

## Recall

| Item | Details |
| --- | --- |
| User request | Diagnose and fix `config load failed: API 500 config` where the backend reports `Project identity conflict for db172da35b7aa7a37fc531f9d9807e6bad8237d6,cab62748535e7e3abf1fe78a96a8018c2bbe799d: existing worktree C:\Users\chuan\myhexin-local\demos\economy\world-economy, next worktree C:\Users\chuan\myhexin-local\demos\economy\world-economy`. The user also challenged whether one directory having several projects is a problem. |
| Acceptance criteria | Loading `/config` for `C:\Users\chuan\myhexin-local\demos\economy\world-economy` must no longer fail on duplicate exact `project.worktree` rows; duplicate rows for the same exact worktree must converge to one backend `project_id` namespace without deleting task/session/history or memory rows; `.git/opencorvus` must remain the durable identity signal when it names one of the duplicate rows; user-visible multiple projects/Missions/tasks in one directory remain allowed and are not represented by multiple `project_id` rows; no fallback lookup, no cross-project tolerance, no DB reset, no process restart. |
| Hard constraints | No fallback/compatibility path; no gate mechanism; no blind patch; no git reset; preserve existing dirty `packages/opencorvus/src/provider/models-snapshot.ts`; do not restart, refresh, kill, or otherwise disturb OpenCorvus/overlay; no new worktree; every code change needs focused tests; specs stay under root `specs/`; update the monthly README; after passing tests, perform a second review. |
| Sources read | `AGENTS.md`; `specs/README.md`; `specs/records/2026-07/README.md`; `specs/records/2026-07/2026-07-02-project-alias-identity-convergence.md`; `specs/records/2026-06/2026-06-09-project-identity-state-isolation-fix.md`; `packages/opencorvus/src/project/project.ts`; `packages/opencorvus/src/project/project.sql.ts`; `packages/opencorvus/src/project/instance.ts`; `packages/opencorvus/src/server/server.ts`; `packages/opencorvus/src/server/routes/config.ts`; `packages/opencorvus/src/memory/index.ts`; `packages/opencorvus/src/memory/search.ts`; `packages/opencorvus/src/memory/memory.sql.ts`; `packages/opencorvus/test/project/project.test.ts`; `packages/opencorvus/test/memory/stages.test.ts`; `packages/opencorvus/src/storage/db.ts`; `packages/opencorvus/src/storage/mysql-transfer.ts`. |
| Runtime evidence | Read-only DB queries against `C:\Users\chuan\.local\share\opencorvus\opencorvus.db` found duplicate exact `project.worktree` groups: `C:\Users\chuan\Downloads\economy` with ids `40f578c6aaca2718a0d4a771061c0f58a67521bb,7a118b78425af8ae7b3a0919a06b4d4cb992608c`; and `C:\Users\chuan\myhexin-local\demos\economy\world-economy` with ids `db172da35b7aa7a37fc531f9d9807e6bad8237d6,cab62748535e7e3abf1fe78a96a8018c2bbe799d`. For `world-economy`, `cab627...` owns `engine_task=1`, `session=16`, messages, parts, artifacts, goals, protocol events, and decision logs; `db172...` owns `memory_file=59`, `memory_chunk=178`, `memory_fts=178`. `C:\Users\chuan\myhexin-local\demos\economy\world-economy\.git\opencorvus` contains `cab62748535e7e3abf1fe78a96a8018c2bbe799d`. |
| Whole-repository search evidence | `rg -n "memory_fts|MemoryFileTable|MemoryChunkTable|project_id|ProjectTable|WorktreeIdentityConflictError|findExactWorktreeRow|fromDirectory\(|Project\.delete|DELETE FROM memory_fts|INSERT INTO memory_fts|rebuildMemoryFts" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-07 specs/records/2026-06 -g "*.ts" -g "*.md"`; `rg -n "quoteIdentifier|sqliteIdentifier|PRAGMA table_info|sqlite_schema|db\.all<|db\.run\(sql`UPDATE|sql\.raw" packages/opencorvus/src packages/opencorvus/test -S -g "*.ts"`; read-only schema scans for all tables with `project_id`. |
| Independent agent feedback | Euler confirmed `/config` is project-scoped, enters `Instance.provide()`, then `Project.fromDirectory()`, and the reported two-id message comes from `findExactWorktreeRow()` rather than config parsing. Locke confirmed live DB ownership: `cab627...` carries the workflow records and `db172...` carries memory records; deleting either row would lose data, and memory FTS must be migrated. Meitner confirmed the project terminology boundary: one directory may carry multiple user-visible projects/Missions/tasks, but one worktree must not be represented by multiple backend `project_id` namespaces. |

## Diagnosis

The existing July 2 repair converged same-filesystem rows when path spellings
were different. This incident is a stricter duplicate: the exact same worktree
string exists in more than one `project` row. `identify()` calls
`findExactWorktreeRow(worktree)` before it can accept the `.git/opencorvus`
marker. `findExactWorktreeRow()` currently treats multiple exact matches as a
hard identity conflict, so the project-scoped `/config` request fails during
`Instance.provide()` before `Config.get()` runs.

This is not a user-visible "one directory cannot host several projects" issue.
`project_id` is a backend storage namespace for sessions, tasks, attachments,
memory, permissions, runtime evidence, and project-scoped rows. Multiple
user-visible projects/Missions/tasks in the same directory must be modeled above
that namespace, not by creating several rows with the same `project.worktree`.

The live DB shows a split namespace:

- `cab627...` is the current marker identity and owns the interrupted
  TradingView workflow task and its sessions/history.
- `db172...` owns memory rows for the same worktree.

Deleting either row is destructive. The correct repair is to converge duplicate
exact worktree rows into one canonical project row and move every direct
`project_id` reference to that canonical id in a single transaction.

## Repair Plan

1. Add focused `Project.fromDirectory` regressions for duplicate exact worktree
   rows:
   - marker-named canonical row plus memory-bearing duplicate row converges to
     the marker id, moves memory file/chunk/FTS rows, deletes the duplicate
     project row, and keeps memory searchable;
   - no marker/local-id/ownership signal remains a visible
     `ProjectWorktreeIdentityConflictError` instead of silently choosing a row.
2. Implement exact-worktree convergence inside `project.ts`:
   - read `.git/opencorvus` before exact-row lookup;
   - when exact duplicates exist, choose canonical only from durable signals:
     marker id, local generated id, or a unique task/session owner;
   - update every table that has a `project_id` column by schema introspection,
     including `memory_fts`;
   - merge duplicate project sandboxes and safe display metadata into the
     canonical row;
   - delete duplicate project rows after child rows have moved.
3. Keep non-exact conflicts strict:
   - copied standalone repositories still get independent ids;
   - real linked git worktrees still share the primary project and remain
     sandboxes;
   - ambiguous duplicate exact rows still throw rather than using fallback.
4. Run targeted tests and docs checks:
   - `bun test packages/opencorvus/test/project/project.test.ts -t "duplicate exact worktree"`
   - `bun test packages/opencorvus/test/project/project.test.ts`
   - `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
5. After code passes, run a read-only duplicate check against the live DB,
   then execute the repaired `Project.fromDirectory()` path once for
   `world-economy` without restarting OpenCorvus/overlay. Re-check duplicate
   groups, project reference counts, memory FTS counts, and `/config` behavior
   through an isolated backend call.

## Non-Goals

- Do not add a `/config` bypass or route-specific project bootstrap fallback.
- Do not search tasks globally when project-scoped reads miss.
- Do not tolerate cross-project attachment or memory reads.
- Do not represent user-visible multiple projects by writing several
  `project_id` rows for the same worktree.
- Do not reset the DB or delete project rows before moving child data.

## Implemented Fix

- `packages/opencorvus/src/project/project.ts`
  - `findExactWorktreeRow()` now accepts durable preferred ids from the active
    marker and generated local id.
  - Exact duplicate worktree rows converge only when a canonical row is proven
    by marker/local id or a unique task/session owner.
  - Convergence updates every SQLite table with a `project_id` column by schema
    introspection, including `memory_fts`, then deletes duplicate `project`
    rows after child rows have moved.
  - Ambiguous exact duplicate rows still throw
    `ProjectWorktreeIdentityConflictError`; there is no route fallback or
    arbitrary row choice.
- `packages/opencorvus/test/project/project.test.ts`
  - Added a marker-canonical duplicate exact worktree regression that preserves
    memory file/chunk/FTS rows and searchability.
  - Added an ambiguous duplicate exact worktree regression that proves the
    error remains visible without a canonical signal.
- Live DB repair
  - Created a SQLite `VACUUM INTO` backup at
    `.scratch/project-identity-20260703-012047/opencorvus-before-project-identity-convergence.db`.
  - Ran the repaired `Project.fromDirectory()` path for
    `C:\Users\chuan\myhexin-local\demos\economy\world-economy` and
    `C:\Users\chuan\Downloads\economy`.
  - `world-economy` converged to marker id
    `cab62748535e7e3abf1fe78a96a8018c2bbe799d`, moving `db172...` memory rows
    into that namespace.
  - `Downloads\economy` converged to marker id
    `7a118b78425af8ae7b3a0919a06b4d4cb992608c`, moving `40f578...` memory
    rows into that namespace.

## Verification

Commands run:

```powershell
bun test packages/opencorvus/test/project/project.test.ts -t "duplicate exact worktree"
bun test packages/opencorvus/test/project/project.test.ts
bun run --cwd packages/opencorvus typecheck
bun test packages/opencorvus/test/server/project-routes.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
bun test packages/opencorvus/test/script/product-docs-single-source.test.ts
```

Results:

- Duplicate exact worktree focused tests: 2 pass.
- Project identity suite: 31 pass.
- `packages/opencorvus` typecheck: pass.
- Project route suite: 19 pass.
- Historical docs links: 19 pass.
- Document health: 46 pass.
- Product docs single source: 4 pass.

Live DB read-only verification:

```text
select worktree, count(*), group_concat(id)
from project
group by worktree
having count(*) > 1
```

returned `[]`.

Direct `project_id` reference verification showed:

- `db172da35b7aa7a37fc531f9d9807e6bad8237d6`: zero remaining references in
  every direct `project_id` table.
- `40f578c6aaca2718a0d4a771061c0f58a67521bb`: zero remaining references in
  every direct `project_id` table.
- `cab62748535e7e3abf1fe78a96a8018c2bbe799d`: retains
  `engine_task=1`, `session=16`, and now owns `memory_file=59`,
  `memory_chunk=178`, `memory_fts=178`.
- `7a118b78425af8ae7b3a0919a06b4d4cb992608c`: now owns
  `memory_file=3`, `memory_chunk=6`, `memory_fts=6`.

Isolated config-path verification:

```text
Instance.provide(directory=world-economy) + Config.get()
=> projectID cab62748535e7e3abf1fe78a96a8018c2bbe799d, no identity conflict
```
