import { afterEach, expect, mock, spyOn, test } from "bun:test"
import type { GoalContractFields } from "../../src/pipeline/types"
import { EngineProtocol } from "../../src/engine/protocol"

let runnerImpl: ((input: any) => Promise<any>) | undefined

mock.module("@/agent/runner", () => ({
  runAgentSession: (input: any) => {
    if (!runnerImpl) throw new Error("runAgentSession mock not configured")
    return runnerImpl(input)
  },
  runAgentSessionWithRetry: () => {
    throw new Error("runAgentSessionWithRetry should not be called by IntegrityAgent")
  },
  // Bun's `mock.module(...)` replaces the module's export map for the rest of
  // the process. Re-export the runner's helper exports so tests that load
  // SessionLoop or orchestrator/agent.ts AFTER this file (in Bun's pooled
  // test runner) don't trip on missing-export SyntaxErrors. These pass-through
  // implementations are pure functions that don't need the runner's heavy
  // imports — copying them avoids re-running the original module.
  AgentRunError: class AgentRunError extends Error {},
  buildHardErrorFromFinalMessage: () => undefined,
  messageHasInformationMissing: () => false,
  extractInformationMissingBlock: () => undefined,
  terminalToolMissingErrorFor: () => undefined,
  promptToolSwitchesForAgentRun: () => ({}),
  classifyAttemptOutcome: () => ({ kind: "noop" }),
}))

const baseGoal: GoalContractFields = {
  id: "goal_ui",
  title: "UI",
  objective: "Build the requested interface.",
  acceptance_specs: [],
  owned_paths: ["src/App.tsx"],
  depends_on: [],
  priority: "blocking",
  kind: "feature",
  requirement_ids: ["REQ-1"],
}

const baseGraph = { version: 1 as const, contracts: [], dependency_contracts: [] }

afterEach(() => {
  runnerImpl = undefined
})

test("integrity uses dimension collectors plus submit_integrity_review terminator", async () => {
  const { reviewIntegrity } = await import("../../src/integrity/agent")
  runnerImpl = async (input: any) => {
    expect(input.toolKit.tools.finalize_integrity_review).toBeUndefined()
    expect(Object.keys(input.toolKit.tools).sort()).toEqual([
      "submit_hallucination_verdict",
      "submit_integrity_review",
      "submit_requirement_fidelity_verdict",
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
    contractGraph: baseGraph,
  })).rejects.toThrow("missingDimensions=requirement_fidelity,technical_feasibility,hallucination,solution_quality")
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
    contractGraph: baseGraph,
  })

  expect(result.sessionID).toBe("ses_integrity_complete")
  expect(result.verdict).toBe("pass")
  expect(result.summary).toBe("Integrity pass: 0 issue(s), 0 correction action(s).")
  expect(result.dimensions.map((d) => d.id)).toEqual([
    "requirement_fidelity",
    "technical_feasibility",
    "hallucination",
    "solution_quality",
  ])
})

test("integrity lifecycle emits shared review stream events", async () => {
  const { reviewIntegrity } = await import("../../src/integrity/agent")
  const emitted: Array<{ type: string; payload: any }> = []
  const emitSpy = spyOn(EngineProtocol, "emit").mockImplementation(async (event: any, payload: any) => {
    emitted.push({ type: event.type, payload })
  })
  runnerImpl = async (input: any) => {
    input.onSessionCreated?.({ id: "ses_integrity_stream" })
    await input.stream.onChunk({ chunk: { type: "reasoning-delta", text: "checking" } })
    await input.stream.onFinish({} as never)
    for (const [name, tool] of Object.entries(input.toolKit.tools)) {
      if (name === "submit_integrity_review") continue
      await (tool as any).execute({ verdict: "pass", issues: [], corrections: [], missing_goals: [] }, {})
    }
    await input.toolKit.tools.submit_integrity_review.execute({ final: true }, {})
    return {
      session: { id: "ses_integrity_stream" },
      streamErrors: [],
      structured: undefined,
      collector: input.toolKit.getCollector(),
      finalMessage: { info: {} },
      model: { providerID: "test", modelID: "mock", id: "test/mock" },
      requiredTools: [],
    }
  }

  await reviewIntegrity({
    userRequest: "Build UI",
    taskTitle: "Test",
    goals: [baseGoal],
    contractGraph: baseGraph,
    taskID: "tsk_integrity_stream",
    parentSessionID: "ses_parent",
  })

  expect(emitted.map((item) => item.type)).toContain("review.stream.started")
  expect(emitted.map((item) => item.type)).toContain("review.stream.chunk")
  expect(emitted.map((item) => item.type)).toContain("integrity.review.completed")
  expect(emitted.find((item) => item.type === "review.stream.started")?.payload).toMatchObject({
    taskID: "tsk_integrity_stream",
    reviewID: "integrity:ses_integrity_stream",
    phase: "integrity",
    sessionID: "ses_integrity_stream",
  })
  emitSpy.mockRestore()
})

