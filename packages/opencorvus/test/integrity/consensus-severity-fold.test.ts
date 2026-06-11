import { expect, test } from "bun:test"
import TEAM_CORE from "../../src/prompt/core/integrity-team-core.txt"
import { buildSupervisorConsensusPrompt, type ReviewPromptInput } from "../../src/integrity/team-agent"
import type { IntegrityReviewerPlan, IntegrityReviewerReport } from "../../src/integrity/team-schema"

const input: ReviewPromptInput = {
  userRequest: "Ship a chat page.",
  taskTitle: "Chat page",
  goals: [
    {
      id: "goal_storage",
      title: "Storage",
      objective: "Persist normal chat state.",
      acceptance_specs: [],
      owned_paths: ["src/services/storage.ts"],
      depends_on: [],
      priority: "blocking",
      kind: "feature",
      requirement_ids: ["REQ-3"],
    },
  ],
  requirements: [
    {
      id: "REQ-3",
      type: "explicit",
      description: "Normal chat conversations persist after refresh.",
      acceptance: "Saved conversation reappears after refresh.",
      non_goals: "Quota exhaustion hardening is out of this bounded REQ.",
    },
  ],
  replayContext: {
    attemptNumber: 2,
    lineage: {
      taskID: "tsk_consensus_fold",
      activeSpecSnapshotID: "spec_consensus_fold",
      inheritedSpecSnapshotIDs: [],
      reason: "active_only",
    },
    priorFactCheckAttempts: [],
    priorAttempts: [
      {
        attemptNumber: 1,
        artifactID: "art_consensus_prior",
        timeCreated: Date.UTC(2026, 4, 23, 10),
        phase: "post_build",
        verdict: "concerns",
        summary: "Prior storage quota concern was advisory.",
        reviewers: [{ reviewerID: "rev_prior", scope: "Storage", verdict: "concerns" }],
        findings: [
          {
            id: "ADV-3-silent-quota-error",
            severity: "advisory",
            verdictImpact: "concerns",
            title: "safeSetItem quota handling lacks visible warning",
            description: "safeSetItem swallows quota errors.",
            repair: "Consider a warning.",
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
      sinceTimeCreated: Date.UTC(2026, 4, 23, 10),
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

const plan: IntegrityReviewerPlan = {
  rationale: "Compare overlapping storage findings.",
  reviewers: [
    {
      reviewerID: "rev_advisory",
      title: "Advisory reviewer",
      focus: "Storage quota warning",
      adversarialQuestions: ["Is quota warning within normal flow?"],
    },
    {
      reviewerID: "rev_blocking",
      title: "Blocking reviewer",
      focus: "Storage quota loss",
      adversarialQuestions: ["Is quota failure data loss?"],
    },
  ],
}

const investigationPlan = {
  requestPromise: "Normal chat conversations persist after refresh.",
  hypothesis: "quota handling may be misclassified across the same storage defect surface",
  evidencePlan: ["inspect storage quota evidence"],
  passCriteria: ["the same defect surface has one reconciled severity"],
}

const reports: IntegrityReviewerReport[] = [
  {
    reviewerID: "rev_advisory",
    scope: "Storage quota warning",
    verdict: "concerns",
    summary: "Quota issue remains advisory.",
    investigationPlan,
    evidence: ["src/services/storage.ts safeSetItem"],
    findings: [
      {
        id: "ADV-3",
        severity: "advisory",
        verdictImpact: "concerns",
        title: "Quota warning is missing",
        description: "safeSetItem swallows quota errors without a warning.",
        evidence: ["src/services/storage.ts"],
        targetIDs: ["goal_storage"],
        requirementIDs: [],
        specIDs: [],
        filePaths: ["src/services/storage.ts"],
        repair: "Queue a warning.",
        reviewers: ["rev_advisory"],
        consensus: "agreed",
      },
    ],
    openQuestions: [],
  },
  {
    reviewerID: "rev_blocking",
    scope: "Storage quota loss",
    verdict: "needs_correction",
    summary: "Quota issue was described as blocking.",
    investigationPlan,
    evidence: ["src/services/storage.ts safeSetItem"],
    findings: [
      {
        id: "BF-1",
        severity: "blocking",
        verdictImpact: "needs_correction",
        title: "Quota failure silently loses persistence",
        description: "The same safeSetItem quota path is treated as blocking.",
        evidence: ["src/services/storage.ts"],
        targetIDs: ["goal_storage"],
        requirementIDs: [],
        specIDs: [],
        filePaths: ["src/services/storage.ts"],
        repair: "Make quota handling visible.",
        reviewers: ["rev_blocking"],
        consensus: "agreed",
      },
    ],
    openQuestions: [],
  },
]

test("consensus prompt requires one folded severity and rejects persistence-only promotion", () => {
  const prompt = [TEAM_CORE, buildSupervisorConsensusPrompt(input, plan, reports)].join("\n\n")

  expect(prompt).toContain("# Severity Reconciliation Pass")
  expect(prompt).toContain("same defect surface")
  expect(prompt).toContain("Do NOT carry both severities forward")
  expect(prompt).toContain("keep it advisory")
  expect(prompt).toContain("Persistence alone is not a promotion trigger")
  expect(prompt).toContain("A deeper reading of unchanged code")
  expect(prompt).toContain("ADV-3: Quota warning is missing")
  expect(prompt).toContain("BF-1: Quota failure silently loses persistence")
  expect(prompt).toContain("ADV-3-silent-quota-error")
})
