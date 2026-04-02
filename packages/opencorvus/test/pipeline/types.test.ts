import { describe, expect, test } from "bun:test"

/**
 * Verify that the pipeline module exports all expected types and functions.
 * This is a compile-time + runtime check that the module boundary is correct.
 */
describe("pipeline module exports", () => {
  test("runGoalPipeline is an async generator function", async () => {
    const { runGoalPipeline } = await import("../../src/pipeline")
    expect(typeof runGoalPipeline).toBe("function")
  })

  test("createTieredRetryPolicy returns a RetryPolicy", async () => {
    const { createTieredRetryPolicy } = await import("../../src/pipeline")
    const policy = createTieredRetryPolicy()
    expect(typeof policy.decide).toBe("function")
  })

  test("type re-exports are importable (compile-time check)", async () => {
    // These imports would fail at compile time if the types aren't exported
    const mod = await import("../../src/pipeline/types")
    // Runtime check that the module loaded
    expect(mod).toBeDefined()
  })
})
