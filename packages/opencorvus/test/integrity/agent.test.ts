import { afterEach, expect, mock, test } from "bun:test"
import type { GoalContractFields } from "../../src/pipeline/types"

let runnerImpl: ((input: any) => Promise<any>) | undefined

mock.module("@/agent/runner", () => ({
  runAgentSession: (input: any) => {
    if (!runnerImpl) throw new Error("runAgentSession mock not configured")
    return runnerImpl(input)
  },
  runAgentSessionWithRetry: () => {
    throw new Error("runAgentSessionWithRetry should not be called by IntegrityAgent")
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

test("integrity uses dimension collectors plus submit_integrity_review terminator", async () => {
  const { reviewIntegrity } = await import("../../src/integrity/agent")
  runnerImpl = async (input: any) => {
    expect(input.toolKit.tools.finalize_integrity_review).toBeUndefined()
    expect(Object.keys(input.toolKit.tools).sort()).toEqual([
      "submit_goal_fidelity_verdict",
      "submit_hallucination_verdict",
      "submit_integrity_review",
      "submit_solution_quality_verdict",
      "submit_technical_feasibility_verdict",
    ])
    expect(input.format).toBeUndefined()
    expect(input.terminalTool?.toolName).toBe("submit_integrity_review")
    expect(input.terminalTool?.shouldExposeOnlyTerminalTool(input.toolKit.getCollector())).toBe(false)
    return {
      session: { id: "ses_integrity_missing" },
      streamErrors: [],
      structured: undefined,
      collector: input.toolKit.getCollector(),
      finalMessage: { info: {} },
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

test("integrity accepts only complete dimension submissions plus submit_integrity_review", async () => {
  const { reviewIntegrity } = await import("../../src/integrity/agent")
  runnerImpl = async (input: any) => {
    for (const [name, tool] of Object.entries(input.toolKit.tools)) {
      if (name === "submit_integrity_review") continue
      const payload = { verdict: "pass", issues: [], corrections: [], missing_goals: [] }
      await (tool as any).execute(payload, {})
    }
    expect(input.terminalTool.shouldExposeOnlyTerminalTool(input.toolKit.getCollector())).toBe(true)
    await input.toolKit.tools.submit_integrity_review.execute({ final: true }, {})
    return {
      session: { id: "ses_integrity_complete" },
      streamErrors: [],
      structured: undefined,
      collector: input.toolKit.getCollector(),
      finalMessage: { info: {} },
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
  expect(result.summary).toBe("Integrity pass: 0 issue(s), 0 correction action(s).")
  expect(result.dimensions.map((d) => d.id)).toEqual([
    "goal_fidelity",
    "technical_feasibility",
    "hallucination",
    "solution_quality",
  ])
})

test("integrity escalates correction-bearing concerns into needs_correction", async () => {
  const { reviewIntegrity } = await import("../../src/integrity/agent")
  runnerImpl = async (input: any) => {
    await input.toolKit.tools.submit_goal_fidelity_verdict.execute({
      verdict: "pass",
      issues: [],
      corrections: [],
      missing_goals: [],
    }, {})
    await input.toolKit.tools.submit_technical_feasibility_verdict.execute({
      verdict: "pass",
      issues: [],
      corrections: [],
      missing_goals: [],
    }, {})
    await input.toolKit.tools.submit_hallucination_verdict.execute({
      verdict: "pass",
      issues: [],
      corrections: [],
      missing_goals: [],
    }, {})
    await input.toolKit.tools.submit_solution_quality_verdict.execute({
      verdict: "concerns",
      issues: [{ type: "weak_acceptance", description: "goal_ui has no executable acceptance spec for REQ-1." }],
      corrections: [{
        action: "modify",
        goal_id: "goal_ui",
        reason: "Add an executable acceptance contract.",
        updates: { acceptance_specs: [] },
      }],
      missing_goals: [],
    }, {})
    await input.toolKit.tools.submit_integrity_review.execute({ final: true }, {})
    return {
      session: { id: "ses_integrity_correction_concern" },
      streamErrors: [],
      structured: undefined,
      collector: input.toolKit.getCollector(),
      finalMessage: { info: {} },
      model: { providerID: "test", modelID: "mock", id: "test/mock" },
      requiredTools: [],
    }
  }

  const result = await reviewIntegrity({
    userRequest: "Build UI",
    taskTitle: "Test",
    goals: [baseGoal],
  })

  expect(result.verdict).toBe("needs_correction")
  expect(result.dimensions.find((d) => d.id === "solution_quality")?.verdict).toBe("needs_correction")
  expect(result.corrections).toHaveLength(1)
})

test("hallucination findings can propose executable requirement-id repairs", async () => {
  const { reviewIntegrity } = await import("../../src/integrity/agent")
  runnerImpl = async (input: any) => {
    await input.toolKit.tools.submit_goal_fidelity_verdict.execute({
      verdict: "pass",
      issues: [],
      corrections: [],
      missing_goals: [],
    }, {})
    await input.toolKit.tools.submit_technical_feasibility_verdict.execute({
      verdict: "pass",
      issues: [],
      corrections: [],
      missing_goals: [],
    }, {})
    await input.toolKit.tools.submit_hallucination_verdict.execute({
      verdict: "needs_correction",
      issues: [{
        type: "unsupported_claim",
        description: "goal_ui references REQ-18, but the forwarded requirement list only contains REQ-1.",
        goal_ids: ["goal_ui"],
        evidence: "Requirement IDs: REQ-1; goal_ui Requirement IDs include REQ-18.",
      }],
      corrections: [{
        action: "modify",
        goal_id: "goal_ui",
        reason: "Remove the unsupported REQ reference from the executable goal contract.",
        updates: {
          objective: "Build the requested interface grounded only in REQ-1.",
          requirement_ids: ["REQ-1"],
        },
      }],
      missing_goals: [],
    }, {})
    await input.toolKit.tools.submit_solution_quality_verdict.execute({
      verdict: "pass",
      issues: [],
      corrections: [],
      missing_goals: [],
    }, {})
    await input.toolKit.tools.submit_integrity_review.execute({ final: true }, {})
    return {
      session: { id: "ses_integrity_hallucination_repair" },
      streamErrors: [],
      structured: undefined,
      collector: input.toolKit.getCollector(),
      finalMessage: { info: {} },
      model: { providerID: "test", modelID: "mock", id: "test/mock" },
      requiredTools: [],
    }
  }

  const result = await reviewIntegrity({
    userRequest: "Build UI from REQ-1",
    taskTitle: "Test",
    goals: [{ ...baseGoal, requirement_ids: ["REQ-1", "REQ-18"] }],
  })

  expect(result.verdict).toBe("needs_correction")
  expect(result.dimensions.find((d) => d.id === "hallucination")?.corrections).toHaveLength(1)
  expect(result.corrections[0]?.updates?.requirement_ids).toEqual(["REQ-1"])
})

test("submit_integrity_review schema requires explicit final confirmation", async () => {
  const { IntegritySubmitSchema } = await import("../../src/integrity/submit-schema")
  expect(IntegritySubmitSchema.safeParse({}).success).toBe(false)
  expect(IntegritySubmitSchema.safeParse({ final: true }).success).toBe(true)
})

// Fix 1 (specs/architecture-review-rework-closure-2026-05-06.md, Layer 1):
// `integrity-core.txt` teaches "use `concerns` only for advisory findings that
// do not have an executable goal-layer repair." A `needs_correction` verdict
// with zero corrections and zero missing_goals is exactly that — advisory.
// Without this downgrade, post-build architecture_review fed a 0-corrections
// needs_correction into rework routing, which fell back to the just-built
// goal and produced the V_n loop. The dimension verdict reconciler must
// downgrade automatically so the LLM cannot escape the contract by stamping
// `needs_correction` on issues without proposing repairs.
test("Fix 1: needs_correction with zero corrections + zero missing_goals downgrades to concerns", async () => {
  const { reviewIntegrity } = await import("../../src/integrity/agent")
  runnerImpl = async (input: any) => {
    await input.toolKit.tools.submit_goal_fidelity_verdict.execute({
      verdict: "pass",
      issues: [],
      corrections: [],
      missing_goals: [],
    }, {})
    await input.toolKit.tools.submit_technical_feasibility_verdict.execute({
      verdict: "pass",
      issues: [],
      corrections: [],
      missing_goals: [],
    }, {})
    await input.toolKit.tools.submit_hallucination_verdict.execute({
      verdict: "pass",
      issues: [],
      corrections: [],
      missing_goals: [],
    }, {})
    // The dimension submits 16 advisory issues but no actionable corrections —
    // exactly the V3 production trace pattern (ownership_overlap /
    // weak_acceptance / unsupported_claim / partial across multiple goals,
    // none repairable at the single-goal layer).
    await input.toolKit.tools.submit_solution_quality_verdict.execute({
      verdict: "needs_correction",
      issues: [
        { type: "weak_acceptance", description: "goal_ui acc-1 is non-executable.", goal_ids: ["goal_ui"] },
        { type: "ownership_overlap", description: "goal_ui and goal_layout share src/Theme.tsx without a contract.", goal_ids: ["goal_ui", "goal_layout"] },
      ],
      corrections: [],
      missing_goals: [],
    }, {})
    await input.toolKit.tools.submit_integrity_review.execute({ final: true }, {})
    return {
      session: { id: "ses_integrity_no_actionable_repair" },
      streamErrors: [],
      structured: undefined,
      collector: input.toolKit.getCollector(),
      finalMessage: { info: {} },
      model: { providerID: "test", modelID: "mock", id: "test/mock" },
      requiredTools: [],
    }
  }

  const result = await reviewIntegrity({
    userRequest: "Build UI",
    taskTitle: "Test",
    goals: [baseGoal],
  })

  // Aggregate downgrades to concerns because the only non-pass dimension had
  // 0 corrections + 0 missing_goals; issues remain attached for orchestrator
  // visibility.
  expect(result.verdict).toBe("concerns")
  expect(result.dimensions.find((d) => d.id === "solution_quality")?.verdict).toBe("concerns")
  expect(result.corrections).toHaveLength(0)
  expect(result.issues.length).toBeGreaterThan(0)
})

// Regression guard for the original behaviour: when the dimension DOES emit
// corrections, needs_correction stays needs_correction (Fix 1 must not erase
// the existing escalation path).
test("Fix 1 regression: needs_correction stays needs_correction when corrections are present", async () => {
  const { reviewIntegrity } = await import("../../src/integrity/agent")
  runnerImpl = async (input: any) => {
    await input.toolKit.tools.submit_goal_fidelity_verdict.execute({
      verdict: "pass", issues: [], corrections: [], missing_goals: [],
    }, {})
    await input.toolKit.tools.submit_technical_feasibility_verdict.execute({
      verdict: "pass", issues: [], corrections: [], missing_goals: [],
    }, {})
    await input.toolKit.tools.submit_hallucination_verdict.execute({
      verdict: "pass", issues: [], corrections: [], missing_goals: [],
    }, {})
    await input.toolKit.tools.submit_solution_quality_verdict.execute({
      verdict: "needs_correction",
      issues: [{ type: "weak_acceptance", description: "goal_ui acc-1 is non-executable.", goal_ids: ["goal_ui"] }],
      corrections: [{
        action: "modify",
        goal_id: "goal_ui",
        reason: "Add executable acceptance contract.",
        updates: { acceptance_specs: [] },
      }],
      missing_goals: [],
    }, {})
    await input.toolKit.tools.submit_integrity_review.execute({ final: true }, {})
    return {
      session: { id: "ses_integrity_actionable_repair" },
      streamErrors: [],
      structured: undefined,
      collector: input.toolKit.getCollector(),
      finalMessage: { info: {} },
      model: { providerID: "test", modelID: "mock", id: "test/mock" },
      requiredTools: [],
    }
  }

  const result = await reviewIntegrity({
    userRequest: "Build UI",
    taskTitle: "Test",
    goals: [baseGoal],
  })

  expect(result.verdict).toBe("needs_correction")
  expect(result.corrections).toHaveLength(1)
})
