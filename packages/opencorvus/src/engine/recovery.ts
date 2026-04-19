import { Log } from "@/util/log"
import {
  abortLiveExecutionForProject,
  abortRuns,
} from "./writer"
import {
  findNextQueuedTaskForProject,
  hasActiveTaskInProject,
  listLiveExecutorSessionsForProject,
  listLiveGoalRunsForProject,
  listLiveRunsForProject,
  searchProjectTasks,
} from "./store"

const log = Log.create({ service: "engine-recovery" })

const RECOVERY_REASON = "Process restart: executor session lost during recovery"

export async function recoverProjectExecution(input: {
  projectID: string
  isTaskLoopActive(taskID: string): boolean
  startTaskLoop(taskID: string): Promise<void> | void
}) {
  const { executorSessions: abortedSessions, goalRuns: abortedGoalRuns } =
    await abortLiveExecutionForProject({
      projectID: input.projectID,
      reason: RECOVERY_REASON,
      cleanupGoalWorkspaces: false,
    })
  const abortedRuns = await recoverOrphanRuns(input.projectID)
  const resumedTaskID = await resumeProjectQueue(
    input.projectID,
    input.isTaskLoopActive,
    input.startTaskLoop,
  )

  log.info("project recovery complete", {
    projectID: input.projectID,
    abortedSessions,
    abortedGoalRuns,
    abortedRuns,
    resumedTaskID,
  })

  return {
    abortedSessions,
    abortedGoalRuns,
    abortedRuns,
    resumedTaskID,
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

async function resumeProjectQueue(
  projectID: string,
  isTaskLoopActive: (taskID: string) => boolean,
  startTaskLoop: (taskID: string) => Promise<void> | void,
) {
  const orphaned = searchProjectTasks(projectID, { status: "active", limit: 1000 })
    .filter((task) => !isTaskLoopActive(task.id))
    .sort((a, b) => a.time_created - b.time_created)

  if (orphaned.length > 1) {
    log.error("project recovery found multiple orphaned active tasks", {
      projectID,
      taskIDs: orphaned.map((task) => task.id),
    })
  }

  const resume = orphaned[0]
  if (resume) {
    log.warn("project recovery resuming orphaned active task", { projectID, taskID: resume.id })
    await startTaskLoop(resume.id)
    return resume.id
  }

  if (hasActiveTaskInProject(projectID)) return undefined
  const next = findNextQueuedTaskForProject(projectID)
  if (!next || isTaskLoopActive(next.id)) return undefined

  log.info("project recovery starting queued task", { projectID, taskID: next.id })
  await startTaskLoop(next.id)
  return next.id
}
