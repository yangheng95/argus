/**
 * Tests for the classification-based retry/replan logic in the orchestrator runtime.
 * Verifies that different failure classifications lead to correct actions.
 */
import { describe, test, expect } from "bun:test"
import type { EvaluatorAnalysisType } from "@/evaluator/agent"
import { FailureClassification, EvaluatorAnalysis, GoalAssessment, ReplanGuidance, parseEvaluatorAnalysis } from "@/evaluator/agent"

describe("FailureClassification enum", () => {
  test("all classification values are valid", () => {
    const valid = ["transient", "environment", "input", "permission", "evaluation", "strategy", "unknown"] as const
    for (const v of valid) {
      expect(FailureClassification.parse(v)).toBe(v)
    }
  })

  test("rejects invalid classifications", () => {
    expect(() => FailureClassification.parse("invalid")).toThrow()
  })
})

describe("EvaluatorAnalysis schema validation", () => {
  test("parses a complete accepted analysis", () => {
    const raw = {
      verdict: "accepted",
      classification: "evaluation",
      summary: "All checks passed",
      goal_statuses: [
        {
          goal_index: 0,
          status: "passed",
          evidence: "Build succeeded",
          reasoning: "Exit code 0",
        },
      ],
    }
    const parsed = EvaluatorAnalysis.parse(raw)
    expect(parsed.verdict).toBe("accepted")
    expect(parsed.classification).toBe("evaluation")
    expect(parsed.goal_statuses).toHaveLength(1)
    expect(parsed.replan_guidance).toBeUndefined()
  })

  test("parses a complete rejected analysis with replan guidance", () => {
    const raw = {
      verdict: "rejected",
      classification: "strategy",
      summary: "Wrong approach",
      goal_statuses: [
        {
          goal_index: 0,
          status: "failed",
          evidence: "Build error",
          reasoning: "Wrong framework",
        },
      ],
      replan_guidance: {
        root_cause: "Used wrong framework",
        what_failed: "Build step",
        suggested_strategy: "Use correct framework",
        avoid_approaches: ["Don't use Express"],
      },
    }
    const parsed = EvaluatorAnalysis.parse(raw)
    expect(parsed.verdict).toBe("rejected")
    expect(parsed.classification).toBe("strategy")
    expect(parsed.replan_guidance).toBeDefined()
    expect(parsed.replan_guidance!.root_cause).toBe("Used wrong framework")
    expect(parsed.replan_guidance!.avoid_approaches).toEqual(["Don't use Express"])
  })

  test("rejects analysis with invalid verdict", () => {
    expect(() =>
      EvaluatorAnalysis.parse({
        verdict: "maybe",
        classification: "evaluation",
        summary: "test",
        goal_statuses: [],
      }),
    ).toThrow()
  })

  test("repairs truncated evaluator JSON and fills missing goal assessments", () => {
    const raw = [
      "```json",
      "{",
      '  "verdict": "rejected",',
      '  "classification": "evaluation",',
      '  "summary": "Evaluator output was cut off",',
      '  "goal_statuses": [',
      "    {",
      '      "goal_index": 0,',
      '      "status": "failed",',
      '      "evidence": "src\\\\service.ts:12\\\\nAssertion failed",',
      '      "reasoning": "Implementation does not satisfy the goal"',
      "    }",
      "  ],",
      '  "replan_guidance": {',
      '    "root_cause": "src\\\\service.ts returns the wrong value",',
      '    "what_failed": "unit.test.ts assertion failed",',
      '    "suggested_strategy": "Fix the return value and re-run bun test",',
      '    "avoid_approaches": ["Do not change the test expectation"]',
      "  }",
    ].join("\n")

    const parsed = parseEvaluatorAnalysis(raw, 2)
    expect(parsed.verdict).toBe("rejected")
    expect(parsed.goal_statuses).toHaveLength(2)
    expect(parsed.goal_statuses[0]?.status).toBe("failed")
    expect(parsed.goal_statuses[1]?.status).toBe("failed")
    expect(parsed.goal_statuses[1]?.evidence).toContain("truncated")
    expect(parsed.replan_guidance?.suggested_strategy).toContain("bun test")
  })
})

describe("GoalAssessment schema", () => {
  test("validates per-goal assessment", () => {
    const raw = {
      goal_index: 2,
      status: "failed",
      evidence: "Test file test/hello.test.ts:15 assertion failed",
      reasoning: "Expected 'Hello' but got 'Hi'",
    }
    const parsed = GoalAssessment.parse(raw)
    expect(parsed.goal_index).toBe(2)
    expect(parsed.status).toBe("failed")
    expect(parsed.evidence).toContain("test/hello.test.ts")
  })

  test("supports inconclusive status", () => {
    const parsed = GoalAssessment.parse({
      goal_index: 0,
      status: "inconclusive",
      evidence: "Could not determine",
      reasoning: "Test did not cover this goal",
    })
    expect(parsed.status).toBe("inconclusive")
  })
})

