# Goal Run Owner PID Liveness Fix

## Incident

Task `tsk_e9af331d3001dMjtFFem1Wi1oE` showed G2 (`gol_e9b05af2c002awrE2JjyqbfglM`) as failed while its build session was still writing files.

Evidence:

- `engine_artifact[kind='goal_run_attempt']` contained G2 V1 `running`, then `aborted` with `owner process restarted mid-stream`.
- The V1 build session continued writing `src/data/fixtures/*` after the abort artifact.
- A V2 attempt was opened in the same worktree before V1 finished, causing two G2 build sessions to write the same data-layer files concurrently.
- No acceptance artifact, pending interaction, or `orchestrator-stream-error` explained a real data-layer failure.
- The machine had multiple OpenCorvus processes. The previous implementation treated any live goal run whose owner stamp differed from the current process owner as orphaned.

## Call-Site Audit

`isGoalRunOrphaned` is the single predicate used by all owner-orphan readers:

| Call site                              | Decision                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| `engine/describe.ts`                   | Keep; should report orphan only after physical owner death is proven.               |
| `engine/goal-status.ts`                | Keep; board status should stay running for a foreign but live owner.                |
| `engine/workflow.ts`                   | Keep; workflow projection should not mark a live foreign owner failed.              |
| `engine/persist.ts::beginBuildAttempt` | Keep; duplicate build must still be refused unless the prior owner process is dead. |
| `engine/orphan.ts::observeOrphanRuns`  | Keep; run orphan derivation should ignore only physically dead goal runs.           |

## Fix

Preserve owner stamp as the single source, but refine the liveness fact:

1. Same owner stamp: not orphan.
2. Foreign owner stamp with a live parsed PID (process identifier): not orphan.
3. Foreign owner stamp with a dead or unparsable PID: orphan.

This reuses the existing physical probe `Ownership.isPidAlive`. It avoids adding dispatch gates, UI-specific fallback, or retry heuristics.
