import type { GoalContractFields } from "@/pipeline/types"
import type { ParsedRequirement } from "@/requirements/types"
import type { DeliveryRow, GoalRunRow } from "@/engine/store"
import { listIntegrityAttemptArtifacts } from "@/engine/store"

export type IntegrityPriorAttemptSummary = {
  attemptNumber: number
  artifactID: string
  timeCreated: number
  phase?: "pre_build" | "post_build"
  verdict?: "pass" | "concerns" | "needs_correction"
  summary?: string
  reviewers: Array<{ reviewerID: string; scope: string; verdict?: string }>
  blockingFindings: Array<{
    id: string
    title: string
    description: string
    repair: string
    filePaths: string[]
    requirementIDs: string[]
    specIDs: string[]
  }>
  requiredRepairs: Array<{ id: string; description: string; filePaths: string[] }>
  unresolvedDisagreements: Array<{ id: string; description: string }>
}

export type IntegrityBuildEvidenceSinceLastReview = {
  sinceAttemptNumber?: number
  sinceTimeCreated?: number
  changedFiles: string[]
  diffs: Array<{ file: string; status?: string; additions?: number; deletions?: number }>
  deliverySummaries: string[]
  goalRuns: Array<{
    goalID: string
    goalRunID: string
    status: string
    timeCreated: number
    timeCompleted?: number | null
  }>
}

export type IntegrityReviewScaleSignals = {
  goals: number
  requirements: number
  acceptanceSpecs: number
  changedFilesTotal: number
  changedFilesSinceLastReview: number
  priorAttempts: number
  priorBlockingFindings: number
  phase?: "pre_build" | "post_build"
}

export type IntegrityReplayContext = {
  attemptNumber: number
  priorAttempts: IntegrityPriorAttemptSummary[]
  buildEvidenceSinceLastReview: IntegrityBuildEvidenceSinceLastReview
  scaleSignals: IntegrityReviewScaleSignals
}

export function buildIntegrityReplayContext(input: {
  taskID: string
  specSnapshotID: string
  phase?: "pre_build" | "post_build"
  goals: GoalContractFields[]
  requirements?: ParsedRequirement[]
  deliveries: DeliveryRow[]
  goalRuns: GoalRunRow[]
}): IntegrityReplayContext {
  const newestFirstAttempts = listIntegrityAttemptArtifacts({
    taskID: input.taskID,
    specSnapshotID: input.specSnapshotID,
  })
  const chronologicalAttempts = newestFirstAttempts.slice().reverse()
  const priorAttempts = chronologicalAttempts.map((row, index): IntegrityPriorAttemptSummary => {
    const payload = asRecord(row.payload)
    return {
      attemptNumber: index + 1,
      artifactID: row.id,
      timeCreated: row.time_created,
      phase: phaseFrom(payload.phase),
      verdict: verdictFrom(payload.verdict),
      summary: stringFrom(payload.summary) ?? stringFrom(payload.reason),
      reviewers: reviewerSummaries(payload.reviewers),
      blockingFindings: blockingFindingSummaries(payload.findings),
      requiredRepairs: requiredRepairSummaries(payload.required_repairs),
      unresolvedDisagreements: disagreementSummaries(payload.unresolved_disagreements),
    }
  })
  const latestPrior = priorAttempts.at(-1)
  const sinceTimeCreated = latestPrior?.timeCreated
  const deliveriesSince = sinceTimeCreated === undefined
    ? input.deliveries
    : input.deliveries.filter((delivery) => delivery.time_created > sinceTimeCreated)
  const goalRunsSince = sinceTimeCreated === undefined
    ? input.goalRuns
    : input.goalRuns.filter((run) => (run.time_completed ?? run.time_created) > sinceTimeCreated)
  const changedFilesTotal = changedFilesFromDeliveries(input.deliveries)
  const changedFilesSinceLastReview = changedFilesFromDeliveries(deliveriesSince)

  return {
    attemptNumber: priorAttempts.length + 1,
    priorAttempts,
    buildEvidenceSinceLastReview: {
      sinceAttemptNumber: latestPrior?.attemptNumber,
      sinceTimeCreated,
      changedFiles: changedFilesSinceLastReview,
      diffs: diffsFromDeliveries(deliveriesSince),
      deliverySummaries: deliveriesSince.map((delivery) => delivery.summary).filter((item) => item.trim().length > 0),
      goalRuns: goalRunsSince.map((run) => ({
        goalID: run.goal_id,
        goalRunID: run.id,
        status: run.status,
        timeCreated: run.time_created,
        timeCompleted: run.time_completed,
      })),
    },
    scaleSignals: {
      goals: input.goals.length,
      requirements: input.requirements?.length ?? 0,
      acceptanceSpecs: input.goals.reduce((sum, goal) => sum + goal.acceptance_specs.length, 0),
      changedFilesTotal: changedFilesTotal.length,
      changedFilesSinceLastReview: changedFilesSinceLastReview.length,
      priorAttempts: priorAttempts.length,
      priorBlockingFindings: priorAttempts.reduce((sum, attempt) => sum + attempt.blockingFindings.length, 0),
      phase: input.phase,
    },
  }
}

