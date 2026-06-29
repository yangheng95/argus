# 2026-06-26 Overlay Reset DB File Delete Root Repair

## Recall

- User correction: overlay Reset DB is a database file deletion operation, not a database-state reset that may depend on reading the current SQLite contents.
- User correction 2026-06-26 follow-up: overlay Reset DB must target the current DB path visible in the task-title debug info, not an abstract/global DB template, and a successful reset must automatically restart the server so a new DB is generated.
- `specs/new-arch/2026-06-17-hexin-budget-refresh-db-sidecar-cleanup.md` made schema drift explicit: `Database.Client()` throws `DatabaseSchemaResetRequiredError` and the user must run an explicit reset.
- `specs/new-arch/2026-06-18-settings-db-reset-safe-route.md` kept `/global/db/reset` behind `Project.findByRegisteredDirectory(...)`, which reads `project` rows from the same SQLite file that reset is supposed to delete.
- That creates a causal loop: if the DB file has schema drift or corruption, the route opens it before reset, throws, and the overlay sees HTTP 500 instead of deleting `opencorvus.db`.

## Root Cause

`POST /global/db/reset` currently uses the project registry as an authority check before calling `Database.reset(...)`. The project registry is stored in the same SQLite file that reset is supposed to delete. Therefore the reset path cannot repair the primary failure mode introduced by explicit schema-drift reset: a DB file that must not be opened.

The lower-level deletion helper already deletes files; the bug is the HTTP route's pre-reset DB read and the overlay request shape that still models DB reset as project-scoped runtime cleanup. The first repair attempt over-corrected to an empty-body "delete server default DB" route; that still left the destructive action unbound from the DB path the operator sees in overlay debug info and did not guarantee restart.

## Call Point Inventory

| Surface                | File(s)                                                                                     | Current behavior                                                                                                                                  | Repair                                                                                                                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server route           | `packages/opencorvus/src/server/routes/global.ts`                                           | Validates `projectDir`, calls `Project.findByRegisteredDirectory(...)`, reads DB before reset, then calls `Database.reset(registered.directory)`. | Require `{ database }`, verify it exactly equals the current `Database.Path()`, call the DB-file-only deletion helper, then trigger server restart. Do not read project rows before deleting the DB file.                                                         |
| Low-level storage      | `packages/opencorvus/src/storage/db.ts`                                                     | `Database.reset(projectDir)` closes SQLite and deletes DB/WAL/SHM plus project runtime scratch.                                                   | Add `Database.resetFiles(databasePath)` as the single DB-file deletion primitive that accepts only the current `Database.Path()`. Keep `Database.reset(projectDir)` for CLI project scratch reset by composing the same DB-file target list plus runtime targets. |
| CLI reset              | `packages/opencorvus/src/cli/cmd/db.ts`                                                     | Uses `Database.reset(process.cwd())` to delete the runtime DB plus current project scratch.                                                       | Preserve behavior; CLI has a cwd authority boundary and does not need overlay's file-only semantics.                                                                                                                                                              |
| Server restart         | `packages/opencorvus/src/server/routes/app.ts`, `packages/opencorvus/src/server/restart.ts` | `/restart` owns spawn-and-shutdown logic locally.                                                                                                 | Move restart operation into a shared helper and reuse it from DB reset after deletion succeeds.                                                                                                                                                                   |
| Overlay config service | `packages/overlay/src/services/config.ts`                                                   | `resetDatabase(projectDir)` requires a directory and posts `{ projectDir }`.                                                                      | `resetDatabase(database)` posts `{ database }`. The service remains the single overlay request shape.                                                                                                                                                             |
| Settings UI            | `packages/overlay/src/components/settings/GeneralPanel.tsx`                                 | Blocks reset without active project directory, confirms against a directory, and reloads project scope after reset.                               | Confirm DB deletion using the runtime DB path from `/global/health`; no project directory is required for DB reset; do not reload project-scoped state after file deletion. The server restarts after successful deletion.                                        |
| Hidden sidebar reset   | `packages/overlay/src/main.tsx`                                                             | Requires active directory and posts it to reset.                                                                                                  | Require only the DB path for confirmation, then call `resetDatabase(databasePath)`.                                                                                                                                                                               |
| Task debug info        | `packages/overlay/src/utils/debug-info.ts`, `packages/overlay/src/main.tsx`                 | Task title double-click omits the runtime DB path.                                                                                                | Include `runtime.db` from `appStore.enginePaths` so the visible debug path and reset target are the same source.                                                                                                                                                  |
| Transport policy       | `packages/transport-protocol/src/index.ts` and overlay injection tests                      | `/global/db/reset` is global and must not receive `directory`.                                                                                    | Keep unchanged.                                                                                                                                                                                                                                                   |
| OpenAPI/SDK/docs       | `packages/sdk/openapi.json`, generated SDK, web API docs                                    | Describe required `projectDir` and project runtime cleanup, then briefly described an empty body route.                                           | Regenerate after route schema and description change.                                                                                                                                                                                                             |

