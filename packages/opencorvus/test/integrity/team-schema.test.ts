import { expect, test } from "bun:test"
import { IntegrityReviewCompletedPayloadSchema } from "../../src/integrity"

const basePayload = {
  taskID: "tsk_schema",
  sessionID: "ses_schema",
  verdict: "pass",
  summary: "Team passed",
  teamReportMarkdown: "Team report",
  reviewers: [
    {
      reviewerID: "reviewer-a",
      scope: "A",
      verdict: "pass",
      summary: "A",
      evidence: [],
      findings: [],
      openQuestions: [],
    },
    {
      reviewerID: "reviewer-b",
      scope: "B",
      verdict: "pass",
      summary: "B",
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
      requiredRepairs: [{ id: "repair-1", description: "repair", evidence: ["e"], targetIDs: [], filePaths: [] }],
    }).success,
  ).toBe(false)

  expect(
    IntegrityReviewCompletedPayloadSchema.safeParse({
      ...basePayload,
      unresolvedDisagreements: [
        {
          id: "dispute-1",
          description: "dispute",
          reviewerIDs: ["reviewer-a", "reviewer-b"],
          consequence: "cannot pass",
        },
      ],
    }).success,
  ).toBe(false)
})
