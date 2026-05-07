import {
  createDeliverySpecialistReview,
  type DeliveryReviewFinding,
  type DeliverySpecialistReview,
} from "../specialist-review"
import type {
  DeliveryRuntimeFlowResult,
} from "../manifest"
import type { DeliverySurfaceManifest } from "../surface-detector"

export async function runFrontendReview(input: {
  taskID?: string
  runID?: string
  deliveryID?: string
  surfaceManifest: DeliverySurfaceManifest
  runtimeFlows: DeliveryRuntimeFlowResult[]
}): Promise<DeliverySpecialistReview | undefined> {
  if (!input.surfaceManifest.surfaces.includes("frontend")) return undefined
  if (!input.taskID || !input.runID || !input.deliveryID) return undefined

  const frontendEvidence = input.surfaceManifest.evidence.filter((item) => item.surface === "frontend")
  const findings: DeliveryReviewFinding[] = []
  const failedFlows = input.runtimeFlows.filter((flow) => flow.status === "failed")

  if (frontendEvidence.length === 0) {
    findings.push({
      proposedSeverity: "blocking",
      category: "evidence_quality",
      claim: "Frontend surface was selected without structural frontend evidence.",
      evidence: [{
        kind: "log",
        ref: input.surfaceManifest.id,
        excerpt: "surfaceManifest.surfaces includes frontend but frontend evidence is empty",
      }],
      affectedRequirementIDs: [],
    })
  }

  for (const flow of failedFlows) {
    findings.push({
      proposedSeverity: "blocking",
      category: "runtime",
      claim: `Frontend runtime flow failed: ${flow.name}`,
      evidence: [{
        kind: "log",
        ref: flow.id,
        excerpt: flow.evidence.join("\n"),
      }],
      affectedRequirementIDs: [],
    })
  }

  return createDeliverySpecialistReview({
    taskId: input.taskID,
    runId: input.runID,
    deliveryId: input.deliveryID,
    reviewer: "frontend",
    executionStatus: "completed",
    summary: findings.length === 0
      ? `Frontend review passed with ${frontendEvidence.length} structural evidence group(s).`
      : `Frontend review found ${findings.length} issue(s).`,
    findings,
    evidenceRefs: evidenceRefs(input.surfaceManifest, "frontend", input.runtimeFlows),
    reviewedSurfaces: ["frontend"],
  })
}

export async function runVisualRuntimeReview(input: {
  taskID?: string
  runID?: string
  deliveryID?: string
  surfaceManifest: DeliverySurfaceManifest
  runtimeFlows: DeliveryRuntimeFlowResult[]
}): Promise<DeliverySpecialistReview | undefined> {
  if (!input.surfaceManifest.surfaces.includes("visual_runtime")) return undefined
  if (!input.taskID || !input.runID || !input.deliveryID) return undefined

  const findings: DeliveryReviewFinding[] = []
  if (input.runtimeFlows.length === 0) {
    findings.push({
      proposedSeverity: "blocking",
      category: "evidence_quality",
      claim: "Visual runtime surface requires rendered browser evidence, but no runtime flow evidence exists.",
      evidence: [{
        kind: "log",
        ref: input.surfaceManifest.id,
        excerpt: "visual_runtime selected without runtimeFlows",
      }],
      affectedRequirementIDs: [],
    })
  }

  for (const flow of input.runtimeFlows) {
    if (flow.status === "failed") {
      findings.push({
        proposedSeverity: "blocking",
        category: "visual",
        claim: `Visual runtime flow failed: ${flow.name}`,
        evidence: [{
          kind: "log",
          ref: flow.id,
          excerpt: flow.evidence.join("\n"),
        }],
        affectedRequirementIDs: [],
      })
      continue
    }
    if (!flow.screenshotPath || !flow.dom) {
      findings.push({
        proposedSeverity: "blocking",
        category: "evidence_quality",
        claim: `Visual runtime flow ${flow.id} passed without screenshot and DOM evidence.`,
        evidence: [{
          kind: "log",
          ref: flow.id,
          excerpt: flow.evidence.join("\n"),
        }],
        affectedRequirementIDs: [],
      })
    }
  }

  return createDeliverySpecialistReview({
    taskId: input.taskID,
    runId: input.runID,
    deliveryId: input.deliveryID,
    reviewer: "visual_runtime",
    executionStatus: "completed",
    summary: findings.length === 0
      ? `Visual runtime review passed with ${input.runtimeFlows.length} rendered flow(s).`
      : `Visual runtime review found ${findings.length} issue(s).`,
    findings,
    evidenceRefs: evidenceRefs(input.surfaceManifest, "visual_runtime", input.runtimeFlows),
    reviewedSurfaces: ["visual_runtime"],
  })
}

function evidenceRefs(
  manifest: DeliverySurfaceManifest,
  surface: "frontend" | "visual_runtime",
  runtimeFlows: DeliveryRuntimeFlowResult[],
) {
  const refs = [
    ...manifest.evidence
      .filter((item) => item.surface === surface || item.surface === "frontend")
      .flatMap((item) => item.refs.map((ref) => `${ref.kind}:${ref.ref}`)),
    ...runtimeFlows.flatMap((flow) => [
      `runtime:${flow.id}`,
      flow.screenshotPath ? `screenshot:${flow.screenshotPath}` : undefined,
      flow.dom ? `dom:${flow.id}` : undefined,
    ]),
  ].filter((item): item is string => Boolean(item))
  if (refs.length === 0) {
    refs.push(`surface:${manifest.id}`)
  }
  return [...new Set(refs)].sort()
}
