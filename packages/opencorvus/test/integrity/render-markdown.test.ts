import { expect, test } from "bun:test"
import { renderIntegrityMarkdown } from "../../src/integrity/render-markdown"
import type { IntegrityResult } from "../../src/integrity"

test("renderIntegrityMarkdown emits requirement_ids and spec_ids on issue lines", () => {
  const result: IntegrityResult = {
    verdict: "needs_correction",
    summary: "REQ-1 incomplete",
    dimensions: [
      {
        id: "requirement_fidelity",
        verdict: "needs_correction",
        issues: [{
          type: "partial",
          description: "REQ-1 frontend partially done",
          requirementIDs: ["REQ-1"],
          specIDs: ["acc-fe-1", "acc-fe-2"],
          goalIDs: ["goal_fe"],
          evidence: "acc-fe-1=passed, acc-fe-2=FAILED",
        }],
        corrections: [],
        missingGoals: [],
      },
    ],
    issues: [],
    corrections: [],
    missingGoals: [],
  }

  const md = renderIntegrityMarkdown({ verdict: result, sessionID: "ses_test" })
  expect(md).toContain("requirement_ids=[REQ-1]")
  expect(md).toContain("spec_ids=[acc-fe-1, acc-fe-2]")
  expect(md).toContain("goal_ids=[goal_fe]")
  expect(md).toContain("[partial]")
})

test("renderIntegrityMarkdown omits requirement_ids / spec_ids segments when those fields are empty", () => {
  const result: IntegrityResult = {
    verdict: "concerns",
    summary: "Minor concern",
    dimensions: [
      {
        id: "solution_quality",
        verdict: "concerns",
        issues: [{
          type: "weak_acceptance",
          description: "spec passes by construction",
        }],
        corrections: [],
        missingGoals: [],
      },
    ],
    issues: [],
    corrections: [],
    missingGoals: [],
  }

  const md = renderIntegrityMarkdown({ verdict: result, sessionID: "ses_test" })
  expect(md).not.toContain("requirement_ids=")
  expect(md).not.toContain("spec_ids=")
  expect(md).toContain("[weak_acceptance]")
})
