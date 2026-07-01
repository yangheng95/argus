import { expect, test } from "bun:test"
import { asSchema } from "ai"
import {
  IntegrityReviewCompletedPayloadSchema,
  IntegrityReviewerPlanSchema,
  IntegrityReviewerReportSchema,
  IntegrityTeamReportSchema,
} from "../../src/integrity"

const reviewerInvestigationPlan = {
  requestPromise: "ship the requested behavior",
  hypothesis: "the scoped behavior may be incomplete",
  evidencePlan: ["inspect scoped evidence"],
  passCriteria: ["scoped evidence proves the requested behavior"],
}

const baseCheckItem = {
  id: "check-schema",
  category: "requirement",
  target: "schema payload",
  question: "Does the schema payload represent a reviewed requirement?",
  status: "passed",
  expected: "The report includes an explicit registered check item.",
  observed: "The schema fixture registers check-schema and cites it from report rows.",
  evidence: ["schema fixture evidence"],
  requirementIDs: ["REQ-schema"],
  specIDs: [],
  targetIDs: [],
  userRequestQuotes: ["ship the requested behavior"],
}

const basePayload = {
  taskID: "tsk_schema",
  sessionID: "ses_schema",
  verdict: "pass",
  summary: "Team passed",
  teamReportMarkdown: "Team report",
  checkItems: [baseCheckItem],
  reviewers: [
    {
      reviewerID: "reviewer-a",
      checkIDs: ["check-schema"],
      scope: "A",
      verdict: "pass",
      summary: "A",
      investigationPlan: reviewerInvestigationPlan,
      evidence: [],
      openQuestions: [],
    },
    {
      reviewerID: "reviewer-b",
      checkIDs: ["check-schema"],
      scope: "B",
      verdict: "pass",
      summary: "B",
      investigationPlan: reviewerInvestigationPlan,
      evidence: [],
      openQuestions: [],
    },
  ],
  findings: [],
  rounds: [],
  requiredRepairs: [],
  unresolvedDisagreements: [],
  fact_check_items: [],
  attempts: 1,
}

test("integrity completed payload rejects old fixed-dimension and acceptance fields", () => {
  expect(IntegrityReviewCompletedPayloadSchema.safeParse(basePayload).success).toBe(true)
  expect(IntegrityReviewCompletedPayloadSchema.safeParse({ ...basePayload, attempts: 2 }).success).toBe(true)

  for (const key of ["dimensions", "per_dimension", "perDimension", "acceptance"]) {
    const payload = { ...basePayload, [key]: [] }
    expect(IntegrityReviewCompletedPayloadSchema.safeParse(payload).success).toBe(false)
  }
})

test("integrity completed payload cannot pass with required repairs or unresolved disagreements", () => {
  expect(
    IntegrityReviewCompletedPayloadSchema.safeParse({
      ...basePayload,
      requiredRepairs: [
        {
          id: "repair-1",
          checkIDs: ["check-schema"],
          description: "repair",
          evidence: ["e"],
          targetIDs: [],
          filePaths: [],
        },
      ],
    }).success,
  ).toBe(false)

  expect(
    IntegrityReviewCompletedPayloadSchema.safeParse({
      ...basePayload,
      unresolvedDisagreements: [
        {
          id: "dispute-1",
          checkIDs: ["check-schema"],
          description: "dispute",
          reviewerIDs: ["reviewer-a", "reviewer-b"],
          consequence: "cannot pass",
        },
      ],
    }).success,
  ).toBe(false)
})

