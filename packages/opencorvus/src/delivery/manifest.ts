import { createHash } from "node:crypto"
import { and, Database, desc, eq } from "@/storage/db"
import { EngineArtifactTable } from "@/engine/engine.sql"
import { Identifier } from "@/id/id"

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
  changedFiles: string[]
  finalGate: DeliveryGateVerdict
  timeCreated: number
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

export function mergeGateVerdicts(input: {
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

export function persistDeliveryEvidenceManifest(input: {
  manifest: DeliveryEvidenceManifest
}) {
  if (!input.manifest.taskId || !input.manifest.runId || !input.manifest.deliveryId) {
    return
  }
  Database.use((db) =>
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
    }).run(),
  )
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
  return [...new Set([...checkKeys, ...coverageKeys, ...runtimeKeys, ...reviewKeys])].sort()
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
