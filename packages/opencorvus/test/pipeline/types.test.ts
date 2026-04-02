import { describe, expect, test } from "bun:test"

/**
 * Verify that the pipeline module exports all expected tools and types.
 */
describe("pipeline module exports", () => {
  test("runGoalPipeline is an async generator function", async () => {
    const { runGoalPipeline } = await import("../../src/pipeline")
    expect(typeof runGoalPipeline).toBe("function")
  })

  test("planGoal is a function", async () => {
    const { planGoal } = await import("../../src/pipeline")
    expect(typeof planGoal).toBe("function")
  })

  test("evaluateGoal is a function", async () => {
    const { evaluateGoal } = await import("../../src/pipeline")
    expect(typeof evaluateGoal).toBe("function")
  })

  test("type re-exports are importable (compile-time check)", async () => {
    const mod = await import("../../src/pipeline/types")
    expect(mod).toBeDefined()
  })
})
