import { describe, expect, test } from "bun:test"
import { createProgressGuard } from "../../../src/agent/runtime/progress-guard"

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe("progress-guard", () => {
  test("pause freezes alive-tier during tool.execute waits", async () => {
    const fires: Array<{ tier: string; reason: string }> = []
    const guard = createProgressGuard({
      aliveTimeoutMs: 100,
      progressTimeoutMs: 10_000,
      absoluteTimeoutMs: 10_000,
      checkIntervalMs: 20,
      onTimeout: (reason, tier) => fires.push({ tier, reason }),
    })

    guard.pause()
    await wait(250)
    expect(fires).toEqual([])
    guard.resume()
    guard.clear()
  })

  test("alive fires when unpaused and idle past cap", async () => {
    const fires: Array<{ tier: string; reason: string }> = []
    const guard = createProgressGuard({
      aliveTimeoutMs: 80,
      progressTimeoutMs: 10_000,
      absoluteTimeoutMs: 10_000,
      checkIntervalMs: 20,
      onTimeout: (reason, tier) => fires.push({ tier, reason }),
    })

    await wait(200)
    expect(fires.length).toBe(1)
    expect(fires[0]!.tier).toBe("alive")
    guard.clear()
  })

  test("resume bumps lastAlive so alive does not fire immediately", async () => {
    const fires: Array<{ tier: string; reason: string }> = []
    const guard = createProgressGuard({
      aliveTimeoutMs: 100,
      progressTimeoutMs: 10_000,
      absoluteTimeoutMs: 10_000,
      checkIntervalMs: 20,
      onTimeout: (reason, tier) => fires.push({ tier, reason }),
    })

    guard.pause()
    await wait(300)
    guard.resume()
    await wait(50)
    expect(fires).toEqual([])
    guard.clear()
  })

  test("absolute fires even while paused", async () => {
    const fires: Array<{ tier: string; reason: string }> = []
    const guard = createProgressGuard({
      aliveTimeoutMs: 10_000,
      progressTimeoutMs: 10_000,
      absoluteTimeoutMs: 80,
      checkIntervalMs: 20,
      onTimeout: (reason, tier) => fires.push({ tier, reason }),
    })

    guard.pause()
    await wait(200)
    expect(fires.length).toBe(1)
    expect(fires[0]!.tier).toBe("absolute")
    guard.clear()
  })
})
