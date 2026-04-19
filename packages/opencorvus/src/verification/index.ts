/**
 * Verification evidence module — spec-09 entry.
 * See specs/new-arch/09-verification-evidence.md.
 */
export {
  computeSignature,
  outputDigest,
  signaturesConverge,
} from "./signature"
export {
  persistEvidence,
  findLatestGoalRunEvidence,
  findGoalRunEvidence,
  findLatestDeliveryEvidence,
  findPreviousDeliveryEvidence,
  hasStrictFailure,
  strictFailures,
  type VerificationEvidence,
  type PersistEvidenceInput,
} from "./persist"
export { queryEvidence, renderEvidence, type QueryEvidenceInput } from "./query"
