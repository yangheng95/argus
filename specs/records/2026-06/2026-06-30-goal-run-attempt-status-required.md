# Goal Run Attempt Status Required

## Recall

User request:

- Continue the adversarial cooperative refactor for the goal / goal_run execution model.
- Remove complex live-run control state instead of adding more gates or fallback behavior.
- Challenge whether goals need to persist runtime state; prefer contract data plus derived current status/id.

Acceptance criteria for this increment:

- `goal_run_attempt.payload.status` is required when reconstructing a `GoalRunRow`.
- A malformed `goal_run_attempt` must fail fast with a clear data error; it must not be projected as live `queued`.
- Goal-run liveness checks in touched tests must use the catalog predicate rather than a duplicated status list.
- Do not broaden this patch into raw `run` artifact defaults; that needs a separate run-level test boundary.
- Preserve existing ownership/session protections and do not touch unrelated dirty worktree changes.
- Verify with focused engine tests, document-health tests, typecheck, commit, and push.

Hard constraints:

- No fallback or compatibility logic.
- No new git worktree.
- No blind patching; keep the change tied to evidence.
- Every code change needs a regression test.
- Commit and push after verification.

Read before implementation:

- `specs/records/2026-06/2026-06-30-goal-run-state-simplification.md`
- `specs/records/2026-06/2026-06-30-retire-live-run-control-source.md`
- `specs/current/architecture/02-data.md`
- `specs/current/architecture/03-control.md`
- `specs/current/architecture/10-worktree-lifecycle.md`

Current worktree facts:

- Local branch `coding-assistant` is ahead of `origin/coding-assistant` by two commits:
  - `dsw-0000 Centralize goal run state projections`
  - `dsw-0000 Reclaim completed goal worktrees immediately`
- There are unrelated dirty files and one unrelated untracked spec record. This increment must stage only its own hunks.
- Previous push attempts were blocked by network failure to `origin` and a `myhexin` pre-receive requirement for a real `dsw-*` task id. Do not invent a task id to bypass the remote hook.

Whole-repository grep evidence:

- `rg -n 'status: payload\.status \?\? "queued"|payload\.status \?\?|status \?\? "queued"' packages/opencorvus/src/engine`
  - `store.ts` still maps missing raw run status to `queued`.
  - `store.ts` still maps missing `goal_run_attempt` status to `queued`.
- `rg -n 'LIVE_GOAL_RUN_STATUSES|ACTIVE_GOAL_RUN_STATUSES|GOAL_RUN_RESETTABLE_STATUSES|row\.status !== "queued"' packages/opencorvus/src/engine packages/opencorvus/src/worktree packages/opencorvus/src/orchestrator`
  - `store.ts` still has goal-run live/active filters using exported arrays.
  - `writer.ts`, `git.ts`, and `persist.ts` still have separate cleanup/retry classification work for later patches.
- `rg -n 'liveStatuses|goal_run_attempt|payload: \{\}' packages/opencorvus/test/engine packages/opencorvus/test/project packages/opencorvus/test/orchestrator`
  - `state-invariants.test.ts` hard-codes live goal-run statuses.
  - Direct goal-run fixtures checked in this pass include explicit payload status.

Independent agent feedback:

- Helmholtz confirmed `payload.status ?? "queued"` in `artifactRowToGoalRunRow` is reachable through all goal-run read paths, including task/by-goal lists, `findGoalRun`, project live lists, and workspace projections.
- Helmholtz confirmed the semantic damage: `queued` is live in the catalog, so malformed rows can become live tips, project to pending goal status, appear in live project/worktree projections, and interact badly with cleanup/recovery paths that intentionally exclude queued rows.
- Helmholtz recommended the first patch boundary: harden only `goal_run_attempt.payload.status` parsing in `store.ts` with missing/invalid status tests. Treat the analogous raw run default and broader duplicate status cleanup as separate patches.

## Decision

`goal_run_attempt.payload.status` is part of the append-only attempt fact. A row without it is corrupted data, not an implicit queued attempt.

The read model must fail fast when the field is missing or invalid. This keeps the status projection honest and prevents malformed artifacts from manufacturing live goal-run state.

## Implementation Plan

1. Add a local `requireGoalRunPayloadStatus` mapper guard in `store.ts`.
2. Replace `payload.status ?? "queued"` in `artifactRowToGoalRunRow`.
3. Replace the hard-coded live status list in `state-invariants.test.ts` with `isLiveGoalRunStatus`.
4. Add regression tests for missing and invalid `goal_run_attempt.payload.status`.

## Validation Plan

- `bun test packages/opencorvus/test/engine/state-invariants.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/engine/catalog.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/engine/begin-build-attempt-supersede.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/script/document-health.test.ts --timeout 60000`
- `bun run typecheck`
