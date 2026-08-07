# Goal Run State Simplification

## Recall

User request:

- Continue the adversarial cooperative refactor after retiring live-run as a control mechanism.
- Challenge whether `goal` needs complex runtime state at all; prefer contract data plus current status/id projections.
- Improve stability by removing duplicated state management instead of adding gates, fallback paths, or lifecycle state machines.

Acceptance criteria for this increment:

- `engine_goal` remains contract data only; current goal status/id stay derived from goal-run attempt artifacts.
- Raw `goal_run.status` labels remain durable audit/projection facts, not orchestration control facts.
- State classification has one source in `engine/catalog.ts`; call sites must not hand-code duplicate terminal/live/projection sets.
- Do not rewrite historical artifact payloads or collapse persisted enum values in this patch.
- Preserve physical protections: live tool ownership, active build session, live foreign owner, explicit cancellation, owner-orphan evidence, and worktree cleanup ownership.
- Add focused tests for the new single-source projection helper and the removed hard-coded terminal classification.

Hard constraints:

- No fallback or compatibility route.
- No new git worktree.
- Do not touch unrelated dirty files.
- Every code change must be tested.
- Commit and push after verification.

Read before implementation:

- `specs/records/2026-06/2026-06-30-retire-live-run-control-source.md`: live `run` / `goal_run_attempt` statuses are audit/projection facts; control comes from ownership/session facts.
- `specs/current/architecture/02-data.md`: `engine_goal` has no status/workspace/retry runtime columns; `goal_run_attempt` payload is the per-attempt source.
- `specs/current/architecture/03-control.md`: control is visible message/tool/action flow, not hidden workflow state.
- `specs/current/architecture/10-worktree-lifecycle.md`: workspace identity lives on the latest `goal_run_attempt` payload and cleanup must stay ownership-aware.

Whole-repository grep evidence:

- `rg -n "LIVE_GOAL_RUN_STATUSES|ACTIVE_GOAL_RUN_STATUSES|GOAL_RUN_RESETTABLE_STATUSES|isLiveGoalRunStatus|GoalRunStatus|goalStatusByID" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test`
- `rg -n "LIVE_STATES|TERMINAL_OK_STATES|TERMINAL_FAIL_STATES|TERMINAL_ABORTED_STATES|mapGoalRunToStepStatus|projectPhases|mapRunStatus|terminalGoalRunStatus|\\[\"completed\", \"failed\", \"aborted\"\\]" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test`
- Primary duplicate status branches found in `engine/goal-status.ts`, `engine/describe.ts`, `engine/workflow.ts`, `engine/persist.ts`, and `task-api/index.ts`.
- `store.ts` still defaults missing artifact payload status to `queued`; this is a separate data-audit item and is not changed in this increment.

Independent agent feedback:

- Ampere: keep the persisted `EngineGoalRunStatus` vocabulary for now; centralize derived categories first. Do not collapse `queued` into active execution, and do not collapse `completed`, `failed`, and `aborted` because they carry distinct UI/evidence semantics.
- Ampere: replace duplicated maps in `goal-status.ts`, `workflow.ts`, `describe.ts`, and `task-api/index.ts`.
- Faraday: catalog tests currently pin lifecycle labels as control semantics. Reframe them around projection and explicit cancellation categories. Keep existing duplicate-build, stale-row, cancellation, queue, and orphan tests as anchors.
- Faraday: highest risks are duplicate builds, audit-only cancellation targets, non-tip `complete_goal`, and worktree evidence deletion. This patch must not weaken those protections.

## Decision

Do not delete the goal-run persisted enum yet. The first stable simplification is to make `engine/catalog.ts` the only semantic classifier:

- goal projection: `pending` / `running` / `passed` / `failed`;
- workflow projection: `pending` / `running` / `completed` / `failed` / `aborted`;
- terminal, successful, aborted, live, active, and explicit-resettable predicates.

The old fine-grained labels (`accepted`, `planning`, `evaluating`, `blocked`) become projection aliases at call sites. They must not spread as independent control branches.

## Implementation Plan

1. Add catalog helpers for terminal and projection semantics.
2. Replace duplicated status switches/sets in `goal-status.ts`, `describe.ts`, `workflow.ts`, `persist.ts`, and `task-api/index.ts`.
3. Update `catalog.test.ts` to assert the new single-source projection contract.
4. Run focused engine tests plus document health for the new spec record.

## Validation Plan

- `bun test packages/opencorvus/test/engine/catalog.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/engine/begin-build-attempt-supersede.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts --test-name-pattern "stale live goal_run|complete_goal completes stale|delete_goal deletes stale|active build session blocks|goal build rejects duplicate|cancel_subagent goal_id refuses" --timeout 60000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/script/document-health.test.ts --timeout 60000`
