import { describe, expect, test } from "bun:test"
import { exceededInactivityTimeout, inactivityAgeMs, latestActivityAt } from "@/util/activity-timeout"
import { createInactivityGuard } from "@/util/inactivity-guard"

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

  test("resettable inactivity guard tracks recent activity instead of start time", async () => {
    let fired = 0
    const guard = createInactivityGuard(40, () => {
      fired += 1
    })

    await Bun.sleep(25)
    guard.bump()
    await Bun.sleep(25)
    expect(fired).toBe(0)

    await Bun.sleep(30)
    expect(fired).toBe(1)
    guard.clear()
  })
})
