import { createSignal } from "solid-js"
import {
  advanceSseActiveElapsed,
  pauseSseActiveElapsed,
  type SseActiveElapsedState,
} from "../utils/sse-active-elapsed"

const [activityRevision, setActivityRevision] = createSignal(0)
const elapsedByKey = new Map<string, SseActiveElapsedState>()

export function taskRuntimeActivityKey(input: { taskID: string; createdAt: number }): string {
  const taskID = input.taskID.trim()
  if (!taskID) return ""
  if (!Number.isFinite(input.createdAt) || input.createdAt <= 0) {
    throw new Error(`task ${taskID} runtime activity requires a positive task.time.created timestamp`)
  }
  return `${taskID}:${input.createdAt}`
}

export function recordSelectedTaskSseActivity(input: { key: string; active: boolean; eventAt: number }): void {
  if (!input.key) return
  const previous = elapsedByKey.get(input.key) ?? { key: input.key, elapsedMs: 0 }
  const next = advanceSseActiveElapsed(previous, input)
  elapsedByKey.set(input.key, next)
  if (next.elapsedMs !== previous.elapsedMs || next.observedAt !== previous.observedAt) {
    setActivityRevision((revision) => revision + 1)
  }
}

export function pauseSelectedTaskSseActivity(key: string): void {
  if (!key) return
  const previous = elapsedByKey.get(key) ?? { key, elapsedMs: 0 }
  const next = pauseSseActiveElapsed(previous, key)
  elapsedByKey.set(key, next)
  if (next.observedAt !== previous.observedAt) {
    setActivityRevision((revision) => revision + 1)
  }
}

export function selectedTaskSseActiveElapsedMs(key: string): number {
  activityRevision()
  if (!key) return 0
  return elapsedByKey.get(key)?.elapsedMs ?? 0
}

export function __resetSelectedTaskSseActivityForTest(): void {
  elapsedByKey.clear()
  setActivityRevision((revision) => revision + 1)
}
