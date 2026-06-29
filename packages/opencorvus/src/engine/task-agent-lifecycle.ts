import { Session } from "@/session"
import type { TaskRow } from "./store"
import { findActiveRunForTask, listGoalRunsForTask } from "./store"
import { isLiveGoalRunStatus } from "./catalog"
import { listLiveOrchestratorToolOwnership, type OrchestratorToolOwnershipRow } from "./tool-ownership"
import { cancelPendingAgentCoordinationRequestsForTask } from "./agent-coordination"
import { cancelSessionPromptInScope, type TaskAgentPromptSession } from "./cancellation-scope"

export type TaskAgentLifecycleReport = {
  taskID: string
  sessionIDs: string[]
  cancelledSessions: TaskAgentPromptSession[]
  cancellationFailures: unknown[]
  ownerships: OrchestratorToolOwnershipRow[]
  goalRunIDs: string[]
  runIDs: string[]
  pendingCoordinationRequestsCancelled: number
}

export async function collectTaskAgentLifecycleHandles(task: TaskRow): Promise<{
  taskID: string
  sessionIDs: string[]
  promptSessions: TaskAgentPromptSession[]
  ownerships: OrchestratorToolOwnershipRow[]
  goalRunIDs: string[]
  runIDs: string[]
}> {
  const rootSessionIDs = new Set<string>()
  if (task.session_id) rootSessionIDs.add(task.session_id)

  const ownerships = listLiveOrchestratorToolOwnership(task.id)
  for (const ownership of ownerships) {
    rootSessionIDs.add(ownership.payload.child_session_id)
  }

  const liveGoalRuns = listGoalRunsForTask(task.id).filter((row) => isLiveGoalRunStatus(row.status))
  for (const goalRun of liveGoalRuns) {
    if (goalRun.session_id) rootSessionIDs.add(goalRun.session_id)
  }

  const activeRun = findActiveRunForTask(task.id)
  if (activeRun?.session_id) rootSessionIDs.add(activeRun.session_id)

  const sessionIDs = new Set<string>()
  for (const sessionID of rootSessionIDs) {
    const tree = await Session.treeInProject({ sessionID, projectID: task.project_id })
    for (const id of tree) sessionIDs.add(id)
  }

  const promptSessions = await Promise.all(
    [...sessionIDs].map((sessionID) => Session.getInProject({ sessionID, projectID: task.project_id })),
  )

  return {
    taskID: task.id,
    sessionIDs: [...sessionIDs],
    promptSessions: promptSessions.map((session) => ({ id: session.id, directory: session.directory })),
    ownerships,
    goalRunIDs: liveGoalRuns.map((row) => row.id),
    runIDs: activeRun ? [activeRun.id] : [],
  }
}

export async function requestTaskAgentLifecycleCancellation(input: {
  task: TaskRow
  reason: string
  handle?: string
}): Promise<TaskAgentLifecycleReport> {
  const handles = await collectTaskAgentLifecycleHandles(input.task)
  const cancelledSessions: TaskAgentPromptSession[] = []
  const cancellationFailures: unknown[] = []

  for (const session of handles.promptSessions.slice().reverse()) {
    try {
      if (
        cancelSessionPromptInScope({
          session,
          taskID: input.task.id,
          handle: input.handle ?? "task-agent-lifecycle.cancel",
        })
      ) {
        cancelledSessions.push(session)
      }
    } catch (error) {
      cancellationFailures.push(error)
    }
  }

  const pendingCoordinationRequestsCancelled = await cancelPendingAgentCoordinationRequestsForTask({
    taskID: input.task.id,
    reason: input.reason,
  })

  return {
    taskID: handles.taskID,
    sessionIDs: handles.sessionIDs,
    cancelledSessions,
    cancellationFailures,
    ownerships: handles.ownerships,
    goalRunIDs: handles.goalRunIDs,
    runIDs: handles.runIDs,
    pendingCoordinationRequestsCancelled,
  }
}
