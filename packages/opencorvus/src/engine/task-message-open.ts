import type { TaskRow } from "./store"

export async function openTaskForOperatorMessage(
  task: TaskRow,
  summary = "Operator message opened task",
): Promise<TaskRow> {
  void summary
  return task
}
