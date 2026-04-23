import { Log } from "@/util/log"
import { advanceQueue, listActiveForCwd, listOrphanedActiveInProject, listQueuedCwdsInProject, resumeActiveTaskLoop, taskCwd } from "./queue"
import {
  abortLiveExecutionForProject,
  abortRuns,
} from "./writer"
import {
  listLiveGoalRunsForProject,
  listLiveRunsForProject,
  searchProjectTasks,
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
  isTaskLoopActive?: (taskID: string) => boolean
  startTaskLoop?: (taskID: string) => Promise<void> | void
}) {
  const { executorSessions: abortedSessions, goalRuns: abortedGoalRuns } =
    await abortLiveExecutionForProject({
      projectID: input.projectID,
      reason: RECOVERY_REASON,
      cleanupGoalWorkspaces: false,
    })
  const abortedRuns = await recoverOrphanRuns(input.projectID)
  const resumedTaskIDs = await resumeRecoveredTaskLoops(input)

  log.info("project recovery complete", {
    projectID: input.projectID,
    abortedSessions,
    abortedGoalRuns,
    abortedRuns,
    resumedTaskIDs,
  })

  return {
    abortedSessions,
    abortedGoalRuns,
    abortedRuns,
    resumedTaskID: resumedTaskIDs[0],
    resumedTaskIDs,
  }
}

async function resumeRecoveredTaskLoops(input: {
  projectID: string
  isTaskLoopActive?: (taskID: string) => boolean
  startTaskLoop?: (taskID: string) => Promise<void> | void
}) {
  const { startTaskLoop } = input
  if (startTaskLoop) {
    return resumeRecoveredTaskLoopsWithHooks({
      ...input,
      startTaskLoop,
    })
  }

  const resumedTaskIDs: string[] = []
  const orphaned = [...listOrphanedActiveInProject(input.projectID)]
    .sort((left, right) => (right.time_status_changed ?? 0) - (left.time_status_changed ?? 0))
  for (const task of orphaned) {
    await resumeActiveTaskLoop(task.id)
    resumedTaskIDs.push(task.id)
  }

  for (const cwd of listQueuedCwdsInProject(input.projectID)) {
    if (listActiveForCwd(cwd).length > 0) continue
    const before = new Set(listActiveForCwd(cwd).map((task) => task.id))
    await advanceQueue(cwd)
    for (const task of listActiveForCwd(cwd)) {
      if (!before.has(task.id)) resumedTaskIDs.push(task.id)
    }
  }

  return resumedTaskIDs
}

async function resumeRecoveredTaskLoopsWithHooks(input: {
  projectID: string
  isTaskLoopActive?: (taskID: string) => boolean
  startTaskLoop: (taskID: string) => Promise<void> | void
}) {
  const activeTask = [...listOrphanedActiveInProject(input.projectID)]
    .sort((left, right) => (right.time_status_changed ?? 0) - (left.time_status_changed ?? 0))[0]
  if (activeTask && !input.isTaskLoopActive?.(activeTask.id)) {
    await input.startTaskLoop(activeTask.id)
    return [activeTask.id]
  }

  if (searchProjectTasks(input.projectID, { status: "active", limit: 100 }).length > 0) {
    return []
  }

  const queuedTask = searchProjectTasks(input.projectID, { status: "queued", limit: 100 })
    .sort((left, right) => (left.time_created ?? 0) - (right.time_created ?? 0))[0]
  if (!queuedTask || input.isTaskLoopActive?.(queuedTask.id)) return []
  await input.startTaskLoop(queuedTask.id)
  return [queuedTask.id]
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
  const orphans = listLiveRunsForProject(projectID).filter((run) => {
    if (run.status === "queued") return false
    if (liveGoalRunIDs.has(run.id)) return false
    return true
  })
  return abortRuns(orphans, "Process restart: run lost live executor state during recovery")
}