describe("ReplanGuidance schema", () => {
  test("validates structured replan guidance", () => {
    const raw = {
      root_cause: "TypeScript compilation error in src/handler.ts",
      what_failed: "Build check failed with TS2339",
      suggested_strategy: "Fix type error by adding proper interface",
      avoid_approaches: [
        "Do not use any type",
        "Do not suppress the error with @ts-ignore",
      ],
    }
    const parsed = ReplanGuidance.parse(raw)
    expect(parsed.root_cause).toContain("TypeScript")
    expect(parsed.avoid_approaches).toHaveLength(2)
  })
})

describe("Classification-based retry policy logic", () => {
  // Simulates the retryOrReplan decision logic from runtime.ts
  function shouldRetry(classification: string, retryCount: number, retryLimit: number): "retry" | "replan" | "fail" {
    if (classification === "input" || classification === "permission") return "fail"
    if (classification === "strategy") return "replan"
    if (retryCount < retryLimit) return "retry"
    return "replan"
  }

  test("transient → retry if under limit", () => {
    expect(shouldRetry("transient", 0, 2)).toBe("retry")
    expect(shouldRetry("transient", 1, 2)).toBe("retry")
    expect(shouldRetry("transient", 2, 2)).toBe("replan")
  })

  test("input → always fail (cannot fix automatically)", () => {
    expect(shouldRetry("input", 0, 2)).toBe("fail")
  })

  test("permission → always fail", () => {
    expect(shouldRetry("permission", 0, 2)).toBe("fail")
  })

  test("strategy → always replan (skip retry)", () => {
    expect(shouldRetry("strategy", 0, 2)).toBe("replan")
    expect(shouldRetry("strategy", 0, 0)).toBe("replan")
  })

  test("evaluation → retry first, then replan", () => {
    expect(shouldRetry("evaluation", 0, 2)).toBe("retry")
    expect(shouldRetry("evaluation", 2, 2)).toBe("replan")
  })

  test("environment → retry first, then replan", () => {
    expect(shouldRetry("environment", 0, 1)).toBe("retry")
    expect(shouldRetry("environment", 1, 1)).toBe("replan")
  })

  test("unknown → retry first, then replan", () => {
    expect(shouldRetry("unknown", 0, 2)).toBe("retry")
    expect(shouldRetry("unknown", 2, 2)).toBe("replan")
  })
})

describe("Per-goal status update logic", () => {
  test("maps agent goal_statuses to DB updates correctly", () => {
    const goals = [
      { id: "g1", description: "Build passes", status: "pending" },
      { id: "g2", description: "Tests pass", status: "pending" },
      { id: "g3", description: "Lint passes", status: "pending" },
    ]

    const analysis: EvaluatorAnalysisType = {
      verdict: "rejected",
      classification: "evaluation",
      summary: "Tests failed",
      goal_statuses: [
        { goal_index: 0, status: "passed", evidence: "Build OK", reasoning: "Exit 0" },
        { goal_index: 1, status: "failed", evidence: "2 tests failed", reasoning: "Assertion error" },
        { goal_index: 2, status: "inconclusive", evidence: "Skipped", reasoning: "Depends on tests" },
      ],
    }

    // Simulate the runtime logic
    const updates: Array<{ id: string; status: string }> = []
    for (const gs of analysis.goal_statuses) {
      const goal = goals[gs.goal_index]
      if (!goal) continue
      const goalStatus = gs.status === "passed" ? "passed" : gs.status === "failed" ? "failed" : undefined
      if (!goalStatus || goal.status === goalStatus) continue
      updates.push({ id: goal.id, status: goalStatus })
    }

    expect(updates).toHaveLength(2) // g1=passed, g2=failed, g3=inconclusive→skip
    expect(updates[0]).toEqual({ id: "g1", status: "passed" })
    expect(updates[1]).toEqual({ id: "g2", status: "failed" })
  })

  test("inconclusive goals are not updated", () => {
    const analysis: EvaluatorAnalysisType = {
      verdict: "inconclusive",
      classification: "unknown",
      summary: "Cannot determine",
      goal_statuses: [
        { goal_index: 0, status: "inconclusive", evidence: "N/A", reasoning: "N/A" },
      ],
    }

    const goalStatus = analysis.goal_statuses[0].status === "passed"
      ? "passed"
      : analysis.goal_statuses[0].status === "failed"
        ? "failed"
        : undefined

    expect(goalStatus).toBeUndefined() // inconclusive → no update
  })
})
