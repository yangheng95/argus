import { tool } from "ai"
import TEAM_CORE from "@/prompt/core/integrity-team-core.txt"
import { runAgentSession } from "@/agent/runner"
import { limitSummary, markdownList } from "@/agent/report"
import type { AcceptanceSpec } from "@/acceptance/types"
import { renderSpecsAsText } from "@/acceptance/types"
import { renderContractGraphForPrompt, type ArchitectContractGraph } from "@/architect/contract-graph"
import { renderVisualContractPromptSection } from "@/design-analyst/prompt-section"
import type { VisualSpec } from "@/design-analyst/types"
import type { DecisionLog } from "@/decision-log"
import { Event as EngineEvent } from "@/engine/model"
import { EngineProtocol } from "@/engine/protocol"
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
import type { DeliveryInfo, GoalInfo } from "@/delivery/checks"
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

export interface IntegrityAcceptanceContext extends DeliveryInfo {}

export type ReviewPromptInput = {
  userRequest: string
  taskTitle: string
  goals: GoalContractFields[]
  requirements?: ParsedRequirement[]
  requirementDecisions?: RequirementsDecision[]
  designSpecs?: VisualSpec[]
  contractGraph: ArchitectContractGraph
  decisionLog?: DecisionLog
  requirementStatus?: RequirementStatusRow[]
  attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>
  acceptance?: IntegrityAcceptanceContext
  replayContext: IntegrityReplayContext
  signal?: AbortSignal
  taskID?: string
}

type PlanCollector = { plan?: IntegrityReviewerPlan }
type ReviewerCollector = { report?: IntegrityReviewerReport }
type ConsensusCollector = { report?: IntegrityTeamReport }

export async function reviewIntegrity(input: {
  userRequest: string
  taskTitle: string
  goals: GoalContractFields[]
  requirements?: ParsedRequirement[]
  requirementDecisions?: RequirementsDecision[]
  designSpecs?: VisualSpec[]
  contractGraph?: ArchitectContractGraph
  decisionLog?: DecisionLog
  requirementStatus?: RequirementStatusRow[]
  attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>
  acceptance?: IntegrityAcceptanceContext
  replayContext?: IntegrityReplayContext
  signal?: AbortSignal
  taskID?: string
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
  if (!input.contractGraph) {
    throw new Error(`reviewIntegrity requires architect_contract_graph when reviewing ${input.goals.length} goal(s).`)
  }

  const promptInput: ReviewPromptInput = { ...input, contractGraph: input.contractGraph, replayContext }
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
      runReviewerSession({
        input: promptInput,
        scope,
        parentSessionID: planOut.session.id,
        activeReviewID: () => activeReviewID,
      }),
    ),
  )

  const consensusCollector: ConsensusCollector = {}
  const consensusOut = await runAgentSession<ConsensusCollector>({
    kind: "integrity",
    core: TEAM_CORE,
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
  attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>
  signal?: AbortSignal
}) {
  const evidenceTools = input.taskID
    ? createIntegrityAcceptanceTools({
        taskID: input.taskID,
        goals: input.goals.map(goalToDeliveryGoalInfo),
        delivery: input.acceptance,
        attachments: input.attachments,
        signal: input.signal,
      })
    : {}
  return {
    tools: {
      ...evidenceTools,
      submit_reviewer_report: tool({
        description: "Submit this independent reviewer's evidence-backed report. Do not emit code changes.",
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
          "Submit the final integrity team consensus. Fold runtime/acceptance evidence into findings; do not emit dimensions or acceptance objects.",
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
  activeReviewID: () => string | undefined
}): Promise<IntegrityReviewerReport> {
  const collector: ReviewerCollector = {}
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
      reviewID: input.activeReviewID,
      phase: "integrity",
      attempt: () => input.input.replayContext.attemptNumber,
      source: `architect.integrity.reviewer.${input.scope.reviewerID}`,
    }),
  })
  if (!out.collector.report) throw new Error(`integrity reviewer ${input.scope.reviewerID} did not submit a report.`)
  return out.collector.report
}

