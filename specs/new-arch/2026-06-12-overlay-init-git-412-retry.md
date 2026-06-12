# Overlay init-git retry must not depend on stale VCS metadata

## Symptom

Creating a task from the Web UI in a new directory can surface the raw error:

`API 412 task: {"name":"WorktreeNotGitError",...}`

This means task creation reached the backend and the backend rejected the request because the selected directory is not a Git repository.

## Grep Evidence

| Surface | Evidence | Decision |
| --- | --- | --- |
| Task precondition | `packages/opencorvus/src/task-api/index.ts` throws `WorktreeNotGitError` when `Project.isGitRepo(Instance.directory)` is false. | Keep strict task creation. Do not reintroduce hidden auto-init. |
| Error mapping | `packages/opencorvus/src/server/error-handler.ts` maps `WorktreeNotGitError` to HTTP 412. | Keep exact 412 so the UI can offer explicit recovery. |
| Git init source | `packages/opencorvus/src/project/project.ts` owns `Project.initGit`; route is `POST /project/current/init-git`. | Reuse this endpoint. Do not duplicate `git init` in overlay code. |
| Overlay retry | `packages/overlay/src/services/task.ts` catches only 412 `WorktreeNotGitError`, asks for confirmation, calls `initGitCurrent`, and retries once. | Keep this single retry point. |
| Frontend init entrypoint | `packages/overlay/src/utils/git.ts` has `canInitGit` and `initGitCurrent`. | `canInitGit` may remain a UI affordance check, but `initGitCurrent` must not be blocked by `boardStore.vcs === null` after a confirmed 412. |

## Fix

Make `initGitCurrent` require only an active directory before calling `POST /project/current/init-git`. The server route and `Project.initGit` remain the source of truth for whether initialization is valid and whether `.git` already exists.

`canInitGit` remains available for rendering controls, but it is not a correctness precondition for a user-confirmed recovery after the backend has already returned `WorktreeNotGitError`.

## Verification

Add focused overlay coverage that calls the real `initGitCurrent` with `boardStore.vcs === null` and asserts it still posts to `project/current/init-git`.
