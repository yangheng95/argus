import {
  getSharedIntegrityPromptBudget,
  renderSharedIntegrityPromptContext,
} from "../../src/integrity/shared-prompt"
import type { IntegrityPriorAttemptSummary, SpecSnapshotLineage } from "../../src/integrity/replay-context"

const lineage: SpecSnapshotLineage = {
  taskID: "task_shared_prompt_cap",
  activeSpecSnapshotID: "spec_active",
  inheritedSpecSnapshotIDs: ["spec_prev_2", "spec_prev_1"],
  reason: "integrity_correction_lineage",
}

function attempt(input: Partial<IntegrityPriorAttemptSummary> & { attemptNumber: number }): IntegrityPriorAttemptSummary {
  return {
    attemptNumber: input.attemptNumber,
    artifactID: input.artifactID ?? `artifact_${input.attemptNumber}`,
    timeCreated: input.timeCreated ?? Date.UTC(2026, 4, 24, 1, input.attemptNumber),
    phase: input.phase ?? "post_build",
    verdict: input.verdict ?? "needs_correction",
    summary: input.summary ?? `summary ${input.attemptNumber}`,
    teamReportMarkdown: input.teamReportMarkdown,
    reviewers: input.reviewers ?? [],
    blockingFindings: input.blockingFindings ?? [],
    requiredRepairs: input.requiredRepairs ?? [],
    unresolvedDisagreements: input.unresolvedDisagreements ?? [],
  }
}

describe("shared integrity prompt cap", () => {
  test("keeps latest attempt, persistent roots, and changed evidence ahead of older attempt text", () => {
    const budget = getSharedIntegrityPromptBudget()
    const oldAttempts = Array.from({ length: 500 }, (_value, index) =>
      attempt({
        attemptNumber: index + 1,
        artifactID: `artifact_old_${index + 1}`,
        summary: `OLD_FULL_PROSE_${index + 1} ${"x".repeat(budget.oldAttemptSummaryCharCap * 2)}`,
      }),
    )
    const output = renderSharedIntegrityPromptContext({
      surface: "integrity_replay",
      lineage,
      latestAttempt: attempt({
        attemptNumber: 101,
        artifactID: "artifact_latest",
        summary: "Latest attempt summary.",
        teamReportMarkdown: "LATEST_FULL_REPORT",
        blockingFindings: [
          {
            id: "LATEST-BLOCKER",
            title: "Latest blocker survives cap",
            description: "Latest blocker description.",
            repair: "Latest blocker repair.",
            filePaths: ["src/latest.ts"],
            requirementIDs: ["REQ-1"],
            specIDs: ["SPEC-1"],
          },
        ],
      }),
      persistentRoots: [
        {
          rootID: "ROOT-1",
          canonicalLabel: "PERSISTENT_ROOT_LABEL",
          firstSeenAttempt: 10,
          latestSeenAttempt: 101,
          consecutiveAttempts: [99, 100, 101],
          latestSeverity: "blocking",
          symptomSummaryMarkdown: "Persistent root survives cap.",
        },
      ],
      changedFiles: ["src/current.ts"],
      changedEvidenceMarkdown: "Changed evidence survives cap.",
      oldAttempts,
    })

    expect(output.capHit).toBe(true)
    expect(output.promptMarkdown).toContain("LATEST_FULL_REPORT")
    expect(output.promptMarkdown).toContain("LATEST-BLOCKER")
    expect(output.promptMarkdown).toContain("PERSISTENT_ROOT_LABEL")
    expect(output.promptMarkdown).toContain("src/current.ts")
    expect(output.promptMarkdown).toContain("Changed evidence survives cap.")
    expect(output.promptMarkdown).not.toContain("OLD_FULL_PROSE_80")
    expect(output.omittedAttempts.some((item) => item.artifactID === "artifact_old_80")).toBe(true)

    expect(output.promptMarkdown.indexOf("LATEST_FULL_REPORT")).toBeLessThan(
      output.promptMarkdown.indexOf("PERSISTENT_ROOT_LABEL"),
    )
    expect(output.promptMarkdown.indexOf("PERSISTENT_ROOT_LABEL")).toBeLessThan(
      output.promptMarkdown.indexOf("src/current.ts"),
    )
  })
})
