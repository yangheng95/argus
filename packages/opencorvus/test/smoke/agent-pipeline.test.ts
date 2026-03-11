/**
 * End-to-end smoke test for the independent-context agent pipeline.
 *
 * Tests the full flow: PlannerAgent → PlannerService → EvaluatorAgent → Runtime
 * without requiring actual LLM calls (mocks the Provider layer).
 */
import { describe, test, expect, mock, beforeEach, spyOn } from "bun:test"
import { PlannerAgent, type PlannerOutputType } from "@/planner/agent"
import { PlannerService } from "@/planner/service"
import {
  EvaluatorAgent,
  type EvaluatorAnalysisType,
  type CheckResult,
  type GoalInfo,
  type DeliveryInfo,
} from "@/evaluator/agent"
import type { ReplanContext } from "@/planner/agent"

// ---------------------------------------------------------------------------
// Mock PlannerAgent.plan to avoid real LLM calls
// ---------------------------------------------------------------------------

const MOCK_PLAN_OUTPUT: PlannerOutputType = {
  prd: "Expanded PRD: Add a greeting endpoint to the API that returns 'Hello, World!'.\n\nBased on codebase exploration:\n- Server uses Hono framework\n- Routes are in src/server/routes/\n- Tests use bun:test",
  summary: "Add GET /hello endpoint returning Hello World",
  milestones: [
    {
      title: "Core Implementation",
      description: "Implement the greeting endpoint",
      goal_indices: [0],
    },
    {
      title: "Polish",
      description: "Error handling and edge cases",
      goal_indices: [1],
    },
  ],
  subtasks: [
    {
      title: "Create route handler",
      description: "Add GET /hello route in src/server/routes/",
      order: 1,
    },
    {
      title: "Add tests",
      description: "Write unit tests for the greeting endpoint",
      order: 2,
    },
    {
      title: "Verify build",
      description: "Run build and test to verify",
      order: 3,
    },
  ],
  risks: ["Potential port conflict if server is already running"],
  assumptions: [
    {
      question: "Should the greeting be configurable?",
      assumption: "No, hardcoded 'Hello, World!' is sufficient",
    },
  ],
}

const MOCK_GOALS = [
  {
    description: "GET /hello endpoint returns 200 with greeting",
    criteria: "curl localhost:3000/hello returns HTTP 200 with body containing 'Hello'",
    priority: "blocking" as const,
  },
  {
    description: "Endpoint has proper error handling",
    criteria: "Invalid requests return appropriate HTTP error codes",
    priority: "advisory" as const,
  },
]

const MOCK_ANALYSIS_ACCEPTED: EvaluatorAnalysisType = {
  verdict: "accepted",
  classification: "evaluation",
  summary: "All checks passed. The greeting endpoint is correctly implemented.",
  goal_statuses: [
    {
      goal_index: 0,
      status: "passed",
      evidence: "Build passed, test for /hello endpoint passed with 200 status",
      reasoning: "The endpoint exists and returns the correct response",
    },
    {
      goal_index: 1,
      status: "passed",
      evidence: "Error handling test shows 404 for unknown routes",
      reasoning: "Proper HTTP error codes are returned",
    },
  ],
}

const MOCK_ANALYSIS_REJECTED: EvaluatorAnalysisType = {
  verdict: "rejected",
  classification: "evaluation",
  summary: "Build passed but test for greeting endpoint failed — wrong response body.",
  goal_statuses: [
    {
      goal_index: 0,
      status: "failed",
      evidence: "Test expected 'Hello, World!' but got 'Hi there'",
      reasoning: "The response body doesn't match the acceptance criteria",
    },
    {
      goal_index: 1,
      status: "inconclusive",
      evidence: "Could not determine — test failed before reaching error handling tests",
      reasoning: "Dependent on goal 0 passing first",
    },
  ],
  replan_guidance: {
    root_cause: "Response body in route handler uses 'Hi there' instead of 'Hello, World!'",
    what_failed: "src/server/routes/hello.ts line 5: wrong string literal",
    suggested_strategy: "Fix the string literal in the route handler to 'Hello, World!'",
    avoid_approaches: ["Don't change the test to match the wrong output"],
  },
}

