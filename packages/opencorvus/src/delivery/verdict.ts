/**
 * Legacy delivery verdict exports.
 *
 * The schema is now owned by the neutral acceptance review contract so the
 * integrity final gate and the retired delivery path cannot drift.
 */
export {
  StartupVerification,
  FrontendCheck,
  AcceptanceEvidenceFacet as DeliveryEvidenceFacet,
  DeferredCheck,
  ToolCallEvidence,
  RejectionDetail,
  AcceptanceReviewVerdict as DeliveryVerdict,
  AcceptedAcceptanceVerdict as AcceptedVerdict,
  RejectedAcceptanceVerdict as RejectedVerdict,
  affectedGoalIDs,
  issuesFound,
} from "@/acceptance/review-verdict"

export type {
  AcceptanceEvidenceFacetType as DeliveryEvidenceFacetType,
  DeferredCheckType,
  ToolCallEvidenceType,
  RejectionDetailType,
  AcceptedAcceptanceVerdictType as AcceptedVerdictType,
  RejectedAcceptanceVerdictType as RejectedVerdictType,
  AcceptanceReviewVerdictType as DeliveryVerdictType,
} from "@/acceptance/review-verdict"
