import { expect, test } from "bun:test"
import TEAM_CORE from "../../src/prompt/core/integrity-team-core.txt"
import {
  buildIntegrityEvidencePrompt,
  buildReviewerPrompt,
  buildSupervisorConsensusPrompt,
  buildSupervisorPlanPrompt,
  type ReviewPromptInput,
} from "../../src/integrity/team-agent"

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
    replayContext: {
      attemptNumber: 2,
      lineage: {
        taskID: "tsk_severity_prompt",
        activeSpecSnapshotID: "spec_active",
        inheritedSpecSnapshotIDs: ["spec_prev"],
        reason: "integrity_correction_lineage",
      },
      priorFactCheckAttempts: [],
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
          fact_check_items: [],
        },
      ],
      buildEvidenceSinceLastReview: {
        sinceAttemptNumber: 1,
        sinceTimeCreated: Date.UTC(2026, 4, 23, 12),
        changedFiles: [],
        diffs: [],
        buildSummaries: [],
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
  expect(prompt).toContain("Requirement decision-log entries are not part of the initial integrity context.")
  expect(prompt).not.toContain("maturity_scope_pending")
  expect(prompt).not.toContain("Maturity Class")
  expect(prompt).not.toContain("demo")
  expect(prompt).not.toContain("production")
})

