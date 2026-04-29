import { afterEach, describe, expect, test } from "bun:test"
import { ParentWatchdog } from "../../src/server/parent-watchdog"
import { Log } from "../../src/util/log"

Log.init({ print: false })

describe("ParentWatchdog", () => {
  const stops: Array<() => void> = []

  afterEach(() => {
    while (stops.length) stops.pop()!()
  })

  test("does not call onOrphan while parent (this process) is alive", async () => {
    let fired = 0
    const wd = ParentWatchdog.start({
      parentPid: process.pid,
      intervalMs: 30,
      onOrphan: () => { fired++ },
    })
    stops.push(() => wd.stop())
    await new Promise((r) => setTimeout(r, 200))
    expect(fired).toBe(0)
  })

  test("calls onOrphan exactly once when parent PID is missing", async () => {
    let fired = 0
    let lastReason = ""
    const deadPid = 999_999_999
    const wd = ParentWatchdog.start({
      parentPid: deadPid,
      intervalMs: 20,
      onOrphan: (reason) => { fired++; lastReason = reason },
    })
    stops.push(() => wd.stop())
    await new Promise((r) => setTimeout(r, 200))
    expect(fired).toBe(1)
    expect(lastReason).toContain("parent")
  })

  test("stop() prevents further onOrphan calls before they fire", async () => {
    let fired = 0
    const wd = ParentWatchdog.start({
      parentPid: 999_999_999,
      intervalMs: 200,
      onOrphan: () => { fired++ },
    })
    wd.stop()
    await new Promise((r) => setTimeout(r, 400))
    expect(fired).toBe(0)
  })
})
