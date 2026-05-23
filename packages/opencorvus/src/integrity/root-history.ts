import { listIntegrityAttemptArtifacts } from "@/engine/store"
import type { SpecSnapshotLineage } from "./replay-lineage"

// Consumption stub until the orchestrator-stuck root-history helper lands on
// this branch. The shared owner remains orch-stuck; this module exposes the
// interface build-uptake consumes and only groups findings that carry an
// explicit root id. Findings without one stay one-off facts.
export type IntegrityRootSymptomVariation = {
  attemptNumber: number
  artifactID: string
  findingID: string
  rootID: string
  canonicalLabel: string
  severity: "blocking" | "advisory"
  title: string
  description: string
  repair: string
  evidence: string[]
  reviewerIDs: string[]
  filePaths: string[]
  requirementIDs: string[]
  specIDs: string[]
}

export type IntegrityPersistentRoot = {
  rootID: string
  canonicalLabel: string
  reviewerIDs: string[]
  firstSeenAttempt: number
  latestSeenAttempt: number
  consecutiveAttempts: number[]
  symptomVariations: IntegrityRootSymptomVariation[]
  latestSeverity: "blocking" | "advisory"
}

export type IntegrityRootAttemptSummary = {
  attemptNumber: number
  artifactID: string
  timeCreated: number
  phase?: "pre_build" | "post_build"
  verdict?: "pass" | "concerns" | "needs_correction"
  summary?: string
  teamReportMarkdown?: string
  reviewers: Array<{ reviewerID: string; scope: string; verdict?: string }>
  blockingFindings: IntegrityRootSymptomVariation[]
  advisoryFindings: IntegrityRootSymptomVariation[]
  requiredRepairs: Array<{ id: string; description: string; filePaths: string[] }>
  unresolvedDisagreements: Array<{ id: string; description: string }>
}

export type IntegrityRootHistory = {
  taskID: string
  specSnapshotLineage: SpecSnapshotLineage
  totalAttempts: number
  attempts: IntegrityRootAttemptSummary[]
  persistentBlockingRoots: IntegrityPersistentRoot[]
  latestBlockingFindings: IntegrityRootSymptomVariation[]
  latestAdvisoryFindings: IntegrityRootSymptomVariation[]
}

export function buildIntegrityRootHistory(input: {
  taskID: string
  specSnapshotLineage: SpecSnapshotLineage
  phase?: "pre_build" | "post_build"
}): IntegrityRootHistory {
  if (input.taskID !== input.specSnapshotLineage.taskID) {
    throw new Error(
      `IntegrityRootHistory taskID ${input.taskID} does not match lineage taskID ${input.specSnapshotLineage.taskID}.`,
    )
  }

  const rows = listIntegrityAttemptArtifacts({
    taskID: input.taskID,
    lineage: input.specSnapshotLineage,
    phase: input.phase,
  })
  const attempts = rows
    .slice()
    .reverse()
    .map((row, index) => attemptSummaryFromPayload(row, index + 1))
  const latestAttempt = attempts.at(-1)
  const rootGroups = new Map<string, IntegrityRootSymptomVariation[]>()

  for (const attempt of attempts) {
    for (const finding of [...attempt.blockingFindings, ...attempt.advisoryFindings]) {
      const group = rootGroups.get(finding.rootID) ?? []
      group.push(finding)
      rootGroups.set(finding.rootID, group)
    }
  }

  return {
    taskID: input.taskID,
    specSnapshotLineage: input.specSnapshotLineage,
    totalAttempts: attempts.length,
    attempts,
    persistentBlockingRoots: latestAttempt
      ? persistentBlockingRoots([...rootGroups.values()], latestAttempt.attemptNumber)
      : [],
    latestBlockingFindings: latestAttempt?.blockingFindings ?? [],
    latestAdvisoryFindings: latestAttempt?.advisoryFindings ?? [],
  }
}

function attemptSummaryFromPayload(
  row: { artifactID: string; timeCreated: number; payload: unknown },
  attemptNumber: number,
): IntegrityRootAttemptSummary {
  const payload = asRecord(row.payload)
  const reviewers = reviewerSummaries(payload.reviewers)
  const findings = Array.isArray(payload.findings)
    ? payload.findings.flatMap((item) => findingVariation(item, {
        attemptNumber,
        artifactID: row.artifactID,
        attemptReviewerIDs: reviewers.map((reviewer) => reviewer.reviewerID),
      }))
    : []

  return {
    attemptNumber,
    artifactID: row.artifactID,
    timeCreated: row.timeCreated,
    phase: phaseFrom(payload.phase),
    verdict: verdictFrom(payload.verdict),
    summary: stringFrom(payload.summary) ?? stringFrom(payload.reason),
    teamReportMarkdown: stringFrom(payload.team_report_markdown),
    reviewers,
    blockingFindings: findings.filter((finding) => finding.severity === "blocking"),
    advisoryFindings: findings.filter((finding) => finding.severity === "advisory"),
    requiredRepairs: requiredRepairSummaries(payload.required_repairs),
    unresolvedDisagreements: disagreementSummaries(payload.unresolved_disagreements),
  }
}

