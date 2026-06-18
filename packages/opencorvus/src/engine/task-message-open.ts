import { isLiveRunStatus } from "./catalog"
import { findActiveRunForTask, findPendingInteractions, type RunRow, type TaskRow } from "./store"
import { updateRun } from "./state"

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
