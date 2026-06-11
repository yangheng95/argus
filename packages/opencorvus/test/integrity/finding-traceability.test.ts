import { describe, expect, test } from "bun:test"
import path from "node:path"
import {
  buildReviewerPrompt,
  buildSupervisorConsensusPrompt,
  type ReviewPromptInput,
} from "../../src/integrity/team-agent"
import { IntegrityFindingSchema } from "../../src/integrity/team-schema"
import type { IntegrityReplayContext } from "../../src/integrity/replay-context"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const teamCorePath = path.join(repoRoot, "packages/opencorvus/src/prompt/core/integrity-team-core.txt")

const investigationPlan = {
  requestPromise: "show the requested error behavior",
  hypothesis: "a concern may be outside the scoped requirements",
  evidencePlan: ["inspect traceability anchors"],
  passCriteria: ["every reported finding has a REQ, AS, or user quote anchor"],
}

async function readTeamCore() {
  return await Bun.file(teamCorePath).text()
}

function replayContext(): IntegrityReplayContext {
  return {
    attemptNumber: 1,
    lineage: {
      taskID: "tsk_traceability_prompt",
      activeSpecSnapshotID: "spec_traceability_prompt",
      inheritedSpecSnapshotIDs: [],
      reason: "active_only",
    },
    priorFactCheckAttempts: [],
    priorAttempts: [],
    buildEvidenceSinceLastReview: {
      changedFiles: [],
      diffs: [],
      buildSummaries: [],
      goalRuns: [],
    },
    scaleSignals: {
      goals: 1,
      requirements: 1,
      acceptanceSpecs: 1,
      changedFilesTotal: 0,
      changedFilesSinceLastReview: 0,
      priorAttempts: 0,
      priorBlockingFindings: 0,
    },
  }
}

const promptInput: ReviewPromptInput = {
  userRequest: "Build a mature chat page where 401 errors render in Chinese.",
  taskTitle: "Chat page",
  goals: [
    {
      id: "goal_ui",
      title: "Chat UI",
      objective: "Render chat UI and localized errors.",
      acceptance_specs: [
        {
          id: "acc-errors",
          source_requirement_id: "REQ-6",
          goal_id: "goal_ui",
          title: "401 errors render in Chinese",
          severity: "essential",
          scorers: [{ type: "llm_judge", name: "401 Chinese error", criteria: "401 errors render in Chinese." }],
        },
      ],
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
      description: "401/429/network errors render as localized Chinese messages.",
      acceptance: "401 errors render in Chinese.",
      non_goals: "This does not cover bundle-size budgets.",
    },
  ],
  replayContext: replayContext(),
}

describe("integrity finding traceability discipline", () => {
  test("team core requires every finding to trace to REQ, AS, or literal user quote", async () => {
    const prompt = await readTeamCore()

    expect(prompt).toContain("Every finding MUST carry at least one of")
    expect(prompt).toContain("`requirementIDs`: REQ-N this finding violates")
    expect(prompt).toContain("`specIDs`: AcceptanceSpec ids this finding violates")
    expect(prompt).toContain("`userRequestQuotes`: literal substring(s) of the original user request")
    expect(prompt).toContain("empty `requirementIDs`, empty `specIDs`, AND no `userRequestQuotes`")
    expect(prompt).toContain("is out of scope and MUST be dropped")
  })

  test("team core collapses unbounded maturity adjectives into one extraction concern", async () => {
    const prompt = await readTeamCore()

    expect(prompt).toContain('"Maturity", "polished", "production-ready"')
    expect(prompt).toContain("NOT a license to invent new dimensions")
    expect(prompt).toContain("single requirements-extraction concern")
    expect(prompt).toContain("do not generate a parade of blockers")
  })

  test("reviewer and consensus prompts echo traceability at role level", () => {
    const reviewerPrompt = buildReviewerPrompt(promptInput, {
      reviewerID: "scope",
      title: "Scope reviewer",
      focus: "Find only scoped defects.",
      adversarialQuestions: ["Is every finding anchored?"],
    })

    expect(reviewerPrompt).toContain("Every finding you submit must cite a REQ-N")
    expect(reviewerPrompt).toContain("via `userRequestQuotes`")
    expect(reviewerPrompt).toContain("leave it out")

    const consensusPrompt = buildSupervisorConsensusPrompt(
      promptInput,
      {
        rationale: "Review scoped integrity.",
        reviewers: [
          {
            reviewerID: "scope",
            title: "Scope reviewer",
            focus: "Find only scoped defects.",
            adversarialQuestions: ["Is every finding anchored?"],
          },
          {
            reviewerID: "runtime",
            title: "Runtime reviewer",
            focus: "Verify runtime evidence.",
            adversarialQuestions: ["Does evidence cover the AS?"],
          },
        ],
      },
      [
        {
          reviewerID: "scope",
          scope: "Scope reviewer",
          verdict: "concerns",
          summary: "Bundle concern is untraced and should be dropped.",
          investigationPlan,
          evidence: ["No REQ or AS names bundle size."],
          findings: [],
          openQuestions: [],
        },
        {
          reviewerID: "runtime",
          scope: "Runtime reviewer",
          verdict: "pass",
          summary: "Runtime behavior is covered.",
          investigationPlan,
          evidence: ["acc-errors names 401 Chinese error."],
          findings: [],
          openQuestions: [],
        },
      ],
    )

    expect(consensusPrompt).toContain("A finding that does not cite a REQ-N, AS id, or literal user-request substring")
    expect(consensusPrompt).toContain("must be removed from the final report")
    expect(consensusPrompt).toContain("emit one requirements-extraction concern")
  })

  test("finding schema accepts literal user request quote anchors without enforcing substring membership", () => {
    const parsed = IntegrityFindingSchema.safeParse({
      id: "maturity-missing",
      severity: "advisory",
      verdictImpact: "concerns",
      title: "Maturity scope was not bounded",
      description: "The Requirements stage did not turn the maturity adjective into bounded REQs.",
      evidence: ["REQ list contains no bounded maturity acceptance."],
      targetIDs: [],
      requirementIDs: [],
      specIDs: [],
      userRequestQuotes: ["mature"],
      filePaths: [],
      repair: "Return to requirements and bound the maturity adjective.",
      reviewers: ["scope"],
      consensus: "agreed",
    })

    expect(parsed.success).toBe(true)
  })
})
