import type { VisualMetricResult } from "./visual-metric"
import type { RuntimeEvidenceReport } from "./checks/runtime-evidence"
import type {
  DeliveryEvidenceManifest,
  DeliveryGateVerdict,
  DeliveryManifestFunctionalAssessment,
} from "./manifest"
import type {
  DeliveryVerdictType,
  RejectionDetailType,
} from "./verdict"

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
  if (input.manifest.finalGate.status !== "passed") {
    if (!input.llmVerdict || input.llmVerdict.verdict !== "rejected") return undefined
    return {
      source: "manifest",
      verdict: appendManifestEvidence({
        ...input.llmVerdict,
        summary: `${input.llmVerdict.summary}\n\nHost gate: ${input.manifest.finalGate.summary}`,
      }, input.manifest),
    }
  }

  if (input.runtimeReport && !input.runtimeReport.passed) {
    const runtimeVerdict = synthesizeRuntimeRejection(input.runtimeReport, input.goalIds)
    if (input.llmVerdict) {
      return {
        source: "runtime_evidence",
        verdict: forceRejectedByGate({
          verdict: input.llmVerdict,
          gateVerdict: runtimeVerdict,
          gateSummary: runtimeVerdict.summary,
        }),
      }
    }
    return {
      source: "runtime_evidence",
      verdict: runtimeVerdict,
    }
  }

  if (!input.llmVerdict) return undefined

  let source: DeliveryArbiterDecision["source"] = "llm"
  let verdict = input.llmVerdict
  if (input.visualMetric && !input.visualMetric.passed) {
    source = "visual_hard_gate"
    verdict = applyVisualMetricVerdict(verdict, input.visualMetric, input.goalIds)
  }

  return {
    source,
    verdict: appendManifestEvidence(verdict, input.manifest),
  }
}

function forceRejectedByGate(input: {
  verdict: DeliveryVerdictType
  gateVerdict: DeliveryVerdictType
  gateSummary: string
}): DeliveryVerdictType {
  if (input.gateVerdict.verdict !== "rejected") return input.verdict
  if (input.verdict.verdict === "rejected") {
    return {
      ...input.verdict,
      summary: `${input.verdict.summary}\n\nHost gate: ${input.gateSummary}`,
      deferred_checks: [
        ...input.verdict.deferred_checks,
        ...input.gateVerdict.deferred_checks,
      ],
      tool_call_evidence: [
        ...input.verdict.tool_call_evidence,
        ...input.gateVerdict.tool_call_evidence,
      ],
      rejection_details: [
        ...input.verdict.rejection_details,
        ...input.gateVerdict.rejection_details,
      ],
    }
  }
  return {
    verdict: "rejected",
    summary: `Host gate rejected delivery after semantic verdict attempted accepted: ${input.gateSummary}`,
    startup_verification: input.verdict.startup_verification,
    frontend_check: input.verdict.frontend_check,
    deferred_checks: [
      ...input.verdict.deferred_checks,
      ...input.gateVerdict.deferred_checks,
    ],
    tool_call_evidence: [
      ...input.verdict.tool_call_evidence,
      ...input.gateVerdict.tool_call_evidence,
    ],
    rejection_details: input.gateVerdict.rejection_details,
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

function synthesizeRuntimeRejection(
  report: RuntimeEvidenceReport,
  goalIds: readonly string[],
): DeliveryVerdictType {
  void goalIds
  const headline = `Runtime-evidence gate rejected delivery: ${report.violations.length} violation(s).`
  const details: RejectionDetailType[] = report.violations.map((v) => ({
    category: "runtime" as const,
    error: `${v.kind}: ${v.detail}`,
    suggestion:
      v.kind === "no_build_artifact"
        ? "Produce a real runnable frontend build artifact or start/preview command for the integrated task."
        : v.kind === "empty_root_shell"
          ? "Root mount did not hydrate; inspect the frontend entrypoint, router, and runtime errors."
          : v.kind === "render_failed"
            ? "Build artifact exists but rendering failed; inspect server startup, asset paths, and runtime errors."
            : "Rendered DOM is too thin; ensure the primary UI content is actually rendered.",
  }))
  const buildArtifactDetail = report.evidence.buildArtifactPath
    ? `index.html=${report.evidence.buildArtifactPath} dom.textLength=${report.evidence.dom?.textLength ?? "n/a"} nodes=${report.evidence.dom?.nodeCount ?? "n/a"}`
    : "no build artifact"
  return {
    verdict: "rejected",
    summary: headline,
    startup_verification: {
      attempted: true,
      success: false,
      output: buildArtifactDetail,
    },
    frontend_check: {
      attempted: true,
      renders_correctly: false,
      issues: report.violations.map((v) => `[runtime/${v.kind}] ${v.detail}`).slice(0, 10),
    },
    deferred_checks: [],
    tool_call_evidence: [
      {
        tool: "delivery_arbiter",
        passed: false,
        detail: `${report.violations.length} violation(s): ${buildArtifactDetail}`,
      },
    ],
    rejection_details: details,
  }
}

function applyVisualMetricVerdict(
  llmVerdict: DeliveryVerdictType,
  metric: VisualMetricResult,
  goalIds: readonly string[],
): DeliveryVerdictType {
  const failedGates = metric.gates.filter((g) => !g.passed)
  const headline =
    `Numeric visual gate failed (score=${metric.score.toFixed(3)}). ` +
    `Rendered output missed ${failedGates.length} hard visual gate(s).`

  void goalIds
  const gateRejections: RejectionDetailType[] = failedGates.map((g) => ({
    category: "visual" as const,
    error: `${g.name}: ${g.note || `value=${g.value} threshold=${g.threshold}`}`,
    suggestion: visualSuggestion(g.name),
  }))

  if (llmVerdict.verdict === "rejected") {
    return {
      ...llmVerdict,
      summary: `${llmVerdict.summary}\n\n${headline}`,
      rejection_details: [...llmVerdict.rejection_details, ...gateRejections],
    }
  }

  return {
    verdict: "rejected",
    summary: `${headline}\n\nLLM summary: ${llmVerdict.summary}`,
    startup_verification: llmVerdict.startup_verification,
    frontend_check: llmVerdict.frontend_check,
    deferred_checks: llmVerdict.deferred_checks,
    tool_call_evidence: llmVerdict.tool_call_evidence,
    rejection_details: gateRejections,
  }
}

function visualSuggestion(gateName: string) {
  return gateName === "chart_region_density" || gateName === "unique_color_ratio"
    ? "Rendered output is too close to an empty shell; verify real data is rendered into DOM or canvas."
    : gateName === "phash_hamming" || gateName === "ssim"
      ? "Rendered layout or visual structure diverges from the reference; realign the primary regions."
      : "Compare rendered text against reference strings and restore the missing visible copy."
}
