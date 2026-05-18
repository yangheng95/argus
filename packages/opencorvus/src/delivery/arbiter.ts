import type { VisualMetricResult } from "./visual-metric"
import type { RuntimeEvidenceReport } from "./checks/runtime-evidence"
import type { DeliveryEvidenceManifest, DeliveryGateVerdict, DeliveryManifestFunctionalAssessment } from "./manifest"
import type { DeliveryVerdictType, RejectedVerdictType, DeferredCheckType, ToolCallEvidenceType } from "./verdict"

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
// Fresh-eyes delivery decision (specs/delivery-fresh-eyes-decoupling-2026-05-18.md)
//
// The host deterministic gate and the fresh-eyes DeliveryAgent decide DIFFERENT
// questions (rule 8 — one owner per concern):
//   - host gate: objective data-integrity facts (build/test/lint/coverage,
//     runtime probe, visual SSIM). Owned entirely by the host. When it fails,
//     the agent is NOT run to "restate" the failure — the host emits the final
//     decision directly.
//   - DeliveryAgent: semantic completeness + goal attribution, formed blind
//     (no host failure conclusions in its prompt) and only when the host gate
//     has already passed.
//
// `composeDeliveryDecision` is the SINGLE pure projector. It never mutates the
// agent verdict and never injects host evidence into it (that was the prior
// rule-8/15 dual-author defect). The host gate result and the raw agent verdict
// are persisted as their OWN evidence artifacts; only `final` is business-
// consumable.
// ---------------------------------------------------------------------------

export type HostGateFailureGroup = {
  kind: "manifest" | "runtime" | "visual"
  id: string
  summary: string
  evidence: string[]
}

export type HostGateResult = {
  /** Composite: manifest finalGate passed AND no runtime/visual gate failure. */
  passed: boolean
  manifest: DeliveryEvidenceManifest
  runtimeReport?: RuntimeEvidenceReport
  visualMetric?: VisualMetricResult | null
  /** Pre-grouped host failures (manifest/runtime/visual). Empty when passed. */
  failures: HostGateFailureGroup[]
}

export type DeliveryDecision = {
  /** The ONLY business-consumable verdict. Persisted under the compatibility
   *  label `delivery-agent-verdict` so every existing reader keeps working
   *  unchanged; its CONTENT is this composed final, not a raw agent verdict. */
  final: DeliveryVerdictType
  /** Raw agent verdict — evidence only. Undefined when the host gate failed
   *  and the agent never ran. Persisted under `delivery-agent-raw-verdict`. */
  rawAgentVerdict?: DeliveryVerdictType
  /** Host deterministic gate — evidence only. Persisted under
   *  `delivery-host-gate`. */
  hostGate: HostGateResult
  source: "llm" | "host_gate"
}

/**
 * The single delivery-decision projector. Pure, no side effects, no mutation
 * of the agent verdict.
 *
 *   - host gate failed  → agent never ran; synthesize the host-gate rejected
 *     verdict as `final`. `agentVerdict` MUST be absent.
 *   - host gate passed  → `final` is the agent verdict verbatim. No host
 *     evidence injected (host already passed; its result is its own artifact).
 *     `agentVerdict` MUST be present.
 */
export function composeDeliveryDecision(input: {
  hostGate: HostGateResult
  agentVerdict?: DeliveryVerdictType
}): DeliveryDecision {
  if (!input.hostGate.passed) {
    // Host owns objective facts: a failed deterministic gate is the final
    // verdict. If the agent already ran (e.g. it made a narrow repair that the
    // post-repair gate then rejected), its verdict is kept as evidence only —
    // never as `final` (that would re-introduce the dual-author defect).
    return {
      final: synthesizeHostGateRejected(input.hostGate),
      rawAgentVerdict: input.agentVerdict,
      hostGate: input.hostGate,
      source: "host_gate",
    }
  }
  if (!input.agentVerdict) {
    throw new Error(
      "composeDeliveryDecision: host gate passed but no agent verdict was supplied — " +
        "delivery cannot finalize without the fresh-eyes verdict.",
    )
  }
  return {
    final: input.agentVerdict,
    rawAgentVerdict: input.agentVerdict,
    hostGate: input.hostGate,
    source: "llm",
  }
}

