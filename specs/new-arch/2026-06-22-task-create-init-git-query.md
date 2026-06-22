# Task Create `init-git` Query Parameter

## Problem

HTTP API callers create tasks with `POST /task?directory=<path>`. The previous API-mode bootstrap required a separate `POST /project/current/init-git` call before task creation, and task creation stayed strict for non-Git directories.

The current API contract needs task creation to be self-contained for directory-scoped HTTP callers:

- `init-git` is an explicit query parameter on `POST /task`.
- `init-git` defaults to `true`.
- When `init-git=true`, the selected directory is created when missing and initialized as a Git repository when it is not already one.
- When `init-git=false`, `POST /task` keeps the strict `WorktreeNotGitError` behavior and does not initialize Git.

This supersedes the earlier API-mode default from `2026-06-11-api-mode-greenfield-git-bootstrap.md` only for the `POST /task` HTTP ingress.

## Call-Site Audit

| Surface | Evidence | Decision |
| --- | --- | --- |
| Project-scoped middleware | `packages/opencorvus/src/server/server.ts` selects `directory` before `Instance.provide`. | Parse `init-git` and bootstrap Git before `Instance.provide` only for `POST /task`, so the active instance sees the Git-backed project identity. |
| Task route | `packages/opencorvus/src/server/routes/orchestrator.ts` owns `POST /task` and calls `EngineService.createTask`. | Do not move directory bootstrapping into the route body; middleware already owns project directory binding. |
| Task precondition | `packages/opencorvus/src/task-api/index.ts::prepareProject` throws `WorktreeNotGitError` when `Instance.directory` is not Git. | Keep this strict guard as the final invariant. The new query parameter prepares the directory before that guard when requested. |
| Git initialization source | `packages/opencorvus/src/project/project.ts::Project.initGit` owns Git initialization. | Reuse `Project.initGit`; do not duplicate `git init` subprocess handling. |
| Read routes | Project-scoped `GET` routes also pass through `Instance.provide`. | Do not let `init-git` affect read routes. Querying must not start Git initialization. |

## Acceptance

- `POST /task?directory=<missing>` creates `<missing>`, runs `git init`, and accepts the task by default.
- `POST /task?directory=<existing-non-git>` runs `git init` and accepts the task by default.
- `POST /task?directory=<missing>&init-git=false` returns `WorktreeNotGitError` and does not create `.git`.
- `POST /task?directory=<existing-non-git>&init-git=false` returns `WorktreeNotGitError` and does not create `.git`.
- Invalid `init-git` values are rejected as a request error; only `true` and `false` are accepted.
- `Server.openapi()` documents `init-git` only on `POST /task`.
