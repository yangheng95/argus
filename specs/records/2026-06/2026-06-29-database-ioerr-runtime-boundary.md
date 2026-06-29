# 2026-06-29 Database I/O Error Runtime Boundary

## Recall

User request:
- Investigate why multiple goals failed or hung.
- Determine whether the failure is an OpenCorvus problem or SQLite stability problem.
- Fix the issue so the backend does not crash and OpenCorvus does not restart when SQLite reports a storage I/O error.

Acceptance criteria:
- A raw SQLite storage error such as `SQLITE_IOERR_READ` is converted into one structured OpenCorvus error at the database boundary.
- HTTP callers receive a stable 503 `DatabaseUnavailableError` response instead of an opaque 500 or process-level crash.
- Background task wake paths observe and log dispatch failure without producing unhandled promise rejections.
- The fix must not restart, kill, refresh, or otherwise manipulate the user's running OpenCorvus or overlay process.
- The fix must include targeted tests for classification, HTTP status mapping, and background dispatch error containment.

Hard constraints:
- No fallback, compatibility path, global exception swallowing, DB migration, or process-wide `unhandledRejection`/`uncaughtException` rescue.
- No state-machine gate to teach the LLM routing. This is a data-integrity boundary around SQLite storage availability.
- Do not modify unrelated dirty files in the working tree.
- Do not create a new git worktree.

Disk records read before implementation:
- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-06/README.md`
- `specs/current/architecture/02-data.md`
- `specs/current/architecture/16-unified-teardown.md`
- `specs/records/2026-06/2026-06-03-overlay-workbench-page-prd.md`
- `specs/records/2026-06/2026-06-10-mysql-migration-feasibility.md`
- `specs/records/2026-06/2026-06-17 bug-hunt and issue sweep openCorvus.md`

Log evidence:
- `C:\Users\chuan\Downloads\0cb18d350386c2e52d5afe5baf18fab34baf629bcbb3f51c69f069d0a3bb793e-json.log` contained earlier browser MCP `Not connected` / `Connection closed` failures.
- The same log contained the backend crash trigger at `2026-06-29T05:44:27Z`: `SQLiteError: disk I/O error`, `code: SQLITE_IOERR_READ`, `errno: 266`, `byteOffset: -1`, surfaced as both unhandled rejection and uncaught exception.
- `C:\Users\chuan\.codex\attachments\723ead80-4bc4-4a91-bd5b-8971c593c521\pasted-text.txt` showed task `tsk_f1151489b001XmT533Pn7rWm2p` with failed attempts and later lifecycle recovery after server restart.

Grep results:
- `Database.use` / `Database.transaction`: 454 source call sites across storage, engine, session, task-api, scheduler, project, memory, browser-preview, workbench, and worktree modules. Changing the central boundary is the only acceptable single-source fix.
- `Database.Client(`: 0 source call sites outside the storage module, so direct client initialization can be contained inside `storage/db.ts`.
- `serverErrorResponse` / `namedErrorStatus` / `.onError(`: `server/error-handler.ts`, `server/server.ts`, `server/routes/app.ts`, and existing server error-mapping tests.
- `dispatchTaskLoop` / queue launch sites: `engine/queue.ts`, `engine/runtime.ts`, `orchestrator/agent.ts`, `scheduler/cron-service.ts`, `task-api/index.ts`, `tool/request-orchestrator-decision.ts`, plus queue and server tests. Only two production call sites use `void dispatchTaskLoop(...)` fire-and-forget.

Independent agent feedback:
- None. The available multi-agent tool policy forbids spawning sub-agents unless the user explicitly asks for delegation; the user asked for a direct fix.

## Root Cause

This is not evidence that SQLite's engine is inherently unstable. `SQLITE_IOERR_READ` is SQLite reporting that the underlying VFS or filesystem read failed. The root OpenCorvus defect is that storage-layer I/O errors were allowed to escape as raw SQLite exceptions.

The failure chain was:

1. SQLite reported `SQLITE_IOERR_READ` during a database read.
2. `Database.use` / `Database.transaction` rethrew the raw error.
3. HTTP and background wake paths had no structured database-unavailable error to map or record.
4. Fire-and-forget dispatch could turn that rejected promise into an unhandled process error.
5. The backend restarted, leaving active task state to be recovered by lifecycle liveness logic.

## Design

Add one database availability boundary in `packages/opencorvus/src/storage/db.ts`:
- Introduce `DatabaseUnavailableError` with `path`, `operation`, `code`, optional SQLite numeric fields, and a diagnostic message.
- Classify SQLite storage-availability codes at the boundary: `SQLITE_IOERR*`, `SQLITE_CANTOPEN*`, `SQLITE_CORRUPT*`, `SQLITE_NOTADB`, `SQLITE_FULL`, and `SQLITE_READONLY*`.
- When such an error is observed, mark the process-local database handle unavailable, close/reset the current SQLite handle without checkpointing, and rethrow `DatabaseUnavailableError`.
- Subsequent `Database.use` / `Database.transaction` calls fail closed with the same structured error until explicit close/reset.

Wire structured propagation:
- Map `DatabaseUnavailableError` to HTTP 503 in `server/error-handler.ts`.
- Normalize raw SQLite errors in `serverErrorResponse` so route errors bypassing `Database.use` still get the same wire contract.
- Normalize and log database-unavailable failures at queue launch/completion boundaries.
- Replace the two `void dispatchTaskLoop(...)` call sites with a single background dispatch helper that logs rejection instead of allowing unhandled promise rejection.

Rejected approaches:
- Global `process.on("unhandledRejection")` / `uncaughtException` swallowing: hides unrelated bugs and is a fallback.
- SQLite-to-MySQL migration: the existing 2026-06-10 record shows this is a broad storage rewrite, not the root fix for process crash containment.
- Per-route try/catch patches: duplicates storage error semantics across call sites and violates the single-source constraint.

## Verification

Targeted tests:
- `bun test packages/opencorvus/test/storage/db-path.test.ts`
- `bun test packages/opencorvus/test/server/onerror-mapping.test.ts`
- `bun test packages/opencorvus/test/engine/queue.test.ts`

Spec health after adding this record:
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts`
