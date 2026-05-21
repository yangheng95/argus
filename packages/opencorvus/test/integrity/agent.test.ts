import { afterEach, expect, mock, spyOn, test } from "bun:test"
import type { GoalContractFields } from "../../src/pipeline/types"
import { EngineProtocol } from "../../src/engine/protocol"
import { Instance } from "../../src/project/instance"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

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

function acceptedAcceptance() {
  return {
    verdict: "accepted",
    summary: "Acceptance passed",
    deferred_checks: [],
    tool_call_evidence: [{ tool: "unit_test", passed: true, detail: "unit test passed" }],
    rejection_details: [],
  }
}

function rejectedAcceptance() {
  return {
    verdict: "rejected",
    summary: "Runtime acceptance failed",
    deferred_checks: [],
    tool_call_evidence: [{ tool: "unit_test", passed: false, detail: "runtime smoke failed with exit code 1" }],
    rejection_details: [
      {
        goal_id: "goal_ui",
        category: "runtime",
        error: "Runtime smoke failed before the UI could render.",
      },
    ],
  }
}

async function submitPassingIntegrityTools(tools: Record<string, any>) {
  for (const [name, tool] of Object.entries(tools)) {
    if (name === "submit_integrity_review") continue
    if (name === "submit_acceptance_verdict") {
      await tool.execute(acceptedAcceptance(), {})
      continue
    }
    if (!name.startsWith("submit_")) continue
    await tool.execute({ verdict: "pass", issues: [], corrections: [], missing_goals: [] }, {})
  }
}

afterEach(async () => {
  runnerImpl = undefined
  await Instance.disposeAll()
  await resetDatabase()
})

