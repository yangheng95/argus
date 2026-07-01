import { tool, type ToolSet } from "ai"
import z from "zod"
import TEAM_CORE from "@/prompt/core/integrity-team-core.txt"
import { runAgentSession } from "@/agent/runner"
import type { AgentSessionContinuation } from "@/engine/stage-continuation"
import { createAiSdkToolFromInfo } from "@/tool/ai-sdk-adapter"
import type { Tool } from "@/tool/tool"
import { withFactCheckRegistration } from "@/prompt/fragments/fact-check-registration"
import { limitSummary, markdownList } from "@/agent/report"
import type { AcceptanceSpec } from "@/acceptance/types"
import { FactCheckItemSchema } from "@/fact-check/schema"
import {
  summarizeVisualEvidenceBundle,
  validateVisualEvidenceBundleReferenceComparisons,
  visualEvidenceBundlePasses,
  type VisualEvidenceBundle,
} from "@/acceptance/visual-evidence"
import { Event as EngineEvent } from "@/engine/model"
import { EngineProtocol } from "@/engine/protocol"
import type { TaskRow } from "@/engine/store"
import { renderUserRequestSection } from "@/intent/request-prompt"
import type { GoalContractFields } from "@/pipeline/types"
import { Instance } from "@/project/instance"
import {
  createReviewReasoningForwarder,
  emitReviewStreamProgress,
  emitReviewStreamStarted,
  reviewIDForIntegrity,
} from "@/review/stream"
import type { ParsedRequirement, RequirementsDecision } from "@/requirements/types"
import { AttachmentStore } from "@/storage/attachment-store"
import { Log } from "@/util/log"
import { createIntegrityAcceptanceTools } from "./acceptance-tools"
import { loadIntegrityPreviewToolInfos } from "./static-tools"
import {
  buildPriorManifestIndex,
  canonicalIntegritySymptom,
  defaultIntegrityVerify,
  integrityFindingFingerprint,
  stableList,
} from "./finding-manifest"
import { renderIntegrityReplayContextPrompt, type IntegrityReplayContext } from "./replay-context"
import { renderSharedIntegrityPromptContext, sanitizeIntegrityPromptText } from "./shared-prompt"
import type { RequirementStatusRow } from "./requirement-status"
import {
  IntegrityCheckItemSchema,
  IntegrityCoverageAuditRowSchema,
  IntegrityReviewCompletedPayloadSchema,
  IntegrityCoverageStatusValues,
  IntegrityVerdictSchema,
  IntegrityFindingSchema,
  IntegrityRequiredRepairSchema,
  IntegrityReviewRoundSchema,
  IntegrityReviewerReportSchema,
  IntegrityTeamReportSchema,
  IntegrityUnresolvedDisagreementSchema,
  IntegrityUninspectedRiskSchema,
  type IntegrityFinding,
  type IntegrityRequiredRepair,
  type IntegrityReviewCompletedPayload,
  type IntegrityReviewerPlan,
  type IntegrityReviewerReport,
  type IntegrityReviewerScope,
  type IntegrityTeamReport,
  type IntegrityVerdict,
} from "./team-schema"

const log = Log.create({ service: "integrity-review" })

export type { IntegrityFinding, IntegrityReviewerReport, IntegrityReviewerScope, IntegrityTeamReport, IntegrityVerdict }

const FINDING_TRACEABILITY_PROMPT = [
  "Finding traceability:",
  "Every finding you submit must cite a REQ-N via `requirementIDs`, an AcceptanceSpec id via `specIDs`, or a literal original user-request substring via `userRequestQuotes`.",
  "Do not attach a REQ-N or AS id unless that requirement/spec already names the audited behavior.",
  "If the concern has no REQ, AS, or literal user-request quote anchor, it is out of scope; leave it out and, when useful, mention the dropped untraced concern in the report narrative.",
].join("\n")

const CONSENSUS_TRACEABILITY_PROMPT = [
  FINDING_TRACEABILITY_PROMPT,
  "A finding that does not cite a REQ-N, AS id, or literal user-request substring is out of scope and must be removed from the final report.",
  "If multiple reviewers all reported the same untraced concern, that is signal that the requirements/architect stage missed a REQ; emit one requirements-extraction concern, not a blocker for each sub-aspect.",
].join("\n\n")

const FINDING_MANIFEST_PROMPT = [
  "Finding manifest discipline:",
  "For every finding, include `canonicalSymptom` as a stable plain-language defect description, `verify[]` as concrete checks the build/re-review can use, and `affectedSymbols[]` when a function/component/API is known.",
  "When a finding repeats a prior blocker, keep the same defect surface: set `sourceFindingIDs[]` and `priorAttemptRefs[]` when known, and do not rename it to escape repair accountability.",
  "For every blocking finding, the final consensus must have a matching required repair. The host will also enforce this, but the report should make the repair contract explicit.",
  "Do not invent fingerprints. The host computes deterministic fingerprints after schema validation.",
].join("\n")

const COVERAGE_AUDIT_STATUS_CONTRACT_PROMPT = [
  "Coverage audit status contract:",
  `- \`coverageAudit[].status\` and reviewer \`coverage[].status\` must be exactly one of: ${IntegrityCoverageStatusValues.map((value) => `\`${value}\``).join(", ")}.`,
  "- Use `missing` when a request promise is not satisfied. Do not use `concerns`, `needs_correction`, `failed`, `uncovered`, or `partial` in coverage status fields.",
  "- Overall verdict values belong only in `verdict` / `verdictImpact`; never copy those verdict values into coverage audit rows.",
].join("\n")

const REVIEWER_COVERAGE_ROW_CONTRACT_PROMPT = [
  "Reviewer coverage row contract:",
  "- Each `coverage[]` row uses singular anchor fields plus `checkIDs`: `checkIDs[]`, `requirementID?: string`, `specID?: string`, `userRequestQuote?: string`, `status`, and `evidence`.",
  "- Do not put finding traceability fields inside `coverage[]`: no `requirementIDs`, `specIDs`, `userRequestQuotes`, `affectedSymbols`, or plural arrays.",
  "- Every `coverage[]` row must cite the registered check item IDs that produced the coverage judgment.",
  "- Every `coverage[]` row must include at least one singular anchor: `requirementID`, `specID`, or `userRequestQuote`.",
  "- If several anchors apply, emit several coverage rows or choose the strongest single anchor; reserve plural traceability arrays for `findings[]` only.",
].join("\n")

const REVIEWER_DRILLDOWN_ROW_CONTRACT_PROMPT = [
  "Reviewer drilldown row contract:",
  "- Each `drilldowns[]` row uses exactly `checkIDs`, `kind`, `target`, `purpose`, and `result`.",
  "- Every `drilldowns[]` row must cite the registered check item IDs that motivated the inspection.",
  "- Do not put finding fields inside `drilldowns[]`: no `affectedSymbols`, `requirementIDs`, `specIDs`, `userRequestQuotes`, `filePaths`, or typo variants.",
  "- Put impacted symbols and files on `findings[]` only when there is an actual finding.",
].join("\n")

const REVIEWER_EVIDENCE_ROW_CONTRACT_PROMPT = [
  "Reviewer evidence row contract:",
  "- Each reviewer `evidence[]` row uses exactly `checkIDs` and `note`.",
  "- Every evidence note must cite the registered check item IDs it supports; do not submit plain evidence strings.",
].join("\n")

const ADVERSARIAL_INVESTIGATION_PROMPT = [
  "Adversarial investigation discipline:",
  "- Start each reviewer perspective by deriving concrete failure hypotheses from the original request, REQ rows, goal contracts, acceptance specs, changed directories, prior findings, and runtime/visual evidence. Do not start from executor self-assessment.",
  "- Treat executor reports, goal reports, build/typecheck success, grep output, and file listings as leads, not proof. A pass claim needs scoped evidence that could have disproved it.",
  "- Every reviewer report must include `investigationPlan` with `requestPromise`, `hypothesis`, `evidencePlan[]`, and `passCriteria[]`; `requestPromise` is the concrete original user/REQ/spec promise being falsified.",
  "- A pass reviewer report still needs `investigationPlan`, `drilldowns[]`, `coverage[]`, and `evidence[]` showing what was inspected and why that inspection would expose the scoped failure.",
  "- Reviewer reports must not contain `findings[]`; register every finding through `register_integrity_finding` after registering the check item that exposed it.",
  "- If tools are available but a high-risk surface was not inspected, record `coverage` as `inconclusive` or `missing` and include `uninspectedRisks`; do not turn an inspection gap into praise.",
  "- Do not write congratulatory or effort-focused summaries. Summaries should say which request promises survived falsification, which did not, and what remains uninspected.",
].join("\n")

export interface IntegrityIssue {
  type: string
  description: string
  goalIDs?: string[]
  requirementIDs?: string[]
  specIDs?: string[]
  userRequestQuotes?: string[]
  evidence?: string
}

export interface GoalCorrection {
  action: "modify" | "split" | "remove"
  goalID: string
  reason: string
  updates?: Partial<
    Pick<
      GoalContractFields,
      "title" | "objective" | "owned_paths" | "depends_on" | "kind" | "priority" | "requirement_ids"
    >
  >
}

export interface MissingGoal {
  title: string
  objective: string
  acceptance_spec_hints: string[]
  owned_paths: string[]
  kind: string
  priority: "blocking" | "advisory"
  reason: string
}

export type IntegrityGraphCorrection =
  | { kind: "contract"; action: "add" | "modify" | "remove"; reason: string; contractID?: string; contract?: unknown }
  | {
      kind: "dependency"
      action: "add" | "modify" | "remove" | "reclassify"
      reason: string
      fromGoalID?: string
      toGoalID?: string
      dependency?: unknown
      newReason?: string
      contractIDs?: string[]
      summary?: string
    }
  | { kind: "audit_criterion"; action: "attach"; reason: string; goalID: string; contractIDs: string[] }

export interface IntegrityResult extends IntegrityTeamReport {
  issues: IntegrityIssue[]
  corrections: GoalCorrection[]
  graphCorrections: IntegrityGraphCorrection[]
  missingGoals: MissingGoal[]
}

type IntegrityEvidenceToolInput = NonNullable<Parameters<typeof createIntegrityAcceptanceTools>[0]>
type IntegrityAcceptanceContext = NonNullable<IntegrityEvidenceToolInput["buildEvidence"]>
type IntegrityEvidenceGoalInfo = NonNullable<IntegrityEvidenceToolInput["goals"]>[number]

export type ReviewPromptInput = {
  userRequest: string
  taskTitle: string
  goals: GoalContractFields[]
  requirements?: ParsedRequirement[]
  requirementDecisions?: RequirementsDecision[]
  requirementStatus?: RequirementStatusRow[]
  attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>
  acceptance?: IntegrityAcceptanceContext
  frontendDesign?: string
  visualQa?: string
  visualEvidence?: VisualEvidenceBundle[]
  visualEvidenceRequired?: boolean
  projectRoot?: string
  replayContext: IntegrityReplayContext
  signal?: AbortSignal
  taskID?: string
}

type ConsensusCollector = {
  checkItems: IntegrityTeamReport["checkItems"]
  reviewers: IntegrityTeamReport["reviewers"]
  coverageAudit: IntegrityTeamReport["coverageAudit"]
  uninspectedRisks: IntegrityTeamReport["uninspectedRisks"]
  findings: IntegrityTeamReport["findings"]
  rounds: IntegrityTeamReport["rounds"]
  requiredRepairs: IntegrityTeamReport["requiredRepairs"]
  unresolvedDisagreements: IntegrityTeamReport["unresolvedDisagreements"]
  fact_check_items: IntegrityTeamReport["fact_check_items"]
  report?: IntegrityTeamReport
}

function emptyConsensusCollector(): ConsensusCollector {
  return {
    checkItems: [],
    reviewers: [],
    coverageAudit: [],
    uninspectedRisks: [],
    findings: [],
    rounds: [],
    requiredRepairs: [],
    unresolvedDisagreements: [],
    fact_check_items: [],
  }
}

const SubmitIntegrityConsensusSchema = z
  .object({
    verdict: IntegrityVerdictSchema,
    summary: z.string().min(1),
    teamReportMarkdown: z.string().min(1),
  })
  .strict()

function upsertByID<T extends { id: string }>(items: T[], item: T): "registered" | "overwritten" {
  const existingIdx = items.findIndex((row) => row.id === item.id)
  if (existingIdx >= 0) {
    items[existingIdx] = item
    return "overwritten"
  }
  items.push(item)
  return "registered"
}

function upsertByRoundID(
  items: IntegrityTeamReport["rounds"],
  item: IntegrityTeamReport["rounds"][number],
): "registered" | "overwritten" {
  const existingIdx = items.findIndex((row) => row.roundID === item.roundID)
  if (existingIdx >= 0) {
    items[existingIdx] = item
    return "overwritten"
  }
  items.push(item)
  return "registered"
}

function unknownIntegrityCheckIDIssues(
  knownCheckIDs: ReadonlySet<string>,
  label: string,
  id: string,
  checkIDs: readonly string[],
): string[] {
  if (checkIDs.length === 0) return [`${label} "${id}" has no checkIDs; register a check item and reference it.`]
  const unknown = checkIDs.filter((checkID) => !knownCheckIDs.has(checkID))
  return unknown.length > 0 ? [`${label} "${id}" references unknown checkIDs: ${unknown.join(", ")}.`] : []
}

function integrityUnknownCheckIDIssues(
  report: IntegrityTeamReport,
  label: string,
  id: string,
  checkIDs: readonly string[],
): string[] {
  return unknownIntegrityCheckIDIssues(new Set(report.checkItems.map((item) => item.id)), label, id, checkIDs)
}

function collectorUnknownCheckIDIssues(
  collector: Pick<ConsensusCollector, "checkItems">,
  rows: Array<{ label: string; id: string; checkIDs: readonly string[] }>,
): string[] {
  const known = new Set(collector.checkItems.map((item) => item.id))
  return rows.flatMap((row) => unknownIntegrityCheckIDIssues(known, row.label, row.id, row.checkIDs))
}

function integrityReviewerCheckIDRows(report: IntegrityReviewerReport): Array<{
  label: string
  id: string
  checkIDs: readonly string[]
}> {
  return [
    { label: "reviewer", id: report.reviewerID, checkIDs: report.checkIDs },
    ...report.drilldowns.map((row, index) => ({
      label: `reviewerDrilldown:${report.reviewerID}`,
      id: `${row.target}#${index + 1}`,
      checkIDs: row.checkIDs,
    })),
    ...report.coverage.map((row, index) => ({
      label: `reviewerCoverage:${report.reviewerID}`,
      id: `${row.requirementID ?? row.specID ?? row.userRequestQuote ?? "coverage"}#${index + 1}`,
      checkIDs: row.checkIDs,
    })),
    ...report.evidence.map((row, index) => ({
      label: `reviewerEvidence:${report.reviewerID}`,
      id: `${row.note}#${index + 1}`,
      checkIDs: row.checkIDs,
    })),
  ]
}

