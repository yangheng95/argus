/**
 * Orphan-run observation — pure fact helpers, no physical-cleanup brake.
 *
 * Phase-7 replacement for the observation half of the deleted
 * `engine/recovery.ts`. `describe.ts` surfaces `run_orphan` so the
 * orchestrator LLM can decide how to handle runs that lost their
 * executor context on a process restart; no code gates on the result.
 */

import {
  listLiveGoalRunsForProject,
  listLiveRunsForProject,
  type RunRow,
} from "./store"

/**
 * A live run (queued / accepted / running / blocked) is **orphan** if:
 *   - it has no live goal_run attached (per-goal parallel dispatch is
 *     tracked in engine_goal_run; losing all live goal_runs means the
 *     executor context is gone), AND
 *   - the run itself is not still queued (queued runs have no executor
 *     yet — they're not orphan, just unstarted).
 */
export function observeOrphanRuns(projectID: string): RunRow[] {
  const liveGoalRunIDs = new Set(
    listLiveGoalRunsForProject(projectID).map((goalRun) => goalRun.coordinator_run_id),
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
