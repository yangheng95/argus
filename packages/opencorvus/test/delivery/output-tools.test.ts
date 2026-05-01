import { describe, expect, test } from "bun:test"
import { createDeliveryOutputTools } from "../../src/delivery/output-tools"
import { deriveRequiredEvidenceFacets } from "../../src/delivery/agent"

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

    expect(result).toContain("verdict=accepted")
    expect(kit.getCollector().verdict?.verdict).toBe("accepted")
    expect(kit.getCollector().verdict?.startup_verification).toBeUndefined()
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
    expect(kit.getCollector().verdict?.verdict).toBe("accepted")
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
})
