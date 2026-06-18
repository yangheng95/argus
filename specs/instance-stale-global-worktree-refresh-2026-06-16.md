# Instance Stale Global Worktree Refresh

Date: 2026-06-16

> **Status (2026-06-17): Superseded symptom note.** The root cause is covered by
> `specs/remove-global-project-sentinel-2026-06-16.md`: project discovery must
> not create a shared `global` project identity. This note is historical
> evidence of the stale-cache symptom, not the current project identity design.

## Problem

Task `tsk_ecefdca56001FewJ8LlB0AozSE` failed before implementation because Build
worktree creation reported `fatal: not a git repository` twice.

Local evidence showed:

- `C:\Users\chuan\myhexin-local\demos\economy\economy_1` is a valid Git repo.
- `git -C C:\Users\chuan\myhexin-local\demos\economy\economy_1 worktree list --porcelain`
  succeeds.
- `git -C / worktree list --porcelain` reproduces the exact fatal error.
- The task trace reported `Working directory:
C:\Users\chuan\myhexin-local\demos\economy\economy_1` while also reporting
  `Workspace root folder: /`.

That combination means the active `Instance` cache still held the global
pseudo-project (`worktree="/"`) even after the same directory had become a Git
repo on disk.

## Call-Site Evidence

| Area               | Grep evidence                                                                                                                        | Decision                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `Instance.provide` | `packages/opencorvus/src/project/instance.ts` is the cache boundary for `directory`, `worktree`, and `project`.                      | Repair the cache boundary once; do not patch individual worktree callers. |
| Worktree creation  | `packages/opencorvus/src/worktree/index.ts::primaryWorktreeInfo` runs `git worktree list --porcelain` with `cwd: Instance.worktree`. | Keep worktree creation strict; it should not guess an alternate cwd.      |
| Direct build       | `packages/opencorvus/src/build/agent.ts` calls `Worktree.create({ taskID, sessionID })`.                                             | Inherits the corrected `Instance.worktree`.                               |
| Goal build         | `packages/opencorvus/src/orchestrator/tools.ts` calls `Worktree.create({ taskID, goalID, runID })`.                                  | Inherits the corrected `Instance.worktree`.                               |
| Git init route     | `packages/opencorvus/src/server/routes/project.ts` refreshes/disposes after explicit init.                                           | Keep explicit init path unchanged.                                        |

## Fix

When a cached `Instance` context says `project.id === "global"` and
`worktree === "/"`, but the same `directory` now has `.git`, refresh that
context through `Project.fromDirectory` before entering the request context.

This was a data-integrity refresh for the old global-sentinel shape, not a
fallback path:

- Non-Git directories no longer remain `global`; see
  `specs/remove-global-project-sentinel-2026-06-16.md`.
- `Worktree.create` still fails loudly if the active project is not a Git repo.
- No alternate cwd is guessed inside worktree creation.

## Acceptance

- A directory first opened as non-Git, then initialized as Git, must refresh to a
  real project/worktree on the next `Instance.provide`.
- Existing `Project.fromDirectory` behavior for normal repos, copied repos, and
  Git worktrees remains unchanged.
- TypeScript typecheck passes.
