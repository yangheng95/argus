import { updateTask } from "./state"
import type { TaskRow } from "./store"

function metadataAfterMessageOpen(metadata: TaskRow["metadata"]): Record<string, unknown> {
  const next = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {}
  delete next.cancelled
  return next
}

export async function openTaskForOperatorMessage(
  task: TaskRow,
  summary = "Operator message opened task",
): Promise<TaskRow> {
  return await updateTask(
    task,
    {
      status: "active",
      error: null,
      time_completed: null,
      metadata: metadataAfterMessageOpen(task.metadata),
    },
    summary,
  )
}
