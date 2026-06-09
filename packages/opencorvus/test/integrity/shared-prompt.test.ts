import {
  getSharedIntegrityPromptBudget,
  renderSharedIntegrityPromptContext,
  sanitizeIntegrityPromptText,
} from "../../src/integrity/shared-prompt"
import type { IntegrityPriorAttemptSummary, SpecSnapshotLineage } from "../../src/integrity/replay-context"

const lineage: SpecSnapshotLineage = {
  taskID: "task_shared_prompt_cap",
  activeSpecSnapshotID: "spec_active",
  inheritedSpecSnapshotIDs: ["spec_prev_2", "spec_prev_1"],
  reason: "integrity_correction_lineage",
}

function attempt(
  input: Partial<IntegrityPriorAttemptSummary> & { attemptNumber: number },
): IntegrityPriorAttemptSummary {
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
      changedDirectories: ["src"],
      changedEvidenceMarkdown: "Changed evidence survives cap.",
      oldAttempts,
    })

    expect(output.capHit).toBe(true)
    expect(output.promptMarkdown).not.toContain("LATEST_FULL_REPORT")
    expect(output.promptMarkdown).toContain("Team report: omitted from replay prompt")
    expect(output.promptMarkdown).toContain("LATEST-BLOCKER")
    expect(output.promptMarkdown).toContain("PERSISTENT_ROOT_LABEL")
    expect(output.promptMarkdown).toContain("src")
    expect(output.promptMarkdown).toContain("Changed evidence survives cap.")
    expect(output.promptMarkdown).not.toContain("OLD_FULL_PROSE_80")
    expect(output.omittedAttempts.some((item) => item.artifactID === "artifact_old_80")).toBe(true)

    expect(output.promptMarkdown.indexOf("Team report: omitted from replay prompt")).toBeLessThan(
      output.promptMarkdown.indexOf("PERSISTENT_ROOT_LABEL"),
    )
    expect(output.promptMarkdown.indexOf("PERSISTENT_ROOT_LABEL")).toBeLessThan(
      output.promptMarkdown.indexOf("Changed evidence survives cap."),
    )
  })

  test("sanitizes ANSI, bidi controls, control bytes, markdown injection, and field lengths", () => {
    const report = sanitizeIntegrityPromptText({
      text: "\u001B[31m# injected heading\u001B[0m\n\u202Ertl\x00\x01\n```\n<script>alert(1)</script>\n---",
      field: "reviewer_text",
      markdownContext: "block",
    })

    expect(report.text).not.toContain("\u001B")
    expect(report.text).toContain("\\# injected heading")
    expect(report.text).toContain("[BIDI U+202E REMOVED]")
    expect(report.text).toContain("[NUL REMOVED]")
    expect(report.text).toContain("[CTRL U+0001 REMOVED]")
    expect(report.text).toContain("\\```")
    expect(report.text).toContain("\\<script>alert(1)</script>")
    expect(report.text).toContain("\\---")
    expect(report.removedAnsiEscapes).toBe(2)
    expect(report.removedControls).toBe(2)
    expect(report.removedBidirectionalControls).toBe(1)
    expect(report.escapedMarkdownControls).toBe(4)

    const truncated = sanitizeIntegrityPromptText({
      text: "a".repeat(20),
      field: "generic",
      maxChars: 10,
      markdownContext: "inline",
    })
    expect(truncated.truncated).toBe(true)
    expect(truncated.text).toHaveLength(10)
  })

  test("changed directory evidence does not render file-level paths when callers pass files", () => {
    const output = renderSharedIntegrityPromptContext({
      surface: "severity_context",
      lineage,
      changedDirectories: ["src/features/orders/OrdersPage.tsx", "src/shared"],
      oldAttempts: [],
    })

    expect(output.promptMarkdown).toContain("src/features/orders")
    expect(output.promptMarkdown).toContain("src/shared")
    expect(output.promptMarkdown).not.toContain("OrdersPage.tsx")
  })

  test("does not truncate user request quotes by default", () => {
    const longRequest = [
      "# full user request",
      ...Array.from({ length: 2600 }, (_value, index) => `word${index}`),
    ].join(" ")

    const report = sanitizeIntegrityPromptText({
      text: longRequest,
      field: "user_request_quote",
      markdownContext: "block",
    })

    expect(report.truncated).toBe(false)
    expect(report.text).toContain("word2599")
    expect(report.text).not.toContain("truncated_by_integrity_prompt_sanitizer")
    expect(report.text).toContain("\\# full user request")
  })

  test("applies sanitizer to user quotes, prior attempt summaries, and finding evidence before capping", () => {
    const output = renderSharedIntegrityPromptContext({
      surface: "integrity_replay",
      lineage,
      latestAttempt: attempt({
        attemptNumber: 3,
        summary: "# prior summary\n\u202E",
        blockingFindings: [
          {
            id: "F-1",
            title: "Malicious evidence",
            description: "\u001B[31m# finding evidence\u001B[0m",
            repair: "<script>repair()</script>",
            filePaths: [],
            requirementIDs: [],
            specIDs: [],
          },
        ],
      }),
      changedDirectories: ["src"],
      changedEvidenceMarkdown: "```changed evidence",
      oldAttempts: [
        attempt({
          attemptNumber: 2,
          summary: "# older summary",
        }),
      ],
      userRequestQuotes: ["# user request quote"],
      reviewerTextBlocks: ["---"],
    })

    expect(output.promptMarkdown).not.toContain("\u001B")
    expect(output.promptMarkdown).toContain("\\# prior summary")
    expect(output.promptMarkdown).toContain("[BIDI U+202E REMOVED]")
    expect(output.promptMarkdown).toContain("\\# finding evidence")
    expect(output.promptMarkdown).toContain("\\<script>repair()</script>")
    expect(output.promptMarkdown).toContain("\\```changed evidence")
    expect(output.promptMarkdown).toContain("\\# older summary")
    expect(output.promptMarkdown).toContain("\\# user request quote")
    expect(output.promptMarkdown).toContain("\\---")
    expect(output.sanitizerReport.removedAnsiEscapes).toBe(2)
    expect(output.sanitizerReport.removedBidirectionalControls).toBe(1)
    expect(output.sanitizerReport.escapedMarkdownControls).toBeGreaterThanOrEqual(6)
  })
})