test("large integrity initial prompts stay compact and omit retired context surfaces", () => {
  const hiddenUserTail = "USER_REQUEST_HIDDEN_TAIL_SHOULD_NOT_RENDER"
  const oversizedScorer = "SCORER_BODY_SHOULD_NOT_RENDER " + "x".repeat(4_000)
  const hiddenContract = "CONTRACT_GRAPH_SHOULD_NOT_RENDER"
  const hiddenVisual = "VISUAL_SPEC_SHOULD_NOT_RENDER"
  const hiddenDecision = "DECISION_LOG_SHOULD_NOT_RENDER"
  const input: ReviewPromptInput = {
    ...promptInput(),
    userRequest: `Migrate the C# orders workflow to TypeScript. Reuse existing components and wire the real API. ${"detail ".repeat(500)} ${hiddenUserTail}`,
    requirements: Array.from({ length: 50 }, (_, index) => ({
      id: `REQ-${index + 1}`,
      type: "explicit",
      description: `Requirement ${index + 1}: check migrated behavior ${"long ".repeat(80)} REQ_HIDDEN_${index}`,
      acceptance: `Acceptance ${index + 1} must hold ${"long ".repeat(50)}`,
      non_goals: "",
    })),
    requirementDecisions: [
      {
        key: "maturity_scope_pending",
        value: hiddenDecision,
        reason: hiddenDecision,
      },
    ],
    goals: Array.from({ length: 12 }, (_, index) => ({
      id: `goal_${index + 1}`,
      title: `Goal ${index + 1}`,
      objective: `Implement migrated surface ${index + 1} ${"objective ".repeat(80)}`,
      acceptance_specs: Array.from({ length: 10 }, (_, specIndex) => ({
        id: `AS-${index + 1}-${specIndex + 1}`,
        source_requirement_id: `REQ-${specIndex + 1}`,
        goal_id: `goal_${index + 1}`,
        title: `Acceptance ${specIndex + 1} ${"title ".repeat(80)}`,
        severity: "essential" as const,
        scorers: [
          {
            type: "heuristic" as const,
            name: "oversized",
            spec: { kind: "shell" as const, cmd: oversizedScorer },
          },
        ],
      })),
      owned_paths: Array.from({ length: 10 }, (_, fileIndex) => `src/review-${index + 1}/file-${fileIndex + 1}.ts`),
      depends_on: [],
      priority: "blocking",
      kind: "feature",
      requirement_ids: [`REQ-${index + 1}`],
    })),
    acceptance: {
      summary: `Build summary ${"summary ".repeat(200)}`,
      changedFiles: Array.from({ length: 60 }, (_, index) => `src/review-${(index % 12) + 1}/file-${index + 1}.ts`),
      diffs: Array.from({ length: 60 }, (_, index) => ({
        file: `src/review-${(index % 12) + 1}/file-${index + 1}.ts`,
        diff: `DIFF_BODY_SHOULD_NOT_RENDER_${index} ${"diff ".repeat(200)}`,
      })),
    },
    replayContext: {
      ...promptInput().replayContext,
      buildEvidenceSinceLastReview: {
        changedFiles: Array.from({ length: 60 }, (_, index) => `src/replay-${(index % 12) + 1}/file-${index + 1}.ts`),
        diffs: Array.from({ length: 60 }, (_, index) => ({
          file: `src/replay-${(index % 12) + 1}/file-${index + 1}.ts`,
          status: "modified",
        })),
        buildSummaries: Array.from({ length: 20 }, (_, index) => `Replay summary ${index} ${"summary ".repeat(100)}`),
        goalRuns: [],
      },
    },
  }

  const evidencePrompt = buildIntegrityEvidencePrompt(input)
  const fullPlanPrompt = [TEAM_CORE, buildSupervisorPlanPrompt(input)].join("\n\n")
  const fullReviewerPrompt = [
    TEAM_CORE,
    buildReviewerPrompt(input, {
      reviewerID: "rev_api",
      title: "API reviewer",
      focus: "API integration",
      riskHypothesisIDs: ["risk-api"],
      drilldownPlan: ["inspect_integrity_evidence changed_directories"],
      adversarialQuestions: ["Is the real API wired?"],
    }),
  ].join("\n\n")
  const fullConsensusPrompt = [
    TEAM_CORE,
    buildSupervisorConsensusPrompt(
      input,
      {
        rationale: "Check task-specific coverage.",
        reviewers: [
          {
            reviewerID: "rev_api",
            title: "API reviewer",
            focus: "API integration",
            adversarialQuestions: ["Is the real API wired?"],
          },
        ],
      },
      [],
    ),
  ].join("\n\n")
  expect(evidencePrompt.length).toBeLessThanOrEqual(12_000)
  expect(fullPlanPrompt.length).toBeLessThan(40_000)
  expect(fullReviewerPrompt.length).toBeLessThan(40_000)
  expect(fullConsensusPrompt.length).toBeLessThan(40_000)
  expect(evidencePrompt).toContain("Goal Contracts Summary")
  expect(evidencePrompt).toContain("Changed directories")
  expect(evidencePrompt).toContain("omitted")
  expect(evidencePrompt).not.toContain(hiddenUserTail)
  expect(evidencePrompt).not.toContain(hiddenContract)
  expect(evidencePrompt).not.toContain(hiddenVisual)
  expect(evidencePrompt).not.toContain(hiddenDecision)
  expect(evidencePrompt).not.toContain("src/review-1/file-1.ts")
  expect(evidencePrompt).not.toContain(oversizedScorer)
  expect(evidencePrompt).not.toContain("DIFF_BODY_SHOULD_NOT_RENDER")

  const reviewerPrompt = buildReviewerPrompt(input, {
    reviewerID: "rev_api",
    title: "API reviewer",
    focus: "API integration",
    riskHypothesisIDs: ["risk-api"],
    drilldownPlan: ["inspect_integrity_evidence changed_directories"],
    adversarialQuestions: ["Is the real API wired?"],
  })
  expect(reviewerPrompt).toContain("investigation plan")
  expect(reviewerPrompt).toContain("inspect_integrity_evidence")
  expect(reviewerPrompt).not.toContain(hiddenContract)
  expect(reviewerPrompt).not.toContain(hiddenVisual)
  expect(reviewerPrompt).not.toContain(hiddenDecision)
  expect(reviewerPrompt).not.toContain("src/review-1/file-1.ts")
  for (const prompt of [fullPlanPrompt, fullReviewerPrompt, fullConsensusPrompt]) {
    expect(prompt).not.toContain(hiddenContract)
    expect(prompt).not.toContain(hiddenVisual)
    expect(prompt).not.toContain(hiddenDecision)
    expect(prompt).not.toContain("src/review-1/file-1.ts")
    expect(prompt).not.toContain("DIFF_BODY_SHOULD_NOT_RENDER")
  }
})
