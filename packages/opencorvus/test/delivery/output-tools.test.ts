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
      goals: [{ runtime_scenario_count: 1 }],
      delivery: { changedFiles: ["src/components/App.tsx", "src/styles.css"] },
      attachments: [{ mime: "image/png" }],
    })).toEqual(["frontend", "runtime", "startup", "visual"])
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
