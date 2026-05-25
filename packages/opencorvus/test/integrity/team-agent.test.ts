import { afterEach, describe, expect, mock, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import type { IntegrityReplayContext } from "../../src/integrity/replay-context"
import { tmpdir } from "../fixture/fixture"

let runnerCalls: any[] = []
let forwarders: any[] = []
let progressEvents: any[] = []
let completedEvents: any[] = []
let createdSessions: any[] = []
let userPrompts: string[] = []

mock.module("@/agent/runner", () => ({
  runAgentSession: async (input: any) => {
    runnerCalls.push(input)
    userPrompts.push(input.buildUserPrompt())
    const session = {
      id:
        input.existingSessionID ??
        (input.sessionTitle.includes("Reviewer") ? `ses_reviewer_${runnerCalls.length}` : "ses_integrity_plan"),
    }
    const lifecycle = input.onSessionCreated?.(session)
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
      const reviewerID = runnerCalls.filter((call) => call.terminalTool.toolName === "submit_reviewer_report").length === 1
        ? "rev_a"
        : "rev_b"
      collector.report = {
        reviewerID,
        scope: reviewerID === "rev_a" ? "Surface A" : "Surface B",
        verdict: "pass",
        summary: `${reviewerID} passed`,
        evidence: [],
        findings: [],
        openQuestions: [],
      }
    } else if (input.terminalTool.toolName === "submit_integrity_consensus") {
      collector.report = {
        verdict: "pass",
        summary: "Team passed",
        teamReportMarkdown: "Team passed",
        reviewers: [
          {
            reviewerID: "rev_a",
            scope: "Surface A",
            verdict: "pass",
            summary: "rev_a passed",
            evidence: [],
            findings: [],
            openQuestions: [],
          },
          {
            reviewerID: "rev_b",
            scope: "Surface B",
            verdict: "pass",
            summary: "rev_b passed",
            evidence: [],
            findings: [],
            openQuestions: [],
          },
        ],
        findings: [],
        rounds: [],
        requiredRepairs: [],
        unresolvedDisagreements: [],
        fact_check_items: [],
      }
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
  emitReviewStreamStarted: () => undefined,
  reviewIDForIntegrity: (sessionID: string) => `review_${sessionID}`,
}))

mock.module("@/engine/protocol", () => ({
  EngineProtocol: {
    emit: async (event: string, payload: any, options: any) => {
      completedEvents.push({ event, payload, options })
    },
  },
}))

mock.module("@/session", () => ({
  Session: {
    createNext: async (input: any) => {
      createdSessions.push(input)
      return { id: "ses_soft_integrity" }
    },
  },
}))

function replayContext(attemptNumber: number): IntegrityReplayContext {
  return {
    attemptNumber,
    lineage: {
      taskID: "tsk_team_replay",
      activeSpecSnapshotID: "spec_team_replay",
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
      priorAttempts: attemptNumber - 1,
      priorBlockingFindings: 0,
      phase: "post_build",
    },
  }
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
      deliverySummaries: ["Delivery updated the storage guard."],
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

const contractGraph = {
  contracts: [],
  dependency_contracts: [],
  audit_criteria: [],
}

describe("integrity team-agent replay attempts", () => {
  const originalSetInterval = globalThis.setInterval
  const originalClearInterval = globalThis.clearInterval

  afterEach(async () => {
    runnerCalls = []
    forwarders = []
    progressEvents = []
    completedEvents = []
    createdSessions = []
    userPrompts = []
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
          contractGraph,
          replayContext: reReviewReplayContext(),
          taskID: "tsk_team_attempt",
          parentSessionID: "ses_parent",
        })
      },
    })

    expect(forwarders.map((item) => item.attempt())).toEqual([2, 2, 2, 2])
    expect(progressEvents).toHaveLength(1)
    expect(progressEvents[0].attempt).toBe(2)
    expect(completedEvents).toHaveLength(1)
    expect(completedEvents[0].payload.attempts).toBe(2)
    expect(userPrompts).toHaveLength(4)
    for (const prompt of userPrompts) {
      expect(prompt).toContain("# Integrity Replay Context")
      expect(prompt).toContain("Current integrity attempt: #2")
      expect(prompt).toContain("rev_settings: Settings validation")
      expect(prompt).toContain("BF-1: Settings validation blind spot")
      expect(prompt).toContain("repair: Reject invalid settings before persisting.")
      expect(prompt).toContain("repair-settings: Add settings validation")
      expect(prompt).toContain("src/services/storage.ts")
      expect(prompt).toContain("\\# injected user heading")
      expect(prompt).not.toContain("\u001B")
      expect(prompt).toContain("- prior_blocking_findings=1")
    }
    expect(userPrompts[0]).toContain("Prior reviewer focuses are the list of surfaces that were inspected")
    expect(userPrompts[0]).toContain("Do not default to five reviewers")
    expect(userPrompts[1]).toContain("you are reviewing the current attempt, not starting from zero")
    expect(userPrompts[3]).toContain("Compare the current reviewer reports against prior attempts")
  })

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
          contractGraph,
          replayContext: replayContext(4),
          taskID: "tsk_team_no_goals",
          parentSessionID: "ses_parent",
        })
      },
    })

    expect(createdSessions).toHaveLength(1)
    expect(completedEvents).toHaveLength(1)
    expect(completedEvents[0].payload.attempts).toBe(4)
  })
})
