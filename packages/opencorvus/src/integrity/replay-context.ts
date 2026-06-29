import type { GoalContractFields } from "@/pipeline/types"
import type { ParsedRequirement } from "@/requirements/types"
import type { BuildAttemptOutcomeRow, GoalRunRow } from "@/engine/store"
import { listIntegrityAttemptArtifacts, listSpecSnapshots } from "@/engine/store"
import { listFactCheckAttempts } from "@/fact-check/persist"
import { canonicalIntegritySymptom, defaultIntegrityVerify, integrityFindingFingerprint } from "./finding-manifest"
import { renderSharedIntegrityPromptContext } from "./shared-prompt"
import type { SpecSnapshotLineage } from "./replay-lineage"

export type { SpecSnapshotLineage } from "./replay-lineage"

type BuildRecordRow = {
  id: string
  task_id: string
  summary: string
  result: unknown
  time_created: number
}

export type IntegrityPriorAttemptSummary = {
  attemptNumber: number
  artifactID: string
  timeCreated: number
  phase?: "pre_build" | "post_build"
  verdict?: "pass" | "concerns" | "needs_correction"
  summary?: string
  teamReportMarkdown?: string
  reviewers: Array<{ reviewerID: string; scope: string; verdict?: string }>
  findings?: Array<{
    id: string
    severity: "blocking" | "advisory"
    verdictImpact?: "pass" | "concerns" | "needs_correction"
    fingerprint: string
    canonicalSymptom: string
    title: string
    description: string
    repair: string
    verify: string[]
    affectedSymbols: string[]
    sourceFindingIDs: string[]
    priorAttemptRefs: string[]
    filePaths: string[]
    requirementIDs: string[]
    specIDs: string[]
  }>
  blockingFindings: Array<{
    id: string
    fingerprint: string
    canonicalSymptom: string
    title: string
    description: string
    repair: string
    verify: string[]
    filePaths: string[]
    requirementIDs: string[]
    specIDs: string[]
  }>
  requiredRepairs: Array<{
    id: string
    fingerprint: string
    canonicalSymptom: string
    description: string
    repair: string
    verify: string[]
    filePaths: string[]
    requirementIDs: string[]
    specIDs: string[]
    sourceFindingIDs: string[]
    priorAttemptRefs: string[]
  }>
  unresolvedDisagreements: Array<{ id: string; description: string }>
}

