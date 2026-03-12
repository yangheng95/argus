import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { ExecutorRegistry } from "../../src/executor/registry"
import { PlannerService } from "../../src/planner/service"
import { PlannerAgent } from "../../src/planner/agent"

afterEach(() => {
  mock.restore()
  ExecutorRegistry.reset()
})

const MOCK_PLAN = {
  prd: "Expanded spec based on real files",
  summary: "Update the landing page plan summary",
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

const MOCK_SPEC = {
  summary: "Spec summary",
  content: "# Scope\n\nExpanded spec based on real files",
  goals: [
    {
      description: "Primary goal",
      criteria: "build passes",
      priority: "blocking",
      metadata: {
        check_selector: ["build"],
      },
    },
  ],
  assumptions: [],
  risks: [],
  spec_items: [],
  evidence_sources: [],
  unresolved_questions: [],
}

describe("planner.service", () => {
  test("builds an initial plan with execution prompt", async () => {
    spyOn(PlannerAgent, "plan").mockResolvedValue(MOCK_PLAN)
    const plan = await PlannerService.initial({
      title: "Update landing page",
      request: "Update the landing page hero copy and make sure tests pass.",
      spec: MOCK_SPEC,
    })

    expect(plan.summary).toContain("Update the landing page")
    expect(plan.metadata.spec_analysis?.goals.length).toBeGreaterThanOrEqual(1)
    expect(plan.metadata.strategy).toBe("initial")
    expect(plan.metadata.planner?.role).toBe("headless_compiler")
    expect(plan.metadata.steps.length).toBeGreaterThan(1)
    // Execution prompt should contain key workflow elements
    expect(plan.prompt).toContain("## Execution Guide")
    expect(plan.prompt).toContain("planner")
    expect(plan.prompt).toContain("typecheck")
  })

  test("planner receives spec as input (decoupled from spec stage)", async () => {
    const planner = spyOn(PlannerAgent, "plan").mockResolvedValue(MOCK_PLAN)
    const spec = {
      ...MOCK_SPEC,
      content: "# Scope\n\nAuthoritative spec",
    }

    await PlannerService.initial({
      title: "Update landing page",
      request: "Update the landing page hero copy and make sure tests pass.",
      spec,
    })

    expect(planner).toHaveBeenCalledWith(expect.objectContaining({
      spec: {
        summary: "Spec summary",
        content: "# Scope\n\nAuthoritative spec",
      },
    }))
  })

  test("builds a replan with failure context and replan section", async () => {
    spyOn(PlannerAgent, "plan").mockResolvedValue({
      ...MOCK_PLAN,
      summary: "Fix flaky integration test with a new approach",
    } as any)
    const plan = await PlannerService.replan({
      title: "Fix failing test",
      request: "Fix the flaky integration test.",
      spec: MOCK_SPEC,
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
    spyOn(PlannerAgent, "plan").mockResolvedValue(MOCK_PLAN)
    const plan = await PlannerService.initial({
      title: "Review dashboard UI",
      request: "Improve the dashboard UI/UX and make sure the app starts normally before delivery.",
      spec: {
        ...MOCK_SPEC,
        goals: [
          {
            description: "Improve the dashboard UI",
            criteria: "The app starts normally and the UI review passes",
            priority: "blocking",
          },
        ],
      },
    })

    expect(plan.prompt).toContain("ui_review")
    expect(plan.prompt).toContain("startup")
  })

  test("keeps heavy command selectors goal-local", async () => {
    spyOn(PlannerAgent, "plan").mockResolvedValue(MOCK_PLAN)
    const plan = await PlannerService.initial({
      title: "Dashboard refresh",
      request: "Improve the dashboard UI/UX and make sure tests pass before delivery.",
      spec: {
        ...MOCK_SPEC,
        goals: [
          {
            description: "Refresh dashboard UI",
            criteria: "The UI review passes.",
            priority: "blocking",
          },
          {
            description: "Run focused verification",
            criteria: "The final verification command passes.",
            priority: "blocking",
            metadata: {
              check_selector: ["verify_cmd"],
            },
          },
        ],
        spec_items: [{
          title: "Final verification",
          description: "Run the final verification command",
          priority: "blocking",
          check_selector: ["verify_cmd"],
        }],
      },
    })

    const goals = plan.metadata.spec_analysis?.goals ?? []
    expect(goals).toHaveLength(2)
    expect(goals[0]?.metadata?.check_selector).toContain("spec_check")
    expect(goals[0]?.metadata?.check_selector).toContain("ui_review")
    expect(goals[0]?.metadata?.check_selector).not.toContain("build")
    expect(goals[0]?.metadata?.check_selector).not.toContain("test")
    expect(goals[0]?.metadata?.check_selector).not.toContain("lint")
    expect(goals[0]?.metadata?.check_selector).not.toContain("verify_cmd")
    expect(goals[1]?.metadata?.check_selector).toContain("verify_cmd")
    expect(goals[1]?.metadata?.check_selector).toContain("spec_check")
  })

  test("infers code review and dead code selectors for relevant requests", async () => {
    spyOn(PlannerAgent, "plan").mockResolvedValue(MOCK_PLAN)
    const plan = await PlannerService.initial({
      title: "Review cleanup",
      request: "Do a CR for this refactor and check whether dead code or obsolete branches still remain.",
      spec: {
        ...MOCK_SPEC,
        goals: [
          {
            description: "Run a code review",
            criteria: "Review findings are addressed and dead code is checked",
            priority: "blocking",
          },
        ],
      },
    })

    expect(plan.prompt).toContain("code_review")
    expect(plan.prompt).toContain("dead_code_review")
  })

  test("flags vague requests for clarification by default", async () => {
    spyOn(PlannerAgent, "plan").mockResolvedValue(MOCK_PLAN)
    const plan = await PlannerService.initial({
      title: "优化性能",
      request: "优化性能",
      spec: MOCK_SPEC,
    })

    expect(plan.metadata.clarification?.questions.length).toBe(1)
    expect(plan.metadata.clarification?.reason).toBeTruthy()
  })

  test("preserves multiple model-generated clarification questions", async () => {
    spyOn(PlannerAgent, "plan").mockResolvedValue({
      prd: "Expanded spec",
      summary: "Plan summary",
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
      spec: MOCK_SPEC,
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
        spec: MOCK_SPEC,
      }),
    ).rejects.toThrow("planner agent failed")
  })

  test("suppresses clarification when allowClarification is false", async () => {
    spyOn(PlannerAgent, "plan").mockResolvedValue(MOCK_PLAN)
    const plan = await PlannerService.initial({
      title: "优化性能",
      request: "优化性能",
      spec: MOCK_SPEC,
      allowClarification: false,
    })

    expect(plan.metadata.clarification).toBeUndefined()
  })

  test("uses executor-native plan when configured with spec input", async () => {
    ExecutorRegistry.register("codex", {
      capabilities() {
        return {
          submit: true,
          status: true,
          abort: true,
          delivery: true,
          resume: true,
          events: true,
        }
      },
      planningCapabilities() {
        return {
          spec: true,
          plan: true,
        }
      },
      async generatePlanning(input) {
        // Only plan stage — spec is now pre-resolved by orchestrator
        return {
          output: JSON.stringify({
            prd: "Executor PRD",
            summary: "Executor plan summary",
            subtasks: [
              {
                title: "Inspect",
                description: "Inspect files",
                order: 1,
              },
            ],
            risks: [],
          }),
        }
      },
      async submit() {
        throw new Error("not used")
      },
      async status() {
        throw new Error("not used")
      },
      async abort() {
        return true
      },
      async delivery() {
        throw new Error("not used")
      },
      async resume() {
        throw new Error("not used")
      },
      async *events() {},
    })

    const executorSpec = {
      summary: "Executor spec summary",
      content: "# Scope\n\nExecutor spec",
      assumptions: [],
      risks: [],
    }

    const plan = await PlannerService.initial({
      title: "Executor plan",
      request: "Plan with executor",
      spec: executorSpec,
      executor: "codex",
      routing: {
        spec: "executor",
        plan: "executor",
      },
    })

    expect(plan.summary).toBe("Executor plan summary")
    expect(plan.metadata.planner?.source).toBe("executor_native")
    expect((plan.metadata.stage_sources?.plan as { resolved?: string })?.resolved).toBe("executor")
    expect((plan.metadata.stage_sources?.plan as { warning?: string })?.warning).toContain("prompt-constrained")
    // PRD from planner agent takes priority over spec content in expanded_spec
    expect(plan.metadata.spec_analysis?.expanded_spec).toContain("Executor PRD")
  })

  test("falls back to opencorvus planner when executor-native planning is unavailable", async () => {
    ExecutorRegistry.register("codex", {
      capabilities() {
        return {
          submit: true,
          status: true,
          abort: true,
          delivery: true,
          resume: true,
          events: true,
        }
      },
      async submit() {
        throw new Error("not used")
      },
      async status() {
        throw new Error("not used")
      },
      async abort() {
        return true
      },
      async delivery() {
        throw new Error("not used")
      },
      async resume() {
        throw new Error("not used")
      },
      async *events() {},
    })
    spyOn(PlannerAgent, "plan").mockResolvedValue(MOCK_PLAN)

    const plan = await PlannerService.initial({
      title: "Fallback plan",
      request: "Plan with fallback",
      spec: { ...MOCK_SPEC, content: "# Scope\n\nFallback spec" },
      executor: "codex",
      routing: {
        plan: "executor",
      },
    })

    expect(plan.metadata.planner?.source).toBe("planner_agent")
    expect((plan.metadata.stage_sources?.plan as { resolved?: string; fallback_reason?: string })?.resolved).toBe("opencorvus")
    expect((plan.metadata.stage_sources?.plan as { fallback_reason?: string })?.fallback_reason).toContain("does not support plan generation")
  })

  test("surfaces spec-stage clarification before planning", async () => {
    const planner = spyOn(PlannerAgent, "plan").mockResolvedValue(MOCK_PLAN)
    const specWithClarification = {
      ...MOCK_SPEC,
      clarifications: [
        {
          header: "Scope",
          question: "Which package should this change target?",
          context: "The request spans multiple packages.",
          default_assumption: "Use the main package.",
        },
      ],
    }

    const plan = await PlannerService.initial({
      title: "Ambiguous task",
      request: "Refactor this feature.",
      spec: specWithClarification,
    })

    expect(planner).not.toHaveBeenCalled()
    expect(plan.summary).toBe("Clarification required before planning")
    expect(plan.metadata.planner?.source).toBe("spec_stage")
    expect(plan.metadata.planner?.clarification_source).toBe("model")
    expect(plan.metadata.clarification?.questions[0]?.question).toContain("Which package")
  })

  test("short-circuits executor-native planning when spec has clarifications", async () => {
    ExecutorRegistry.register("codex", {
      capabilities() {
        return {
          submit: true,
          status: true,
          abort: true,
          delivery: true,
          resume: true,
          events: true,
        }
      },
      planningCapabilities() {
        return {
          spec: true,
          plan: true,
        }
      },
      async generatePlanning() {
        throw new Error("should not be called — spec has clarifications")
      },
      async submit() {
        throw new Error("not used")
      },
      async status() {
        throw new Error("not used")
      },
      async abort() {
        return true
      },
      async delivery() {
        throw new Error("not used")
      },
      async resume() {
        throw new Error("not used")
      },
      async *events() {},
    })

    const specWithClarification = {
      ...MOCK_SPEC,
      clarifications: [
        {
          header: "Scope",
          question: "Which package should this touch?",
          context: "The request spans multiple packages.",
          default_assumption: "Use the main package.",
        },
      ],
    }

    const plan = await PlannerService.initial({
      title: "Executor clarification",
      request: "Refactor this feature.",
      spec: specWithClarification,
      executor: "codex",
      routing: {
        spec: "executor",
        plan: "executor",
      },
    })

    expect(plan.metadata.clarification?.questions[0]?.question).toContain("Which package")
  })

  test("propagates spec assumptions into execution prompt and metadata", async () => {
    spyOn(PlannerAgent, "plan").mockResolvedValue({
      ...MOCK_PLAN,
      assumptions: [
        {
          question: "Can tests be updated?",
          assumption: "Yes, if behavior changes require it.",
        },
      ],
      risks: ["Plan risk"],
    } as any)

    const specWithAssumptions = {
      ...MOCK_SPEC,
      assumptions: [
        {
          question: "Which environment should be treated as canonical?",
          assumption: "Use production defaults unless the repository says otherwise.",
        },
      ],
      risks: ["Spec risk"],
    }

    const plan = await PlannerService.initial({
      title: "Assumption flow",
      request: "Update the feature and keep it safe.",
      spec: specWithAssumptions,
    })

    expect(plan.prompt).toContain("Which environment should be treated as canonical?")
    expect(plan.prompt).toContain("Can tests be updated?")
    expect(plan.metadata.risks).toEqual(["Spec risk", "Plan risk"])
    expect(plan.metadata.spec_analysis?.assumptions).toEqual([
      {
        question: "Which environment should be treated as canonical?",
        assumption: "Use production defaults unless the repository says otherwise.",
      },
      {
        question: "Can tests be updated?",
        assumption: "Yes, if behavior changes require it.",
      },
    ])
  })
})
