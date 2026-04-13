import { describe, expect, test } from "bun:test"
import { exceededInactivityTimeout, inactivityAgeMs, latestActivityAt } from "@/util/activity-timeout"
import { createProgressGuard } from "@/agent/runtime"

describe("activity timeout helpers", () => {
  test("uses the latest activity timestamp instead of start time", () => {
    const startedAt = 1_000
    const progressAt = 25_000
    const now = 40_000

    expect(latestActivityAt(startedAt, progressAt)).toBe(progressAt)
    expect(inactivityAgeMs(now, startedAt, progressAt)).toBe(15_000)
  })

  test("treats missing activity as infinite inactivity", () => {
    expect(inactivityAgeMs(10_000)).toBe(Number.POSITIVE_INFINITY)
  })

  test("fires only after inactivity exceeds the configured budget", () => {
    const now = 120_000
    const lastActivityAt = 70_000

    expect(exceededInactivityTimeout(now, 60_000, lastActivityAt)).toBe(false)
    expect(exceededInactivityTimeout(now, 49_000, lastActivityAt)).toBe(true)
  })
})

describe("createProgressGuard", () => {
  test("alive-only traffic trips the progress timer, not the alive timer", async () => {
    const fires: Array<{ reason: string; tier: string }> = []
    const guard = createProgressGuard({
      aliveTimeoutMs: 200,
      progressTimeoutMs: 80,
      absoluteTimeoutMs: 1000,
      checkIntervalMs: 10,
      onTimeout: (reason, tier) => { fires.push({ reason, tier }) },
    })

    // Heartbeat alive() fast enough to keep alive-timer reset, but never call
    // progress() — the progress tier should fire.
    const ticker = setInterval(() => guard.alive(), 20)
    await Bun.sleep(150)
    clearInterval(ticker)
    guard.clear()

    expect(fires.length).toBe(1)
    expect(fires[0].tier).toBe("progress")
  })

  test("silence trips the alive timer", async () => {
    const fires: Array<{ reason: string; tier: string }> = []
    const guard = createProgressGuard({
      aliveTimeoutMs: 50,
      progressTimeoutMs: 5000,
      absoluteTimeoutMs: 5000,
      checkIntervalMs: 10,
      onTimeout: (reason, tier) => { fires.push({ reason, tier }) },
    })
    await Bun.sleep(120)
    guard.clear()
    expect(fires.length).toBe(1)
    expect(fires[0].tier).toBe("alive")
  })

  test("continuous progress eventually trips the absolute ceiling", async () => {
    const fires: Array<{ reason: string; tier: string }> = []
    const guard = createProgressGuard({
      aliveTimeoutMs: 2000,
      progressTimeoutMs: 2000,
      absoluteTimeoutMs: 120,
      checkIntervalMs: 10,
      onTimeout: (reason, tier) => { fires.push({ reason, tier }) },
    })
    const ticker = setInterval(() => guard.progress(), 20)
    await Bun.sleep(200)
    clearInterval(ticker)
    guard.clear()
    expect(fires.length).toBe(1)
    expect(fires[0].tier).toBe("absolute")
  })

  test("clear() is idempotent and prevents further fires", async () => {
    let fireCount = 0
    const guard = createProgressGuard({
      aliveTimeoutMs: 30,
      progressTimeoutMs: 30,
      absoluteTimeoutMs: 30,
      checkIntervalMs: 10,
      onTimeout: () => { fireCount += 1 },
    })
    guard.clear()
    guard.clear()
    await Bun.sleep(80)
    expect(fireCount).toBe(0)
  })

  test("rejects non-positive timeout configuration", () => {
    const noop = () => {}
    expect(() => createProgressGuard({ aliveTimeoutMs: 0, progressTimeoutMs: 100, onTimeout: noop })).toThrow()
    expect(() => createProgressGuard({ aliveTimeoutMs: 100, progressTimeoutMs: -1, onTimeout: noop })).toThrow()
    expect(() => createProgressGuard({ aliveTimeoutMs: 100, progressTimeoutMs: 100, absoluteTimeoutMs: 0, onTimeout: noop })).toThrow()
  })
})
