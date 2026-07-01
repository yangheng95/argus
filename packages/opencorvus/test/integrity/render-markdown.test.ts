import { expect, test } from "bun:test"
import { renderIntegrityMarkdown } from "../../src/integrity/render-markdown"
import type { IntegrityResult } from "../../src/integrity"

test("renderIntegrityMarkdown emits team findings, repairs, and disagreements", () => {
  const result: IntegrityResult = {
    verdict: "needs_correction",
    summary: "API contract and component reuse need repair",
    teamReportMarkdown: "Supervisor consensus: blocking API availability issue.",
    checkItems: [
      {
        id: "check-api",
        category: "runtime",
        target: "/api/new",
        question: "Is the requested API route callable?",
        status: "failed",
        expected: "/api/new returns a successful response.",
        observed: "curl /api/new returned 404.",
        evidence: ["curl /api/new returned 404"],
        requirementIDs: ["REQ-1"],
        specIDs: ["acc-api"],
        targetIDs: ["goal_api"],
        userRequestQuotes: [],
      },
      {
        id: "check-reuse",
        category: "code",
        target: "src/new-widget.tsx",
        question: "Does the implementation reuse SharedWidget?",
        status: "inconclusive",
        expected: "The requested widget reuses SharedWidget.",
        observed: "src/new-widget.tsx duplicates SharedWidget.",
        evidence: ["src/new-widget.tsx duplicates SharedWidget"],
        requirementIDs: [],
        specIDs: [],
        targetIDs: ["goal_ui"],
        userRequestQuotes: [],
      },
    ],
    reviewers: [
      {
        reviewerID: "api-reviewer",
        checkIDs: ["check-api"],
        scope: "API availability",
        verdict: "needs_correction",
        summary: "New API is not callable.",
        investigationPlan: {
          requestPromise: "Requested API route is callable.",
          hypothesis: "The route may not be registered.",
          evidencePlan: ["curl /api/new"],
          passCriteria: ["Route returns a successful response."],
        },
        evidence: [{ checkIDs: ["check-api"], note: "curl /api/new returned 404" }],
        openQuestions: [],
      },
      {
        reviewerID: "reuse-reviewer",
        checkIDs: ["check-reuse"],
        scope: "Component reuse",
        verdict: "concerns",
        summary: "A duplicate widget bypasses the shared component.",
        investigationPlan: {
          requestPromise: "New UI reuses the shared component.",
          hypothesis: "The implementation may duplicate the component.",
          evidencePlan: ["inspect src/new-widget.tsx"],
          passCriteria: ["The shared component is imported and reused."],
        },
        evidence: [{ checkIDs: ["check-reuse"], note: "src/new-widget.tsx duplicates SharedWidget" }],
        openQuestions: [],
      },
    ],
    findings: [
      {
        id: "api-unavailable",
        checkIDs: ["check-api"],
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
        checkIDs: ["check-api"],
        description: "Make /api/new callable.",
        evidence: ["curl /api/new returned 404"],
        targetIDs: ["goal_api"],
        filePaths: ["src/routes.ts"],
      },
    ],
    unresolvedDisagreements: [
      {
        id: "style-risk",
        checkIDs: ["check-api", "check-reuse"],
        description: "Reviewers disagreed whether style drift blocks completion.",
        reviewerIDs: ["api-reviewer", "reuse-reviewer"],
        consequence: "Supervisor kept it visible for orchestrator follow-up.",
      },
    ],
    coverageAudit: [],
    uninspectedRisks: [],
    fact_check_items: [],
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
