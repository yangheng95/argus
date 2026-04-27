import { afterEach, expect, mock, test } from "bun:test"
import type { GoalContractFields } from "../../src/pipeline/types"

let runnerImpl: ((input: any) => Promise<any>) | undefined

mock.module("@/agent/runner", () => ({
  runAgentSession: (input: any) => {
    if (!runnerImpl) throw new Error("runAgentSession mock not configured")
    return runnerImpl(input)
  },
}))

const baseGoal: GoalContractFields = {
  id: "goal_ui",
  title: "UI",
  objective: "Build the requested interface.",
  acceptance_specs: [],
  owned_paths: ["src/App.tsx"],
  depends_on: [],
  exports: [],
  imports: [],
  priority: "blocking",
  kind: "feature",
  requirement_ids: ["REQ-1"],
}

afterEach(() => {
  runnerImpl = undefined
})

test("integrity uses StructuredOutput instead of finalize_integrity_review", async () => {
  const { reviewIntegrity } = await import("../../src/integrity/agent")
  runnerImpl = async (input: any) => {
    expect(input.toolKit.tools.finalize_integrity_review).toBeUndefined()
    expect(Object.keys(input.toolKit.tools).sort()).toEqual([
      "submit_goal_fidelity_verdict",
      "submit_hallucination_verdict",
      "submit_solution_quality_verdict",
      "submit_technical_feasibility_verdict",
    ])
    expect(input.format?.schema).toBeDefined()
    return {
      session: { id: "ses_integrity_missing" },
      streamErrors: [],
      structured: { summary: "All dimensions passed." },
      collector: input.toolKit.getCollector(),
      finalMessage: { info: { structured: { summary: "All dimensions passed." } } },
      model: { providerID: "test", modelID: "mock", id: "test/mock" },
      requiredTools: [],
    }
  }

  await expect(reviewIntegrity({
    userRequest: "Build UI",
    taskTitle: "Test",
    goals: [baseGoal],
  })).rejects.toThrow("missingDimensions=goal_fidelity,technical_feasibility,hallucination,solution_quality")
})

test("integrity accepts only complete dimension submissions plus StructuredOutput", async () => {
  const { reviewIntegrity } = await import("../../src/integrity/agent")
  runnerImpl = async (input: any) => {
    for (const [name, tool] of Object.entries(input.toolKit.tools)) {
      const payload = name === "submit_hallucination_verdict"
        ? { verdict: "pass", issues: [] }
        : { verdict: "pass", issues: [], corrections: [], missing_goals: [] }
      await (tool as any).execute(payload, {})
    }
    return {
      session: { id: "ses_integrity_complete" },
      streamErrors: [],
      structured: { summary: "All dimensions passed." },
      collector: input.toolKit.getCollector(),
      finalMessage: { info: { structured: { summary: "All dimensions passed." } } },
      model: { providerID: "test", modelID: "mock", id: "test/mock" },
      requiredTools: [],
    }
  }

  const result = await reviewIntegrity({
    userRequest: "Build UI",
    taskTitle: "Test",
    goals: [baseGoal],
  })

  expect(result.sessionID).toBe("ses_integrity_complete")
  expect(result.verdict).toBe("pass")
  expect(result.summary).toBe("All dimensions passed.")
  expect(result.dimensions.map((d) => d.id)).toEqual([
    "goal_fidelity",
    "technical_feasibility",
    "hallucination",
    "solution_quality",
  ])
})