test("integrity preserves correction-bearing concerns verdict (no host reconciliation)", async () => {
  const { reviewIntegrity } = await import("../../src/integrity/agent")
  runnerImpl = async (input: any) => {
    await input.toolKit.tools.submit_requirement_fidelity_verdict.execute({
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
    contractGraph: baseGraph,
  })

  // B11 (spec architecture-rework-loosening-plan-2026-05-06.md): the host
  // no longer rewrites the integrity LLM's submitted verdict. The LLM said
  // "concerns" — that's what flows out, even with a correction attached.
  // The orchestrator LLM reads the full review markdown (issues +
  // corrections) and decides whether to act. CLAUDE.md rule 13.
  expect(result.verdict).toBe("concerns")
  expect(result.dimensions.find((d) => d.id === "solution_quality")?.verdict).toBe("concerns")
  expect(result.corrections).toHaveLength(1)
})

test("hallucination findings can propose executable requirement-id repairs", async () => {
  const { reviewIntegrity } = await import("../../src/integrity/agent")
  runnerImpl = async (input: any) => {
    await input.toolKit.tools.submit_requirement_fidelity_verdict.execute({
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
    contractGraph: baseGraph,
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

test("requirement_fidelity issue carries requirement_ids and spec_ids through to IntegrityResult", async () => {
  const { reviewIntegrity } = await import("../../src/integrity/agent")
  runnerImpl = async (input: any) => {
    await input.toolKit.tools.submit_requirement_fidelity_verdict.execute({
      verdict: "needs_correction",
      issues: [{
        type: "partial",
        description: "REQ-1 was claimed by goal_fe but acc-fe-1 failed.",
        requirement_ids: ["REQ-1"],
        spec_ids: ["acc-fe-1"],
        evidence: "Requirement Status Snapshot row REQ-1: goal_fe runStatus=completed, acc-fe-1/essential=FAILED.",
      }],
      corrections: [],
      missing_goals: [],
    }, {})
    await input.toolKit.tools.submit_technical_feasibility_verdict.execute({
      verdict: "pass", issues: [], corrections: [], missing_goals: [],
    }, {})
    await input.toolKit.tools.submit_hallucination_verdict.execute({
      verdict: "pass", issues: [], corrections: [], missing_goals: [],
    }, {})
    await input.toolKit.tools.submit_solution_quality_verdict.execute({
      verdict: "pass", issues: [], corrections: [], missing_goals: [],
    }, {})
    await input.toolKit.tools.submit_integrity_review.execute({ final: true }, {})
    return {
      session: { id: "ses_integrity_post_build" },
      streamErrors: [],
      structured: undefined,
      collector: input.toolKit.getCollector(),
      finalMessage: { info: {} },
      model: { providerID: "test", modelID: "mock", id: "test/mock" },
      requiredTools: [],
    }
  }

  const result = await reviewIntegrity({
    userRequest: "Show stock dashboard",
    taskTitle: "post-build issue surfaces spec_ids",
    goals: [baseGoal],
    contractGraph: baseGraph,
  })

  const fidelity = result.dimensions.find((d) => d.id === "requirement_fidelity")
  expect(fidelity?.issues).toHaveLength(1)
  expect(fidelity?.issues[0].requirementIDs).toEqual(["REQ-1"])
  expect(fidelity?.issues[0].specIDs).toEqual(["acc-fe-1"])
  // Cross-dimension union also preserves the new fields.
  expect(result.issues[0].requirementIDs).toEqual(["REQ-1"])
  expect(result.issues[0].specIDs).toEqual(["acc-fe-1"])
})

test("buildIntegrityPrompt omits the Requirement Status Snapshot section when the snapshot is empty (pre-build)", async () => {
  // Capture the rendered prompt by intercepting the runner's buildUserPrompt
  // hook the way the production agent.ts wires it.
  const { reviewIntegrity } = await import("../../src/integrity/agent")
  let capturedPrompt = ""
  runnerImpl = async (input: any) => {
    capturedPrompt = input.buildUserPrompt()
    for (const [name, t] of Object.entries(input.toolKit.tools)) {
      if (name === "submit_integrity_review") continue
      await (t as any).execute({ verdict: "pass", issues: [], corrections: [], missing_goals: [] }, {})
    }
    await input.toolKit.tools.submit_integrity_review.execute({ final: true }, {})
    return {
      session: { id: "ses_prompt_pre_build" },
      streamErrors: [],
      structured: undefined,
      collector: input.toolKit.getCollector(),
      finalMessage: { info: {} },
      model: { providerID: "test", modelID: "mock", id: "test/mock" },
      requiredTools: [],
    }
  }

  await reviewIntegrity({
    userRequest: "Build something",
    taskTitle: "pre-build prompt elision",
    goals: [baseGoal],
    contractGraph: baseGraph,
    requirements: [{ id: "REQ-1", type: "explicit", description: "Build it" }],
    requirementStatus: [],
  })

  // The dimension catalog already mentions the phrase "Requirement Status
  // Snapshot" as instructional text. Key on the section header's unique
  // subtitle "(post-build raw evidence)" which only appears when the actual
  // table is rendered.
  expect(capturedPrompt).not.toContain("(post-build raw evidence)")
})

test("IntegrityReviewCompleted event payload schema accepts requirement_ids and spec_ids on issue rows", async () => {
  const { Event } = await import("../../src/engine/model")
  const payload = {
    taskID: "tsk_event_payload",
    sessionID: "ses_event_payload",
    verdict: "needs_correction" as const,
    summary: "REQ-1 partial",
    dimensions: [{
      id: "requirement_fidelity" as const,
      verdict: "needs_correction" as const,
      issueCount: 1,
      correctionCount: 0,
      missingGoalCount: 0,
    }],
    issues: [{
      type: "partial",
      description: "acc-fe-1 failed",
      requirement_ids: ["REQ-1"],
      spec_ids: ["acc-fe-1"],
    }],
    corrections: [],
    missingGoals: [],
    attempts: 1,
  }
  const parsed = Event.IntegrityReviewCompleted.properties.parse(payload)
  expect(parsed.issues[0].requirement_ids).toEqual(["REQ-1"])
  expect(parsed.issues[0].spec_ids).toEqual(["acc-fe-1"])
  // Issues without the new fields still parse — they're optional.
  const minimal = Event.IntegrityReviewCompleted.properties.parse({
    ...payload,
    issues: [{ type: "partial", description: "no new fields" }],
  })
  expect(minimal.issues[0].requirement_ids).toBeUndefined()
  expect(minimal.issues[0].spec_ids).toBeUndefined()
})

test("when every claiming goal's essential spec fails, the LLM-driven verdict round-trips as needs_correction (host does not aggregate)", async () => {
  const { reviewIntegrity } = await import("../../src/integrity/agent")
  let capturedPrompt = ""
  runnerImpl = async (input: any) => {
    capturedPrompt = input.buildUserPrompt()
    // The LLM walks the snapshot rows itself and decides the verdict —
    // we simulate that by submitting "needs_correction" with a partial
    // issue that points at the failing specs the snapshot listed.
    await input.toolKit.tools.submit_requirement_fidelity_verdict.execute({
      verdict: "needs_correction",
      issues: [{
        type: "partial",
        description: "REQ-1 essential specs all failed across both claiming goals.",
        requirement_ids: ["REQ-1"],
        spec_ids: ["acc-fe-1", "acc-be-1"],
        evidence: "snapshot rows show acc-fe-1=FAILED on goal_fe and acc-be-1=FAILED on goal_be",
      }],
      corrections: [],
      missing_goals: [],
    }, {})
    await input.toolKit.tools.submit_technical_feasibility_verdict.execute({
      verdict: "pass", issues: [], corrections: [], missing_goals: [],
    }, {})
    await input.toolKit.tools.submit_hallucination_verdict.execute({
      verdict: "pass", issues: [], corrections: [], missing_goals: [],
    }, {})
    await input.toolKit.tools.submit_solution_quality_verdict.execute({
      verdict: "pass", issues: [], corrections: [], missing_goals: [],
    }, {})
    await input.toolKit.tools.submit_integrity_review.execute({ final: true }, {})
    return {
      session: { id: "ses_all_fail" },
      streamErrors: [],
      structured: undefined,
      collector: input.toolKit.getCollector(),
      finalMessage: { info: {} },
      model: { providerID: "test", modelID: "mock", id: "test/mock" },
      requiredTools: [],
    }
  }

  const result = await reviewIntegrity({
    userRequest: "Stock dashboard with API",
    taskTitle: "all-essential-fail snapshot",
    goals: [{
      ...baseGoal,
      requirement_ids: ["REQ-1"],
      acceptance_specs: [{
        id: "acc-fe-1",
        source_requirement_id: "REQ-1",
        goal_id: baseGoal.id,
        title: "fe acceptance",
        severity: "essential",
        scorers: [{ type: "heuristic", name: "fe", spec: { kind: "shell", cmd: "true" } }],
      }],
    }],
    contractGraph: baseGraph,
    requirements: [{ id: "REQ-1", type: "explicit", description: "Show dashboard" }],
    requirementStatus: [{
      reqID: "REQ-1",
      reqDescription: "Show dashboard",
      claimingGoals: [
        {
          goalID: "goal_fe",
          goalTitle: "frontend",
          runStatus: "completed",
          specOutcomes: [{ specID: "acc-fe-1", severity: "essential", passed: false, summary: "fe smoke failed" }],
        },
        {
          goalID: "goal_be",
          goalTitle: "backend",
          runStatus: "completed",
          specOutcomes: [{ specID: "acc-be-1", severity: "essential", passed: false, summary: "api smoke failed" }],
        },
      ],
    }],
  })

  // Snapshot table renders both goals' FAILED outcomes verbatim.
  expect(capturedPrompt).toContain("goal_fe")
  expect(capturedPrompt).toContain("goal_be")
  expect(capturedPrompt.match(/FAILED/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  // Aggregate verdict is the worst per-dimension verdict — derived from the
  // LLM's submission, not host-recomputed from snapshot rows.
  expect(result.verdict).toBe("needs_correction")
  const fidelity = result.dimensions.find((d) => d.id === "requirement_fidelity")
  expect(fidelity?.verdict).toBe("needs_correction")
  expect(fidelity?.issues[0].specIDs).toEqual(["acc-fe-1", "acc-be-1"])
})

test("buildIntegrityPrompt renders the snapshot table and foregrounds REQ → goal coverage when post-build", async () => {
  const { reviewIntegrity } = await import("../../src/integrity/agent")
  let capturedPrompt = ""
  runnerImpl = async (input: any) => {
    capturedPrompt = input.buildUserPrompt()
    for (const [name, t] of Object.entries(input.toolKit.tools)) {
      if (name === "submit_integrity_review") continue
      await (t as any).execute({ verdict: "pass", issues: [], corrections: [], missing_goals: [] }, {})
    }
    await input.toolKit.tools.submit_integrity_review.execute({ final: true }, {})
    return {
      session: { id: "ses_prompt_post_build" },
      streamErrors: [],
      structured: undefined,
      collector: input.toolKit.getCollector(),
      finalMessage: { info: {} },
      model: { providerID: "test", modelID: "mock", id: "test/mock" },
      requiredTools: [],
    }
  }

  await reviewIntegrity({
    userRequest: "Stock dashboard with API",
    taskTitle: "post-build prompt with snapshot",
    goals: [{
      ...baseGoal,
      acceptance_specs: [{
        id: "acc-fe-1",
        source_requirement_id: "REQ-1",
        goal_id: baseGoal.id,
        title: "frontend renders",
        severity: "essential",
        scorers: [{ type: "heuristic", name: "smoke", spec: { kind: "shell", cmd: "true" } }],
      }],
    }],
    contractGraph: baseGraph,
    requirements: [{ id: "REQ-1", type: "explicit", description: "Show dashboard" }],
    requirementStatus: [{
      reqID: "REQ-1",
      reqDescription: "Show dashboard",
      claimingGoals: [{
        goalID: baseGoal.id,
        goalTitle: baseGoal.title,
        runStatus: "completed",
        specOutcomes: [{ specID: "acc-fe-1", severity: "essential", passed: false, summary: "smoke failed" }],
      }],
    }],
  })

  expect(capturedPrompt).toContain("(post-build raw evidence)")
  expect(capturedPrompt).toContain("REQ-1")
  expect(capturedPrompt).toContain("acc-fe-1")
  expect(capturedPrompt).toContain("FAILED")
  // Reverse-lookup map renders too.
  expect(capturedPrompt).toContain("Requirement → Goal Coverage Map")
})
