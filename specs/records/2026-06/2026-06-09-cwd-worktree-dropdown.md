# CWD Row Worktree Dropdown

## Requirement

Add a compact worktree dropdown on the same row as the cwd control. It lists the git worktrees that exist for the current project. If a listed worktree is bound to a live goal, show the goal id. If it is not bound to a live goal, mark it expired. Provide delete for removable worktrees.

## Call Point Sweep

| Area                                                       | Existing source                                                                               | Decision                                                                                                         |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `TaskDirBar.tsx`                                           | Owns cwd row, recent cwd popup, VCS badge, workspace launchers.                               | Add the worktree dropdown beside the cwd dropdown in the same compact row.                                       |
| `GoalWorkflowGroup.tsx`                                    | Per-goal card still displays that goal's workspace from `board.goalWorkflows[].workspaceDir`. | Keep unchanged; this remains per-goal detail, not the project worktree list.                                     |
| `Worktree.remove`                                          | Existing canonical deletion path that removes git worktree and branch.                        | Reuse for deletion; do not add a second removal implementation.                                                  |
| `findGoalLatestWorkspace` / `listGoalWorkspacesForProject` | Existing artifact-backed goal workspace source.                                               | Reuse for goal binding; extend the read to include latest run status.                                            |
| `ProjectRoutes`                                            | Current project API.                                                                          | Add `/project/current/worktrees` list and delete endpoints, project-scoped through existing Instance middleware. |
| `api-directory-injection.test.ts`                          | Enumerates routes that should not receive directory.                                          | New project route needs directory injection; no bypass entry.                                                    |

## Design

Backend:

- `Worktree.listProjectWorktrees(projectID)` runs `git worktree list --porcelain`, parses actual registered worktrees, and joins to latest goal workspace artifacts by canonical directory.
- Binding is active only when latest goal-run status is live (`isLiveGoalRunStatus`). Otherwise the worktree is returned as `expired`.
- Primary worktree is listed for visibility but marked non-removable.
- `DELETE /project/current/worktrees` calls existing `Worktree.remove({ directory })`.

Frontend:

- Add `services/worktree.ts` as the typed client.
- Add `ProjectWorktreeDropdown` to `TaskDirBar.tsx` beside the cwd dropdown and VCS badge.
- Use existing icon primitive. Controls remain single-row compact.

## Tests

- Backend project route test for list bindings and delete wiring.
- Overlay service test for request paths and methods.
- Existing cwd row layout test extended to assert the new dropdown sits in `TaskDirBar`.
