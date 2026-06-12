# Deleted Project Task Record Routes

Date: 2026-06-12

## Problem

Overlay startup restored task `tsk_eb9cf1999001d5VCUaDelvBUHu` from a project directory that had already been physically deleted:

```text
GET /task/tsk_eb9cf1999001d5VCUaDelvBUHu/conversation?tail_limit=8
ENOENT: no such file or directory, open '/mnt/c/Users/chuan/myhexin-local/demos/economy/economy4/.gitignore'
```

The failure happens before the route handler. `Server.App()` applies project-directory middleware to every non-bypass route. That middleware calls `Instance.provide()`, whose bootstrap calls `ensureGitignore()`. When the selected task's stored directory no longer exists, the middleware fails while trying to open `.gitignore`, so the operator cannot hydrate the stale task enough to delete the task record.

This is not a `.gitignore` fallback issue. A missing physical project must remain missing. The record-level task routes that can resolve everything from `taskID` and the database should not require a request directory at all.

## Evidence And Call Points

Searches run before this plan:

```text
rg -n "conversation|tail_limit|gitignore|initApp|delete.*project|project.*delete|stale|task/.*conversation" packages specs test
rg -n "routeRequiresProjectDirectory|PROJECT_DIRECTORY_BYPASS|normalizedServerRoutePath" packages
rg -n "queryWithDirectory\(|apiUrl\(|apiRequest\(|routeRequiresProjectDirectory\(" packages/overlay/src packages/opencorvus/src packages/transport-protocol/test packages/opencorvus/test
rg -n "deleteTask\(|function deleteTask|requireTask|project_id" packages/opencorvus/src packages/overlay/src/services
```

| Surface | File | Decision |
| --- | --- | --- |
| Server directory middleware | `packages/opencorvus/src/server/server.ts` | Keep as the single enforcement point. Make it call a method-aware shared policy. |
| Shared route policy | `packages/transport-protocol/src/index.ts` | Change. Add method-aware record-level task route exemptions. |
| Overlay URL/query injection | `packages/overlay/src/services/api.ts` | Change. Pass the HTTP method into shared route policy so `DELETE /task/:id` and task conversation reads do not inject stale `directory`. |
| VS Code transport injection | `packages/overlay/src/services/vscode-transport.ts` | Change. Pass request/stream method into shared route policy through `queryWithDirectory`. |
| Task conversation route | `packages/opencorvus/src/server/routes/orchestrator.ts` | Keep handler semantics. It already reads task/session/message data by `taskID` and `task.project_id`. |
| Task delete route | `packages/opencorvus/src/server/routes/orchestrator.ts` | Keep handler semantics. `EngineService.deleteTask(taskID)` is a DB/session cleanup operation and should be reachable without physical project bootstrap. |
| Task board projection | `packages/opencorvus/src/workbench/board.ts` | Change. Stop reading `Instance.directory`; derive task directory from session/project rows so conversation hydrate works outside `Instance.provide()`. |
| Project bootstrap | `packages/opencorvus/src/project/instance.ts` | Do not change. `ensureGitignore()` must still run for real project-scoped routes. |
| `ensureGitignore()` | `packages/opencorvus/src/engine/git.ts` | Do not change. Missing directories should not be silently created or swallowed. |
| Existing stale selection frontend plan | `specs/new-arch/2026-06-05-overlay-deleted-session-stale-card-plan.md` | Related but insufficient. It clears stale UI selection only after task list refresh; this bug is server bootstrap before record deletion. |

## Route Policy

The following task-record routes are self-identifying and must not require project directory bootstrap:

- `GET /task/:taskID/conversation`
- `GET /task/:taskID/conversation/session/:sessionID`
- `GET /task/:taskID/conversation/history`
- `GET /task/:taskID/conversation/events`
- `DELETE /task/:taskID`

The following remain project-scoped:

- `GET /tasks`
- `POST /task`
- `POST /task/:taskID/message`
- `POST /task/:taskID/retry`
- `POST /task/:taskID/replan`
- `POST /task/:taskID/cancel`
- `GET /task/:taskID/browser-preview...`
- `GET /path`
- `GET /vcs`
- `GET /session/:sessionID/conversation`

This is not a fallback. It is a data ownership correction: record-level routes use task/session/project rows as their source; project-scoped routes still require an explicit existing directory.

## Acceptance

1. `routeRequiresProjectDirectory("task/abc/conversation", "GET")` is false.
2. `routeRequiresProjectDirectory("task/abc/conversation/history", "GET")` is false.
3. `routeRequiresProjectDirectory("task/abc", "DELETE")` is false.
4. `routeRequiresProjectDirectory("task/abc/message", "POST")` remains true.
5. Overlay `apiJson("task/abc/conversation")` does not inject `directory`.
6. Overlay `apiJson("task/abc", { method: "DELETE" })` does not inject `directory`.
7. `GET /task/:taskID/conversation` succeeds without `?directory=` for a task whose project `worktree` points at a deleted physical directory.
8. `DELETE /task/:taskID` succeeds without `?directory=` for the same stale task record.
9. `GET /tasks` without `?directory=` still returns `DirectoryRequiredError`.

## Verification

Targeted tests:

```powershell
bun test packages/transport-protocol/test/contract.test.ts
bun test packages/overlay/test/api-directory-injection.test.ts
bun test packages/opencorvus/test/server/directory-required.test.ts packages/opencorvus/test/server/task-conversation-routes.test.ts
```

Then run route/doc checks if the targeted tests pass:

```powershell
bun run api:routes-check
bun run docs:check
```
