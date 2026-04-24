/**
 * Unit tests for BuildSemaphore (phase 5-a).
 *
 * The semaphore governs concurrent `build` tool_calls per task so the
 * LLM's optimistic parallel fan-out does not burn a benchmark's process
 * pool. These tests exercise the pure counting machinery without going
 * near the DB / LLM.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { BuildSemaphore } from "../../src/engine/build-semaphore"

const makeTask = (id: string): any => ({
  id,
  budget: { max_executor_groups: 2 },
})

describe("BuildSemaphore", () => {
  afterEach(() => {
    BuildSemaphore.reset()
    mock.restore()
  })

  test("acquire up to the per-task budget ceiling resolves immediately", async () => {
    const task = makeTask(`t_${Date.now()}_immediate`)
    const r1 = await BuildSemaphore.acquire(task)
    const r2 = await BuildSemaphore.acquire(task)
    expect(BuildSemaphore.inFlight(task.id)).toBe(2)
    expect(BuildSemaphore.waiting(task.id)).toBe(0)
    r1()
    r2()
    // Post-release, entry garbage-collected.
    expect(BuildSemaphore.inFlight(task.id)).toBe(0)
  })

  test("acquire beyond ceiling queues; release hands off to next waiter (FIFO)", async () => {
    const task = makeTask(`t_${Date.now()}_queue`)
    const r1 = await BuildSemaphore.acquire(task)
    const r2 = await BuildSemaphore.acquire(task)

    const log: string[] = []
    const third = BuildSemaphore.acquire(task).then((release) => {
      log.push("third-in")
      return release
    })
    const fourth = BuildSemaphore.acquire(task).then((release) => {
      log.push("fourth-in")
      return release
    })

    // Let queue settle; no slot released yet.
    await new Promise((r) => setTimeout(r, 20))
    expect(BuildSemaphore.inFlight(task.id)).toBe(2)
    expect(BuildSemaphore.waiting(task.id)).toBe(2)
    expect(log).toEqual([])

    r1()
    await new Promise((r) => setTimeout(r, 20))
    expect(log).toEqual(["third-in"])
    expect(BuildSemaphore.waiting(task.id)).toBe(1)

    r2()
    await new Promise((r) => setTimeout(r, 20))
    expect(log).toEqual(["third-in", "fourth-in"])
    expect(BuildSemaphore.waiting(task.id)).toBe(0)
    ;(await third)()
    ;(await fourth)()
  })

  test("each task has an independent semaphore", async () => {
    const taskA = makeTask(`a_${Date.now()}`)
    const taskB = makeTask(`b_${Date.now()}`)
    const ra1 = await BuildSemaphore.acquire(taskA)
    const ra2 = await BuildSemaphore.acquire(taskA)
    // Task A is at its cap; task B still has room.
    const rb1 = await BuildSemaphore.acquire(taskB)
    expect(BuildSemaphore.inFlight(taskA.id)).toBe(2)
    expect(BuildSemaphore.inFlight(taskB.id)).toBe(1)
    expect(BuildSemaphore.waiting(taskA.id)).toBe(0)
    ra1()
    ra2()
    rb1()
  })

  test("withSlot releases even when the callback throws", async () => {
    const task = makeTask(`t_${Date.now()}_throw`)
    await expect(
      BuildSemaphore.withSlot(task, async () => {
        expect(BuildSemaphore.inFlight(task.id)).toBe(1)
        throw new Error("intentional")
      }),
    ).rejects.toThrow("intentional")
    expect(BuildSemaphore.inFlight(task.id)).toBe(0)
  })

  test("withSlot propagates the callback's return value", async () => {
    const task = makeTask(`t_${Date.now()}_ret`)
    const result = await BuildSemaphore.withSlot(task, async () => 42)
    expect(result).toBe(42)
  })

  test("reset drains waiters (test-only hygiene)", async () => {
    const task = makeTask(`t_${Date.now()}_reset`)
    const r1 = await BuildSemaphore.acquire(task)
    const r2 = await BuildSemaphore.acquire(task)
    const waiting = BuildSemaphore.acquire(task)
    BuildSemaphore.reset()
    // Waiter should resolve so the callback that was awaiting it unblocks.
    const release = await Promise.race([
      waiting,
      new Promise<() => void>((_, reject) => setTimeout(() => reject(new Error("reset did not wake waiter")), 200)),
    ])
    expect(typeof release).toBe("function")
    // Release the already-completed promises; reset cleared the map, so
    // these are no-ops but should not throw.
    r1()
    r2()
  })
})
