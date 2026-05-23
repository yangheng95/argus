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
          contractGraph,
          replayContext: replayContext(2),
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
