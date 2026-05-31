import { tool } from "ai"
import TEAM_CORE from "@/prompt/core/integrity-team-core.txt"
import { runAgentSession } from "@/agent/runner"
import { withFactCheckRegistration } from "@/prompt/fragments/fact-check-registration"
import { limitSummary, markdownList } from "@/agent/report"
import type { AcceptanceSpec } from "@/acceptance/types"
import { AgentSemaphore } from "@/engine/agent-semaphore"
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
  IntegrityReviewCompletedPayloadSchema,
  IntegrityCoverageStatusValues,
  IntegrityReviewerPlanSchema,
  IntegrityReviewerReportSchema,
  IntegrityTeamReportSchema,
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
  "- Each `coverage[]` row uses singular anchor fields only: `requirementID?: string`, `specID?: string`, `userRequestQuote?: string`, `status`, and `evidence`.",
  "- Do not put finding traceability fields inside `coverage[]`: no `requirementIDs`, `specIDs`, `userRequestQuotes`, `affectedSymbols`, or plural arrays.",
  "- Every `coverage[]` row must include at least one singular anchor: `requirementID`, `specID`, or `userRequestQuote`.",
  "- If several anchors apply, emit several coverage rows or choose the strongest single anchor; reserve plural traceability arrays for `findings[]` only.",
].join("\n")

const REVIEWER_DRILLDOWN_ROW_CONTRACT_PROMPT = [
  "Reviewer drilldown row contract:",
  "- Each `drilldowns[]` row uses exactly `kind`, `target`, `purpose`, and `result`.",
  "- Do not put finding fields inside `drilldowns[]`: no `affectedSymbols`, `requirementIDs`, `specIDs`, `userRequestQuotes`, `filePaths`, or typo variants.",
  "- Put impacted symbols and files on `findings[]` only when there is an actual finding.",
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
  replayContext: IntegrityReplayContext
  signal?: AbortSignal
  taskID?: string
}

type PlanCollector = { plan?: IntegrityReviewerPlan }
type ReviewerCollector = { report?: IntegrityReviewerReport }
type ConsensusCollector = { report?: IntegrityTeamReport }