function integrityCheckGraphIssues(report: IntegrityTeamReport, requirements?: ParsedRequirement[]): string[] {
  const issues: string[] = []
  if (report.checkItems.length === 0) {
    issues.push("integrity report has no registered checkItems; register each inspected requirement/problem first.")
    return issues
  }
  if (report.coverageAudit.length === 0) {
    issues.push("integrity report has no registered coverageAudit rows; register coverage audit before final verdict.")
  }
  for (const reviewer of report.reviewers) {
    if (reviewer.drilldowns.length === 0) {
      issues.push(`reviewer "${reviewer.reviewerID}" has no drilldowns; register row-level inspected evidence.`)
    }
    if (reviewer.coverage.length === 0) {
      issues.push(`reviewer "${reviewer.reviewerID}" has no coverage rows; register what requirement, spec, or user promise was covered.`)
    }
    if (reviewer.evidence.length === 0) {
      issues.push(`reviewer "${reviewer.reviewerID}" has no evidence rows; register evidence rows tied to checkIDs.`)
    }
  }
  const checkByID = new Map(report.checkItems.map((item) => [item.id, item]))
  const activeRequirementIDs = (requirements ?? []).map((requirement) => requirement.id)
  for (const requirementID of activeRequirementIDs) {
    const covered = report.checkItems.some((item) => item.requirementIDs.includes(requirementID))
    if (!covered) {
      issues.push(`active requirement ${requirementID} has no registered integrity check item.`)
    }
  }
  const unresolvedCheckIDs = report.checkItems
    .filter((item) => item.status === "failed" || item.status === "inconclusive")
    .map((item) => item.id)
  if (report.verdict === "pass" && unresolvedCheckIDs.length > 0) {
    issues.push(`pass verdict was submitted with failed/inconclusive checkItems: ${unresolvedCheckIDs.join(", ")}.`)
  }
  if (report.verdict === "pass") {
    const nonCoveredReviewerRows = report.reviewers.flatMap((reviewer) =>
      reviewer.coverage
        .filter((row) => row.status !== "covered")
        .map((row) => `${reviewer.reviewerID}:${row.requirementID ?? row.specID ?? row.userRequestQuote ?? "coverage"}`),
    )
    if (nonCoveredReviewerRows.length > 0) {
      issues.push(`pass verdict was submitted with missing/inconclusive reviewer coverage: ${nonCoveredReviewerRows.join(", ")}.`)
    }
    const nonCoveredAuditRows = report.coverageAudit
      .filter((row) => row.status !== "covered")
      .map((row) => row.promise)
    if (nonCoveredAuditRows.length > 0) {
      issues.push(`pass verdict was submitted with missing/inconclusive coverageAudit rows: ${nonCoveredAuditRows.join(", ")}.`)
    }
  }
  const rows: Array<{ label: string; id: string; checkIDs: readonly string[] }> = [
    ...report.reviewers.flatMap((row) => integrityReviewerCheckIDRows(row)),
    ...report.findings.map((row) => ({ label: "finding", id: row.id, checkIDs: row.checkIDs })),
    ...report.requiredRepairs.map((row) => ({ label: "requiredRepair", id: row.id, checkIDs: row.checkIDs })),
    ...report.coverageAudit.map((row, index) => ({
      label: "coverageAudit",
      id: `${row.promise}#${index + 1}`,
      checkIDs: row.checkIDs,
    })),
    ...report.uninspectedRisks.map((row, index) => ({
      label: "uninspectedRisk",
      id: `${row.risk}#${index + 1}`,
      checkIDs: row.checkIDs,
    })),
    ...report.unresolvedDisagreements.map((row) => ({
      label: "unresolvedDisagreement",
      id: row.id,
      checkIDs: row.checkIDs,
    })),
  ]
  for (const row of rows) issues.push(...integrityUnknownCheckIDIssues(report, row.label, row.id, row.checkIDs))
  for (const finding of report.findings) {
    if (finding.severity !== "blocking") continue
    const linked = finding.checkIDs.map((checkID) => checkByID.get(checkID)).filter((item) => item !== undefined)
    if (linked.length > 0 && linked.every((item) => item.status === "passed")) {
      issues.push(`blocking finding "${finding.id}" references only passed checkItems; blockers require a failed or inconclusive check.`)
    }
  }
  return issues
}

const INTEGRITY_EVIDENCE_PROMPT_MAX_CHARS = 9_800
const INTEGRITY_CONSENSUS_REVIEWER_REPORTS_MAX_CHARS = 18_000
const INTEGRITY_EVIDENCE_LIMITS = {
  userRequestChars: 800,
  requirementDescriptionChars: 120,
  requirementAcceptanceChars: 100,
  requirementNonGoalChars: 80,
  requirements: 24,
  requirementStatusGoals: 4,
  requirementStatusSpecs: 6,
  buildDirectories: 24,
  buildSummaryChars: 500,
  goals: 24,
  goalObjectiveChars: 140,
  goalDirectories: 6,
  goalAcceptanceSpecs: 2,
  goalAcceptanceTitleChars: 80,
} as const
const INTEGRITY_CONSENSUS_REPORT_LIMITS = {
  drilldowns: 12,
  coverage: 18,
  evidence: 18,
  findingEvidence: 6,
  findings: 24,
  openQuestions: 8,
  fieldChars: 260,
  summaryChars: 360,
  findingDescriptionChars: 420,
  findingRepairChars: 320,
} as const

