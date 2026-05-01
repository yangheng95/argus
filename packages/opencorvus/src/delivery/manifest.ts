import { createHash } from "node:crypto"
import { and, Database, desc, eq } from "@/storage/db"
import { EngineArtifactTable } from "@/engine/engine.sql"
import { Event as EngineEvent } from "@/engine/model"
import { EngineProtocol } from "@/engine/protocol"
import { Identifier } from "@/id/id"
import type { DeliverySurfaceManifest } from "./surface-detector"
import type { DeliverySpecialistReview } from "./specialist-review"

export type DeliveryCheckStatus = "passed" | "failed" | "skipped"

export type DeliveryRequiredCheck = {
  id: string
  name: string
  label?: string
  family?: string
  command: string
  cwd?: string
  commandDigest: string
}

export type DeliveryCheckResult = DeliveryRequiredCheck & {
  status: DeliveryCheckStatus
  exitCode?: number
  executionCwd?: string
  outputExcerpt: string
  startedAt: number
  completedAt: number
  failureReason?: string
  failureSignature?: FailureSignature
}

export type FailureSignature = {
  checkId: string
  commandDigest: string
  normalizedError: string
  affectedFiles: string[]
}

export type DeliveryGateVerdict = {
  status: "passed" | "failed"
  summary: string
  failedCheckIds: string[]
  failedCoverageIds: string[]
  failedRuntimeFlowIds: string[]
  failedReviewIds: string[]
  functionalAssessment?: DeliveryManifestFunctionalAssessment
}

export type DeliveryManifestFunctionalAssessment = {
  status: "complete" | "incomplete"
  primaryFailureIds: string[]
  auxiliaryFailureIds: string[]
  summary: string
}

export type DeliveryGoalCoverage = {
  goalId: string
  title: string
  priority: "blocking" | "advisory"
  status: "covered" | "uncovered"
  acceptanceSpecCount: number
  evidence: string[]
}

export type DeliveryRequirementCoverage = {
  requirementId: string
  status: "covered" | "uncovered"
  goalIds: string[]
  evidence: string[]
}

export type DeliveryRuntimeFlowResult = {
  id: string
  name: string
  status: "passed" | "failed" | "skipped"
  evidence: string[]
  screenshotPath?: string
  dom?: {
    textLength: number
    nodeCount: number
    hasBodyChildren: boolean
    isEmptyRootShell: boolean
  }
  interaction?: {
    visibleControlCount: number
    textInputCount: number
    fileInputCount: number
    attemptedInteractionCount: number
    textChanged: boolean
    htmlChanged: boolean
    errorCount: number
    errors: string[]
  }
}

export type DeliveryReviewEvidence = {
  id: string
  name: string
  status: "passed" | "failed" | "skipped"
  evidence: string[]
  artifactId?: string
  specSnapshotId?: string
  verdict?: string
}

export type DeliveryEvidenceManifest = {
  id: string
  taskId?: string
  runId?: string
  deliveryId?: string
  iteration: number
  headRef?: string
  requiredChecks: DeliveryRequiredCheck[]
  checkResults: DeliveryCheckResult[]
  goalCoverage: DeliveryGoalCoverage[]
  requirementCoverage: DeliveryRequirementCoverage[]
  runtimeFlows: DeliveryRuntimeFlowResult[]
  reviewEvidence: DeliveryReviewEvidence[]
  surfaceManifest?: DeliverySurfaceManifest
  specialistReviews?: DeliverySpecialistReview[]
  functionalAssessment?: DeliveryManifestFunctionalAssessment
  changedFiles: string[]
  finalGate: DeliveryGateVerdict
  timeCreated: number
}

export type DeliveryManifestFailureDetail = {
  kind: "check" | "coverage" | "runtime" | "review"
  id: string
  name: string
  status?: string
  command?: string
  exitCode?: number
  evidence: string
}

export function digestCommand(input: {
  command: string
  cwd?: string
  script?: string
}) {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex")
}

export function failureSignatureForCheck(input: {
  check: DeliveryRequiredCheck
  output: string
  affectedFiles: string[]
}): FailureSignature {
  return {
    checkId: input.check.id,
    commandDigest: input.check.commandDigest,
    normalizedError: normalizeFailureOutput(input.output),
    affectedFiles: input.affectedFiles,
  }
}

