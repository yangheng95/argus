import { describe, expect, test } from "bun:test"
import { evaluateBuildReportSubmission } from "../../src/build/agent"
import { BuildResultSchema } from "../../src/build/types"

function passedBuildResult(overrides: Record<string, unknown> = {}) {
  return {
    status: "passed" as const,
    summary: "Implemented the reference surface.",
    files_changed: [],
    tests: [{ name: "manual screenshot review", passed: true, detail: "Standalone screenshot looked acceptable." }],
    fact_check_items: [],
    ...overrides,
  }
}

describe("Build reference-comparison terminal report handling", () => {
  test("records passed build reports without requiring browser-preview refs", () => {
    const evaluated = evaluateBuildReportSubmission({
      result: passedBuildResult(),
      ownsWorktree: false,
    })

    expect(evaluated.accepted).toBe(true)
    if (!evaluated.accepted) throw new Error(evaluated.output)
    expect(evaluated.result.status).toBe("passed")
    expect(evaluated.output).toContain("RECORDED")
  })

  test("does not reject fake or unreadable reference-comparison refs", () => {
    const evaluated = evaluateBuildReportSubmission({
      result: passedBuildResult({
        reference_comparison_evidence_refs: ["browser_preview_evidence:art_missing"],
      }),
      ownsWorktree: false,
    })

    expect(evaluated.accepted).toBe(true)
    if (!evaluated.accepted) throw new Error(evaluated.output)
    expect(evaluated.result.status).toBe("passed")
    expect(evaluated.result.reference_comparison_evidence_refs).toEqual(["browser_preview_evidence:art_missing"])
  })

  test("schema still treats reference-comparison refs as optional supporting evidence", () => {
    const withoutRefs = BuildResultSchema.safeParse(passedBuildResult())
    const withRefs = BuildResultSchema.safeParse(
      passedBuildResult({
        reference_comparison_evidence_refs: ["not-a-browser-preview-ref"],
      }),
    )

    expect(withoutRefs.success).toBe(true)
    expect(withRefs.success).toBe(true)
  })
})
