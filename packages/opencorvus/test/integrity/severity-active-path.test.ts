import { afterEach, expect, mock, test } from "bun:test"

let capturedPrompts: string[] = []

const investigationPlan = {
  requestPromise: "ship the scoped chat behavior",
  hypothesis: "the scoped evidence may not satisfy the requested chat behavior",
  evidencePlan: ["inspect prompt capture evidence"],
  passCriteria: ["prompt capture preserves severity and lineage discipline"],
}

mock.module("@/agent/runner", () => ({
  AgentRunError: class AgentRunError extends Error {},
  buildHardErrorFromFinalMessage: () => null,
  toolErrorPartsFromFinalMessage: () => [],
  runAgentSession: async (input: any) => {
    capturedPrompts.push([input.core, input.buildUserPrompt()].filter(Boolean).join("\n\n"))
    const session = {
      id:
        input.existingSessionID ??
        (input.sessionTitle.includes("Reviewer") ? `ses_reviewer_${capturedPrompts.length}` : "ses_integrity_plan"),
    }
    input.onSessionCreated?.(session)?.dispose?.()
    const collector = input.toolKit.getCollector()
    if (input.terminalTool.toolName === "submit_integrity_review_plan") {
      collector.plan = {
        rationale: "Exercise active severity prompt path.",
        reviewers: [
          {
            reviewerID: "rev_storage",
            title: "Storage reviewer",
            focus: "Storage quota advisory replay",
            adversarialQuestions: ["Does prior advisory evidence have new evidence?"],
          },
          {
            reviewerID: "rev_scope",
            title: "Scope reviewer",
            focus: "Scope-bounded maturity evidence",
            adversarialQuestions: ["Was mature decomposed into a bounded REQ?"],
          },
        ],
      }
    } else if (input.terminalTool.toolName === "submit_reviewer_report") {
      const reviewerCount = capturedPrompts.filter((prompt) =>
        prompt.includes("# Independent Integrity Reviewer"),
      ).length
      const reviewerID = reviewerCount === 1 ? "rev_storage" : "rev_scope"
      collector.report = {
        reviewerID,
        scope: reviewerID === "rev_storage" ? "Storage quota advisory replay" : "Scope-bounded maturity evidence",
        verdict: reviewerID === "rev_storage" ? "needs_correction" : "concerns",
        summary: `${reviewerID} submitted a canned report.`,
        investigationPlan,
        evidence: ["prompt capture test"],
        findings:
          reviewerID === "rev_storage"
            ? [
                {
                  id: "BF-1",
                  severity: "blocking",
                  verdictImpact: "needs_correction",
                  title: "Canned promotion attempt",
                  description:
                    "Stub intentionally emits a promotion; the test asserts prompt context, not host rejection.",
                  evidence: ["prompt capture test"],
                  targetIDs: ["goal_storage"],
                  requirementIDs: [],
                  specIDs: [],
                  filePaths: ["src/services/storage.ts"],
                  repair: "The LLM should reconcile severity from the prompt.",
                  reviewers: [reviewerID],
                  consensus: "agreed",
                },
              ]
            : [],
        openQuestions: [],
      }
    } else if (input.terminalTool.toolName === "submit_integrity_consensus") {
      await input.toolKit.tools.register_integrity_check_item.execute({
        id: "check_storage",
        reviewerID: "rev_storage",
        category: "requirement",
        target: "REQ-3",
        question: "Does storage persistence satisfy REQ-3 without improper severity promotion?",
        status: "failed",
        expected: "Normal chat conversations persist after refresh.",
        observed: "Stub intentionally emits a promotion for prompt capture.",
        evidence: ["prompt capture test"],
        requirementIDs: ["REQ-3"],
        targetIDs: ["goal_storage"],
      })
      await input.toolKit.tools.register_integrity_check_item.execute({
        id: "check_scope",
        reviewerID: "rev_scope",
        category: "scope",
        target: "maturity request wording",
        question: "Was maturity kept bounded to explicit requirements?",
        status: "passed",
        expected: "Maturity is not expanded into unbounded blockers.",
        observed: "Prompt capture preserves scope-bounded maturity guidance.",
        evidence: ["prompt capture test"],
      })
      await input.toolKit.tools.register_integrity_reviewer_report.execute({
        reviewerID: "rev_storage",
        checkIDs: ["check_storage"],
        scope: "Storage quota advisory replay",
        verdict: "needs_correction",
        summary: "rev_storage submitted a canned report.",
        investigationPlan,
        drilldowns: [
          {
            checkIDs: ["check_storage"],
            kind: "prompt_capture",
            target: "REQ-3 storage persistence",
            purpose: "Exercise severity reconciliation prompt path.",
            result: "Stub intentionally emits a promotion for prompt capture.",
          },
        ],
        coverage: [
          {
            checkIDs: ["check_storage"],
            requirementID: "REQ-3",
            status: "missing",
            evidence: "Stub intentionally emits a promotion for prompt capture.",
          },
        ],
        evidence: [{ checkIDs: ["check_storage"], note: "prompt capture test" }],
        openQuestions: [],
      })
      await input.toolKit.tools.register_integrity_reviewer_report.execute({
        reviewerID: "rev_scope",
        checkIDs: ["check_scope"],
        scope: "Scope-bounded maturity evidence",
        verdict: "concerns",
        summary: "rev_scope submitted a canned report.",
        investigationPlan,
        drilldowns: [
          {
            checkIDs: ["check_scope"],
            kind: "prompt_capture",
            target: "maturity request wording",
            purpose: "Exercise scope-bounded maturity guidance.",
            result: "Prompt capture preserves scope-bounded maturity guidance.",
          },
        ],
        coverage: [
          {
            checkIDs: ["check_scope"],
            userRequestQuote: "maturity request wording",
            status: "covered",
            evidence: "Prompt capture preserves scope-bounded maturity guidance.",
          },
        ],
        evidence: [{ checkIDs: ["check_scope"], note: "prompt capture test" }],
        openQuestions: [],
      })
      await input.toolKit.tools.register_integrity_finding.execute({
        id: "BF-1",
        checkIDs: ["check_storage"],
        severity: "blocking",
        verdictImpact: "needs_correction",
        title: "Canned promotion attempt",
        description: "Stub intentionally emits a promotion.",
        evidence: ["prompt capture test"],
        targetIDs: ["goal_storage"],
        requirementIDs: [],
        specIDs: [],
        filePaths: ["src/services/storage.ts"],
        repair: "The LLM should reconcile severity from the prompt.",
        reviewers: ["rev_storage"],
        consensus: "disputed",
      })
      await input.toolKit.tools.register_integrity_required_repair.execute({
        id: "repair-stub",
        checkIDs: ["check_storage"],
        description: "Exercise submission path.",
        evidence: ["prompt capture test"],
        targetIDs: ["goal_storage"],
        filePaths: ["src/services/storage.ts"],
      })
      await input.toolKit.tools.register_integrity_coverage_audit.execute({
        checkIDs: ["check_storage", "check_scope"],
        promise: "Storage persistence and scope-bounded maturity evidence were reviewed.",
        reviewerIDs: ["rev_storage", "rev_scope"],
        status: "missing",
        notes: "Storage reviewer intentionally reports a missing requirement for prompt capture.",
      })
      await input.toolKit.tools.submit_integrity_consensus.execute({
        verdict: "needs_correction",
        summary: "Consensus prompt captured.",
        teamReportMarkdown: "Consensus prompt captured.",
      })
    }
    return { collector, session }
  },
}))

