import { describe, expect, test } from "bun:test"
import { composeAcceptanceRetryFeedback } from "../../src/orchestrator/acceptance-retry-feedback"

describe("acceptance retry feedback", () => {
  test("includes manifest evidence details in per-goal retry feedback", () => {
    const text = composeAcceptanceRetryFeedback({
      iteration: 2,
      verdict: "rejected",
      summary: "Acceptance review is blocked by deterministic evidence.",
      manifestFailureDetails: [
        "[review] specialist:client_contract Specialist Review: client_contract status=failed: blocking:evidence_quality: missing client evidence",
        "[check] lint#1 lint status=failed: exit_code=1",
      ],
      ownDetails: [
        {
          category: "quality",
          error: "lint regression introduced by calculator UI change",
          goal_id: "gol_calc",
          check_id: "lint#1",
          suggestion: "Fix the lint regression before changing calculator UI.",
        },
      ],
    })

    expect(text).toContain("Manifest evidence failures:")
    expect(text).toContain("specialist:client_contract")
    expect(text).toContain("[check] lint#1")
    expect(text).toContain("[quality] lint regression introduced")
    expect(text).toContain("check_id: lint#1")
    expect(text).not.toContain("Canonical acceptance feedback packet")
    expect(text).not.toContain("verdict_artifact_id")
    expect(text).not.toContain("failedCheckIds")
  })

  test("keeps task-scope rejection actionable for integrated-tree rework", () => {
    const text = composeAcceptanceRetryFeedback({
      iteration: 3,
      verdict: "rejected",
      summary: "Task-scope evidence failure.",
      manifestFailureDetails: [
        "[review] specialist:security_data Security Data Review status=failed: blocking:security: hardcoded secret-like value",
      ],
      ownDetails: [],
      scope: "integrated_tree",
    })

    expect(text).toContain("Issues the integrated-tree rework must address:")
    expect(text).toContain("task-scope integrated-tree blocker")
    expect(text).toContain("hardcoded secret-like value")
    expect(text).toContain("specialist:security_data")
    expect(text).not.toContain("reviewEvidence")
  })
})