const INTEGRITY_EVIDENCE_PROMPT_MAX_CHARS = 12_000
const INTEGRITY_EVIDENCE_LIMITS = {
  userRequestChars: 800,
  requirements: 8,
  requirementDescriptionChars: 120,
  requirementAcceptanceChars: 100,
  requirementNonGoalChars: 80,
  requirementStatusRows: 8,
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
  replayContext?: IntegrityReplayContext
  signal?: AbortSignal
  taskID?: string
  task?: TaskRow
  parentSessionID?: string
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
  let activeReviewID: string | undefined

  const planCollector: PlanCollector = {}
  const planOut = await runAgentSession<PlanCollector>({
    kind: "integrity",
    core: TEAM_CORE,
    sessionTitle: `Integrity Supervisor: ${input.taskTitle}`,
    parentSessionID: input.parentSessionID,
    taskID: input.taskID,
    signal: input.signal,
    toolKit: createPlanToolKit(planCollector),
    buildUserPrompt: () => buildSupervisorPlanPrompt(promptInput),
    terminalTool: {
      toolName: "submit_integrity_review_plan",
      isSatisfied: (collector) => Boolean(collector.plan),
      shouldExposeOnlyTerminalTool: () => true,
    },
    stream: createReviewReasoningForwarder({
      taskID: input.taskID,
      reviewID: () => activeReviewID,
      phase: "integrity",
      attempt: () => attemptNumber,
      source: "architect.integrity.supervisor",
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
              summary: "integrity supervisor coordinating reviewer team",
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

  const plan = planOut.collector.plan
  if (!plan) throw new Error("integrity supervisor did not submit a reviewer plan.")
  assertUniqueReviewerIDs(plan)

  const reviewerReports = await Promise.all(
    plan.reviewers.map((scope) =>
      runReviewerSessionWithSlot({
        input: promptInput,
        scope,
        parentSessionID: planOut.session.id,
        task: input.task,
      }),
    ),
  )

  const consensusCollector: ConsensusCollector = {}
  const consensusOut = await runAgentSession<ConsensusCollector>({
    kind: "integrity",
    // Consensus phase ONLY (specs/fact-check-agent-2026-05-25.md §5.2):
    // plan (:197) and reviewer (:404) phases use different terminal
    // schemas and intentionally do not register fact_check_items.
    core: withFactCheckRegistration(TEAM_CORE),
    sessionTitle: `Integrity Supervisor: ${input.taskTitle}`,
    existingSessionID: planOut.session.id,
    parentSessionID: input.parentSessionID,
    taskID: input.taskID,
    signal: input.signal,
    toolKit: createConsensusToolKit(consensusCollector, reviewerReports),
    buildUserPrompt: () => buildSupervisorConsensusPrompt(promptInput, plan, reviewerReports),
    terminalTool: {
      toolName: "submit_integrity_consensus",
      isSatisfied: (collector) => Boolean(collector.report),
      shouldExposeOnlyTerminalTool: () => true,
    },
    stream: createReviewReasoningForwarder({
      taskID: input.taskID,
      reviewID: () => activeReviewID,
      phase: "integrity",
      attempt: () => attemptNumber,
      source: "architect.integrity.supervisor",
    }),
  })

  const result = consensusOut.collector.report
  if (!result) throw new Error("integrity supervisor did not submit consensus report.")
  const normalized = normalizeTeamReport(result, input.replayContext)
  log.info("integrity team review completed", {
    verdict: normalized.verdict,
    reviewers: normalized.reviewers.length,
    findings: normalized.findings.length,
    requiredRepairs: normalized.requiredRepairs.length,
  })
  emitIntegrityEvent(input.taskID, planOut.session.id, normalized, attemptNumber)
  return { ...normalized, sessionID: planOut.session.id }
}

function createPlanToolKit(collector: PlanCollector) {
  return {
    tools: {
      submit_integrity_review_plan: tool({
        description:
          "Submit a dynamic adversarial reviewer plan with 2-6 independent reviewers. Use the task scale and replay context: broad first reviews may need more reviewers, narrow re-reviews may need fewer targeted reviewers. Do not default to five reviewers and do not use fixed dimensions.",
        inputSchema: IntegrityReviewerPlanSchema,
        execute: async (raw) => {
          const parsed = IntegrityReviewerPlanSchema.safeParse(raw)
          if (!parsed.success) return `Error: reviewer plan failed schema validation: ${parsed.error.message}`
          collector.plan = parsed.data
          return `PASS: reviewer plan accepted (${parsed.data.reviewers.map((r) => r.reviewerID).join(", ")}).`
        },
      }),
    },
    getCollector: () => collector,
    buildReport: () => ({
      summary: collector.plan
        ? `Reviewer plan with ${collector.plan.reviewers.length} reviewer(s)`
        : "Reviewer plan missing",
      detail: collector.plan ? renderReviewerPlanMarkdown(collector.plan) : "No reviewer plan submitted.",
    }),
  }
}

function createReviewerToolKit(input: {
  collector: ReviewerCollector
  scope: IntegrityReviewerScope
  taskID?: string
  goals: GoalContractFields[]
  acceptance?: IntegrityAcceptanceContext
  frontendDesign?: string
  attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>
  signal?: AbortSignal
}) {
  const evidenceTools = input.taskID
    ? createIntegrityAcceptanceTools({
        taskID: input.taskID,
        goals: input.goals.map(goalToIntegrityEvidenceGoalInfo),
        buildEvidence: input.acceptance,
        frontendDesign: input.frontendDesign,
        attachments: input.attachments,
        signal: input.signal,
      })
    : {}
  return {
    tools: {
      ...evidenceTools,
      submit_reviewer_report: tool({
        description:
          "Submit this independent reviewer's evidence-backed report. Do not emit code changes. coverage[] rows must use singular anchor fields requirementID/specID/userRequestQuote; drilldowns[] rows must use kind/target/purpose/result only.",
        inputSchema: IntegrityReviewerReportSchema,
        execute: async (raw) => {
          const parsed = IntegrityReviewerReportSchema.safeParse(raw)
          if (!parsed.success) return `Error: reviewer report failed schema validation: ${parsed.error.message}`
          if (parsed.data.reviewerID !== input.scope.reviewerID)
            return `Error: reviewerID must be ${input.scope.reviewerID}.`
          input.collector.report = parsed.data
          return `PASS: reviewer report accepted with ${parsed.data.findings.length} finding(s).`
        },
      }),
    },
    getCollector: () => input.collector,
    buildReport: () => ({
      summary: input.collector.report?.summary ?? `${input.scope.reviewerID} report missing`,
      detail: input.collector.report ? renderReviewerReportMarkdown(input.collector.report) : "No report submitted.",
    }),
  }
}

function createConsensusToolKit(collector: ConsensusCollector, reviewerReports: IntegrityReviewerReport[]) {
  const reviewerIDs = new Set(reviewerReports.map((report) => report.reviewerID))
  return {
    tools: {
      submit_integrity_consensus: tool({
        description:
          `Submit the final integrity team consensus. Fold runtime/acceptance evidence into findings; do not emit dimensions or acceptance objects. coverageAudit[].status must be exactly one of ${IntegrityCoverageStatusValues.join(", ")}; do not use verdict values such as concerns there.`,
        inputSchema: IntegrityTeamReportSchema,
        execute: async (raw) => {
          const parsed = IntegrityTeamReportSchema.safeParse(raw)
          if (!parsed.success) return `Error: integrity consensus failed schema validation: ${parsed.error.message}`
          const missing = [...reviewerIDs].filter(
            (id) => !parsed.data.reviewers.some((report) => report.reviewerID === id),
          )
          if (missing.length > 0) return `Error: consensus omitted reviewer report(s): ${missing.join(", ")}.`
          collector.report = parsed.data
          return `PASS: integrity consensus accepted with verdict=${parsed.data.verdict}.`
        },
      }),
    },
    getCollector: () => collector,
    buildReport: () => ({
      summary: collector.report?.summary ?? "Integrity consensus missing",
      detail: collector.report?.teamReportMarkdown ?? "No consensus report submitted.",
    }),
  }
}

async function runReviewerSession(input: {
  input: ReviewPromptInput
  scope: IntegrityReviewerScope
  parentSessionID: string
}): Promise<IntegrityReviewerReport> {
  const collector: ReviewerCollector = {}
  // Each reviewer streams reasoning under its OWN reviewID derived from its
  // own child session id. Sharing the supervisor's reviewID would collapse
  // N reviewers' reasoning into a single overlay partID and produce the
  // 168KB-cross-contaminated-text render-thrash described in
  // specs/new-arch/2026-05-26-integrity-reviewer-stream-reviewid.md.
  let reviewerReviewID: string | undefined
  const reviewerSource = `architect.integrity.reviewer.${input.scope.reviewerID}`
  const out = await runAgentSession<ReviewerCollector>({
    kind: "integrity",
    core: TEAM_CORE,
    sessionTitle: `Integrity Reviewer: ${input.scope.title}`,
    parentSessionID: input.parentSessionID,
    taskID: input.input.taskID,
    signal: input.input.signal,
    toolKit: createReviewerToolKit({
      collector,
      scope: input.scope,
      taskID: input.input.taskID,
      goals: input.input.goals,
      acceptance: input.input.acceptance,
      frontendDesign: input.input.frontendDesign,
      attachments: input.input.attachments,
      signal: input.input.signal,
    }),
    buildUserPrompt: () => buildReviewerPrompt(input.input, input.scope),
    buildUserParts:
      input.input.attachments && input.input.attachments.length > 0
        ? async () => {
            const text = buildReviewerPrompt(input.input, input.scope)
            const inline = await AttachmentStore.inlineFileParts(input.input.attachments!)
            return [
              {
                type: "text" as const,
                text: text + AttachmentStore.renderAttachmentInventory(input.input.attachments!),
              },
              ...inline,
            ]
          }
        : undefined,
    terminalTool: {
      toolName: "submit_reviewer_report",
      isSatisfied: (collector) => Boolean(collector.report),
      shouldExposeOnlyTerminalTool: () => false,
    },
    stream: createReviewReasoningForwarder({
      taskID: input.input.taskID,
      reviewID: () => reviewerReviewID,
      phase: "integrity",
      attempt: () => input.input.replayContext.attemptNumber,
      source: reviewerSource,
    }),
    onSessionCreated: (session) => {
      reviewerReviewID = reviewIDForIntegrity(session.id)
      emitReviewStreamStarted({
        taskID: input.input.taskID,
        reviewID: reviewerReviewID,
        phase: "integrity",
        sessionID: session.id,
        source: reviewerSource,
      })
    },
  })
  if (!out.collector.report) throw new Error(`integrity reviewer ${input.scope.reviewerID} did not submit a report.`)
  return out.collector.report
}

async function runReviewerSessionWithSlot(input: {
  input: ReviewPromptInput
  scope: IntegrityReviewerScope
  parentSessionID: string
  task?: TaskRow
}): Promise<IntegrityReviewerReport> {
  const run = () =>
    runReviewerSession({
      input: input.input,
      scope: input.scope,
      parentSessionID: input.parentSessionID,
    })
  if (!input.task) return await run()
  return await AgentSemaphore.withSlot(input.task, run)
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
    COVERAGE_AUDIT_STATUS_CONTRACT_PROMPT,
    REVIEWER_COVERAGE_ROW_CONTRACT_PROMPT,
    REVIEWER_DRILLDOWN_ROW_CONTRACT_PROMPT,
    renderSeverityNewEvidenceSection(input),
    [
      "Before deep evidence reads, form an investigation plan for your scope: request promise, risk hypothesis, evidence plan, and pass/finding criteria. Include it in `investigationPlan` in submit_reviewer_report.",
      "Record scoped tool work in `drilldowns[]`, and record request/REQ/spec coverage in `coverage[]`. A pass report still needs coverage evidence.",
      "Use scoped drilldown. Prefer `inspect_integrity_evidence` sections such as overview, changed_directories, changed_files_in_directory, diff_for_file, goal_summary, goal_detail, and frontend_design_contract when visual/reference fidelity matters. Do not request full upstream context, full contract graph, raw decision log, or broad full-diff dumps.",
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
    COVERAGE_AUDIT_STATUS_CONTRACT_PROMPT,
    REVIEWER_COVERAGE_ROW_CONTRACT_PROMPT,
    REVIEWER_DRILLDOWN_ROW_CONTRACT_PROMPT,
    "Reviewer plan:",
    renderReviewerPlanMarkdown(plan),
    "Reviewer reports:",
    reports.map(renderReviewerReportMarkdown).join("\n\n"),
    "Original review context:",
    buildIntegrityEvidencePrompt(input),
    "Perform a coverage audit before final verdict: every critical request promise from the plan should be `covered`, `missing`, or explicitly `inconclusive`. Include `coverageAudit`; include `uninspectedRisks` for high-risk surfaces that no reviewer actually checked.",
    "Call submit_integrity_consensus exactly once.",
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
    "Reviewers must verify that reference-driven UI work follows this frontend replica contract, source manifest, web-clone-source handoff, source audit expectations, and visual reference requirements.",
    "Use `inspect_integrity_evidence({ section: \"frontend_design_contract\" })` for the bounded full contract excerpt when this matters to your scope.",
  ].join("\n")
}

function renderRequirementsSummary(requirements: ParsedRequirement[]): string {
  const visible = requirements.slice(0, INTEGRITY_EVIDENCE_LIMITS.requirements)
  const lines = ["# Requirements", `Rendered ${visible.length}/${requirements.length} requirements.`]
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
  const visibleRows = rows.slice(0, INTEGRITY_EVIDENCE_LIMITS.requirementStatusRows)
  const lines = [
    "# Requirement Status Snapshot",
    `Rendered ${visibleRows.length}/${rows.length} requirement status rows.`,
  ]
  for (const row of visibleRows) {
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
  appendOmittedLine(lines, rows.length, visibleRows.length, "requirement status rows")
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
    const visible = input.requirements.slice(0, INTEGRITY_EVIDENCE_LIMITS.requirements)
    for (const req of visible) {
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
    appendOmittedLine(lines, input.requirements.length, visible.length, "bounded maturity requirements")
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
  const finding: IntegrityFinding = {
    id: "no-goals-produced",
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
      scope: "Goal graph existence",
      verdict: "needs_correction",
      summary: "No goal contracts exist.",
      drilldowns: [],
      coverage: [],
      evidence: ["goals.length=0"],
      findings: [finding],
      openQuestions: [],
    },
    {
      reviewerID: "completion-reviewer",
      scope: "User request completion",
      verdict: "needs_correction",
      summary: "Completion cannot be reviewed without goals.",
      drilldowns: [],
      coverage: [],
      evidence: ["No goal accepts ownership of the user request."],
      findings: [finding],
      openQuestions: [],
    },
  ]
  return normalizeTeamReport({
    verdict: "needs_correction",
    summary: "Integrity needs correction: no goals produced.",
    teamReportMarkdown:
      "### Integrity team review (verdict=needs_correction)\n\nBlocking: no goal contracts exist. Run architect again before review.",
    reviewers,
    coverageAudit: [
      {
        promise: "Active task has goal contracts before integrity review.",
        reviewerIDs: reviewers.map((r) => r.reviewerID),
        status: "missing",
        notes: "No goal contracts were available for request coverage audit.",
      },
    ],
    uninspectedRisks: [
      {
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
    // specs/fact-check-agent-2026-05-25.md §6.1.3).
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

function assertUniqueReviewerIDs(plan: IntegrityReviewerPlan): void {
  const ids = plan.reviewers.map((reviewer) => reviewer.reviewerID)
  if (new Set(ids).size !== ids.length)
    throw new Error(`integrity reviewer plan produced duplicate reviewerID values: ${ids.join(", ")}`)
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

function renderReviewerReportMarkdown(report: IntegrityReviewerReport): string {
  const lines = [
    `## Reviewer ${report.reviewerID}: ${report.verdict}`,
    `Scope: ${report.scope}`,
    `Summary: ${report.summary}`,
  ]
  if (report.investigationPlan) {
    lines.push(
      [
        "Investigation plan:",
        `- request promise: ${report.investigationPlan.requestPromise}`,
        `- hypothesis: ${report.investigationPlan.hypothesis}`,
        `- evidence plan: ${report.investigationPlan.evidencePlan.join(" | ")}`,
        `- pass criteria: ${report.investigationPlan.passCriteria.join(" | ")}`,
      ].join("\n"),
    )
  }
  if ((report.drilldowns ?? []).length > 0) {
    lines.push(
      "Drilldowns:",
      markdownList(
        report.drilldowns.map(
          (drilldown) => `${drilldown.kind}:${drilldown.target} - ${drilldown.purpose} => ${drilldown.result}`,
        ),
      ),
    )
  }
  if ((report.coverage ?? []).length > 0) {
    lines.push(
      "Coverage:",
      markdownList(
        report.coverage.map((row) => {
          const target = row.requirementID ?? row.specID ?? row.userRequestQuote ?? "(unanchored)"
          return `${target}: ${row.status} - ${row.evidence}`
        }),
      ),
    )
  }
  if ((report.evidence ?? []).length) lines.push("Evidence:", markdownList(report.evidence))
  if ((report.findings ?? []).length) {
    lines.push("Findings:")
    for (const finding of report.findings) {
      const quotes =
        finding.userRequestQuotes && finding.userRequestQuotes.length > 0
          ? `\n  user request quotes: ${finding.userRequestQuotes.join(" | ")}`
          : ""
      lines.push(
        `- [${finding.severity}] ${finding.id}: ${finding.title} - ${finding.description}\n  repair: ${finding.repair}${quotes}\n  evidence: ${finding.evidence.join(" | ")}`,
      )
    }
  }
  if ((report.openQuestions ?? []).length) lines.push("Open questions:", markdownList(report.openQuestions))
  return lines.join("\n")
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
