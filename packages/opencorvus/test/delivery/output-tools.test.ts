import { describe, expect, test } from "bun:test"
import { createDeliveryOutputTools } from "../../src/delivery/output-tools"
import { deriveRequiredEvidenceFacets } from "../../src/delivery/agent"
import { DeliveryVerdict, affectedGoalIDs } from "../../src/delivery/verdict"

const acceptedBase = {
  verdict: "accepted" as const,
  summary: "Verified with non-runtime evidence.",
  deferred_checks: [],
  tool_call_evidence: [
    {
      tool: "query_metric_trajectory",
      passed: true,
      detail: "trajectory checked",
    },
  ],
}

describe("delivery output tools", () => {
  test("accepts non-runtime work without startup evidence", async () => {
    const kit = createDeliveryOutputTools()

    const result = await kit.tools.submit_verdict.execute!(acceptedBase, {} as any)
    const verdict = DeliveryVerdict.parse(kit.getCollector().verdict)

    expect(result).toContain("verdict=accepted")
    expect(verdict.verdict).toBe("accepted")
    expect(verdict.startup_verification).toBeUndefined()
  })

  test("applies DeliveryVerdict schema defaults before collecting payloads", async () => {
    const kit = createDeliveryOutputTools()

    const result = await kit.tools.submit_verdict.execute!(
      {
        verdict: "accepted",
        summary: "Verified with direct evidence.",
        tool_call_evidence: [{
          tool: "query_metric_trajectory",
          passed: true,
          detail: "trajectory checked",
        }],
      },
      {} as any,
    )
    const verdict = DeliveryVerdict.parse(kit.getCollector().verdict)

    expect(result).toContain("verdict=accepted")
    expect(verdict.deferred_checks).toEqual([])
  })

  test("requires startup evidence only when startup facet is required", async () => {
    const kit = createDeliveryOutputTools({ requiredEvidenceFacets: ["startup"] })

    const rejected = await kit.tools.submit_verdict.execute!(acceptedBase, {} as any)

    expect(rejected).toContain("requires startup_verification.attempted=true")
    expect(kit.getCollector().finalized).toBe(false)

    const accepted = await kit.tools.submit_verdict.execute!(
      {
        ...acceptedBase,
        startup_verification: {
          attempted: true,
          success: true,
          command: "bun run start",
        },
      },
      {} as any,
    )

    expect(accepted).toContain("startup=ok")
    expect(DeliveryVerdict.parse(kit.getCollector().verdict).verdict).toBe("accepted")
  })

  test("requires managed preview tool evidence for frontend acceptance", async () => {
    const kit = createDeliveryOutputTools({ requiredEvidenceFacets: ["frontend"] })

    const missing = await kit.tools.submit_verdict.execute!(
      {
        ...acceptedBase,
        frontend_check: {
          attempted: true,
          renders_correctly: true,
          notes: "preview inspected",
        },
      },
      {} as any,
    )

    expect(missing).toContain("start_frontend_preview")
    expect(kit.getCollector().finalized).toBe(false)

    const accepted = await kit.tools.submit_verdict.execute!(
      {
        ...acceptedBase,
        tool_call_evidence: [
          ...acceptedBase.tool_call_evidence,
          {
            tool: "start_frontend_preview",
            passed: true,
            detail: "managed preview URL rendered",
          },
        ],
        frontend_check: {
          attempted: true,
          renders_correctly: true,
          notes: "preview inspected",
        },
      },
      {} as any,
    )

    expect(accepted).toContain("verdict=accepted")
    expect(DeliveryVerdict.parse(kit.getCollector().verdict).verdict).toBe("accepted")
  })

  test("rejects accepted verdict while manifest gate is failed", async () => {
    const kit = createDeliveryOutputTools({
      manifestGate: {
        status: "failed",
        summary: "Delivery evidence gate failed 1 required check(s).",
      },
    })

    const rejected = await kit.tools.submit_verdict.execute!(acceptedBase, {} as any)

    expect(rejected).toContain("host hard gate")
    expect(kit.getCollector().finalized).toBe(false)
  })

  test("rejects accepted verdict while runtime or visual host gate failed", async () => {
    const kit = createDeliveryOutputTools({
      hostGateFailures: [{
        kind: "runtime",
        id: "runtime-evidence",
        summary: "Runtime-evidence gate rejected delivery: 1 violation(s).",
      }],
    })

    const rejected = await kit.tools.submit_verdict.execute!(acceptedBase, {} as any)

    expect(rejected).toContain("runtime:runtime-evidence")
    expect(kit.getCollector().finalized).toBe(false)
  })

  test("derives no runtime facets for docs-only delivery", () => {
    expect(deriveRequiredEvidenceFacets({
      task: {},
      goals: [],
      delivery: { changedFiles: ["docs/usage.md", "README.md"] },
      attachments: [],
    })).toEqual([])
  })

  test("derives runtime and visual facets for frontend delivery", () => {
    expect(deriveRequiredEvidenceFacets({
      task: { design_specs: [{ id: "vis-1" }] },
      goals: [{ acceptance_scenarios: [scenarioSpec()] }],
      delivery: { changedFiles: ["src/components/App.tsx", "src/styles.css"] },
      attachments: [{ mime: "image/png" }],
    })).toEqual(["frontend", "runtime", "startup", "visual"])
  })

  test("allows accepted verdicts with advisory_failed deferred checks", async () => {
    const kit = createDeliveryOutputTools()

    const result = await kit.tools.submit_verdict.execute!(
      {
        ...acceptedBase,
        deferred_checks: [{
          name: "check:build",
          result: "advisory_failed",
          evidence: "build failed but functional runtime evidence passed",
        }],
      },
      {} as any,
    )

    expect(result).toContain("verdict=accepted")
    expect(DeliveryVerdict.parse(kit.getCollector().verdict).deferred_checks[0]?.result).toBe("advisory_failed")
  })

  test("rejects accepted verdicts with primary failed deferred checks", async () => {
    const kit = createDeliveryOutputTools()

    const result = await kit.tools.submit_verdict.execute!(
      {
        ...acceptedBase,
        deferred_checks: [{
          name: "runtime:web:scenario:acc-runtime",
          result: "failed",
          evidence: "primary walkthrough failed",
        }],
      },
      {} as any,
    )

    expect(result).toContain("primary result='failed'")
    expect(result).toContain("advisory_failed")
    expect(kit.getCollector().finalized).toBe(false)
  })

  test("rejects advisory-only rejected verdict attribution", async () => {
    const kit = createDeliveryOutputTools()

    const result = await kit.tools.submit_verdict.execute!(
      {
        verdict: "rejected",
        summary: "Rejected only because advisory build failed.",
        deferred_checks: [{
          name: "check:build",
          result: "advisory_failed",
          evidence: "build command failed",
        }],
        tool_call_evidence: [{ tool: "run_command", passed: false, detail: "bun run build failed" }],
        rejection_details: [{
          category: "build",
          check_id: "check:build",
          error: "check:build reported an advisory failure",
          suggestion: "Fix check:build.",
        }],
      },
      {} as any,
    )

    expect(result).toContain("advisory 信号不应单独触发 reject")
    expect(kit.getCollector().finalized).toBe(false)
  })

  test("does not classify advisory-only rejection by text substring", async () => {
    const kit = createDeliveryOutputTools()

    const result = await kit.tools.submit_verdict.execute!(
      {
        verdict: "rejected",
        summary: "Rejected because runtime behavior is still broken.",
        deferred_checks: [{
          name: "check:build",
          result: "advisory_failed",
          evidence: "build command failed",
        }],
        tool_call_evidence: [{ tool: "start_frontend_preview", passed: false, detail: "runtime page missing chat shell" }],
        rejection_details: [{
          category: "runtime",
          error: "runtime page still misses the chat shell even though check:build also appears in logs",
          suggestion: "Fix the runtime page state.",
        }],
      },
      {} as any,
    )

    expect(result).toContain("verdict=rejected")
    expect(DeliveryVerdict.parse(kit.getCollector().verdict).verdict).toBe("rejected")
  })

  test("task-scope rejection details do not derive affected goals", async () => {
    const kit = createDeliveryOutputTools()
    const parsed = DeliveryVerdict.parse({
      verdict: "rejected",
      summary: "Merged worktree render could not be verified.",
      deferred_checks: [],
      tool_call_evidence: [
        {
          tool: "delivery_arbiter",
          passed: false,
          detail: "render process failed before page verification",
        },
      ],
      rejection_details: [
        {
          category: "startup",
          error: "merged worktree preview server did not accept HTTP before timeout",
          suggestion: "Fix delivery render workspace startup instead of retrying every goal.",
        },
      ],
    })

    const result = await kit.tools.submit_verdict.execute!(parsed, {} as any)

    expect(affectedGoalIDs(parsed)).toEqual([])
    expect(result).toContain("1 rejection_details across 0 goal(s)")
    expect(DeliveryVerdict.parse(kit.getCollector().verdict).verdict).toBe("rejected")
  })
})

function scenarioSpec() {
  return {
    id: "acc-runtime",
    source_requirement_id: "REQ-runtime",
    goal_id: "gol-runtime",
    title: "Runtime scenario",
    scenario: {
      given: ["the preview is open"],
      when: ["the user views the page"],
      then: ["the expected UI is visible"],
    },
    scorers: [{
      type: "llm_judge" as const,
      name: "runtime_behavior",
      criteria: "The runtime page satisfies the described scenario.",
    }],
    severity: "essential" as const,
  }
}
