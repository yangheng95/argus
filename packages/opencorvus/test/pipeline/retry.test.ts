import { describe, expect, test } from "bun:test"
import { createTieredRetryPolicy } from "../../src/pipeline/retry"
import type { EvalVerdict } from "../../src/pipeline/types"

function verdict(overrides: Partial<EvalVerdict> = {}): EvalVerdict {
  return {
    pass: false,
    verdict: "rejected",
    evidence: ["test failed"],
    reasoning: "code has bug",
    failureClass: "bug",
    ...overrides,
  }
}

describe("createTieredRetryPolicy", () => {
  test("bug failure retries executor up to max", () => {
    const policy = createTieredRetryPolicy({ maxExecutorRetries: 2, maxPlannerRetries: 1 })

    const d1 = policy.decide(verdict({ failureClass: "bug" }), 0)
    expect(d1.type).toBe("retry")
    expect(d1.level).toBe("executor")

    const d2 = policy.decide(verdict({ failureClass: "bug" }), 1)
    expect(d2.type).toBe("retry")
    expect(d2.level).toBe("executor")

    // Executor retries exhausted → escalate to planner
    const d3 = policy.decide(verdict({ failureClass: "bug" }), 2)
    expect(d3.type).toBe("retry")
    expect(d3.level).toBe("planner")
  })

  test("plan_wrong failure retries planner directly", () => {
    const policy = createTieredRetryPolicy({ maxExecutorRetries: 2, maxPlannerRetries: 1 })

    const d1 = policy.decide(verdict({ failureClass: "plan_wrong" }), 0)
    expect(d1.type).toBe("retry")
    expect(d1.level).toBe("planner")
  })

  test("goal_wrong gives up immediately", () => {
    const policy = createTieredRetryPolicy({ maxExecutorRetries: 5, maxPlannerRetries: 5 })

    const d1 = policy.decide(verdict({ failureClass: "goal_wrong" }), 0)
    expect(d1.type).toBe("give_up")
    expect(d1.class).toBe("goal_wrong")
  })

  test("all retries exhausted gives up", () => {
    const policy = createTieredRetryPolicy({ maxExecutorRetries: 1, maxPlannerRetries: 1 })

    // 1st: bug → executor retry
    const d1 = policy.decide(verdict({ failureClass: "bug" }), 0)
    expect(d1.type).toBe("retry")
    expect(d1.level).toBe("executor")

    // 2nd: bug → executor exhausted → planner retry
    const d2 = policy.decide(verdict({ failureClass: "bug" }), 1)
    expect(d2.type).toBe("retry")
    expect(d2.level).toBe("planner")

    // 3rd: bug → executor retry (reset after planner)
    const d3 = policy.decide(verdict({ failureClass: "bug" }), 2)
    expect(d3.type).toBe("retry")
    expect(d3.level).toBe("executor")

    // 4th: executor exhausted again + planner exhausted → give up
    const d4 = policy.decide(verdict({ failureClass: "bug" }), 3)
    expect(d4.type).toBe("give_up")
    expect(d4.class).toBe("bug")
  })

  test("planner retry resets executor retry count", () => {
    const policy = createTieredRetryPolicy({ maxExecutorRetries: 1, maxPlannerRetries: 2 })

    // executor retry #1
    policy.decide(verdict({ failureClass: "bug" }), 0)
    // executor exhausted → planner retry #1
    const d2 = policy.decide(verdict({ failureClass: "bug" }), 1)
    expect(d2.level).toBe("planner")

    // After planner retry, executor count resets → can retry executor again
    const d3 = policy.decide(verdict({ failureClass: "bug" }), 2)
    expect(d3.type).toBe("retry")
    expect(d3.level).toBe("executor")
  })

  test("defaults: 2 executor + 1 planner retries", () => {
    const policy = createTieredRetryPolicy()

    // 3 bugs: exe, exe, planner
    const d1 = policy.decide(verdict({ failureClass: "bug" }), 0)
    expect(d1).toEqual({ type: "retry", level: "executor" })
    const d2 = policy.decide(verdict({ failureClass: "bug" }), 1)
    expect(d2).toEqual({ type: "retry", level: "executor" })
    const d3 = policy.decide(verdict({ failureClass: "bug" }), 2)
    expect(d3).toEqual({ type: "retry", level: "planner" })

    // After planner: 2 more executor retries available
    const d4 = policy.decide(verdict({ failureClass: "bug" }), 3)
    expect(d4).toEqual({ type: "retry", level: "executor" })
    const d5 = policy.decide(verdict({ failureClass: "bug" }), 4)
    expect(d5).toEqual({ type: "retry", level: "executor" })

    // All exhausted
    const d6 = policy.decide(verdict({ failureClass: "bug" }), 5)
    expect(d6.type).toBe("give_up")
  })

  test("no failureClass defaults to bug", () => {
    const policy = createTieredRetryPolicy({ maxExecutorRetries: 1, maxPlannerRetries: 0 })

    const d1 = policy.decide(verdict({ failureClass: undefined }), 0)
    expect(d1.type).toBe("retry")
    expect(d1.level).toBe("executor")
  })
})