test("integrity schemas carry dynamic audit strategy and coverage evidence", () => {
  const plan = IntegrityReviewerPlanSchema.parse({
    rationale: "Task-specific risks need scoped reviewers.",
    taskProfile: {
      categories: ["migration", "frontend"],
      requestCriticalPromises: ["reuse existing components", "wire real API"],
      changedSurfaces: ["src/features/orders"],
      availableEvidenceSurfaces: ["changed_directories", "goal_summary"],
    },
    riskHypotheses: [
      {
        id: "risk-api",
        title: "API integration may be mocked",
        whyRelevantToRequest: "The request asks for real integration.",
        evidenceNeeded: ["diff_for_file", "runtime command"],
        suggestedReviewerID: "rev-api",
      },
    ],
    coveragePlan: ["Cover each user promise before consensus."],
    reviewers: [
      {
        reviewerID: "rev-api",
        title: "API reviewer",
        focus: "Real API integration",
        riskHypothesisIDs: ["risk-api"],
        drilldownPlan: ["inspect changed directory then exact API diff"],
        adversarialQuestions: ["Is the API still mocked?"],
      },
      {
        reviewerID: "rev-ui",
        title: "UI reviewer",
        focus: "Visual/component reuse",
        riskHypothesisIDs: [],
        drilldownPlan: ["inspect component directories"],
        adversarialQuestions: ["Were existing components reused?"],
      },
    ],
  })
  expect(plan.riskHypotheses[0]?.id).toBe("risk-api")
  expect(plan.reviewers[0]?.drilldownPlan).toEqual(["inspect changed directory then exact API diff"])

  const reviewer = IntegrityReviewerReportSchema.parse({
    reviewerID: "rev-api",
    checkIDs: ["check-schema"],
    scope: "Real API integration",
    verdict: "pass",
    summary: "API integration is backed by the real client.",
    investigationPlan: {
      requestPromise: "wire real API",
      hypothesis: "implementation may still use mock data",
      evidencePlan: ["inspect diff_for_file for src/features/orders/api.ts"],
      passCriteria: ["real client imported and exercised"],
    },
    drilldowns: [
      {
        checkIDs: ["check-schema"],
        kind: "diff_for_file",
        target: "src/features/orders/api.ts",
        purpose: "Check mock replacement",
        result: "real client imported",
      },
    ],
    coverage: [
      {
        checkIDs: ["check-schema"],
        userRequestQuote: "wire real API",
        status: "covered",
        evidence: "diff shows real client path",
      },
    ],
    evidence: [{ checkIDs: ["check-schema"], note: "Scoped diff inspected." }],
    openQuestions: [],
  })
  expect(reviewer.coverage[0]?.status).toBe("covered")

  const team = IntegrityTeamReportSchema.parse({
    verdict: "pass",
    summary: "Covered critical request promises.",
    teamReportMarkdown: "pass",
    checkItems: [baseCheckItem],
    reviewers: [reviewer, { ...reviewer, reviewerID: "rev-ui", scope: "UI", summary: "UI covered" }],
    coverageAudit: [
      {
        checkIDs: ["check-schema"],
        promise: "wire real API",
        reviewerIDs: ["rev-api"],
        status: "covered",
        notes: "Scoped diff and runtime evidence inspected.",
      },
    ],
    uninspectedRisks: [],
    findings: [],
    rounds: [],
    requiredRepairs: [],
    unresolvedDisagreements: [],
    fact_check_items: [],
  })
  expect(team.coverageAudit[0]?.promise).toBe("wire real API")

  const teamWithoutFactCheckItems = IntegrityTeamReportSchema.parse({
    ...team,
    fact_check_items: undefined,
  })
  expect(teamWithoutFactCheckItems.fact_check_items).toEqual([])
})

test("integrity reviewer report requires a complete investigation plan", () => {
  const validReport = {
    reviewerID: "reviewer-a",
    checkIDs: ["check-schema"],
    scope: "API authority",
    verdict: "pass",
    summary: "API authority was inspected.",
    investigationPlan: reviewerInvestigationPlan,
    drilldowns: [
      {
        checkIDs: ["check-schema"],
        kind: "diff_for_file",
        target: "src/api.ts",
        purpose: "Check dispatch authority",
        result: "Dispatch uses SdkAdapter.",
      },
    ],
    coverage: [
      {
        checkIDs: ["check-schema"],
        requirementID: "REQ-1",
        status: "covered",
        evidence: "Dispatch authority inspected.",
      },
    ],
    evidence: [{ checkIDs: ["check-schema"], note: "Inspected changed files." }],
    openQuestions: [],
  }

  expect(IntegrityReviewerReportSchema.safeParse(validReport).success).toBe(true)
  expect(
    IntegrityReviewerReportSchema.safeParse({
      ...validReport,
      findings: [],
    }).success,
  ).toBe(false)

  const withoutPlan = IntegrityReviewerReportSchema.safeParse({
    ...validReport,
    investigationPlan: undefined,
  })
  expect(withoutPlan.success).toBe(false)
  if (!withoutPlan.success) {
    expect(withoutPlan.error.issues.some((issue) => issue.path.join(".") === "investigationPlan")).toBe(true)
  }

  const withoutRequestPromise = IntegrityReviewerReportSchema.safeParse({
    ...validReport,
    investigationPlan: {
      hypothesis: "the scoped behavior may be incomplete",
      evidencePlan: ["inspect scoped evidence"],
      passCriteria: ["scoped evidence proves the requested behavior"],
    },
  })
  expect(withoutRequestPromise.success).toBe(false)
  if (!withoutRequestPromise.success) {
    expect(
      withoutRequestPromise.error.issues.some((issue) => issue.path.join(".") === "investigationPlan.requestPromise"),
    ).toBe(true)
  }
})

