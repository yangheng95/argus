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
import type { RequirementStatusRow } from "./requirement-status"
import {
  IntegrityReviewCompletedPayloadSchema,
  IntegrityReviewerPlanSchema,
  IntegrityReviewerReportSchema,
  IntegrityTeamReportSchema,
  type IntegrityFinding,
  type IntegrityReviewCompletedPayload,
  type IntegrityReviewerPlan,
  type IntegrityReviewerReport,
  type IntegrityReviewerScope,
  type IntegrityTeamReport,
  type IntegrityVerdict,
} from "./team-schema"

const log = Log.create({ service: "integrity-review" })

export type { IntegrityFinding, IntegrityReviewerReport, IntegrityReviewerScope, IntegrityTeamReport, IntegrityVerdict }

export interface IntegrityIssue {
  type: string
  description: string
  goalIDs?: string[]
  requirementIDs?: string[]
  specIDs?: string[]
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

type ReviewPromptInput = {
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
  signal?: AbortSignal
  taskID?: string
  parentSessionID?: string
  onSessionCreated?: (sessionID: string) => void
}): Promise<IntegrityResult & { sessionID: string }> {
  if (input.taskID && !input.parentSessionID) {
    throw new Error(`reviewIntegrity requires parentSessionID for task-backed runs (taskID=${input.taskID}).`)
  }
  if (input.goals.length === 0) {
    const result = createNoGoalsResult()
    const softSessionID = await emitSoftIntegrity(input, result)
    if (softSessionID) input.onSessionCreated?.(softSessionID)
    return { ...result, sessionID: softSessionID ?? "" }
  }
  if (!input.contractGraph) {
    throw new Error(`reviewIntegrity requires architect_contract_graph when reviewing ${input.goals.length} goal(s).`)
  }

  const promptInput = { ...input, contractGraph: input.contractGraph }
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
      attempt: () => 1,
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
              attempt: 1,
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
      attempt: () => 1,
      source: "architect.integrity.supervisor",
    }),
  })

  const result = consensusOut.collector.report
  if (!result) throw new Error("integrity supervisor did not submit consensus report.")
  const normalized = normalizeTeamReport(result)
  log.info("integrity team review completed", {
    verdict: normalized.verdict,
    reviewers: normalized.reviewers.length,
    findings: normalized.findings.length,
    requiredRepairs: normalized.requiredRepairs.length,
  })
  emitIntegrityEvent(input.taskID, planOut.session.id, normalized, 1)
  return { ...normalized, sessionID: planOut.session.id }
}

function createPlanToolKit(collector: PlanCollector) {
  return {
    tools: {
      submit_integrity_review_plan: tool({
        description:
          "Submit a dynamic adversarial reviewer plan with 2-6 independent reviewers. Do not use a fixed checklist.",
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
      attempt: () => 1,
      source: `architect.integrity.reviewer.${input.scope.reviewerID}`,
    }),
  })
  if (!out.collector.report) throw new Error(`integrity reviewer ${input.scope.reviewerID} did not submit a report.`)
  return out.collector.report
}

function buildSupervisorPlanPrompt(input: ReviewPromptInput): string {
  return [
    "# Integrity Supervisor Planning",
    "Choose 2-6 independent reviewers for the actual task risk surface. Do not use fixed dimensions.",
    buildIntegrityEvidencePrompt(input),
    "Call submit_integrity_review_plan exactly once.",
  ].join("\n\n")
}

function buildReviewerPrompt(input: ReviewPromptInput, scope: IntegrityReviewerScope): string {
  return [
    "# Independent Integrity Reviewer",
    `Reviewer ID: ${scope.reviewerID}`,
    `Title: ${scope.title}`,
    `Focus: ${scope.focus}`,
    "Adversarial questions:",
    markdownList(scope.adversarialQuestions),
    "Explore independently, gather evidence, and call submit_reviewer_report once.",
    buildIntegrityEvidencePrompt(input),
  ].join("\n\n")
}

function buildSupervisorConsensusPrompt(
  input: ReviewPromptInput,
  plan: IntegrityReviewerPlan,
  reports: IntegrityReviewerReport[],
): string {
  return [
    "# Integrity Supervisor Consensus",
    "Compare reviewer reports adversarially. If a blocking finding or unresolved blocking disagreement remains, do not pass.",
    "Reviewer plan:",
    renderReviewerPlanMarkdown(plan),
    "Reviewer reports:",
    reports.map(renderReviewerReportMarkdown).join("\n\n"),
    "Original review context:",
    buildIntegrityEvidencePrompt(input),
    "Call submit_integrity_consensus exactly once.",
  ].join("\n\n")
}

function buildIntegrityEvidencePrompt(input: ReviewPromptInput): string {
  const sections: string[] = []
  sections.push(
    renderUserRequestSection({
      heading: "# User Request",
      title: input.taskTitle,
      request: input.userRequest,
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

function normalizeTeamReport(report: IntegrityTeamReport): IntegrityResult {
  return {
    ...report,
    summary: limitSummary(report.summary),
    issues: report.findings.map((finding) => ({
      type: finding.severity,
      description: `${finding.title}: ${finding.description}`,
      goalIDs: finding.targetIDs,
      requirementIDs: finding.requirementIDs,
      specIDs: finding.specIDs,
      evidence: finding.evidence.join(" | "),
    })),
    corrections: [],
    graphCorrections: [],
    missingGoals: [],
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
    repair: "Run architect again and produce goal contracts before integrity review.",
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
        description: "Create goal contracts for the active spec snapshot.",
        evidence: ["Goal contract list is empty."],
        targetIDs: [],
        filePaths: [],
      },
    ],
    unresolvedDisagreements: [],
  })
}

async function emitSoftIntegrity(
  input: { taskID?: string; parentSessionID?: string; taskTitle: string },
  result: IntegrityResult,
): Promise<string | undefined> {
  if (!input.taskID || !input.parentSessionID) return undefined
  const { Session } = await import("@/session")
  const session = await Session.createNext({
    kind: "integrity",
    parentID: input.parentSessionID,
    title: `Integrity Supervisor: ${input.taskTitle}`,
    directory: Instance.directory,
  })
  emitIntegrityEvent(input.taskID, session.id, result, 1)
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
    for (const finding of report.findings)
      lines.push(
        `- [${finding.severity}] ${finding.id}: ${finding.title} - ${finding.description}\n  repair: ${finding.repair}\n  evidence: ${finding.evidence.join(" | ")}`,
      )
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