function normalizeFailureOutput(output: string) {
  const withoutAnsi = output.replace(/\x1b\[[0-9;]*m/g, "")
  return withoutAnsi
    .replace(/[A-Z]:\\[^\s)]+/g, "<path>")
    .replace(/\/[^\s)]+/g, "<path>")
    .replace(/\b\d{2,}\b/g, "<number>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500)
}

export function validateDeliveryEvidenceManifest(
  manifest: DeliveryEvidenceManifest,
): DeliveryGateVerdict {
  const resultById = new Map(manifest.checkResults.map((item) => [item.id, item]))
  const failedCheckIds: string[] = []

  for (const required of manifest.requiredChecks) {
    const result = resultById.get(required.id)
    if (!result) {
      failedCheckIds.push(required.id)
      continue
    }
    if (result.commandDigest !== required.commandDigest) {
      failedCheckIds.push(required.id)
      continue
    }
    if (result.status !== "passed") {
      failedCheckIds.push(required.id)
    }
  }

  return {
    status: failedCheckIds.length === 0 ? "passed" : "failed",
    failedCheckIds,
    failedCoverageIds: [],
    failedRuntimeFlowIds: [],
    failedReviewIds: [],
    summary: failedCheckIds.length === 0
      ? `Delivery evidence gate passed ${manifest.requiredChecks.length} required check(s).`
      : `Delivery evidence gate failed ${failedCheckIds.length} required check(s).`,
  }
}

export function validateDeliveryCoverage(input: {
  goalCoverage: DeliveryGoalCoverage[]
  requirementCoverage: DeliveryRequirementCoverage[]
}) {
  const failedCoverageIds = [
    ...input.goalCoverage
      .filter((item) => item.priority === "blocking" && item.status !== "covered")
      .map((item) => `goal:${item.goalId}`),
    ...input.requirementCoverage
      .filter((item) => item.status !== "covered")
      .map((item) => `requirement:${item.requirementId}`),
  ]
  return failedCoverageIds
}

export function deliveryManifestFailureDetails(
  manifest: DeliveryEvidenceManifest,
): DeliveryManifestFailureDetail[] {
  const failedCheckIds = new Set(manifest.finalGate.failedCheckIds)
  const failedCoverageIds = new Set(manifest.finalGate.failedCoverageIds)
  const failedRuntimeFlowIds = new Set(manifest.finalGate.failedRuntimeFlowIds)
  const failedReviewIds = new Set(manifest.finalGate.failedReviewIds ?? [])

  const checkDetails = manifest.checkResults
    .filter((item) => failedCheckIds.has(item.id) || item.status === "failed")
    .map((item) => ({
      kind: "check" as const,
      id: item.id,
      name: item.label ?? item.name,
      status: item.status,
      command: item.command,
      exitCode: item.exitCode,
      evidence: firstEvidence([
        item.failureReason,
        item.failureSignature?.normalizedError,
        item.outputExcerpt,
      ]),
    }))

  const missingCheckDetails = manifest.requiredChecks
    .filter((item) =>
      failedCheckIds.has(item.id) &&
      !manifest.checkResults.some((result) => result.id === item.id),
    )
    .map((item) => ({
      kind: "check" as const,
      id: item.id,
      name: item.label ?? item.name,
      status: "missing",
      command: item.command,
      evidence: "Required check did not produce a result.",
    }))

  const goalCoverageDetails = manifest.goalCoverage
    .filter((item) => failedCoverageIds.has(`goal:${item.goalId}`))
    .map((item) => ({
      kind: "coverage" as const,
      id: `goal:${item.goalId}`,
      name: item.title,
      status: item.status,
      evidence: firstEvidence(item.evidence),
    }))

  const requirementCoverageDetails = manifest.requirementCoverage
    .filter((item) => failedCoverageIds.has(`requirement:${item.requirementId}`))
    .map((item) => ({
      kind: "coverage" as const,
      id: `requirement:${item.requirementId}`,
      name: item.requirementId,
      status: item.status,
      evidence: firstEvidence(item.evidence),
    }))

  const runtimeDetails = manifest.runtimeFlows
    .filter((item) => failedRuntimeFlowIds.has(item.id) || item.status === "failed")
    .map((item) => ({
      kind: "runtime" as const,
      id: item.id,
      name: item.name,
      status: item.status,
      evidence: firstEvidence([
        ...item.evidence,
        ...(item.interaction?.errors ?? []),
        item.dom ? `dom.textLength=${item.dom.textLength} nodes=${item.dom.nodeCount}` : undefined,
      ]),
    }))

  const reviewDetails = manifest.reviewEvidence
    .filter((item) => failedReviewIds.has(item.id) || item.status === "failed")
    .map((item) => ({
      kind: "review" as const,
      id: item.id,
      name: item.name,
      status: item.status,
      evidence: firstEvidence(item.evidence),
    }))

  return sortFailureDetailsByFunctionalPriority(manifest, [
    ...checkDetails,
    ...missingCheckDetails,
    ...goalCoverageDetails,
    ...requirementCoverageDetails,
    ...runtimeDetails,
    ...reviewDetails,
  ])
}

