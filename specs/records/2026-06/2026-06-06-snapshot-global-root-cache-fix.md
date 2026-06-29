# Snapshot global root cache fix

## Problem

`Snapshot.track()` decides whether to run by checking `Project.isGitRepo(Instance.directory)`, but the snapshot git directory is built from `Instance.project.worktree` via `ProjectRuntimePaths.snapshotCacheRoot(project.worktree, project.id)`.

When those two sources diverge, a directory-scoped git probe can allow snapshot initialization while the project record still points at the global pseudo-project (`id="global"`, `worktree="/"`). On Windows this can drive git toward `/.opencorvus/runtime/cache...` and fail with:

`snapshot init failed: fatal: Invalid path '/.opencorvus/runtime/cache': No such file or directory`

## Call Points

| Surface                                                                 | Current behavior                                                                  | Decision                                                                                                       |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `Snapshot.track()`                                                      | Checks `Instance.directory`, then writes cache under `Instance.project.worktree`. | Replace the predicate with the project worktree source and skip the global pseudo-project.                     |
| `Snapshot.patch()` / `restore()` / `revert()` / `diff()` / `diffFull()` | Consume hashes emitted by `track()` or explicit debug commands.                   | No direct change; preventing global `track()` avoids producing invalid hashes in normal message/session flows. |
| `executor/managed.ts` submit/acceptance                                 | Uses `track()` for before/after diffs.                                            | Inherits fixed skip behavior; existing `undefined` start hash path remains unchanged.                          |
| `session/processor.ts` step-start/finish                                | Uses `track()` and then `patch()` when a hash exists.                             | Inherits fixed skip behavior; no hash means no patch attempt.                                                  |
| `engine/git.ts` baseline checkpoint                                     | Uses `track()` only after git baseline state.                                     | Inherits fixed predicate; real git projects still snapshot normally.                                           |
| `tool/edit.ts`                                                          | Imports `Snapshot` for edit evidence downstream.                                  | No direct change.                                                                                              |
| `cli/cmd/debug/snapshot.ts`                                             | Direct debug access to snapshot commands.                                         | No direct change; debug commands keep surfacing real errors.                                                   |

## Test

Add a regression test that provides a non-git/global instance, simulates the old directory-level git predicate returning true, and asserts `Snapshot.track()` returns `undefined` without launching git. This pins the single-source predicate and prevents root cache initialization.
