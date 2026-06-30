# Retire Live Run Control Source

## Recall

User request:

- The two TradingView economy tasks exposed live-run/live-goal-run problems: arbitrary agent cancellation, parent tasks remaining active after all goals passed, and `complete_goal` being unable to mark work complete.
- Remove the live run mechanism as a control mechanism.
- Use an adversarial repair/review flow with independent agents.

Acceptance criteria:

- A durable `run` or `goal_run_attempt` row in a live lifecycle status is not by itself allowed to block `modify_goal`, `complete_goal`, `delete_goal`, task wake, or build redispatch.
- Real executing work still cannot be overwritten: live `orchestrator_tool_ownership`, active current-process `SessionStatus` (`streaming` / `retry`), and proven non-orphan owner evidence remain the control facts.
- `complete_goal` can close a stale live `goal_run` without asking the model to cancel an agent that no longer has live ownership.
- Duplicate build protection remains for a goal that has live build ownership or an active build session.
- Cancellation tools remain explicit control tools; `cancel_subagent(goal_id)` must not treat an audit-only latest tip as a controllable worker.
- Tests cover both sides: stale live rows do not block, real live worker facts do block.

Hard constraints:

- No fallback / compatibility route. Replace the old control source; do not keep parallel live-row blocking.
- No blind patch. Preserve durable audit facts and ownership/session protection.
- No new git worktree.
- Do not touch unrelated dirty worktree changes.
- Every code change must have focused regression coverage.
- Worktree GC preservation is physical cleanup protection, not the live-run control mechanism being removed.

Read before implementation:

- `specs/current/architecture/02-data.md`: `engine_artifact` is the single process table; `goal_run_attempt` payload is the source for per-attempt state and workspace pointers.
- `specs/current/architecture/03-control.md`: control surface is visible message/tool/action flow.
- `specs/current/architecture/10-worktree-lifecycle.md`: worktrees remain useful repair evidence; deletion must be through the owning cleanup path.
- `specs/current/architecture/16-unified-teardown.md`: orchestration control facts are durable messages/tool results/artifacts/task board/operator interactions/worktree ownership, not hidden workflow state.
- `specs/records/2026-06/2026-06-06-goal-run-owner-pid-liveness.md`: duplicate builds happened when owner PID liveness was misclassified; keep physical owner liveness protection.
- `specs/records/2026-06/2026-06-13-build-steer-live-ownership-interrupt-fix.md`: operator wakes must not arbitrarily cancel live child tool executions.
- `specs/records/2026-06/2026-06-27-active-run-projection-retry-convergence.md`: `activeRunID` is projection, not a scheduler control cache.
- `specs/records/2026-06/2026-06-29-build-outcome-and-visual-evidence-repair.md`: root tool ownership is dispatch ownership; child build liveness is durable goal/session/build evidence.
- `specs/records/2026-06/2026-06-29-orchestrator-goal-complete-delete-tools.md`: existing `complete_goal`/`delete_goal` plan currently rejects live goal_run facts and must be revised by this record.

Whole-repository search evidence:

- `rg -n "live goal_run|LIVE_GOAL_RUN_STATUSES|LIVE_RUN_STATUSES|findLiveGoalRun|assertNoLiveGoalRun|goalMutationBlockedByLiveWork|already has live goal_run|activeRunID|live run" packages specs --glob '!node_modules/**'`
- `rg -n "beginBuildAttempt|completeGoal\\(|deleteGoal\\(|modify_goal|complete_goal|delete_goal|cancel_subagent|findLiveBuildOwnershipByGoal|SessionStatus" packages/opencorvus/src packages/opencorvus/test --glob '!node_modules/**'`
- Primary implementation points: `packages/opencorvus/src/orchestrator/tools.ts`, `packages/opencorvus/src/engine/persist.ts`, `packages/opencorvus/src/engine/queue.ts`.
- Primary tests to update/add: `packages/opencorvus/test/orchestrator/tools.test.ts`, `packages/opencorvus/test/engine/begin-build-attempt-supersede.test.ts`, `packages/opencorvus/test/engine/queue.test.ts`.

Independent agent feedback:

- Test audit agent: existing tests encode raw `goal_run.status` as a control gate. Replace those assertions with stale-row positive tests and live-ownership/active-session refusal tests. Keep `cancel_subagent recover_stale` no-owner refusal and worktree GC preservation.
- Architecture audit agent: the change is sound only if stale live rows stop controlling scheduling/mutation while live tool ownership, active session/process ownership, and owner-orphan evidence remain protective. It warned against deleting all live protections and called out duplicate builds, wrong cancellation targets, unsafe worktree deletion, and runtime starvation as risks.

## Decision

`run` and `goal_run_attempt` live statuses are durable audit/projection facts. They are not a control source.

The control source for in-flight work becomes:

- live `orchestrator_tool_ownership` for build/integrity tool calls;
- current-process active build session latch (`SessionStatus` is `streaming` or `retry`) tied to the goal;
- owner-stamp orphan predicate when deciding whether a previous running attempt can be retired during explicit build redispatch.

This is not a fallback. It is a source replacement: status-only rows stop blocking, while real worker facts still block.

## Implementation Plan

1. Replace `orchestrator/tools.ts` raw live-goal-run guards with an active goal-work resolver:
   - mutation tools refuse live build ownership;
   - mutation tools refuse active build sessions tied to the goal;
   - mutation tools ignore stale live rows with no ownership and no active session.
2. Change `completeGoal` so it can mark the latest tip completed even if that tip is in a live status. The caller is responsible for live worker protection before calling it.
3. Change `beginBuildAttempt` so a prior live tip:
   - refuses when live build ownership exists;
   - refuses when its build session is active in the current process;
   - retires owner-orphaned tips as before;
   - retires audit-only stale live tips and opens the new attempt.
4. Keep task queue wake blocking based on live tool ownership. Add a regression that stale live goal_run alone returns `started`.
5. Tighten `cancel_subagent(goal_id)` so goal-id resolution requires a controllable live/active latest attempt rather than any latest audit tip.

## Validation Plan

- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "live build ownership blocks|stale live goal_run|complete_goal completes stale|delete_goal deletes stale|active build session blocks|goal build rejects duplicate"`
- `bun test packages/opencorvus/test/engine/begin-build-attempt-supersede.test.ts`
- `bun test packages/opencorvus/test/engine/queue.test.ts --test-name-pattern "stale live goal_run alone"`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
