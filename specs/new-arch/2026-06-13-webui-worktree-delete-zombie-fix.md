# Web UI Worktree Delete Zombie Fix

## Evidence

- `/project/current/worktrees` for `economy_4` lists many expired worktrees and one active worktree.
- At least one listed expired worktree still appears in `git worktree list --porcelain`, but its worktree `.git` linkage is missing and git reports `prunable gitdir file points to non-existent location`.
- `Worktree.remove()` has tests for a failed `git worktree remove --force` after detach, but not for an entry that is still registered while the per-worktree `.git` file is already gone.
- `ProjectRoutes DELETE /project/current/worktrees` calls `Worktree.remove()` but does not mirror the older experimental route's `Project.removeSandbox(...)` cleanup.

## Call Point Sweep

| Area | Current behavior | Decision |
| --- | --- | --- |
| `Worktree.remove()` | Registered entries always try `git worktree remove --force` first. | If the registered entry lacks `.git` linkage, prune the broken registry entry, verify it disappeared, then clean the directory and delete the branch. |
| `ProjectRoutes DELETE /project/current/worktrees` | Removes git worktree only. | Also remove the project sandbox pointer after successful worktree removal. |
| `ExperimentalRoutes DELETE /experimental/worktree` | Removes worktree and sandbox pointer. | Leave unchanged; it is the existing parity source. |
| `ProjectWorktreeDropdown` | Logs deletion errors but does not render them. | Leave for a separate UI pass to avoid touching currently dirty overlay files. |

## Tests

- Extend `Worktree.remove` tests with the missing-git-link registered zombie case.
- Extend project route delete test to seed a sandbox pointer and assert it is removed.
