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
  source: "llm"
}

/**
 * Delivery accept/reject is decided strictly by functional completeness
 * (`failedCoverageIds`) and required-check / e2e test results
 * (`failedCheckIds`). Runtime probes (puppeteer renders, server-launch checks)
 * and specialist reviews are recorded for transparency but do NOT flip the
 * gate status — they are advisory warnings shown to the delivery agent and
 * the orchestrator. This matches the user-stated rule: "只看功能完成度和e2e
 * 测试结果，其余全部作为警告" — anything else cannot block delivery.
 */
export function arbitrateDeliveryGate(input: {
  checks: DeliveryGateVerdict
  failedCoverageIds: string[]
  failedRuntimeFlowIds?: string[]
  failedReviewIds?: string[]
  functionalAssessment: DeliveryManifestFunctionalAssessment
}): DeliveryGateVerdict {
  const failedRuntimeFlowIds = input.failedRuntimeFlowIds ?? []
  const failedReviewIds = input.failedReviewIds ?? []
  const status = input.checks.failedCheckIds.length === 0
    && input.failedCoverageIds.length === 0
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
    }),
  }
}

function deliveryGateSummary(input: {
  status: "passed" | "failed"
  checks: number
  coverage: number
  runtime: number
  reviews: number
  functionalAssessment: DeliveryManifestFunctionalAssessment
}) {
  const advisoryNote = input.runtime + input.reviews > 0
    ? ` Advisory warnings: ${input.runtime} runtime flow(s), ${input.reviews} review item(s).`
    : ""
  if (input.status === "passed") {
    return `${input.functionalAssessment.summary}${advisoryNote}`
  }
  const counts =
    `${input.checks} required check(s) and ${input.coverage} coverage item(s)`
  const primary = input.functionalAssessment.primaryFailureIds.join(", ") || "none"
  const auxiliary = input.functionalAssessment.auxiliaryFailureIds.join(", ") || "none"
  return `${input.functionalAssessment.summary} Evidence gate failed ${counts}. Primary: ${primary}. Auxiliary: ${auxiliary}.${advisoryNote}`
}

/**
 * Delivery verdict arbiter — pure passthrough of the LLM verdict.
 *
 * The host no longer overrides the delivery agent's decision. Manifest
 * gate failures (functional completion / e2e tests) are surfaced to the
 * agent in its prompt context, and runtime/visual probe failures are
 * appended as advisory `deferred_checks` evidence on the returned verdict
 * — but neither family can flip an agent-accepted verdict to rejected,
 * nor can they synthesize a rejection when the agent did not reach one.
 *
 * Anchoring on the agent verdict preserves goal-level attribution (the
 * agent owns rejection_details) and removes the historical "host gate
 * forces rejected" loop that punished delivery rounds for transient
 * environment problems (puppeteer launch failures, slow installs, etc.)
 * unrelated to the artifact under review.
 */
export function arbitrateDeliveryVerdict(input: {
  manifest: DeliveryEvidenceManifest
  goalIds: readonly string[]
  llmVerdict?: DeliveryVerdictType
  runtimeReport?: RuntimeEvidenceReport
  visualMetric?: VisualMetricResult | null
}): DeliveryArbiterDecision | undefined {
  if (!input.llmVerdict) return undefined

  const advisoryNote = hostGateAdvisorySummary(input)
  const verdict = advisoryNote
    ? {
      ...input.llmVerdict,
      summary: `${input.llmVerdict.summary}\n\nAdvisory host gates: ${advisoryNote}`,
    }
    : input.llmVerdict

  return {
    source: "llm",
    verdict: appendHostGateEvidence(verdict, input),
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

function hostGateAdvisorySummary(input: {
  manifest: DeliveryEvidenceManifest
  runtimeReport?: RuntimeEvidenceReport
  visualMetric?: VisualMetricResult | null
}): string {
  const summaries: string[] = []
  if (input.manifest.finalGate.status !== "passed") summaries.push(input.manifest.finalGate.summary)
  if (input.runtimeReport && !input.runtimeReport.passed) {
    summaries.push(`Runtime-evidence advisory: ${input.runtimeReport.violations.length} violation(s).`)
  }
  if (input.visualMetric && !input.visualMetric.passed) {
    const failedGates = input.visualMetric.gates.filter((gate) => !gate.passed)
    summaries.push(
      `Visual metric advisory: score=${input.visualMetric.score.toFixed(3)} with ${failedGates.length} failed gate(s).`,
    )
  }
  return summaries.join(" | ")
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
