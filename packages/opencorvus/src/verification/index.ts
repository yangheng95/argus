/**
 * Verification evidence module — thin DB layer over `engine_evaluation`.
 *
 * Signature-based convergence detection was removed with DAM Phase 5 —
 * convergence now lives in src/metrics/arbiter.ts. Post-unified-teardown
 * Phase 5-f / Phase 6 (specs/new-arch/16-unified-teardown.md §7-5) the
 * backing table (`engine_evaluation`) is scheduled for deletion and
 * evidence moves to the artifact stream. This module's public API stays
 * stable through that migration; see persist.ts for the cutover plan.
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
