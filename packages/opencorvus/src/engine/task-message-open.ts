import type { TaskRow } from "./store"
import { updateTask } from "./state"
import { isTaskTerminal } from "./task-status"

export async function openTaskForOperatorMessage(
  task: TaskRow,
  summary = "Operator message opened task",
): Promise<TaskRow> {
  if (!isTaskTerminal(task)) return task

  const metadata =
    task.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata)
      ? { ...(task.metadata as Record<string, unknown>) }
      : undefined
  if (metadata) delete metadata.cancelled

  return updateTask(
    task,
    {
      status: "active",
      error: null,
      ...(metadata ? { metadata } : {}),
    },
    summary,
  )
}
