# Completed Worktree Immediate Reclaim

Date: 2026-06-30

DB means Database. GC means Garbage Collection. API means Application
Programming Interface. SDK means Software Development Kit.

## Recall

- User request: "把opencorvus的worktree改成completed的worktree当场回收，这是之前已经有的设计，但现在worktree都挤压了".
- Acceptance criteria:
  - A goal-scoped managed worktree whose latest goal_run becomes `completed`
    is reclaimed during the same build terminalization path, not only by
    delayed GC or final `complete_task` cleanup.
  - Failed, aborted, cancelled, blocked, or otherwise non-completed goal_run
    worktrees remain available for retry and diagnosis.
  - Cleanup uses the existing single owner:
    `engine/writer.ts::cleanupGoalWorkspaceForGoal`, which calls
    `goal/runner.ts::cleanupGoalWorkspace`.
  - Cleanup failure must not clear `workspace_dir`, `workspace_branch`, or
    `workspace_base_ref`; the remaining worktree pointer stays visible.
  - No fallback worktree path, no randomized replacement suffix, no new
    cleanup policy in overlay, recovery, or GC.
- Hard constraints:
  - No broad git reset or destructive repository rollback.
  - Do not create a new git worktree for this repair.
  - Do not restart, kill, refresh, or otherwise disturb the user's running
    OpenCorvus or overlay process.
  - All code changes require targeted tests.
  - Spec records must stay under `specs/records/2026-06/` and this record must
    stay indexed from `specs/records/2026-06/README.md`.
- Disk records read before implementation:
  - `specs/README.md`
  - `specs/records/2026-06/README.md`
  - `specs/current/architecture/10-worktree-lifecycle.md`
  - `specs/records/2026-06/2026-06-13-webui-worktree-delete-zombie-fix.md`
  - `specs/records/2026-06/2026-06-30-mcp-goal-worktree-convergence.md`
  - `packages/opencorvus/src/worktree/gc.ts`
  - `packages/opencorvus/src/worktree/index.ts`
  - `packages/opencorvus/src/engine/writer.ts`
  - `packages/opencorvus/src/goal/runner.ts`
  - `packages/opencorvus/src/engine/persist.ts`
  - `packages/opencorvus/src/orchestrator/tools.ts`
  - `packages/opencorvus/test/engine/writer.test.ts`
  - `packages/opencorvus/test/project/worktree-gc.test.ts`
  - `packages/opencorvus/test/project/worktree-create-reclaim.test.ts`
  - `packages/opencorvus/test/orchestrator/tools.test.ts`
- Whole-repository grep evidence:
  - `cleanupGoalWorkspaceForGoal` is defined in
    `packages/opencorvus/src/engine/writer.ts`, tested in
    `packages/opencorvus/test/engine/writer.test.ts`, and currently called by
    task-terminal cleanup in `packages/opencorvus/src/orchestrator/tools.ts`.
  - `finalizeBuildAttempt` is called from the build terminalization block in
    `packages/opencorvus/src/orchestrator/tools.ts`; that is the per-goal
    completed status write boundary.
  - `WorktreeGC.inspect` uses delayed retention and old-clean / zombie /
    prunable criteria. It is not the right owner for immediate completed
    worktree cleanup.
  - `packages/opencorvus/test/orchestrator/tools.test.ts` contains the
    contradictory assertion "goal build success preserves the completed
    worktree for later retries".
  - Existing writer tests already assert completed cleanup deletes the physical
    worktree and clears workspace fields, preserves non-completed worktrees,
    and keeps workspace fields when cleanup is refused.
- Independent agent feedback: none. The local architecture record, existing
  writer tests, and call-point sweep are sufficient for this scoped repair.

## Root Cause

The worktree lifecycle contract says completed goal worktrees are eligible for
single-owner cleanup after the successful result has been recorded. The lower
level owner already exists and is tested, but the active goal build path only
finalizes the goal_run and records build evidence. It then waits until
`complete_task` / `fail_task` or delayed GC to reclaim terminal workspaces.

That gap lets successful per-goal worktrees accumulate while a long task keeps
building, reviewing, or waiting for final integrity. The contradictory
orchestrator test locked in the accumulation by asserting that successful
worktrees remain available for later retries.

## Call-Point Decisions

| Call point | Current behavior | Decision |
| --- | --- | --- |
| `orchestrator/tools.ts` build terminalization | Calls `finalizeBuildAttempt` after `BuildAgent.run`; success leaves the workspace pointer. | After a successful `completed` finalize, call `cleanupGoalWorkspaceForGoal(attachedGoalID)` immediately. |
| `engine/writer.ts::cleanupGoalWorkspaceForGoal` | Reads latest workspace, gates on latest status `completed`, deletes through `goal/runner`, then clears workspace fields. | Reuse unchanged as the single cleanup owner. |
| `goal/runner.ts::cleanupGoalWorkspace` | Deletes managed worktrees through `Worktree.remove`; refuses paths outside managed roots and keeps caller-visible failure. | Reuse unchanged. |
| `worktree/gc.ts` | Delayed orphan and residue sweep with retention criteria. | Leave as delayed residue cleanup, not the completed lifecycle owner. |
| `modify_goal` retry intent | Records retry intent and preserves completed workspace pointer. | Leave unchanged for historical pointers; immediate build cleanup will clear new completed pointers before this path. |
| Failed build finalize | Records failed status and keeps workspace pointer. | Leave unchanged for retry and diagnosis. |

## Implementation Plan

1. Add a small helper in the build terminalization scope that invokes
   `cleanupGoalWorkspaceForGoal` only after `finalizeBuildAttempt` writes
   `status="completed"`.
2. Do not call cleanup for failed build results, thrown build results, or stale
   invalidated goal_run results.
3. Let cleanup errors throw from the background terminalization promise after
   the writer preserves workspace fields. The existing background error log and
   tests should expose the failure; do not hide it with an alternate cleanup
   path.
4. Update the orchestrator success test to assert physical removal and cleared
   workspace fields.
5. Keep the failure test asserting physical worktree and workspace pointer
   preservation.
6. Update the refused-path success test to assert the cleanup refusal leaves
   the workspace pointer and surfaces through the background terminalization
   failure instead of pretending successful cleanup.
7. Close build tool ownership as `failed` when completed worktree cleanup is
   refused. A visible cleanup failure must not leave a live ownership record
   that blocks future same-goal work.
8. Export the test DB lock diagnostic timeout from `test/fixture/db.ts` and
   use it as the outer hook timeout in affected worktree lifecycle tests. This
   keeps Bun's test watchdog from killing active DB lock diagnosis before the
   fixture can either finish cleanup or emit its specific failure.

## Required Verification

- `bun test packages/opencorvus/test/engine/writer.test.ts`
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "goal build success|goal build failure keeps|goal build returns started|background finalize failure"`
- `bun test packages/opencorvus/test/project/worktree-gc.test.ts`
- `bun test packages/opencorvus/test/project/worktree-create-reclaim.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check`
