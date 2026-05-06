import { describe, expect, test } from "bun:test"
import { AwaitTimeoutError, withTimeout } from "../../src/util/await-with-timeout"

describe("withTimeout", () => {
  test("resolves passthrough when inner promise settles in time", async () => {
    const result = await withTimeout(Promise.resolve(42), 100, "passthrough")
    expect(result).toBe(42)
  })

  test("rejects with AwaitTimeoutError when inner never resolves", async () => {
    const stuck = new Promise<never>(() => {
      // Intentionally never resolves — proves the timeout path fires.
    })
    let caught: unknown
    try {
      await withTimeout(stuck, 50, "stuck-pending")
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(AwaitTimeoutError)
    expect((caught as AwaitTimeoutError).label).toBe("stuck-pending")
    expect((caught as AwaitTimeoutError).ms).toBe(50)
    expect((caught as AwaitTimeoutError).message).toContain("50ms")
  })

  test("propagates inner rejection without wrapping", async () => {
    const inner = new Error("boom")
    let caught: unknown
    try {
      await withTimeout(Promise.reject(inner), 100, "rejector")
    } catch (err) {
      caught = err
    }
    expect(caught).toBe(inner)
  })

  test("clears the timer when inner resolves first (no late firings)", async () => {
    // If the timer leaked, a later micro-task would still log/throw — this
    // test passes when the finally-block clearTimeout actually kills it.
    const value = await withTimeout(Promise.resolve("ok"), 10_000, "fast")
    expect(value).toBe("ok")
    // Sleep past a hypothetical timer; if it weren't cleared, an unhandled
    // rejection would surface in the bun:test runner.
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
})
