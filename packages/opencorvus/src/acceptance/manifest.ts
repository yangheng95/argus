import { createHash } from "node:crypto"
import { and, Database, desc, eq } from "@/storage/db"
import { EngineArtifactTable } from "@/engine/engine.sql"
import { Event as EngineEvent } from "@/engine/model"
import { EngineProtocol } from "@/engine/protocol"
import { Identifier } from "@/id/id"
import type { AcceptanceSurfaceManifest } from "./surface-detector"
import type { AcceptanceSpecialistReview } from "./specialist-review"
import type { ProjectRuntimeReadiness } from "./checks/runtime-readiness"

export type AcceptanceCheckStatus = "passed" | "failed" | "skipped"

export type AcceptanceRequiredCheck = {
  id: string
  name: string
  label?: string
  family?: string
  command: string
  cwd?: string
  commandDigest: string
}

export type AcceptanceCheckResult = AcceptanceRequiredCheck & {
  status: AcceptanceCheckStatus
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

export type AcceptanceGateVerdict = {
  status: "passed" | "failed"
  summary: string
  failedReadinessIds?: string[]
  failedCheckIds: string[]
  failedCoverageIds: string[]
  failedReviewIds: string[]
  functionalAssessment?: AcceptanceManifestFunctionalAssessment
}

export type AcceptanceManifestFunctionalAssessment = {
  status: "complete" | "incomplete"
  primaryFailureIds: string[]
  auxiliaryFailureIds: string[]
  summary: string
}

export type AcceptanceGoalCoverage = {
  goalId: string
  title: string
  priority: "blocking" | "advisory"
  status: "covered" | "uncovered"
  acceptanceSpecCount: number
  evidence: string[]
}

export type AcceptanceRequirementCoverage = {
  requirementId: string
  status: "covered" | "uncovered"
  goalIds: string[]
  evidence: string[]
}

export type AcceptanceReviewEvidence = {
  id: string
  name: string
  status: "passed" | "failed" | "skipped"
  evidence: string[]
  artifactId?: string
  specSnapshotId?: string
  verdict?: string
}

export type AcceptanceEvidenceManifest = {
  id: string
  taskId?: string
  runId?: string
  acceptanceId?: string
  iteration: number
  headRef?: string
  requiredChecks: AcceptanceRequiredCheck[]
  runtimeReadiness?: ProjectRuntimeReadiness
  checkResults: AcceptanceCheckResult[]
  goalCoverage: AcceptanceGoalCoverage[]
  requirementCoverage: AcceptanceRequirementCoverage[]
  reviewEvidence: AcceptanceReviewEvidence[]
  surfaceManifest?: AcceptanceSurfaceManifest
  specialistReviews?: AcceptanceSpecialistReview[]
  functionalAssessment?: AcceptanceManifestFunctionalAssessment
  changedFiles: string[]
  finalGate: AcceptanceGateVerdict
  timeCreated: number
}

export type AcceptanceManifestFailureDetail = {
  kind: "readiness" | "check" | "coverage" | "review"
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
  check: AcceptanceRequiredCheck
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

export function validateAcceptanceEvidenceManifest(
  manifest: AcceptanceEvidenceManifest,
  options: { skippedChecksPass?: boolean } = {},
): AcceptanceGateVerdict {
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
    if (result.status === "skipped" && options.skippedChecksPass) {
      continue
    }
    if (result.status !== "passed") {
      failedCheckIds.push(required.id)
    }
  }

  return {
    status: failedCheckIds.length === 0 ? "passed" : "failed",
    failedReadinessIds: manifest.runtimeReadiness?.failedReadinessIds ?? [],
    failedCheckIds,
    failedCoverageIds: [],
    failedReviewIds: [],
    summary: failedCheckIds.length === 0
      ? `Acceptance evidence gate passed ${manifest.requiredChecks.length} required check(s).`
      : `Acceptance evidence gate failed ${failedCheckIds.length} required check(s).`,
  }
}

export function validateAcceptanceCoverage(input: {
  goalCoverage: AcceptanceGoalCoverage[]
  requirementCoverage: AcceptanceRequirementCoverage[]
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

export function acceptanceManifestFailureDetails(
  manifest: AcceptanceEvidenceManifest,
): AcceptanceManifestFailureDetail[] {
  const failedReadinessIds = new Set(manifest.finalGate.failedReadinessIds ?? [])
  const failedCheckIds = new Set(manifest.finalGate.failedCheckIds)
  const failedCoverageIds = new Set(manifest.finalGate.failedCoverageIds)
  const failedReviewIds = new Set(manifest.finalGate.failedReviewIds ?? [])

  const readinessDetails = (manifest.runtimeReadiness?.checks ?? [])
    .filter((item) => failedReadinessIds.has(item.id) || item.status === "failed")
    .map((item) => ({
      kind: "readiness" as const,
      id: item.id,
      name: item.name,
      status: item.status,
      command: item.command,
      exitCode: item.exitCode,
      evidence: firstEvidence(item.evidence),
    }))

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
    ...readinessDetails,
    ...checkDetails,
    ...missingCheckDetails,
    ...goalCoverageDetails,
    ...requirementCoverageDetails,
    ...reviewDetails,
  ])
}

function sortFailureDetailsByFunctionalPriority(
  manifest: AcceptanceEvidenceManifest,
  details: AcceptanceManifestFailureDetail[],
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

export function formatAcceptanceManifestFailureDetails(
  manifest: AcceptanceEvidenceManifest,
  limit = 20,
): string[] {
  return acceptanceManifestFailureDetails(manifest).slice(0, limit).map((item) => {
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

export function persistAcceptanceEvidenceManifest(input: {
  manifest: AcceptanceEvidenceManifest
}) {
  if (!input.manifest.taskId || !input.manifest.runId || !input.manifest.acceptanceId) {
    return
  }
  Database.use((db) => {
    if (input.manifest.surfaceManifest) {
      db.insert(EngineArtifactTable).values({
        id: input.manifest.surfaceManifest.id,
        task_id: input.manifest.taskId!,
        run_id: input.manifest.runId!,
        acceptance_id: input.manifest.acceptanceId!,
        kind: "acceptance_surface_manifest",
        label: "acceptance-surface-manifest",
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
        acceptance_id: review.acceptanceId,
        kind: "acceptance_specialist_review",
        label: `acceptance-specialist-review:${review.reviewer}`,
        payload: review,
        time_created: review.timeCreated,
        time_updated: review.timeCreated,
      }).run()
    }
    db.insert(EngineArtifactTable).values({
      id: input.manifest.id,
      task_id: input.manifest.taskId!,
      run_id: input.manifest.runId!,
      acceptance_id: input.manifest.acceptanceId!,
      kind: "acceptance_evidence_manifest",
      label: "acceptance-evidence-manifest",
      payload: input.manifest,
      time_created: input.manifest.timeCreated,
      time_updated: input.manifest.timeCreated,
    }).run()
  })
  void EngineProtocol.emit(
    EngineEvent.AcceptanceEvidenceUpdated,
    {
      taskID: input.manifest.taskId!,
      runID: input.manifest.runId,
      acceptanceID: input.manifest.acceptanceId!,
      manifestID: input.manifest.id,
      iteration: input.manifest.iteration,
      status: input.manifest.finalGate.status,
      summary: input.manifest.finalGate.summary,
      failedCheckCount: input.manifest.finalGate.failedCheckIds.length,
      failedReviewCount: (input.manifest.finalGate.failedReviewIds ?? []).length,
      failureDetails: acceptanceManifestFailureDetails(input.manifest).slice(0, 20),
    },
    { source: "acceptance.manifest" },
  )
}

export function findLatestAcceptanceSurfaceManifest(input: {
  acceptanceID: string
}): AcceptanceSurfaceManifest | undefined {
  const row = Database.use((db) =>
    db.select().from(EngineArtifactTable)
      .where(and(
        eq(EngineArtifactTable.acceptance_id, input.acceptanceID),
        eq(EngineArtifactTable.kind, "acceptance_surface_manifest"),
      ))
      .orderBy(desc(EngineArtifactTable.time_created))
      .get(),
  )
  return row?.payload as AcceptanceSurfaceManifest | undefined
}

export function findLatestAcceptanceEvidenceManifest(input: {
  acceptanceID: string
}): AcceptanceEvidenceManifest | undefined {
  const row = Database.use((db) =>
    db.select().from(EngineArtifactTable)
      .where(and(
        eq(EngineArtifactTable.acceptance_id, input.acceptanceID),
        eq(EngineArtifactTable.kind, "acceptance_evidence_manifest"),
      ))
      .orderBy(desc(EngineArtifactTable.time_created))
      .get(),
  )
  return row?.payload as AcceptanceEvidenceManifest | undefined
}

export function findPreviousAcceptanceEvidenceManifest(input: {
  taskID: string
  beforeTime: number
}): AcceptanceEvidenceManifest | undefined {
  return findAcceptanceEvidenceManifestHistory(input)[0]
}

export function findAcceptanceEvidenceManifestHistory(input: {
  taskID: string
  beforeTime: number
  limit?: number
}): AcceptanceEvidenceManifest[] {
  const limit = input.limit ?? 5
  const rows = Database.use((db) =>
    db.select().from(EngineArtifactTable)
      .where(and(
        eq(EngineArtifactTable.task_id, input.taskID),
        eq(EngineArtifactTable.kind, "acceptance_evidence_manifest"),
      ))
      .orderBy(desc(EngineArtifactTable.time_created))
      .all()
      .filter((item) => item.time_created < input.beforeTime)
      .slice(0, limit),
  )
  return rows
    .map((row) => row.payload as AcceptanceEvidenceManifest | undefined)
    .filter((item): item is AcceptanceEvidenceManifest => Boolean(item))
}

export function acceptanceFailureSignatureKeys(manifest: AcceptanceEvidenceManifest): string[] {
  const readinessKeys = (manifest.finalGate.failedReadinessIds ?? []).map((item) => `readiness:${item}`)
  const checkKeys = manifest.checkResults
    .filter((item) => item.status === "failed")
    .map((item) =>
      item.failureSignature
        ? `check:${item.failureSignature.checkId}:${item.failureSignature.commandDigest}:${item.failureSignature.normalizedError}`
        : `check:${item.id}:${item.commandDigest}:${item.failureReason ?? item.outputExcerpt}`,
    )
  const coverageKeys = manifest.finalGate.failedCoverageIds.map((item) => `coverage:${item}`)
  const reviewKeys = (manifest.finalGate.failedReviewIds ?? []).map((item) => `review:${item}`)
  const specialistKeys = (manifest.specialistReviews ?? [])
    .flatMap((review) =>
      review.findings
        .filter((finding) => finding.proposedSeverity === "blocking")
        .map((finding) => `specialist:${review.reviewer}:${finding.category}:${finding.claim}`),
    )
  return [...new Set([...readinessKeys, ...checkKeys, ...coverageKeys, ...reviewKeys, ...specialistKeys])].sort()
}

export function repeatedAcceptanceFailureSignatures(input: {
  current: AcceptanceEvidenceManifest
  previous?: AcceptanceEvidenceManifest
  history?: AcceptanceEvidenceManifest[]
}): { repeated: boolean; signatures: string[] } {
  const current = acceptanceFailureSignatureKeys(input.current)
  if (current.length === 0) return { repeated: false, signatures: [] }
  const history = input.history ?? (input.previous ? [input.previous] : [])
  for (const manifest of history) {
    const previous = new Set(acceptanceFailureSignatureKeys(manifest))
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

/**
 * Count how many `acceptance_repeated_failure_signature_*` decisions exist in
 * a task's decision-log slice. Used only for operator and orchestrator
 * context: repeated acceptance signatures are strategy-change feedback, not
 * authorization to terminal-fail a task.
 */
export function countPriorRepeatedAcceptanceFailureSignals(
  decisions: ReadonlyArray<{ key: string }>,
): number {
  return decisions.filter((entry) =>
    entry.key.startsWith("acceptance_repeated_failure_signature_"),
  ).length
}