export function renderIntegrityReplayContextPrompt(context: IntegrityReplayContext): string {
  const lines = ["# Integrity Replay Context", "", `Current integrity attempt: #${context.attemptNumber}.`, ""]
  if (context.priorAttempts.length === 0) {
    lines.push(
      "No prior integrity attempts exist for this task/spec snapshot. Treat this as a first review and choose reviewers from the actual request, goals, requirements, changed files, runtime evidence, and risk surface.",
      "",
    )
  } else {
    lines.push("Prior attempts for this task/spec:")
    for (const attempt of context.priorAttempts) {
      lines.push(
        `- Attempt #${attempt.attemptNumber} at ${new Date(attempt.timeCreated).toISOString()}, phase=${attempt.phase ?? "unknown"}, verdict=${attempt.verdict ?? "unknown"}, reviewers=${attempt.reviewers.length}.`,
      )
      if (attempt.summary) lines.push(`  Summary: ${attempt.summary}`)
      if (attempt.reviewers.length > 0) {
        lines.push("  Reviewer focuses:")
        for (const reviewer of attempt.reviewers) {
          lines.push(`  - ${reviewer.reviewerID}: ${reviewer.scope}${reviewer.verdict ? ` (${reviewer.verdict})` : ""}`)
        }
      }
      if (attempt.blockingFindings.length > 0) {
        lines.push("  Blocking findings:")
        for (const finding of attempt.blockingFindings) {
          lines.push(`  - ${finding.id}: ${finding.title}`)
          if (finding.description) lines.push(`    description: ${finding.description}`)
          if (finding.repair) lines.push(`    repair: ${finding.repair}`)
          if (finding.filePaths.length > 0) lines.push(`    files: ${finding.filePaths.join(", ")}`)
          if (finding.requirementIDs.length > 0) lines.push(`    requirements: ${finding.requirementIDs.join(", ")}`)
          if (finding.specIDs.length > 0) lines.push(`    specs: ${finding.specIDs.join(", ")}`)
        }
      }
      if (attempt.requiredRepairs.length > 0) {
        lines.push("  Required repairs:")
        for (const repair of attempt.requiredRepairs) {
          lines.push(`  - ${repair.id}: ${repair.description}`)
          if (repair.filePaths.length > 0) lines.push(`    files: ${repair.filePaths.join(", ")}`)
        }
      }
      if (attempt.unresolvedDisagreements.length > 0) {
        lines.push("  Unresolved disagreements:")
        for (const disagreement of attempt.unresolvedDisagreements) {
          lines.push(`  - ${disagreement.id}: ${disagreement.description}`)
        }
      }
    }
    lines.push("")
  }

  const evidence = context.buildEvidenceSinceLastReview
  lines.push("Build evidence after latest integrity attempt:")
  if (evidence.sinceAttemptNumber !== undefined) lines.push(`- Since attempt: #${evidence.sinceAttemptNumber}`)
  if (evidence.sinceTimeCreated !== undefined) {
    lines.push(`- Since time: ${new Date(evidence.sinceTimeCreated).toISOString()}`)
  }
  lines.push(`- Changed files: ${evidence.changedFiles.length > 0 ? evidence.changedFiles.join(", ") : "(none)"}`)
  if (evidence.diffs.length > 0) {
    lines.push("- Diffs:")
    for (const diff of evidence.diffs) {
      const stats = [
        diff.status ? `status=${diff.status}` : "",
        diff.additions !== undefined ? `+${diff.additions}` : "",
        diff.deletions !== undefined ? `-${diff.deletions}` : "",
      ].filter(Boolean)
      lines.push(`  - ${diff.file}${stats.length > 0 ? ` (${stats.join(", ")})` : ""}`)
    }
  }
  if (evidence.deliverySummaries.length > 0) {
    lines.push("- Delivery summaries:")
    for (const summary of evidence.deliverySummaries) lines.push(`  - ${summary}`)
  }
  if (evidence.goalRuns.length > 0) {
    lines.push("- Goal runs after latest review:")
    for (const run of evidence.goalRuns) {
      lines.push(
        `  - ${run.goalID}/${run.goalRunID}: ${run.status}, created=${new Date(run.timeCreated).toISOString()}${run.timeCompleted ? `, completed=${new Date(run.timeCompleted).toISOString()}` : ""}`,
      )
    }
  }

  const scale = context.scaleSignals
  lines.push("", "Scale signals:")
  lines.push(`- goals=${scale.goals}`)
  lines.push(`- requirements=${scale.requirements}`)
  lines.push(`- acceptance_specs=${scale.acceptanceSpecs}`)
  lines.push(`- changed_files_total=${scale.changedFilesTotal}`)
  lines.push(`- changed_files_since_last_review=${scale.changedFilesSinceLastReview}`)
  lines.push(`- prior_attempts=${scale.priorAttempts}`)
  lines.push(`- prior_blocking_findings=${scale.priorBlockingFindings}`)
  if (scale.phase) lines.push(`- phase=${scale.phase}`)
  return lines.join("\n")
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

function phaseFrom(value: unknown): "pre_build" | "post_build" | undefined {
  return value === "pre_build" || value === "post_build" ? value : undefined
}

function verdictFrom(value: unknown): "pass" | "concerns" | "needs_correction" | undefined {
  return value === "pass" || value === "concerns" || value === "needs_correction" ? value : undefined
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

function blockingFindingSummaries(value: unknown): IntegrityPriorAttemptSummary["blockingFindings"] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const finding = asRecord(item)
    const severity = stringFrom(finding.severity)
    const verdictImpact = stringFrom(finding.verdictImpact)
    if (severity !== "blocking" && verdictImpact !== "needs_correction") return []
    return [
      {
        id: stringFrom(finding.id) ?? "unknown-finding",
        title: stringFrom(finding.title) ?? "Untitled finding",
        description: stringFrom(finding.description) ?? "",
        repair: stringFrom(finding.repair) ?? "",
        filePaths: stringArray(finding.filePaths),
        requirementIDs: stringArray(finding.requirementIDs),
        specIDs: stringArray(finding.specIDs),
      },
    ]
  })
}

