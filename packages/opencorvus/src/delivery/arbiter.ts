import type { VisualMetricResult } from "./visual-metric"
import type { RuntimeEvidenceReport } from "./checks/runtime-evidence"
import type {
  DeliveryEvidenceManifest,
  DeliveryGateVerdict,
  DeliveryManifestFunctionalAssessment,
} from "./manifest"
import type { DeliveryVerdictType } from "./verdict"

export type DeliveryArbiterDecision = {
  verdict: DeliveryVerdictType
  source: "llm" | "host_gate"
}

/**
 * Delivery gate semantics:
 *   - Blocking: runtime-readiness failures, acceptance-spec coverage gaps,
 *     failed runtime probes, and required integrity review failures.
 *   - Advisory: required checks (build/typecheck/test/lint),
 *     workspace_export reviews, and specialist reviews. The delivery agent
 *     (LLM) reads the full evidence and decides whether they materially block
 *     acceptance.
 *
 * functionalAssessment.primaryFailureIds is the ground truth for the
 * blocking set; the gate just mirrors it. This keeps a single source of
 * truth for "what blocks delivery" — see `assessFunctionalCompletion` in
 * `delivery/checks/project-gate.ts`.
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

/**
 * Delivery verdict arbiter. The delivery agent owns goal-level attribution;
 * required host gates own final acceptability. If manifest/runtime/visual
 * evidence fails and the agent still returns accepted, the final verdict is
 * rejected so the UI cannot display "Accepted" for an incomplete deliverable.
 */
export function arbitrateDeliveryVerdict(input: {
  manifest: DeliveryEvidenceManifest
  goalIds: readonly string[]
  llmVerdict?: DeliveryVerdictType
  runtimeReport?: RuntimeEvidenceReport
  visualMetric?: VisualMetricResult | null
}): DeliveryArbiterDecision | undefined {
  if (!input.llmVerdict) return undefined

  const hostBlocker = hostGateBlockingSummary(input)
  const verdict = hostBlocker
    ? {
      ...input.llmVerdict,
      summary: `${input.llmVerdict.summary}\n\nHost gate blockers: ${hostBlocker}`,
    }
    : input.llmVerdict

  if (hostBlocker && verdict.verdict === "accepted") {
    return {
      source: "host_gate",
      verdict: appendHostGateEvidence({
        verdict: "rejected",
        summary: `Delivery rejected by required host gates: ${hostBlocker}`,
        startup_verification: verdict.startup_verification,
        frontend_check: verdict.frontend_check,
        deferred_checks: verdict.deferred_checks,
        tool_call_evidence: verdict.tool_call_evidence,
        rejection_details: [{
          category: hostBlocker.includes("Visual") ? "visual" : hostBlocker.includes("Runtime") ? "runtime" : "quality",
          error: hostBlocker,
          suggestion: "Fix the required delivery evidence gate, then rerun delivery.",
        }],
      }, input),
    }
  }

  return {
    source: "llm",
    verdict: appendHostGateEvidence(verdict, input),
  }
}

export function appendManifestEvidence(
  verdict: DeliveryVerdictType,
  manifest: DeliveryEvidenceManifest,
): DeliveryVerdictType {
  const auxiliary = new Set(manifest.functionalAssessment?.auxiliaryFailureIds ?? [])
  const projected = manifest.checkResults.map((item) => ({
    name: item.id,
    result: item.status === "failed" && auxiliary.has(item.id) ? "advisory_failed" as const : item.status,
    evidence: [
      item.command,
      item.exitCode === undefined ? undefined : `exit_code=${item.exitCode}`,
      item.failureSignature ? `failure_signature=${item.failureSignature.normalizedError}` : undefined,
      item.outputExcerpt,
    ].filter(Boolean).join("\n"),
  }))
  return {
    ...verdict,
    deferred_checks: [
      ...verdict.deferred_checks,
      ...projected,
      ...manifest.reviewEvidence.map((item) => ({
        name: item.id,
        result: item.status === "failed" && auxiliary.has(item.id) ? "advisory_failed" as const : item.status,
        evidence: item.evidence.join("\n"),
      })),
    ],
  }
}

function hostGateBlockingSummary(input: {
  manifest: DeliveryEvidenceManifest
  runtimeReport?: RuntimeEvidenceReport
  visualMetric?: VisualMetricResult | null
}): string {
  // Only acceptance-spec coverage gaps are host-side blockers that override an
  // "accepted" verdict. Runtime / visual / specialist findings flow through as
  // advisory evidence — the delivery agent already sees them and decides.
  if (input.manifest.finalGate.status === "passed") return ""
  return input.manifest.finalGate.summary
}

function appendHostGateEvidence(
  verdict: DeliveryVerdictType,
  input: {
    manifest: DeliveryEvidenceManifest
    runtimeReport?: RuntimeEvidenceReport
    visualMetric?: VisualMetricResult | null
  },
): DeliveryVerdictType {
  let next = appendManifestEvidence(verdict, input.manifest)
  if (input.runtimeReport) next = appendRuntimeEvidence(next, input.runtimeReport)
  if (input.visualMetric) next = appendVisualMetricEvidence(next, input.visualMetric)
  return next
}

function appendRuntimeEvidence(
  verdict: DeliveryVerdictType,
  report: RuntimeEvidenceReport,
): DeliveryVerdictType {
  const runtimeDetail = report.evidence.previewUrl
    ? `previewUrl=${report.evidence.previewUrl} dom.textLength=${report.evidence.dom?.textLength ?? "n/a"} nodes=${report.evidence.dom?.nodeCount ?? "n/a"}`
    : "no live preview URL"
  const violations = report.violations.map((v) => `${v.kind}: ${v.detail}`)
  return {
    ...verdict,
    deferred_checks: [
      ...verdict.deferred_checks,
      {
        name: "runtime_evidence",
        result: report.passed ? "passed" : "failed",
        evidence: [
          runtimeDetail,
          ...violations,
        ].join("\n"),
      },
    ],
    tool_call_evidence: [
      ...verdict.tool_call_evidence,
      {
        tool: "runtime_evidence",
        passed: report.passed,
        detail: `${report.violations.length} violation(s): ${runtimeDetail}`,
      },
    ],
  }
}

function appendVisualMetricEvidence(
  verdict: DeliveryVerdictType,
  metric: VisualMetricResult,
): DeliveryVerdictType {
  const gateLines = metric.gates.map((gate) =>
    `${gate.name}: ${gate.passed ? "passed" : "failed"} value=${gate.value} threshold=${gate.threshold} ${gate.note}`,
  )
  return {
    ...verdict,
    deferred_checks: [
      ...verdict.deferred_checks,
      {
        name: "visual_metric",
        result: metric.passed ? "passed" : "failed",
        evidence: [
          `score=${metric.score.toFixed(3)}`,
          `rendered=${metric.renderedPath}`,
          `reference=${metric.referencePath}`,
          ...gateLines,
        ].join("\n"),
      },
    ],
    tool_call_evidence: [
      ...verdict.tool_call_evidence,
      {
        tool: "visual_metric",
        passed: metric.passed,
        detail: `score=${metric.score.toFixed(3)} failed_gates=${metric.gates.filter((gate) => !gate.passed).length}`,
      },
    ],
  }
}
