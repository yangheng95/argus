import type { AcceptanceEvidenceDecision, AcceptanceManifestFunctionalAssessment } from "./manifest"

/**
 * Acceptance evidence decision semantics:
 *   - Blocking: runtime-readiness failures, acceptance-spec coverage gaps,
 *     and required contract-audit failures.
 *   - Advisory: required checks (build/typecheck/test/lint),
 *     workspace_export reviews, and specialist reviews.
 *
 * functionalAssessment.primaryFailureIds is the ground truth for the
 * blocking set; this helper just mirrors it. This keeps a single source of
 * truth for current acceptance evidence — see `assessFunctionalCompletion`
 * in `acceptance/checks/project-assessment.ts`. It must not be used as workflow control flow.
 */
export function arbitrateAcceptanceEvidenceDecision(input: {
  checks: AcceptanceEvidenceDecision
  failedReadinessIds?: string[]
  failedCoverageIds: string[]
  failedReviewIds?: string[]
  functionalAssessment: AcceptanceManifestFunctionalAssessment
}): AcceptanceEvidenceDecision {
  const failedReviewIds = input.failedReviewIds ?? []
  const status = input.functionalAssessment.primaryFailureIds.length === 0 ? "passed" : "failed"
  return {
    status,
    failedReadinessIds: input.failedReadinessIds ?? [],
    failedCheckIds: input.checks.failedCheckIds,
    failedCoverageIds: input.failedCoverageIds,
    failedReviewIds,
    functionalAssessment: input.functionalAssessment,
    summary: acceptanceEvidenceDecisionSummary({
      status,
      readiness: input.failedReadinessIds?.length ?? 0,
      checks: input.checks.failedCheckIds.length,
      coverage: input.failedCoverageIds.length,
      reviews: failedReviewIds.length,
      functionalAssessment: input.functionalAssessment,
    }),
  }
}

function acceptanceEvidenceDecisionSummary(input: {
  status: "passed" | "failed"
  readiness: number
  checks: number
  coverage: number
  reviews: number
  functionalAssessment: AcceptanceManifestFunctionalAssessment
}) {
  if (input.status === "passed") {
    return input.functionalAssessment.summary
  }
  const counts =
    `${input.readiness} readiness item(s), ${input.checks} required check(s), ${input.coverage} coverage item(s), ` +
    `and ${input.reviews} review item(s)`
  const primary = input.functionalAssessment.primaryFailureIds.join(", ") || "none"
  const auxiliary = input.functionalAssessment.auxiliaryFailureIds.join(", ") || "none"
  return `${input.functionalAssessment.summary} Evidence assessment failed ${counts}. Primary: ${primary}. Auxiliary: ${auxiliary}.`
}