export function buildSupervisorPlanPrompt(input: ReviewPromptInput): string {
  return [
    "# Integrity Supervisor Planning",
    renderIntegrityReplayContextPrompt(input.replayContext),
    renderSeverityNewEvidenceSection(input),
    [
      "Choose 2-6 independent reviewers for the actual task risk surface. Use the scale signals: larger goal/REQ/changed-file surfaces should push the plan toward more reviewers; narrow surfaces can use fewer. Do not default to five reviewers. Do not use fixed dimensions or a stock checklist.",
      "When no prior integrity attempt exists for this task/spec snapshot, build the reviewer team from the task's actual risk surface.",
      "When prior attempts exist, start from prior blocking findings, required repairs, and prior reviewer focuses. Verify whether prior blockers were actually repaired using build evidence since the latest review, then cover new or changed risk surfaces. Do not spend a fresh full team rediscovering the same unchanged blocker. If a prior blocker still appears unresolved, assign a reviewer to verify it as persistent with evidence rather than renaming it as a new finding.",
      "Prior reviewer focuses are the list of surfaces that were inspected, not a proof that those surfaces are healthy or that uninspected surfaces are absent. Re-walk the actual task surface from the user request, REQ rows, goals, acceptance specs, contract graph, and changed files. If a category looks uninspected in prior rounds, do not assume it is irrelevant -- it may have been missed. Match reviewers to surface by semantic responsibility, not by similarity to prior reviewer ids or names.",
      "Use 2-3 reviewers when the replay context shows a narrow re-review with a small changed-file set and a small number of prior blockers. Use 4-6 reviewers when the task spans many goals/requirements/acceptance specs, when changed files cross several runtime surfaces, or when the replay context has no prior attempts. Avoid substantial overlap with prior reviewer focuses unless the rationale ties it to persistent blockers or changed repair evidence.",
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
    renderSeverityNewEvidenceSection(input),
    [
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
    "Reviewer plan:",
    renderReviewerPlanMarkdown(plan),
    "Reviewer reports:",
    reports.map(renderReviewerReportMarkdown).join("\n\n"),
    "Original review context:",
    buildIntegrityEvidencePrompt(input),
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
        markdownContext: "block",
      }).text,
      taskID: input.taskID,
    }),
  )
  if (input.requirements?.length) {
    sections.push(
      [
        "# Requirements",
        ...input.requirements.map((r) => {
          const lines = [`- ${r.id} (${r.type}): ${r.description}`]
          if (r.acceptance.trim().length > 0) lines.push(`  Acceptance: ${r.acceptance}`)
          if (r.non_goals.trim().length > 0) lines.push(`  Non-goals: ${r.non_goals}`)
          return lines.join("\n")
        }),
      ].join("\n"),
    )
  }
  if (input.requirementStatus?.length) {
    const lines = ["# Requirement Status Snapshot"]
    for (const row of input.requirementStatus) {
      lines.push(`## ${row.reqID}: ${row.reqDescription}`)
      for (const cg of row.claimingGoals) {
        const specStr = cg.specOutcomes
          .map(
            (s) =>
              `${s.specID}/${s.severity}=${s.passed === true ? "passed" : s.passed === false ? "failed" : "no-evidence"}${s.summary ? ` (${s.summary})` : ""}`,
          )
          .join(", ")
        lines.push(
          `- ${cg.goalID} "${cg.goalTitle}" runStatus=${cg.runStatus}: ${specStr || "no related specs evaluated"}`,
        )
      }
      if (row.claimingGoals.length === 0) lines.push("- no claiming goal")
    }
    sections.push(lines.join("\n"))
  }
  sections.push(renderScopeBoundedMaturityEvidenceSection(input))
  if (input.acceptance) {
    const changed = input.acceptance.changedFiles.slice(0, 80)
    const diffLines = (input.acceptance.diffs ?? []).slice(0, 12).map((diff) => `- ${diff.file}`)
    sections.push(
      [
        "# Delivery Evidence Context",
        `Summary: ${input.acceptance.summary || "(no summary)"}`,
        "Changed files:",
        ...changed.map((file) => `- ${file}`),
        "Representative diffs:",
        ...diffLines,
      ].join("\n"),
    )
  }
  if (input.requirementDecisions?.length) {
    sections.push(
      ["# Foundational Decisions", ...input.requirementDecisions.map((d) => `- ${d.key}=${d.value}: ${d.reason}`)].join(
        "\n",
      ),
    )
  }
  if (input.designSpecs?.length) {
    sections.push(
      renderVisualContractPromptSection({
        specs: input.designSpecs,
        instructions: ["Use design specs as evidence, not as trusted truth."],
      }),
    )
  }
  sections.push(`# Goal Contracts (${input.goals.length})`)
  for (const goal of input.goals) {
    sections.push(
      [
        `## ${goal.id}: ${goal.title}`,
        `Objective: ${goal.objective}`,
        `Acceptance Specs:\n${renderSpecsAsText(goal.acceptance_specs ?? [])}`,
        `Responsibility Paths: ${goal.owned_paths.join(", ") || "(none)"}`,
        `Priority: ${goal.priority}`,
        `Kind: ${goal.kind}`,
        goal.depends_on?.length ? `Depends on: ${goal.depends_on.join(", ")}` : "",
        goal.requirement_ids?.length ? `Requirement IDs: ${goal.requirement_ids.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
  }
  sections.push(renderContractGraphForPrompt(input.contractGraph))
  const dlSection = input.decisionLog?.toPromptSection()
  if (dlSection) sections.push(dlSection)
  return sections.join("\n\n")
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
  changedEvidenceLines.push(
    `- Changed files: ${evidence.changedFiles.length > 0 ? evidence.changedFiles.join(", ") : "(none)"}`,
  )
  if (evidence.deliverySummaries.length > 0) {
    changedEvidenceLines.push("- Delivery summaries:")
    for (const summary of evidence.deliverySummaries) changedEvidenceLines.push(`  - ${summary}`)
  }
  const rendered = renderSharedIntegrityPromptContext({
    surface: "severity_context",
    lineage: input.replayContext.lineage,
    latestAttempt,
    changedFiles: evidence.changedFiles,
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
      if (finding.filePaths.length > 0) lines.push(`  files: ${finding.filePaths.join(", ")}`)
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
    "Severity reads maturity meaning only from the scope discipline path: bounded REQ rows or a durable `maturity_scope_pending` decision. This section is a read-through; severity does not classify the task into a local maturity tier.",
    "",
    "Visible bounded REQs from requirements/scope:",
  ]
  if (input.requirements?.length) {
    for (const req of input.requirements) {
      lines.push(`- ${req.id}: ${sanitizePromptLine(req.description, "generic")}`)
      const acceptance = requirementAcceptanceLines(req.acceptance)
      if (acceptance.length > 0)
        lines.push(`  acceptance: ${acceptance.map((item) => sanitizePromptLine(item, "generic")).join("; ")}`)
      if (req.non_goals.trim().length > 0) {
        lines.push(`  non_goals: ${sanitizePromptLine(req.non_goals, "generic")}`)
      }
    }
  } else {
    lines.push("- (none rendered)")
  }

  lines.push("", "Maturity terms from original request not landed as bounded REQs:")
  const pending = input.requirementDecisions?.filter((decision) => decision.key === "maturity_scope_pending") ?? []
  if (pending.length > 0) {
    for (const decision of pending) {
      lines.push(
        `- maturity_scope_pending: ${sanitizePromptLine(decision.value, "generic")}; reason: ${sanitizePromptLine(decision.reason, "generic")}. Valid integrity action: at most one requirements-extraction concern; do not derive severity thresholds from this word.`,
      )
    }
  } else {
    lines.push(
      "- No `maturity_scope_pending` decision is present in rendered requirements/scope decisions. Do not infer one here; use only bounded REQs above and explicit request phrases already rendered.",
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
    ...finding.priorAttemptRefs,
    ...(prior?.attemptNumber ? [`R${prior.attemptNumber}:${prior.id}`] : []),
  ])
  return {
    ...finding,
    id: prior?.id ?? finding.id,
    fingerprint,
    canonicalSymptom,
    affectedSymbols: stableList(finding.affectedSymbols),
    verify: defaultIntegrityVerify(finding),
    sourceFindingIDs: stableList([...finding.sourceFindingIDs, finding.id, ...(prior ? [prior.id] : [])]),
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
      repair.sourceFindingIDs.includes(finding.id) ||
      repair.sourceFindingIDs.some((id) => finding.sourceFindingIDs.includes(id)) ||
      finding.sourceFindingIDs.includes(repair.id) ||
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
    evidence: repair.evidence.length > 0 ? repair.evidence : linkedFinding?.evidence ?? [],
    targetIDs: stableList([...repair.targetIDs, ...(linkedFinding?.targetIDs ?? [])]),
    requirementIDs: stableList([...repair.requirementIDs, ...(linkedFinding?.requirementIDs ?? [])]),
    specIDs: stableList([...repair.specIDs, ...(linkedFinding?.specIDs ?? [])]),
    filePaths: stableList([...repair.filePaths, ...(linkedFinding?.filePaths ?? [])]),
    affectedSymbols: stableList([...repair.affectedSymbols, ...(linkedFinding?.affectedSymbols ?? [])]),
    repair: repair.repair ?? linkedFinding?.repair ?? repair.description,
    verify: defaultIntegrityVerify({
      ...repair,
      repair: repair.repair ?? linkedFinding?.repair ?? repair.description,
      evidence: repair.evidence.length > 0 ? repair.evidence : linkedFinding?.evidence,
      filePaths: repair.filePaths.length > 0 ? repair.filePaths : linkedFinding?.filePaths,
      verify: repair.verify.length > 0 ? repair.verify : linkedFinding?.verify,
    }),
    sourceFindingIDs: stableList([...repair.sourceFindingIDs, ...(linkedFinding ? [linkedFinding.id] : [])]),
    priorAttemptRefs: stableList([
      ...repair.priorAttemptRefs,
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
      evidence: ["goals.length=0"],
      findings: [finding],
      openQuestions: [],
    },
    {
      reviewerID: "completion-reviewer",
      scope: "User request completion",
      verdict: "needs_correction",
      summary: "Completion cannot be reviewed without goals.",
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
    findings: result.findings,
    rounds: result.rounds,
    requiredRepairs: result.requiredRepairs,
    unresolvedDisagreements: result.unresolvedDisagreements,
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
  return [
    `## Reviewer Plan`,
    `Rationale: ${plan.rationale}`,
    ...plan.reviewers.map(
      (r) => `### ${r.reviewerID}: ${r.title}\nFocus: ${r.focus}\nQuestions:\n${markdownList(r.adversarialQuestions)}`,
    ),
  ].join("\n\n")
}

function renderReviewerReportMarkdown(report: IntegrityReviewerReport): string {
  const lines = [
    `## Reviewer ${report.reviewerID}: ${report.verdict}`,
    `Scope: ${report.scope}`,
    `Summary: ${report.summary}`,
  ]
  if (report.evidence.length) lines.push("Evidence:", markdownList(report.evidence))
  if (report.findings.length) {
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
  if (report.openQuestions.length) lines.push("Open questions:", markdownList(report.openQuestions))
  return lines.join("\n")
}

function goalToDeliveryGoalInfo(goal: GoalContractFields): GoalInfo {
  return {
    id: goal.id,
    title: goal.title,
    description: goal.objective,
    criteria: renderSpecsAsText(goal.acceptance_specs ?? []),
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
