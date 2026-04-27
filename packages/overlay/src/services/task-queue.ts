import { apiJson } from "./api";

export interface ReorderTaskQueueInput {
  directory: string;
  orderedTaskIDs: string[];
  revision?: string;
}

export async function reorderTaskQueue(input: ReorderTaskQueueInput): Promise<{
  directory: string;
  revision: string;
  queuedTaskIDs: string[];
}> {
  return apiJson("task-queue/reorder", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}