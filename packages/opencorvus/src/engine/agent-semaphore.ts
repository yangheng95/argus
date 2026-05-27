/**
 * Per-task parallel-agent concurrency gate.
 *
 * Workflow phases can fan out multiple agent sessions: per-goal `build`
 * agents during the goal phase and independent reviewer agents during the
 * integrity phase. This semaphore is the shared ceiling for those parallel
 * agents so one task cannot burn through an unbounded process/model pool.
 *
 * Scope rules:
 *   - Per-task: each task gets its own semaphore keyed by taskID. Two
 *     different tasks can use their quotas independently; a single task
 *     cannot fan out unbounded.
 *   - Dynamic ceiling: the limit is resolved every acquire via
 *     `effectiveMaxAgentParallelism(task)` so operator edits to
 *     `opencorvus.jsonc` take effect on the next acquire without restart.
 *     Shrinking the ceiling below current in-flight count does not cancel
 *     in-flight agents; waiters queue until the in-flight count drains.
 *   - FIFO waiters: queue order is preserved. AsyncSemaphore is
 *     intentionally simple: no priority and no aging.
 *   - No DB state: semaphore state is in-memory only. A process restart
 *     drops everything; child sessions and task projection carry the audit
 *     trail for the next orchestrator wake.
 *
 * Not a state machine. No persistence. Just counting.
 */

import type { TaskRow } from "./store"
import { effectiveMaxAgentParallelism } from "./helpers"
import { Log } from "@/util/log"

const log = Log.create({ service: "agent-semaphore" })

interface TaskSemaphore {
  inFlight: number
  waiters: Array<() => void>
}

const semaphores = new Map<string, TaskSemaphore>()

function getSem(taskID: string): TaskSemaphore {
  let sem = semaphores.get(taskID)
  if (!sem) {
    sem = { inFlight: 0, waiters: [] }
    semaphores.set(taskID, sem)
  }
  return sem
}

export namespace AgentSemaphore {
  /**
   * Acquire one slot for a task. Resolves when a slot is available.
   * The caller must call the returned release callback exactly once.
   *
   * Reads the ceiling at acquire time so config edits take effect
   * without a restart.
   */
  export async function acquire(task: TaskRow): Promise<() => void> {
    const limit = await effectiveMaxAgentParallelism(task)
    const sem = getSem(task.id)

    if (sem.inFlight < limit) {
      sem.inFlight++
      log.info("acquire (immediate)", { taskID: task.id, inFlight: sem.inFlight, limit })
      return () => release(task.id)
    }

    log.info("acquire (queue)", { taskID: task.id, inFlight: sem.inFlight, limit, waiters: sem.waiters.length })
    await new Promise<void>((resolve) => {
      sem.waiters.push(resolve)
    })
    sem.inFlight++
    return () => release(task.id)
  }

  function release(taskID: string): void {
    const sem = semaphores.get(taskID)
    if (!sem) return
    sem.inFlight = Math.max(0, sem.inFlight - 1)
    log.info("release", { taskID, inFlight: sem.inFlight, waiters: sem.waiters.length })
    const next = sem.waiters.shift()
    if (next) next()
    if (sem.inFlight === 0 && sem.waiters.length === 0) {
      semaphores.delete(taskID)
    }
  }

  export async function withSlot<T>(task: TaskRow, fn: () => Promise<T>): Promise<T> {
    const release = await acquire(task)
    try {
      return await fn()
    } finally {
      release()
    }
  }

  export function inFlight(taskID: string): number {
    return semaphores.get(taskID)?.inFlight ?? 0
  }

  export function waiting(taskID: string): number {
    return semaphores.get(taskID)?.waiters.length ?? 0
  }

  export function reset(): void {
    for (const sem of semaphores.values()) {
      while (sem.waiters.length > 0) sem.waiters.shift()!()
    }
    semaphores.clear()
  }
}