function findingVariation(
  value: unknown,
  input: { attemptNumber: number; artifactID: string; attemptReviewerIDs: string[] },
): IntegrityRootSymptomVariation[] {
  const finding = asRecord(value)
  const severity = severityFrom(finding)
  if (!severity) return []
  const findingID = stringFrom(finding.id) ?? "unknown-finding"
  const explicitRootID =
    stringFrom(finding.rootID) ??
    stringFrom(finding.rootId) ??
    stringFrom(finding.root_id) ??
    stringFrom(finding.persistentRootID) ??
    stringFrom(finding.persistent_root_id)
  const rootID = explicitRootID ?? `single:${input.artifactID}:${findingID}`
  const title = stringFrom(finding.title) ?? "Untitled finding"
  return [
    {
      attemptNumber: input.attemptNumber,
      artifactID: input.artifactID,
      findingID,
      rootID,
      canonicalLabel:
        stringFrom(finding.canonicalLabel) ??
        stringFrom(finding.canonical_label) ??
        stringFrom(finding.rootLabel) ??
        stringFrom(finding.root_label) ??
        title,
      severity,
      title,
      description: stringFrom(finding.description) ?? "",
      repair: stringFrom(finding.repair) ?? "",
      evidence: stringArray(finding.evidence),
      reviewerIDs: stringArray(finding.reviewers).length > 0 ? stringArray(finding.reviewers) : input.attemptReviewerIDs,
      filePaths: stringArray(finding.filePaths),
      requirementIDs: stringArray(finding.requirementIDs),
      specIDs: stringArray(finding.specIDs),
    },
  ]
}

function persistentBlockingRoots(
  groups: IntegrityRootSymptomVariation[][],
  latestAttemptNumber: number,
): IntegrityPersistentRoot[] {
  return groups
    .flatMap((variations): IntegrityPersistentRoot[] => {
      const sorted = variations.slice().sort((left, right) => left.attemptNumber - right.attemptNumber)
      const latest = sorted.at(-1)
      if (!latest || latest.attemptNumber !== latestAttemptNumber || latest.severity !== "blocking") return []
      const consecutiveAttempts = latestConsecutiveAttempts(sorted.map((variation) => variation.attemptNumber))
      if (consecutiveAttempts.length < 2) return []
      return [
        {
          rootID: latest.rootID,
          canonicalLabel: latest.canonicalLabel,
          reviewerIDs: unique(sorted.flatMap((variation) => variation.reviewerIDs)).sort(),
          firstSeenAttempt: sorted[0]?.attemptNumber ?? latest.attemptNumber,
          latestSeenAttempt: latest.attemptNumber,
          consecutiveAttempts,
          symptomVariations: sorted,
          latestSeverity: latest.severity,
        },
      ]
    })
    .sort(
      (left, right) =>
        right.consecutiveAttempts.length - left.consecutiveAttempts.length ||
        right.latestSeenAttempt - left.latestSeenAttempt ||
        left.rootID.localeCompare(right.rootID),
    )
}

function latestConsecutiveAttempts(values: number[]): number[] {
  const attempts = unique(values).sort((left, right) => left - right)
  const latest = attempts.at(-1)
  if (latest === undefined) return []
  const out = [latest]
  for (let index = attempts.length - 2; index >= 0; index -= 1) {
    const previous = attempts[index]
    if (previous !== out[0] - 1) break
    out.unshift(previous)
  }
  return out
}

function reviewerSummaries(value: unknown): Array<{ reviewerID: string; scope: string; verdict?: string }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const reviewer = asRecord(item)
    const reviewerID = stringFrom(reviewer.reviewerID) ?? stringFrom(reviewer.id)
    const scope = stringFrom(reviewer.scope) ?? stringFrom(reviewer.focus) ?? stringFrom(reviewer.title)
    if (!reviewerID || !scope) return []
    return [{ reviewerID, scope, verdict: stringFrom(reviewer.verdict) }]
  })
}

function requiredRepairSummaries(value: unknown): IntegrityRootAttemptSummary["requiredRepairs"] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const repair = asRecord(item)
    const id = stringFrom(repair.id)
    const description = stringFrom(repair.description)
    if (!id || !description) return []
    return [{ id, description, filePaths: stringArray(repair.filePaths) }]
  })
}

function disagreementSummaries(value: unknown): IntegrityRootAttemptSummary["unresolvedDisagreements"] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const disagreement = asRecord(item)
    const id = stringFrom(disagreement.id)
    const description = stringFrom(disagreement.description)
    if (!id || !description) return []
    return [{ id, description }]
  })
}

function severityFrom(finding: Record<string, unknown>): "blocking" | "advisory" | undefined {
  const severity = stringFrom(finding.severity)
  const verdictImpact = stringFrom(finding.verdictImpact)
  if (severity === "blocking" || verdictImpact === "needs_correction") return "blocking"
  if (severity === "advisory") return "advisory"
  return undefined
}

function phaseFrom(value: unknown): "pre_build" | "post_build" | undefined {
  return value === "pre_build" || value === "post_build" ? value : undefined
}

function verdictFrom(value: unknown): "pass" | "concerns" | "needs_correction" | undefined {
  return value === "pass" || value === "concerns" || value === "needs_correction" ? value : undefined
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}
