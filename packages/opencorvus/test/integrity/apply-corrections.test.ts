import { describe, expect, test } from "bun:test"
import { applyIntegrityCorrections, type IntegrityResult } from "../../src/integrity"
import type { GoalContractFields } from "../../src/pipeline/types"

const baseGoal: GoalContractFields = {
  id: "goal_verify",
  title: "Verify",
  objective: "Run verification",
  acceptance_specs: [],
  owned_paths: ["tests/integration/app.test.ts"],
  depends_on: ["goal_bootstrap", "goal_docs"],
  exports: [],
  imports: ["docs output"],
  priority: "blocking",
  kind: "verification",
  requirement_ids: [],
}

function acceptedAcceptance(): IntegrityResult["acceptance"] {
  return {
    verdict: "accepted",
    summary: "Acceptance passed",
    deferred_checks: [],
    tool_call_evidence: [{ tool: "unit_test", passed: true, detail: "unit test passed" }],
  }
}

describe("integrity correction application", () => {
  test("modify corrections can repair topology fields integrity audits", () => {
    const result: IntegrityResult = {
      verdict: "needs_correction",
      summary: "Repair dependency topology",
      acceptance: acceptedAcceptance(),
      dimensions: [],
      issues: [],
      corrections: [
        {
          action: "modify",
          goalID: "goal_verify",
          reason: "Docs are not a prerequisite for runtime verification",
          updates: {
            depends_on: ["goal_bootstrap"],
            imports: ["test runtime"],
            exports: ["verification report"],
            owned_paths: ["tests/integration/app.test.ts", "tests/regression/app.test.ts"],
            kind: "verification",
            priority: "blocking",
            requirement_ids: ["REQ-1"],
          },
        },
      ],
      missingGoals: [],
    }

    const [corrected] = applyIntegrityCorrections([baseGoal], result)

    expect(corrected.depends_on).toEqual(["goal_bootstrap"])
    expect(corrected.imports).toEqual(["test runtime"])
    expect(corrected.exports).toEqual(["verification report"])
    expect(corrected.owned_paths).toEqual(["tests/integration/app.test.ts", "tests/regression/app.test.ts"])
    expect(corrected.requirement_ids).toEqual(["REQ-1"])
  })
})