export async function reviewIntegrity(input: {
  userRequest: string
  taskTitle: string
  goals: GoalContractFields[]
  requirements?: ParsedRequirement[]
  requirementDecisions?: RequirementsDecision[]
  requirementStatus?: RequirementStatusRow[]
  attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>
  acceptance?: IntegrityAcceptanceContext
  frontendDesign?: string
  visualQa?: string
  visualEvidence?: VisualEvidenceBundle[]
  visualEvidenceRequired?: boolean
  projectRoot?: string
  replayContext?: IntegrityReplayContext
  signal?: AbortSignal
  taskID?: string
  task?: TaskRow
  parentSessionID?: string
  continuation?: AgentSessionContinuation
  onSessionCreated?: (sessionID: string) => void
}): Promise<IntegrityResult & { sessionID: string }> {
  if (!input.replayContext) {
    throw new Error("reviewIntegrity requires replayContext. Build it from integrity/replay-context before calling.")
  }
  const replayContext = input.replayContext
  const attemptNumber = replayContext.attemptNumber
  if (input.taskID && !input.parentSessionID) {
    throw new Error(`reviewIntegrity requires parentSessionID for task-backed runs (taskID=${input.taskID}).`)
  }
  if (input.goals.length === 0) {
    const result = createNoGoalsResult()
    const softSessionID = await emitSoftIntegrity(input, result, attemptNumber)
    if (softSessionID) input.onSessionCreated?.(softSessionID)
    return { ...result, sessionID: softSessionID ?? "" }
  }
  const promptInput: ReviewPromptInput = { ...input, replayContext }
  const startedAt = Date.now()
  let activeReviewID: string | undefined = input.continuation
    ? reviewIDForIntegrity(input.continuation.sessionID)
    : undefined

  const collector = emptyConsensusCollector()
  const out = await runAgentSession<ConsensusCollector>({
    kind: "integrity",
    core: withFactCheckRegistration(TEAM_CORE),
    sessionTitle: `Integrity Review: ${input.taskTitle}`,
    parentSessionID: input.parentSessionID,
    taskID: input.taskID,
    signal: input.signal,
    continuation: input.continuation,
    toolKit: await createSingleSessionIntegrityToolKit({
      collector,
      taskID: input.taskID,
      goals: input.goals,
      requirements: input.requirements,
      acceptance: input.acceptance,
      frontendDesign: input.frontendDesign,
      visualQa: input.visualQa,
      visualEvidence: input.visualEvidence,
      visualEvidenceRequired: input.visualEvidenceRequired,
      projectRoot: input.projectRoot,
      attachments: input.attachments,
      signal: input.signal,
    }),
    buildUserPrompt: () => buildSingleSessionIntegrityPrompt(promptInput),
    buildUserParts:
      input.attachments && input.attachments.length > 0
        ? async () => {
            const text = buildSingleSessionIntegrityPrompt(promptInput)
            const inline = await AttachmentStore.inlineFileParts(input.attachments!)
            return [
              {
                type: "text" as const,
                text: text + AttachmentStore.renderAttachmentInventory(input.attachments!),
              },
              ...inline,
            ]
          }
        : undefined,
    terminalTool: {
      toolName: "submit_integrity_consensus",
      isSatisfied: (collector) => Boolean(collector.report),
      shouldExposeOnlyTerminalTool: () => false,
    },
    stream: createReviewReasoningForwarder({
      taskID: input.taskID,
      reviewID: () => activeReviewID,
      phase: "integrity",
      attempt: () => attemptNumber,
      source: "architect.integrity",
    }),
    onSessionCreated: (session) => {
      input.onSessionCreated?.(session.id)
      activeReviewID = reviewIDForIntegrity(session.id)
      emitReviewStreamStarted({
        taskID: input.taskID,
        reviewID: activeReviewID,
        phase: "integrity",
        sessionID: session.id,
        source: "architect.integrity",
      })
      const ticker = input.taskID
        ? setInterval(() => {
            emitReviewStreamProgress({
              taskID: input.taskID,
              reviewID: activeReviewID,
              phase: "integrity",
              attempt: attemptNumber,
              elapsedMs: Date.now() - startedAt,
              summary: "integrity review running",
              source: "architect.integrity",
            })
          }, 20_000)
        : null
      return {
        dispose: () => {
          if (ticker) clearInterval(ticker)
        },
      }
    },
  })

  const result = out.collector.report
  if (!result) throw new Error("integrity review did not submit consensus report.")
  const normalized = normalizeTeamReport(result, input.replayContext)
  log.info("integrity team review completed", {
    verdict: normalized.verdict,
    reviewers: normalized.reviewers.length,
    findings: normalized.findings.length,
    requiredRepairs: normalized.requiredRepairs.length,
  })
  emitIntegrityEvent(input.taskID, out.session.id, normalized, attemptNumber)
  return { ...normalized, sessionID: out.session.id }
}

async function createSingleSessionIntegrityToolKit(input: {
  collector: ConsensusCollector
  taskID?: string
  goals: GoalContractFields[]
  requirements?: ParsedRequirement[]
  acceptance?: IntegrityAcceptanceContext
  frontendDesign?: string
  visualQa?: string
  visualEvidence?: VisualEvidenceBundle[]
  visualEvidenceRequired?: boolean
  projectRoot?: string
  attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>
  signal?: AbortSignal
}) {
  const evidenceTools = input.taskID
    ? createIntegrityAcceptanceTools({
        taskID: input.taskID,
        goals: input.goals.map(goalToIntegrityEvidenceGoalInfo),
        buildEvidence: input.acceptance,
        frontendDesign: input.frontendDesign,
        visualQa: input.visualQa,
        visualEvidence: input.visualEvidence,
        attachments: input.attachments,
        signal: input.signal,
      })
    : {}
  const previewTools = input.taskID
    ? await createIntegrityPreviewTools({ taskID: input.taskID, signal: input.signal })
    : {}
  return {
    tools: {
      ...evidenceTools,
      ...previewTools,
      register_integrity_check_item: tool({
        description:
          "Register one concrete Integrity check item before reporting reviewer coverage, findings, repairs, or final verdict. Every active requirement must be covered by at least one check item.",
        inputSchema: IntegrityCheckItemSchema,
        execute: async (raw) => {
          if (input.collector.report) return "Error: integrity review already submitted; collector is closed."
          const item = IntegrityCheckItemSchema.parse(raw)
          const status = upsertByID(input.collector.checkItems, item)
          return `OK: integrity checkItem "${item.id}" ${status} (${input.collector.checkItems.length} total)`
        },
      }),
      register_integrity_reviewer_report: tool({
        description:
          "Register one reviewer report tied to registered checkIDs. Do not put findings here; register findings separately with register_integrity_finding.",
        inputSchema: IntegrityReviewerReportSchema,
        execute: async (raw) => {
          if (input.collector.report) return "Error: integrity review already submitted; collector is closed."
          const report = IntegrityReviewerReportSchema.parse(raw)
          const checkIDIssues = collectorUnknownCheckIDIssues(input.collector, integrityReviewerCheckIDRows(report))
          if (checkIDIssues.length > 0) {
            return `Error: integrity reviewer report references unregistered check items: ${checkIDIssues.join("; ")}`
          }
          const existingIdx = input.collector.reviewers.findIndex((row) => row.reviewerID === report.reviewerID)
          if (existingIdx >= 0) {
            input.collector.reviewers[existingIdx] = report
            return `OK: integrity reviewer "${report.reviewerID}" overwritten (${input.collector.reviewers.length} total)`
          }
          input.collector.reviewers.push(report)
          return `OK: integrity reviewer "${report.reviewerID}" registered (${input.collector.reviewers.length} total)`
        },
      }),
      register_integrity_coverage_audit: tool({
        description: "Register one coverage-audit row tied to registered checkIDs.",
        inputSchema: IntegrityCoverageAuditRowSchema,
        execute: async (raw) => {
          if (input.collector.report) return "Error: integrity review already submitted; collector is closed."
          const row = IntegrityCoverageAuditRowSchema.parse(raw)
          const checkIDIssues = collectorUnknownCheckIDIssues(input.collector, [
            { label: "coverageAudit", id: row.promise, checkIDs: row.checkIDs },
          ])
          if (checkIDIssues.length > 0) {
            return `Error: integrity coverageAudit row references unregistered check items: ${checkIDIssues.join("; ")}`
          }
          input.collector.coverageAudit.push(row)
          return `OK: integrity coverageAudit row registered (${input.collector.coverageAudit.length} total)`
        },
      }),
      register_integrity_uninspected_risk: tool({
        description: "Register one uninspected risk tied to registered checkIDs.",
        inputSchema: IntegrityUninspectedRiskSchema,
        execute: async (raw) => {
          if (input.collector.report) return "Error: integrity review already submitted; collector is closed."
          const row = IntegrityUninspectedRiskSchema.parse(raw)
          const checkIDIssues = collectorUnknownCheckIDIssues(input.collector, [
            { label: "uninspectedRisk", id: row.risk, checkIDs: row.checkIDs },
          ])
          if (checkIDIssues.length > 0) {
            return `Error: integrity uninspectedRisk references unregistered check items: ${checkIDIssues.join("; ")}`
          }
          input.collector.uninspectedRisks.push(row)
          return `OK: integrity uninspectedRisk registered (${input.collector.uninspectedRisks.length} total)`
        },
      }),
      register_integrity_finding: tool({
        description: "Register one Integrity finding tied to registered checkIDs.",
        inputSchema: IntegrityFindingSchema,
        execute: async (raw) => {
          if (input.collector.report) return "Error: integrity review already submitted; collector is closed."
          const finding = IntegrityFindingSchema.parse(raw)
          const checkIDIssues = collectorUnknownCheckIDIssues(input.collector, [
            { label: "finding", id: finding.id, checkIDs: finding.checkIDs },
          ])
          if (checkIDIssues.length > 0) {
            return `Error: integrity finding references unregistered check items: ${checkIDIssues.join("; ")}`
          }
          const status = upsertByID(input.collector.findings, finding)
          return `OK: integrity finding "${finding.id}" ${status} (${input.collector.findings.length} total)`
        },
      }),
      register_integrity_round: tool({
        description: "Register one Integrity review round summary.",
        inputSchema: IntegrityReviewRoundSchema,
        execute: async (raw) => {
          if (input.collector.report) return "Error: integrity review already submitted; collector is closed."
          const round = IntegrityReviewRoundSchema.parse(raw)
          const status = upsertByRoundID(input.collector.rounds, round)
          return `OK: integrity round "${round.roundID}" ${status} (${input.collector.rounds.length} total)`
        },
      }),
      register_integrity_required_repair: tool({
        description: "Register one required repair tied to registered checkIDs and finding IDs.",
        inputSchema: IntegrityRequiredRepairSchema,
        execute: async (raw) => {
          if (input.collector.report) return "Error: integrity review already submitted; collector is closed."
          const repair = IntegrityRequiredRepairSchema.parse(raw)
          const checkIDIssues = collectorUnknownCheckIDIssues(input.collector, [
            { label: "requiredRepair", id: repair.id, checkIDs: repair.checkIDs },
          ])
          if (checkIDIssues.length > 0) {
            return `Error: integrity requiredRepair references unregistered check items: ${checkIDIssues.join("; ")}`
          }
          const status = upsertByID(input.collector.requiredRepairs, repair)
          return `OK: integrity requiredRepair "${repair.id}" ${status} (${input.collector.requiredRepairs.length} total)`
        },
      }),
      register_integrity_unresolved_disagreement: tool({
        description: "Register one unresolved disagreement tied to registered checkIDs.",
        inputSchema: IntegrityUnresolvedDisagreementSchema,
        execute: async (raw) => {
          if (input.collector.report) return "Error: integrity review already submitted; collector is closed."
          const disagreement = IntegrityUnresolvedDisagreementSchema.parse(raw)
          const checkIDIssues = collectorUnknownCheckIDIssues(input.collector, [
            { label: "unresolvedDisagreement", id: disagreement.id, checkIDs: disagreement.checkIDs },
          ])
          if (checkIDIssues.length > 0) {
            return `Error: integrity unresolvedDisagreement references unregistered check items: ${checkIDIssues.join("; ")}`
          }
          const status = upsertByID(input.collector.unresolvedDisagreements, disagreement)
          return `OK: integrity unresolvedDisagreement "${disagreement.id}" ${status} (${input.collector.unresolvedDisagreements.length} total)`
        },
      }),
      register_integrity_fact_check_item: tool({
        description: "Register one factual claim that Integrity could not verify in-session.",
        inputSchema: FactCheckItemSchema,
        execute: async (raw) => {
          if (input.collector.report) return "Error: integrity review already submitted; collector is closed."
          const item = FactCheckItemSchema.parse(raw)
          input.collector.fact_check_items.push(item)
          return `OK: integrity fact_check_item registered (${input.collector.fact_check_items.length} total)`
        },
      }),
      submit_integrity_consensus: tool({
        description: `Finalize the final integrity review from registered check items and report rows. Do not pass reviewers, findings, coverageAudit, requiredRepairs, checkItems, or other arrays in this final call; register them first. Produce multiple independent reviewer reports via register_integrity_reviewer_report without spawning reviewer sessions. Every reviewer report must include investigationPlan.requestPromise, investigationPlan.hypothesis, investigationPlan.evidencePlan[], passCriteria[], and checkIDs. Every active Requirements-produced REQ-N must have a registered check item before final verdict. coverageAudit[].status must be exactly one of ${IntegrityCoverageStatusValues.join(", ")}; do not use verdict values such as concerns there.`,
        inputSchema: SubmitIntegrityConsensusSchema,
        execute: async (raw) => {
          if (input.collector.report) {
            return "Error: integrity report already submitted; duplicate submit_integrity_consensus ignored."
          }
          const finalParsed = SubmitIntegrityConsensusSchema.safeParse(raw)
          if (!finalParsed.success) {
            return `Error: submit_integrity_consensus accepts only verdict, summary, and teamReportMarkdown after register_* calls: ${finalParsed.error.message}`
          }
          const final = finalParsed.data
          const parsed = IntegrityTeamReportSchema.safeParse({
            verdict: final.verdict,
            summary: final.summary,
            teamReportMarkdown: final.teamReportMarkdown,
            checkItems: input.collector.checkItems,
            reviewers: input.collector.reviewers,
            coverageAudit: input.collector.coverageAudit,
            uninspectedRisks: input.collector.uninspectedRisks,
            findings: input.collector.findings,
            rounds: input.collector.rounds,
            requiredRepairs: input.collector.requiredRepairs,
            unresolvedDisagreements: input.collector.unresolvedDisagreements,
            fact_check_items: input.collector.fact_check_items,
          })
          if (!parsed.success) return `Error: integrity review failed schema validation: ${parsed.error.message}`
          const checkGraphIssues = integrityCheckGraphIssues(parsed.data, input.requirements)
          if (checkGraphIssues.length > 0) {
            return `Error: integrity review check graph is incomplete: ${checkGraphIssues.join("; ")}`
          }
          const requirementCoverageIssues = integrityRequirementCoverageIssues(parsed.data, input.requirements)
          if (requirementCoverageIssues.length > 0) {
            return `Error: integrity review omitted active requirement coverage: ${requirementCoverageIssues.join("; ")}`
          }
          const visualEvidenceIssues = await integrityConsensusVisualEvidenceBlockingIssues({
            report: parsed.data,
            projectRoot: input.projectRoot,
            taskID: input.taskID,
            visualEvidence: input.visualEvidence,
            visualEvidenceRequired: input.visualEvidenceRequired,
          })
          if (visualEvidenceIssues.length > 0) {
            return `Error: pass verdict requires passing task-scoped VisualEvidenceBundle evidence: ${visualEvidenceIssues.join("; ")}`
          }
          input.collector.report = parsed.data
          return `RECORDED: integrity review recorded with verdict=${parsed.data.verdict}.`
        },
      }),
    },
    getCollector: () => input.collector,
    buildReport: () => ({
      summary: input.collector.report?.summary ?? "Integrity review missing",
      detail: input.collector.report?.teamReportMarkdown ?? "No integrity review submitted.",
    }),
  }
}

