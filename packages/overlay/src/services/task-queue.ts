import { apiJson } from "./api"

export interface ReorderTaskQueueInput {
  directory: string
  orderedTaskIDs: string[]
  revision?: string
}

export async function reorderTaskQueue(input: ReorderTaskQueueInput): Promise<{
  directory: string
  revision: string
  queuedTaskIDs: string[]
}> {
  return apiJson("task-queue/reorder", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
}

export interface StartQueuedTaskNowResult {
  task: { id: string; title: string }
  directory: string
  status: string
  started: boolean
  queuedTaskIDs: string[]
}

export async function startQueuedTaskNow(input: {
  taskID: string
  directory: string
}): Promise<StartQueuedTaskNowResult> {
  const directory = input.directory.trim()
  if (!directory) throw new Error("startQueuedTaskNow requires a task directory")
  const query = new URLSearchParams({ directory })
  return apiJson(`task/${encodeURIComponent(input.taskID)}/start-now?${query.toString()}`, {
    method: "POST",
  })
}
