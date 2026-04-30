# Worktree Merge Single Source

**Status**: Implementing (2026-04-30)

## Root Cause

Worktree merge loops were caused by two competing merge protocols:

- `Worktree.mergeWithMerge` leaves textual conflicts in the goal worktree's real `MERGING` state so the build agent can edit conflict markers, `git add`, and `git commit` at the topology join point.
- `merge_arbitrate` / `Worktree.resolveAndMerge` independently aborted or reset that state, chose sides from the host, and then manufactured a merge commit. That is a second source of truth for integration.
- The external executor path added a third protocol violation by `commitDirty` host auto-committing whatever the executor left uncommitted, then aborting `MERGING` conflicts before returning failure.
- Goal retries did not consistently reuse `engine_goal.workspace_dir` / `workspace_branch` as the live worktree source, so a retry could start from a different branch than the one holding the actual merge state.

This violates the project no-fallback and no-double-source rules. The fix is not another conflict strategy. The fix is to make one protocol authoritative.

## Authoritative Protocol

1. The agent owns all code commits in its worktree.
2. The host may run `mergeWithMerge` to publish, but the host must not create build commits on behalf of the agent.
3. A textual merge conflict stays in the same worktree in `MERGING` state. The next build attempt must reuse that worktree, resolve markers in place, `git add`, `git commit`, then call/publish merge again.
4. `engine_goal.workspace_dir` and `engine_goal.workspace_branch` are the live source for goal retries. If one is present without the other, or the recorded worktree is invalid, fail loudly instead of silently creating a replacement.
5. The only merge completion function is `Worktree.mergeWithMerge`.

## Implementation Scope

- Delete host auto-commit: remove `Worktree.commitDirty` and its tests.
- Delete the second merge resolver: remove `ResolveStrategy`, `Worktree.resolveAndMerge`, and the orchestrator `merge_arbitrate` tool.
- External executors must return a failed build if the worktree is dirty or conflicted, preserving the worktree for retry. No `git merge --abort`.
- BuildAgent accepts a managed goal worktree supplied by the orchestrator and still exposes/publishes through the same merge protocol.
- The orchestrator passes recorded `goal.workspace_dir` / `workspace_branch` into BuildAgent and records new worktrees back to `engine_goal`.

## Acceptance

- `rg "commitDirty|resolveAndMerge|merge_arbitrate"` finds no implementation or caller references.
- A dirty external-executor worktree fails merge with an actionable message and remains dirty for the next agent attempt.
- A conflict from external merge leaves `MERGE_HEAD` and conflict markers in place.
- Goal build retries reuse `engine_goal.workspace_dir` / `workspace_branch`.
- Successful task publish cleans goal worktrees before marking the task completed.
- Physical cleanup failure keeps `engine_goal.workspace_dir` / `workspace_branch` intact and surfaces an error.
- Existing merge convergence tests still pass, and new tests cover no host auto-commit.