async function integrityConsensusVisualEvidenceBlockingIssues(input: {
  report: IntegrityTeamReport
  projectRoot?: string
  taskID?: string
  visualEvidence?: VisualEvidenceBundle[]
  visualEvidenceRequired?: boolean
}): Promise<string[]> {
  if (input.report.verdict !== "pass" || !input.visualEvidenceRequired) return []
  if (!input.taskID || !input.projectRoot) {
    return [
      "pass verdict was submitted while reference visual evidence was expected, but task-scoped project context was unavailable.",
    ]
  }
  const bundles = input.visualEvidence ?? []
  if (bundles.length === 0) {
    return [
      "pass verdict was submitted while reference visual evidence was expected, but no VisualEvidenceBundle was available.",
    ]
  }
  const advisories: string[] = []
  for (const bundle of bundles) {
    const comparisonValidation = await validateVisualEvidenceBundleReferenceComparisons({
      projectRoot: input.projectRoot,
      bundle,
      expectedTaskID: input.taskID,
    })
    if (!visualEvidenceBundlePasses(bundle) || !comparisonValidation.passing) {
      advisories.push(
        `VisualEvidenceBundle ${bundle.id} is not passing visual evidence checks: ${
          comparisonValidation.issues.join("; ") || "required visual regions are not fully passing"
        }`,
      )
    }
  }
  return advisories
}

function integrityRequirementCoverageIssues(
  report: IntegrityTeamReport,
  requirements: readonly ParsedRequirement[] | undefined,
): string[] {
  const knownRequirementIDs = [...new Set((requirements ?? []).map((requirement) => requirement.id).filter(Boolean))]
  if (knownRequirementIDs.length === 0) return []

  const touchedRequirementIDs = new Set<string>()
  for (const reviewer of report.reviewers) {
    for (const row of reviewer.coverage) {
      if (row.requirementID) touchedRequirementIDs.add(row.requirementID)
    }
  }
  for (const finding of report.findings) {
    for (const requirementID of finding.requirementIDs) touchedRequirementIDs.add(requirementID)
  }
  for (const repair of report.requiredRepairs) {
    for (const requirementID of repair.requirementIDs) touchedRequirementIDs.add(requirementID)
  }

  const missing = knownRequirementIDs.filter((requirementID) => !touchedRequirementIDs.has(requirementID))
  if (missing.length === 0) return []
  return [
    `${missing.join(", ")} missing from reviewer coverage rows, findings, and requiredRepairs; each active Requirements-produced REQ-N must be explicitly covered, missing, or inconclusive before final verdict.`,
  ]
}

async function createIntegrityPreviewTools(input: { taskID: string; signal?: AbortSignal }): Promise<ToolSet> {
  const toolInfos = await loadIntegrityPreviewToolInfos()
  const entries = await Promise.all(
    toolInfos.map(async (info) => [info.id, await createIntegrityTool(info, input)] as const),
  )
  return Object.fromEntries(entries) as ToolSet
}

async function createIntegrityTool(info: Tool.Info, input: { taskID: string; signal?: AbortSignal }) {
  return createAiSdkToolFromInfo({
    info,
    agent: "integrity",
    taskID: input.taskID,
    signal: input.signal,
  })
}

export const IntegrityTestHooks = {
  createSingleSessionIntegrityToolKit,
  emptyConsensusCollector,
}

export function buildSupervisorPlanPrompt(input: ReviewPromptInput): string {
  return [
    "# Integrity Supervisor Planning",
    renderIntegrityReplayContextPrompt(input.replayContext),
    renderSeverityNewEvidenceSection(input),
    [
      "First build a task-specific audit strategy. Derive `taskProfile`, `riskHypotheses`, and `coveragePlan` from the request promises, REQ summaries, goal summaries, replay context, and changed directory surface. Do not use a fixed checklist.",
      "Risk hypotheses must name concrete ways this task could fail the user's intent, such as missing real API integration, failing to reuse existing components, visual/layout defects, source translation parity gaps, persistence/auth/data loss, or behavior regressions when those are relevant. Omit categories that are not relevant.",
      "For each reviewer, include riskHypothesisIDs and a drilldownPlan that uses scoped evidence tools. Reviewers should start from `inspect_integrity_evidence` overview/changed_directories/goal_summary, then request exact directories, files, diffs, runtime screenshots, or commands only when needed.",
      "Do not plan default reads of upstream_context, contract graph, visual specs, decision log, full file lists, or full diffs. Those are not initial audit material.",
      "Choose 2-6 independent reviewers for the actual task risk surface. Use the scale signals: larger goal/REQ/changed-directory surfaces should push the plan toward more reviewers; narrow surfaces can use fewer. Do not default to five reviewers. Do not use fixed dimensions or a stock checklist.",
      "When no prior integrity attempt exists for this task/spec snapshot, build the reviewer team from the task's actual risk surface.",
      "When prior attempts exist, start from prior blocking findings, required repairs, and prior reviewer focuses. Verify whether prior blockers were actually repaired using build evidence since the latest review, then cover new or changed risk surfaces. Do not spend a fresh full team rediscovering the same unchanged blocker. If a prior blocker still appears unresolved, assign a reviewer to verify it as persistent with evidence rather than renaming it as a new finding.",
      "Prior reviewer focuses are the list of surfaces that were inspected, not a proof that those surfaces are healthy or that uninspected surfaces are absent. Re-walk the actual task surface from the user request, REQ rows, goals, acceptance specs, changed directories, and build summaries. If a category looks uninspected in prior rounds, do not assume it is irrelevant -- it may have been missed. Match reviewers to surface by semantic responsibility, not by similarity to prior reviewer ids or names.",
      "Use 2-3 reviewers when the replay context shows a narrow re-review with a small changed-directory set and a small number of prior blockers. Use 4-6 reviewers when the task spans many goals/requirements/acceptance specs, when changed directories cross several runtime surfaces, or when the replay context has no prior attempts. Avoid substantial overlap with prior reviewer focuses unless the rationale ties it to persistent blockers or changed repair evidence.",
    ].join("\n\n"),
    buildIntegrityEvidencePrompt(input),
    "Call submit_integrity_review_plan exactly once.",
  ].join("\n\n")
}

export function buildSingleSessionIntegrityPrompt(input: ReviewPromptInput): string {
  return [
    "# Integrity Review",
    renderIntegrityReplayContextPrompt(input.replayContext),
    renderSeverityNewEvidenceSection(input),
    renderSeverityReconciliationPass(),
    [
      "Perform the integrity review in this single streaming session. Do not spawn reviewer sessions and do not ask for a separate planning phase.",
      "Internally choose 2-4 task-specific reviewer perspectives from the actual request, REQ rows, goals, acceptance specs, changed directories, runtime evidence, prior attempts, and risk surface.",
      "For every concrete promise, surface, or suspected defect you inspect, first call `register_integrity_check_item` with the evidence-backed status. Every active REQ-N must be covered by at least one registered check item.",
      "Represent reviewer perspectives with `register_integrity_reviewer_report`, and make each reviewer report cite the checkIDs it summarizes. Register findings, required repairs, coverage audit rows, risks, rounds, disagreements, and fact-check items through their dedicated register_integrity_* tools; do not put arrays in the final submit call.",
      "Use 2 reviewer reports for narrow re-reviews. Use 3-4 reviewer reports for broad first reviews or broad changed surfaces. Do not default to five reviewers and do not use fixed dimensions.",
      "Before final verdict, compare the reviewer reports adversarially. If a blocking finding or unresolved blocking disagreement remains, do not pass.",
      "Compare current evidence against prior attempts. A repeated blocker should stay persistent/regressed when evidence supports that; do not suppress a prior blocker merely because the current reviewer label differs.",
    ].join("\n\n"),
    CONSENSUS_TRACEABILITY_PROMPT,
    FINDING_MANIFEST_PROMPT,
    ADVERSARIAL_INVESTIGATION_PROMPT,
    COVERAGE_AUDIT_STATUS_CONTRACT_PROMPT,
    REVIEWER_COVERAGE_ROW_CONTRACT_PROMPT,
    REVIEWER_DRILLDOWN_ROW_CONTRACT_PROMPT,
    REVIEWER_EVIDENCE_ROW_CONTRACT_PROMPT,
    buildIntegrityEvidencePrompt(input),
    "Use scoped evidence tools for the initial falsification pass: inspect overview, changed directories, goal summary, executor reports, and then exact files/diffs/runtime/visual evidence for the reviewer perspectives that matter. Do not request full upstream context, full contract graph, raw decision log, or broad full-diff dumps unless a specific finding requires it.",
    "Perform a coverage audit before final verdict: every critical request promise should be `covered`, `missing`, or explicitly `inconclusive`. Include `coverageAudit`; include `uninspectedRisks` for high-risk surfaces no reviewer actually inspected.",
    "Every active Requirements-produced REQ-N rendered in this prompt must appear at least once in registered check item requirementIDs and at least once in reviewer `coverage[]`, top-level `findings[].requirementIDs`, or `requiredRepairs[].requirementIDs`. Use `status:\"missing\"` or `status:\"inconclusive\"` coverage rows instead of silently skipping a REQ-N.",
    "Call submit_integrity_consensus exactly once after all register_integrity_* calls. The final submit call only sets verdict, summary, and teamReportMarkdown.",
  ].join("\n\n")
}

