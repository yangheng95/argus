# Sessionless Goal Completion Phase Projection

## Recall

User request:

- Diagnose and fix the current overlay error:
  `source: task.select-from-list` / `goal phase <goal>/build/build missing buildSessionID`.
- The user is already simplifying the goal state contract and asked whether that simplification should solve this class of problem.
- Solve from the current repository state instead of adding frontend tolerance or compatibility.

Acceptance criteria:

- A sessionless manual goal completion (`goal_run_attempt.session_id == null`) is a completion fact/status projection, not a build-session phase.
- Any materialized goal build phase must have a concrete `buildSessionID`.
- Existing sessionless completion rows that already contain `time_started` must not materialize overlay build phase cards.
- `completeGoal` must not write a synthetic build start time when it creates or updates a sessionless manual completion.
- Real build attempts with `session_id` still project started/completed step and phase timing.
- No overlay fallback, no compatibility path, and no gate/routing bypass.
- Add focused regression tests for projection and writer behavior.

Hard constraints:

- No fallback or compatibility logic.
- No new git worktree.
- Do not restart, reload, or kill the running OpenCorvus / overlay process.
- Do not revert unrelated dirty worktree changes.
- Every code change must have a targeted test.
- Update the spec index and run the required docs health checks for the new record.

Read before implementation:

- `specs/records/2026-06/2026-06-30-goal-run-state-simplification.md`: goal-run persisted labels are durable audit/projection facts; semantic projection must have one source.
- `specs/records/2026-06/2026-06-30-retire-live-run-control-source.md`: live goal-run rows are not control facts; physical ownership/session facts remain protective.
- `packages/opencorvus/src/engine/workflow.ts`: `projectGoalSteps` currently propagates `tip.time_started` and `projectPhases` for every goal tip, regardless of `session_id`.
- `packages/opencorvus/src/engine/persist.ts`: `completeGoal` currently writes `time_started: now` for undispatched manual completion and preserves/synthesizes `time_started` when updating an existing tip.
- `packages/opencorvus/src/workbench/board.ts`: goal step payload reads `buildSessionID` only from `currentGoalRun(goalID).session_id`.
- `packages/overlay/src/services/tree-writer.ts`: `requireBuildPhaseSessionID` correctly fail-fasts when a materialized build phase has no `buildSessionID`.

Whole-repository grep evidence:

- `rg -n "projectGoalSteps|projectPhases|time_started|session_id" packages/opencorvus/src/engine/workflow.ts`
- `rg -n "completeGoal|goal_run_attempt|time_started|session_id" packages/opencorvus/src/engine/persist.ts`
- `rg -n "buildStepPayload|goalWorkflows|buildSessionID" packages/opencorvus/src/workbench/board.ts`
- `rg -n "buildSessionID|missing buildSessionID" packages/overlay/src/services/tree-writer.ts`
- `rg -n "complete_goal|completeGoal|manual_completion|time_started" packages/opencorvus/test/orchestrator/tools.test.ts`
- `rg -n "goalWorkflows|buildSessionID|completeGoal|compileBoard|goal_run_attempt" packages/opencorvus/test/workbench/board.test.ts`

Independent agent feedback:

- No sub-agent was spawned for this record. The current multi-agent tool policy only allows spawning when the user explicitly asks for sub-agents, delegation, or parallel agent work. This record therefore captures main-agent evidence from landed specs and whole-repository grep rather than inventing independent feedback.

## Decision

Goal build phase projection is session-owned.

`goal_run_attempt.status` can still project a goal step status such as `completed`, `failed`, or `running`, because that is the durable audit fact the board needs. But `startedAt`, `completedAt`, and declared per-phase projection represent a concrete build session surface in the overlay. They must only be emitted when the current tip has a non-empty `session_id`.

This is not a frontend fallback. It makes the backend board contract precise:

- sessionless manual completion: completed goal/step status, no build phase card;
- session-owned build attempt: step timing, phase timing, and `buildSessionID` travel together.

`completeGoal` should also stop creating future confusing rows by leaving `time_started` null whenever the completion is sessionless.

## Implementation Plan

1. Change `projectGoalSteps` so timing and `stepPhases` are emitted only for goal-run tips with a concrete `session_id`.
2. Change `completeGoal` so sessionless manual completion writes `time_started: null` on new rows and clears/preserves null for sessionless existing tips.
3. Update workflow projection tests:
   - session-owned build attempts still produce the build phase;
   - sessionless completed rows with stale `time_started` do not produce timing or phase projection.
4. Update `complete_goal` test coverage to assert manual sessionless completion has no synthetic start time.
5. Run focused tests plus spec/document health checks.

## Validation Plan

- `bun test packages/opencorvus/test/engine/workflow-integrity-step.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "complete_goal marks an undispatched goal complete through goal_run facts" --timeout 60000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/script/document-health.test.ts --timeout 60000`
