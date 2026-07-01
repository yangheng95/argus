# Goal Mutation Running Session Activity Boundary

Date: 2026-06-30

DB means Database. EBUSY means error busy, the Windows file-system error for a
resource that is still locked or in use.

## Recall

- User request: the operator only asked the agent to mark goals completed when
  deletion of a worktree failed, but running goals were also marked completed.
  Inspect the DB conversation and tool calls, trace the cause, and prevent the
  same pattern later.
- Acceptance criteria:
  - `complete_goal`, `delete_goal`, and `modify_goal` must not mutate a goal
    whose latest live `goal_run_attempt` is tied to a build session that still
    has durable session message or part activity.
  - A completed/delivered goal that later received an EBUSY cleanup failure
    remains recoverable by explicit `complete_goal`, because the latest attempt
    is terminal failed rather than live running.
  - A stale live goal-run row with no live ownership, no current-process active
    `SessionStatus`, no live foreign owner, and no durable build-session
    transcript remains manually completable.
  - The refusal must explain the observed durable session activity so the
    orchestrator can wait for terminal build evidence or explicitly cancel the
    stale worker before completing the goal.
  - Runtime DB repair is out of scope for this patch; the production DB is read
    only during investigation unless the user explicitly asks to mutate it.
- Hard constraints:
  - No fallback path, retry loop, compatibility route, or prompt-only patch.
  - Do not treat raw live `goal_run_attempt.status` as the control source by
    itself; preserve the 2026-06-30 retirement of live rows as control facts.
  - Do not restart, kill, refresh, or otherwise disturb the user's running
    OpenCorvus or overlay process.
  - No git reset and no new git worktree.
  - Every code change must have focused regression coverage.
- Disk records read before implementation:
  - `specs/records/2026-06/2026-06-30-retire-live-run-control-source.md`
  - `specs/records/2026-06/2026-06-30-completed-worktree-cleanup-status-boundary.md`
  - `specs/records/2026-06/2026-06-29-orchestrator-goal-complete-delete-tools.md`
  - `specs/records/2026-06/2026-06-30-goal-run-state-simplification.md`
  - `specs/records/2026-06/README.md`
  - `packages/opencorvus/src/orchestrator/tools.ts`
  - `packages/opencorvus/src/engine/persist.ts`
  - `packages/opencorvus/src/session/session.sql.ts`
  - `packages/opencorvus/test/orchestrator/tools.test.ts`
- Runtime DB evidence:
  - Task `tsk_f175ee0cc001ZEV3S05eVFSVGi` showed goals 8 and 9 as `passed`
    with zero changed files, no commits, no `build_attempt_outcome`, and no
    acceptance.
  - `decision_log` at `2026-06-30 09:18:53` marked goal 8 complete from
    previous status `running` with reason "may be stuck"; `2026-06-30
    09:18:54` did the same for goal 9.
  - `engine_artifact.kind="goal_run_attempt"` shows goal 8 run `66f3fd83`
    and goal 9 run `9ebe2e1c` were opened as `running` at `09:13:34`, then
    manually completed at `09:18:53` and `09:18:54`. There was no terminal
    build outcome for those goal runs at that time.
  - The parent orchestrator session first correctly reported no EBUSY-failed
    goals and that goals 7, 8, and 9 were running. After the operator repeated
    "worktree deletion problems should all be completed", the model
    overgeneralized and called `complete_goal` for goals 7, 8, and 9.
  - Goal 7 was a valid manual completion target: run `bca6c3b7` had a
    delivered `build_attempt_outcome` at `09:17:48`, acceptance at `09:17:48`,
    then an EBUSY cleanup failure at `09:18:16`.
  - Goal 8's build session `ses_0e83fa9f7ffeillwmC5bzuNliv` continued writing
    parts through `09:22:09`; goal 9's build session
    `ses_0e8373233ffeGryudVVUxGBNZm` continued writing parts through
    `09:22:11`.
- Whole-repository grep evidence:
  - `complete_goal`, `delete_goal`, and `modify_goal` share
    `goalMutationBlockedByLiveWork` in `packages/opencorvus/src/orchestrator/tools.ts`.
  - `completeGoal` in `packages/opencorvus/src/engine/persist.ts` also calls
    `liveGoalRunControlBlocker`, which currently checks live build ownership,
    current-process active `SessionStatus`, and live foreign owner facts.
  - Session transcript rows live in `message` and `part`, exported as
    `MessageTable` and `PartTable` from
    `packages/opencorvus/src/session/session.sql.ts`.
  - Existing stale live tests in `packages/opencorvus/test/orchestrator/tools.test.ts`
    create a live `goal_run_attempt` with no transcript activity; those tests
    should remain green to preserve the live-row retirement contract.

## Root Cause

The direct trigger was a bad orchestrator decision. The model first understood
the boundary correctly, then later generalized the operator's EBUSY instruction
from "worktree-deletion failures" to "running or possibly stuck retries".

The deeper system bug is that the mutation tool contract had no durable
transcript activity precondition. It treated live build ownership,
current-process `SessionStatus`, and live foreign owner facts as sufficient
proof of executing work. In this incident, ownership had already closed and the
current orchestrator process did not expose an active `SessionStatus`, while
the child build sessions were still writing durable message and part rows.
Therefore the tool accepted the model's bad completion call and wrote
`attempt-completed` facts for running work.

## Repair Plan

1. Add a single helper that reads the latest durable message/part activity for
   the latest live goal-run's `session_id`.
2. Use that helper inside `goalMutationBlockedByLiveWork` before a goal
   mutation proceeds.
3. Keep raw live status alone non-blocking: a live tip with no live ownership,
   no active session, no live foreign owner, and no durable transcript activity
   remains stale-row repairable.
4. Add a regression where a running goal-run has no live ownership or active
   `SessionStatus`, but its build session has a persisted message and part;
   `complete_goal` must refuse and leave the run `running`.
5. Re-run the existing stale live completion and live ownership refusal tests.

## Validation Plan

- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "complete_goal refuses running goal_run with durable build session activity|complete_goal completes stale live goal_run|complete_goal and delete_goal refuse live build ownership" --timeout 60000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 60000`
- `git diff --check`
