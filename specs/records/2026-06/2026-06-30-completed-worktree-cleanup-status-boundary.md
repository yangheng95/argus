# Completed Worktree Cleanup Status Boundary

Date: 2026-06-30

DB means Database. UI means User Interface. LSP means Language Server
Protocol.

## Recall

- User request: G2 passed but the task debug output marked it failed; after
  evidence showed worktree cleanup failed, the user asked why cleanup failed
  and why that failure marked the goal failed.
- Acceptance criteria:
  - A build goal that has already persisted `goal_run_attempt.status =
    completed`, `build_attempt_outcome.outcome_kind = delivered`, and a
    positive acceptance must remain passed when completed-worktree cleanup
    fails.
  - Completed-worktree cleanup failure must stay visible as a diagnostic fact
    and must keep the workspace pointer for later diagnosis or cleanup.
  - Cleanup failure must not be hidden as a fallback, retry, gate, or
    compatibility path.
  - Failed build attempts still keep their worktree and remain failed.
  - Successful completed-worktree cleanup still clears workspace fields.
- Hard constraints:
  - No fallback cleanup path, no retry loop, no delayed silent success.
  - Do not restart, kill, refresh, or otherwise disturb the user's running
    OpenCorvus or overlay process.
  - Do not use git reset or broad file restoration.
  - All code changes require targeted tests.
- Disk records read before implementation:
  - `specs/records/2026-06/2026-06-30-completed-worktree-immediate-reclaim.md`
  - `specs/records/2026-06/2026-06-29-build-outcome-and-visual-evidence-repair.md`
  - `specs/records/2026-06/2026-06-30-mcp-goal-worktree-convergence.md`
  - `packages/opencorvus/src/orchestrator/tools.ts`
  - `packages/opencorvus/src/engine/writer.ts`
  - `packages/opencorvus/src/engine/store.ts`
  - `packages/opencorvus/src/workbench/board.ts`
  - `packages/opencorvus/test/orchestrator/tools.test.ts`
- Incident evidence:
  - Task `tsk_f175ee0cc001ZEV3S05eVFSVGi`, goal
    `gol_f17833453002EeGmdHBuzzYp6a`, goal_run `984e2c10`.
  - DB timeline: the run first wrote `attempt-completed`,
    `build_attempt_outcome` label `delivered`, and `acceptance-goal_run`;
    later the same `goal_run_id` wrote `attempt-failed` with
    `completed worktree cleanup failed: WorktreeRemoveFailedError: EBUSY...`.
  - Logs show `Instance.dispose` completed, then `Worktree.remove` ran for
    about 25.6 seconds and failed with Windows `EBUSY` while removing the
    worktree root directory.
  - Logs before cleanup show repeated bash and LSP activity using the worktree
    as cwd or file root; the most likely physical cause is a still-open
    Windows directory or file handle. The code cannot identify the exact owner
    from the current log line.
  - A later retry logged `missing .git linkage`, showing cleanup/reattach left
    an invalid workspace pointer visible.
- Whole-repository grep evidence:
  - `cleanupGoalWorkspaceForGoal` is the single completed-worktree cleanup
    owner in `packages/opencorvus/src/engine/writer.ts`.
  - The build terminalization block in
    `packages/opencorvus/src/orchestrator/tools.ts` calls
    `finalizeBuildAttempt`, then calls `cleanupGoalWorkspaceForGoal` when the
    finalized status is `completed`.
  - The cleanup catch currently calls `updateGoalRun(... status: "failed")`
    and throws, causing a delivered goal to be projected as failed.
  - `packages/opencorvus/test/orchestrator/tools.test.ts` currently encodes
    that wrong behavior in the "goal build success fails visibly when completed
    workspace cleanup is refused" regression.
  - `findBuildOutcomeByGoalRun` and acceptance readers already keep positive
    delivery evidence separate from goal_run status facts.
- Independent agent feedback: no sub-agent was spawned because the current
  tool policy only authorizes sub-agents when explicitly requested. The DB,
  logs, and repository call-point evidence are sufficient for this scoped
  correction.

## Root Cause

There are two separate failures.

The physical cleanup failed because Windows refused removal of the worktree
root with `EBUSY`. The cleanup path had already disposed the OpenCorvus
instance state. However, the same build session had recently used that
directory for bash cwd and LSP/file access. A remaining process cwd or file
handle is consistent with the observed `EBUSY` and the long remove duration.

The status failure is a modeling bug. A completed build terminalization is the
source of build acceptance. Worktree cleanup is a post-delivery lifecycle
operation. The current catch block appended a new terminal
`goal_run_attempt.status = failed` for cleanup failure, overwriting the
projection from the already-persisted delivered outcome and acceptance.

## Repair Plan

1. Keep `finalizeBuildAttempt(status="completed")` as the authoritative build
   terminalization fact.
2. On completed-worktree cleanup failure, do not call `updateGoalRun` with
   `status="failed"` and do not throw from the background build finalizer.
3. Close any still-live build tool ownership as failed with the cleanup error
   so no live ownership blocks future scheduling. In the async per-goal build
   path this is usually already closed when dispatch returns, so the durable
   diagnostic must be the decision-log entry below.
4. Add a decision-log diagnostic entry for the cleanup failure, keyed by
   `completed_worktree_cleanup_failed_<goal_run_id>`.
5. Update the existing refused-cleanup test to assert the goal remains passed,
   the workspace pointer remains visible, ownership is closed, and the
   diagnostic decision-log entry exists.
6. Keep existing success cleanup and failed build worktree-preservation tests.

## Required Verification

- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "goal build success reclaims|goal build failure keeps|goal build success records completed workspace cleanup refusal"`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `git diff --check`