## Required Semantics

1. Overlay Reset DB deletes the current SQLite DB path reported by `/global/health` and visible in task-title debug info, plus its `-wal` and `-shm` files.
2. The reset route must not call `Project.list()`, `Project.findByRegisteredDirectory(...)`, `Database.Client()`, or any DB-backed projection before deleting those files.
3. The route still disposes in-memory instances before deleting files. A dispose failure must stop deletion.
4. Active-session probing must not make reset depend on DB readability. Existing `hasActiveSessions()` already returns false when DB reads fail; keep that behavior.
5. Unknown absolute `projectDir` no longer exists on the overlay DB reset route, so BH-024's arbitrary project scratch deletion risk is removed rather than bypassed.
6. CLI reset keeps its broader DB plus project scratch deletion behavior.
7. Overlay settings reset must not call `reloadProjectScope()`, `/skill/mounts`, or other project-scoped reloads after DB-file deletion. Rebuilding project state is not part of the DB-file delete contract.
8. OpenAPI must model the reset request body as a required strict JSON object with required `database`.
9. No fallback: there is one overlay DB reset request shape and one DB-file deletion primitive.
10. Successful deletion must trigger the same spawn-and-shutdown restart semantics as `/restart`; failed deletion must not restart.

## Regression Tests

- Server: stale-schema DB file posted to `/global/db/reset` with the current DB path returns 200, removes DB/WAL/SHM without calling project registry lookup, and requests restart.
- Server: reset does not delete arbitrary `.opencorvus` runtime sentinels from a caller-supplied path because the route no longer accepts `projectDir`.
- Server: reset rejects a missing restart handler before disposal or file deletion.
- Server: reset rejects a `database` value that does not exactly match current `Database.Path()` before disposal or file deletion.
- Storage: `Database.resetFiles(databasePath)` deletes only the current `Database.Path()` DB/WAL/SHM and rejects relative or non-current absolute paths; `Database.reset(projectDir)` still deletes DB/WAL/SHM plus project runtime scratch.
- Overlay unit/browser tests: settings and hidden reset call `resetDatabase(database)` without `projectDir`; the visible confirmation names the DB file; clicking settings Reset DB does not issue `/skill/mounts` or append a project reload failure.
- Overlay unit tests: task debug info includes `runtime.db` and main passes `appStore.enginePaths`.
- OpenAPI generation: SDK generation requires `body: { database }` for `/global/db/reset`.

## Verification Plan

```bash
bun test packages/opencorvus/test/server/global-db-destructive.test.ts packages/opencorvus/test/storage/db-path.test.ts --timeout 90000
bun test packages/opencorvus/test/script/routes-check-openapi.test.ts --timeout 90000
bun test packages/overlay/test/general-panel-db-reset.test.ts packages/overlay/test/api-directory-injection.test.ts packages/overlay/test/task-debug-info.test.ts --timeout 120000
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/general-panel-fail-fast-browser.test.ts
bun run api:routes-check
bun run overlay:i18n-check
bun run docs:check
bun run --cwd packages/opencorvus typecheck
bun run --cwd packages/overlay typecheck
bun run build:overlay
```