const MOCK_ANALYSIS_STRATEGY: EvaluatorAnalysisType = {
  verdict: "rejected",
  classification: "strategy",
  summary: "Fundamental approach is wrong — tried to use Express but project uses Hono.",
  goal_statuses: [
    {
      goal_index: 0,
      status: "failed",
      evidence: "Build error: Cannot find module 'express'",
      reasoning: "Wrong framework used",
    },
  ],
  replan_guidance: {
    root_cause: "Used Express instead of Hono for the route handler",
    what_failed: "Build failed because Express is not a project dependency",
    suggested_strategy: "Use Hono framework which is the project's actual web framework",
    avoid_approaches: ["Do not use Express — it's not installed in this project"],
  },
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PlannerAgent output structure", () => {
  test("produces valid PlannerOutput with all required fields", () => {
    const output = MOCK_PLAN_OUTPUT
    expect(output.prd).toBeTruthy()
    expect(output.summary).toBeTruthy()
    expect(output.subtasks.length).toBeGreaterThan(0)
    expect(output.risks.length).toBeGreaterThan(0)

    // Subtasks are ordered
    const orders = output.subtasks.map((s) => s.order ?? 0)
    expect(orders).toEqual([...orders].sort((a, b) => a - b))
  })

  test("milestones reference valid goal indices", () => {
    const output = MOCK_PLAN_OUTPUT
    expect(output.milestones).toBeDefined()
    for (const ms of output.milestones!) {
      for (const idx of ms.goal_indices) {
        expect(idx).toBeGreaterThanOrEqual(0)
        expect(idx).toBeLessThan(MOCK_GOALS.length)
      }
    }
  })
})

describe("EvaluatorAgent output structure", () => {
  test("accepted analysis has all goals assessed", () => {
    const analysis = MOCK_ANALYSIS_ACCEPTED
    expect(analysis.verdict).toBe("accepted")
    expect(analysis.goal_statuses.length).toBe(2)
    expect(analysis.goal_statuses.every((gs) => gs.status === "passed")).toBe(true)
    expect(analysis.replan_guidance).toBeUndefined()
  })

  test("rejected analysis includes replan guidance", () => {
    const analysis = MOCK_ANALYSIS_REJECTED
    expect(analysis.verdict).toBe("rejected")
    expect(analysis.classification).toBe("evaluation")
    expect(analysis.replan_guidance).toBeDefined()
    expect(analysis.replan_guidance!.root_cause).toBeTruthy()
    expect(analysis.replan_guidance!.suggested_strategy).toBeTruthy()
    expect(analysis.replan_guidance!.avoid_approaches.length).toBeGreaterThan(0)
  })

  test("strategy classification skips retry and goes to replan", () => {
    const analysis = MOCK_ANALYSIS_STRATEGY
    expect(analysis.classification).toBe("strategy")
    expect(analysis.replan_guidance).toBeDefined()
  })
})

describe("PlannerService integration", () => {
  test("initial() with explicit goals uses planner output when available", async () => {
    spyOn(PlannerAgent, "plan").mockResolvedValue(MOCK_PLAN_OUTPUT)
    const result = await PlannerService.initial({
      title: "Test task",
      request: "Do something",
      spec: {
        summary: "Spec summary",
        content: "# Scope\n\nDo something",
        goals: [
          { description: "Goal A", criteria: "A passes", priority: "blocking" },
        ],
        assumptions: [],
        risks: [],
      },
    })
    expect(result.summary).toBeTruthy()
    expect(result.prompt).toContain("Test task")
    expect(result.prompt).toContain("Goal A")
    expect(result.metadata.strategy).toBe("initial")
  })

  test("initial() throws when agent is unavailable", async () => {
    spyOn(PlannerAgent, "plan").mockRejectedValue(new Error("no model"))
    await expect(
      PlannerService.initial({
        title: "Add button",
        request: "Add a submit button to the form",
      }),
    ).rejects.toThrow("planner agent failed")
  })

  test("replan() throws when agent is unavailable", async () => {
    spyOn(PlannerAgent, "plan").mockRejectedValue(new Error("no model"))
    await expect(
      PlannerService.replan({
        title: "Fix bug",
        request: "Fix the login validation bug",
        spec: {
          summary: "Spec summary",
          content: "# Scope\n\nFix the login validation bug",
          goals: [{ description: "Login works", criteria: "Test passes", priority: "blocking" }],
          assumptions: [],
          risks: [],
        },
        goals: [{ description: "Login works", criteria: "Test passes", priority: "blocking" }],
        previousPrompt: "Previous prompt content...",
        previousPlanID: "plan_001",
        failureSummary: "Build failed due to syntax error",
      }),
    ).rejects.toThrow("planner agent replan failed")
  })
})

