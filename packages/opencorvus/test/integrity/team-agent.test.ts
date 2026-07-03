import { afterAll, afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { AgentSemaphore } from "../../src/engine/agent-semaphore"
import { Instance } from "../../src/project/instance"
import { Session } from "@/session"
import type { IntegrityReplayContext } from "../../src/integrity/replay-context"
import { tmpdir } from "../fixture/fixture"

let runnerCalls: any[] = []
let forwarders: any[] = []
let progressEvents: any[] = []
let startedEvents: any[] = []
let completedEvents: any[] = []
let createdSessions: any[] = []
let userPrompts: string[] = []
let terminalResults: string[] = []
let slowReviewerReports = false
let activeReviewerAgents = 0
let maxActiveReviewerAgents = 0

const investigationPlan = {
  requestPromise: "ship settings validation",
  hypothesis: "the scoped settings behavior may be incomplete",
  evidencePlan: ["inspect scoped settings evidence"],
  passCriteria: ["settings evidence satisfies the scoped request"],
}

mock.module("@/agent/runner", () => ({
  AgentRunError: class AgentRunError extends Error {},
  buildHardErrorFromFinalMessage: () => null,
  toolErrorPartsFromFinalMessage: () => [],
  runAgentSession: async (input: any) => {
    runnerCalls.push(input)
    if (!input.continuation) userPrompts.push(input.buildUserPrompt())
    const session = {
      id:
        input.continuation?.sessionID ??
        input.existingSessionID ??
        (input.terminalTool.toolName === "submit_integrity_consensus"
          ? "ses_integrity_consensus"
          : input.sessionTitle.includes("Reviewer")
            ? `ses_reviewer_${runnerCalls.length}`
            : "ses_integrity_plan"),
    }
    const lifecycle = input.continuation ? undefined : input.onSessionCreated?.(session)
    const collector = input.toolKit.getCollector()
    if (input.terminalTool.toolName === "submit_integrity_review_plan") {
      collector.plan = {
        rationale: "Attempt-specific reviewer plan",
        reviewers: [
          {
            reviewerID: "rev_a",
            title: "Reviewer A",
            focus: "Surface A",
            adversarialQuestions: ["Question A"],
          },
          {
            reviewerID: "rev_b",
            title: "Reviewer B",
            focus: "Surface B",
            adversarialQuestions: ["Question B"],
          },
        ],
      }
    } else if (input.terminalTool.toolName === "submit_reviewer_report") {
      if (slowReviewerReports) {
        activeReviewerAgents++
        maxActiveReviewerAgents = Math.max(maxActiveReviewerAgents, activeReviewerAgents)
        await new Promise((resolve) => setTimeout(resolve, 25))
        activeReviewerAgents--
      }
      const reviewerID =
        runnerCalls.filter((call) => call.terminalTool.toolName === "submit_reviewer_report").length === 1
          ? "rev_a"
          : "rev_b"
      collector.report = {
        reviewerID,
        scope: reviewerID === "rev_a" ? "Surface A" : "Surface B",
        verdict: "pass",
        summary: `${reviewerID} passed`,
        investigationPlan,
        evidence: [],
        openQuestions: [],
      }
    } else if (input.terminalTool.toolName === "submit_integrity_consensus") {
      const result = await submitRegisteredIntegrityReport(input.toolKit.tools, passTeamReport())
      terminalResults.push(String(result))
    }
    lifecycle?.dispose?.()
    return { collector, session }
  },
}))

mock.module("@/review/stream", () => ({
  createReviewReasoningForwarder: (input: any) => {
    forwarders.push(input)
    return {}
  },
  emitReviewStreamProgress: (payload: any) => {
    progressEvents.push(payload)
  },
  emitReviewStreamStarted: (payload: any) => {
    startedEvents.push(payload)
  },
  reviewIDForIntegrity: (sessionID: string) => `review_${sessionID}`,
}))

mock.module("@/engine/protocol", () => ({
  EngineProtocol: {
    emit: async (event: string, payload: any, options: any) => {
      completedEvents.push({ event, payload, options })
    },
  },
}))

spyOn(Session, "createNext").mockImplementation(async (input: any) => {
  createdSessions.push(input)
  return { id: "ses_soft_integrity" } as any
})

function replayContext(attemptNumber: number): IntegrityReplayContext {
  return {
    attemptNumber,
    lineage: {
      taskID: "tsk_team_replay",
      activeSpecSnapshotID: "spec_team_replay",
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
      requirements: 0,
      acceptanceSpecs: 0,
      changedFilesTotal: 0,
      changedFilesSinceLastReview: 0,
      priorFactCheckAttempts: [],
      priorAttempts: attemptNumber - 1,
      priorBlockingFindings: 0,
      phase: "post_build",
    },
  }
}

function passTeamReport(input: { requirementIDs?: string[] } = {}) {
  return {
    verdict: "pass",
    summary: "Team passed",
    teamReportMarkdown: "Team passed",
    checkItems: [
      {
        id: "check_surface_a",
        reviewerID: "rev_a",
        category: "runtime",
        target: "Surface A",
        question: "Does Surface A satisfy its scoped promise?",
        status: "passed",
        expected: "Surface A satisfies its scoped promise.",
        observed: "Surface A evidence satisfies the scoped promise.",
        evidence: ["inspect_integrity_evidence:surface-a"],
        requirementIDs: input.requirementIDs ?? [],
        specIDs: [],
        targetIDs: [],
        userRequestQuotes: [],
      },
      {
        id: "check_surface_b",
        reviewerID: "rev_b",
        category: "runtime",
        target: "Surface B",
        question: "Does Surface B satisfy its scoped promise?",
        status: "passed",
        expected: "Surface B satisfies its scoped promise.",
        observed: "Surface B evidence satisfies the scoped promise.",
        evidence: ["inspect_integrity_evidence:surface-b"],
        requirementIDs: input.requirementIDs ?? [],
        specIDs: [],
        targetIDs: [],
        userRequestQuotes: [],
      },
    ],
    reviewers: [
      {
        reviewerID: "rev_a",
        checkIDs: ["check_surface_a"],
        scope: "Surface A",
        verdict: "pass",
        summary: "rev_a passed",
        investigationPlan,
        drilldowns: [
          {
            checkIDs: ["check_surface_a"],
            kind: "inspect_integrity_evidence",
            target: "Surface A",
            purpose: "Verify Surface A scoped promise.",
            result: "Surface A evidence satisfies the scoped promise.",
          },
        ],
        coverage: [
          {
            checkIDs: ["check_surface_a"],
            userRequestQuote: "Surface A satisfies its scoped promise.",
            status: "covered",
            evidence: "inspect_integrity_evidence:surface-a",
          },
        ],
        evidence: [{ checkIDs: ["check_surface_a"], note: "inspect_integrity_evidence:surface-a" }],
        openQuestions: [],
      },
      {
        reviewerID: "rev_b",
        checkIDs: ["check_surface_b"],
        scope: "Surface B",
        verdict: "pass",
        summary: "rev_b passed",
        investigationPlan,
        drilldowns: [
          {
            checkIDs: ["check_surface_b"],
            kind: "inspect_integrity_evidence",
            target: "Surface B",
            purpose: "Verify Surface B scoped promise.",
            result: "Surface B evidence satisfies the scoped promise.",
          },
        ],
        coverage: [
          {
            checkIDs: ["check_surface_b"],
            userRequestQuote: "Surface B satisfies its scoped promise.",
            status: "covered",
            evidence: "inspect_integrity_evidence:surface-b",
          },
        ],
        evidence: [{ checkIDs: ["check_surface_b"], note: "inspect_integrity_evidence:surface-b" }],
        openQuestions: [],
      },
    ],
    findings: [],
    coverageAudit: [
      {
        checkIDs: ["check_surface_a", "check_surface_b"],
        promise: "Task-scoped surfaces were reviewed.",
        reviewerIDs: ["rev_a", "rev_b"],
        status: "covered",
        notes: "Both reviewer perspectives registered evidence-backed checks.",
      },
    ],
    uninspectedRisks: [],
    rounds: [],
    requiredRepairs: [],
    unresolvedDisagreements: [],
    fact_check_items: [],
  }
}

async function submitRegisteredIntegrityReport(tools: Record<string, any>, report: ReturnType<typeof passTeamReport>) {
  for (const item of report.checkItems) {
    await tools.register_integrity_check_item.execute!(item, {})
  }
  for (const reviewer of report.reviewers) {
    await tools.register_integrity_reviewer_report.execute!(reviewer, {})
  }
  for (const row of report.coverageAudit) {
    await tools.register_integrity_coverage_audit.execute!(row, {})
  }
  for (const row of report.uninspectedRisks) {
    await tools.register_integrity_uninspected_risk.execute!(row, {})
  }
  for (const row of report.findings) {
    await tools.register_integrity_finding.execute!(row, {})
  }
  for (const row of report.rounds) {
    await tools.register_integrity_round.execute!(row, {})
  }
  for (const row of report.requiredRepairs) {
    await tools.register_integrity_required_repair.execute!(row, {})
  }
  for (const row of report.unresolvedDisagreements) {
    await tools.register_integrity_unresolved_disagreement.execute!(row, {})
  }
  for (const row of report.fact_check_items) {
    await tools.register_integrity_fact_check_item.execute!(row, {})
  }
  return tools.submit_integrity_consensus.execute!(
    {
      verdict: report.verdict,
      summary: report.summary,
      teamReportMarkdown: report.teamReportMarkdown,
    },
    {},
  )
}

function reReviewReplayContext(): IntegrityReplayContext {
  const priorTime = Date.UTC(2026, 4, 23, 12, 44, 15, 975)
  return {
    attemptNumber: 2,
    lineage: {
      taskID: "tsk_team_attempt",
      activeSpecSnapshotID: "spec_team_attempt",
      inheritedSpecSnapshotIDs: [],
      reason: "active_only",
    },
    priorFactCheckAttempts: [],
    priorAttempts: [
      {
        attemptNumber: 1,
        artifactID: "artifact_attempt_1",
        timeCreated: priorTime,
        phase: "post_build",
        verdict: "needs_correction",
        summary: "Prior settings validation review found a storage guard gap.",
        reviewers: [{ reviewerID: "rev_settings", scope: "Settings validation", verdict: "needs_correction" }],
        blockingFindings: [
          {
            id: "BF-1",
            title: "Settings validation blind spot",
            description: "Invalid settings can still be persisted.",
            repair: "Reject invalid settings before persisting.",
            filePaths: ["src/settings.ts"],
            requirementIDs: ["REQ-settings"],
            specIDs: ["AS-settings"],
          },
        ],
        requiredRepairs: [
          {
            id: "repair-settings",
            description: "Add settings validation",
            filePaths: ["src/settings.ts"],
          },
        ],
        unresolvedDisagreements: [],
      },
    ],
    buildEvidenceSinceLastReview: {
      sinceAttemptNumber: 1,
      sinceTimeCreated: priorTime,
      changedFiles: ["src/services/storage.ts"],
      diffs: [{ file: "src/services/storage.ts", status: "modified", additions: 8, deletions: 2 }],
      buildSummaries: ["Build updated the storage guard."],
      goalRuns: [
        {
          goalID: "goal_settings",
          goalRunID: "glr_settings_retry",
          status: "completed",
          timeCreated: priorTime + 1000,
          timeCompleted: priorTime + 2000,
        },
      ],
    },
    scaleSignals: {
      goals: 2,
      requirements: 3,
      acceptanceSpecs: 4,
      changedFilesTotal: 3,
      changedFilesSinceLastReview: 1,
      priorAttempts: 1,
      priorBlockingFindings: 1,
      phase: "post_build",
    },
  }
}

describe("integrity team-agent replay attempts", () => {
  const originalSetInterval = globalThis.setInterval
  const originalClearInterval = globalThis.clearInterval

  afterAll(() => {
    mock.restore()
  })

  afterEach(async () => {
    runnerCalls = []
    forwarders = []
    progressEvents = []
    startedEvents = []
    completedEvents = []
    createdSessions = []
    userPrompts = []
    terminalResults = []
    slowReviewerReports = false
    activeReviewerAgents = 0
    maxActiveReviewerAgents = 0
    AgentSemaphore.reset()
    globalThis.setInterval = originalSetInterval
    globalThis.clearInterval = originalClearInterval
    await Instance.disposeAll().catch(() => undefined)
  })

  test("uses replayContext attempt number for stream progress, forwarders, and completed event", async () => {
    await using tmp = await tmpdir({ git: true })
    globalThis.setInterval = ((callback: TimerHandler) => {
      if (typeof callback === "function") callback()
      return 1 as unknown as ReturnType<typeof setInterval>
    }) as typeof setInterval
    globalThis.clearInterval = (() => undefined) as typeof clearInterval

    const { reviewIntegrity } = await import("../../src/integrity/team-agent")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await reviewIntegrity({
          userRequest: "Ship settings validation\n# injected user heading\u001B[31m",
          taskTitle: "Settings validation",
          goals: [
            {
              id: "goal_settings",
              title: "Settings",
              objective: "Validate settings",
              acceptance_specs: [],
              owned_paths: ["src/settings.ts"],
              depends_on: [],
              priority: "blocking",
              kind: "feature",
              requirement_ids: [],
            },
          ],
          replayContext: reReviewReplayContext(),
          taskID: "tsk_team_attempt",
          parentSessionID: "ses_parent",
        })
      },
    })

    expect(forwarders.map((item) => item.attempt())).toEqual([2])
    expect(forwarders.map((item) => item.reviewID())).toEqual(["review_ses_integrity_consensus"])
    expect(forwarders.map((item) => item.source)).toEqual(["architect.integrity"])
    expect(startedEvents).toHaveLength(1)
    expect(startedEvents.map((e) => e.reviewID)).toEqual(["review_ses_integrity_consensus"])
    expect(startedEvents.map((e) => e.sessionID)).toEqual(["ses_integrity_consensus"])
    expect(startedEvents.map((e) => e.source)).toEqual(["architect.integrity"])
    expect(progressEvents).toHaveLength(1)
    expect(progressEvents[0].attempt).toBe(2)
    expect(completedEvents).toHaveLength(1)
    expect(completedEvents[0].payload.attempts).toBe(2)
    expect(completedEvents[0].payload.sessionID).toBe("ses_integrity_consensus")
    const consensusCall = runnerCalls.find((call) => call.terminalTool.toolName === "submit_integrity_consensus")
    expect(consensusCall.existingSessionID).toBeUndefined()
    expect(consensusCall.parentSessionID).toBe("ses_parent")
    expect(runnerCalls.filter((call) => call.terminalTool.toolName === "submit_reviewer_report")).toHaveLength(0)
    expect(completedEvents[0].payload.reviewers).toHaveLength(2)
    expect(userPrompts).toHaveLength(1)
    for (const prompt of userPrompts) {
      expect(prompt).toContain("# Integrity Replay Context")
      expect(prompt).toContain("Current integrity attempt: #2")
      expect(prompt).toContain("rev_settings: Settings validation")
      expect(prompt).toContain("BF-1: Settings validation blind spot")
      expect(prompt).toContain("repair: Reject invalid settings before persisting.")
      expect(prompt).toContain("repair-settings: Add settings validation")
      expect(prompt).toContain("src/services")
      expect(prompt).not.toContain("src/services/storage.ts")
      expect(prompt).toContain("\\# injected user heading")
      expect(prompt).not.toContain("\u001B")
      expect(prompt).toContain("- prior_blocking_findings=1")
    }
    expect(userPrompts[0]).toContain("Perform the integrity review in this single streaming session")
    expect(userPrompts[0]).toContain("Do not default to five reviewers")
    expect(userPrompts[0]).toContain("Compare current evidence against prior attempts")
  }, 20_000)

  test("passes integrity continuation through without opening a new session lifecycle", async () => {
    await using tmp = await tmpdir({ git: true })
    const { reviewIntegrity } = await import("../../src/integrity/team-agent")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await reviewIntegrity({
          userRequest: "Ship settings validation",
          taskTitle: "Settings validation",
          goals: [
            {
              id: "goal_settings",
              title: "Settings",
              objective: "Validate settings",
              acceptance_specs: [],
              owned_paths: ["src/settings.ts"],
              depends_on: [],
              priority: "blocking",
              kind: "feature",
              requirement_ids: [],
            },
          ],
          replayContext: replayContext(3),
          taskID: "tsk_team_continuation",
          parentSessionID: "ses_parent",
          continuation: {
            sessionID: "ses_integrity_existing",
            artifactID: "art_integrity_continue",
            reason: "Continue integrity after missing submit_integrity_consensus.",
            kind: "protocol-finalizer-miss",
            finalizerName: "submit_integrity_consensus",
          },
        })
        expect(result.sessionID).toBe("ses_integrity_existing")
      },
    })

    expect(runnerCalls).toHaveLength(1)
    expect(runnerCalls[0].continuation).toMatchObject({
      sessionID: "ses_integrity_existing",
      finalizerName: "submit_integrity_consensus",
    })
    expect(forwarders.map((item) => item.reviewID())).toEqual(["review_ses_integrity_existing"])
    expect(startedEvents).toHaveLength(0)
    expect(progressEvents).toHaveLength(0)
    expect(userPrompts).toHaveLength(0)
    expect(completedEvents).toHaveLength(1)
    expect(completedEvents[0].payload.sessionID).toBe("ses_integrity_existing")
  }, 20_000)

  test("uses replayContext attempt number for no-goals soft completed event", async () => {
    await using tmp = await tmpdir({ git: true })
    const { reviewIntegrity } = await import("../../src/integrity/team-agent")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await reviewIntegrity({
          userRequest: "Ship settings validation",
          taskTitle: "Settings validation",
          goals: [],
          replayContext: replayContext(4),
          taskID: "tsk_team_no_goals",
          parentSessionID: "ses_parent",
        })
      },
    })

    expect(createdSessions).toHaveLength(1)
    expect(completedEvents).toHaveLength(1)
    expect(completedEvents[0].payload.attempts).toBe(4)
  }, 20_000)

  test("does not spawn reviewer agents while preserving reviewer report entries", async () => {
    await using tmp = await tmpdir({ git: true })
    slowReviewerReports = true
    const { reviewIntegrity } = await import("../../src/integrity/team-agent")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await reviewIntegrity({
          userRequest: "Ship settings validation",
          taskTitle: "Settings validation",
          goals: [
            {
              id: "goal_settings",
              title: "Settings",
              objective: "Validate settings",
              acceptance_specs: [],
              owned_paths: ["src/settings.ts"],
              depends_on: [],
              priority: "blocking",
              kind: "feature",
              requirement_ids: [],
            },
          ],
          replayContext: replayContext(1),
          taskID: "tsk_team_parallelism",
          task: {
            id: "tsk_team_parallelism",
            budget: { max_executor_groups: 1 },
          } as any,
          parentSessionID: "ses_parent",
        })
      },
    })

    expect(runnerCalls).toHaveLength(1)
    expect(runnerCalls[0].terminalTool.toolName).toBe("submit_integrity_consensus")
    expect(runnerCalls.filter((call) => call.terminalTool.toolName === "submit_reviewer_report")).toHaveLength(0)
    expect(maxActiveReviewerAgents).toBe(0)
    expect(completedEvents[0].payload.reviewers).toHaveLength(2)
  }, 20_000)

  test("reviewIntegrity records pass verdict without a legacy visual bundle host gate", async () => {
    await using tmp = await tmpdir({ git: true })
    const { reviewIntegrity } = await import("../../src/integrity/team-agent")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await reviewIntegrity({
          userRequest: "Clone a reference page",
          taskTitle: "Reference visual parity",
          goals: [
            {
              id: "goal_visual",
              title: "Visual parity",
              objective: "Verify reference parity",
              acceptance_specs: [],
              owned_paths: ["src/page.tsx"],
              depends_on: [],
              priority: "blocking",
              kind: "verification",
              requirement_ids: [],
            },
          ],
          replayContext: replayContext(1),
          taskID: "tsk_team_visual_required",
          parentSessionID: "ses_parent",
          projectRoot: tmp.path,
        })
      },
    })

    expect(terminalResults.join("\n")).toContain("RECORDED: integrity review recorded with verdict=pass")
    expect(terminalResults.join("\n")).not.toContain("inspect_visual_feedback_evidence")
    expect(terminalResults.join("\n")).not.toContain("VisualFeedbackVerification")
    expect(completedEvents).toHaveLength(1)
  }, 20_000)

  test("consensus prompt separates coverage audit status from verdict enums", async () => {
    const { buildSupervisorConsensusPrompt } = await import("../../src/integrity/team-agent")
    const prompt = buildSupervisorConsensusPrompt(
      {
        userRequest: "Use only API names from SdkAdapter authority.",
        taskTitle: "API authority",
        goals: [
          {
            id: "goal_api",
            title: "API authority",
            objective: "Verify API names.",
            acceptance_specs: [],
            owned_paths: ["src/api.ts"],
            depends_on: [],
            priority: "blocking",
            kind: "verification",
            requirement_ids: ["REQ-1"],
          },
        ],
        replayContext: replayContext(1),
      },
      {
        rationale: "Need API reviewer.",
        riskHypotheses: [],
        coveragePlan: [],
        reviewers: [
          {
            reviewerID: "rev_api",
            title: "API reviewer",
            focus: "API authority",
            riskHypothesisIDs: [],
            drilldownPlan: [],
            adversarialQuestions: ["Are API names authoritative?"],
          },
          {
            reviewerID: "rev_flow",
            title: "Flow reviewer",
            focus: "Flow behavior",
            riskHypothesisIDs: [],
            drilldownPlan: [],
            adversarialQuestions: ["Does the flow still work?"],
          },
        ],
      },
      [
        {
          reviewerID: "rev_api",
          checkIDs: ["check_rev_api"],
          scope: "API authority",
          verdict: "concerns",
          summary: "API status has concerns.",
          investigationPlan,
          drilldowns: [],
          coverage: [
            {
              checkIDs: ["check_rev_api"],
              userRequestQuote: "Use only API names from SdkAdapter authority.",
              status: "missing",
              evidence: "One API name is not in SdkAdapter.",
            },
          ],
          evidence: [{ checkIDs: ["check_rev_api"], note: "Read SdkAdapter." }],
          openQuestions: [],
        },
        {
          reviewerID: "rev_flow",
          checkIDs: ["check_rev_flow"],
          scope: "Flow behavior",
          verdict: "pass",
          summary: "Flow checked.",
          investigationPlan,
          drilldowns: [],
          coverage: [
            {
              checkIDs: ["check_rev_flow"],
              userRequestQuote: "Use only API names from SdkAdapter authority.",
              status: "covered",
              evidence: "Flow reviewed.",
            },
          ],
          evidence: [{ checkIDs: ["check_rev_flow"], note: "Read handlers." }],
          openQuestions: [],
        },
      ],
    )

    expect(prompt).toContain("Coverage audit status contract:")
    expect(prompt).toContain("`coverageAudit[].status`")
    expect(prompt).toContain("`covered`, `missing`, `inconclusive`")
    expect(prompt).toContain("Do not use `concerns`")
    expect(prompt).toContain("Overall verdict values belong only in `verdict` / `verdictImpact`")
  })

  test("single-session integrity prompt renders every requirement and requirement status row", async () => {
    const { buildSingleSessionIntegrityPrompt } = await import("../../src/integrity/team-agent")
    const requirements = Array.from({ length: 9 }, (_value, index) => {
      const id = `REQ-${index + 1}`
      return {
        id,
        type: "explicit" as const,
        description:
          id === "REQ-9"
            ? "Render the page footer with secondary links, legal text, and data-provider credits."
            : `Render required page section ${index + 1}.`,
        acceptance:
          id === "REQ-9"
            ? "Footer links, legal text, and data-provider credits are visible in the rendered page."
            : `Section ${index + 1} is visible and verifiable.`,
        non_goals: "",
        evidence_refs: [],
      }
    })
    const requirementStatus = requirements.map((requirement) => ({
      reqID: requirement.id,
      reqDescription: requirement.description,
      claimingGoals:
        requirement.id === "REQ-9"
          ? []
          : [
              {
                goalID: `goal_${requirement.id.toLowerCase().replace("-", "_")}`,
                goalTitle: `Goal ${requirement.id}`,
                runStatus: "completed" as const,
                specOutcomes: [
                  {
                    specID: `acc-${requirement.id.toLowerCase()}`,
                    severity: "essential" as const,
                    passed: true,
                    summary: "checked",
                  },
                ],
              },
            ],
    }))

    const prompt = buildSingleSessionIntegrityPrompt({
      userRequest: "Replicate the full long page including the footer.",
      taskTitle: "Full page replica",
      goals: [
        {
          id: "goal_page",
          title: "Page",
          objective: "Implement the page body.",
          acceptance_specs: [],
          owned_paths: ["src/page.tsx"],
          depends_on: [],
          priority: "blocking",
          kind: "feature",
          requirement_ids: requirements.slice(0, 8).map((requirement) => requirement.id),
        },
      ],
      requirements,
      requirementStatus,
      replayContext: replayContext(1),
    })

    expect(prompt).toContain("Rendered all 9 requirements")
    expect(prompt).toContain("REQ-9 (explicit): Render the page footer")
    expect(prompt).toContain("Footer links, legal text, and data-provider credits")
    expect(prompt).toContain("Rendered all 9 requirement status rows")
    expect(prompt).toContain("## REQ-9: Render the page footer")
    expect(prompt).toContain("- no claiming goal")
    expect(prompt).not.toContain("Rendered 8/9 requirements")
    expect(prompt).not.toContain("omitted 1 requirements")
    expect(prompt).not.toContain("omitted 1 requirement status rows")
  })

  test("submit_integrity_consensus requires every active requirement to be structurally touched", async () => {
    const { IntegrityTestHooks } = await import("../../src/integrity/team-agent")
    const requirements = [
      {
        id: "REQ-1",
        type: "explicit" as const,
        description: "Render primary content.",
        acceptance: "Primary content is rendered.",
        non_goals: "",
        evidence_refs: [],
      },
      {
        id: "REQ-2",
        type: "explicit" as const,
        description: "Render secondary footer content.",
        acceptance: "Secondary footer content is rendered.",
        non_goals: "",
        evidence_refs: [],
      },
    ]
    const collector = IntegrityTestHooks.emptyConsensusCollector()
    const kit = await IntegrityTestHooks.createSingleSessionIntegrityToolKit({
      collector,
      goals: [
        {
          id: "goal_page",
          title: "Page",
          objective: "Implement the page.",
          acceptance_specs: [],
          owned_paths: ["src/page.tsx"],
          depends_on: [],
          priority: "blocking",
          kind: "feature",
          requirement_ids: ["REQ-1"],
        },
      ],
      requirements,
    } as any)

    const omitted = await submitRegisteredIntegrityReport(kit.tools, passTeamReport())
    expect(String(omitted)).toContain("check graph is incomplete")
    expect(String(omitted)).toContain("active requirement REQ-1")
    expect(String(omitted)).toContain("active requirement REQ-2")
    expect((collector as any).report).toBeUndefined()

    const report = passTeamReport({ requirementIDs: ["REQ-1", "REQ-2"] })
    ;(report as any).verdict = "concerns"
    ;(report as any).summary = "Team found incomplete coverage."
    ;(report as any).teamReportMarkdown = "Team found incomplete coverage."
    ;(report.reviewers[0] as any).coverage = [
      {
        checkIDs: ["check_surface_a"],
        requirementID: "REQ-1",
        status: "covered",
        evidence: "Primary content evidence inspected.",
      },
    ]
    ;(report.reviewers[1] as any).coverage = [
      {
        checkIDs: ["check_surface_b"],
        requirementID: "REQ-2",
        status: "missing",
        evidence: "Footer evidence is absent.",
      },
    ]

    const recorded = await submitRegisteredIntegrityReport(kit.tools, report)
    expect(String(recorded)).toContain("RECORDED")
    expect((collector as any).report).toBeDefined()
  })

  test("submit_integrity_consensus rejects the old full-report payload", async () => {
    const { IntegrityTestHooks } = await import("../../src/integrity/team-agent")
    const kit = await IntegrityTestHooks.createSingleSessionIntegrityToolKit({
      collector: IntegrityTestHooks.emptyConsensusCollector(),
      goals: [],
    } as any)

    const schema = kit.tools.submit_integrity_consensus.inputSchema as {
      safeParse: (value: unknown) => { success: boolean }
    }
    expect(schema.safeParse(passTeamReport()).success).toBe(false)

    const result = await kit.tools.submit_integrity_consensus.execute!(passTeamReport(), {} as any)
    expect(String(result)).toContain("accepts only verdict, summary, and teamReportMarkdown")
  })

  test("register_integrity_reviewer_report rejects unknown check ids before final submit", async () => {
    const { IntegrityTestHooks } = await import("../../src/integrity/team-agent")
    const collector = IntegrityTestHooks.emptyConsensusCollector()
    const kit = await IntegrityTestHooks.createSingleSessionIntegrityToolKit({
      collector,
      goals: [],
    } as any)

    const result = await kit.tools.register_integrity_reviewer_report.execute!(passTeamReport().reviewers[0], {} as any)

    expect(String(result)).toContain("references unregistered check items")
    expect(collector.reviewers).toHaveLength(0)
  })

  test("submit_integrity_consensus rejects check evidence without reviewer support rows", async () => {
    const { IntegrityTestHooks } = await import("../../src/integrity/team-agent")
    const collector = IntegrityTestHooks.emptyConsensusCollector()
    const kit = await IntegrityTestHooks.createSingleSessionIntegrityToolKit({
      collector,
      goals: [],
    } as any)
    const report = passTeamReport()
    report.checkItems[0]!.evidence = ["unbacked evidence string"]

    const result = await submitRegisteredIntegrityReport(kit.tools, report)

    expect(String(result)).toContain("check graph is incomplete")
    expect(String(result)).toContain("checkItem \"check_surface_a\" evidence is not backed by reviewer support rows")
    expect(collector.report).toBeUndefined()
  })

  test("submit_integrity_consensus rejects finding and repair evidence outside cited check evidence", async () => {
    const { IntegrityTestHooks } = await import("../../src/integrity/team-agent")
    const collector = IntegrityTestHooks.emptyConsensusCollector()
    const kit = await IntegrityTestHooks.createSingleSessionIntegrityToolKit({
      collector,
      goals: [],
    } as any)
    const report = passTeamReport()
    report.verdict = "needs_correction"
    report.summary = "Team found a backed defect."
    report.teamReportMarkdown = "Team found a backed defect."
    report.checkItems[0]!.status = "failed"
    report.reviewers[0]!.verdict = "needs_correction"
    report.findings = [
      {
        id: "finding_detached_evidence",
        checkIDs: ["check_surface_a"],
        severity: "blocking",
        verdictImpact: "needs_correction",
        title: "Detached evidence finding",
        description: "The finding cites evidence that was not on the cited check item.",
        evidence: ["invented finding evidence"],
        targetIDs: [],
        requirementIDs: [],
        specIDs: [],
        userRequestQuotes: ["Surface A satisfies its scoped promise."],
        filePaths: ["src/surface-a.ts"],
        affectedSymbols: [],
        repair: "Repair Surface A.",
        verify: ["Re-run the Surface A check."],
        sourceFindingIDs: [],
        priorAttemptRefs: [],
        reviewers: ["rev_a"],
        consensus: "agreed",
      },
    ]
    report.requiredRepairs = [
      {
        id: "repair_detached_evidence",
        checkIDs: ["check_surface_a"],
        severity: "blocking",
        description: "Repair the detached evidence finding.",
        evidence: ["invented repair evidence"],
        targetIDs: [],
        requirementIDs: [],
        specIDs: [],
        filePaths: ["src/surface-a.ts"],
        affectedSymbols: [],
        repair: "Repair Surface A.",
        verify: ["Re-run the Surface A check."],
        sourceFindingIDs: ["finding_detached_evidence"],
        priorAttemptRefs: [],
      },
    ]

    const result = await submitRegisteredIntegrityReport(kit.tools, report)

    expect(String(result)).toContain("check graph is incomplete")
    expect(String(result)).toContain("finding \"finding_detached_evidence\" evidence is not present")
    expect(String(result)).toContain("requiredRepair \"repair_detached_evidence\" evidence is not present")
    expect(collector.report).toBeUndefined()
  })

  test("submit_integrity_consensus rejects duplicate submits without overwriting the report", async () => {
    const { IntegrityTestHooks } = await import("../../src/integrity/team-agent")
    const collector = IntegrityTestHooks.emptyConsensusCollector()
    const kit = await IntegrityTestHooks.createSingleSessionIntegrityToolKit({
      collector,
      goals: [],
    } as any)

    await submitRegisteredIntegrityReport(kit.tools, passTeamReport())
    const duplicate = await kit.tools.submit_integrity_consensus.execute!(
      { verdict: "pass", summary: "second", teamReportMarkdown: "second" },
      {} as any,
    )

    expect(String(duplicate)).toContain("duplicate submit_integrity_consensus ignored")
    expect(collector.report?.summary).toBe("Team passed")
  })

  test("consensus prompt summarizes oversized reviewer reports instead of replaying full tool dumps", async () => {
    const { buildSupervisorConsensusPrompt } = await import("../../src/integrity/team-agent")
    const prompt = buildSupervisorConsensusPrompt(
      {
        userRequest: "Review a large implementation without overflowing consensus context.",
        taskTitle: "Large review",
        goals: [
          {
            id: "goal_large",
            title: "Large review",
            objective: "Verify large reviewer reports stay consumable.",
            acceptance_specs: [],
            owned_paths: ["src/large.ts"],
            depends_on: [],
            priority: "blocking",
            kind: "verification",
            requirement_ids: ["REQ-1"],
          },
        ],
        replayContext: replayContext(2),
      },
      {
        rationale: "Need a large report reviewer.",
        riskHypotheses: [],
        coveragePlan: [],
        reviewers: [
          {
            reviewerID: "rev_large",
            title: "Large report reviewer",
            focus: "Large report",
            riskHypothesisIDs: [],
            drilldownPlan: [],
            adversarialQuestions: ["Can consensus read this without raw dump overflow?"],
          },
        ],
      },
      [
        {
          reviewerID: "rev_large",
          checkIDs: ["check_rev_large"],
          scope: "Large report",
          verdict: "needs_correction",
          summary: "Important finding survives while raw dumps are summarized.",
          investigationPlan,
          drilldowns: Array.from({ length: 40 }, (_value, index) => ({
            checkIDs: ["check_rev_large"],
            kind: "command",
            target: `target-${index}`,
            purpose: `purpose-${index} ${"x".repeat(120)}`,
            result: `result-${index} ${"y".repeat(120)}`,
          })),
          coverage: [],
          evidence: Array.from({ length: 80 }, (_value, index) => ({
            checkIDs: ["check_rev_large"],
            note: `late-evidence-${index} ${"z".repeat(180)}`,
          })),
          openQuestions: [],
        },
      ],
    )

    expect(prompt).toContain("Important finding")
    expect(prompt).toContain("omitted 28 drilldowns")
    expect(prompt).toContain("omitted 62 evidence rows")
    expect(prompt).not.toContain("late-evidence-79")
  })

  test("reviewer prompt separates coverage anchors from finding traceability arrays", async () => {
    const { buildReviewerPrompt } = await import("../../src/integrity/team-agent")
    const prompt = buildReviewerPrompt(
      {
        userRequest: "Use only API names from SdkAdapter authority.",
        taskTitle: "API authority",
        goals: [
          {
            id: "goal_api",
            title: "API authority",
            objective: "Verify API names.",
            acceptance_specs: [],
            owned_paths: ["src/api.ts"],
            depends_on: [],
            priority: "blocking",
            kind: "verification",
            requirement_ids: ["REQ-1"],
          },
        ],
        replayContext: replayContext(1),
      },
      {
        reviewerID: "rev_api",
        title: "API reviewer",
        focus: "API authority",
        riskHypothesisIDs: [],
        drilldownPlan: [],
        adversarialQuestions: ["Are API names authoritative?"],
      },
    )

    expect(prompt).toContain("Reviewer coverage row contract:")
    expect(prompt).toContain("`requirementID?: string`")
    expect(prompt).toContain("`specID?: string`")
    expect(prompt).toContain("`userRequestQuote?: string`")
    expect(prompt).toContain("no `requirementIDs`, `specIDs`, `userRequestQuotes`")
    expect(prompt).toContain("reserve plural traceability arrays for `findings[]` only")
    expect(prompt).toContain("Coverage audit status contract:")
    expect(prompt).toContain("reviewer `coverage[].status`")
    expect(prompt).toContain("Reviewer drilldown row contract:")
    expect(prompt).toContain("`kind`, `target`, `purpose`, and `result`")
    expect(prompt).toContain("no `affectedSymbols`")
  })

  test("integrity prompts require falsification-oriented investigation before pass", async () => {
    const { buildReviewerPrompt, buildSingleSessionIntegrityPrompt, buildSupervisorConsensusPrompt } = await import(
      "../../src/integrity/team-agent"
    )
    const input = {
      userRequest: "Build a real settings page that saves valid changes and rejects invalid changes.",
      taskTitle: "Settings page",
      goals: [
        {
          id: "goal_settings",
          title: "Settings page",
          objective: "Implement settings save and validation.",
          acceptance_specs: [],
          owned_paths: ["src/settings.ts"],
          depends_on: [],
          priority: "blocking" as const,
          kind: "feature",
          requirement_ids: ["REQ-settings"],
        },
      ],
      replayContext: replayContext(1),
    }

    const reviewerPrompt = buildReviewerPrompt(input, {
      reviewerID: "rev_settings",
      title: "Settings reviewer",
      focus: "Settings runtime behavior",
      riskHypothesisIDs: [],
      drilldownPlan: [],
      adversarialQuestions: ["Can invalid settings still be persisted?"],
    })
    const singleSessionPrompt = buildSingleSessionIntegrityPrompt(input)
    const consensusPrompt = buildSupervisorConsensusPrompt(
      input,
      {
        rationale: "Settings behavior needs active investigation.",
        riskHypotheses: [],
        coveragePlan: [],
        reviewers: [
          {
            reviewerID: "rev_settings",
            title: "Settings reviewer",
            focus: "Settings runtime behavior",
            riskHypothesisIDs: [],
            drilldownPlan: [],
            adversarialQuestions: ["Can invalid settings still be persisted?"],
          },
          {
            reviewerID: "rev_contract",
            title: "Contract reviewer",
            focus: "Request coverage",
            riskHypothesisIDs: [],
            drilldownPlan: [],
            adversarialQuestions: ["Was the original request covered?"],
          },
        ],
      },
      [
        {
          reviewerID: "rev_settings",
          checkIDs: ["check_rev_settings"],
          scope: "Settings runtime behavior",
          verdict: "pass",
          summary: "Runtime behavior inspected.",
          investigationPlan: {
            requestPromise: "saves valid changes and rejects invalid changes",
            hypothesis: "invalid settings may still be persisted",
            evidencePlan: ["inspect settings handler"],
            passCriteria: ["invalid settings rejected before persistence"],
          },
          drilldowns: [
            {
              checkIDs: ["check_rev_settings"],
              kind: "diff_for_file",
              target: "src/settings.ts",
              purpose: "Check validation before persistence.",
              result: "Validation occurs before save.",
            },
          ],
          coverage: [
            {
              checkIDs: ["check_rev_settings"],
              userRequestQuote: "rejects invalid changes",
              status: "covered",
              evidence: "Validation handler inspected.",
            },
          ],
          evidence: [{ checkIDs: ["check_rev_settings"], note: "Scoped settings diff inspected." }],
          openQuestions: [],
        },
      ],
    )

    for (const prompt of [reviewerPrompt, singleSessionPrompt, consensusPrompt]) {
      expect(prompt).toContain("Adversarial investigation discipline:")
      expect(prompt).toContain("failure hypotheses")
      expect(prompt).toContain("not proof")
      expect(prompt).toContain(
        "A pass reviewer report still needs `investigationPlan`, `drilldowns[]`, `coverage[]`, and `evidence[]`",
      )
      expect(prompt).toContain("Do not write congratulatory or effort-focused summaries")
      expect(prompt).toContain("Only fill check item `evidence[]` after actual tool-backed inspection")
      expect(prompt).toContain("Finding and required-repair `evidence[]` must come from the cited check item evidence")
    }

    expect(reviewerPrompt).toContain("Actively try to falsify your scoped pass story")
    expect(singleSessionPrompt).toContain("initial falsification pass")
    expect(consensusPrompt).toContain("only summarizes executor claims without falsification-oriented drilldown")
  })
})