test("integrity team JSON schema exposes reviewer investigation plan as required", () => {
  const schema = asSchema(IntegrityTeamReportSchema as never).jsonSchema as any
  const reviewerSchema = schema.properties.reviewers.items

  expect(reviewerSchema.required).toContain("investigationPlan")
  expect(reviewerSchema.properties.investigationPlan.required).toContain("requestPromise")
  expect(reviewerSchema.properties.investigationPlan.properties.requestPromise.description).toContain(
    "Concrete original user",
  )
})

test("integrity coverage audit status rejects verdict enums such as concerns", () => {
  const payload = {
    verdict: "concerns",
    summary: "Coverage has concerns.",
    teamReportMarkdown: "concerns",
    checkItems: [baseCheckItem],
    reviewers: basePayload.reviewers,
    coverageAudit: [
      {
        checkIDs: ["check-schema"],
        promise: "API names from authority only",
        reviewerIDs: ["reviewer-a"],
        status: "concerns",
        notes: "This is a verdict value and must not be used as coverage status.",
      },
    ],
    uninspectedRisks: [],
    findings: [],
    rounds: [],
    requiredRepairs: [],
    unresolvedDisagreements: [],
    fact_check_items: [],
  }

  const parsed = IntegrityTeamReportSchema.safeParse(payload)

  expect(parsed.success).toBe(false)
  if (!parsed.success) {
    expect(parsed.error.issues.some((issue) => issue.path.join(".") === "coverageAudit.0.status")).toBe(true)
  }
})

test("integrity reviewer coverage rejects finding traceability field names", () => {
  const parsed = IntegrityReviewerReportSchema.safeParse({
    reviewerID: "reviewer-a",
    checkIDs: ["check-schema"],
    scope: "API authority",
    verdict: "concerns",
    summary: "API authority has a gap.",
    investigationPlan: reviewerInvestigationPlan,
    drilldowns: [],
    coverage: [
      {
        checkIDs: ["check-schema"],
        requirementIDs: ["REQ-1"],
        status: "missing",
        evidence: "The row uses finding traceability fields instead of coverage anchors.",
      },
    ],
    evidence: [{ checkIDs: ["check-schema"], note: "Inspected changed files." }],
    openQuestions: [],
  })

  expect(parsed.success).toBe(false)
  if (!parsed.success) {
    expect(parsed.error.issues.some((issue) => issue.message.includes("requirementIDs"))).toBe(true)
    expect(parsed.error.issues.some((issue) => issue.path.join(".") === "coverage.0")).toBe(true)
  }
})

test("integrity reviewer drilldowns reject finding-only fields", () => {
  const parsed = IntegrityReviewerReportSchema.safeParse({
    reviewerID: "reviewer-a",
    checkIDs: ["check-schema"],
    scope: "API authority",
    verdict: "pass",
    summary: "API authority was inspected.",
    investigationPlan: reviewerInvestigationPlan,
    drilldowns: [
      {
        checkIDs: ["check-schema"],
        kind: "diff_for_file",
        target: "src/api.ts",
        purpose: "Check dispatch authority",
        result: "Dispatch uses SdkAdapter.",
        affectedSymbols: ["dispatch"],
      },
    ],
    coverage: [
      {
        checkIDs: ["check-schema"],
        requirementID: "REQ-1",
        status: "covered",
        evidence: "Dispatch authority inspected.",
      },
    ],
    evidence: [{ checkIDs: ["check-schema"], note: "Inspected changed files." }],
    openQuestions: [],
  })

  expect(parsed.success).toBe(false)
  if (!parsed.success) {
    expect(parsed.error.issues.some((issue) => issue.message.includes("affectedSymbols"))).toBe(true)
    expect(parsed.error.issues.some((issue) => issue.path.join(".") === "drilldowns.0")).toBe(true)
  }
})