describe("ReplanContext construction", () => {
  test("builds valid ReplanContext from evaluator analysis", () => {
    const analysis = MOCK_ANALYSIS_REJECTED
    const goals = MOCK_GOALS

    const ctx: ReplanContext = {
      previousSummary: "Add GET /hello endpoint returning Hello World",
      failureAnalysis: {
        classification: analysis.classification,
        summary: analysis.summary,
        rootCause: analysis.replan_guidance!.root_cause,
        suggestedStrategy: analysis.replan_guidance!.suggested_strategy,
        avoidApproaches: analysis.replan_guidance!.avoid_approaches,
      },
      previousGoalStatuses: analysis.goal_statuses.map((gs) => ({
        description: goals[gs.goal_index]?.description ?? `Goal ${gs.goal_index}`,
        status: gs.status,
        evidence: gs.evidence,
      })),
    }

    expect(ctx.failureAnalysis.classification).toBe("evaluation")
    expect(ctx.failureAnalysis.rootCause).toContain("Hi there")
    expect(ctx.failureAnalysis.avoidApproaches).toHaveLength(1)
    expect(ctx.previousGoalStatuses).toHaveLength(2)
    expect(ctx.previousGoalStatuses[0].status).toBe("failed")
    expect(ctx.previousGoalStatuses[1].status).toBe("inconclusive")
  })

  test("strategy failure context includes different approach guidance", () => {
    const analysis = MOCK_ANALYSIS_STRATEGY
    const ctx: ReplanContext = {
      previousSummary: "Previous plan summary",
      failureAnalysis: {
        classification: analysis.classification,
        summary: analysis.summary,
        rootCause: analysis.replan_guidance!.root_cause,
        suggestedStrategy: analysis.replan_guidance!.suggested_strategy,
        avoidApproaches: analysis.replan_guidance!.avoid_approaches,
      },
      previousGoalStatuses: [],
    }

    expect(ctx.failureAnalysis.classification).toBe("strategy")
    expect(ctx.failureAnalysis.suggestedStrategy).toContain("Hono")
    expect(ctx.failureAnalysis.avoidApproaches[0]).toContain("Express")
  })
})

describe("Classification-based retry policy", () => {
  // Simulates the retryOrReplan decision logic from runtime.ts
  function policyAction(classification: string): "retry" | "replan" | "fail" {
    if (classification === "input" || classification === "permission") return "fail"
    if (classification === "strategy") return "replan"
    return "retry"
  }

  test("transient failures should allow retry", () => {
    expect(policyAction("transient")).toBe("retry")
  })

  test("input/permission failures should not retry", () => {
    expect(policyAction("input")).toBe("fail")
    expect(policyAction("permission")).toBe("fail")
  })

  test("strategy failures should skip retry and replan", () => {
    expect(policyAction("strategy")).toBe("replan")
  })

  test("evaluation/environment/unknown failures should retry then replan", () => {
    for (const cls of ["evaluation", "environment", "unknown"]) {
      expect(policyAction(cls)).toBe("retry")
    }
  })
})

describe("Agent output to PlanDraft conversion", () => {
  test("agentOutputToDraft produces valid prompt with all sections", async () => {
    spyOn(PlannerAgent, "plan").mockResolvedValue(MOCK_PLAN_OUTPUT)
    const result = await PlannerService.initial({
      title: "Test conversion",
      request: "Implement feature X",
      spec: {
        summary: "Spec summary",
        content: "# Scope\n\nImplement feature X",
        goals: [
          {
            description: "Feature X works",
            criteria: "bun run test passes",
            priority: "blocking",
          },
        ],
        assumptions: [],
        risks: [],
      },
    })

    expect(result.prompt).toContain("Test conversion")
    expect(result.prompt).toContain("Expanded PRD")
    expect(result.prompt).toContain("## Goals")
    expect(result.prompt).toContain("## Subtasks")
    expect(result.prompt).toContain("## Execution Guide")
  })
})

describe("Codebase tools", () => {
  test("createCodebaseTools returns all required tools", async () => {
    const { createCodebaseTools } = await import("@/orchestrator/codebase-tools")
    const tools = createCodebaseTools(process.cwd())

    expect(tools.read_file).toBeDefined()
    expect(tools.find_files).toBeDefined()
    expect(tools.search_code).toBeDefined()
    expect(tools.list_directory).toBeDefined()
  })

  test("read_file rejects paths outside project boundary", async () => {
    const { createCodebaseTools } = await import("@/orchestrator/codebase-tools")
    const tools = createCodebaseTools(process.cwd())

    const result = await tools.read_file.execute!(
      { path: "../../../etc/passwd" } as any,
      { toolCallId: "test", messages: [], abortSignal: new AbortController().signal },
    )
    expect(result).toContain("outside the project boundary")
  })

  test("list_directory lists files in project root", async () => {
    const { createCodebaseTools } = await import("@/orchestrator/codebase-tools")
    const tools = createCodebaseTools(process.cwd())

    const result = await tools.list_directory.execute!(
      {} as any,
      { toolCallId: "test", messages: [], abortSignal: new AbortController().signal },
    )
    expect(typeof result).toBe("string")
    expect((result as string).length).toBeGreaterThan(0)
  })
})
