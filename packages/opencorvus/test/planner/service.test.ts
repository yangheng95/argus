import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { ExecutorRegistry } from "../../src/executor/registry"
import { PlannerAgent } from "../../src/planner/agent"
import { PlannerService } from "../../src/planner/service"

beforeEach(() => {
  process.env.OPENCORVUS_UNATTENDED = "0"
})

afterEach(() => {
  mock.restore()
  ExecutorRegistry.reset()
  delete process.env.OPENCORVUS_UNATTENDED
})

const BASE_PLAN = {
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
} as const

const MOCK_SPEC = {
  summary: "Spec summary",
  content: "# Scope\n\nExpanded spec based on real files",
  scope: "Expanded spec based on real files",
  requirements: [
    {
      id: "req_primary",
      title: "Primary requirement",
      description: "The landing page update builds cleanly.",
      priority: "blocking" as const,
      acceptance: ["build passes"],
      evidence_refs: ["src/app.ts"],
    },
  ],
  assumptions: [],
  risks: [],
  evidence_sources: [],
  unresolved_questions: [],
}

const MOCK_GOALS = [
  {
    description: "Primary goal",
    criteria: "build passes",
    priority: "blocking" as const,
    metadata: {
      check_selector: ["build"],
    },
  },
]

function planForGoals(goalCount: number, overrides: Record<string, unknown> = {}) {
  return {
    ...BASE_PLAN,
    waves: Array.from({ length: goalCount }, (_, index) => ({
      title: `Wave ${index + 1}`,
      objective: `Execute goal ${index + 1}`,
      goal_indices: [index],
      owned_paths: [`src/goal-${index + 1}.ts`],
    })),
    ...overrides,
  } as any
}

