# Merge Never Crash Plan

**Status**: Implemented (2026-05-01)

## Goal

Make merge publication a total, non-crashing protocol. Any possible merge condition must return a typed, persisted, user-visible outcome and preserve enough repository state for the next attempt to continue. This does not mean conflicts disappear. It means conflicts, dirty trees, invalid worktrees, detached HEAD, missing refs, concurrent primary updates, binary conflicts, and tool/session termination never crash the orchestrator or silently discard work.

## Invariant

There is exactly one merge authority: `Worktree.mergeWithMerge`. Every caller receives one normalized result:

- `merged`: published to primary.
- `conflict`: worktree is preserved in `MERGING`; conflict paths are recorded.
- `blocked`: preflight or repository state prevents merge from starting.
- `infra_error`: git/tool/runtime failure outside normal repository states.

No caller may interpret thrown git errors directly. Throws are only internal implementation details caught at the boundary and converted into this result shape.

## Current Failure Class

The existing merge design leaves textual conflicts in the goal worktree and has convergence tests. That solves the old rebase loop. The remaining failure class is broader:

- Build sessions can end without a valid terminal report.
- `merge_back` can be skipped or never reached.
- Dirty worktrees can be treated as generic build failures instead of resumable blocked merge states.
- Binary or generated files can poison merge/push.
- Existing callers still depend on exceptions for control flow.

## Design

### 1. Introduce `MergeOutcome`

Add a canonical type near `Worktree.mergeWithMerge`:

```ts
type MergeOutcome =
  | { status: "merged"; primaryBranch: string; primaryHead: string }
  | {
      status: "conflict"
      branch: string
      primaryBranch: string
      primaryTip: string
      conflictPaths: string[]
      worktreeDir: string
    }
  | {
      status: "blocked"
      branch: string
      reason: string
      worktreeDir: string
      dirtyPaths?: string[]
      mergeHead?: boolean
    }
  | { status: "infra_error"; branch: string; reason: string; stderr?: string; worktreeDir?: string }
```

Keep the current `MergeConflictError` / `MergeFailedError` only inside `Worktree`, then expose a new public `mergeSafely` wrapper that always resolves to `MergeOutcome`.

### 2. Make `merge_back` Return Outcomes Only

The build tool's `merge_back` must call `Worktree.mergeSafely`, not catch raw errors. Its output should be the exact `MergeOutcome` translated to tool JSON. No exception from merge should escape into the LLM/session loop.

### 3. Persist Every Non-Merged Outcome

For `conflict`, `blocked`, and `infra_error`, write a merge attempt record into goal/run state:

- goal ID
- session ID
- branch
- worktree directory
- outcome status
- reason
- conflict or dirty paths
- primary tip
- timestamp

The next build attempt must render this record into retry context and reuse the same recorded worktree.

### 4. Treat Missing Terminal Report as Resumable

If a build session ends without valid `report_build_result`, do not collapse it to a generic failure. Inspect the worktree:

- `MERGE_HEAD` exists -> `conflict`
- dirty tree -> `blocked`
- clean tree with unmerged goal commits -> `blocked` with reason `merge_back_not_completed`
- clean and published -> `merged`

This prevents “LLM forgot to call merge_back” from looking like a merge crash.

### 5. Add a Preflight Gate

Before merge:

- primary worktree must be clean
- goal worktree must be valid
- branch must exist
- worktree must be on expected branch
- no half-recorded `workspace_dir` / `workspace_branch`
- no tracked generated DB/log/output files in the candidate change set unless explicitly allowed

Failures return `blocked`, never throw.

### 6. Handle Binary and Generated Files Explicitly

Add repository policy:

- runtime DB files are ignored or stored outside the repo
- benchmark logs are ignored
- binary tracked files either get `merge=binary` or are removed from normal task publication

This removes fake merge failures caused by generated state.

### 7. Serialization Around Primary Publication

Keep the per-project git lock. Under that lock:

1. refresh primary tip
2. merge primary into goal
3. if conflict, return `conflict`
4. ff publish goal into primary
5. if ff fails because primary moved, loop once by returning a structured `blocked` or retrying inside the lock with a bounded retry count

No unbounded retry loop.

### 8. Tests

Add focused tests for:

- clean merge returns `merged`
- textual conflict returns `conflict` and leaves `MERGE_HEAD`
- unfinished `MERGE_HEAD` before merge returns `blocked`
- dirty goal worktree returns `blocked` and preserves files
- dirty primary worktree returns `blocked`
- missing branch returns `blocked` or `infra_error`, not throw
- binary conflict returns structured outcome
- build session without terminal report maps to resumable merge state
- concurrent merge calls do not throw uncaught errors

## Acceptance

- Done: `Worktree.mergeSafely` is the public non-crashing boundary for merge publication.
- Done: in-process build `merge_back` routes through `mergeSafely` and returns typed tool output.
- Done: external executor host merge routes through `mergeSafely` and records typed tool output.
- Done: non-merged outcomes flow into the existing BuildResult error field, which `finalizeBuildAttempt` persists into the goal_run attempt.
- Done: conflict worktrees remain physically present and reusable.
- Done: focused tests cover clean merge, textual conflict, dirty blocked worktree, and existing convergence.
- Remaining: repository policy should separately remove tracked runtime DB and benchmark output from normal publication paths.
