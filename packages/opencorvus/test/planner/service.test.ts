import { describe, expect, test } from "bun:test"
import { PlannerService } from "../../src/planner/service"

describe("planner.service", () => {
  test("builds an initial plan with derived goals and steps", () => {
    const plan = PlannerService.initial({
      title: "Update landing page",
      request: "Update the landing page hero copy and make sure tests pass.",
    })

    expect(plan.summary).toContain("Update the landing page")
    expect(plan.goals.length).toBe(1)
    expect(plan.metadata.strategy).toBe("initial")
    expect(plan.metadata.steps.length).toBeGreaterThan(2)
    expect(plan.prompt).toContain("Execution plan:")
  })

  test("builds a replan with failure context", () => {
    const plan = PlannerService.replan({
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
    expect(plan.prompt).toContain("Replan guidance:")
    expect(plan.prompt).toContain("Old plan")
  })
})