test("integrity uses dimension collectors plus submit_integrity_review terminator", async () => {
  const { reviewIntegrity } = await import("../../src/integrity/agent")
  runnerImpl = async (input: any) => {
    expect(input.toolKit.tools.finalize_integrity_review).toBeUndefined()
    expect(Object.keys(input.toolKit.tools).sort()).toEqual([
      "submit_acceptance_verdict",
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
    await submitPassingIntegrityTools(input.toolKit.tools)
    expect(input.terminalTool.shouldExposeOnlyTerminalTool(input.toolKit.getCollector())).toBe(true)
    await input.toolKit.tools.submit_integrity_review.execute({ final: true }, {})
    return {
      session: { id: "ses_integrity_complete" },
      streamErrors: [],
      structured: undefined,
      collector: input.toolKit.getCollector(),
      finalMessage: { info: {} },
      model: { providerID: "test", modelID: "mock", id: "test/mock" },
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
  expect(result.summary).toBe("Integrity pass: 0 issue(s), 0 correction action(s), acceptance accepted.")
  expect(result.dimensions.map((d) => d.id)).toEqual([
    "requirement_fidelity",
    "technical_feasibility",
    "hallucination",
    "solution_quality",
  ])
})

test("rejected acceptance forces aggregate needs_correction from inside integrity", async () => {
  const { reviewIntegrity } = await import("../../src/integrity/agent")
  runnerImpl = async (input: any) => {
    for (const [name, tool] of Object.entries(input.toolKit.tools)) {
      if (name === "submit_integrity_review" || name === "submit_acceptance_verdict") continue
      if (!name.startsWith("submit_")) continue
      await (tool as any).execute({ verdict: "pass", issues: [], corrections: [], missing_goals: [] }, {})
    }
    await input.toolKit.tools.submit_acceptance_verdict.execute({
      verdict: "rejected",
      summary: "Runtime acceptance failed",
      deferred_checks: [],
      tool_call_evidence: [{ tool: "unit_test", passed: false, detail: "runtime smoke failed with exit code 1" }],
      rejection_details: [{
        goal_id: "goal_ui",
        category: "runtime",
        error: "Runtime smoke failed before the UI could render.",
      }],
    }, {})
    await input.toolKit.tools.submit_integrity_review.execute({ final: true }, {})
    return {
      session: { id: "ses_integrity_rejected_acceptance" },
      streamErrors: [],
      structured: undefined,
      collector: input.toolKit.getCollector(),
      finalMessage: { info: {} },
      model: { providerID: "test", modelID: "mock", id: "test/mock" },
    }
  }

  const result = await reviewIntegrity({
    userRequest: "Build UI",
    taskTitle: "Test",
    goals: [baseGoal],
    contractGraph: baseGraph,
  })

  expect(result.acceptance.verdict).toBe("rejected")
  expect(result.verdict).toBe("needs_correction")
  expect(result.summary).toContain("acceptance rejected")
})

// spec-2 Test Expectations L60 ("Integrity cannot accept without the required
// acceptance verdict"); remediation spec ITEM 3 测试 A. Guards the
// missing-acceptance-verdict invariant. With every dimension submitted but no
// acceptance verdict: (1) submit_integrity_review returns the missing-verdict
// error and returns BEFORE setting collector.finalized (agent.ts:586-589);
// (2) because finalized stays false, the post-session path hard-throws
// (agent.ts:690-694) — this guard fires before the acceptanceVerdict throw at
// 696-698, which is therefore unreachable when the submit tool itself blocks;
// (3) the terminal tool is never exposed-only while collector.acceptanceVerdict
// is unset (agent.ts:655). reviewIntegrity must NOT resolve to a
// passing/accepted result. This must FAIL if the line 586-588 guard is
// removed (submit would set finalized=true and reviewIntegrity would resolve).
test("integrity cannot finalize without an acceptance verdict", async () => {
  const { reviewIntegrity } = await import("../../src/integrity/agent")
  let submitVerdictResult: string | undefined
  let terminalGateBeforeVerdict: boolean | undefined
  runnerImpl = async (input: any) => {
    // Submit every per-dimension verdict as pass, but deliberately SKIP
    // submit_acceptance_verdict so collector.acceptanceVerdict stays unset.
    for (const [name, tool] of Object.entries(input.toolKit.tools)) {
      if (name === "submit_integrity_review" || name === "submit_acceptance_verdict") continue
      if (!name.startsWith("submit_")) continue
      await (tool as any).execute({ verdict: "pass", issues: [], corrections: [], missing_goals: [] }, {})
    }
    // agent.ts:654-655 — terminal tool must NOT be exposed-only without an
    // acceptance verdict even though every dimension is satisfied.
    terminalGateBeforeVerdict = input.terminalTool.shouldExposeOnlyTerminalTool(input.toolKit.getCollector())
    // agent.ts:586-588 — submit_integrity_review returns the missing-verdict
    // error instead of finalizing.
    submitVerdictResult = await input.toolKit.tools.submit_integrity_review.execute({ final: true }, {})
    return {
      session: { id: "ses_integrity_no_acceptance" },
      streamErrors: [],
      structured: undefined,
      collector: input.toolKit.getCollector(),
      finalMessage: { info: {} },
      model: { providerID: "test", modelID: "mock", id: "test/mock" },
    }
  }

  // agent.ts:690-694 — post-session hard throw. submit_integrity_review
  // returned the missing-verdict error at agent.ts:587 BEFORE `finalized =
  // true` (agent.ts:589), so finalized stays false and the finalized-guard
  // fires (the acceptanceVerdict-specific throw at 696-698 is unreachable
  // here). Either way reviewIntegrity rejects and never resolves to a
  // passing/accepted result.
  await expect(reviewIntegrity({
    userRequest: "Build UI",
    taskTitle: "Test",
    goals: [baseGoal],
    contractGraph: baseGraph,
  })).rejects.toThrow("integrity reviewer did not call submit_integrity_review after submitting 4 dimension verdict(s).")

  // The terminal tool stayed gated (agent.ts:655 `&& !!collector.acceptanceVerdict`).
  expect(terminalGateBeforeVerdict).toBe(false)
  // submit_integrity_review surfaced the missing-acceptance-verdict error
  // (agent.ts:587) and never returned a PASS line — proof finalization was
  // blocked at the source guard, not merely at the post-session check.
  expect(submitVerdictResult).toBe(
    "Error: missing acceptance verdict. Call submit_acceptance_verdict before submit_integrity_review.",
  )
  expect(submitVerdictResult).not.toContain("PASS")
})

// spec-2 Test Expectations L61-62 ("rejected acceptance forces aggregate
// needs_correction"); remediation spec ITEM 3 测试 B. Complementary to
// "rejected acceptance forces aggregate needs_correction from inside
// integrity": that test only checks the aggregate verdict + a summary
// substring. This one pins the *mechanism* — every per-dimension verdict
// stays individually `pass` (so `aggregateVerdict` alone would yield `pass`),
// proving the downgrade comes specifically from
// aggregateIntegrityVerdict's `if (acceptance.verdict === "rejected") return
// "needs_correction"` branch (agent.ts:811), propagated through
// synthesizeResult (agent.ts:728) and reflected by summarizeIntegrity's
// rejected-acceptance shape (agent.ts:828). Must FAIL if line 811's mapping
// is removed (aggregate would fall back to the all-pass dimension verdict).
test("rejected acceptance forces aggregate needs_correction", async () => {
  const { reviewIntegrity } = await import("../../src/integrity/agent")
  runnerImpl = async (input: any) => {
    for (const [name, tool] of Object.entries(input.toolKit.tools)) {
      if (name === "submit_integrity_review" || name === "submit_acceptance_verdict") continue
      if (!name.startsWith("submit_")) continue
      await (tool as any).execute({ verdict: "pass", issues: [], corrections: [], missing_goals: [] }, {})
    }
    await input.toolKit.tools.submit_acceptance_verdict.execute(rejectedAcceptance(), {})
    await input.toolKit.tools.submit_integrity_review.execute({ final: true }, {})
    return {
      session: { id: "ses_integrity_rejected_downgrade" },
      streamErrors: [],
      structured: undefined,
      collector: input.toolKit.getCollector(),
      finalMessage: { info: {} },
      model: { providerID: "test", modelID: "mock", id: "test/mock" },
    }
  }

  const result = await reviewIntegrity({
    userRequest: "Build UI",
    taskTitle: "Test",
    goals: [baseGoal],
    contractGraph: baseGraph,
  })

  // Every dimension individually passed — without the rejected-acceptance
  // override the aggregate would be `pass`.
  expect(result.dimensions.map((d) => d.verdict)).toEqual(["pass", "pass", "pass", "pass"])
  expect(result.acceptance.verdict).toBe("rejected")
  // aggregateIntegrityVerdict (agent.ts:811) downgrades to needs_correction
  // and synthesizeResult (agent.ts:728) propagates it to IntegrityResult.verdict.
  expect(result.verdict).toBe("needs_correction")
  expect(result.verdict).not.toBe("pass")
  // summarizeIntegrity (agent.ts:819/828) reflects the downgrade with the
  // rejected-acceptance phrasing including the rejection_details count.
  expect(result.summary).toContain("Integrity needs_correction")
  expect(result.summary).toContain("acceptance rejected with 1 rejection detail(s)")
})

test("integrity lifecycle emits shared review stream events", async () => {
  const { reviewIntegrity } = await import("../../src/integrity/agent")
  const emitted: Array<{ type: string; payload: any }> = []
  const emitSpy = spyOn(EngineProtocol, "emit").mockImplementation(async (event: any, payload: any) => {
    emitted.push({ type: event.type, payload })
  })
  runnerImpl = async (input: any) => {
    const lifecycle = input.onSessionCreated?.({ id: "ses_integrity_stream" })
    await input.stream.onChunk({ chunk: { type: "reasoning-delta", text: "checking" } })
    await input.stream.onFinish({} as never)
    await submitPassingIntegrityTools(input.toolKit.tools)
    await input.toolKit.tools.submit_integrity_review.execute({ final: true }, {})
    lifecycle?.dispose?.()
    return {
      session: { id: "ses_integrity_stream" },
      streamErrors: [],
      structured: undefined,
      collector: input.toolKit.getCollector(),
      finalMessage: { info: {} },
      model: { providerID: "test", modelID: "mock", id: "test/mock" },
    }
  }

  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: () => reviewIntegrity({
      userRequest: "Build UI",
      taskTitle: "Test",
      goals: [baseGoal],
      contractGraph: baseGraph,
      taskID: "tsk_integrity_stream",
      parentSessionID: "ses_parent",
    }),
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

test("accepted acceptance plus advisory concerns returns top-level pass and keeps evidence", async () => {
  const { reviewIntegrity } = await import("../../src/integrity/agent")
  const { renderIntegrityMarkdown } = await import("../../src/integrity/render-markdown")
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
      corrections: [],
      missing_goals: [],
    }, {})
    await input.toolKit.tools.submit_acceptance_verdict.execute(acceptedAcceptance(), {})
    await input.toolKit.tools.submit_integrity_review.execute({ final: true }, {})
    return {
      session: { id: "ses_integrity_advisory_concern" },
      streamErrors: [],
      structured: undefined,
      collector: input.toolKit.getCollector(),
      finalMessage: { info: {} },
      model: { providerID: "test", modelID: "mock", id: "test/mock" },
    }
  }

  const result = await reviewIntegrity({
    userRequest: "Build UI",
    taskTitle: "Test",
    goals: [baseGoal],
    contractGraph: baseGraph,
  })

  expect(result.acceptance.verdict).toBe("accepted")
  expect(result.verdict).toBe("pass")
  const quality = result.dimensions.find((d) => d.id === "solution_quality")
  expect(quality?.verdict).toBe("concerns")
  expect(quality?.issues[0]?.description).toBe("goal_ui has no executable acceptance spec for REQ-1.")
  expect(result.issues).toHaveLength(1)

  const markdown = renderIntegrityMarkdown({ verdict: result, sessionID: result.sessionID })
  expect(markdown).toContain("Architecture review (verdict=pass; session ses_integrity_advisory_concern)")
  expect(markdown).toContain("**solution_quality = concerns**")
  expect(markdown).toContain("[weak_acceptance] goal_ui has no executable acceptance spec for REQ-1.")
})

test("repair-bearing concerns aggregate to needs_correction while preserving dimension evidence", async () => {
  const { reviewIntegrity } = await import("../../src/integrity/agent")
  let finalizeResult: string | undefined
  runnerImpl = async (input: any) => {
    await input.toolKit.tools.submit_requirement_fidelity_verdict.execute({
      verdict: "pass",
      issues: [],
      corrections: [],
      missing_goals: [],
    }, {})
    await input.toolKit.tools.submit_technical_feasibility_verdict.execute({
      verdict: "concerns",
      issues: [{
        type: "missing_capability",
        description: "goal_ui lacks the integration contract needed by REQ-1.",
        goal_ids: ["goal_ui"],
      }],
      corrections: [{
        action: "modify",
        goal_id: "goal_ui",
        reason: "Make the integration responsibility explicit.",
        updates: { objective: "Build the requested interface and expose its integration contract." },
      }],
      graph_corrections: [{
        kind: "audit_criterion",
        action: "attach",
        reason: "Attach the missing integration contract as an audit criterion.",
        goal_id: "goal_ui",
        contract_ids: ["contract_ui"],
      }],
      missing_goals: [{
        title: "Integration verification",
        objective: "Verify the UI integration contract end to end.",
        acceptance_spec_hints: ["Integration contract is exercised through the rendered UI."],
        owned_paths: ["src/App.tsx"],
        kind: "verification",
        priority: "blocking",
        reason: "The existing goal cannot prove the integration contract by itself.",
      }],
    }, {})
    await input.toolKit.tools.submit_hallucination_verdict.execute({
      verdict: "pass",
      issues: [],
      corrections: [],
      missing_goals: [],
    }, {})
    await input.toolKit.tools.submit_solution_quality_verdict.execute({
      verdict: "pass",
      issues: [],
      corrections: [],
      missing_goals: [],
    }, {})
    await input.toolKit.tools.submit_acceptance_verdict.execute(acceptedAcceptance(), {})
    finalizeResult = await input.toolKit.tools.submit_integrity_review.execute({ final: true }, {})
    return {
      session: { id: "ses_integrity_repair_concern" },
      streamErrors: [],
      structured: undefined,
      collector: input.toolKit.getCollector(),
      finalMessage: { info: {} },
      model: { providerID: "test", modelID: "mock", id: "test/mock" },
    }
  }

  const result = await reviewIntegrity({
    userRequest: "Build UI",
    taskTitle: "Test",
    goals: [baseGoal],
    contractGraph: baseGraph,
  })

  expect(finalizeResult).toBe("PASS: integrity review finalized with aggregate verdict needs_correction.")
  expect(result.acceptance.verdict).toBe("accepted")
  expect(result.verdict).toBe("needs_correction")
  const feasibility = result.dimensions.find((d) => d.id === "technical_feasibility")
  expect(feasibility?.verdict).toBe("concerns")
  expect(feasibility?.corrections).toHaveLength(1)
  expect(feasibility?.graphCorrections).toHaveLength(1)
  expect(feasibility?.missingGoals).toHaveLength(1)
  expect(result.corrections).toHaveLength(1)
  expect(result.graphCorrections).toHaveLength(1)
  expect(result.missingGoals).toHaveLength(1)
  expect(result.summary).toContain("Integrity needs_correction")
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
    await input.toolKit.tools.submit_acceptance_verdict.execute(acceptedAcceptance(), {})
    await input.toolKit.tools.submit_integrity_review.execute({ final: true }, {})
    return {
      session: { id: "ses_integrity_hallucination_repair" },
      streamErrors: [],
      structured: undefined,
      collector: input.toolKit.getCollector(),
      finalMessage: { info: {} },
      model: { providerID: "test", modelID: "mock", id: "test/mock" },
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
    await input.toolKit.tools.submit_acceptance_verdict.execute(acceptedAcceptance(), {})
    await input.toolKit.tools.submit_integrity_review.execute({ final: true }, {})
    return {
      session: { id: "ses_integrity_post_build" },
      streamErrors: [],
      structured: undefined,
      collector: input.toolKit.getCollector(),
      finalMessage: { info: {} },
      model: { providerID: "test", modelID: "mock", id: "test/mock" },
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
    await submitPassingIntegrityTools(input.toolKit.tools)
    await input.toolKit.tools.submit_integrity_review.execute({ final: true }, {})
    return {
      session: { id: "ses_prompt_pre_build" },
      streamErrors: [],
      structured: undefined,
      collector: input.toolKit.getCollector(),
      finalMessage: { info: {} },
      model: { providerID: "test", modelID: "mock", id: "test/mock" },
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
    acceptance: acceptedAcceptance(),
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
    await input.toolKit.tools.submit_acceptance_verdict.execute(acceptedAcceptance(), {})
    await input.toolKit.tools.submit_integrity_review.execute({ final: true }, {})
    return {
      session: { id: "ses_all_fail" },
      streamErrors: [],
      structured: undefined,
      collector: input.toolKit.getCollector(),
      finalMessage: { info: {} },
      model: { providerID: "test", modelID: "mock", id: "test/mock" },
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
  // Aggregate verdict is derived from the LLM's submitted dimension verdicts,
  // not host-recomputed from snapshot rows.
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
    await submitPassingIntegrityTools(input.toolKit.tools)
    await input.toolKit.tools.submit_integrity_review.execute({ final: true }, {})
    return {
      session: { id: "ses_prompt_post_build" },
      streamErrors: [],
      structured: undefined,
      collector: input.toolKit.getCollector(),
      finalMessage: { info: {} },
      model: { providerID: "test", modelID: "mock", id: "test/mock" },
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
