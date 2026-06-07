import type z from "zod"
import type { CreateTaskInput } from "./model"
import { withKeyedLock } from "@/util/lock"

const createTaskOwnerLocks = new Map<string, Promise<unknown>>()

export function taskCreationOwnerKey(input: z.infer<typeof CreateTaskInput>): string | undefined {
  const metadata = input.metadata
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined
  const mission = metadata.mission
  if (mission && typeof mission === "object" && !Array.isArray(mission)) {
    const sessionID = (mission as Record<string, unknown>).session_id
    if (typeof sessionID === "string" && sessionID.length > 0) return `mission:${sessionID}`
  }
  const parentTaskID = metadata.parent_task_id
  if (typeof parentTaskID === "string" && parentTaskID.length > 0) return `task:${parentTaskID}`
  return undefined
}

export async function withTaskCreationOwnerLock<T>(
  input: z.infer<typeof CreateTaskInput>,
  fn: () => Promise<T>,
): Promise<T> {
  const ownerKey = taskCreationOwnerKey(input)
  if (!ownerKey) return fn()
  return withKeyedLock(createTaskOwnerLocks, ownerKey, fn)
}

export function resetTaskCreationOwnerLocksForTest(): void {
  createTaskOwnerLocks.clear()
}
