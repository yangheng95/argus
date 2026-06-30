# Run Artifact Status Required

## Recall

User request:

- Continue the adversarial cooperative refactor for the goal / goal_run execution-state model.
- Remove live-run lifecycle rows as orchestration control sources instead of adding gates or fallback behavior.
- Keep goals as contract data while current status/id are derived projections from append-only execution artifacts.

Acceptance criteria for this increment:

- `run` artifact `payload.status` is required when reconstructing a `RunRow`.
- A malformed `run` artifact must fail fast with a clear data error; it must not be projected as live `queued`.
- Run liveness and dispatchability filtering touched in `store.ts` must use catalog predicates instead of local array membership checks.
- Do not broaden this patch into terminal timestamp semantics or runtime terminal-branch refactors.
- Preserve existing ownership/session protections and do not touch unrelated dirty worktree changes.
- Verify with focused engine tests, document-health tests, typecheck, commit, and push.

Hard constraints:

- No fallback or compatibility logic.
- No new git worktree.
- No blind patching; keep the change tied to evidence.
- Every code change needs a regression test.
- Commit and push after verification.

Read before implementation:

- `specs/records/2026-06/2026-06-30-goal-run-attempt-status-required.md`
- `specs/records/2026-06/2026-06-30-retire-live-run-control-source.md`
- `specs/current/architecture/02-data.md`
- `specs/current/architecture/03-control.md`
- `specs/current/architecture/10-worktree-lifecycle.md`

Current worktree facts:

- Local branch `coding-assistant` is ahead of `origin/coding-assistant` by three commits:
  - `Centralize goal run state projections`
  - `Reclaim completed goal worktrees immediately`
  - `Require goal run attempt status`
- There are unrelated dirty files and an unrelated untracked MCP worktree-convergence spec record. This increment must stage only its own hunks.
- Previous push attempts were blocked by network failure to `origin` and a `myhexin` pre-receive requirement for a real `dsw-*` task id. Do not invent a task id to bypass the remote hook.

Whole-repository grep evidence:

- `rg -n 'status: payload\.status \?\? "queued"|payload\.status \?\?|status \?\? "queued"' packages/opencorvus/src/engine packages/opencorvus/src/orchestrator packages/opencorvus/test/engine`
  - `store.ts` still maps missing raw run status to `queued`.
  - The prior `goal_run_attempt` status default has been removed.
- `rg -n 'LIVE_RUN_STATUSES|DISPATCHABLE_RUN_STATUSES|EXECUTOR_ACTIVE_RUN_STATUSES|isLiveRunStatus|isDispatchableRunStatus|run\.status !== "completed"|run\.status !== "failed"|run\.status !== "aborted"' packages/opencorvus/src/engine packages/opencorvus/src/orchestrator packages/opencorvus/test/engine`
  - `store.ts` still uses run status arrays directly for active/live/dispatchable projections.
  - `runtime.ts` and `state.ts` still have terminal/timestamp classification branches; those are separate follow-up work.
- Production run writers checked in `engine/writer.ts` and `engine/state.ts` write `payload.status` explicitly.

Independent agent feedback:

- Lovelace confirmed the raw run default is reachable through `findRun`, `findRuns`, `listLiveRuns`, `listLiveRunsForProject`, and `activeRunBySession`.
- Lovelace confirmed the semantic damage: missing status becomes `queued`, which is live in the catalog, so malformed run artifacts can surface as active runs, block runtime active-session checks, influence orchestrator run creation/activation, and feed abort/cancel paths.
- Lovelace found production writers already provide run status and recommended a focused patch: add `isRunStatus`, require run payload status in `store.ts`, add missing/invalid status tests, and leave broader terminal classification cleanup for a later patch.

## Decision

`run.payload.status` is part of the append-only run fact. A `run` artifact without it is corrupted data, not an implicit queued run.

The read model must fail fast when the field is missing or invalid. This keeps active-run projections honest and prevents malformed artifacts from manufacturing live execution state.

## Implementation Plan

1. Add a catalog-level `isRunStatus` predicate beside `isGoalRunStatus`.
2. Add `requireRunPayloadStatus` in `store.ts` and replace `payload.status ?? "queued"`.
3. Replace touched run filters in `store.ts` with `isLiveRunStatus` / `isDispatchableRunStatus`.
4. Add regression tests for missing and invalid `run.payload.status`.

## Validation Plan

- `bun test packages/opencorvus/test/engine/state-invariants.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/engine/catalog.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/engine/runtime-goal-run-convergence.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 60000`
- `bun test packages/opencorvus/test/script/document-health.test.ts --timeout 60000`
- `bun run typecheck`
