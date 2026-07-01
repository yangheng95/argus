import { afterEach, describe, expect, mock, test } from "bun:test"
import type { IntegrityReplayContext } from "../../src/integrity/replay-context"

let sessionCounter = 0
let capturedConsensusPrompt = ""

const investigationPlan = {
  requestPromise: "render assistant replies",
  hypothesis: "the scoped behavior may be unanchored or unverified",
  evidencePlan: ["inspect scoped traceability evidence"],
  passCriteria: ["findings are anchored to REQ, AS, or a user quote"],
}

const untracedReviewerReport = {
  reviewerID: "scope",
  checkIDs: ["check_scope_traceability"],
  scope: "Scope reviewer",
  verdict: "needs_correction",
  summary: "Bundle size concern is untraced.",
  investigationPlan,
  drilldowns: [
    {
      checkIDs: ["check_scope_traceability"],
      kind: "traceability_review",
      target: "bundle-size concern",
      purpose: "Verify whether the concern is anchored to the task request.",
      result: "No requirement, acceptance spec, or original request quote names bundle size.",
    },
  ],
  coverage: [
    {
      checkIDs: ["check_scope_traceability"],
      userRequestQuote: "Build a chat page that renders assistant replies.",
      status: "covered",
      evidence: "The scoped request concerns chat replies, not bundle size.",
    },
  ],
  evidence: [
    {
      checkIDs: ["check_scope_traceability"],
      note: "Reviewer intentionally noted one untraced bundle-size concern.",
    },
  ],
  openQuestions: [],
} as const

const runtimeReviewerReport = {
  reviewerID: "runtime",
  checkIDs: ["check_runtime_req_1"],
  scope: "Runtime reviewer",
  verdict: "pass",
  summary: "Runtime evidence is scoped and passes.",
  investigationPlan,
  drilldowns: [
    {
      checkIDs: ["check_runtime_req_1"],
      kind: "requirement_review",
      target: "REQ-1",
      purpose: "Verify assistant reply rendering coverage.",
      result: "REQ-1 and acc-chat both name the chat response behavior.",
    },
  ],
  evidence: [{ checkIDs: ["check_runtime_req_1"], note: "REQ-1 and acc-chat both name the chat response behavior." }],
  coverage: [
    {
      checkIDs: ["check_runtime_req_1"],
      requirementID: "REQ-1",
      status: "covered",
      evidence: "REQ-1 and acc-chat both name the chat response behavior.",
    },
  ],
  openQuestions: [],
} as const

