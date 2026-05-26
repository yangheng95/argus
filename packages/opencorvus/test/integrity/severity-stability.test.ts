import { expect, test } from "bun:test"
import TEAM_CORE from "../../src/prompt/core/integrity-team-core.txt"
import { buildReviewerPrompt, type ReviewPromptInput } from "../../src/integrity/team-agent"

function r7ToR8PromptInput(): ReviewPromptInput {
  return {
    userRequest: "写一个成熟的输入 deepseek key 即可聊天的 ai chat 页面",
    taskTitle: "DeepSeek chat page",
    goals: [
      {
        id: "goal_storage",
        title: "Chat storage",
        objective: "Persist conversations for normal chat flow.",
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
        description: "Conversations persist locally across page refresh.",
        acceptance: "A normal saved conversation reappears after refresh.",
        non_goals: "Browser quota exhaustion hardening is not a bounded REQ.",
      },
    ],
    replayContext: {
      attemptNumber: 8,
      lineage: {
        taskID: "tsk_e54c2d091001t145QP2P6xwoqi",
        activeSpecSnapshotID: "spec_r8",
        inheritedSpecSnapshotIDs: ["spec_r7"],
        reason: "integrity_correction_lineage",
      },
      priorFactCheckAttempts: [],
      priorAttempts: [
        {
          attemptNumber: 7,
          artifactID: "art_r7",
          timeCreated: Date.UTC(2026, 4, 23, 14, 0),
          phase: "post_build",
          verdict: "concerns",
          summary: "R7 kept quota handling advisory.",
          reviewers: [{ reviewerID: "rev_storage", scope: "Storage resilience", verdict: "concerns" }],
          findings: [
            {
              id: "ADV-3-silent-quota-error",
              severity: "advisory",
              verdictImpact: "concerns",
              title: "safeSetItem silently swallows QuotaExceededError",
              description: "safeSetItem() silently swallows QuotaExceededError without user notification.",
              repair: "Consider surfacing quota exhaustion as a non-blocking warning.",
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
        sinceAttemptNumber: 7,
        sinceTimeCreated: Date.UTC(2026, 4, 23, 14, 0),
        changedFiles: [],
        diffs: [],
        buildSummaries: ["No storage surface changed after R7."],
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

test("R7 to R8 same quota finding prompt keeps advisory promotion barred without new evidence", () => {
  const input = r7ToR8PromptInput()
  const prompt = [
    TEAM_CORE,
    buildReviewerPrompt(input, {
      reviewerID: "rev_r8_storage",
      title: "R8 storage reviewer",
      focus: "Re-check localStorage quota handling",
      adversarialQuestions: ["Can the R7 advisory quota issue be promoted without post-R7 evidence?"],
    }),
  ].join("\n\n")

  expect(prompt).toContain("## Severity Discipline")
  expect(prompt).toContain("ADV-3-silent-quota-error")
  expect(prompt).toContain("[advisory] ADV-3-silent-quota-error")
  expect(prompt).toContain("Shared Prompt Context (severity_context)")
  expect(prompt).toContain("active_spec_snapshot=spec_r8")
  expect(prompt).toContain("inherited_spec_snapshots=spec_r7")
  expect(prompt).toContain("Changed directories: (none)")
  expect(prompt).toContain("code lines on the same defect surface changed after the prior attempt")
  expect(prompt).toContain("a new explicit REQ row was added after the prior attempt")
  expect(prompt).toContain("newly executed runtime observation")
  expect(prompt).toContain("A deeper reading of the same unchanged code")
  expect(prompt).toContain("More precise prose over the same")
  expect(prompt).toContain("evidence is NOT new evidence")
  expect(prompt).toContain("Persistence alone is NOT promotion")
})
