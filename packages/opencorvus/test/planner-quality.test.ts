import { describe, test, expect } from "bun:test"
import { DEFAULT_QUALITY_CONFIG, validatePlanQuality, type QualityConfig } from "../src/planner/quality"
import type { PlannerOutputType } from "../src/planner/agent"

// ---------------------------------------------------------------------------
// Helpers — factory for mock plan objects
// ---------------------------------------------------------------------------

function makePlan(overrides: Partial<PlannerOutputType> = {}): PlannerOutputType {
  return {
    prd: overrides.prd ?? "",
    summary: overrides.summary ?? "summary",
    goals: overrides.goals ?? [],
    subtasks: overrides.subtasks ?? [],
    risks: overrides.risks ?? [],
    assumptions: overrides.assumptions,
    milestones: overrides.milestones,
    clarifications: overrides.clarifications,
  }
}

/** Create a plan with realistic content for a high-quality test */
function makeGoodPlan(): PlannerOutputType {
  return makePlan({
    prd: `
      This module refactors the authentication system. The following files were identified
      through codebase exploration:

      - src/auth/handler.ts — main authentication handler
      - src/auth/middleware.ts — express middleware for token validation
      - src/auth/types.ts — shared TypeScript types
      - src/config/auth.json — configuration file

      The implementation must ensure backward compatibility with the existing API surface.
      Token validation should use the new \`jose\` library instead of the deprecated jsonwebtoken package.
      Error handling must follow the project convention of returning structured error objects.
    `.trim(),
    summary: "Refactor authentication system to use jose library",
    goals: [
      {
        description: "Build succeeds with new auth module",
        criteria: "`bunx tsc --noEmit` passes without errors",
        priority: "blocking",
      },
      {
        description: "All auth tests pass",
        criteria: "`bun test src/auth/` passes with 0 failures",
        priority: "blocking",
      },
      {
        description: "Lint clean",
        criteria: "`eslint src/auth/` reports no warnings",
        priority: "advisory",
      },
    ],
    subtasks: [
      {
        title: "Replace jsonwebtoken with jose",
        description: "Update src/auth/handler.ts and src/auth/middleware.ts to use jose library",
      },
      {
        title: "Update types",
        description: "Modify src/auth/types.ts to export new token payload interface",
      },
    ],
    risks: ["jose API differs from jsonwebtoken — migration may break edge cases"],
  })
}

// ---------------------------------------------------------------------------
// DEFAULT_QUALITY_CONFIG
// ---------------------------------------------------------------------------

describe("DEFAULT_QUALITY_CONFIG", () => {
  test("has expected threshold fields", () => {
    expect(DEFAULT_QUALITY_CONFIG.toolCallsDeep).toBe(5)
    expect(DEFAULT_QUALITY_CONFIG.toolCallsMin).toBe(2)
    expect(DEFAULT_QUALITY_CONFIG.newPathsDeep).toBe(2)
    expect(DEFAULT_QUALITY_CONFIG.prdMinLength).toBe(300)
    expect(DEFAULT_QUALITY_CONFIG.retryThreshold).toBe(0.5)
  })

  test("has weight fields that are positive numbers", () => {
    const w = DEFAULT_QUALITY_CONFIG.weights
    expect(w.toolCalls).toBeGreaterThan(0)
    expect(w.toolCallsPartial).toBeGreaterThan(0)
    expect(w.filePaths).toBeGreaterThan(0)
    expect(w.filePathsPartial).toBeGreaterThan(0)
    expect(w.goalCriteria).toBeGreaterThan(0)
    expect(w.subtaskPaths).toBeGreaterThan(0)
    expect(w.prdLength).toBeGreaterThan(0)
  })

  test("total weights sum to 1.0 or less", () => {
    const w = DEFAULT_QUALITY_CONFIG.weights
    // The maximum possible score uses the full weights (not partial), so:
    const maxSum = w.toolCalls + w.filePaths + w.goalCriteria + w.subtaskPaths + w.prdLength
    expect(maxSum).toBeLessThanOrEqual(1.0)
  })
})

// ---------------------------------------------------------------------------
// validatePlanQuality — empty / minimal plans
// ---------------------------------------------------------------------------