function sortFailureDetailsByFunctionalPriority(
  manifest: DeliveryEvidenceManifest,
  details: DeliveryManifestFailureDetail[],
) {
  const primary = new Set(manifest.functionalAssessment?.primaryFailureIds ?? [])
  const auxiliary = new Set(manifest.functionalAssessment?.auxiliaryFailureIds ?? [])
  const rank = (id: string) =>
    primary.has(id) ? 0 :
    auxiliary.has(id) ? 1 :
    2
  return [...details].sort((a, b) =>
    rank(a.id) - rank(b.id) || a.id.localeCompare(b.id)
  )
}

export function formatDeliveryManifestFailureDetails(
  manifest: DeliveryEvidenceManifest,
  limit = 20,
): string[] {
  return deliveryManifestFailureDetails(manifest).slice(0, limit).map((item) => {
    const status = item.status ? ` status=${item.status}` : ""
    const command = item.command ? ` command=${item.command}` : ""
    const exitCode = item.exitCode === undefined ? "" : ` exit=${item.exitCode}`
    return `[${item.kind}] ${item.id} ${item.name}${status}${exitCode}${command}: ${item.evidence}`
  })
}

function firstEvidence(items: Array<string | undefined>): string {
  const found = items.find((item) => typeof item === "string" && item.trim().length > 0)
  return found?.trim().slice(0, 500) ?? "No evidence captured."
}

export function persistDeliveryEvidenceManifest(input: {
  manifest: DeliveryEvidenceManifest
}) {
  if (!input.manifest.taskId || !input.manifest.runId || !input.manifest.deliveryId) {
    return
  }
  Database.use((db) => {
    if (input.manifest.surfaceManifest) {
      db.insert(EngineArtifactTable).values({
        id: input.manifest.surfaceManifest.id,
        task_id: input.manifest.taskId!,
        run_id: input.manifest.runId!,
        delivery_id: input.manifest.deliveryId!,
        kind: "delivery_surface_manifest",
        label: "delivery-surface-manifest",
        payload: input.manifest.surfaceManifest,
        time_created: input.manifest.surfaceManifest.timeCreated,
        time_updated: input.manifest.surfaceManifest.timeCreated,
      }).run()
    }
    for (const review of input.manifest.specialistReviews ?? []) {
      db.insert(EngineArtifactTable).values({
        id: review.id,
        task_id: review.taskId,
        run_id: review.runId,
        goal_run_id: review.goalRunId,
        delivery_id: review.deliveryId,
        kind: "delivery_specialist_review",
        label: `delivery-specialist-review:${review.reviewer}`,
        payload: review,
        time_created: review.timeCreated,
        time_updated: review.timeCreated,
      }).run()
    }
    db.insert(EngineArtifactTable).values({
      id: input.manifest.id,
      task_id: input.manifest.taskId!,
      run_id: input.manifest.runId!,
      delivery_id: input.manifest.deliveryId!,
      kind: "delivery_evidence_manifest",
      label: "delivery-evidence-manifest",
      payload: input.manifest,
      time_created: input.manifest.timeCreated,
      time_updated: input.manifest.timeCreated,
    }).run()
  })
  void EngineProtocol.emit(
    EngineEvent.DeliveryEvidenceUpdated,
    {
      taskID: input.manifest.taskId!,
      runID: input.manifest.runId,
      deliveryID: input.manifest.deliveryId!,
      manifestID: input.manifest.id,
      iteration: input.manifest.iteration,
      status: input.manifest.finalGate.status,
      summary: input.manifest.finalGate.summary,
      failedCheckCount: input.manifest.finalGate.failedCheckIds.length,
      failedRuntimeFlowCount: input.manifest.finalGate.failedRuntimeFlowIds.length,
      failedReviewCount: (input.manifest.finalGate.failedReviewIds ?? []).length,
      failureDetails: deliveryManifestFailureDetails(input.manifest).slice(0, 20),
    },
    { source: "delivery.manifest" },
  )
}