function replayContext(): IntegrityReplayContext {
  return {
    attemptNumber: 1,
    lineage: {
      taskID: "tsk_traceability_consensus",
      activeSpecSnapshotID: "spec_traceability_consensus",
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

mock.module("@/agent/runner", () => ({
  AgentRunError: class AgentRunError extends Error {},
  buildHardErrorFromFinalMessage: () => null,
  toolErrorPartsFromFinalMessage: () => [],
  runAgentSession: async (input: any) => {
    const session = { id: `ses_integrity_${++sessionCounter}` }
    input.onSessionCreated?.(session)

    if (input.terminalTool.toolName === "submit_integrity_review_plan") {
      await input.toolKit.tools.submit_integrity_review_plan.execute({
        rationale: "Use one scope reviewer and one runtime reviewer.",
        reviewers: [
          {
            reviewerID: "scope",
            title: "Scope reviewer",
            focus: "Reject untraced concerns.",
            adversarialQuestions: ["Is every finding anchored to a REQ, AS, or user quote?"],
          },
          {
            reviewerID: "runtime",
            title: "Runtime reviewer",
            focus: "Check runtime evidence.",
            adversarialQuestions: ["Does the evidence satisfy acc-chat?"],
          },
        ],
      })
    } else if (input.terminalTool.toolName === "submit_reviewer_report") {
      const report = input.sessionTitle.includes("Scope reviewer") ? untracedReviewerReport : runtimeReviewerReport
      await input.toolKit.tools.submit_reviewer_report.execute(report)
    } else if (input.terminalTool.toolName === "submit_integrity_consensus") {
      capturedConsensusPrompt = input.buildUserPrompt()
      await input.toolKit.tools.register_integrity_check_item.execute({
        id: "check_scope_traceability",
        reviewerID: "scope",
        category: "traceability",
        target: "untraced reviewer concern",
        question: "Is the bundle-size concern anchored to the request, REQ, or acceptance spec?",
        status: "passed",
        expected: "Untraced concerns are dropped from final findings.",
        observed: "The untraced bundle-size concern was dropped from final findings.",
        evidence: ["No requirement, acceptance spec, or original request quote names bundle size."],
      })
      await input.toolKit.tools.register_integrity_check_item.execute({
        id: "check_runtime_req_1",
        reviewerID: "runtime",
        category: "requirement",
        target: "REQ-1",
        question: "Does the runtime evidence satisfy REQ-1 and acc-chat?",
        status: "passed",
        expected: "Assistant replies are visible in the chat transcript.",
        observed: "REQ-1 and acc-chat both name the chat response behavior.",
        evidence: ["REQ-1 and acc-chat both name the chat response behavior."],
        requirementIDs: ["REQ-1"],
        specIDs: ["acc-chat"],
        targetIDs: ["goal_chat"],
      })
      await input.toolKit.tools.register_integrity_reviewer_report.execute(untracedReviewerReport)
      await input.toolKit.tools.register_integrity_reviewer_report.execute(runtimeReviewerReport)
      await input.toolKit.tools.register_integrity_coverage_audit.execute({
        checkIDs: ["check_runtime_req_1"],
        promise: "REQ-1 assistant replies render.",
        reviewerIDs: ["runtime"],
        status: "covered",
        notes: "Runtime reviewer covered REQ-1 and acc-chat.",
      })
      await input.toolKit.tools.register_integrity_round.execute({
        roundID: "traceability-consensus",
        prompt: "Remove untraced concerns from final consensus.",
        reviewerIDs: ["scope", "runtime"],
        outcome: "Dropped untraced bundle-size concern.",
      })
      await input.toolKit.tools.submit_integrity_consensus.execute({
        verdict: "pass",
        summary: "Only traced findings may survive consensus; no traced finding remains.",
        teamReportMarkdown:
          "### Integrity team review\n\nUntraced bundle-size concern was dropped from final findings.",
      })
    } else {
      throw new Error(`unexpected terminal tool ${input.terminalTool.toolName}`)
    }

    return {
      session,
      collector: input.toolKit.getCollector(),
      finalMessage: { info: {} },
      streamErrors: [],
      model: { providerID: "test", modelID: "stub", id: "test/stub" },
    }
  },
}))

afterEach(() => {
  sessionCounter = 0
  capturedConsensusPrompt = ""
  mock.restore()
})

describe("integrity consensus traceability discipline", () => {
  test("production consensus does not expose reviewer finding side channels", async () => {
    const { reviewIntegrity } = await import("../../src/integrity/team-agent")
    const result = await reviewIntegrity({
      userRequest: "Build a chat page that renders assistant replies.",
      taskTitle: "Chat page",
      goals: [
        {
          id: "goal_chat",
          title: "Chat response UI",
          objective: "Render assistant replies in the chat page.",
          acceptance_specs: [
            {
              id: "acc-chat",
              source_requirement_id: "REQ-1",
              goal_id: "goal_chat",
              title: "Assistant replies render",
              severity: "essential",
              scorers: [
                {
                  type: "llm_judge",
                  name: "reply visible",
                  criteria: "Assistant replies are visible in the chat transcript.",
                },
              ],
            },
          ],
          owned_paths: ["src/App.tsx"],
          depends_on: [],
          priority: "blocking",
          kind: "feature",
          requirement_ids: ["REQ-1"],
        },
      ],
      requirements: [
        {
          id: "REQ-1",
          type: "explicit",
          description: "Assistant replies render in the chat transcript.",
          acceptance: "Assistant replies are visible after sending a prompt.",
          non_goals: "No bundle-size budget is requested.",
        },
      ],
      replayContext: replayContext(),
    })

    expect(capturedConsensusPrompt).toContain("Perform the integrity review in this single streaming session")
    expect(capturedConsensusPrompt).toContain("must be removed from the final report")
    expect(Object.prototype.hasOwnProperty.call(result.reviewers[0] ?? {}, "findings")).toBe(false)
    expect(result.findings).toEqual([])
    expect(result.issues).toEqual([])
    expect(result.verdict).toBe("pass")
  })
})
