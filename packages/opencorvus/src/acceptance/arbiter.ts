import type { AcceptanceGateVerdict, AcceptanceManifestFunctionalAssessment } from "./manifest"

/**
 * Legacy acceptance evidence semantics:
 *   - Blocking: runtime-readiness failures, acceptance-spec coverage gaps,
 *     and required contract-audit failures.
 *   - Advisory: required checks (build/typecheck/test/lint),
 *     workspace_export reviews, and specialist reviews.
 *
 * functionalAssessment.primaryFailureIds is the ground truth for the
 * blocking set; this helper just mirrors it. This keeps a single source of
 * truth for historical acceptance evidence — see `assessFunctionalCompletion`
 * in `acceptance/checks/project-gate.ts`. It must not be used as a workflow
 * acceptance gate.
 */
export function arbitrateAcceptanceGate(input: {
  checks: AcceptanceGateVerdict
  failedReadinessIds?: string[]
  failedCoverageIds: string[]
  failedReviewIds?: string[]
  functionalAssessment: AcceptanceManifestFunctionalAssessment
}): AcceptanceGateVerdict {
  const failedReviewIds = input.failedReviewIds ?? []
  const status = input.functionalAssessment.primaryFailureIds.length === 0 ? "passed" : "failed"
  return {
    status,
    failedReadinessIds: input.failedReadinessIds ?? [],
    failedCheckIds: input.checks.failedCheckIds,
    failedCoverageIds: input.failedCoverageIds,
    failedReviewIds,
    functionalAssessment: input.functionalAssessment,
    summary: acceptanceGateSummary({
      status,
      readiness: input.failedReadinessIds?.length ?? 0,
      checks: input.checks.failedCheckIds.length,
      coverage: input.failedCoverageIds.length,
      reviews: failedReviewIds.length,
      functionalAssessment: input.functionalAssessment,
    }),
  }
}

function acceptanceGateSummary(input: {
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
  return `${input.functionalAssessment.summary} Evidence gate failed ${counts}. Primary: ${primary}. Auxiliary: ${auxiliary}.`
}