export type IntegrityBuildEvidenceSinceLastReview = {
  sinceAttemptNumber?: number
  sinceTimeCreated?: number
  changedFiles: string[]
  diffs: Array<{ file: string; status?: string; additions?: number; deletions?: number }>
  buildSummaries: string[]
  goalRuns: Array<{
    goalID: string
    goalRunID: string
    status: string
    outcomeKind?: string
    outcomeSummary?: string
    outcomeError?: string
    noDiffReason?: string
    changedFiles?: string[]
    commitRef?: string
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

export type IntegrityPriorFactCheckAttempt = {
  /** engine_artifact row id. */
  artifactID: string
  /** fact-check session id (or "(no-session:...)" sentinel for error
   *  outcomes that threw before a session was created). */
  factCheckSessionID: string
  timeCreated: number
  targetSessionID: string
  targetAgent: string
  targetMessageID: string
  verdict: "clean" | "minor_corrections" | "needs_orchestrator_action" | "inconclusive"
  outcome: "completed" | "aborted" | "tool_error"
  itemsTotal: number
  itemsInspected: number
  verifiedCount: number
  correctedCount: number
  unresolvedCount: number
}

export type IntegrityReplayContext = {
  attemptNumber: number
  lineage: SpecSnapshotLineage
  priorAttempts: IntegrityPriorAttemptSummary[]
  /** Fact-check evidence accumulated on this task before the current
   *  integrity review.  Per fact-check agent contract §6.1.2
   *  step 7: integrity reviewers should be able to see "claim X was
   *  already corrected by fact-check, don't re-flag it" without re-
   *  dispatching fact_check.  Newest first; an empty array is the
   *  honest default when no fact-check has run yet. */
  priorFactCheckAttempts: IntegrityPriorFactCheckAttempt[]
  buildEvidenceSinceLastReview: IntegrityBuildEvidenceSinceLastReview
  scaleSignals: IntegrityReviewScaleSignals
}

export type BuildIntegrityReplayContextInput = {
  taskID: string
  lineage: SpecSnapshotLineage
  phase?: "pre_build" | "post_build"
  goals: GoalContractFields[]
  requirements?: ParsedRequirement[]
  buildRecords: BuildRecordRow[]
  goalRuns: GoalRunRow[]
  buildOutcomes?: BuildAttemptOutcomeRow[]
}

export function buildSpecSnapshotLineage(input: { taskID: string; activeSpecSnapshotID: string }): SpecSnapshotLineage {
  const snapshots = listSpecSnapshots(input.taskID)
  const active = snapshots.find((snapshot) => snapshot.id === input.activeSpecSnapshotID)
  if (!active) {
    throw new Error(
      `Cannot build SpecSnapshotLineage: snapshot ${input.activeSpecSnapshotID} does not belong to task ${input.taskID}.`,
    )
  }
  const inheritedSpecSnapshotIDs = snapshots
    .filter(
      (snapshot) =>
        snapshot.id !== active.id &&
        (snapshot.version < active.version ||
          (snapshot.version === active.version && snapshot.time_created < active.time_created)),
    )
    .map((snapshot) => snapshot.id)

  return {
    taskID: input.taskID,
    activeSpecSnapshotID: active.id,
    inheritedSpecSnapshotIDs,
    reason: inheritedSpecSnapshotIDs.length > 0 ? "integrity_correction_lineage" : "active_only",
  }
}

export function buildIntegrityReplayContext(input: BuildIntegrityReplayContextInput): IntegrityReplayContext {
  if (input.taskID !== input.lineage.taskID) {
    throw new Error(
      `IntegrityReplayContext taskID ${input.taskID} does not match lineage taskID ${input.lineage.taskID}.`,
    )
  }
  const newestFirstAttempts = listIntegrityAttemptArtifacts({
    taskID: input.taskID,
    lineage: input.lineage,
  })
  const chronologicalAttempts = newestFirstAttempts.slice().reverse()
  const priorAttempts = chronologicalAttempts.map((row, index): IntegrityPriorAttemptSummary => {
    const payload = asRecord(row.payload)
    return {
      attemptNumber: index + 1,
      artifactID: row.artifactID,
      timeCreated: row.timeCreated,
      phase: phaseFrom(payload.phase),
      verdict: verdictFrom(payload.verdict),
      summary: stringFrom(payload.summary) ?? stringFrom(payload.reason),
      teamReportMarkdown: stringFrom(payload.team_report_markdown),
      reviewers: reviewerSummaries(payload.reviewers),
      findings: findingSummaries(payload.findings),
      blockingFindings: blockingFindingSummaries(payload.findings),
      requiredRepairs: requiredRepairSummaries(payload.required_repairs),
      unresolvedDisagreements: disagreementSummaries(payload.unresolved_disagreements),
    }
  })
  const latestPrior = priorAttempts.at(-1)
  const sinceTimeCreated = latestPrior?.timeCreated
  const buildRecordsSince =
    sinceTimeCreated === undefined
      ? input.buildRecords
      : input.buildRecords.filter((record) => record.time_created > sinceTimeCreated)
  const goalRunsSince =
    sinceTimeCreated === undefined
      ? input.goalRuns
      : input.goalRuns.filter((run) => (run.time_completed ?? run.time_created) > sinceTimeCreated)
  const buildOutcomesByGoalRun = new Map((input.buildOutcomes ?? []).map((outcome) => [outcome.goal_run_id, outcome]))
  const changedFilesTotal = changedFilesFromBuildRecords(input.buildRecords)
  const changedFilesSinceLastReview = changedFilesFromBuildRecords(buildRecordsSince)

  const factCheckRows = listFactCheckAttempts(input.taskID)
  const priorFactCheckAttempts: IntegrityPriorFactCheckAttempt[] = factCheckRows.map((row) => ({
    artifactID: row.artifactID,
    factCheckSessionID: row.payload.fact_check_session_id,
    timeCreated: row.timeCreated,
    targetSessionID: row.payload.target_session_id,
    targetAgent: row.payload.target_agent,
    targetMessageID: row.payload.target_message_id,
    verdict: row.payload.report.overall_verdict,
    outcome: row.payload.outcome,
    itemsTotal: row.payload.report.scope.items_total,
    itemsInspected: row.payload.report.scope.items_inspected,
    verifiedCount: row.payload.report.verified.length,
    correctedCount: row.payload.report.corrected.length,
    unresolvedCount: row.payload.report.unresolved.length,
  }))

  return {
    attemptNumber: priorAttempts.length + 1,
    lineage: input.lineage,
    priorAttempts,
    priorFactCheckAttempts,
    buildEvidenceSinceLastReview: {
      sinceAttemptNumber: latestPrior?.attemptNumber,
      sinceTimeCreated,
      changedFiles: changedFilesSinceLastReview,
      diffs: diffsFromBuildRecords(buildRecordsSince),
      buildSummaries: buildRecordsSince.map((record) => record.summary).filter((item) => item.trim().length > 0),
      goalRuns: goalRunsSince.map((run) => ({
        goalID: run.goal_id,
        goalRunID: run.id,
        status: run.status,
        ...(buildOutcomesByGoalRun.has(run.id)
          ? goalRunOutcomeSummary(buildOutcomesByGoalRun.get(run.id)!)
          : {}),
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
  const evidence = context.buildEvidenceSinceLastReview
  const changedDirectories = replayPathDirectories(evidence.changedFiles)
  const visibleChangedDirectories = changedDirectories.slice(0, 24)
  const diffDirectories = replayPathDirectories(evidence.diffs.map((diff) => diff.file))
  const visibleDiffDirectories = diffDirectories.slice(0, 24)
  const evidenceLines = ["Build evidence after latest integrity attempt:"]
  if (evidence.sinceAttemptNumber !== undefined) evidenceLines.push(`- Since attempt: #${evidence.sinceAttemptNumber}`)
  if (evidence.sinceTimeCreated !== undefined) {
    evidenceLines.push(`- Since time: ${new Date(evidence.sinceTimeCreated).toISOString()}`)
  }
  evidenceLines.push(
    `- Changed directories (${visibleChangedDirectories.length}/${changedDirectories.length}; files=${evidence.changedFiles.length}): ${
      visibleChangedDirectories.length > 0 ? visibleChangedDirectories.join(", ") : "(none)"
    }`,
  )
  replayAppendOmittedLine(
    evidenceLines,
    changedDirectories.length,
    visibleChangedDirectories.length,
    "changed directories",
  )
  if (evidence.diffs.length > 0) {
    evidenceLines.push(
      `- Diff directories (${visibleDiffDirectories.length}/${diffDirectories.length}; diffs=${evidence.diffs.length}):`,
    )
    for (const directory of visibleDiffDirectories) evidenceLines.push(`  - ${directory}`)
    replayAppendOmittedLine(evidenceLines, diffDirectories.length, visibleDiffDirectories.length, "diff directories")
  }
  if (evidence.buildSummaries.length > 0) {
    evidenceLines.push("- Build summaries:")
    const summaries = evidence.buildSummaries.slice(0, 6)
    for (const summary of summaries) evidenceLines.push(`  - ${clipReplayText(summary, 300)}`)
    replayAppendOmittedLine(evidenceLines, evidence.buildSummaries.length, summaries.length, "build summaries")
  }
  if (evidence.goalRuns.length > 0) {
    evidenceLines.push("- Goal runs after latest review:")
    for (const run of evidence.goalRuns) {
      const outcome = run.outcomeKind ? `, outcome=${run.outcomeKind}` : ""
      const noDiff = run.noDiffReason ? `, no_diff=${run.noDiffReason}` : ""
      const changedFiles = run.changedFiles ? `, changed_files=${run.changedFiles.length}` : ""
      const commitRef = run.commitRef ? `, commit=${run.commitRef}` : ""
      const outcomeSummary = run.outcomeSummary ? `, summary=${clipReplayText(run.outcomeSummary, 120)}` : ""
      const outcomeError = run.outcomeError ? `, error=${clipReplayText(run.outcomeError, 120)}` : ""
      evidenceLines.push(
        `  - ${run.goalID}/${run.goalRunID}: ${run.status}${outcome}${noDiff}${changedFiles}${commitRef}${outcomeSummary}${outcomeError}, created=${new Date(run.timeCreated).toISOString()}${run.timeCompleted ? `, completed=${new Date(run.timeCompleted).toISOString()}` : ""}`,
      )
    }
  }
  const latestAttempt = context.priorAttempts.at(-1)
  const oldAttempts = latestAttempt ? context.priorAttempts.slice(0, -1).reverse() : []
  lines.push(
    renderSharedIntegrityPromptContext({
      surface: "integrity_replay",
      lineage: context.lineage,
      latestAttempt,
      changedDirectories: visibleChangedDirectories,
      changedEvidenceMarkdown: evidenceLines.join("\n"),
      oldAttempts,
    }).promptMarkdown,
  )

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

  // Surface prior fact-check attempts so reviewers see what's already been
  // verified / corrected and don't redundantly flag the same claim.  Spec
  // §6.1.2 step 7 / codex impl review §4.  Bounded to 10 newest rows; the
  // full stream lives in the artifact table for read_context drill-down.
  const priorFactCheckAttempts = context.priorFactCheckAttempts ?? []
  if (priorFactCheckAttempts.length > 0) {
    const cap = 10
    const newest = priorFactCheckAttempts.slice(0, cap)
    const omitted = priorFactCheckAttempts.length - newest.length
    lines.push(
      "",
      omitted > 0
        ? `Prior fact-check attempts on this task (latest ${newest.length} of ${priorFactCheckAttempts.length}; ${omitted} older omitted):`
        : `Prior fact-check attempts on this task (${newest.length}):`,
    )
    for (const fc of newest) {
      lines.push(
        `- [${fc.verdict}/${fc.outcome}] target=${fc.targetAgent}/${fc.targetSessionID.slice(0, 16)}… ` +
          `items=${fc.itemsInspected}/${fc.itemsTotal} ` +
          `verified=${fc.verifiedCount} corrected=${fc.correctedCount} unresolved=${fc.unresolvedCount} ` +
          `(${new Date(fc.timeCreated).toISOString()})`,
      )
    }
  }
  return lines.join("\n")
}

function replayPathDirectories(paths: readonly string[]): string[] {
  const directories = new Set<string>()
  for (const path of paths) {
    const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "")
    const index = normalized.lastIndexOf("/")
    directories.add(index > 0 ? normalized.slice(0, index) : ".")
  }
  return [...directories].sort((left, right) => left.localeCompare(right))
}

function replayAppendOmittedLine(lines: string[], total: number, rendered: number, label: string) {
  if (total > rendered) lines.push(`- omitted ${total - rendered} ${label} from initial integrity replay context`)
}

function clipReplayText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const marker = "\n[truncated_by_integrity_replay_prompt_cap]"
  return `${text.slice(0, Math.max(0, maxChars - marker.length)).trimEnd()}${marker}`
}

function goalRunOutcomeSummary(outcome: BuildAttemptOutcomeRow): {
  outcomeKind: string
  outcomeSummary?: string
  outcomeError?: string
  noDiffReason?: string
  changedFiles: string[]
  commitRef?: string
} {
  return {
    outcomeKind: outcome.outcome_kind,
    outcomeSummary: outcome.summary,
    outcomeError: outcome.error ?? undefined,
    noDiffReason: outcome.no_diff_reason ?? undefined,
    changedFiles: outcome.changed_files,
    commitRef: outcome.commit_ref ?? undefined,
  }
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
  return findingSummaries(value).flatMap((finding) => {
    if (finding.severity !== "blocking" && finding.verdictImpact !== "needs_correction") return []
    return [
      {
        id: finding.id,
        fingerprint: finding.fingerprint,
        canonicalSymptom: finding.canonicalSymptom,
        title: finding.title,
        description: finding.description,
        repair: finding.repair,
        verify: finding.verify,
        filePaths: finding.filePaths,
        requirementIDs: finding.requirementIDs,
        specIDs: finding.specIDs,
      },
    ]
  })
}

function findingSummaries(value: unknown): NonNullable<IntegrityPriorAttemptSummary["findings"]> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const finding = asRecord(item)
    const severity = stringFrom(finding.severity)
    if (severity !== "blocking" && severity !== "advisory") return []
    const normalizedSeverity: "blocking" | "advisory" = severity
    const draft = {
      id: stringFrom(finding.id) ?? "unknown-finding",
      severity: normalizedSeverity,
      verdictImpact: verdictFrom(finding.verdictImpact),
      title: stringFrom(finding.title) ?? "Untitled finding",
      description: stringFrom(finding.description) ?? "",
      repair: stringFrom(finding.repair) ?? "",
      filePaths: stringArray(finding.filePaths),
      requirementIDs: stringArray(finding.requirementIDs),
      specIDs: stringArray(finding.specIDs),
      affectedSymbols: stringArray(finding.affectedSymbols),
      sourceFindingIDs: stringArray(finding.sourceFindingIDs),
      priorAttemptRefs: stringArray(finding.priorAttemptRefs),
    }
    const canonicalSymptom = stringFrom(finding.canonicalSymptom) ?? canonicalIntegritySymptom(draft)
    const withSymptom = { ...draft, canonicalSymptom }
    return [
      {
        ...withSymptom,
        fingerprint: stringFrom(finding.fingerprint) ?? integrityFindingFingerprint(withSymptom),
        verify:
          stringArray(finding.verify).length > 0 ? stringArray(finding.verify) : defaultIntegrityVerify(withSymptom),
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
    const draft = {
      id,
      title: stringFrom(repair.title),
      description,
      repair: stringFrom(repair.repair) ?? description,
      filePaths: stringArray(repair.filePaths),
      requirementIDs: stringArray(repair.requirementIDs),
      specIDs: stringArray(repair.specIDs),
      affectedSymbols: stringArray(repair.affectedSymbols),
      sourceFindingIDs: stringArray(repair.sourceFindingIDs),
      priorAttemptRefs: stringArray(repair.priorAttemptRefs),
    }
    const canonicalSymptom = stringFrom(repair.canonicalSymptom) ?? canonicalIntegritySymptom(draft)
    const withSymptom = { ...draft, canonicalSymptom }
    return [
      {
        ...withSymptom,
        fingerprint: stringFrom(repair.fingerprint) ?? integrityFindingFingerprint(withSymptom),
        verify:
          stringArray(repair.verify).length > 0 ? stringArray(repair.verify) : defaultIntegrityVerify(withSymptom),
      },
    ]
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

function changedFilesFromBuildRecords(records: BuildRecordRow[]): string[] {
  const out = new Set<string>()
  for (const record of records) {
    const result = asRecord(record.result)
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

function diffsFromBuildRecords(records: BuildRecordRow[]): IntegrityBuildEvidenceSinceLastReview["diffs"] {
  const seen = new Set<string>()
  const diffs: IntegrityBuildEvidenceSinceLastReview["diffs"] = []
  for (const record of records) {
    const result = asRecord(record.result)
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
