import { isLiveRunStatus } from "./catalog"
import { findActiveRunForTask, findPendingInteractions, type RunRow, type TaskRow } from "./store"
import { updateRun, updateTask } from "./state"
import { isTaskTerminal } from "./task-status"

export async function openTaskForOperatorWake(
  task: TaskRow,
  summary = "Operator message reopened task",
): Promise<TaskRow> {
  if (!isTaskTerminal(task)) return task
  const metadata =
    task.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata)
      ? { ...(task.metadata as Record<string, unknown>) }
      : {}
  delete metadata.cancelled
  delete metadata.interrupted
  return updateTask(task, { status: "queued", error: null, metadata }, summary)
}

export async function reopenActiveRunForOperatorWake(
  task: TaskRow,
  summary = "Operator message reopened blocked run",
): Promise<RunRow | undefined> {
  const run = findActiveRunForTask(task.id)
  if (!isLiveRunStatus(run?.status)) return undefined
  if (run.status !== "blocked") return run

  const pending = findPendingInteractions(run.id)
  if (pending.length > 0) return run

  return updateRun(
    run,
    {
      status: "running",
      blocking_reason: null,
      error: null,
    },
    summary,
  )
}
