# Goal Run Status Predicate Cleanup

## Recall

User request:

- Continue the active goal with adversarial cooperative refactoring.
- Remove complex live-run / goal-run state management as an orchestration control source.
- Keep goal state simple: persisted goal data is contract data, while current status/id are projections from execution artifacts.
- Do not add fallback, gates, or compatibility paths.

Acceptance criteria for this increment:

- Remaining production consumers must not directly consume `ACTIVE_GOAL_RUN_STATUSES`, `LIVE_GOAL_RUN_STATUSES`, or `GOAL_RUN_RESETTABLE_STATUSES`.
- Goal-run status classification touched in this patch must flow through named catalog predicates.
- `queued` exact checks that express business semantics must remain explicit or be replaced only by an equivalent active-execution predicate.
- Add regression coverage for the predicate contract and at least one behavior path where queued must not count as active execution.
- Preserve unrelated dirty worktree changes and do not create a new worktree.
- Verify with focused engine tests, document-health tests, typecheck, commit, and push.

Hard constraints:

- No fallback or compatibility logic.
- No new git worktree.
- No blind patching; keep the change tied to grep evidence and independent review.
- Every code change needs regression coverage.
- Commit and push after verification.

Read before implementation:

- `specs/records/2026-06/2026-06-30-goal-run-attempt-status-required.md`
- `specs/records/2026-06/2026-06-30-run-artifact-status-required.md`
- `specs/records/2026-06/2026-06-30-run-status-catalog-classification.md`
- `specs/records/2026-06/2026-06-30-goal-run-state-simplification.md`
- `specs/records/2026-06/2026-06-30-retire-live-run-control-source.md`
- `specs/current/architecture/03-control.md`

Current worktree facts:

- Branch `coding-assistant` is even with `origin/coding-assistant` before this increment.
- There are unrelated dirty files including MCP, overlay debug, SDK OpenAPI, AGENTS, and a modified June README line for an unrelated MCP record.
- This increment must stage only the catalog/store/git/writer/test/spec changes it owns.

Whole-repository grep evidence:

- `rg -n 'ACTIVE_GOAL_RUN_STATUSES|LIVE_GOAL_RUN_STATUSES|GOAL_RUN_RESETTABLE_STATUSES|isLiveGoalRunStatus|isActiveGoalRunStatus|isTerminalGoalRunStatus|status !== "queued"|row\.status !== "queued"' packages/opencorvus/src/engine packages/opencorvus/src/orchestrator packages/opencorvus/test/engine packages/opencorvus/test/orchestrator`
  - `store.ts` still filters active and live goal-run lists with exported arrays.
  - `git.ts` still builds a `Set` from `ACTIVE_GOAL_RUN_STATUSES`.
  - `writer.ts` still filters resettable goal-runs with `GOAL_RUN_RESETTABLE_STATUSES`.
  - Multiple `status !== "queued"` checks remain in writer cleanup paths; those are queued-vs-active execution semantics, not generic liveness classification.
- `rg -n 'GOAL_RUN_RESETTABLE_STATUSES|ACTIVE_GOAL_RUN_STATUSES|LIVE_GOAL_RUN_STATUSES' packages/opencorvus/src packages/opencorvus/test`
  - After the previous increments, remaining production direct array consumers are limited to `store.ts`, `git.ts`, and `writer.ts`.

Independent agent feedback:

- Wegener confirmed `store.ts` active/live list filters and `git.ts` active sibling detection should use `isActiveGoalRunStatus` / `isLiveGoalRunStatus`.
- Wegener confirmed `writer.ts` task abort resettable filtering should use a new `isResettableGoalRunStatus` predicate because resettable is distinct metadata and must not be collapsed into live liveness.
- Wegener warned that queued checks must not be removed blindly:
  - `listQueuedGoalRunsForRun` must keep `status === "queued"`.
  - writer shutdown/recovery paths must not treat queued rows as executor-owned or orphaned execution.
  - project recovery must not abort queued rows just because they are live projection rows.
- Wegener recommended catalog predicate coverage, a store/LKG behavior check that queued does not count as active, and writer coverage for queued not being aborted as active execution.

## Decision

Goal-run arrays may remain as derived catalog exports for diagnostics or legacy display, but production control/projection code should not consume them directly.

This patch adds the missing resettable predicate and replaces the remaining production array membership checks with named catalog predicates. It keeps queued exact checks where the code is specifically describing queued backlog, and uses active-execution predicates where the code means "not merely queued".

## Implementation Plan

1. Add `isResettableGoalRunStatus` in `engine/catalog.ts`.
2. Replace production `ACTIVE_GOAL_RUN_STATUSES`, `LIVE_GOAL_RUN_STATUSES`, and `GOAL_RUN_RESETTABLE_STATUSES` consumers in `store.ts`, `git.ts`, and `writer.ts`.
3. Update catalog tests to assert per-status predicate semantics instead of array shape relationships.
4. Add/extend behavior tests so queued sibling goal-runs do not block LKG rollback while task-level abort still resets queued goal-runs through the resettable predicate.

## Validation Plan

- `bun test packages/opencorvus/test/engine/catalog.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/engine/lkg-parallel-safety.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/engine/writer.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/engine/state-invariants.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/script/document-health.test.ts --timeout 60000`
- `bun run typecheck`
