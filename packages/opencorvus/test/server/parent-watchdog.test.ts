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
      onOrphan: () => {
        fired++
      },
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
      onOrphan: (reason) => {
        fired++
        lastReason = reason
      },
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
      onOrphan: () => {
        fired++
      },
    })
    wd.stop()
    await new Promise((r) => setTimeout(r, 400))
    expect(fired).toBe(0)
  })

  /**
   * audit-2026-04-29 W2-G10. Lock the EPERM branch: when
   * `process.kill(parentPid, 0)` returns EPERM, the parent EXISTS but
   * we can't signal it (different uid, locked-down container).
   * Treating EPERM as "missing" would self-kill the sidecar in any
   * setuid / sudo / different-user scenario — exactly the case where
   * the user least wants the sidecar to disappear.
   *
   * Pre-G10 the code branched correctly but had no test: a refactor
   * that collapses the err.code switch could silently regress it.
   */
  test("EPERM (parent alive but signal denied) does NOT trigger onOrphan", async () => {
    const origKill = process.kill
    let fired = 0
    process.kill = ((_pid: number, _sig: number | string) => {
      const err = new Error("operation not permitted") as NodeJS.ErrnoException
      err.code = "EPERM"
      throw err
    }) as typeof process.kill
    try {
      const wd = ParentWatchdog.start({
        parentPid: 12345,
        intervalMs: 20,
        onOrphan: () => {
          fired++
        },
      })
      stops.push(() => wd.stop())
      await new Promise((r) => setTimeout(r, 150))
    } finally {
      process.kill = origKill
    }
    expect(fired).toBe(0)
  })

  test("Unknown errno (e.g. EIO) does NOT trigger onOrphan — fail-safe", async () => {
    // Belt-and-braces: only ESRCH (the documented "no such process"
    // errno) should self-kill. Anything else, including kernel-side
    // glitches, must keep the sidecar alive — false-positive
    // self-shutdown loses user work.
    const origKill = process.kill
    let fired = 0
    process.kill = ((_pid: number, _sig: number | string) => {
      const err = new Error("io error") as NodeJS.ErrnoException
      err.code = "EIO"
      throw err
    }) as typeof process.kill
    try {
      const wd = ParentWatchdog.start({
        parentPid: 12345,
        intervalMs: 20,
        onOrphan: () => {
          fired++
        },
      })
      stops.push(() => wd.stop())
      await new Promise((r) => setTimeout(r, 150))
    } finally {
      process.kill = origKill
    }
    expect(fired).toBe(0)
  })

  test("onOrphan throw is logged and does not crash subsequent ticks", async () => {
    // Pre-G10 the throw was swallowed by the inner try/catch. Lock
    // the contract: a buggy onOrphan must not break the watchdog
    // owner's expectation that fired=1 still happens (we set fired
    // BEFORE calling onOrphan, so this is testable).
    const origKill = process.kill
    let fired = 0
    process.kill = ((_pid: number, _sig: number | string) => {
      const err = new Error("no such") as NodeJS.ErrnoException
      err.code = "ESRCH"
      throw err
    }) as typeof process.kill
    try {
      const wd = ParentWatchdog.start({
        parentPid: 12345,
        intervalMs: 20,
        onOrphan: () => {
          fired++
          throw new Error("intentional")
        },
      })
      stops.push(() => wd.stop())
      await new Promise((r) => setTimeout(r, 150))
    } finally {
      process.kill = origKill
    }
    // Once and only once — `fired` flag inside the watchdog gates
    // re-entry even if onOrphan threw.
    expect(fired).toBe(1)
  })
})