describe("validatePlanQuality — empty plan", () => {
  test("empty plan with 0 tool calls scores near 0", () => {
    const plan = makePlan()
    const { score, reasons } = validatePlanQuality(plan, "", 0)
    expect(score).toBeLessThanOrEqual(0.1)
    expect(reasons.length).toBeGreaterThan(0)
  })

  test("reasons explain every low-scoring dimension", () => {
    const plan = makePlan()
    const { reasons } = validatePlanQuality(plan, "", 0)
    // Should mention tool calls, file paths, criteria, subtasks, PRD
    expect(reasons.some((r) => r.includes("tool call"))).toBe(true)
    expect(reasons.some((r) => r.includes("file path") || r.includes("PRD contains no"))).toBe(true)
    expect(reasons.some((r) => r.includes("criteria"))).toBe(true)
    expect(reasons.some((r) => r.includes("subtask"))).toBe(true)
    expect(reasons.some((r) => r.includes("PRD too short") || r.includes("PRD"))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// validatePlanQuality — high-quality plan
// ---------------------------------------------------------------------------

describe("validatePlanQuality — good plan", () => {
  test("high-quality plan with deep exploration scores high", () => {
    const plan = makeGoodPlan()
    // Request does NOT contain the discovered file paths — so they count as "new"
    const request = "Refactor the authentication system to use the jose library"
    const { score } = validatePlanQuality(plan, request, 10)
    expect(score).toBeGreaterThanOrEqual(0.8)
  })

  test("no reasons when all dimensions are satisfied", () => {
    const plan = makeGoodPlan()
    const request = "Refactor auth"
    const { reasons } = validatePlanQuality(plan, request, 10)
    expect(reasons.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// validatePlanQuality — individual scoring dimensions
// ---------------------------------------------------------------------------

describe("validatePlanQuality — tool call scoring", () => {
  test("deep exploration (>= 5 tool calls) gets full credit", () => {
    const plan = makePlan()
    const r1 = validatePlanQuality(plan, "", 5)
    const r2 = validatePlanQuality(plan, "", 10)
    // Both should NOT have a tool call reason
    expect(r1.reasons.some((r) => r.includes("tool call") && r.includes("no codebase"))).toBe(false)
    expect(r2.reasons.some((r) => r.includes("tool call") && r.includes("no codebase"))).toBe(false)
  })

  test("partial exploration (2-4 tool calls) gets partial credit with reason", () => {
    const plan = makePlan()
    const { score: s0, reasons: r0 } = validatePlanQuality(plan, "", 0)
    const { score: s3, reasons: r3 } = validatePlanQuality(plan, "", 3)
    // Partial should score higher than none
    expect(s3).toBeGreaterThan(s0)
    // Should have a reason mentioning partial tool calls
    expect(r3.some((r) => r.includes("tool call") && r.includes("need"))).toBe(true)
  })

  test("zero tool calls gets zero credit and a reason", () => {
    const plan = makePlan()
    const { reasons } = validatePlanQuality(plan, "", 0)
    expect(reasons.some((r) => r.includes("0 tool calls") || r.includes("no codebase"))).toBe(true)
  })
})

describe("validatePlanQuality — file path scoring", () => {
  test("PRD with new paths not in request gets file path credit", () => {
    const plan = makePlan({
      prd: "Files: src/auth/handler.ts and src/auth/middleware.ts need changes.",
    })
    // Request has NO file paths — so both are "new"
    const request = "refactor auth"
    const { reasons } = validatePlanQuality(plan, request, 0)
    expect(reasons.some((r) => r.includes("PRD contains no file path"))).toBe(false)
  })

  test("PRD with paths already in request does not get new-path credit", () => {
    const plan = makePlan({
      prd: "Modify src/auth/handler.ts",
    })
    const request = "Fix src/auth/handler.ts"
    const { reasons } = validatePlanQuality(plan, request, 0)
    // Only 0 new paths (the one in PRD is also in request)
    expect(reasons.some((r) => r.includes("file path") || r.includes("PRD contains no"))).toBe(true)
  })

  test("PRD with exactly 1 new path gets partial credit", () => {
    const plan = makePlan({
      prd: "Discovered src/auth/handler.ts during exploration",
    })
    const request = "refactor auth"
    const { reasons } = validatePlanQuality(plan, request, 0)
    expect(reasons.some((r) => r.includes("only 1 file path"))).toBe(true)
  })
})

describe("validatePlanQuality — goal criteria scoring", () => {
  test("goals with command-like criteria get full credit", () => {
    const plan = makePlan({
      goals: [
        { description: "Build passes", criteria: "`bunx tsc --noEmit`", priority: "blocking" },
        { description: "Tests pass", criteria: "`bun test`", priority: "blocking" },
      ],
    })
    const { reasons } = validatePlanQuality(plan, "", 0)
    expect(reasons.some((r) => r.includes("criteria"))).toBe(false)
  })

  test("goals with vague criteria do not get credit", () => {
    const plan = makePlan({
      goals: [
        { description: "Feature works", criteria: "it should work well", priority: "blocking" },
        { description: "Code clean", criteria: "code is clean and tidy", priority: "advisory" },
      ],
    })
    const { reasons } = validatePlanQuality(plan, "", 0)
    expect(reasons.some((r) => r.includes("criteria"))).toBe(true)
  })

  test("mixed goals: at least 50% with concrete criteria passes", () => {
    const plan = makePlan({
      goals: [
        { description: "Build", criteria: "`bunx tsc` passes", priority: "blocking" },
        { description: "Tests", criteria: "all tests pass nicely", priority: "advisory" },
      ],
    })
    const { reasons } = validatePlanQuality(plan, "", 0)
    // 1 out of 2 = 50%, so should pass
    expect(reasons.some((r) => r.includes("criteria"))).toBe(false)
  })

  test("zero goals means no criteria credit", () => {
    const plan = makePlan({ goals: [] })
    const { reasons } = validatePlanQuality(plan, "", 0)
    expect(reasons.some((r) => r.includes("criteria"))).toBe(true)
  })
})

describe("validatePlanQuality — subtask path scoring", () => {
  test("subtasks referencing file paths get credit", () => {
    const plan = makePlan({
      subtasks: [
        { title: "Update handler", description: "Modify src/auth/handler.ts and src/auth/types.ts" },
      ],
    })
    const { reasons } = validatePlanQuality(plan, "", 0)
    expect(reasons.some((r) => r.includes("subtask"))).toBe(false)
  })

  test("subtasks without file paths do not get credit", () => {
    const plan = makePlan({
      subtasks: [
        { title: "Fix the bug", description: "Find and fix the issue in the codebase" },
      ],
    })
    const { reasons } = validatePlanQuality(plan, "", 0)
    expect(reasons.some((r) => r.includes("subtask"))).toBe(true)
  })
})

describe("validatePlanQuality — PRD length scoring", () => {
  test("PRD >= 300 chars gets length credit", () => {
    const plan = makePlan({
      prd: "A".repeat(300),
    })
    const { reasons } = validatePlanQuality(plan, "", 0)
    expect(reasons.some((r) => r.includes("PRD too short"))).toBe(false)
  })

  test("PRD < 300 chars does not get length credit", () => {
    const plan = makePlan({
      prd: "Short PRD",
    })
    const { reasons } = validatePlanQuality(plan, "", 0)
    expect(reasons.some((r) => r.includes("PRD too short"))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// validatePlanQuality — custom config
// ---------------------------------------------------------------------------

describe("validatePlanQuality — custom config", () => {
  test("custom config with lower thresholds changes scoring", () => {
    const customConfig: QualityConfig = {
      toolCallsDeep: 2,
      toolCallsMin: 1,
      newPathsDeep: 1,
      prdMinLength: 50,
      retryThreshold: 0.3,
      weights: {
        toolCalls: 0.3,
        toolCallsPartial: 0.15,
        filePaths: 0.25,
        filePathsPartial: 0.12,
        goalCriteria: 0.2,
        subtaskPaths: 0.15,
        prdLength: 0.1,
      },
    }

    const plan = makePlan({
      prd: "A".repeat(60) + " and src/auth/handler.ts was discovered",
      goals: [
        { description: "Build", criteria: "`bun build`", priority: "blocking" },
      ],
      subtasks: [
        { title: "Step 1", description: "Edit src/auth/handler.ts and src/auth/types.ts" },
      ],
    })

    // With 2 tool calls and lowered thresholds, should score much higher
    const { score } = validatePlanQuality(plan, "refactor auth", 2, customConfig)
    expect(score).toBeGreaterThanOrEqual(0.7)
  })

  test("custom config with higher thresholds makes scoring stricter", () => {
    const strictConfig: QualityConfig = {
      toolCallsDeep: 20,
      toolCallsMin: 10,
      newPathsDeep: 10,
      prdMinLength: 1000,
      retryThreshold: 0.8,
      weights: DEFAULT_QUALITY_CONFIG.weights,
    }

    const plan = makeGoodPlan()
    const { score } = validatePlanQuality(plan, "refactor auth", 5, strictConfig)
    // With strict thresholds, even a good plan scores lower
    const { score: defaultScore } = validatePlanQuality(plan, "refactor auth", 5)
    expect(score).toBeLessThan(defaultScore)
  })
})

// ---------------------------------------------------------------------------
// validatePlanQuality — score bounds
// ---------------------------------------------------------------------------

describe("validatePlanQuality — score bounds", () => {
  test("score is never negative", () => {
    const plan = makePlan()
    const { score } = validatePlanQuality(plan, "", 0)
    expect(score).toBeGreaterThanOrEqual(0)
  })

  test("score is capped at 1.0", () => {
    const plan = makeGoodPlan()
    const { score } = validatePlanQuality(plan, "", 100)
    expect(score).toBeLessThanOrEqual(1.0)
  })

  test("score increases monotonically with more tool calls (other factors equal)", () => {
    const plan = makePlan()
    const s0 = validatePlanQuality(plan, "", 0).score
    const s3 = validatePlanQuality(plan, "", 3).score
    const s10 = validatePlanQuality(plan, "", 10).score
    expect(s3).toBeGreaterThanOrEqual(s0)
    expect(s10).toBeGreaterThanOrEqual(s3)
  })
})
