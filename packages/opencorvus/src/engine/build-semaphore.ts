/**
 * Per-task build-tool concurrency gate.
 *
 * Phase 5-a of specs/new-arch/16-unified-teardown.md §7-5.
 *
 * Background: post-phase-5 the orchestrator will invoke a single `build`
 * tool — possibly many in parallel within the same step via AI SDK's
 * parallel tool_call support — instead of seeding goal_run rows that the
 * GoalPool then drains at `concurrency`. The GoalPool scheduler enforced
 * concurrency via `opts.concurrency` read from `effectiveMaxExecutorGroups`
 * and this module carries that exact ceiling forward into the tool-call era.
 *
 * Scope rules:
 *   - **Per-task**: each task gets its own semaphore keyed by taskID. Two
 *     different tasks can burn through their quotas in parallel; a single
 *     task cannot fan out unbounded.
 *   - **Dynamic ceiling**: the limit is resolved every acquire via
 *     `effectiveMaxExecutorGroups(task)` so operator edits to
 *     `opencorvus.jsonc` take effect on the next acquire without restart.
 *     Shrinking the ceiling below current in-flight count does NOT cancel
 *     in-flight acquirers; waiters just queue until the in-flight drain.
 *   - **FIFO waiters**: queue order is preserved. AsyncSemaphore is
 *     intentionally simple — no priority, no aging; we rely on the LLM
 *     batching multiple `build` calls in one step rather than serially.
 *   - **No DB state**: semaphore state is in-memory only. A process
 *     restart drops everything; in-flight builds die with their owner
 *     session and the describe projection (run_orphan) tells the next
 *     orchestrator wake.
 *
 * Not a state machine. No persistence. No FSM gates. Just counting.
 */

import type { TaskRow } from "./store"
import { effectiveMaxExecutorGroups } from "./helpers"
import { Log } from "@/util/log"

const log = Log.create({ service: "build-semaphore" })

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

export namespace BuildSemaphore {
  /**
   * Acquire one slot for a task. Resolves when a slot is available.
   * The caller MUST call the returned release callback exactly once
   * (either in a `finally` block or via `withSlot` below).
   *
   * Reads the ceiling at acquire time so config edits take effect
   * without a restart.
   */
  export async function acquire(task: TaskRow): Promise<() => void> {
    const limit = await effectiveMaxExecutorGroups(task)
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
    // Garbage-collect empty per-task entries so the map does not grow
    // unboundedly for a long-running process with many completed tasks.
    if (sem.inFlight === 0 && sem.waiters.length === 0) {
      semaphores.delete(taskID)
    }
  }

  /**
   * Convenience wrapper: acquire → run fn → release (even on throw).
   */
  export async function withSlot<T>(task: TaskRow, fn: () => Promise<T>): Promise<T> {
    const release = await acquire(task)
    try {
      return await fn()
    } finally {
      release()
    }
  }

  /** Testing / diagnostics: current in-flight count for a task. */
  export function inFlight(taskID: string): number {
    return semaphores.get(taskID)?.inFlight ?? 0
  }

  /** Testing / diagnostics: current queued waiter count for a task. */
  export function waiting(taskID: string): number {
    return semaphores.get(taskID)?.waiters.length ?? 0
  }

  /** Testing only — drain all state. Never call this from production. */
  export function reset(): void {
    // Wake any residual waiters so their callers can return instead of
    // dangling across tests. Production never hits this path.
    for (const sem of semaphores.values()) {
      while (sem.waiters.length > 0) sem.waiters.shift()!()
    }
    semaphores.clear()
  }
}
