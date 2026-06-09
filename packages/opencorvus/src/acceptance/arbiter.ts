import type { VisualMetricResult } from "./visual-metric"
import type {
  AcceptanceEvidenceManifest,
  AcceptanceGateVerdict,
  AcceptanceManifestFunctionalAssessment,
} from "./manifest"
import type { AcceptanceVerdictType, RejectedVerdictType, DeferredCheckType, ToolCallEvidenceType } from "./verdict"

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

// ---------------------------------------------------------------------------
// Legacy acceptance decision projector (specs/acceptance-fresh-eyes-decoupling-2026-05-18.md)
//
// Retained for historical acceptance evidence rows and tests only. New workflow
// acceptance lives in the integrity review session; no host acceptance checker or
// acceptance-owned LLM session may be started from this module.
//
// `composeAcceptanceDecision` is the SINGLE pure projector. It never mutates the
// verdict and never injects external evidence into it (that was the prior
// rule-8/15 dual-author defect). Only `final` is business-consumable.
// ---------------------------------------------------------------------------

export type HostGateFailureGroup = {
  kind: "manifest" | "visual"
  id: string
  summary: string
  evidence: string[]
}

export type HostGateResult = {
  /** Composite legacy evidence status. */
  passed: boolean
  manifest: AcceptanceEvidenceManifest
  visualMetric?: VisualMetricResult | null
  /** Pre-grouped legacy evidence failures (manifest/visual). Empty when passed. */
  failures: HostGateFailureGroup[]
}

export type AcceptanceDecision = {
  /** The ONLY business-consumable verdict. Persisted under the compatibility
   *  label `acceptance-review-verdict` so every existing reader keeps working
   *  unchanged; its CONTENT is this composed final, not a raw agent verdict. */
  final: AcceptanceVerdictType
  /** Raw historical verdict — evidence only. Persisted under the legacy label. */
  rawAgentVerdict?: AcceptanceVerdictType
  /** Historical evidence status. */
  hostGate: HostGateResult
  source: "llm" | "host_gate"
}

/**
 * The single acceptance-decision projector. Pure, no side effects, no mutation
 * of the agent verdict.
 *
 *   - legacy evidence failed  → synthesize a rejected historical verdict.
 *   - legacy evidence passed  → `final` is the supplied verdict verbatim. No
 *     external evidence injected.
 *     `agentVerdict` MUST be present.
 */
export function composeAcceptanceDecision(input: {
  hostGate: HostGateResult
  agentVerdict?: AcceptanceVerdictType
}): AcceptanceDecision {
  if (!input.hostGate.passed) {
    // Legacy projector retained only for historical artifacts.
    return {
      final: synthesizeHostGateRejected(input.hostGate),
      rawAgentVerdict: input.agentVerdict,
      hostGate: input.hostGate,
      source: "host_gate",
    }
  }
  if (!input.agentVerdict) {
    throw new Error("composeAcceptanceDecision: legacy evidence passed but no verdict was supplied.")
  }
  return {
    final: input.agentVerdict,
    rawAgentVerdict: input.agentVerdict,
    hostGate: input.hostGate,
    source: "llm",
  }
}

/**
 * Build the legacy-evidence rejected `final` verdict. Satisfies the rejected shape
 * the orchestrator retry chain already consumes
 * (`composeLatestAcceptanceFeedbackForBuild`): non-empty `rejection_details`
 * with schema-enum categories, non-empty `tool_call_evidence` carrying the
 * evidence rows, and projected `deferred_checks`. No goal_id is attached
 * — legacy evidence failures are task-scope; goal routing falls back to the raw
 * packet + manifest failure details the orchestrator fetches by acceptance_id.
 */
function synthesizeHostGateRejected(hostGate: HostGateResult): RejectedVerdictType {
  const summary = `Acceptance rejected by required evidence: ${hostGate.manifest.finalGate.summary}`
  const groups =
    hostGate.failures.length > 0
      ? hostGate.failures
      : [
          {
            kind: "manifest" as const,
            id: hostGate.manifest.id,
            summary: hostGate.manifest.finalGate.summary,
            evidence: [],
          },
        ]
  const rejection_details = groups.map((group) => {
    const detail = [group.summary, ...group.evidence].filter((s) => s.trim().length > 0).join("\n")
    return {
      // category must stay within the verdict schema enum — never "manifest".
      category: group.kind === "visual" ? ("visual" as const) : ("quality" as const),
      error: padEvidence(detail || group.summary || `${group.kind} evidence failed`),
      suggestion: "Fix the failing required acceptance evidence, then rerun integrity acceptance review.",
    }
  })
  const deferred_checks = buildHostDeferredChecks(hostGate)
  const tool_call_evidence = buildHostToolCallEvidence(hostGate)
  return {
    verdict: "rejected",
    summary,
    deferred_checks,
    tool_call_evidence,
    rejection_details,
  }
}

/** `error` has a schema floor of 8 chars; never emit a thinner signal. */
function padEvidence(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length >= 8) return trimmed
  return `${trimmed} (evidence failure)`.trim()
}

function buildHostDeferredChecks(hostGate: HostGateResult): DeferredCheckType[] {
  const manifest = hostGate.manifest
  const auxiliary = new Set(manifest.functionalAssessment?.auxiliaryFailureIds ?? [])
  const checks: DeferredCheckType[] = manifest.checkResults.map((item) => ({
    name: item.id,
    result: item.status === "failed" && auxiliary.has(item.id) ? ("advisory_failed" as const) : item.status,
    evidence:
      [
        item.command,
        item.exitCode === undefined ? undefined : `exit_code=${item.exitCode}`,
        item.failureSignature ? `failure_signature=${item.failureSignature.normalizedError}` : undefined,
        item.outputExcerpt,
      ]
        .filter(Boolean)
        .join("\n") || `${item.id} ${item.status}`,
  }))
  for (const review of manifest.reviewEvidence) {
    checks.push({
      name: review.id,
      result: review.status === "failed" && auxiliary.has(review.id) ? ("advisory_failed" as const) : review.status,
      evidence: review.evidence.join("\n") || `${review.id} ${review.status}`,
    })
  }
  if (hostGate.visualMetric) {
    const m = hostGate.visualMetric
    checks.push({
      name: "visual_metric",
      result: m.passed ? "passed" : "failed",
      evidence: [
        `score=${m.score.toFixed(3)}`,
        `rendered=${m.renderedPath}`,
        `reference=${m.referencePath}`,
        ...m.gates.map(
          (g) => `${g.name}: ${g.passed ? "passed" : "failed"} value=${g.value} threshold=${g.threshold} ${g.note}`,
        ),
      ].join("\n"),
    })
  }
  return checks
}

function buildHostToolCallEvidence(hostGate: HostGateResult): ToolCallEvidenceType[] {
  const manifest = hostGate.manifest
  const evidence: ToolCallEvidenceType[] = [
    {
      tool: "AcceptanceEvidenceManifest",
      passed: manifest.finalGate.status === "passed",
      detail: padEvidence(`finalGate.status=${manifest.finalGate.status} ${manifest.finalGate.summary}`),
    },
  ]
  if (hostGate.visualMetric) {
    const m = hostGate.visualMetric
    evidence.push({
      tool: "visual_metric",
      passed: m.passed,
      detail: padEvidence(`score=${m.score.toFixed(3)} failed_gates=${m.gates.filter((g) => !g.passed).length}`),
    })
  }
  return evidence
}