mock.module("@/review/stream", () => ({
  createReviewReasoningForwarder: () => ({}),
  emitReviewStreamProgress: () => undefined,
  emitReviewStreamStarted: () => undefined,
  reviewIDForIntegrity: (sessionID: string) => `review_${sessionID}`,
}))

mock.module("@/engine/protocol", () => ({
  EngineProtocol: {
    emit: async () => undefined,
  },
}))

afterEach(() => {
  capturedPrompts = []
})

test("reviewIntegrity active path emits severity discipline, lineage replay, and maturity read-through", async () => {
  const { reviewIntegrity } = await import("../../src/integrity/team-agent")
  await reviewIntegrity({
    userRequest: "写一个成熟的输入 deepseek key 即可聊天的 ai chat 页面",
    taskTitle: "DeepSeek chat page",
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
        non_goals: "Quota exhaustion hardening is outside this bounded REQ.",
      },
    ],
    requirementDecisions: [
      {
        key: "maturity_scope_pending",
        value: '"成熟" needs a bounded scope decision.',
        reason: "Scope did not produce a bounded REQ for every maturity aspect.",
      },
    ],
    replayContext: {
      attemptNumber: 2,
      lineage: {
        taskID: "tsk_active_severity",
        activeSpecSnapshotID: "spec_active",
        inheritedSpecSnapshotIDs: ["spec_prev"],
        reason: "integrity_correction_lineage",
      },
      priorFactCheckAttempts: [],
      priorAttempts: [
        {
          attemptNumber: 1,
          artifactID: "art_active_prior",
          timeCreated: Date.UTC(2026, 4, 23, 12),
          phase: "post_build",
          verdict: "concerns",
          summary: "Prior advisory quota finding.",
          reviewers: [{ reviewerID: "rev_prior", scope: "Storage", verdict: "concerns" }],
          findings: [
            {
              id: "ADV-3-silent-quota-error",
              severity: "advisory",
              verdictImpact: "concerns",
              title: "safeSetItem quota warning missing",
              description: "safeSetItem swallows quota errors without user notification.",
              repair: "Consider a visible warning.",
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
        buildSummaries: ["No storage file changed after the advisory finding."],
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
  })

  expect(capturedPrompts).toHaveLength(1)
  for (const prompt of capturedPrompts) {
    expect(prompt).toContain("## Severity Discipline")
    expect(prompt).toContain("code lines on the same defect surface changed after the prior attempt")
    expect(prompt).toContain("A deeper reading of the same unchanged code")
    expect(prompt).toContain("Persistence alone is NOT promotion")
    expect(prompt).toContain("# Severity New Evidence Context")
    expect(prompt).toContain("Shared Prompt Context (severity_context)")
    expect(prompt).toContain("active_spec_snapshot=spec_active")
    expect(prompt).toContain("inherited_spec_snapshots=spec_prev")
    expect(prompt).toContain("ADV-3-silent-quota-error")
    expect(prompt).toContain("# Scope-Bounded Maturity Evidence")
    expect(prompt).toContain("Requirement decision-log entries are not part of the initial integrity context.")
    expect(prompt).not.toContain("maturity_scope_pending")
  }
  expect(capturedPrompts[0]).toContain("# Severity Reconciliation Pass")
  expect(capturedPrompts[0]).toContain("keep it advisory")
})
