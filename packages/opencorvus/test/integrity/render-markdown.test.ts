import { expect, test } from "bun:test"
import { renderIntegrityMarkdown } from "../../src/integrity/render-markdown"
import type { IntegrityResult } from "../../src/integrity"

test("renderIntegrityMarkdown emits team findings, repairs, and disagreements", () => {
  const result: IntegrityResult = {
    verdict: "needs_correction",
    summary: "API contract and component reuse need repair",
    teamReportMarkdown: "Supervisor consensus: blocking API availability issue.",
    reviewers: [
      {
        reviewerID: "api-reviewer",
        scope: "API availability",
        verdict: "needs_correction",
        summary: "New API is not callable.",
        evidence: ["curl /api/new returned 404"],
        findings: [],
        openQuestions: [],
      },
      {
        reviewerID: "reuse-reviewer",
        scope: "Component reuse",
        verdict: "concerns",
        summary: "A duplicate widget bypasses the shared component.",
        evidence: ["src/new-widget.tsx duplicates SharedWidget"],
        findings: [],
        openQuestions: [],
      },
    ],
    findings: [
      {
        id: "api-unavailable",
        severity: "blocking",
        verdictImpact: "needs_correction",
        title: "New API is unavailable",
        description: "The requested API route is not registered.",
        evidence: ["curl /api/new returned 404"],
        targetIDs: ["goal_api"],
        requirementIDs: ["REQ-1"],
        specIDs: ["acc-api"],
        filePaths: ["src/routes.ts"],
        repair: "Register the API route and prove it with a runtime request.",
        reviewers: ["api-reviewer"],
        consensus: "agreed",
      },
    ],
    rounds: [],
    requiredRepairs: [
      {
        id: "repair-api-route",
        description: "Make /api/new callable.",
        evidence: ["curl /api/new returned 404"],
        targetIDs: ["goal_api"],
        filePaths: ["src/routes.ts"],
      },
    ],
    unresolvedDisagreements: [
      {
        id: "style-risk",
        description: "Reviewers disagreed whether style drift blocks completion.",
        reviewerIDs: ["api-reviewer", "reuse-reviewer"],
        consequence: "Supervisor kept it visible for orchestrator follow-up.",
      },
    ],
    issues: [],
    corrections: [],
    graphCorrections: [],
    missingGoals: [],
  }

  const md = renderIntegrityMarkdown({ verdict: result, sessionID: "ses_team" })
  expect(md).toContain("Integrity team review")
  expect(md).toContain("api-reviewer")
  expect(md).toContain("api-unavailable")
  expect(md).toContain("repair-api-route")
  expect(md).toContain("style-risk")
})
