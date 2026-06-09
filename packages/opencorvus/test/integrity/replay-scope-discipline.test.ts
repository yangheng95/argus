import { describe, expect, test } from "bun:test"

type ReplayFinding = {
  id: string
  title: string
  severity: "blocking"
  requirementIDs: string[]
  specIDs: string[]
  userRequestQuotes?: string[]
}

type ReplayAttempt = {
  round: number
  findings: ReplayFinding[]
}

const matureQuote = "\u6210\u719f"

const realTaskReplayFixture: {
  taskID: string
  userRequest: string
  requirements: Array<{ id: string; description: string; acceptance: string; non_goals: string }>
  attempts: ReplayAttempt[]
} = {
  taskID: "tsk_e54c2d091001t145QP2P6xwoqi",
  userRequest: `\u5199\u4e00\u4e2a${matureQuote}\u7684\u8f93\u5165 deepseek key \u5373\u53ef\u804a\u5929\u7684 ai chat \u9875\u9762`,
  requirements: [
    { id: "REQ-1", description: "DeepSeek API key input and invalid-key feedback.", acceptance: "", non_goals: "" },
    { id: "REQ-2", description: "Streaming chat renders AI replies token by token.", acceptance: "", non_goals: "" },
    { id: "REQ-3", description: "Conversation history persists in localStorage.", acceptance: "", non_goals: "" },
    {
      id: "REQ-5",
      description: "Stop generation, regenerate, and auto-scroll chat controls.",
      acceptance: "",
      non_goals: "",
    },
    {
      id: "REQ-6",
      description: "Chinese error handling for invalid key, rate limit, and network failure.",
      acceptance: "",
      non_goals: "",
    },
    {
      id: "REQ-9",
      description: "DeepSeek model and generation parameter settings persist.",
      acceptance: "",
      non_goals: "",
    },
  ],
  attempts: [
    {
      round: 1,
      findings: [
        finding("BF-1", "Stop-generation loses all partial AI response content"),
        finding("BF-2", "Cross-conversation race condition corrupts message state on switch during streaming"),
        finding("BF-3", "loadMessages does not abort ongoing stream on conversation switch"),
        finding("BF-4", "Mid-stream API errors silently swallowed with no user feedback"),
        finding("BF-5", "Test suite exercises parseSSEChunks utility, not the production streaming loop"),
      ],
    },
    {
      round: 2,
      findings: [
        finding("BF-1", "No runtime validation of Settings loaded from localStorage", ["REQ-9"], ["acc-api-4"]),
        finding("BF-2", "Network offline/CORS error detection is fragile", ["REQ-6"], ["acc-int-1"]),
      ],
    },
    {
      round: 3,
      findings: [
        finding(
          "BF-SV1",
          "getSettings() does not validate model name against allowed values",
          ["REQ-9"],
          ["acc-api-4"],
        ),
        finding("BF-SV2", "getSettings() does not clamp temperature to [0,2] range", ["REQ-9"], ["acc-api-4"]),
        finding("BF-SV3", "getSettings() does not clamp maxTokens to [1,8192]", ["REQ-9"], ["acc-api-4"]),
        finding("BF-SV4", "getConversations() performs no structural validation", ["REQ-3", "REQ-6"], ["acc-api-3"]),
        finding(
          "BF-EH1",
          "API key whitespace not trimmed before storage or sending",
          ["REQ-1", "REQ-6"],
          ["acc-api-1"],
        ),
        finding("BF-TEST2", "Zero test coverage for stop-generation behavior", ["REQ-5"], ["acc-api-5"]),
      ],
    },
    {
      round: 4,
      findings: [
        finding("BF-1", "getSettings() does not validate model, temperature, or maxTokens", ["REQ-9"], ["acc-api-4"]),
        finding(
          "BF-2",
          "Mid-stream network errors lose partial AI response content",
          ["REQ-2", "REQ-5"],
          ["acc-chat-3"],
        ),
        finding("BF-3", "Non-standard network errors bypass Chinese error messages", ["REQ-6"], ["acc-int-1"]),
      ],
    },
    {
      round: 5,
      findings: [
        finding("CONSENSUS-BF1", "Production build is broken - TypeScript TS2345 in api.test.ts", ["REQ-2"]),
        finding("CONSENSUS-BF2", "getSettings() does not validate persisted settings", ["REQ-9", "REQ-6"]),
        finding("CONSENSUS-BF3", "Invalid settings are never corrected and persisted back", ["REQ-9"]),
      ],
    },
    {
      round: 6,
      findings: [
        finding("SV-1", "getSettings() does not validate model against allowed list", ["REQ-9"]),
        finding("SV-2", "getSettings() does not validate temperature range [0, 2]", ["REQ-9"]),
        finding("SV-3", "getSettings() does not validate maxTokens range [1, 8192]", ["REQ-9"]),
      ],
    },
    {
      round: 7,
      findings: [
        finding(
          "BF-1-settings-validation",
          "getSettings() does not validate model, temperature, or maxTokens",
          ["REQ-9"],
          ["acc-api-4"],
        ),
      ],
    },
    {
      round: 8,
      findings: [
        finding("BF-1", "localStorage quota exceeded causes silent data loss", ["REQ-6", "REQ-3"]),
        finding("BF-2", "validateSettings() does not check for NaN", ["REQ-6", "REQ-9"]),
      ],
    },
  ],
}

