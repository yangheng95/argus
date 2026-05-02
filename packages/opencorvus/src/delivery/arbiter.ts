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
  source: "manifest" | "runtime_evidence" | "llm" | "visual_hard_gate"
}

export function arbitrateDeliveryGate(input: {
  checks: DeliveryGateVerdict
  failedCoverageIds: string[]
  failedRuntimeFlowIds?: string[]
  failedReviewIds?: string[]
  functionalAssessment?: DeliveryManifestFunctionalAssessment
}): DeliveryGateVerdict {
  const failedRuntimeFlowIds = input.failedRuntimeFlowIds ?? []
  const failedReviewIds = input.failedReviewIds ?? []
  const status = input.checks.failedCheckIds.length === 0
    && input.failedCoverageIds.length === 0
    && failedRuntimeFlowIds.length === 0
    && failedReviewIds.length === 0
    ? "passed"
    : "failed"
  return {
    status,
    failedCheckIds: input.checks.failedCheckIds,
    failedCoverageIds: input.failedCoverageIds,
    failedRuntimeFlowIds,
    failedReviewIds,
    functionalAssessment: input.functionalAssessment,
    summary: deliveryGateSummary({
      status,
      checks: input.checks.failedCheckIds.length,
      coverage: input.failedCoverageIds.length,
      runtime: failedRuntimeFlowIds.length,
      reviews: failedReviewIds.length,
      functionalAssessment: input.functionalAssessment,
      fallbackPassedSummary: input.checks.summary,
    }),
  }
}

function deliveryGateSummary(input: {
  status: "passed" | "failed"
  checks: number
  coverage: number
  runtime: number
  reviews: number
  functionalAssessment?: DeliveryManifestFunctionalAssessment
  fallbackPassedSummary: string
}) {
  if (input.status === "passed") {
    return input.functionalAssessment?.summary ?? input.fallbackPassedSummary
  }
  const counts =
    `${input.checks} required check(s), ${input.coverage} coverage item(s), ` +
    `${input.runtime} runtime flow(s), and ${input.reviews} review item(s)`
  if (!input.functionalAssessment) {
    return `Delivery evidence gate failed ${counts}.`
  }
  const primary = input.functionalAssessment.primaryFailureIds.join(", ") || "none"
  const auxiliary = input.functionalAssessment.auxiliaryFailureIds.join(", ") || "none"
  return `${input.functionalAssessment.summary} Evidence gate failed ${counts}. Primary: ${primary}. Auxiliary: ${auxiliary}.`
}

export function arbitrateDeliveryVerdict(input: {
  manifest: DeliveryEvidenceManifest
  goalIds: readonly string[]
  llmVerdict?: DeliveryVerdictType
  runtimeReport?: RuntimeEvidenceReport
  visualMetric?: VisualMetricResult | null
}): DeliveryArbiterDecision | undefined {
  const hostGateSource = hostGateFailureSource(input)
  if (hostGateSource) {
    if (!input.llmVerdict || input.llmVerdict.verdict !== "rejected") return undefined
    return {
      source: hostGateSource,
      verdict: appendHostGateEvidence({
        ...input.llmVerdict,
        summary: `${input.llmVerdict.summary}\n\nHost gate: ${hostGateSummary(input)}`,
      }, input),
    }
  }

  if (!input.llmVerdict) return undefined

  return {
    source: "llm",
    verdict: appendHostGateEvidence(input.llmVerdict, input),
  }
}

function appendManifestEvidence(
  verdict: DeliveryVerdictType,
  manifest: DeliveryEvidenceManifest,
): DeliveryVerdictType {
  const projected = manifest.checkResults.map((item) => ({
    name: item.id,
    result: item.status,
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
        result: item.status,
        evidence: item.evidence.join("\n"),
      })),
    ],
  }
}

function hostGateFailureSource(input: {
  manifest: DeliveryEvidenceManifest
  runtimeReport?: RuntimeEvidenceReport
  visualMetric?: VisualMetricResult | null
}): DeliveryArbiterDecision["source"] | undefined {
  if (input.manifest.finalGate.status !== "passed") return "manifest"
  if (input.runtimeReport && !input.runtimeReport.passed) return "runtime_evidence"
  if (input.visualMetric && !input.visualMetric.passed) return "visual_hard_gate"
  return undefined
}

function hostGateSummary(input: {
  manifest: DeliveryEvidenceManifest
  runtimeReport?: RuntimeEvidenceReport
  visualMetric?: VisualMetricResult | null
}): string {
  const summaries: string[] = []
  if (input.manifest.finalGate.status !== "passed") summaries.push(input.manifest.finalGate.summary)
  if (input.runtimeReport && !input.runtimeReport.passed) {
    summaries.push(`Runtime-evidence gate failed ${input.runtimeReport.violations.length} violation(s).`)
  }
  if (input.visualMetric && !input.visualMetric.passed) {
    const failedGates = input.visualMetric.gates.filter((gate) => !gate.passed)
    summaries.push(
      `Visual metric gate failed score=${input.visualMetric.score.toFixed(3)} with ${failedGates.length} failed gate(s).`,
    )
  }
  return summaries.join("\n")
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
  const buildArtifactDetail = report.evidence.buildArtifactPath
    ? `index.html=${report.evidence.buildArtifactPath} dom.textLength=${report.evidence.dom?.textLength ?? "n/a"} nodes=${report.evidence.dom?.nodeCount ?? "n/a"}`
    : "no build artifact"
  const violations = report.violations.map((v) => `${v.kind}: ${v.detail}`)
  return {
    ...verdict,
    deferred_checks: [
      ...verdict.deferred_checks,
      {
        name: "runtime_evidence",
        result: report.passed ? "passed" : "failed",
        evidence: [
          buildArtifactDetail,
          ...violations,
        ].join("\n"),
      },
    ],
    tool_call_evidence: [
      ...verdict.tool_call_evidence,
      {
        tool: "runtime_evidence",
        passed: report.passed,
        detail: `${report.violations.length} violation(s): ${buildArtifactDetail}`,
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
