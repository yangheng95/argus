/**
 * Unit tests for AgentSemaphore.
 *
 * The semaphore governs concurrent fan-out agents per task so goal builds
 * and integrity reviewers share the same operator-visible ceiling.
 */
import { afterEach, describe, expect, mock, test } from "bun:test"
import { AgentSemaphore } from "../../src/engine/agent-semaphore"

const makeTask = (id: string): any => ({
  id,
  budget: { max_executor_groups: 2 },
})

describe("AgentSemaphore", () => {
  afterEach(() => {
    AgentSemaphore.reset()
    mock.restore()
  })

  test("acquire up to the per-task budget ceiling resolves immediately", async () => {
    const task = makeTask(`t_${Date.now()}_immediate`)
    const r1 = await AgentSemaphore.acquire(task)
    const r2 = await AgentSemaphore.acquire(task)
    expect(AgentSemaphore.inFlight(task.id)).toBe(2)
    expect(AgentSemaphore.waiting(task.id)).toBe(0)
    r1()
    r2()
    // Post-release, entry garbage-collected.
    expect(AgentSemaphore.inFlight(task.id)).toBe(0)
  })

  test("acquire beyond ceiling queues; release hands off to next waiter (FIFO)", async () => {
    const task = makeTask(`t_${Date.now()}_queue`)
    const r1 = await AgentSemaphore.acquire(task)
    const r2 = await AgentSemaphore.acquire(task)

    const log: string[] = []
    const third = AgentSemaphore.acquire(task).then((release) => {
      log.push("third-in")
      return release
    })
    const fourth = AgentSemaphore.acquire(task).then((release) => {
      log.push("fourth-in")
      return release
    })

    // Let queue settle; no slot released yet.
    await new Promise((r) => setTimeout(r, 20))
    expect(AgentSemaphore.inFlight(task.id)).toBe(2)
    expect(AgentSemaphore.waiting(task.id)).toBe(2)
    expect(log).toEqual([])

    r1()
    await new Promise((r) => setTimeout(r, 20))
    expect(log).toEqual(["third-in"])
    expect(AgentSemaphore.waiting(task.id)).toBe(1)

    r2()
    await new Promise((r) => setTimeout(r, 20))
    expect(log).toEqual(["third-in", "fourth-in"])
    expect(AgentSemaphore.waiting(task.id)).toBe(0)
    ;(await third)()
    ;(await fourth)()
  })

  test("each task has an independent semaphore", async () => {
    const taskA = makeTask(`a_${Date.now()}`)
    const taskB = makeTask(`b_${Date.now()}`)
    const ra1 = await AgentSemaphore.acquire(taskA)
    const ra2 = await AgentSemaphore.acquire(taskA)
    // Task A is at its cap; task B still has room.
    const rb1 = await AgentSemaphore.acquire(taskB)
    expect(AgentSemaphore.inFlight(taskA.id)).toBe(2)
    expect(AgentSemaphore.inFlight(taskB.id)).toBe(1)
    expect(AgentSemaphore.waiting(taskA.id)).toBe(0)
    ra1()
    ra2()
    rb1()
  })

  test("withSlot releases even when the callback throws", async () => {
    const task = makeTask(`t_${Date.now()}_throw`)
    await expect(
      AgentSemaphore.withSlot(task, async () => {
        expect(AgentSemaphore.inFlight(task.id)).toBe(1)
        throw new Error("intentional")
      }),
    ).rejects.toThrow("intentional")
    expect(AgentSemaphore.inFlight(task.id)).toBe(0)
  })

  test("withSlot propagates the callback's return value", async () => {
    const task = makeTask(`t_${Date.now()}_ret`)
    const result = await AgentSemaphore.withSlot(task, async () => 42)
    expect(result).toBe(42)
  })

  test("reset drains waiters (test-only hygiene)", async () => {
    const task = makeTask(`t_${Date.now()}_reset`)
    const r1 = await AgentSemaphore.acquire(task)
    const r2 = await AgentSemaphore.acquire(task)
    const waiting = AgentSemaphore.acquire(task)
    AgentSemaphore.reset()
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