/**
 * Build the host-gate rejected `final` verdict. Satisfies the rejected shape
 * the orchestrator retry chain already consumes
 * (`composeLatestDeliveryFeedbackForBuild`): non-empty `rejection_details`
 * with schema-enum categories, non-empty `tool_call_evidence` carrying the
 * host evidence rows, and projected `deferred_checks`. No goal_id is attached
 * — host gate failures are task-scope; goal routing falls back to the raw
 * packet + manifest failure details the orchestrator fetches by delivery_id.
 */
function synthesizeHostGateRejected(hostGate: HostGateResult): RejectedVerdictType {
  const summary = `Delivery rejected by required host gates: ${hostGate.manifest.finalGate.summary}`
  const groups = hostGate.failures.length > 0
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
      category: group.kind === "visual" ? ("visual" as const) : group.kind === "runtime" ? ("runtime" as const) : ("quality" as const),
      error: padEvidence(detail || group.summary || `host ${group.kind} gate failed`),
      suggestion: "Fix the failing required delivery evidence gate, then rerun delivery.",
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
  return `${trimmed} (host gate failure)`.trim()
}

function buildHostDeferredChecks(hostGate: HostGateResult): DeferredCheckType[] {
  const manifest = hostGate.manifest
  const auxiliary = new Set(manifest.functionalAssessment?.auxiliaryFailureIds ?? [])
  const checks: DeferredCheckType[] = manifest.checkResults.map((item) => ({
    name: item.id,
    result:
      item.status === "failed" && auxiliary.has(item.id) ? ("advisory_failed" as const) : item.status,
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
      result:
        review.status === "failed" && auxiliary.has(review.id) ? ("advisory_failed" as const) : review.status,
      evidence: review.evidence.join("\n") || `${review.id} ${review.status}`,
    })
  }
  if (hostGate.runtimeReport) {
    const r = hostGate.runtimeReport
    const runtimeDetail = r.evidence.previewUrl
      ? `previewUrl=${r.evidence.previewUrl} dom.textLength=${r.evidence.dom?.textLength ?? "n/a"} nodes=${r.evidence.dom?.nodeCount ?? "n/a"}`
      : "no live preview URL"
    checks.push({
      name: "runtime_evidence",
      result: r.passed ? "passed" : "failed",
      evidence: [runtimeDetail, ...r.violations.map((v) => `${v.kind}: ${v.detail}`)].join("\n") || runtimeDetail,
    })
  }
  if (hostGate.visualMetric) {
    const m = hostGate.visualMetric
    checks.push({
      name: "visual_metric",
      result: m.passed ? "passed" : "failed",
      evidence:
        [
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
      tool: "DeliveryEvidenceManifest",
      passed: manifest.finalGate.status === "passed",
      detail: padEvidence(
        `finalGate.status=${manifest.finalGate.status} ${manifest.finalGate.summary}`,
      ),
    },
  ]
  if (hostGate.runtimeReport) {
    const r = hostGate.runtimeReport
    const runtimeDetail = r.evidence.previewUrl
      ? `previewUrl=${r.evidence.previewUrl} dom.textLength=${r.evidence.dom?.textLength ?? "n/a"} nodes=${r.evidence.dom?.nodeCount ?? "n/a"}`
      : "no live preview URL"
    evidence.push({
      tool: "runtime_evidence",
      passed: r.passed,
      detail: padEvidence(`${r.violations.length} violation(s): ${runtimeDetail}`),
    })
  }
  if (hostGate.visualMetric) {
    const m = hostGate.visualMetric
    evidence.push({
      tool: "visual_metric",
      passed: m.passed,
      detail: padEvidence(
        `score=${m.score.toFixed(3)} failed_gates=${m.gates.filter((g) => !g.passed).length}`,
      ),
    })
  }
  return evidence
}
