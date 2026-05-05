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

describe("integrity correction application", () => {
  test("modify corrections can repair topology fields integrity audits", () => {
    const result: IntegrityResult = {
      verdict: "needs_correction",
      summary: "Repair dependency topology",
      dimensions: [],
      issues: [],
      corrections: [{
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
        },
      }],
      missingGoals: [],
    }

    const [corrected] = applyIntegrityCorrections([baseGoal], result)

    expect(corrected.depends_on).toEqual(["goal_bootstrap"])
    expect(corrected.imports).toEqual(["test runtime"])
    expect(corrected.exports).toEqual(["verification report"])
    expect(corrected.owned_paths).toEqual(["tests/integration/app.test.ts", "tests/regression/app.test.ts"])
  })
})