export function buildReviewerPrompt(input: ReviewPromptInput, scope: IntegrityReviewerScope): string {
  return [
    "# Independent Integrity Reviewer",
    `Reviewer ID: ${scope.reviewerID}`,
    `Title: ${scope.title}`,
    `Focus: ${scope.focus}`,
    "Adversarial questions:",
    markdownList(scope.adversarialQuestions),
    renderIntegrityReplayContextPrompt(input.replayContext),
    FINDING_TRACEABILITY_PROMPT,
    FINDING_MANIFEST_PROMPT,
    ADVERSARIAL_INVESTIGATION_PROMPT,
    COVERAGE_AUDIT_STATUS_CONTRACT_PROMPT,
    REVIEWER_COVERAGE_ROW_CONTRACT_PROMPT,
    REVIEWER_DRILLDOWN_ROW_CONTRACT_PROMPT,
    REVIEWER_EVIDENCE_ROW_CONTRACT_PROMPT,
    renderSeverityNewEvidenceSection(input),
    [
      "Before deep evidence reads, form an investigation plan for your scope: request promise, risk hypothesis, evidence plan, and pass/finding criteria. Include it in `investigationPlan` in submit_reviewer_report with `requestPromise`, `hypothesis`, `evidencePlan[]`, and `passCriteria[]`.",
      "Actively try to falsify your scoped pass story before writing it. Record scoped tool work in `drilldowns[]`, and record request/REQ/spec coverage in `coverage[]`. A pass report still needs coverage evidence.",
      "Use scoped drilldown. Prefer `inspect_integrity_evidence` sections such as overview, changed_directories, changed_files_in_directory, diff_for_file, goal_summary, goal_detail, frontend_design_contract, and visual_qa_report when visual/reference fidelity matters. Do not request full upstream context, full contract graph, raw decision log, or broad full-diff dumps.",
      "Explore independently, gather evidence, and call submit_reviewer_report once.",
      "When no prior integrity attempt exists for this task/spec, review your assigned surface independently using evidence from files, diffs, commands, runtime checks, requirements, goals, and the original request.",
      "When prior attempts exist, you are reviewing the current attempt, not starting from zero. Prior findings and required repairs are evidence. First check whether prior blockers relevant to your scope were repaired in the files/evidence changed since the latest review. If the same blocker remains, report it as persistent and cite both the prior finding id and current evidence. Then inspect new risk introduced by the repair. Do not relabel an unchanged prior blocker as a brand-new discovery.",
    ].join("\n\n"),
    buildIntegrityEvidencePrompt(input),
  ].join("\n\n")
}

export function buildSupervisorConsensusPrompt(
  input: ReviewPromptInput,
  plan: IntegrityReviewerPlan,
  reports: IntegrityReviewerReport[],
): string {
  return [
    "# Integrity Supervisor Consensus",
    renderIntegrityReplayContextPrompt(input.replayContext),
    renderSeverityNewEvidenceSection(input),
    renderSeverityReconciliationPass(),
    "Compare reviewer reports adversarially. If a blocking finding or unresolved blocking disagreement remains, do not pass.",
    "Compare the current reviewer reports against prior attempts. A repeated blocking finding should be represented as persistent or regressed when the evidence supports that conclusion. Do not pass while a prior blocking repair has no convincing current evidence. Do not suppress a prior blocker merely because current reviewers used a different id.",
    CONSENSUS_TRACEABILITY_PROMPT,
    FINDING_MANIFEST_PROMPT,
    ADVERSARIAL_INVESTIGATION_PROMPT,
    COVERAGE_AUDIT_STATUS_CONTRACT_PROMPT,
    REVIEWER_COVERAGE_ROW_CONTRACT_PROMPT,
    REVIEWER_DRILLDOWN_ROW_CONTRACT_PROMPT,
    REVIEWER_EVIDENCE_ROW_CONTRACT_PROMPT,
    "Reviewer plan:",
    renderReviewerPlanMarkdown(plan),
    "Reviewer reports:",
    renderReviewerReportsForConsensusPrompt(reports),
    "Original review context:",
    buildIntegrityEvidencePrompt(input),
    "Perform a coverage audit before final verdict: every critical request promise from the plan should be `covered`, `missing`, or explicitly `inconclusive`. Include `coverageAudit`; include `uninspectedRisks` for high-risk surfaces that no reviewer actually checked. If a reviewer report only summarizes executor claims without falsification-oriented drilldown, treat that surface as uninspected.",
    "Every active Requirements-produced REQ-N rendered in this prompt must appear at least once in registered check item requirementIDs and at least once in reviewer `coverage[]`, top-level `findings[].requirementIDs`, or `requiredRepairs[].requirementIDs`. Use missing/inconclusive coverage rows instead of silently skipping a REQ-N.",
    "Call submit_integrity_consensus exactly once after all register_integrity_* calls. The final submit call only sets verdict, summary, and teamReportMarkdown.",
  ].join("\n\n")
}

export function buildIntegrityEvidencePrompt(input: ReviewPromptInput): string {
  const sections: string[] = []
  sections.push(
    renderUserRequestSection({
      heading: "# User Request",
      title: input.taskTitle,
      request: sanitizeIntegrityPromptText({
        text: input.userRequest,
        field: "user_request_quote",
        maxChars: INTEGRITY_EVIDENCE_LIMITS.userRequestChars,
        markdownContext: "block",
      }).text,
      taskID: input.taskID,
    }),
  )
  if (input.requirements?.length) {
    sections.push(renderRequirementsSummary(input.requirements))
  }
  if (input.requirementStatus?.length) {
    sections.push(renderRequirementStatusSummary(input.requirementStatus))
  }
  if (input.acceptance) {
    sections.push(renderBuildEvidenceSummary(input.acceptance))
  }
  if (input.frontendDesign?.trim()) {
    sections.push(renderFrontendDesignSummary(input.frontendDesign))
  }
  if (input.visualQa?.trim()) {
    sections.push(renderVisualQaSummary(input.visualQa))
  }
  if (input.visualEvidence?.length) {
    sections.push(renderVisualEvidenceSummary(input.visualEvidence))
  }
  sections.push(renderGoalContractSummary(input.goals))
  sections.push(renderScopeBoundedMaturityEvidenceSection(input))
  return clipIntegrityEvidenceText(
    sections.filter((section) => section.trim().length > 0).join("\n\n"),
    INTEGRITY_EVIDENCE_PROMPT_MAX_CHARS,
  )
}

function renderFrontendDesignSummary(frontendDesign: string): string {
  return [
    "# Frontend Design Contract",
    sanitizePromptBlock(frontendDesign, 2_400),
    "",
    "Reviewers must verify that reference-driven UI work follows this frontend replica contract, source manifest, web-clone-source handoff, source evidence expectations, and visual reference requirements.",
    'Use `inspect_integrity_evidence({ section: "frontend_design_contract" })` for the bounded full contract excerpt when this matters to your scope.',
  ].join("\n")
}

function renderVisualQaSummary(visualQa: string): string {
  return [
    "# Visual QA Report",
    sanitizePromptBlock(visualQa, 2_400),
    "",
    "Reviewers must consider this fresh frontend visual GUI and functional evidence when assessing acceptance. GUI means Graphical User Interface.",
    'Use `inspect_integrity_evidence({ section: "visual_qa_report" })` for the bounded full report excerpt when visual and functional QA matters to your scope.',
  ].join("\n")
}

function renderVisualEvidenceSummary(visualEvidence: VisualEvidenceBundle[]): string {
  return [
    "# Visual Evidence Bundles",
    ...visualEvidence.slice(0, 4).map((bundle) => `- ${summarizeVisualEvidenceBundle(bundle)}`),
    "Use `inspect_visual_evidence` for region-level details before accepting reference visual fidelity.",
  ].join("\n")
}

function renderRequirementsSummary(requirements: ParsedRequirement[]): string {
  const visible = requirements.slice(0, INTEGRITY_EVIDENCE_LIMITS.requirements)
  const lines = [
    "# Requirements",
    visible.length === requirements.length
      ? `Rendered all ${requirements.length} requirements.`
      : `Rendered ${visible.length}/${requirements.length} requirements.`,
  ]
  for (const r of visible) {
    const row = [
      `- ${r.id} (${r.type}): ${sanitizePromptBlock(r.description, INTEGRITY_EVIDENCE_LIMITS.requirementDescriptionChars)}`,
    ]
    const acceptance = requirementAcceptanceLines(r.acceptance)
    if (acceptance.length > 0) {
      row.push(
        `  acceptance: ${acceptance
          .map((item) => sanitizePromptBlock(item, INTEGRITY_EVIDENCE_LIMITS.requirementAcceptanceChars))
          .join("; ")}`,
      )
    }
    if (r.non_goals.trim().length > 0) {
      row.push(`  non_goals: ${sanitizePromptBlock(r.non_goals, INTEGRITY_EVIDENCE_LIMITS.requirementNonGoalChars)}`)
    }
    lines.push(row.join("\n"))
  }
  appendOmittedLine(lines, requirements.length, visible.length, "requirements")
  return lines.join("\n")
}

function renderRequirementStatusSummary(rows: RequirementStatusRow[]): string {
  const lines = ["# Requirement Status Snapshot", `Rendered all ${rows.length} requirement status rows.`]
  for (const row of rows) {
    lines.push(
      `## ${row.reqID}: ${sanitizePromptBlock(row.reqDescription, INTEGRITY_EVIDENCE_LIMITS.requirementDescriptionChars)}`,
    )
    const visibleGoals = row.claimingGoals.slice(0, INTEGRITY_EVIDENCE_LIMITS.requirementStatusGoals)
    for (const cg of visibleGoals) {
      const visibleSpecs = cg.specOutcomes.slice(0, INTEGRITY_EVIDENCE_LIMITS.requirementStatusSpecs)
      const specStr = visibleSpecs
        .map(
          (s) =>
            `${s.specID}/${s.severity}=${s.passed === true ? "passed" : s.passed === false ? "failed" : "no-evidence"}${s.summary ? ` (${sanitizePromptBlock(s.summary, 160)})` : ""}`,
        )
        .join(", ")
      lines.push(
        `- ${cg.goalID} "${sanitizePromptLine(cg.goalTitle, "generic")}" runStatus=${cg.runStatus}: ${specStr || "no related specs evaluated"}`,
      )
    }
    if (row.claimingGoals.length === 0) lines.push("- no claiming goal")
    appendOmittedLine(lines, row.claimingGoals.length, visibleGoals.length, "claiming goals")
  }
  return lines.join("\n")
}

