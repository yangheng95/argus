/**
 * Orphan-run observation — pure fact helpers, no physical-cleanup brake.
 *
 * Phase-7 replacement for the observation half of the deleted
 * `engine/recovery.ts`. `describe.ts` surfaces `run_orphan` so the
 * orchestrator LLM can decide how to handle runs that lost their
 * executor context on a process restart; no code gates on the result.
 */

import { listLiveGoalRunsForProject, listLiveRunsForProject, type GoalRunRow, type RunRow } from "./store"
import { isLiveGoalRunStatus } from "./catalog"
import { processOwner } from "./lease"
import { Ownership } from "./ownership"

/**
 * Owner-stamp orphan probe: a goal_run is **physically orphaned** when it is
 * in a live status but was driven live by a *different* process whose PID
 * (process identifier) is no longer alive. A foreign owner stamp alone is not
 * enough evidence: multiple OpenCorvus processes can coexist, and a still-live
 * foreign owner may continue streaming tool results. The status column still
 * reads `running`/`planning`/`blocked` because the dead process never got to
 * write a terminal row; this derivation is what makes the row read as dead
 * without mutating it.
 *
 * Never-dispatched / queued rows carry no owner and are not orphaned.
 *
 * Spec: deleted pre-June record 2026-05-29-goal-run-owner-orphan-liveness
 */
export function isGoalRunOrphaned(
  row: GoalRunRow,
  owner: string = processOwner(),
  isPidAlive: (pid: number) => boolean = Ownership.isPidAlive,
): boolean {
  if (!isLiveGoalRunStatus(row.status) || !row.owner || row.owner === owner) return false
  const ownerPid = Number(row.owner.split(":", 1)[0])
  return !isPidAlive(ownerPid)
}

/**
 * A live run (queued / accepted / running / blocked) is **orphan** if:
 *   - it has no live goal_run attached (per-goal parallel dispatch is
 *     tracked in engine_goal_run; losing all live goal_runs means the
 *     executor context is gone), AND
 *   - the run itself is not still queued (queued runs have no executor
 *     yet — they're not orphan, just unstarted).
 */
export function observeOrphanRuns(projectID: string): RunRow[] {
  // Owner-orphaned goal_runs (live status but foreign owner) do NOT count as a
  // live executor context for their parent run — the owning process is gone.
  // Excluding them lets a run whose only "live" goal_run is owner-orphaned fall
  // through to orphan, matching physical reality.
  const liveGoalRunIDs = new Set(
    listLiveGoalRunsForProject(projectID)
      .filter((goalRun) => !isGoalRunOrphaned(goalRun))
      .map((goalRun) => goalRun.coordinator_run_id),
  )
  return listLiveRunsForProject(projectID).filter((run) => {
    if (run.status === "queued") return false
    if (liveGoalRunIDs.has(run.id)) return false
    return true
  })
}

/** Convenience boolean for describe.ts per-task orphan tagging. */
export function isRunOrphan(projectID: string, runID: string): boolean {
  if (!runID) return false
  return observeOrphanRuns(projectID).some((r) => r.id === runID)
}
