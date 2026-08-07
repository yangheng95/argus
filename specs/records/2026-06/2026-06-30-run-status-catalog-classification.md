# Run Status Catalog Classification

## Recall

User request:

- Continue the adversarial cooperative refactor for the goal / goal_run execution-state model.
- Remove complex live-run control behavior and duplicated lifecycle state logic.
- Keep status labels as durable audit/projection facts while control relies on ownership/session facts.

Acceptance criteria for this increment:

- Remaining run terminal / started-at / executor-active classification touched in this patch must be derived from `engine/catalog.ts`.
- Do not add a new state machine or gate.
- Do not change run transition freedom; `updateRun` must still allow the orchestrator to write any legal run status.
- Preserve the existing semantic split:
  - live run: `queued`, `accepted`, `running`, `blocked`;
  - dispatchable run: `accepted`, `running`, `blocked`;
  - terminal run: `completed`, `failed`, `aborted`;
  - status-implies-started: `accepted`, `running`, `blocked`, `completed`.
- Do not broaden this patch into ownership/session control changes.
- Verify with focused catalog/runtime/state tests, commit, and push.

Hard constraints:

- No fallback or compatibility logic.
- No new git worktree.
- No blind patching; keep the change tied to evidence.
- Every code change needs regression coverage.
- Commit and push after verification.

Read before implementation:

- `specs/records/2026-06/2026-06-30-run-artifact-status-required.md`
- `specs/records/2026-06/2026-06-30-goal-run-state-simplification.md`
- `specs/records/2026-06/2026-06-30-retire-live-run-control-source.md`
- `specs/current/architecture/02-data.md`
- `specs/current/architecture/03-control.md`

Current worktree facts:

- Local branch `coding-assistant` was pushed to `origin/coding-assistant` through `Require run artifact status`.
- There are unrelated dirty files and unrelated untracked spec / architecture files. This increment must stage only its own hunks.
- `legacy-remote` push still requires a real `dsw-*` task id; do not invent one.

Whole-repository grep evidence:

- `rg -n 'LIVE_RUN_STATUSES|DISPATCHABLE_RUN_STATUSES|EXECUTOR_ACTIVE_RUN_STATUSES|isLiveRunStatus|isDispatchableRunStatus|run\.status !== "completed"|run\.status !== "failed"|run\.status !== "aborted"|nextStatus === "completed"|nextStatus === "failed"|nextStatus === "aborted"|\["accepted", "running", "blocked", "completed"\]' packages/opencorvus/src/engine packages/opencorvus/src/orchestrator packages/opencorvus/test/engine`
  - `runtime.ts` still uses `EXECUTOR_ACTIVE_RUN_STATUSES` membership and an inline terminal-status triple.
  - `state.ts` still uses inline started-at and terminal-completed status checks.
  - `writer.ts` still filters run rows with `LIVE_RUN_STATUSES.includes`.
  - `orchestrator/tools.ts`, `task-message-open.ts`, and `store.ts` already use run catalog predicates for live/dispatchable checks.

Independent agent feedback:

- Plato confirmed the safe same-patch replacements: `runtime.ts` executor-active list membership, `runtime.ts` inline terminal-negative branch, `state.ts` started-at and terminal timestamp checks, and `writer.ts` live run list membership.
- Plato warned not to replace the runtime terminal branch with dispatchable semantics because queued runs must keep the existing behavior.
- Plato warned that `isTerminalRunStatus` must be explicit catalog metadata, not `!isLiveRunStatus`, otherwise future catalog mistakes would be hidden.
- Plato identified behavior-specific checks that must stay explicit: interaction blocker `blocked` checks, `blocking_reason` clearing on non-blocked statuses, and orchestrator queued-run activation.

## Decision

Extend `RUN_STATUS_CATALOG` to carry the same projection metadata that callers are already encoding by hand:

- `terminal`;
- `startedAtImplied`;
- executor-active as a named predicate over live run status.

This is not a behavior change. It replaces duplicated classification branches with named catalog predicates so future run status changes cannot drift across runtime, state, and writer surfaces.

## Implementation Plan

1. Extend `RunStatusMeta` and `RUN_STATUS_CATALOG`.
2. Add `isTerminalRunStatus`, `doesRunStatusImplyStarted`, and `isExecutorActiveRunStatus`.
3. Replace matching duplicated branches in `runtime.ts`, `state.ts`, and `writer.ts`.
4. Update `catalog.test.ts` to pin all run classification dimensions.

## Validation Plan

- `bun test packages/opencorvus/test/engine/catalog.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/engine/runtime-goal-run-convergence.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/engine/run-blocking.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/engine/task-terminal-run-finalization.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/engine/writer.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/script/document-health.test.ts --timeout 60000`
- `bun run typecheck`
