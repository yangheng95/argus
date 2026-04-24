import { describe, expect, test } from "bun:test"
import { withStreamActivity } from "@/util/stream-activity"

describe("withStreamActivity", () => {
  test("aborts own signal once idleMs elapses with no observe()", async () => {
    const gate = withStreamActivity({ idleMs: 40, label: "test-idle" })
    expect(gate.signal.aborted).toBe(false)
    await Bun.sleep(90)
    expect(gate.signal.aborted).toBe(true)
    expect(gate.timedOut()).toBe(true)
    expect(String(gate.signal.reason)).toContain("stream idle")
    expect(String(gate.signal.reason)).toContain("test-idle")
    gate.dispose()
  })

  test("observe() resets the timer and keeps the signal live", async () => {
    const gate = withStreamActivity({ idleMs: 80 })
    for (let i = 0; i < 5; i++) {
      await Bun.sleep(30)
      gate.observe()
    }
    expect(gate.signal.aborted).toBe(false)
    gate.dispose()
  })

  test("propagates external abort without waiting for idle window", async () => {
    const external = new AbortController()
    const gate = withStreamActivity({ idleMs: 60_000, signal: external.signal })
    external.abort(new Error("caller cancelled"))
    expect(gate.signal.aborted).toBe(true)
    expect(gate.timedOut()).toBe(false) // external cancel, not idle
    gate.dispose()
  })

  test("dispose() is idempotent and stops the timer", async () => {
    const gate = withStreamActivity({ idleMs: 20 })
    gate.dispose()
    gate.dispose()
    await Bun.sleep(60)
    expect(gate.signal.aborted).toBe(false)
  })

  test("rejects non-positive idleMs", () => {
    expect(() => withStreamActivity({ idleMs: 0 })).toThrow()
    expect(() => withStreamActivity({ idleMs: -1 })).toThrow()
    expect(() => withStreamActivity({ idleMs: Number.NaN })).toThrow()
  })
})