function renderBuildEvidenceSummary(acceptance: IntegrityAcceptanceContext): string {
  const allChangedDirectories = promptPathDirectories(acceptance.changedFiles)
  const changedDirectories = allChangedDirectories.slice(0, INTEGRITY_EVIDENCE_LIMITS.buildDirectories)
  const allDiffDirectories = promptPathDirectories((acceptance.diffs ?? []).map((diff) => diff.file))
  const diffDirectories = allDiffDirectories.slice(0, INTEGRITY_EVIDENCE_LIMITS.buildDirectories)
  const lines = [
    "# Build Evidence Context",
    `Summary: ${sanitizePromptBlock(acceptance.summary || "(no summary)", INTEGRITY_EVIDENCE_LIMITS.buildSummaryChars)}`,
    `Changed directories (${changedDirectories.length}/${allChangedDirectories.length}; files=${acceptance.changedFiles.length}):`,
    ...(changedDirectories.length > 0 ? changedDirectories.map((directory) => `- ${directory}`) : ["- (none)"]),
  ]
  appendOmittedLine(lines, allChangedDirectories.length, changedDirectories.length, "changed directories")
  lines.push(
    `Representative diff directories (${diffDirectories.length}/${allDiffDirectories.length}; diffs=${acceptance.diffs?.length ?? 0}):`,
  )
  for (const directory of diffDirectories) lines.push(`- ${directory}`)
  appendOmittedLine(lines, allDiffDirectories.length, diffDirectories.length, "diff directories")
  return lines.join("\n")
}

function renderGoalContractSummary(goals: GoalContractFields[]): string {
  const visible = goals.slice(0, INTEGRITY_EVIDENCE_LIMITS.goals)
  const lines = [`# Goal Contracts Summary (${visible.length}/${goals.length})`]
  for (const goal of visible) {
    const directories = promptPathDirectories(goal.owned_paths).slice(0, INTEGRITY_EVIDENCE_LIMITS.goalDirectories)
    lines.push(
      [
        `## ${goal.id}: ${sanitizePromptLine(goal.title, "generic")}`,
        `Objective: ${sanitizePromptBlock(goal.objective, INTEGRITY_EVIDENCE_LIMITS.goalObjectiveChars)}`,
        `Acceptance Specs Summary:\n${renderAcceptanceSpecSummary(goal.acceptance_specs ?? [])}`,
        `Responsibility Directories (${directories.length}/${promptPathDirectories(goal.owned_paths).length}; paths=${goal.owned_paths.length}): ${directories.join(", ") || "(none)"}`,
        `Priority: ${goal.priority}`,
        `Kind: ${goal.kind}`,
        goal.depends_on?.length ? `Depends on: ${goal.depends_on.join(", ")}` : "",
        goal.requirement_ids?.length ? `Requirement IDs: ${goal.requirement_ids.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
  }
  appendOmittedLine(lines, goals.length, visible.length, "goals")
  return lines.join("\n")
}

function renderAcceptanceSpecSummary(specs: readonly AcceptanceSpec[]): string {
  if (specs.length === 0) return "(no acceptance specs)"
  const visible = specs.slice(0, INTEGRITY_EVIDENCE_LIMITS.goalAcceptanceSpecs)
  const lines: string[] = []
  for (const spec of visible) {
    lines.push(
      `- [${spec.severity}] ${spec.id} <- ${spec.source_requirement_id}: ${sanitizePromptBlock(
        spec.title,
        INTEGRITY_EVIDENCE_LIMITS.goalAcceptanceTitleChars,
      )}; trigger=${spec.trigger ?? "default"}; scorer_count=${spec.scorers.length}`,
    )
  }
  appendOmittedLine(lines, specs.length, visible.length, "acceptance specs")
  return lines.join("\n")
}

export function renderSeverityNewEvidenceSection(input: ReviewPromptInput): string {
  const latestAttempt = input.replayContext.priorAttempts.at(-1)
  const oldAttempts = latestAttempt ? input.replayContext.priorAttempts.slice(0, -1).reverse() : []
  const evidence = input.replayContext.buildEvidenceSinceLastReview
  const changedEvidenceLines = [
    "Build evidence available for deciding whether later severity changes have new evidence:",
  ]
  if (evidence.sinceAttemptNumber !== undefined)
    changedEvidenceLines.push(`- Since attempt: #${evidence.sinceAttemptNumber}`)
  if (evidence.sinceTimeCreated !== undefined) {
    changedEvidenceLines.push(`- Since time: ${new Date(evidence.sinceTimeCreated).toISOString()}`)
  }
  const changedDirectories = promptPathDirectories(evidence.changedFiles)
  changedEvidenceLines.push(
    `- Changed directories: ${changedDirectories.length > 0 ? changedDirectories.join(", ") : "(none)"}`,
  )
  if (evidence.buildSummaries.length > 0) {
    changedEvidenceLines.push("- Build summaries:")
    for (const summary of evidence.buildSummaries.slice(0, 12)) {
      changedEvidenceLines.push(`  - ${sanitizePromptBlock(summary, INTEGRITY_EVIDENCE_LIMITS.buildSummaryChars)}`)
    }
    appendOmittedLine(changedEvidenceLines, evidence.buildSummaries.length, 12, "build summaries")
  }
  const rendered = renderSharedIntegrityPromptContext({
    surface: "severity_context",
    lineage: input.replayContext.lineage,
    latestAttempt,
    changedDirectories,
    changedEvidenceMarkdown: changedEvidenceLines.join("\n"),
    oldAttempts,
    reviewerTextBlocks: renderPriorFindingsForSeverity(input.replayContext),
  }).promptMarkdown

  return [
    "# Severity New Evidence Context",
    "Use this replay-aware SpecSnapshotLineage context when applying Severity Discipline. Prior findings must be read from this lineage context, not from an active-spec-snapshot-only artifact lookup.",
    "When considering any severity change, apply the `new evidence` definition from Severity Discipline above. A deeper reading of unchanged code or unchanged prior runtime output is not new evidence; persistence alone is not promotion.",
    rendered,
  ].join("\n\n")
}

function renderPriorFindingsForSeverity(context: IntegrityReplayContext): string[] {
  const lines: string[] = []
  for (const attempt of context.priorAttempts) {
    if (!attempt.findings?.length) continue
    lines.push(`Attempt #${attempt.attemptNumber} prior findings:`)
    for (const finding of attempt.findings) {
      lines.push(`- [${finding.severity}] ${finding.id}: ${finding.title}`)
      if (finding.description) lines.push(`  description: ${finding.description}`)
      if (finding.repair) lines.push(`  repair: ${finding.repair}`)
      if (finding.filePaths.length > 0)
        lines.push(`  directories: ${promptPathDirectories(finding.filePaths).join(", ")}`)
      if (finding.requirementIDs.length > 0) lines.push(`  requirements: ${finding.requirementIDs.join(", ")}`)
      if (finding.specIDs.length > 0) lines.push(`  specs: ${finding.specIDs.join(", ")}`)
    }
  }
  return lines.length > 0 ? [lines.join("\n")] : []
}

function renderSeverityReconciliationPass(): string {
  return [
    "# Severity Reconciliation Pass",
    "Before emitting the team report:",
    "",
    "1. Identify every group of reviewer findings that target the same defect surface (same file/function/symptom). Treat ids as labels, not as identity; use the description and evidence to detect overlap.",
    "",
    '2. For each group, decide a single team severity using the bar in "Severity Discipline". Do NOT carry both severities forward. If reviewers disagree, fold the group into one finding with `consensus=\"disputed\"` when the disagreement is real, and pick the severity that the bar clauses (a)-(e) support. If neither bar clause is met, the team severity is advisory.',
    "",
    "3. If a finding repeats a defect that was advisory in any prior attempt's report from replay context, and there is no Severity Discipline new evidence raising it to a bar clause (a)-(e), keep it advisory. Persistence alone is not a promotion trigger. A deeper reading of unchanged code or unchanged prior runtime output is not new evidence.",
    "",
    '4. If a finding repeats a defect that was blocking in a prior attempt and the build evidence since that attempt does NOT show a repair on that surface, keep it blocking and mark `consensus=\"agreed\"` with a persistent note.',
  ].join("\n")
}

function renderScopeBoundedMaturityEvidenceSection(input: ReviewPromptInput): string {
  const lines = [
    "# Scope-Bounded Maturity Evidence",
    "",
    "Severity reads maturity meaning only from bounded REQ rows rendered here. Requirement decision-log entries are not part of the initial integrity context.",
    "",
    "Visible bounded REQs from requirements/scope:",
  ]
  if (input.requirements?.length) {
    for (const req of input.requirements) {
      lines.push(
        `- ${req.id}: ${sanitizePromptBlock(req.description, INTEGRITY_EVIDENCE_LIMITS.requirementDescriptionChars)}`,
      )
      const acceptance = requirementAcceptanceLines(req.acceptance)
      if (acceptance.length > 0)
        lines.push(
          `  acceptance: ${acceptance
            .map((item) => sanitizePromptBlock(item, INTEGRITY_EVIDENCE_LIMITS.requirementAcceptanceChars))
            .join("; ")}`,
        )
      if (req.non_goals.trim().length > 0) {
        lines.push(
          `  non_goals: ${sanitizePromptBlock(req.non_goals, INTEGRITY_EVIDENCE_LIMITS.requirementNonGoalChars)}`,
        )
      }
    }
  } else {
    lines.push("- (none rendered)")
  }

  lines.push("", "Omitted maturity decisions:")
  const pending = input.requirementDecisions?.filter((decision) => decision.key === "maturity_scope_pending") ?? []
  if (pending.length > 0) {
    lines.push(
      `- ${pending.length} requirement decision-log entr${pending.length === 1 ? "y is" : "ies are"} omitted from the initial integrity context. If a maturity phrase is absent from bounded REQs, reviewers may raise at most one requirements-extraction concern from the rendered user request and REQ rows; do not derive severity thresholds from hidden decisions.`,
    )
  } else {
    lines.push(
      "- No omitted maturity decision is rendered here. Do not infer one; use only bounded REQs above and explicit request phrases already rendered.",
    )
  }
  return lines.join("\n")
}

function requirementAcceptanceLines(value: ParsedRequirement["acceptance"]): string[] {
  if (Array.isArray(value)) return value.filter((item) => item.trim().length > 0)
  if (typeof value !== "string") return []
  const trimmed = value.trim()
  if (!trimmed) return []
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (Array.isArray(parsed))
      return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
  } catch {
    // Plain-text acceptance is already a valid requirements row rendering.
  }
  return [trimmed]
}

function sanitizePromptLine(text: string, field: "user_request_quote" | "generic"): string {
  return sanitizeIntegrityPromptText({
    text,
    field,
    markdownContext: "inline",
  })
    .text.replace(/\s+/g, " ")
    .trim()
}

function sanitizePromptBlock(text: string, maxChars: number): string {
  return sanitizeIntegrityPromptText({
    text,
    field: "generic",
    markdownContext: "block",
    maxChars,
  }).text
}

function promptPathDirectories(paths: readonly string[]): string[] {
  const directories = new Set<string>()
  for (const path of paths) {
    const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "")
    const index = normalized.lastIndexOf("/")
    directories.add(index > 0 ? normalized.slice(0, index) : ".")
  }
  return [...directories].sort((left, right) => left.localeCompare(right))
}

function appendOmittedLine(lines: string[], total: number, rendered: number, label: string) {
  if (total > rendered) lines.push(`- omitted ${total - rendered} ${label} from initial integrity context`)
}

function clipIntegrityEvidenceText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const marker = "\n[omitted_by_initial_integrity_context_cap]"
  return `${text.slice(0, Math.max(0, maxChars - marker.length)).trimEnd()}${marker}`
}

