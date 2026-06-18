import type z from "zod"
import type { CreateTaskInput } from "./model"
import { withKeyedLock } from "@/util/lock"

const createTaskOwnerLocks = new Map<string, Promise<unknown>>()

export function taskCreationOwnerKeys(input: z.infer<typeof CreateTaskInput>): string[] {
  const keys: string[] = []
  if (input.channelBinding) {
    keys.push(`channel:${input.channelBinding.platform}:${input.channelBinding.channel}:${input.channelBinding.thread}`)
  }
  const metadata = input.metadata
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const mission = metadata.mission
    if (mission && typeof mission === "object" && !Array.isArray(mission)) {
      const sessionID = (mission as Record<string, unknown>).session_id
      if (typeof sessionID === "string" && sessionID.length > 0) keys.push(`mission:${sessionID}`)
    }
    const parentTaskID = metadata.parent_task_id
    if (typeof parentTaskID === "string" && parentTaskID.length > 0) keys.push(`task:${parentTaskID}`)
  }
  return [...new Set(keys)].sort()
}

export function taskCreationOwnerKey(input: z.infer<typeof CreateTaskInput>): string | undefined {
  return taskCreationOwnerKeys(input)[0]
}

export async function withTaskCreationOwnerLock<T>(
  input: z.infer<typeof CreateTaskInput>,
  fn: () => Promise<T>,
): Promise<T> {
  const ownerKeys = taskCreationOwnerKeys(input)
  let run = fn
  for (const ownerKey of ownerKeys.toReversed()) {
    const next = run
    run = () => withKeyedLock(createTaskOwnerLocks, ownerKey, next)
  }
  return run()
}

export function resetTaskCreationOwnerLocksForTest(): void {
  createTaskOwnerLocks.clear()
}
