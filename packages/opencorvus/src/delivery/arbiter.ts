import type { VisualMetricResult } from "./visual-metric"
import type { RuntimeEvidenceReport } from "./checks/runtime-evidence"
import type {
  DeliveryCheckResult,
  DeliveryEvidenceManifest,
  DeliveryGateVerdict,
  DeliveryReviewEvidence,
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
    summary: status === "passed"
      ? input.checks.summary
      : `Delivery evidence gate failed ${input.checks.failedCheckIds.length} required check(s), ${input.failedCoverageIds.length} coverage item(s), ${failedRuntimeFlowIds.length} runtime flow(s), and ${failedReviewIds.length} review item(s).`,
  }
}

export function arbitrateDeliveryVerdict(input: {
  manifest: DeliveryEvidenceManifest
  goalIds: readonly string[]
  llmVerdict?: DeliveryVerdictType
  runtimeReport?: RuntimeEvidenceReport
  visualMetric?: VisualMetricResult | null
}): DeliveryArbiterDecision | undefined {
  if (input.manifest.finalGate.status !== "passed") {
    return {
      source: "manifest",
      verdict: synthesizeManifestRejection(input.manifest, input.goalIds),
    }
  }

  if (input.runtimeReport && !input.runtimeReport.passed) {
    return {
      source: "runtime_evidence",
      verdict: synthesizeRuntimeRejection(input.runtimeReport, input.goalIds),
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

function synthesizeManifestRejection(
  manifest: DeliveryEvidenceManifest,
  goalIds: readonly string[],
): DeliveryVerdictType {
  const allGoalIds = goalIds.length > 0 ? [...goalIds] : ["unknown-goal"]
  const failedResults = manifest.checkResults.filter((item) =>
    manifest.finalGate.failedCheckIds.includes(item.id)
  )
  const failedCoverage = [
    ...manifest.goalCoverage
      .filter((item) => manifest.finalGate.failedCoverageIds.includes(`goal:${item.goalId}`))
      .map((item) => ({
        id: `goal:${item.goalId}`,
        family: "quality",
        label: item.title,
        command: "acceptance_specs",
        failureReason: item.evidence.join("; "),
        outputExcerpt: item.evidence.join("; "),
      })),
    ...manifest.requirementCoverage
      .filter((item) => manifest.finalGate.failedCoverageIds.includes(`requirement:${item.requirementId}`))
      .map((item) => ({
        id: `requirement:${item.requirementId}`,
        family: "quality",
        label: item.requirementId,
        command: "requirement_coverage",
        failureReason: item.evidence.join("; "),
        outputExcerpt: item.evidence.join("; "),
      })),
  ]
  const failedRuntimeFlows = manifest.runtimeFlows
    .filter((item) => manifest.finalGate.failedRuntimeFlowIds.includes(item.id))
    .map((item) => ({
      id: item.id,
      family: "runtime",
      label: item.name,
      command: "runtime_flow",
      failureReason: item.evidence.join("; "),
      outputExcerpt: item.evidence.join("; "),
    }))
  const failedReviewEvidence = manifest.reviewEvidence
    .filter((item) => (manifest.finalGate.failedReviewIds ?? []).includes(item.id))
    .map((item) => ({
      id: item.id,
      name: item.name,
      family: "quality",
      label: item.name,
      command: "specialist_review",
      failureReason: item.evidence.join("; "),
      outputExcerpt: item.evidence.join("; "),
    }))
  const failed = failedResults.length > 0
    ? failedResults
    : failedCoverage.length > 0
      ? failedCoverage
      : failedRuntimeFlows.length > 0
        ? failedRuntimeFlows
        : failedReviewEvidence.length > 0
          ? failedReviewEvidence
          : manifest.requiredChecks
        .filter((item) => manifest.finalGate.failedCheckIds.includes(item.id))
        .map((item) => ({
          ...item,
          status: "failed" as const,
          outputExcerpt: "Required check did not produce a result.",
          startedAt: manifest.timeCreated,
          completedAt: manifest.timeCreated,
        }))
  return {
    verdict: "rejected",
    summary: manifest.finalGate.summary,
    startup_verification: {
      attempted: true,
      success: false,
      output: manifest.finalGate.summary,
    },
    frontend_check: {
      attempted: false,
      issues: failed.map((item) => `${item.name}: ${item.failureReason ?? item.outputExcerpt}`).slice(0, 10),
    },
    deferred_checks: [
      ...manifest.checkResults.map((item) => ({
        name: item.id,
        result: item.status,
        evidence: item.outputExcerpt || item.failureReason || "No output captured.",
      })),
      ...manifest.reviewEvidence.map((item) => ({
        name: item.id,
        result: item.status,
        evidence: item.evidence.join("\n"),
      })),
    ],
    tool_call_evidence: [
      {
        tool: "delivery_arbiter",
        passed: false,
        detail: `${manifest.finalGate.failedCheckIds.length} failed required check(s), ${manifest.finalGate.failedCoverageIds.length} failed coverage item(s), ${manifest.finalGate.failedRuntimeFlowIds.length} failed runtime flow(s), ${(manifest.finalGate.failedReviewIds ?? []).length} failed review item(s) in manifest ${manifest.id}.`,
      },
    ],
    rejection_details: failed.flatMap((item) =>
      ownerGoalIdsForFailure({ itemId: item.id, manifest, allGoalIds }).map((goalId) => ({
        goal_id: goalId,
        category: categoryForFailure(item),
        error: `${item.id} failed: ${item.failureReason ?? item.outputExcerpt}`,
        suggestion: `Fix the ${item.label ?? item.name} failure and rerun ${item.command}.`,
      })),
    ),
  }
}

function synthesizeRuntimeRejection(
  report: RuntimeEvidenceReport,
  goalIds: readonly string[],
): DeliveryVerdictType {
  const headline = `Runtime-evidence gate rejected delivery: ${report.violations.length} violation(s).`
  const allGoalIds = goalIds.length > 0 ? [...goalIds] : ["unknown-goal"]
  const detailsPerGoal: RejectionDetailType[] = allGoalIds.flatMap((gid) =>
    report.violations.map((v) => ({
      goal_id: gid,
      category: "runtime" as const,
      error: `${v.kind}: ${v.detail}`,
      suggestion:
        v.kind === "no_build_artifact"
          ? "Goal must produce a real runnable frontend build artifact or start/preview command."
          : v.kind === "empty_root_shell"
            ? "Root mount did not hydrate; inspect the frontend entrypoint, router, and runtime errors."
            : v.kind === "render_failed"
              ? "Build artifact exists but rendering failed; inspect server startup, asset paths, and runtime errors."
              : "Rendered DOM is too thin; ensure the primary UI content is actually rendered.",
    })),
  )
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
    rejection_details: detailsPerGoal,
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

  const allGoalIds = goalIds.length > 0 ? [...goalIds] : ["unknown-goal"]
  const gateRejections: RejectionDetailType[] = allGoalIds.flatMap((gid) =>
    failedGates.map((g) => ({
      goal_id: gid,
      category: "visual" as const,
      error: `${g.name}: ${g.note || `value=${g.value} threshold=${g.threshold}`}`,
      suggestion: visualSuggestion(g.name),
    })),
  )

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

function ownerGoalIdsForFailure(input: {
  itemId: string
  manifest: DeliveryEvidenceManifest
  allGoalIds: string[]
}) {
  if (input.itemId.startsWith("goal:")) {
    const goalId = input.itemId.slice("goal:".length)
    return goalId ? [goalId] : input.allGoalIds
  }

  if (input.itemId.startsWith("requirement:")) {
    const requirementId = input.itemId.slice("requirement:".length)
    const coverage = input.manifest.requirementCoverage.find((item) => item.requirementId === requirementId)
    return coverage?.goalIds.length ? coverage.goalIds : input.allGoalIds
  }

  if (input.itemId.startsWith("specialist:")) {
    const reviewer = input.itemId.slice("specialist:".length)
    const review = input.manifest.specialistReviews?.find((item) => item.reviewer === reviewer)
    const suggestedGoalIds = review?.findings
      .filter((finding) => finding.proposedSeverity === "blocking")
      .map((finding) => finding.suggestedOwnerGoalID)
      .filter((item): item is string => Boolean(item)) ?? []
    if (suggestedGoalIds.length > 0) return [...new Set(suggestedGoalIds)].sort()

    const requirementIds = new Set(
      review?.findings
        .filter((finding) => finding.proposedSeverity === "blocking")
        .flatMap((finding) => finding.affectedRequirementIDs ?? []) ?? [],
    )
    const mapped = input.manifest.requirementCoverage
      .filter((item) => requirementIds.has(item.requirementId))
      .flatMap((item) => item.goalIds)
    if (mapped.length > 0) return [...new Set(mapped)].sort()
  }

  return input.allGoalIds
}

function categoryForFailure(item: DeliveryCheckResult | {
  id: string
  family?: string
}) {
  return item.family === "test"
    ? "test" as const
    : item.family === "lint"
      ? "lint" as const
      : item.family === "build"
        ? "build" as const
        : item.family === "runtime"
          ? "runtime" as const
          : "quality" as const
}

function visualSuggestion(gateName: string) {
  return gateName === "chart_region_density" || gateName === "unique_color_ratio"
    ? "Rendered output is too close to an empty shell; verify real data is rendered into DOM or canvas."
    : gateName === "phash_hamming" || gateName === "ssim"
      ? "Rendered layout or visual structure diverges from the reference; realign the primary regions."
      : "Compare rendered text against reference strings and restore the missing visible copy."
}
