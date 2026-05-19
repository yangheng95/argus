import type { VisualMetricResult } from "./visual-metric"
import type { RuntimeEvidenceReport } from "./checks/runtime-evidence"
import type { DeliveryEvidenceManifest, DeliveryGateVerdict, DeliveryManifestFunctionalAssessment } from "./manifest"
import type { DeliveryVerdictType } from "./verdict"

/**
 * Delivery gate semantics:
 *   - Blocking: runtime-readiness failures, acceptance-spec coverage gaps,
 *     failed runtime probes, and required contract-audit failures.
 *   - Advisory: required checks (build/typecheck/test/lint),
 *     workspace_export reviews, and specialist reviews.
 *
 * functionalAssessment.primaryFailureIds is the ground truth for the
 * blocking set; the gate just mirrors it. This keeps a single source of
 * truth for "what blocks delivery" — see `assessFunctionalCompletion` in
 * `delivery/checks/project-gate.ts`. This function is a pure host data gate
 * (rule 6.1 data-integrity exception) and is intentionally left untouched by
 * the fresh-eyes decoupling — see specs/delivery-fresh-eyes-decoupling-2026-05-18.md.
 */
export function arbitrateDeliveryGate(input: {
  checks: DeliveryGateVerdict
  failedReadinessIds?: string[]
  failedCoverageIds: string[]
  failedRuntimeFlowIds?: string[]
  failedReviewIds?: string[]
  functionalAssessment: DeliveryManifestFunctionalAssessment
}): DeliveryGateVerdict {
  const failedRuntimeFlowIds = input.failedRuntimeFlowIds ?? []
  const failedReviewIds = input.failedReviewIds ?? []
  const status = input.functionalAssessment.primaryFailureIds.length === 0 ? "passed" : "failed"
  return {
    status,
    failedReadinessIds: input.failedReadinessIds ?? [],
    failedCheckIds: input.checks.failedCheckIds,
    failedCoverageIds: input.failedCoverageIds,
    failedRuntimeFlowIds,
    failedReviewIds,
    functionalAssessment: input.functionalAssessment,
    summary: deliveryGateSummary({
      status,
      readiness: input.failedReadinessIds?.length ?? 0,
      checks: input.checks.failedCheckIds.length,
      coverage: input.failedCoverageIds.length,
      runtime: failedRuntimeFlowIds.length,
      reviews: failedReviewIds.length,
      functionalAssessment: input.functionalAssessment,
    }),
  }
}

function deliveryGateSummary(input: {
  status: "passed" | "failed"
  readiness: number
  checks: number
  coverage: number
  runtime: number
  reviews: number
  functionalAssessment: DeliveryManifestFunctionalAssessment
}) {
  if (input.status === "passed") {
    return input.functionalAssessment.summary
  }
  const counts =
    `${input.readiness} readiness item(s), ${input.checks} required check(s), ${input.coverage} coverage item(s), ` +
    `${input.runtime} runtime flow(s), and ${input.reviews} review item(s)`
  const primary = input.functionalAssessment.primaryFailureIds.join(", ") || "none"
  const auxiliary = input.functionalAssessment.auxiliaryFailureIds.join(", ") || "none"
  return `${input.functionalAssessment.summary} Evidence gate failed ${counts}. Primary: ${primary}. Auxiliary: ${auxiliary}.`
}

// ---------------------------------------------------------------------------
// Fresh-eyes delivery decision (specs/delivery-host-gate-deblocking-2026-05-19.md)
//
// The host deterministic gate and the fresh-eyes DeliveryAgent decide different
// questions:
//   - host gate: objective evidence packet for runtime/readiness/visual facts.
//   - DeliveryAgent: the only final delivery verdict author.
//
// `composeDeliveryDecision` is the SINGLE pure projector. It never mutates the
// agent verdict and never injects host evidence into it. The host gate result
// and the raw agent verdict are persisted as evidence; only `final` is business
// consumable.
// ---------------------------------------------------------------------------

export type HostGateFailureGroup = {
  kind: "manifest" | "runtime" | "visual"
  id: string
  summary: string
  evidence: string[]
}

export type HostGateResult = {
  /** Composite host evidence result. Advisory for final delivery authority. */
  passed: boolean
  manifest: DeliveryEvidenceManifest
  runtimeReport?: RuntimeEvidenceReport
  visualMetric?: VisualMetricResult | null
  /** Pre-grouped host evidence failures (manifest/runtime/visual). Empty when passed. */
  failures: HostGateFailureGroup[]
}

export type DeliveryDecision = {
  /** The ONLY business-consumable verdict. Persisted under the compatibility
   *  label `delivery-agent-verdict` so every existing reader keeps working
   *  unchanged; its CONTENT is this composed final, not a raw agent verdict. */
  final: DeliveryVerdictType
  /** Raw agent verdict, persisted as evidence under `delivery-agent-raw-verdict`. */
  rawAgentVerdict: DeliveryVerdictType
  /** Host deterministic gate — evidence only. Persisted under
   *  `delivery-host-gate`. */
  hostGate: HostGateResult
  source: "llm"
}

/**
 * The single delivery-decision projector. Pure, no side effects, no mutation
 * of the agent verdict.
 *
 * Host evidence never authors the business verdict. `final` is the agent
 * verdict verbatim; host evidence is kept on `hostGate` for UI/debug/retry
 * context.
 */
export function composeDeliveryDecision(input: {
  hostGate: HostGateResult
  agentVerdict?: DeliveryVerdictType
}): DeliveryDecision {
  if (!input.agentVerdict) {
    throw new Error(
      "composeDeliveryDecision: no agent verdict was supplied — delivery cannot finalize from host evidence.",
    )
  }
  return {
    final: input.agentVerdict,
    rawAgentVerdict: input.agentVerdict,
    hostGate: input.hostGate,
    source: "llm",
  }
}
