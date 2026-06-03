/**
 * Legacy acceptance verdict exports.
 *
 * The schema is now owned by the neutral acceptance review contract so the
 * integrity final gate and the retired acceptance path cannot drift.
 */
export {
  StartupVerification,
  FrontendCheck,
  AcceptanceEvidenceFacet as AcceptanceEvidenceFacet,
  DeferredCheck,
  ToolCallEvidence,
  RejectionDetail,
  AcceptanceReviewVerdict as AcceptanceVerdict,
  AcceptedAcceptanceVerdict as AcceptedVerdict,
  RejectedAcceptanceVerdict as RejectedVerdict,
  affectedGoalIDs,
  issuesFound,
} from "@/acceptance/review-verdict"

export type {
  AcceptanceEvidenceFacetType as AcceptanceEvidenceFacetType,
  DeferredCheckType,
  ToolCallEvidenceType,
  RejectionDetailType,
  AcceptedAcceptanceVerdictType as AcceptedVerdictType,
  RejectedAcceptanceVerdictType as RejectedVerdictType,
  AcceptanceReviewVerdictType as AcceptanceVerdictType,
} from "@/acceptance/review-verdict"
