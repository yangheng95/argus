# 2026-06-26 Worktree Clean Expired Root Repair

## Problem

The project worktree dropdown exposes expired worktrees, but the header
`Clean expired` text is only a label. Operators must delete rows one by one.
For large Windows worktrees, deletion can also fail with
`git worktree remove --force ... timed out after 90000ms` because the low-level
remover lets Git own physical directory deletion under the shared `default`
Git hard timeout.

`expired` means "not bound to a live goal run". It does not prove that the
directory is small, unlocked, or already detached from Git.

## Existing Plans Recalled

- `specs/records/2026-06/2026-06-09-cwd-worktree-dropdown.md` introduced the dropdown,
  project-scoped list/delete API, and per-row delete controls.
- `specs/records/2026-06/2026-06-13-webui-worktree-delete-zombie-fix.md` fixed the
  registered-zombie case where `.git` linkage is already missing, but it
  explicitly left UI error/progress behavior for a later pass.

## Call Point Inventory

| Area                      | Current source                                                                         | Decision                                                                                                                                                                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI worktree dropdown      | `packages/overlay/src/components/TaskDirBar.tsx::ProjectWorktreeDropdown`              | Turn `Clean expired` into a real button, show batch and row deleting state, and keep all deletes routed through the worktree service.                                                                                                                            |
| Overlay worktree service  | `packages/overlay/src/services/worktree.ts`                                            | Add one sequential bulk helper that calls the same project delete endpoint for each directory. No second endpoint or alternate deletion source.                                                                                                                  |
| Project delete route      | `packages/opencorvus/src/server/routes/project.ts::DELETE /project/current/worktrees`  | Keep using `Worktree.removeProjectWorktree(...)` and sandbox cleanup.                                                                                                                                                                                            |
| Experimental delete route | `packages/opencorvus/src/server/routes/experimental.ts::DELETE /experimental/worktree` | Keep using the same `Worktree.removeProjectWorktree(...)`.                                                                                                                                                                                                       |
| Low-level remover         | `packages/opencorvus/src/worktree/index.ts::remove(...)`                               | Stop using `git worktree remove --force` for physical teardown. Delete the directory first; only after success run `git worktree prune`, verify the registry entry is gone, then delete the branch. This preserves retry visibility if directory deletion fails. |
| Isolated LKG cleanup      | `packages/opencorvus/src/acceptance/lkg-isolated-eval.ts::removeEvalWorktree(...)`     | Reuse `Worktree.remove(...)` so temporary eval worktrees do not keep a separate `git worktree remove --force` cleanup path.                                                                                                                                      |
| Git timeout helper        | `packages/opencorvus/src/util/git.ts`                                                  | Do not increase the generic default timeout. Remove worktree physical deletion from the helper's documented `default` intent.                                                                                                                                    |
| Tests                     | worktree, server route, overlay service/layout tests                                   | Add regressions proving registered worktree deletion does not call `git worktree remove`, bulk service preserves one API source, and UI exposes an actual cleanup button/loading state.                                                                          |

## Required Semantics

1. `Expired` worktrees are removable through a single visible button.
2. The batch button deletes only `status === "expired"` and `removable === true` rows.
3. The row delete button and batch button show in-progress state and disable the affected controls.
4. Backend physical deletion must not be wrapped by `git worktree remove --force`.
5. If physical directory deletion fails, the git worktree registry entry remains visible for retry.
6. After physical deletion succeeds, Git registry cleanup and branch deletion are still mandatory; failures remain hard errors.
7. No fallback deletion path, no alternate route, no silent success when the directory remains.
8. Temporary isolated eval worktree cleanup must use the same canonical remover instead of a second Git-owned physical deletion path.

## Verification Plan

```bash
bun test packages/opencorvus/test/project/worktree-remove.test.ts
bun test packages/opencorvus/test/engine/lkg-isolated-eval.test.ts
bun test packages/opencorvus/test/server/project-routes.test.ts -t "worktrees"
bun test packages/overlay/test/worktree-service.test.ts packages/overlay/test/task-cwd-row-layout.test.ts
```