function normalizeTeamReport(report: IntegrityTeamReport, replayContext?: IntegrityReplayContext): IntegrityResult {
  const priorFindingByFingerprint = buildPriorManifestIndex(
    (replayContext?.priorAttempts ?? []).map((attempt) => ({
      attemptNumber: attempt.attemptNumber,
      findings: attempt.findings ?? [],
      requiredRepairs: [],
    })),
  )
  const priorRepairByFingerprint = buildPriorManifestIndex(
    (replayContext?.priorAttempts ?? []).map((attempt) => ({
      attemptNumber: attempt.attemptNumber,
      findings: [],
      requiredRepairs: attempt.requiredRepairs,
    })),
  )
  const findings = report.findings.map((finding) => normalizeManifestFinding(finding, priorFindingByFingerprint))
  const repairsByFingerprint = new Map<string, IntegrityRequiredRepair>()
  for (const repair of report.requiredRepairs) {
    const normalized = normalizeManifestRepair(repair, priorRepairByFingerprint, findings)
    repairsByFingerprint.set(normalized.fingerprint!, normalized)
  }
  for (const finding of findings) {
    if (finding.severity !== "blocking" && finding.verdictImpact !== "needs_correction") continue
    if (repairsByFingerprint.has(finding.fingerprint!)) continue
    repairsByFingerprint.set(finding.fingerprint!, repairFromFinding(finding))
  }
  const requiredRepairs = [...repairsByFingerprint.values()]
  return {
    ...report,
    findings,
    requiredRepairs,
    summary: limitSummary(report.summary),
    issues: findings.map((finding) => ({
      type: finding.severity,
      description: `${finding.title}: ${finding.description}`,
      goalIDs: finding.targetIDs,
      requirementIDs: finding.requirementIDs,
      specIDs: finding.specIDs,
      userRequestQuotes: finding.userRequestQuotes ?? [],
      evidence: finding.evidence.join(" | "),
    })),
    corrections: [],
    graphCorrections: [],
    missingGoals: [],
  }
}

function normalizeManifestFinding(
  finding: IntegrityFinding,
  priorByFingerprint: Map<string, { id: string; fingerprint: string; attemptNumber?: number }>,
): IntegrityFinding {
  const canonicalSymptom = canonicalIntegritySymptom(finding)
  const fingerprint = integrityFindingFingerprint({ ...finding, canonicalSymptom })
  const prior = priorByFingerprint.get(fingerprint)
  const priorAttemptRefs = stableList([
    ...(finding.priorAttemptRefs ?? []),
    ...(prior?.attemptNumber ? [`R${prior.attemptNumber}:${prior.id}`] : []),
  ])
  return {
    ...finding,
    id: prior?.id ?? finding.id,
    fingerprint,
    canonicalSymptom,
    checkIDs: stableList(finding.checkIDs ?? []),
    affectedSymbols: stableList(finding.affectedSymbols ?? []),
    verify: defaultIntegrityVerify(finding),
    sourceFindingIDs: stableList([...(finding.sourceFindingIDs ?? []), finding.id, ...(prior ? [prior.id] : [])]),
    priorAttemptRefs,
  }
}

function normalizeManifestRepair(
  repair: IntegrityRequiredRepair,
  priorByFingerprint: Map<string, { id: string; fingerprint: string; attemptNumber?: number }>,
  findings: IntegrityFinding[],
): IntegrityRequiredRepair {
  const linkedFinding = findings.find(
    (finding) =>
      (repair.sourceFindingIDs ?? []).includes(finding.id) ||
      (repair.sourceFindingIDs ?? []).some((id) => (finding.sourceFindingIDs ?? []).includes(id)) ||
      (finding.sourceFindingIDs ?? []).includes(repair.id) ||
      repair.id === finding.id ||
      repair.id === `repair-${finding.id}` ||
      integrityFindingFingerprint(repair) === finding.fingerprint,
  )
  const source = linkedFinding ?? repair
  const canonicalSymptom = canonicalIntegritySymptom({
    ...source,
    canonicalSymptom: repair.canonicalSymptom ?? source.canonicalSymptom,
    description: repair.description || source.description,
  })
  const fingerprint = linkedFinding?.fingerprint ?? integrityFindingFingerprint({ ...repair, canonicalSymptom })
  const prior = priorByFingerprint.get(fingerprint)
  return {
    ...repair,
    id: prior?.id ?? repair.id,
    fingerprint,
    severity: repair.severity ?? linkedFinding?.severity ?? "blocking",
    title: repair.title ?? linkedFinding?.title,
    canonicalSymptom,
    evidence: (repair.evidence ?? []).length > 0 ? repair.evidence : (linkedFinding?.evidence ?? []),
    targetIDs: stableList([...(repair.targetIDs ?? []), ...(linkedFinding?.targetIDs ?? [])]),
    requirementIDs: stableList([...(repair.requirementIDs ?? []), ...(linkedFinding?.requirementIDs ?? [])]),
    specIDs: stableList([...(repair.specIDs ?? []), ...(linkedFinding?.specIDs ?? [])]),
    filePaths: stableList([...(repair.filePaths ?? []), ...(linkedFinding?.filePaths ?? [])]),
    affectedSymbols: stableList([...(repair.affectedSymbols ?? []), ...(linkedFinding?.affectedSymbols ?? [])]),
    checkIDs: stableList([...(repair.checkIDs ?? []), ...(linkedFinding?.checkIDs ?? [])]),
    repair: repair.repair ?? linkedFinding?.repair ?? repair.description,
    verify: defaultIntegrityVerify({
      ...repair,
      repair: repair.repair ?? linkedFinding?.repair ?? repair.description,
      evidence: (repair.evidence ?? []).length > 0 ? repair.evidence : linkedFinding?.evidence,
      filePaths: (repair.filePaths ?? []).length > 0 ? repair.filePaths : linkedFinding?.filePaths,
      verify: (repair.verify ?? []).length > 0 ? repair.verify : linkedFinding?.verify,
    }),
    sourceFindingIDs: stableList([...(repair.sourceFindingIDs ?? []), ...(linkedFinding ? [linkedFinding.id] : [])]),
    priorAttemptRefs: stableList([
      ...(repair.priorAttemptRefs ?? []),
      ...(prior?.attemptNumber ? [`R${prior.attemptNumber}:${prior.id}`] : []),
    ]),
  }
}

function repairFromFinding(finding: IntegrityFinding): IntegrityRequiredRepair {
  return {
    id: `repair-${finding.id}`,
    fingerprint: finding.fingerprint,
    severity: finding.severity,
    checkIDs: finding.checkIDs,
    title: finding.title,
    canonicalSymptom: finding.canonicalSymptom,
    description: finding.repair,
    evidence: finding.evidence,
    targetIDs: finding.targetIDs,
    requirementIDs: finding.requirementIDs,
    specIDs: finding.specIDs,
    filePaths: finding.filePaths,
    affectedSymbols: finding.affectedSymbols,
    repair: finding.repair,
    verify: finding.verify,
    sourceFindingIDs: [finding.id],
    priorAttemptRefs: finding.priorAttemptRefs,
  }
}

function createNoGoalsResult(): IntegrityResult {
  const checkID = "check-no-goals-produced"
  const finding: IntegrityFinding = {
    id: "no-goals-produced",
    checkIDs: [checkID],
    severity: "blocking",
    verdictImpact: "needs_correction",
    title: "No goals produced",
    description: "The active spec snapshot has no goal contracts to review.",
    evidence: ["Goal contract list is empty."],
    targetIDs: [],
    requirementIDs: [],
    specIDs: [],
    filePaths: [],
    affectedSymbols: [],
    repair: "Run architect again and produce goal contracts before integrity review.",
    verify: ["Confirm the active spec snapshot contains at least one goal contract before review."],
    sourceFindingIDs: [],
    priorAttemptRefs: [],
    reviewers: ["contract-reviewer", "completion-reviewer"],
    consensus: "agreed",
  }
  const reviewers: IntegrityReviewerReport[] = [
    {
      reviewerID: "contract-reviewer",
      checkIDs: [checkID],
      scope: "Goal graph existence",
      verdict: "needs_correction",
      summary: "No goal contracts exist.",
      investigationPlan: {
        requestPromise: "Active task has goal contracts before integrity review.",
        hypothesis: "The task cannot be reviewed because no goal contract exists.",
        evidencePlan: ["Inspect the active goal contract list."],
        passCriteria: ["At least one goal contract exists for the active task."],
      },
      drilldowns: [],
      coverage: [],
      evidence: [{ checkIDs: [checkID], note: "goals.length=0" }],
      openQuestions: [],
    },
    {
      reviewerID: "completion-reviewer",
      checkIDs: [checkID],
      scope: "User request completion",
      verdict: "needs_correction",
      summary: "Completion cannot be reviewed without goals.",
      investigationPlan: {
        requestPromise: "The requested work is represented by reviewable goal contracts.",
        hypothesis: "No goal accepts ownership of the user request, so completion cannot be verified.",
        evidencePlan: ["Inspect goal ownership for the user request."],
        passCriteria: ["A goal contract owns the user request and can be reviewed."],
      },
      drilldowns: [],
      coverage: [],
      evidence: [{ checkIDs: [checkID], note: "No goal accepts ownership of the user request." }],
      openQuestions: [],
    },
  ]
  return normalizeTeamReport({
    verdict: "needs_correction",
    summary: "Integrity needs correction: no goals produced.",
    teamReportMarkdown:
      "### Integrity team review (verdict=needs_correction)\n\nBlocking: no goal contracts exist. Run architect again before review.",
    checkItems: [
      {
        id: checkID,
        category: "contract",
        target: "active goal contract list",
        question: "Does the active spec snapshot contain reviewable goal contracts?",
        status: "failed",
        expected: "At least one goal contract exists for the active task.",
        observed: "The active spec snapshot has no goal contracts.",
        evidence: ["Goal contract list is empty."],
        requirementIDs: [],
        specIDs: [],
        targetIDs: [],
        userRequestQuotes: [],
      },
    ],
    reviewers,
    coverageAudit: [
      {
        checkIDs: [checkID],
        promise: "Active task has goal contracts before integrity review.",
        reviewerIDs: reviewers.map((r) => r.reviewerID),
        status: "missing",
        notes: "No goal contracts were available for request coverage audit.",
      },
    ],
    uninspectedRisks: [
      {
        checkIDs: [checkID],
        risk: "User request completion cannot be inspected without goal contracts.",
        reason: "The active spec snapshot has no goals.",
        action: "block",
      },
    ],
    findings: [finding],
    rounds: [
      {
        roundID: "synthetic-no-goals",
        prompt: "Host detected an empty goal contract list.",
        reviewerIDs: reviewers.map((r) => r.reviewerID),
        outcome: "Consensus blocking failure.",
      },
    ],
    requiredRepairs: [
      {
        id: "repair-no-goals",
        checkIDs: [checkID],
        severity: "blocking",
        title: "No goals produced",
        description: "Create goal contracts for the active spec snapshot.",
        evidence: ["Goal contract list is empty."],
        targetIDs: [],
        requirementIDs: [],
        specIDs: [],
        filePaths: [],
        affectedSymbols: [],
        repair: "Run architect again and produce goal contracts before integrity review.",
        verify: ["Confirm the active spec snapshot contains at least one goal contract before review."],
        sourceFindingIDs: ["no-goals-produced"],
        priorAttemptRefs: [],
      },
    ],
    unresolvedDisagreements: [],
    // Host-synthesised team report (no-goals path): the supervisor LLM
    // never ran, so it has no chance to register fact_check_items.
    // Empty array at the single construction site (rule 8 single source,
    // fact-check agent contract §6.1.3).
    fact_check_items: [],
  })
}

