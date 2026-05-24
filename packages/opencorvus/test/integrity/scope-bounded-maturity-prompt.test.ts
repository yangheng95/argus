import { expect, test } from "bun:test"
import { buildIntegrityEvidencePrompt, type ReviewPromptInput } from "../../src/integrity/team-agent"

const contractGraph = {
  contracts: [],
  dependency_contracts: [],
  audit_criteria: [],
}

function baseInput(overrides: Partial<ReviewPromptInput> = {}): ReviewPromptInput {
  return {
    userRequest: "写一个成熟的输入 deepseek key 即可聊天的 ai chat 页面",
    taskTitle: "DeepSeek chat page",
    goals: [
      {
        id: "goal_errors",
        title: "Error handling",
        objective: "Render bounded chat errors.",
        acceptance_specs: [],
        owned_paths: ["src/errors.ts"],
        depends_on: [],
        priority: "blocking",
        kind: "feature",
        requirement_ids: ["REQ-6"],
      },
    ],
    requirements: [],
    contractGraph,
    replayContext: {
      attemptNumber: 1,
      lineage: {
        taskID: "tsk_scope_maturity",
        activeSpecSnapshotID: "spec_scope_maturity",
        inheritedSpecSnapshotIDs: [],
        reason: "active_only",
      },
      priorAttempts: [],
      buildEvidenceSinceLastReview: {
        changedFiles: [],
        diffs: [],
        deliverySummaries: [],
        goalRuns: [],
      },
      scaleSignals: {
        goals: 1,
        requirements: 0,
        acceptanceSpecs: 0,
        changedFilesTotal: 0,
        changedFilesSinceLastReview: 0,
        priorAttempts: 0,
        priorBlockingFindings: 0,
        phase: "post_build",
      },
    },
    ...overrides,
  }
}

test("renders bounded maturity REQ evidence from scope output", () => {
  const prompt = buildIntegrityEvidencePrompt(
    baseInput({
      requirements: [
        {
          id: "REQ-6",
          type: "explicit",
          description: "成熟 is bounded to Chinese error rendering for 401 / 429 / network-off.",
          acceptance: "401 shows a Chinese API key error.; 429 shows a Chinese rate-limit error.",
          non_goals: "No browser quota exhaustion guarantee is part of this REQ.",
        },
      ],
    }),
  )

  expect(prompt).toContain("# Scope-Bounded Maturity Evidence")
  expect(prompt).toContain("REQ-6")
  expect(prompt).toContain("401 shows a Chinese API key error.")
  expect(prompt).toContain("429 shows a Chinese rate-limit error.")
  expect(prompt).toContain("No browser quota exhaustion guarantee is part of this REQ.")
})

test("renders maturity_scope_pending as the missing bounded REQ branch", () => {
  const prompt = buildIntegrityEvidencePrompt(
    baseInput({
      requirementDecisions: [
        {
          key: "maturity_scope_pending",
          value: '"成熟" needs user clarification before it can lower any scope boundary.',
          reason: "The scope path did not land a bounded REQ for the adjective.",
        },
      ],
    }),
  )

  expect(prompt).toContain("Maturity terms from original request not landed as bounded REQs")
  expect(prompt).toContain("maturity_scope_pending")
  expect(prompt).toContain("at most one requirements-extraction concern")
  expect(prompt).toContain("do not derive severity thresholds from this word")
  expect(prompt).not.toContain("Delivery Maturity Class")
  expect(prompt).not.toContain("delivery_class")
  expect(prompt).not.toContain("demo")
  expect(prompt).not.toContain("production")
})
