import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { PlannerService } from "../../src/planner/service"
import { PlannerAgent } from "../../src/planner/agent"

afterEach(() => {
  mock.restore()
})

const MOCK_PLAN = {
  prd: "Expanded spec based on real files",
  summary: "Update the landing page plan summary",
  goals: [
    {
      description: "Primary goal",
      criteria: "build passes",
      priority: "blocking",
      check_selector: ["build"],
    },
  ],
  subtasks: [
    {
      title: "Inspect code",
      description: "Inspect relevant files",
      order: 1,
    },
    {
      title: "Implement change",
      description: "Implement the requested change",
      order: 2,
    },
  ],
  risks: ["Risk"],
} as any

describe("planner.service", () => {
  test("builds an initial plan with execution prompt", async () => {
    spyOn(PlannerAgent, "plan").mockResolvedValue(MOCK_PLAN)
    const plan = await PlannerService.initial({
      title: "Update landing page",
      request: "Update the landing page hero copy and make sure tests pass.",
    })

    expect(plan.summary).toContain("Update the landing page")
    expect(plan.goals.length).toBeGreaterThanOrEqual(1)
    expect(plan.metadata.strategy).toBe("initial")
    expect(plan.metadata.planner?.role).toBe("headless_compiler")
    expect(plan.metadata.steps.length).toBeGreaterThan(1)
    // Execution prompt should contain key workflow elements
    expect(plan.prompt).toContain("## Execution Guide")
    expect(plan.prompt).toContain("planner")
    expect(plan.prompt).toContain("typecheck")
  })

  test("builds a replan with failure context and replan section", async () => {
    spyOn(PlannerAgent, "plan").mockResolvedValue({
      ...MOCK_PLAN,
      summary: "Fix flaky integration test with a new approach",
    } as any)
    const plan = await PlannerService.replan({
      title: "Fix failing test",
      request: "Fix the flaky integration test.",
      goals: [
        {
          description: "Fix the flaky integration test.",
          criteria: "The test suite passes reliably.",
          priority: "blocking",
        },
      ],
      previousPrompt: "Old plan",
      previousPlanID: "pln_previous",
      failureSummary: "The integration test still times out.",
    })

    expect(plan.metadata.strategy).toBe("replan")
    expect(plan.metadata.failure_summary).toContain("times out")
    expect(plan.metadata.previous_plan_id).toBe("pln_previous")
    expect(plan.prompt).toContain("This is a **replan**")
    expect(plan.prompt).toContain("different strategy")
  })

  test("infers ui and startup selectors for relevant requests", async () => {
    spyOn(PlannerAgent, "plan").mockResolvedValue({
      ...MOCK_PLAN,
      goals: [
        {
          description: "Improve the dashboard UI",
          criteria: "The app starts normally and the UI review passes",
          priority: "blocking",
        },
      ],
    } as any)
    const plan = await PlannerService.initial({
      title: "Review dashboard UI",
      request: "Improve the dashboard UI/UX and make sure the app starts normally before delivery.",
    })

    expect(plan.goals[0]?.metadata?.check_selector).toContain("ui_review")
    expect(plan.goals[0]?.metadata?.check_selector).toContain("startup")
  })

  test("infers code review and dead code selectors for relevant requests", async () => {
    spyOn(PlannerAgent, "plan").mockResolvedValue({
      ...MOCK_PLAN,
      goals: [
        {
          description: "Run a code review",
          criteria: "Review findings are addressed and dead code is checked",
          priority: "blocking",
        },
      ],
    } as any)
    const plan = await PlannerService.initial({
      title: "Review cleanup",
      request: "Do a CR for this refactor and check whether dead code or obsolete branches still remain.",
    })

    expect(plan.goals[0]?.metadata?.check_selector).toContain("code_review")
    expect(plan.goals[0]?.metadata?.check_selector).toContain("dead_code_review")
  })

  test("flags vague requests for clarification by default", async () => {
    spyOn(PlannerAgent, "plan").mockResolvedValue(MOCK_PLAN)
    const plan = await PlannerService.initial({
      title: "优化性能",
      request: "优化性能",
    })

    expect(plan.metadata.clarification?.questions.length).toBe(1)
    expect(plan.metadata.clarification?.reason).toBeTruthy()
  })

  test("preserves multiple model-generated clarification questions", async () => {
    spyOn(PlannerAgent, "plan").mockResolvedValue({
      prd: "Expanded spec",
      summary: "Plan summary",
      goals: [
        {
          description: "Goal",
          criteria: "Criteria",
          priority: "blocking",
          check_selector: ["build"],
        },
      ],
      subtasks: [
        {
          title: "Inspect",
          description: "Inspect the code",
          order: 1,
        },
      ],
      risks: [],
      clarifications: [
        {
          header: "Scope",
          question: "Which package should this target?",
          context: "Scope is ambiguous",
          default_assumption: "Use the main package",
        },
        {
          header: "Compatibility",
          question: "Should the API remain backward compatible?",
          context: "Compatibility is unclear",
          default_assumption: "Keep it backward compatible",
        },
      ],
    } as any)

    const plan = await PlannerService.initial({
      title: "Ambiguous task",
      request: "Handle this refactor carefully.",
    })

    expect(plan.metadata.planner?.quality).toBe("compiled")
    expect(plan.metadata.planner?.clarification_source).toBe("model")
    expect(plan.metadata.clarification?.questions).toHaveLength(2)
  })

  test("throws explicitly when planner agent fails", async () => {
    spyOn(PlannerAgent, "plan").mockRejectedValue(new Error("boom"))

    await expect(
      PlannerService.initial({
        title: "Failure",
        request: "优化性能",
      }),
    ).rejects.toThrow("planner agent failed")
  })

  test("suppresses clarification when allowClarification is false", async () => {
    spyOn(PlannerAgent, "plan").mockResolvedValue(MOCK_PLAN)
    const plan = await PlannerService.initial({
      title: "优化性能",
      request: "优化性能",
      allowClarification: false,
    })

    expect(plan.metadata.clarification).toBeUndefined()
  })
})
