/**
 * Verification evidence module — thin DB layer over `engine_evaluation`.
 * Signature-based convergence detection was removed with DAM Phase 5 —
 * convergence now lives in src/metrics/arbiter.ts.
 */
export {
  persistEvidence,
  findLatestGoalRunEvidence,
  findGoalRunEvidence,
  findLatestDeliveryEvidence,
  findPreviousDeliveryEvidence,
  type VerificationEvidence,
  type PersistEvidenceInput,
} from "./persist"
export { queryEvidence, renderEvidence, type QueryEvidenceInput } from "./query"
