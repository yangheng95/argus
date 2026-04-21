import { Log } from "@/util/log"
import {
  abortLiveExecutionForProject,
  abortRuns,
} from "./writer"
import {
  listLiveExecutorSessionsForProject,
  listLiveGoalRunsForProject,
  listLiveRunsForProject,
} from "./store"

const log = Log.create({ service: "engine-recovery" })

const RECOVERY_REASON = "Process restart: executor session lost during recovery"

/**
 * On process restart: clean up physical resources that leaked (executor
 * sessions, live goal_runs, orphan runs). THE LOOP IS NOT AUTOMATICALLY
 * RESTARTED — the user-message-driven model says the next run requires
 * a user message. Tasks stay at status="active" in DB; whether a loop is
 * currently in flight is not tracked — every user message unconditionally
 * calls runTaskLoop, and the per-taskID serial chain in orchestrator/loop.ts
 * ensures concurrent calls are linearised rather than dropped.
 */
export async function recoverProjectExecution(input: {
  projectID: string
}) {
  const { executorSessions: abortedSessions, goalRuns: abortedGoalRuns } =
    await abortLiveExecutionForProject({
      projectID: input.projectID,
      reason: RECOVERY_REASON,
      cleanupGoalWorkspaces: false,
    })
  const abortedRuns = await recoverOrphanRuns(input.projectID)

  log.info("project recovery complete", {
    projectID: input.projectID,
    abortedSessions,
    abortedGoalRuns,
    abortedRuns,
  })

  return {
    abortedSessions,
    abortedGoalRuns,
    abortedRuns,
  }
}

/**
 * Orphan-run detection: a run is "orphaned" if it's live but has no live
 * goal_run and no live executor_session attached. These are left dangling
 * after the worker process dies mid-dispatch; transitively aborting them
 * matches what startup recovery did before the writer refactor.
 *
 * We reuse the shared abortRuns primitive so the termination path is
 * identical to restart_from_stage's run-abort path (CAS + event emission
 * via updateRun).
 */
async function recoverOrphanRuns(projectID: string) {
  const liveGoalRunIDs = new Set(
    listLiveGoalRunsForProject(projectID).map((goalRun) => goalRun.coordinator_run_id),
  )
  const liveRunSessionIDs = new Set(
    listLiveExecutorSessionsForProject(projectID).map((session) => session.run_id),
  )
  const orphans = listLiveRunsForProject(projectID).filter((run) => {
    if (run.status === "queued") return false
    if (liveGoalRunIDs.has(run.id)) return false
    if (liveRunSessionIDs.has(run.id)) return false
    return true
  })
  return abortRuns(orphans, "Process restart: run lost live executor state during recovery")
}

