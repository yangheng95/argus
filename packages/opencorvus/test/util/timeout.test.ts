import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { withTimeout } from "../../src/util/timeout"

afterEach(() => {
  mock.restore()
})

describe("util.timeout", () => {
  test("should resolve when promise completes before timeout", async () => {
    const fastPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve("fast"), 10)
    })

    const result = await withTimeout(fastPromise, 100)
    expect(result).toBe("fast")
  })

  test("should reject when promise exceeds timeout", async () => {
    const slowPromise = new Promise<string>((resolve) => {
      setTimeout(() => resolve("slow"), 200)
    })

    await expect(withTimeout(slowPromise, 50)).rejects.toThrow("Operation timed out after 50ms")
  })

  test("clears timeout when the inner promise resolves first", async () => {
    const clearTimeoutSpy = spyOn(globalThis, "clearTimeout")
    await expect(withTimeout(Promise.resolve("ok"), 10_000)).resolves.toBe("ok")
    expect(clearTimeoutSpy).toHaveBeenCalled()
  })

  test("clears timeout when the inner promise rejects first", async () => {
    const clearTimeoutSpy = spyOn(globalThis, "clearTimeout")
    const inner = new Error("inner failure")
    await expect(withTimeout(Promise.reject(inner), 10_000)).rejects.toBe(inner)
    expect(clearTimeoutSpy).toHaveBeenCalled()
  })
})