function finding(id: string, title: string, requirementIDs: string[] = [], specIDs: string[] = []): ReplayFinding {
  return { id, title, severity: "blocking", requirementIDs, specIDs }
}

function replayWithTraceabilityDiscipline(fixture: typeof realTaskReplayFixture) {
  const requirements = new Map(fixture.requirements.map((requirement) => [requirement.id, requirement]))
  const droppedUntraced: string[] = []
  const underSpecifiedRequirementIDs = new Set<string>()
  const retained: ReplayFinding[] = []

  for (const attempt of fixture.attempts) {
    for (const finding of attempt.findings) {
      const quoteAnchors = finding.userRequestQuotes ?? []
      const hasAnchor = finding.requirementIDs.length > 0 || finding.specIDs.length > 0 || quoteAnchors.length > 0
      if (!hasAnchor) {
        droppedUntraced.push(`R${attempt.round}:${finding.id}`)
        continue
      }

      const boundedRequirementIDs = finding.requirementIDs.filter((id) => {
        const requirement = requirements.get(id)
        return Boolean(requirement?.acceptance.trim() || requirement?.non_goals.trim())
      })
      if (finding.requirementIDs.length > 0 && boundedRequirementIDs.length === 0) {
        for (const id of finding.requirementIDs) underSpecifiedRequirementIDs.add(id)
        continue
      }

      retained.push(finding)
    }
  }

  const maturityLanded = fixture.requirements.some((requirement) =>
    [requirement.description, requirement.acceptance, requirement.non_goals].some((text) => text.includes(matureQuote)),
  )
  if (!maturityLanded && fixture.userRequest.includes(matureQuote)) {
    retained.push({
      id: "requirements-maturity-scope",
      title: `Requirements stage did not land ${matureQuote} into bounded REQs`,
      severity: "blocking",
      requirementIDs: [],
      specIDs: [],
      userRequestQuotes: [matureQuote],
    })
  }

  return {
    source: {
      taskID: fixture.taskID,
      attempts: fixture.attempts.length,
      originalBlockingFindings: fixture.attempts.flatMap((attempt) => attempt.findings).length,
    },
    droppedUntracedCount: droppedUntraced.length,
    underSpecifiedRequirementIDs: [...underSpecifiedRequirementIDs].sort(),
    retainedBlockingFindings: retained.map((finding) => ({
      id: finding.id,
      title: finding.title,
      requirementIDs: finding.requirementIDs,
      specIDs: finding.specIDs,
      userRequestQuotes: finding.userRequestQuotes ?? [],
    })),
  }
}

describe("integrity replay scope discipline", () => {
  test("real task replay collapses untraced blockers into one requirements-scope finding", () => {
    const snapshot = replayWithTraceabilityDiscipline(realTaskReplayFixture)

    expect(snapshot.source).toEqual({
      taskID: "tsk_e54c2d091001t145QP2P6xwoqi",
      attempts: 8,
      originalBlockingFindings: 25,
    })
    expect(snapshot.droppedUntracedCount).toBe(5)
    expect(snapshot.retainedBlockingFindings.length).toBeLessThanOrEqual(2)
    expect(snapshot.retainedBlockingFindings).toEqual([
      {
        id: "requirements-maturity-scope",
        title: `Requirements stage did not land ${matureQuote} into bounded REQs`,
        requirementIDs: [],
        specIDs: [],
        userRequestQuotes: [matureQuote],
      },
    ])
  })
})
