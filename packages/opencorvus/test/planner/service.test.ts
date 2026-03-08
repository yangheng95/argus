import { describe, expect, test } from "bun:test"
import { PlannerService } from "../../src/planner/service"

describe("planner.service", () => {
  test("builds an initial plan with plan-mode workflow prompt", async () => {
    const plan = await PlannerService.initial({
      title: "Update landing page",
      request: "Update the landing page hero copy and make sure tests pass.",
    })

    expect(plan.summary).toContain("Update the landing page")
    expect(plan.goals.length).toBeGreaterThanOrEqual(1)
    expect(plan.metadata.strategy).toBe("initial")
    expect(plan.metadata.steps.length).toBeGreaterThan(2)
    // Plan-mode workflow prompt should contain upstream-style phases
    expect(plan.prompt).toContain("Phase 1: Explore")
    expect(plan.prompt).toContain("Phase 2: Plan with the Planner Tool")
    expect(plan.prompt).toContain("planner")
    expect(plan.prompt).toContain("add_task")
  })

  test("builds a replan with failure context and replan section", async () => {
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
    expect(plan.prompt).toContain("Replan Context")
    expect(plan.prompt).toContain("Old plan")
    expect(plan.prompt).toContain("times out")
  })

  test("infers ui and startup selectors for relevant requests", async () => {
    const plan = await PlannerService.initial({
      title: "Review dashboard UI",
      request: "Improve the dashboard UI/UX and make sure the app starts normally before delivery.",
    })

    expect(plan.goals[0]?.metadata?.check_selector).toContain("ui_review")
    expect(plan.goals[0]?.metadata?.check_selector).toContain("startup")
  })

  test("infers code review and dead code selectors for relevant requests", async () => {
    const plan = await PlannerService.initial({
      title: "Review cleanup",
      request: "Do a CR for this refactor and check whether dead code or obsolete branches still remain.",
    })

    expect(plan.goals[0]?.metadata?.check_selector).toContain("code_review")
    expect(plan.goals[0]?.metadata?.check_selector).toContain("dead_code_review")
  })
})
