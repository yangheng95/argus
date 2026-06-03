/**
 * Verification evidence module — thin read/write layer over `engine_artifact`
 * rows with kind="verification-evidence" (phase-6-b, specs/new-arch/16-unified-teardown.md §7-5).
 *
 * Signature-based convergence detection lives in src/metrics/arbiter.ts. This
 * module owns only the evidence artifact row. The legacy `engine_evaluation`
 * table was deleted in phase 6-b; evidence is now append-only in the artifact
 * stream and `findLatest*Evidence` helpers surface the newest row via
 * `time_created desc`. Public API unchanged — consumers did not churn.
 */
export {
  persistEvidence,
  findLatestAcceptanceEvidence,
  type VerificationEvidence,
  type PersistEvidenceInput,
} from "./persist"
export { queryEvidence, renderEvidence, type QueryEvidenceInput } from "./query"
