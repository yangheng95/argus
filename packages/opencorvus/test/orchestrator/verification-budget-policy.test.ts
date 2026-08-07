import { expect, test } from "bun:test"
import ORCHESTRATOR_CORE from "../../src/prompt/core/orchestrator-core.txt" with { type: "text" }
import { ORCHESTRATOR_QUESTION_DESCRIPTION } from "../../src/orchestrator/interaction-tools"

test("projects the complete verification-budget scheduling contract", () => {
  const requiredPromptClauses = [
    "## Metacognitive verification budget",
    "The **acceptance floor** contains every check required",
    "The **optional assurance budget** contains only additional package-executable testing",
    "`required_only` as the recommended compact choice",
    "`extra_assurance` as the smallest concrete additional assurance increment",
    "If the operator rejects the question or its automatic deadline expires, use `required_only` and continue.",
    "never ask again after it is answered",
    "This preference is not a Host permission gate, workflow state, or approval to skip required evidence.",
  ]

  expect(requiredPromptClauses.map((clause) => ORCHESTRATOR_CORE.includes(clause))).toEqual(
    requiredPromptClauses.map(() => true),
  )
  expect(ORCHESTRATOR_QUESTION_DESCRIPTION).toContain(
    "recommends required_only for the complete mandatory acceptance floor",
  )
  expect(ORCHESTRATOR_QUESTION_DESCRIPTION).toContain(
    "offers extra_assurance only when the active package can execute a concrete additional confidence increment",
  )
  expect(ORCHESTRATOR_QUESTION_DESCRIPTION).toContain(
    "Rejection or automatic deadline expiry means required_only",
  )
})
