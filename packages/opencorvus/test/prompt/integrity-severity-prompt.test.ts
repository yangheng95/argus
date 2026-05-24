import { expect, test } from "bun:test"
import TEAM_CORE from "../../src/prompt/core/integrity-team-core.txt"
import {
  buildIntegrityEvidencePrompt,
  buildReviewerPrompt,
  buildSupervisorConsensusPrompt,
  buildSupervisorPlanPrompt,
  type ReviewPromptInput,
} from "../../src/integrity/team-agent"

const contractGraph = {
  contracts: [],
  dependency_contracts: [],
  audit_criteria: [],
}

function promptInput(): ReviewPromptInput {
  return {
    userRequest: "写一个成熟的输入 deepseek key 即可聊天的 ai chat 页面",
    taskTitle: "DeepSeek chat page",
    goals: [
      {
        id: "goal_chat",
        title: "Chat UI",
        objective: "Render chat errors in Chinese.",
        acceptance_specs: [],
        owned_paths: ["src/App.tsx"],
        depends_on: [],
        priority: "blocking",
        kind: "feature",
        requirement_ids: ["REQ-6"],
      },
    ],
    requirements: [
      {
        id: "REQ-6",
        type: "explicit",
        description: "Errors render in Chinese for 401 / 429 / network-off.",
        acceptance: "401, 429, and network-off states show Chinese messages.",
        non_goals: "No quota-hardening requirement is implied.",
      },
    ],
    requirementDecisions: [
      {
        key: "maturity_scope_pending",
        value: "成熟 was not fully decomposed.",
        reason: "Scope discipline requires the user to bound the maturity word.",
      },
    ],
    contractGraph,
    replayContext: {
      attemptNumber: 2,
      lineage: {
        taskID: "tsk_severity_prompt",
        activeSpecSnapshotID: "spec_active",
        inheritedSpecSnapshotIDs: ["spec_prev"],
        reason: "integrity_correction_lineage",
      },
      priorAttempts: [
        {
          attemptNumber: 1,
          artifactID: "art_prior",
          timeCreated: Date.UTC(2026, 4, 23, 12),
          phase: "post_build",
          verdict: "concerns",
          summary: "Prior attempt had advisory quota concern.",
          reviewers: [{ reviewerID: "rev_storage", scope: "Storage", verdict: "concerns" }],
          findings: [
            {
              id: "ADV-3-silent-quota-error",
              severity: "advisory",
              verdictImpact: "concerns",
              title: "Quota warning can be clearer",
              description: "safeSetItem swallows quota errors without user notification.",
              repair: "Queue a visible quota advisory.",
              filePaths: ["src/services/storage.ts"],
              requirementIDs: [],
              specIDs: [],
            },
          ],
          blockingFindings: [],
          requiredRepairs: [],
          unresolvedDisagreements: [],
        },
      ],
      buildEvidenceSinceLastReview: {
        sinceAttemptNumber: 1,
        sinceTimeCreated: Date.UTC(2026, 4, 23, 12),
        changedFiles: [],
        diffs: [],
        deliverySummaries: [],
        goalRuns: [],
      },
      scaleSignals: {
        goals: 1,
        requirements: 1,
        acceptanceSpecs: 0,
        changedFilesTotal: 0,
        changedFilesSinceLastReview: 0,
        priorAttempts: 1,
        priorBlockingFindings: 0,
        phase: "post_build",
      },
    },
  }
}

test("integrity team core defines severity discipline with closed new-evidence clauses", () => {
  expect(TEAM_CORE).toContain("## Severity Discipline")
  expect(TEAM_CORE).toContain("(a) a user-visible flow fails")
  expect(TEAM_CORE).toContain("(b) the implementation contradicts")
  expect(TEAM_CORE).toContain("(c) the build, install, type-check, or test suite is broken")
  expect(TEAM_CORE).toContain("(d) data the user can produce in normal flow is silently destroyed")
  expect(TEAM_CORE).toContain("(e) a security or credential disclosure")
  expect(TEAM_CORE).toContain("code lines on the same defect surface changed after the prior attempt")
  expect(TEAM_CORE).toContain("A deeper reading of the same unchanged code")
  expect(TEAM_CORE).toContain("Persistence alone is NOT promotion")
})

test("role prompts carry severity context before reviewer and consensus submission", () => {
  const input = promptInput()
  const planPrompt = [TEAM_CORE, buildSupervisorPlanPrompt(input)].join("\n\n")
  const reviewerPrompt = [
    TEAM_CORE,
    buildReviewerPrompt(input, {
      reviewerID: "rev_storage",
      title: "Storage reviewer",
      focus: "Storage persistence",
      adversarialQuestions: ["Can advisory quota evidence be promoted without new evidence?"],
    }),
  ].join("\n\n")
  const consensusPrompt = [
    TEAM_CORE,
    buildSupervisorConsensusPrompt(
      input,
      {
        rationale: "Compare severity overlap.",
        reviewers: [
          {
            reviewerID: "rev_storage",
            title: "Storage reviewer",
            focus: "Storage persistence",
            adversarialQuestions: ["Can advisory quota evidence be promoted without new evidence?"],
          },
          {
            reviewerID: "rev_runtime",
            title: "Runtime reviewer",
            focus: "Runtime behavior",
            adversarialQuestions: ["Did code change after the prior attempt?"],
          },
        ],
      },
      [],
    ),
  ].join("\n\n")

  expect(planPrompt).toContain("## Severity Discipline")
  expect(reviewerPrompt).toContain("# Severity New Evidence Context")
  expect(reviewerPrompt).toContain("ADV-3-silent-quota-error")
  expect(reviewerPrompt).toContain("Shared Prompt Context (severity_context)")
  expect(consensusPrompt).toContain("# Severity Reconciliation Pass")
  expect(consensusPrompt).toContain("Do NOT carry both severities forward")
})

test("evidence prompt renders scope-bounded maturity read-through without local classification", () => {
  const prompt = buildIntegrityEvidencePrompt(promptInput())
  expect(prompt).toContain("# Scope-Bounded Maturity Evidence")
  expect(prompt).toContain("REQ-6")
  expect(prompt).toContain("401, 429, and network-off states show Chinese messages.")
  expect(prompt).toContain("No quota-hardening requirement is implied.")
  expect(prompt).toContain("maturity_scope_pending")
  expect(prompt).not.toContain("Delivery Maturity Class")
  expect(prompt).not.toContain("delivery_class")
  expect(prompt).not.toContain("demo")
  expect(prompt).not.toContain("production")
})
