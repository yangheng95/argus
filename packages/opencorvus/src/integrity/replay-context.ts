import type { GoalContractFields } from "@/pipeline/types"
import type { ParsedRequirement } from "@/requirements/types"
import type { GoalRunRow } from "@/engine/store"
import { listIntegrityAttemptArtifacts, listSpecSnapshots } from "@/engine/store"
import { listFactCheckAttempts } from "@/fact-check/persist"
import type { TaskAgentOutcome } from "@/agent/outcomes"
import { agentContextStructuredPartBySchema, type AgentContextPacket } from "@/agent/context-packet"
import { isIntegrityFindingFingerprint } from "./finding-manifest"
import type { IntegrityAttemptFindingPayload, IntegrityAttemptRequiredRepairPayload } from "./attempt-payload"
import { renderSharedIntegrityPromptContext } from "./shared-prompt"
import type { SpecSnapshotLineage } from "./replay-lineage"
import z from "zod"

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

export type IntegrityImplementationEvidenceSinceLastReview = {
  sinceAttemptNumber?: number
  sinceTimeCreated?: number
  changedFiles: string[]
  diffs: Array<{ file: string; status?: string; additions?: number; deletions?: number }>
  implementationSummaries: string[]
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
  taskAgentOutcomes: Array<{
    provider: string
    artifactKind: string
    artifactID: string
    runID?: string
    sessionID?: string
    terminalStatus: string
    outcomeKind: string
    outcomeSummary?: string
    outcomeError?: string
    noDiffReason?: string
    actualChangedFiles: string[]
    reportedChangedFiles: string[]
    commitRef?: string
    timeCreated: number
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
  implementationEvidenceSinceLastReview: IntegrityImplementationEvidenceSinceLastReview
  scaleSignals: IntegrityReviewScaleSignals
}

export type IntegrityReplayContextInput = {
  taskID: string
  lineage: SpecSnapshotLineage
  phase?: "pre_build" | "post_build"
  goals: GoalContractFields[]
  requirements?: ParsedRequirement[]
  buildRecords: BuildRecordRow[]
  goalRuns: GoalRunRow[]
  agentOutcomes?: TaskAgentOutcome[]
}

export const INTEGRITY_REPLAY_CONTEXT_PACKET_SOURCE = "integrity_replay_context"
export const INTEGRITY_REPLAY_CONTEXT_PACKET_SCHEMA = "opencorvus.integrity.replay_context.v1"

const IntegrityReviewerSummarySchema = z
  .object({
    reviewerID: z.string(),
    scope: z.string(),
    verdict: z.string().optional(),
  })
  .strict()

const IntegrityFindingFingerprintSchema = z.string().refine(isIntegrityFindingFingerprint, {
  message: "fingerprint must match if_[a-f0-9]{16}",
})

const IntegrityPriorFindingSchema = z
  .object({
    id: z.string(),
    severity: z.enum(["blocking", "advisory"]),
    verdictImpact: z.enum(["pass", "concerns", "needs_correction"]).optional(),
    fingerprint: IntegrityFindingFingerprintSchema,
    canonicalSymptom: z.string(),
    title: z.string(),
    description: z.string(),
    repair: z.string(),
    verify: z.array(z.string()),
    affectedSymbols: z.array(z.string()),
    sourceFindingIDs: z.array(z.string()),
    priorAttemptRefs: z.array(z.string()),
    filePaths: z.array(z.string()),
    requirementIDs: z.array(z.string()),
    specIDs: z.array(z.string()),
  })
  .strict()

const IntegrityPriorBlockingFindingSchema = z
  .object({
    id: z.string(),
    fingerprint: IntegrityFindingFingerprintSchema,
    canonicalSymptom: z.string(),
    title: z.string(),
    description: z.string(),
    repair: z.string(),
    verify: z.array(z.string()),
    filePaths: z.array(z.string()),
    requirementIDs: z.array(z.string()),
    specIDs: z.array(z.string()),
  })
  .strict()

const IntegrityRequiredRepairSchema = z
  .object({
    id: z.string(),
    fingerprint: IntegrityFindingFingerprintSchema,
    canonicalSymptom: z.string(),
    description: z.string(),
    repair: z.string(),
    verify: z.array(z.string()),
    filePaths: z.array(z.string()),
    requirementIDs: z.array(z.string()),
    specIDs: z.array(z.string()),
    sourceFindingIDs: z.array(z.string()),
    priorAttemptRefs: z.array(z.string()),
  })
  .strict()

const IntegrityPriorAttemptSummarySchema = z
  .object({
    attemptNumber: z.number(),
    artifactID: z.string(),
    timeCreated: z.number(),
    phase: z.enum(["pre_build", "post_build"]).optional(),
    verdict: z.enum(["pass", "concerns", "needs_correction"]).optional(),
    summary: z.string().optional(),
    teamReportMarkdown: z.string().optional(),
    reviewers: z.array(IntegrityReviewerSummarySchema),
    findings: z.array(IntegrityPriorFindingSchema).optional(),
    blockingFindings: z.array(IntegrityPriorBlockingFindingSchema),
    requiredRepairs: z.array(IntegrityRequiredRepairSchema),
    unresolvedDisagreements: z.array(z.object({ id: z.string(), description: z.string() }).strict()),
  })
  .strict()

const IntegrityImplementationEvidenceSinceLastReviewSchema = z
  .object({
    sinceAttemptNumber: z.number().optional(),
    sinceTimeCreated: z.number().optional(),
    changedFiles: z.array(z.string()),
    diffs: z.array(
      z
        .object({
          file: z.string(),
          status: z.string().optional(),
          additions: z.number().optional(),
          deletions: z.number().optional(),
        })
        .strict(),
    ),
    implementationSummaries: z.array(z.string()),
    goalRuns: z.array(
      z
        .object({
          goalID: z.string(),
          goalRunID: z.string(),
          status: z.string(),
          outcomeKind: z.string().optional(),
          outcomeSummary: z.string().optional(),
          outcomeError: z.string().optional(),
          noDiffReason: z.string().optional(),
          changedFiles: z.array(z.string()).optional(),
          commitRef: z.string().optional(),
          timeCreated: z.number(),
          timeCompleted: z.number().nullable().optional(),
        })
        .strict(),
    ),
    taskAgentOutcomes: z.array(
      z
        .object({
          provider: z.string(),
          artifactKind: z.string(),
          artifactID: z.string(),
          runID: z.string().optional(),
          sessionID: z.string().optional(),
          terminalStatus: z.string(),
          outcomeKind: z.string(),
          outcomeSummary: z.string().optional(),
          outcomeError: z.string().optional(),
          noDiffReason: z.string().optional(),
          actualChangedFiles: z.array(z.string()),
          reportedChangedFiles: z.array(z.string()),
          commitRef: z.string().optional(),
          timeCreated: z.number(),
        })
        .strict(),
    ),
  })
  .strict()

const IntegrityPriorFactCheckAttemptSchema = z
  .object({
    artifactID: z.string(),
    factCheckSessionID: z.string(),
    timeCreated: z.number(),
    targetSessionID: z.string(),
    targetAgent: z.string(),
    targetMessageID: z.string(),
    verdict: z.enum(["clean", "minor_corrections", "needs_orchestrator_action", "inconclusive"]),
    outcome: z.enum(["completed", "aborted", "tool_error"]),
    itemsTotal: z.number(),
    itemsInspected: z.number(),
    verifiedCount: z.number(),
    correctedCount: z.number(),
    unresolvedCount: z.number(),
  })
  .strict()

const IntegrityReviewScaleSignalsSchema = z
  .object({
    goals: z.number(),
    requirements: z.number(),
    acceptanceSpecs: z.number(),
    changedFilesTotal: z.number(),
    changedFilesSinceLastReview: z.number(),
    priorAttempts: z.number(),
    priorBlockingFindings: z.number(),
    phase: z.enum(["pre_build", "post_build"]).optional(),
  })
  .strict()

const SpecSnapshotLineageSchema = z
  .object({
    taskID: z.string(),
    activeSpecSnapshotID: z.string(),
    inheritedSpecSnapshotIDs: z.array(z.string()),
    reason: z.enum(["active_only", "integrity_correction_lineage"]),
  })
  .strict()

const IntegrityReplayContextSchema = z
  .object({
    attemptNumber: z.number(),
    lineage: SpecSnapshotLineageSchema,
    priorAttempts: z.array(IntegrityPriorAttemptSummarySchema),
    priorFactCheckAttempts: z.array(IntegrityPriorFactCheckAttemptSchema),
    implementationEvidenceSinceLastReview: IntegrityImplementationEvidenceSinceLastReviewSchema,
    scaleSignals: IntegrityReviewScaleSignalsSchema,
  })
  .strict()

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

export function integrityReplayContextPacket(context: IntegrityReplayContext): AgentContextPacket {
  return {
    id: "integrity-replay-context",
    title: "Integrity Replay Context",
    source: INTEGRITY_REPLAY_CONTEXT_PACKET_SOURCE,
    scope: "task",
    parts: [
      {
        type: "text",
        text: [
          `attempt_number: ${context.attemptNumber}`,
          `active_spec_snapshot_id: ${context.lineage.activeSpecSnapshotID}`,
          `prior_attempts: ${context.priorAttempts.length}`,
          `prior_fact_check_attempts: ${context.priorFactCheckAttempts.length}`,
          `changed_files_since_last_review: ${context.scaleSignals.changedFilesSinceLastReview}`,
          `prior_blocking_findings: ${context.scaleSignals.priorBlockingFindings}`,
          ...(context.scaleSignals.phase ? [`phase: ${context.scaleSignals.phase}`] : []),
        ].join("\n"),
      },
      {
        type: "structured",
        schema: INTEGRITY_REPLAY_CONTEXT_PACKET_SCHEMA,
        label: "integrity_replay_context",
        summary: `attempt=${context.attemptNumber}; prior_attempts=${context.priorAttempts.length}; changed_files_since_last_review=${context.scaleSignals.changedFilesSinceLastReview}`,
        data: context,
      },
    ],
  }
}

export function integrityReplayContextFromContextPackets(
  packets: readonly AgentContextPacket[] | undefined,
): IntegrityReplayContext | undefined {
  const context = agentContextStructuredPartBySchema<IntegrityReplayContext>(
    packets,
    INTEGRITY_REPLAY_CONTEXT_PACKET_SCHEMA,
  )
  return context ? parseIntegrityReplayContext(context, INTEGRITY_REPLAY_CONTEXT_PACKET_SCHEMA) : undefined
}

export function buildIntegrityReplayContext(input: IntegrityReplayContextInput): IntegrityReplayContext {
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
    const payload = row.payload
    return {
      attemptNumber: index + 1,
      artifactID: row.artifactID,
      timeCreated: row.timeCreated,
      phase: payload.phase,
      verdict: payload.verdict,
      summary: payload.reason ?? undefined,
      teamReportMarkdown: payload.team_report_markdown ?? undefined,
      reviewers: payload.reviewers,
      findings: payload.findings.map(priorFindingSummary),
      blockingFindings: payload.findings
        .filter((finding) => finding.severity === "blocking" || finding.verdictImpact === "needs_correction")
        .map(priorBlockingFindingSummary),
      requiredRepairs: payload.required_repairs.map(priorRequiredRepairSummary),
      unresolvedDisagreements: payload.unresolved_disagreements,
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
  const agentOutcomesByGoalRun = new Map(
    (input.agentOutcomes ?? [])
      .filter((outcome) => outcome.goalRunID)
      .map((outcome) => [outcome.goalRunID, outcome]),
  )
  const agentOutcomesSince =
    sinceTimeCreated === undefined
      ? (input.agentOutcomes ?? [])
      : (input.agentOutcomes ?? []).filter((outcome) => outcome.time.created > sinceTimeCreated)
  const taskAgentOutcomesSince = agentOutcomesSince.filter((outcome) => outcome.scope === "task")
  const changedFilesTotal = uniqueSorted([
    ...changedFilesFromBuildRecords(input.buildRecords),
    ...changedFilesFromAgentOutcomes(input.agentOutcomes ?? []),
  ])
  const changedFilesSinceLastReview = uniqueSorted([
    ...changedFilesFromBuildRecords(buildRecordsSince),
    ...changedFilesFromAgentOutcomes(agentOutcomesSince),
  ])

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
    implementationEvidenceSinceLastReview: {
      sinceAttemptNumber: latestPrior?.attemptNumber,
      sinceTimeCreated,
      changedFiles: changedFilesSinceLastReview,
      diffs: diffsFromBuildRecords(buildRecordsSince),
      implementationSummaries: buildRecordsSince.map((record) => record.summary).filter((item) => item.trim().length > 0),
      goalRuns: goalRunsSince.map((run) => ({
        goalID: run.goal_id,
        goalRunID: run.id,
        status: run.status,
        ...(agentOutcomesByGoalRun.has(run.id)
          ? goalRunOutcomeSummary(agentOutcomesByGoalRun.get(run.id)!)
          : {}),
        timeCreated: run.time_created,
        timeCompleted: run.time_completed,
      })),
      taskAgentOutcomes: taskAgentOutcomesSince.map(taskAgentOutcomeSummary),
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
  const evidence = context.implementationEvidenceSinceLastReview
  const changedDirectories = replayPathDirectories(evidence.changedFiles)
  const visibleChangedDirectories = changedDirectories.slice(0, 24)
  const diffDirectories = replayPathDirectories(evidence.diffs.map((diff) => diff.file))
  const visibleDiffDirectories = diffDirectories.slice(0, 24)
  const evidenceLines = ["Implementation evidence after latest integrity attempt:"]
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
  if (evidence.implementationSummaries.length > 0) {
    evidenceLines.push("- Implementation summaries:")
    const summaries = evidence.implementationSummaries.slice(0, 6)
    for (const summary of summaries) evidenceLines.push(`  - ${clipReplayText(summary, 300)}`)
    replayAppendOmittedLine(evidenceLines, evidence.implementationSummaries.length, summaries.length, "implementation summaries")
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
  if (evidence.taskAgentOutcomes.length > 0) {
    evidenceLines.push("- Task-level agent outcomes after latest review:")
    for (const outcome of evidence.taskAgentOutcomes) {
      const noDiff = outcome.noDiffReason ? `, no_diff=${outcome.noDiffReason}` : ""
      const actual = `, actual_changed_files=${outcome.actualChangedFiles.length}`
      const reported = `, reported_changed_files=${outcome.reportedChangedFiles.length}`
      const commitRef = outcome.commitRef ? `, commit=${outcome.commitRef}` : ""
      const outcomeSummary = outcome.outcomeSummary ? `, summary=${clipReplayText(outcome.outcomeSummary, 120)}` : ""
      const outcomeError = outcome.outcomeError ? `, error=${clipReplayText(outcome.outcomeError, 120)}` : ""
      evidenceLines.push(
        `  - ${outcome.artifactID}: provider=${outcome.provider}, kind=${outcome.artifactKind}, status=${outcome.terminalStatus}, outcome=${outcome.outcomeKind}${noDiff}${actual}${reported}${commitRef}${outcomeSummary}${outcomeError}, created=${new Date(outcome.timeCreated).toISOString()}`,
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

function parseIntegrityReplayContext(value: unknown, packetID: string): IntegrityReplayContext {
  const parsed = IntegrityReplayContextSchema.safeParse(value)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue?.path.length ? ` at ${issue.path.join(".")}` : ""
    const detail = issue ? `: ${issue.message}` : ""
    throw new Error(`context packet ${packetID} has invalid integrity replay context payload${path}${detail}`)
  }
  return parsed.data as IntegrityReplayContext
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

function goalRunOutcomeSummary(outcome: TaskAgentOutcome): {
  outcomeKind: string
  outcomeSummary?: string
  outcomeError?: string
  noDiffReason?: string
  changedFiles: string[]
  commitRef?: string
} {
  return {
    outcomeKind: outcome.result ?? outcome.status,
    outcomeSummary: outcome.summary,
    outcomeError: outcome.error,
    noDiffReason: outcome.noDiffReason,
    changedFiles: outcome.changedFiles ?? [],
    commitRef: outcome.commitRef,
  }
}

function taskAgentOutcomeSummary(
  outcome: TaskAgentOutcome,
): IntegrityImplementationEvidenceSinceLastReview["taskAgentOutcomes"][number] {
  return {
    provider: outcome.provider,
    artifactKind: outcome.artifactKind,
    artifactID: outcome.id,
    runID: outcome.runID,
    sessionID: outcome.sessionID,
    terminalStatus: outcome.status,
    outcomeKind: outcome.result ?? outcome.status,
    outcomeSummary: outcome.summary || undefined,
    outcomeError: outcome.error,
    noDiffReason: outcome.noDiffReason,
    actualChangedFiles: outcome.changedFiles ?? [],
    reportedChangedFiles: outcome.reportedChangedFiles ?? [],
    commitRef: outcome.commitRef,
    timeCreated: outcome.time.created,
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

function priorFindingSummary(
  finding: IntegrityAttemptFindingPayload,
): NonNullable<IntegrityPriorAttemptSummary["findings"]>[number] {
  return {
    id: finding.id,
    severity: finding.severity,
    verdictImpact: finding.verdictImpact,
    fingerprint: finding.fingerprint,
    canonicalSymptom: finding.canonicalSymptom,
    title: finding.title,
    description: finding.description,
    repair: finding.repair,
    verify: finding.verify,
    affectedSymbols: finding.affectedSymbols,
    sourceFindingIDs: finding.sourceFindingIDs,
    priorAttemptRefs: finding.priorAttemptRefs,
    filePaths: finding.filePaths,
    requirementIDs: finding.requirementIDs,
    specIDs: finding.specIDs,
  }
}

function priorBlockingFindingSummary(
  finding: IntegrityAttemptFindingPayload,
): IntegrityPriorAttemptSummary["blockingFindings"][number] {
  return {
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
  }
}

function priorRequiredRepairSummary(
  repair: IntegrityAttemptRequiredRepairPayload,
): IntegrityPriorAttemptSummary["requiredRepairs"][number] {
  return {
    id: repair.id,
    fingerprint: repair.fingerprint,
    canonicalSymptom: repair.canonicalSymptom,
    description: repair.description,
    repair: repair.repair,
    verify: repair.verify,
    filePaths: repair.filePaths,
    requirementIDs: repair.requirementIDs,
    specIDs: repair.specIDs,
    sourceFindingIDs: repair.sourceFindingIDs,
    priorAttemptRefs: repair.priorAttemptRefs,
  }
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

function changedFilesFromAgentOutcomes(outcomes: TaskAgentOutcome[]): string[] {
  return uniqueSorted(outcomes.flatMap((outcome) => outcome.changedFiles ?? []))
}

function uniqueSorted(items: string[]): string[] {
  return [...new Set(items.filter((item) => item.trim().length > 0))].sort()
}

function diffsFromBuildRecords(records: BuildRecordRow[]): IntegrityImplementationEvidenceSinceLastReview["diffs"] {
  const seen = new Set<string>()
  const diffs: IntegrityImplementationEvidenceSinceLastReview["diffs"] = []
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