function requiredRepairSummaries(value: unknown): IntegrityPriorAttemptSummary["requiredRepairs"] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const repair = asRecord(item)
    const id = stringFrom(repair.id)
    const description = stringFrom(repair.description)
    if (!id || !description) return []
    return [{ id, description, filePaths: stringArray(repair.filePaths) }]
  })
}

function disagreementSummaries(value: unknown): IntegrityPriorAttemptSummary["unresolvedDisagreements"] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const disagreement = asRecord(item)
    const id = stringFrom(disagreement.id)
    const description = stringFrom(disagreement.description)
    if (!id || !description) return []
    return [{ id, description }]
  })
}

function changedFilesFromDeliveries(deliveries: DeliveryRow[]): string[] {
  const out = new Set<string>()
  for (const delivery of deliveries) {
    const result = asRecord(delivery.result)
    for (const file of stringArray(result.changed_files)) out.add(file)
    for (const file of stringArray(result.changedFiles)) out.add(file)
    if (Array.isArray(result.diffs)) {
      for (const diff of result.diffs) {
        const file = stringFrom(asRecord(diff).file)
        if (file) out.add(file)
      }
    }
  }
  return [...out].sort()
}

function diffsFromDeliveries(deliveries: DeliveryRow[]): IntegrityBuildEvidenceSinceLastReview["diffs"] {
  const seen = new Set<string>()
  const diffs: IntegrityBuildEvidenceSinceLastReview["diffs"] = []
  for (const delivery of deliveries) {
    const result = asRecord(delivery.result)
    if (!Array.isArray(result.diffs)) continue
    for (const raw of result.diffs) {
      const diff = asRecord(raw)
      const file = stringFrom(diff.file)
      if (!file || seen.has(file)) continue
      seen.add(file)
      const additions = typeof diff.additions === "number" ? diff.additions : undefined
      const deletions = typeof diff.deletions === "number" ? diff.deletions : undefined
      diffs.push({
        file,
        status: stringFrom(diff.status),
        additions,
        deletions,
      })
    }
  }
  return diffs
}
