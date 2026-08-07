# API mode greenfield git bootstrap

## Problem

API-mode callers can start OpenCorvus against a new directory and then call `POST /task`.
The project-scoped server middleware binds the request to that directory, but `EngineService.createTask`
calls `prepareProject`, which requires `Project.isGitRepo(Instance.directory)`.
For a directory that exists but has no `.git`, this intentionally throws `WorktreeNotGitError`
and the HTTP layer maps it to 412.

Overlay task creation already handles that explicit precondition by prompting the user, calling the
single `POST /project/current/init-git` endpoint, and retrying task creation. API-mode SDK startup
does not have the equivalent bootstrap path.

## Grep Evidence

| Surface                     | Call points / definitions                                                                                                                                            | Decision                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `EngineService.createTask`  | `src/task-api/index.ts`, `src/server/routes/orchestrator.ts`, `src/tool/panel.ts`, orchestrator tool creation, tests under `test/engine`, `test/gateway`, `test/e2e` | Keep the hard Git precondition. Do not restore hidden auto-init in task creation.                                   |
| `WorktreeNotGitError` / 412 | `src/worktree/index.ts`, `src/server/error-handler.ts`, `test/server/onerror-mapping.test.ts`, `test/engine/prepare-project-non-git.test.ts`                         | Keep exact 412 mapping. Add docs/test coverage where SDK bootstrap prevents this precondition before task creation. |
| `project.current.initGit`   | `src/server/routes/project.ts`, `src/project/project.ts`, generated SDK `Current.initGit`                                                                            | Reuse this endpoint as the single Git initialization source. Do not duplicate `git init` in SDK.                    |
| SDK entrypoints             | `packages/sdk/js/src/client.ts`, `packages/sdk/js/src/index.ts`, `packages/sdk/js/src/server.ts`, `test/script/sdk-open-corvus-client-contract.test.ts`              | Extend hand-written API-mode convenience entrypoint, not generated SDK files.                                       |

## Fix

Add an explicit SDK bootstrap option:

- `createOpenCorvus({ directory, initGit: true })` starts the server, creates the directory-scoped client,
  then calls the generated `client.project.current2.initGit({ directory })` before returning.
- `initGit` defaults to `false`; callers who want a pure client with no disk write keep the current behavior.
- `createOpenCorvusClient({ directory })` remains a header-scoped client factory only.

This keeps `POST /task` as a strict task-creation API and preserves `POST /project/current/init-git` as the
only source of Git initialization.

## Tests

- SDK contract test asserts `createOpenCorvus` accepts `directory` and `initGit`, calls the canonical
  generated `project.current2.initGit`, and keeps `createOpenCorvusClient` free of task-create retry logic.