async function emitSoftIntegrity(
  input: { taskID?: string; parentSessionID?: string; taskTitle: string },
  result: IntegrityResult,
  attempts: number,
): Promise<string | undefined> {
  if (!input.taskID || !input.parentSessionID) return undefined
  const { Session } = await import("@/session")
  const session = await Session.createNext({
    kind: "integrity",
    parentID: input.parentSessionID,
    title: `Integrity Supervisor: ${input.taskTitle}`,
    directory: Instance.directory,
  })
  emitIntegrityEvent(input.taskID, session.id, result, attempts)
  return session.id
}

function emitIntegrityEvent(
  taskID: string | undefined,
  sessionID: string | undefined,
  result: IntegrityResult,
  attempts: number,
): void {
  if (!taskID) return
  if (!sessionID) throw new Error(`integrity.review.completed: sessionID required but missing (taskID=${taskID}).`)
  const payload: IntegrityReviewCompletedPayload = {
    taskID,
    sessionID,
    verdict: result.verdict,
    summary: result.summary,
    teamReportMarkdown: result.teamReportMarkdown,
    checkItems: result.checkItems,
    reviewers: result.reviewers,
    coverageAudit: result.coverageAudit,
    uninspectedRisks: result.uninspectedRisks,
    findings: result.findings,
    rounds: result.rounds,
    requiredRepairs: result.requiredRepairs,
    unresolvedDisagreements: result.unresolvedDisagreements,
    // Pass through the consensus-stage registration list. The consensus
    // schema defaults a missing list to [], so absence means no fact-check
    // items were registered.
    fact_check_items: result.fact_check_items ?? [],
    attempts,
  }
  void EngineProtocol.emit(EngineEvent.IntegrityReviewCompleted, IntegrityReviewCompletedPayloadSchema.parse(payload), {
    source: "architect.integrity",
  })
}

function renderReviewerPlanMarkdown(plan: IntegrityReviewerPlan): string {
  const lines = [`## Reviewer Plan`, `Rationale: ${plan.rationale}`]
  if (plan.taskProfile) {
    lines.push(
      [
        "Task profile:",
        `- categories: ${plan.taskProfile.categories.join(", ") || "(none)"}`,
        `- request critical promises: ${plan.taskProfile.requestCriticalPromises.join(" | ") || "(none)"}`,
        `- changed surfaces: ${plan.taskProfile.changedSurfaces.join(", ") || "(none)"}`,
        `- available evidence surfaces: ${plan.taskProfile.availableEvidenceSurfaces.join(", ") || "(none)"}`,
      ].join("\n"),
    )
  }
  if ((plan.riskHypotheses ?? []).length > 0) {
    lines.push(
      [
        "Risk hypotheses:",
        ...plan.riskHypotheses.map(
          (risk) =>
            `- ${risk.id}: ${risk.title}; relevant=${risk.whyRelevantToRequest}; evidence=${risk.evidenceNeeded.join(
              " | ",
            )}${risk.suggestedReviewerID ? `; suggested=${risk.suggestedReviewerID}` : ""}`,
        ),
      ].join("\n"),
    )
  }
  if ((plan.coveragePlan ?? []).length > 0) lines.push("Coverage plan:", markdownList(plan.coveragePlan))
  for (const reviewer of plan.reviewers) {
    lines.push(
      [
        `### ${reviewer.reviewerID}: ${reviewer.title}`,
        `Focus: ${reviewer.focus}`,
        (reviewer.riskHypothesisIDs ?? []).length ? `Risk hypotheses: ${reviewer.riskHypothesisIDs.join(", ")}` : "",
        (reviewer.drilldownPlan ?? []).length ? `Drilldown plan:\n${markdownList(reviewer.drilldownPlan)}` : "",
        `Questions:\n${markdownList(reviewer.adversarialQuestions)}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
  }
  return lines.join("\n\n")
}

function renderReviewerReportsForConsensusPrompt(reports: IntegrityReviewerReport[]): string {
  return clipIntegrityEvidenceText(
    reports.map(renderReviewerReportForConsensusPrompt).join("\n\n"),
    INTEGRITY_CONSENSUS_REVIEWER_REPORTS_MAX_CHARS,
  )
}

function renderReviewerReportForConsensusPrompt(report: IntegrityReviewerReport): string {
  const limits = INTEGRITY_CONSENSUS_REPORT_LIMITS
  const lines = [
    `## Reviewer ${sanitizePromptLine(report.reviewerID, "generic")}: ${report.verdict}`,
    `Scope: ${sanitizePromptBlock(report.scope, limits.fieldChars)}`,
    `Summary: ${sanitizePromptBlock(report.summary, limits.summaryChars)}`,
  ]
  lines.push(
    [
      "Investigation plan:",
      `- request promise: ${sanitizePromptBlock(report.investigationPlan.requestPromise, limits.fieldChars)}`,
      `- hypothesis: ${sanitizePromptBlock(report.investigationPlan.hypothesis, limits.fieldChars)}`,
      `- evidence plan: ${boundedPromptList(report.investigationPlan.evidencePlan, 6, limits.fieldChars).join(" | ")}`,
      `- pass criteria: ${boundedPromptList(report.investigationPlan.passCriteria, 6, limits.fieldChars).join(" | ")}`,
    ].join("\n"),
  )
  if ((report.drilldowns ?? []).length > 0) {
    const items = report.drilldowns.map(
      (drilldown) =>
        `${drilldown.checkIDs.join(",")}: ${drilldown.kind}:${drilldown.target} - ${drilldown.purpose} => ${drilldown.result}`,
    )
    lines.push("Drilldowns:", markdownListWithOmissions(items, limits.drilldowns, limits.fieldChars, "drilldowns"))
  }
  if ((report.coverage ?? []).length > 0) {
    const items = report.coverage.map((row) => {
      const target = row.requirementID ?? row.specID ?? row.userRequestQuote ?? "(unanchored)"
      return `${row.checkIDs.join(",")}: ${target}: ${row.status} - ${row.evidence}`
    })
    lines.push("Coverage:", markdownListWithOmissions(items, limits.coverage, limits.fieldChars, "coverage rows"))
  }
  if ((report.evidence ?? []).length > 0) {
    const evidenceItems = report.evidence.map((row) => `${row.checkIDs.join(",")}: ${row.note}`)
    lines.push(
      "Evidence:",
      markdownListWithOmissions(evidenceItems, limits.evidence, limits.fieldChars, "evidence rows"),
    )
  }
  if ((report.openQuestions ?? []).length > 0) {
    lines.push(
      "Open questions:",
      markdownListWithOmissions(report.openQuestions, limits.openQuestions, limits.fieldChars, "open questions"),
    )
  }
  return lines.join("\n")
}

function markdownListWithOmissions(
  items: readonly string[],
  visibleCount: number,
  itemChars: number,
  label: string,
): string {
  const visible = boundedPromptList(items, visibleCount, itemChars)
  const lines = visible.map((item) => `- ${item}`)
  appendOmittedLine(lines, items.length, visible.length, label)
  return lines.join("\n")
}

function boundedPromptList(items: readonly string[], visibleCount: number, itemChars: number): string[] {
  return items.slice(0, visibleCount).map((item) => sanitizePromptBlock(item, itemChars).replace(/\s+/g, " ").trim())
}

function goalToIntegrityEvidenceGoalInfo(goal: GoalContractFields): IntegrityEvidenceGoalInfo {
  return {
    id: goal.id,
    title: goal.title,
    description: goal.objective,
    criteria: renderAcceptanceSpecSummary(goal.acceptance_specs ?? []),
    priority: goal.priority,
    acceptance_spec_count: goal.acceptance_specs?.length ?? 0,
    acceptance_scenarios: (goal.acceptance_specs ?? []).filter((spec) => Boolean(spec.scenario)),
    acceptance_specs: goal.acceptance_specs ?? [],
    requirement_ids: goal.requirement_ids ?? [],
    depends_on: goal.depends_on ?? [],
    owned_paths: goal.owned_paths ?? [],
  }
}

export function applyIntegrityCorrections(goals: GoalContractFields[], result: IntegrityResult): GoalContractFields[] {
  if (result.verdict !== "needs_correction") return goals
  if (result.corrections.length === 0 && result.missingGoals.length === 0) return goals
  let corrected = [...goals]
  for (const correction of result.corrections) {
    if (correction.action === "modify" && correction.updates)
      corrected = corrected.map((g) => (g.id === correction.goalID ? { ...g, ...correction.updates } : g))
    if (correction.action === "remove") corrected = corrected.filter((g) => g.id !== correction.goalID)
  }
  for (const missing of result.missingGoals) {
    const normalizedTitle = missing.title.toLowerCase().trim()
    if (corrected.some((g) => g.title.toLowerCase().trim() === normalizedTitle)) continue
    const newGoalID = `goal_integrity_${corrected.length + 1}`
    const acceptance_specs: AcceptanceSpec[] = missing.acceptance_spec_hints.map((hint, i) => ({
      id: `acc-${newGoalID}-${i + 1}`,
      source_requirement_id: "integrity-pending",
      goal_id: newGoalID,
      title: hint.length > 80 ? hint.slice(0, 77) + "..." : hint,
      scorers: [{ type: "llm_judge", name: `judge-${i + 1}`, criteria: hint }],
      severity: missing.priority === "blocking" ? "essential" : "important",
    }))
    corrected.push({
      id: newGoalID,
      title: missing.title,
      objective: missing.objective,
      acceptance_specs,
      owned_paths: missing.owned_paths,
      depends_on: [],
      priority: missing.priority,
      kind: missing.kind,
      requirement_ids: [],
    })
  }
  return corrected
}