describe("planner.service", () => {
  test("builds an initial plan with execution prompt", async () => {
    spyOn(PlannerAgent, "plan").mockResolvedValue(planForGoals(1))
    const plan = await PlannerService.initial({
      title: "Update landing page",
      request: "Update the landing page hero copy and make sure tests pass.",
      spec: MOCK_SPEC,
      goals: MOCK_GOALS,
    })

    expect(plan.summary).toContain("Update the landing page")
    expect(plan.metadata.spec_analysis?.goals.length).toBeGreaterThanOrEqual(1)
    expect(plan.metadata.strategy).toBe("initial")
    expect(plan.metadata.planner?.role).toBe("headless_compiler")
    expect(plan.metadata.steps.length).toBeGreaterThan(1)
    expect(plan.prompt).toContain("## Execution Guide")
    expect(plan.prompt).toContain("planner")
    expect(plan.prompt).toContain("typecheck")
  })

  test("planner receives spec as input (decoupled from spec stage)", async () => {
    const planner = spyOn(PlannerAgent, "plan").mockResolvedValue(planForGoals(1))
    const spec = {
      ...MOCK_SPEC,
      content: "# Scope\n\nAuthoritative spec",
    }

    await PlannerService.initial({
      title: "Update landing page",
      request: "Update the landing page hero copy and make sure tests pass.",
      spec,
      goals: MOCK_GOALS,
    })

    expect(planner).toHaveBeenCalledWith(expect.objectContaining({
      spec: {
        summary: "Spec summary",
        content: "# Scope\n\nAuthoritative spec",
      },
    }))
  })

  test("builds a replan with failure context and replan section", async () => {
    spyOn(PlannerAgent, "plan").mockResolvedValue(planForGoals(1, {
      summary: "Fix flaky integration test with a new approach",
    }))
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
    spyOn(PlannerAgent, "plan").mockResolvedValue(planForGoals(1))
    const plan = await PlannerService.initial({
      title: "Review dashboard UI",
      request: "Improve the dashboard UI/UX and make sure the app starts normally before delivery.",
      spec: MOCK_SPEC,
      goals: [
        {
          description: "Improve the dashboard UI",
          criteria: "The app starts normally and the UI review passes",
          priority: "blocking",
          metadata: {
            check_selector: ["ui_review", "startup"],
          },
        },
      ],
    })

    expect(plan.prompt).toContain("ui_review")
    expect(plan.prompt).toContain("startup")
    expect(plan.prompt).toContain("Evaluator-managed: startup")
    expect(plan.prompt).toContain("Do NOT launch background or long-lived dev servers")
  })

  test("keeps heavy command selectors goal-local", async () => {
    spyOn(PlannerAgent, "plan").mockResolvedValue(planForGoals(2))
    const plan = await PlannerService.initial({
      title: "Dashboard refresh",
      request: "Improve the dashboard UI/UX and make sure tests pass before delivery.",
      spec: MOCK_SPEC,
      goals: [
        {
          description: "Refresh dashboard UI",
          criteria: "The UI review passes.",
          priority: "blocking",
          metadata: {
            check_selector: ["spec_check", "ui_review"],
          },
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
    expect(goals[1]?.metadata?.check_selector).not.toContain("spec_check")
  })

  test("infers code review and dead code selectors for relevant requests", async () => {
    spyOn(PlannerAgent, "plan").mockResolvedValue(planForGoals(1))
    const plan = await PlannerService.initial({
      title: "Review cleanup",
      request: "Do a CR for this refactor and check whether dead code or obsolete branches still remain.",
      spec: MOCK_SPEC,
      goals: [
        {
          description: "Run a code review",
          criteria: "Review findings are addressed and dead code is checked",
          priority: "blocking",
          metadata: {
            check_selector: ["code_review", "dead_code_review"],
          },
        },
      ],
    })

    expect(plan.prompt).toContain("code_review")
    expect(plan.prompt).toContain("dead_code_review")
  })

  test("flags vague requests for clarification by default", async () => {
    spyOn(PlannerAgent, "plan").mockResolvedValue(planForGoals(1))
    const plan = await PlannerService.initial({
      title: "Optimize performance",
      request: "Optimize performance",
      spec: MOCK_SPEC,
      goals: MOCK_GOALS,
    })

    expect(plan.metadata.clarification?.questions.length).toBe(1)
    expect(plan.metadata.clarification?.reason).toBeTruthy()
  })

  test("preserves multiple model-generated clarification questions", async () => {
    spyOn(PlannerAgent, "plan").mockResolvedValue({
      ...planForGoals(1),
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
      goals: MOCK_GOALS,
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
        request: "Optimize performance",
        spec: MOCK_SPEC,
        goals: MOCK_GOALS,
      }),
    ).rejects.toThrow("planner agent failed")
  })

  test("times out internal replanning instead of hanging indefinitely", async () => {
    process.env.OPENCORVUS_PLANNER_TIMEOUT_MS = "20"
    spyOn(PlannerAgent, "plan").mockImplementation(async ({ signal }) => {
      await new Promise<never>((_, reject) => {
        signal?.addEventListener("abort", () => {
          reject(signal.reason ?? new Error("aborted"))
        }, { once: true })
      })
      throw new Error("unreachable")
    })

    await expect(
      PlannerService.replan({
        title: "Failure",
        request: "Optimize performance",
        spec: MOCK_SPEC,
        goals: MOCK_GOALS,
        previousPrompt: "Old plan",
        previousPlanID: "pln_previous",
        failureSummary: "The build is still failing.",
      }),
    ).rejects.toThrow("planner stalled after 20ms without activity")
  })

  test("suppresses clarification when allowClarification is false", async () => {
    spyOn(PlannerAgent, "plan").mockResolvedValue(planForGoals(1))
    const plan = await PlannerService.initial({
      title: "Optimize performance",
      request: "Optimize performance",
      spec: MOCK_SPEC,
      goals: MOCK_GOALS,
      allowClarification: false,
    })

    expect(plan.metadata.clarification).toBeUndefined()
  })

  test("suppresses spec clarification automatically in unattended mode", async () => {
    process.env.OPENCORVUS_UNATTENDED = "1"
    spyOn(PlannerAgent, "plan").mockResolvedValue(planForGoals(1))

    const plan = await PlannerService.initial({
      title: "Unattended task",
      request: "Optimize performance",
      spec: {
        ...MOCK_SPEC,
        clarifications: [
          {
            header: "Scope",
            question: "Which page should be optimized first?",
            context: "The request does not identify a target page.",
            default_assumption: "Start with the default landing page.",
          },
        ],
      } as any,
      goals: MOCK_GOALS,
    })

    expect(plan.metadata.clarification).toBeUndefined()
    expect(plan.metadata.planner?.clarification_source).toBe("suppressed")
    expect(plan.prompt).toContain("Start with the default landing page.")
  })

  test("uses executor-native plan when configured with spec input", async () => {
    const seen: Array<Record<string, unknown>> = []
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
        seen.push(input as Record<string, unknown>)
        return {
          output: JSON.stringify({
            prd: "Executor PRD",
            summary: "Executor plan summary",
            waves: [
              {
                title: "Wave 1",
                objective: "Execute goal 1",
                goal_indices: [0],
                owned_paths: ["src/executor.ts"],
              },
            ],
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
      requirements: MOCK_SPEC.requirements,
      assumptions: [],
      risks: [],
    }

    const plan = await PlannerService.initial({
      title: "Executor plan",
      request: "Plan with executor",
      spec: executorSpec as any,
      goals: MOCK_GOALS,
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
    expect(plan.metadata.spec_analysis?.expanded_spec).toContain("Executor PRD")
    expect(seen[0]?.outputSchema).toMatchObject({
      type: "object",
      properties: {
        prd: expect.any(Object),
        summary: expect.any(Object),
        subtasks: expect.any(Object),
        risks: expect.any(Object),
      },
    })
  })

  test("fails fast when executor-native planning is requested but unsupported", async () => {
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

    await expect(
      PlannerService.initial({
        title: "Unsupported executor plan",
        request: "Plan without fallback",
        spec: { ...MOCK_SPEC, content: "# Scope\n\nFallback spec" },
        goals: MOCK_GOALS,
        executor: "codex",
        routing: {
          plan: "executor",
        },
      }),
    ).rejects.toThrow("does not support plan generation")
  })

  test("surfaces spec-stage clarification before planning", async () => {
    const planner = spyOn(PlannerAgent, "plan").mockResolvedValue(planForGoals(1))
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
      spec: specWithClarification as any,
      goals: MOCK_GOALS,
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
        throw new Error("should not be called because spec has clarifications")
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
      spec: specWithClarification as any,
      goals: MOCK_GOALS,
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
      ...planForGoals(1),
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
      goals: MOCK_GOALS,
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

  test("ignores compatibility goals embedded in spec and uses explicit goal-stage input only", async () => {
    spyOn(PlannerAgent, "plan").mockResolvedValue(planForGoals(1))

    const plan = await PlannerService.initial({
      title: "Compatibility cleanup",
      request: "Plan from explicit goals only.",
      spec: {
        ...MOCK_SPEC,
        goals: [
          {
            description: "legacy spec goal",
            criteria: "should be ignored",
            priority: "blocking",
          },
        ],
      } as any,
      goals: [
        {
          description: "authoritative goal",
          criteria: "must be preserved",
          priority: "blocking",
        },
      ],
    })

    expect(plan.metadata.spec_analysis?.goals).toEqual([
      expect.objectContaining({
        description: "authoritative goal",
        criteria: "must be preserved",
      }),
    ])
    expect(plan.metadata.spec_analysis?.goals).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ description: "legacy spec goal" })]),
    )
  })
})