export function findLatestDeliverySurfaceManifest(input: {
  deliveryID: string
}): DeliverySurfaceManifest | undefined {
  const row = Database.use((db) =>
    db.select().from(EngineArtifactTable)
      .where(and(
        eq(EngineArtifactTable.delivery_id, input.deliveryID),
        eq(EngineArtifactTable.kind, "delivery_surface_manifest"),
      ))
      .orderBy(desc(EngineArtifactTable.time_created))
      .get(),
  )
  return row?.payload as DeliverySurfaceManifest | undefined
}

export function findLatestDeliveryEvidenceManifest(input: {
  deliveryID: string
}): DeliveryEvidenceManifest | undefined {
  const row = Database.use((db) =>
    db.select().from(EngineArtifactTable)
      .where(and(
        eq(EngineArtifactTable.delivery_id, input.deliveryID),
        eq(EngineArtifactTable.kind, "delivery_evidence_manifest"),
      ))
      .orderBy(desc(EngineArtifactTable.time_created))
      .get(),
  )
  return row?.payload as DeliveryEvidenceManifest | undefined
}

export function findPreviousDeliveryEvidenceManifest(input: {
  taskID: string
  beforeTime: number
}): DeliveryEvidenceManifest | undefined {
  return findDeliveryEvidenceManifestHistory(input)[0]
}

export function findDeliveryEvidenceManifestHistory(input: {
  taskID: string
  beforeTime: number
  limit?: number
}): DeliveryEvidenceManifest[] {
  const limit = input.limit ?? 5
  const rows = Database.use((db) =>
    db.select().from(EngineArtifactTable)
      .where(and(
        eq(EngineArtifactTable.task_id, input.taskID),
        eq(EngineArtifactTable.kind, "delivery_evidence_manifest"),
      ))
      .orderBy(desc(EngineArtifactTable.time_created))
      .all()
      .filter((item) => item.time_created < input.beforeTime)
      .slice(0, limit),
  )
  return rows
    .map((row) => row.payload as DeliveryEvidenceManifest | undefined)
    .filter((item): item is DeliveryEvidenceManifest => Boolean(item))
}

export function deliveryFailureSignatureKeys(manifest: DeliveryEvidenceManifest): string[] {
  const checkKeys = manifest.checkResults
    .filter((item) => item.status === "failed")
    .map((item) =>
      item.failureSignature
        ? `check:${item.failureSignature.checkId}:${item.failureSignature.commandDigest}:${item.failureSignature.normalizedError}`
        : `check:${item.id}:${item.commandDigest}:${item.failureReason ?? item.outputExcerpt}`,
    )
  const coverageKeys = manifest.finalGate.failedCoverageIds.map((item) => `coverage:${item}`)
  const runtimeKeys = manifest.finalGate.failedRuntimeFlowIds.map((item) => `runtime:${item}`)
  const reviewKeys = (manifest.finalGate.failedReviewIds ?? []).map((item) => `review:${item}`)
  const specialistKeys = (manifest.specialistReviews ?? [])
    .flatMap((review) =>
      review.findings
        .filter((finding) => finding.proposedSeverity === "blocking")
        .map((finding) => `specialist:${review.reviewer}:${finding.category}:${finding.claim}`),
    )
  return [...new Set([...checkKeys, ...coverageKeys, ...runtimeKeys, ...reviewKeys, ...specialistKeys])].sort()
}

export function repeatedDeliveryFailureSignatures(input: {
  current: DeliveryEvidenceManifest
  previous?: DeliveryEvidenceManifest
  history?: DeliveryEvidenceManifest[]
}): { repeated: boolean; signatures: string[] } {
  const current = deliveryFailureSignatureKeys(input.current)
  if (current.length === 0) return { repeated: false, signatures: [] }
  const history = input.history ?? (input.previous ? [input.previous] : [])
  for (const manifest of history) {
    const previous = new Set(deliveryFailureSignatureKeys(manifest))
    const repeated = current.filter((item) => previous.has(item))
    if (repeated.length === current.length) {
      return {
        repeated: true,
        signatures: repeated,
      }
    }
  }
  return { repeated: false, signatures: [] }
}

export function createManifestId() {
  return Identifier.ascending("artifact")
}
