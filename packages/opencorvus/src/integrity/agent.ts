/**
 * Integrity Review — multi-dimension review of architect output.
 *
 * Successor to the fidelity reviewer. Where fidelity asked one question
 * ("does the goal set cover the user request?"), integrity asks four,
 * registered in `dimensions.ts`:
 *
 *   1. requirement_fidelity  — original request mining + REQ-N completion
 *                              (REQ rows are evidence, not the audit universe;
 *                              with post-build snapshot, also judges real
 *                              end-to-end completion)
 *   2. technical_feasibility — viability of the proposed contracts +
 *                              user-deliverable tier completeness (FE → BE,
 *                              CLI → runtime, etc.)
 *   3. hallucination         — fabrication-free upstream reasoning
 *   4. solution_quality      — soundness of the decomposition itself
 *
 * Adding a 5th dimension is a one-liner in `dimensions.ts`; this file is
 * fully data-driven from the registry.
 *
 * The reviewer is a multi-call tool-use loop:
 *   • The LLM sees the original request + REQ-N + decisions + design specs
 *     + goal contracts + decision log.
 *   • For each dimension in the registry, the LLM calls `submit_<id>_verdict`
 *     exactly once with a Zod-validated structured verdict for THAT dimension.
 *     Per-tool schemas keep each call's JSON small (kimi-class models choke
 *     on the 4k+ aggregate payload — 11-iteration retry storms in the wild).
 *     Issue-type enums are scoped per dimension so the LLM cannot smuggle
 *     issues from one dimension into another (structural, not runtime,
 *     enforcement).
 *   • The LLM closes with `submit_integrity_review({ final: true })`. The runtime accepts
 *     the run only when every dimension has been submitted and the terminal
 *     review tool has validated the collector. Aggregate
 *     verdict is the worst per-dimension verdict (computed here, not by the
 *     LLM).
 */
import { tool } from "ai"
import z from "zod"
import INTEGRITY_CORE from "@/prompt/core/integrity-core.txt"
import ACCEPTANCE_REVIEW_CORE from "@/prompt/core/acceptance-review-core.txt"
import { Log } from "@/util/log"
import { runAgentSession } from "@/agent/runner"
import { EngineProtocol } from "@/engine/protocol"
import { Event as EngineEvent } from "@/engine/model"
import {
  createReviewReasoningForwarder,
  emitReviewStreamProgress,
  emitReviewStreamStarted,
  reviewIDForIntegrity,
} from "@/review/stream"
import type { GoalContractFields } from "@/pipeline/types"
import { renderSpecsAsText } from "@/acceptance/types"
import type { AcceptanceSpec } from "@/acceptance/types"
import {
  ArchitectContractRefSchema,
  GoalDependencyContractSchema,
  renderContractGraphForPrompt,
  type ArchitectContractGraph,
  type ArchitectContractRef,
  type GoalDependencyContract,
  type GoalDependencyReason,
} from "@/architect/contract-graph"
import { Instance } from "@/project/instance"
import type { VisualSpec } from "@/design-analyst/types"
import { renderVisualContractPromptSection } from "@/design-analyst/prompt-section"
import type { DecisionLog } from "@/decision-log"
import type { ParsedRequirement, RequirementsDecision } from "@/requirements/types"
import type { RequirementStatusRow } from "./requirement-status"
import { AttachmentStore } from "@/storage/attachment-store"
import { limitSummary, markdownList } from "@/agent/report"
import { createIntegrityAcceptanceTools } from "./acceptance-tools"
import { createIntegrityAcceptanceOutputTools, type IntegrityAcceptanceCollector } from "./acceptance-output-tools"
import type { AcceptanceEvidenceFacetType, AcceptanceReviewVerdictType } from "@/acceptance/review-verdict"
import type { DeliveryInfo, GoalInfo } from "@/delivery/checks"
import {
  INTEGRITY_DIMENSIONS,
  renderDimensionCatalogue,
  type IntegrityDimension,
  type IntegrityIssueType,
} from "./dimensions"
import { IntegritySubmitSchema } from "./submit-schema"

const log = Log.create({ service: "integrity-review" })

// ---------------------------------------------------------------------------
// Types — public API
// ---------------------------------------------------------------------------

export type IntegrityVerdict = "pass" | "concerns" | "needs_correction"

export interface IntegrityIssue {
  type: IntegrityIssueType
  description: string
  /** Goal IDs the issue is scoped to (any dimension). */
  goalIDs?: string[]
  /** Visible REQ-N ids the issue is scoped to (required for requirement_fidelity
   *  issues by prompt rule; optional on the wire so non-fidelity issues aren't
   *  forced to populate it). */
  requirementIDs?: string[]
  /** Acceptance spec ids (e.g. acc-foo-1) the issue is scoped to — used to point
   *  at failing specs surfaced by the post-build Requirement Status Snapshot. */
  specIDs?: string[]
  evidence?: string
}

export interface GoalCorrection {
  action: "modify" | "split" | "remove"
  goalID: string
  reason: string
  /** Corrections may rewrite goal topology fields that integrity itself audits.
   *  acceptance_specs are intentionally NOT mutable here — see the wire-schema
   *  comment near GoalCorrectionUpdates. */
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
  /** Plain-text spec sentences. applyIntegrityCorrections wraps each into an
   *  LlmJudge placeholder spec on the new goal so the evaluator still has
   *  something to score against. */
  acceptance_spec_hints: string[]
  owned_paths: string[]
  kind: string
  priority: "blocking" | "advisory"
  reason: string
}

export type IntegrityGraphCorrection =
  | {
      kind: "contract"
      action: "add" | "modify" | "remove"
      reason: string
      contractID?: string
      contract?: ArchitectContractRef
    }
  | {
      kind: "dependency"
      action: "add" | "modify" | "remove" | "reclassify"
      reason: string
      fromGoalID?: string
      toGoalID?: string
      dependency?: GoalDependencyContract
      newReason?: GoalDependencyReason
      contractIDs?: string[]
      summary?: string
    }
  | {
      kind: "audit_criterion"
      action: "attach"
      reason: string
      goalID: string
      contractIDs: string[]
    }

export interface IntegrityDimensionResult {
  id: IntegrityDimension["id"]
  verdict: IntegrityVerdict
  issues: IntegrityIssue[]
  corrections: GoalCorrection[]
  graphCorrections: IntegrityGraphCorrection[]
  missingGoals: MissingGoal[]
}

export interface IntegrityResult {
  /** Aggregate verdict: worst per-dimension verdict. Derived, not LLM-supplied. */
  verdict: IntegrityVerdict
  /** One-sentence operator-readable headline supplied by the LLM. */
  summary: string
  /** Per-dimension breakdown. Always one entry per dimension in the registry. */
  dimensions: IntegrityDimensionResult[]
  /** Cross-dimension union of issues — kept for callers that want a flat list
   *  (overlay verdict-card, prosecutor seed, dispatch eligibility check). */
  issues: IntegrityIssue[]
  /** Cross-dimension union of goal-layer corrections. */
  corrections: GoalCorrection[]
  /** Cross-dimension union of Architect Contract Graph corrections. */
  graphCorrections: IntegrityGraphCorrection[]
  /** Cross-dimension union of proposed missing goals. */
  missingGoals: MissingGoal[]
  /** Final deliverable acceptance verdict produced from inside this integrity session. */
  acceptance: AcceptanceReviewVerdictType
}

export interface IntegrityAcceptanceContext extends DeliveryInfo {}

// ---------------------------------------------------------------------------
// Tool input schemas (snake_case at the wire to match AcceptanceSpec naming;
// camelCase IntegrityResult on receive). Per-dimension tools each carry a
// dimension-scoped issue enum so issue-type smuggling is structurally
// impossible. Dimensions that can propose goal-layer corrections get the
// correction / missing-goal fields; advisory dimensions get the slimmer schema.
// ---------------------------------------------------------------------------

const VerdictEnum = z.enum(["pass", "concerns", "needs_correction"])

// Goal-correction wire schema. NOTE: AcceptanceSpec is intentionally excluded
// here. The full AcceptanceSpec schema (with its discriminated-union Scorer
// tree, Gherkin scenario, rubric levels, etc.) is so deep that JSON-Schema
// inlines it for every dimension tool, pushing toolSchemaChars past 990k.
// Corrections may rewrite the same lightweight topology fields integrity audits:
// goal identity text, ownership, and dependencies.
// AcceptanceSpec is intentionally excluded. The full AcceptanceSpec schema
// (with its discriminated-union Scorer tree, Gherkin scenario, rubric levels,
// etc.) is so deep that JSON-Schema inlines it for every dimension tool,
// pushing toolSchemaChars past 990k. Missing goals arrive with PLAIN-TEXT spec
// hints (`acceptance_spec_hints`) which applyIntegrityCorrections wraps into
// LlmJudge placeholders so the downstream evaluator can still score them.
const GoalCorrectionUpdates = z.object({
  title: z.string().optional(),
  objective: z.string().optional(),
  owned_paths: z.array(z.string()).optional(),
  depends_on: z.array(z.string()).optional(),
  kind: z.enum(["bootstrap", "feature", "verification", "integration", "system"]).optional(),
  priority: z.enum(["blocking", "advisory"]).optional(),
  requirement_ids: z.array(z.string()).optional(),
})

const GoalCorrectionInput = z.object({
  action: z.enum(["modify", "split", "remove"]),
  goal_id: z.string().min(1),
  reason: z.string().min(1),
  updates: GoalCorrectionUpdates.optional(),
})

const MissingGoalInput = z.object({
  title: z.string().min(1),
  objective: z.string().min(1),
  acceptance_spec_hints: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      "One short sentence per acceptance spec. Each becomes an llm_judge " +
        "placeholder downstream; architect retry can translate them into " +
        "typed heuristic / rubric specs.",
    ),
  owned_paths: z.array(z.string()).min(1),
  kind: z.enum(["bootstrap", "feature", "verification", "integration", "system"]),
  priority: z.enum(["blocking", "advisory"]),
  reason: z.string().min(1),
})

const GraphContractCorrectionInput = z
  .object({
    kind: z.literal("contract"),
    action: z.enum(["add", "modify", "remove"]),
    reason: z.string().min(1),
    contract_id: z.string().min(1).optional(),
    contract: ArchitectContractRefSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === "remove" && !value.contract_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["contract_id"], message: "remove requires contract_id" })
    }
    if ((value.action === "add" || value.action === "modify") && !value.contract) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["contract"], message: `${value.action} requires contract` })
    }
  })

const GraphDependencyCorrectionInput = z
  .object({
    kind: z.literal("dependency"),
    action: z.enum(["add", "modify", "remove", "reclassify"]),
    reason: z.string().min(1),
    from_goal_id: z.string().min(1).optional(),
    to_goal_id: z.string().min(1).optional(),
    dependency: GoalDependencyContractSchema.optional(),
    new_reason: z.enum(["contract", "bootstrap_scaffold", "integration_order"]).optional(),
    contract_ids: z.array(z.string().min(1)).optional(),
    summary: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.action === "add" || value.action === "modify") && !value.dependency) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dependency"], message: `${value.action} requires dependency` })
    }
    if ((value.action === "remove" || value.action === "reclassify") && (!value.from_goal_id || !value.to_goal_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["from_goal_id"],
        message: `${value.action} requires from_goal_id and to_goal_id`,
      })
    }
    if (value.action === "reclassify" && !value.new_reason) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["new_reason"], message: "reclassify requires new_reason" })
    }
  })

const GraphAuditCriterionCorrectionInput = z.object({
  kind: z.literal("audit_criterion"),
  action: z.literal("attach"),
  reason: z.string().min(1),
  goal_id: z.string().min(1),
  contract_ids: z.array(z.string().min(1)).min(1),
})

const GraphCorrectionInput = z.discriminatedUnion("kind", [
  GraphContractCorrectionInput,
  GraphDependencyCorrectionInput,
  GraphAuditCriterionCorrectionInput,
])

function buildIssueInput(d: IntegrityDimension) {
  // Per-dimension issue enum — schema-level guard against cross-dimension
  // issue-type smuggling.
  const types = d.issueTypes as readonly string[]
  return z.object({
    type: z.enum(types as [string, ...string[]]),
    description: z.string().min(1),
    goal_ids: z.array(z.string()).optional(),
    /** Visible REQ-N ids (e.g. "REQ-3") this issue is scoped to. requirement_fidelity
     *  issues MUST populate this — enforcement is via prompt rule, not schema, so
     *  we don't fork the per-dimension shape. */
    requirement_ids: z.array(z.string()).optional(),
    /** Acceptance spec ids (e.g. "acc-foo-1") this issue is scoped to. Used post-
     *  build to point at failing specs from the Requirement Status Snapshot. */
    spec_ids: z.array(z.string()).optional(),
    evidence: z.string().optional(),
  })
}

function buildDimensionInput(d: IntegrityDimension) {
  const issue = buildIssueInput(d)
  if (d.canProposeCorrections) {
    return z.object({
      verdict: VerdictEnum,
      issues: z.array(issue),
      corrections: z.array(GoalCorrectionInput),
      graph_corrections: z.array(GraphCorrectionInput).optional(),
      missing_goals: z.array(MissingGoalInput),
    })
  }
  return z.object({
    verdict: VerdictEnum,
    issues: z.array(issue),
  })
}

// ---------------------------------------------------------------------------
// Verdict aggregation — pure function, single source for "what beats what"
// ---------------------------------------------------------------------------

const VERDICT_SEVERITY: Record<IntegrityVerdict, number> = {
  pass: 0,
  concerns: 1,
  needs_correction: 2,
}

function aggregateVerdict(dimensions: readonly IntegrityDimensionResult[]): IntegrityVerdict {
  let worst: IntegrityVerdict = "pass"
  for (const d of dimensions) {
    if (VERDICT_SEVERITY[d.verdict] > VERDICT_SEVERITY[worst]) worst = d.verdict
  }
  return worst
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Run integrity review across every registered dimension. No codebase
 * exploration. The reviewer compares the goal set + upstream evidence against
 * the user request and submits one structured verdict per dimension via
 * `submit_<dimension_id>_verdict`, then closes with submit_integrity_review.
 */
export async function reviewIntegrity(input: {
  userRequest: string
  taskTitle: string
  goals: GoalContractFields[]
  /** Upstream evidence the reviewer must see to judge each dimension. Without
   *  these the reviewer only sees the user's raw sentence + the finished goal
   *  list and cannot tell whether the upstream pipeline hallucinated, the
   *  decisions are infeasible, or the granularity is off. Architect must
   *  forward whatever upstream context it received. */
  requirements?: ParsedRequirement[]
  requirementDecisions?: RequirementsDecision[]
  designSpecs?: VisualSpec[]
  contractGraph?: ArchitectContractGraph
  decisionLog?: DecisionLog
  /** Post-build REQ status snapshot — pure projection of (REQ-N → claiming
   *  goals → tip goal_run + per-spec evidence). Empty array (or undefined)
   *  pre-build, when no claiming goal has run yet; the prompt renderer omits
   *  the section in that case. The host does NOT pre-compute completion
   *  verdicts — the LLM walks raw rows and concludes done/partial/not_done
   *  itself (rule 6.1: prompt-over-host invariant). */
  requirementStatus?: RequirementStatusRow[]
  /** Task attachments (user reference images) — forwarded to the reviewer as
   *  multimodal user-message parts so visual goal-fidelity judgements have the
   *  pixels in front of them, not just text design_specs. */
  attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>
  acceptance?: IntegrityAcceptanceContext
  signal?: AbortSignal
  /** Task ID for cache stickiness + the IntegrityReviewCompleted aggregate. */
  taskID?: string
  /** Architect session ID. Integrity is promoted to a first-class child session
   *  under this parent so the overlay renders an independent agent card per
   *  invocation. */
  parentSessionID?: string
  /** Fires once the runner session is created so callers can capture the id
   *  for recordIntegrityAttempt / user-facing pointer text. */
  onSessionCreated?: (sessionID: string) => void
}): Promise<IntegrityResult & { sessionID: string }> {
  const { goals } = input

  if (input.taskID && !input.parentSessionID) {
    throw new Error(
      `reviewIntegrity requires parentSessionID for task-backed runs (taskID=${input.taskID}). ` +
        `The orchestrator's integrity tool must attach a parent session before dispatch.`,
    )
  }

  // Empty-goal-set is a deterministic contract failure. It needs a sessionID
  // for the overlay to render a card, but it never pretends the review passed.
  if (goals.length === 0) {
    const dim: IntegrityDimensionResult = {
      id: "requirement_fidelity",
      verdict: "needs_correction",
      issues: [{ type: "uncovered", description: "No goals produced" }],
      corrections: [],
      graphCorrections: [],
      missingGoals: [],
    }
    const result = synthesizeResult([dim], "No goals produced — architect must rerun.", syntheticAcceptanceRejection("No goals produced"))
    const softSessionID = await emitSoftIntegrity(input, result)
    if (softSessionID) input.onSessionCreated?.(softSessionID)
    return { ...result, sessionID: softSessionID ?? "" }
  }
  if (!input.contractGraph) {
    throw new Error(
      `reviewIntegrity requires architect_contract_graph when reviewing ${goals.length} goal(s). ` +
        `Run Architect again so graph contracts and dependency reasons are available.`,
    )
  }
  const promptInput = { ...input, contractGraph: input.contractGraph }

  const goalIDs = new Set(goals.map((g) => g.id))
  type IntegrityCollector = {
    dimensions: Map<IntegrityDimension["id"], IntegrityDimensionResult>
    droppedCorrections: string[]
    finalized: boolean
  } & IntegrityAcceptanceCollector
  function buildIntegrityCollector(): IntegrityCollector {
    return {
      dimensions: new Map(),
      droppedCorrections: [],
      finalized: false,
    }
  }

  function buildIntegrityReport(collector: IntegrityCollector) {
    const dimensions = INTEGRITY_DIMENSIONS.map((d) => collector.dimensions.get(d.id)).filter(
      (item): item is IntegrityDimensionResult => Boolean(item),
    )
    const verdict = dimensions.length > 0 ? aggregateVerdict(dimensions) : "needs_correction"
    const lines = dimensions.map((dimension) => {
      const issues =
        dimension.issues.length > 0 ? `; issues: ${dimension.issues.map((issue) => issue.description).join(" | ")}` : ""
      return `${dimension.id}: ${dimension.verdict}${issues}`
    })
    const summary = `Integrity review ${verdict} across ${dimensions.length} dimension(s).`
    return {
      summary: limitSummary(summary),
      detail: [
        `## Summary\n${summary}`,
        `## Dimensions\n${lines.length ? markdownList(lines) : "- no dimension verdicts submitted"}`,
        createIntegrityAcceptanceOutputTools({ collector }).buildReport().detail,
      ].join("\n\n"),
    }
  }

  function buildDimensionTool(collector: IntegrityCollector, d: IntegrityDimension) {
    const correctionsClause = d.canProposeCorrections
      ? ` Mutating corrections + missing_goals are allowed under this dimension; reference only goal_ids that appear in the goal list.`
      : ` Advisory-only dimension — schema has no corrections / missing_goals fields.`
    return tool({
      description:
        `Submit the ${d.title} (${d.id}) dimension verdict. Call EXACTLY ONCE for ` +
        `this dimension. Allowed issue types: ${d.issueTypes.join(", ")}.${correctionsClause}`,
      inputSchema: buildDimensionInput(d),
      execute: async (raw) => {
        const sub = raw as z.infer<ReturnType<typeof buildDimensionInput>> & {
          corrections?: z.infer<typeof GoalCorrectionInput>[]
          graph_corrections?: z.infer<typeof GraphCorrectionInput>[]
          missing_goals?: z.infer<typeof MissingGoalInput>[]
        }

        const issues: IntegrityIssue[] = sub.issues.map((it) => ({
          type: it.type as IntegrityIssueType,
          description: it.description,
          goalIDs: it.goal_ids,
          requirementIDs: it.requirement_ids,
          specIDs: it.spec_ids,
          evidence: it.evidence,
        }))

        let corrections: GoalCorrection[] = []
        let graphCorrections: IntegrityGraphCorrection[] = []
        let missingGoals: MissingGoal[] = []
        if (d.canProposeCorrections) {
          for (const c of sub.corrections ?? []) {
            if (!goalIDs.has(c.goal_id)) {
              collector.droppedCorrections.push(c.goal_id)
              continue
            }
            corrections.push({
              action: c.action,
              goalID: c.goal_id,
              reason: c.reason,
              updates: c.updates,
            })
          }
          graphCorrections = (sub.graph_corrections ?? []).map((c) => {
            if (c.kind === "contract") {
              return {
                kind: "contract",
                action: c.action,
                reason: c.reason,
                contractID: c.contract_id,
                contract: c.contract,
              } satisfies IntegrityGraphCorrection
            }
            if (c.kind === "dependency") {
              return {
                kind: "dependency",
                action: c.action,
                reason: c.reason,
                fromGoalID: c.from_goal_id,
                toGoalID: c.to_goal_id,
                dependency: c.dependency,
                newReason: c.new_reason,
                contractIDs: c.contract_ids,
                summary: c.summary,
              } satisfies IntegrityGraphCorrection
            }
            return {
              kind: "audit_criterion",
              action: "attach",
              reason: c.reason,
              goalID: c.goal_id,
              contractIDs: c.contract_ids,
            } satisfies IntegrityGraphCorrection
          })
          missingGoals = (sub.missing_goals ?? []).map((m) => ({
            title: m.title,
            objective: m.objective,
            acceptance_spec_hints: m.acceptance_spec_hints,
            owned_paths: m.owned_paths,
            kind: m.kind,
            priority: m.priority,
            reason: m.reason,
          }))
        }

        // No verdict reconciliation. The integrity LLM's submitted verdict
        // is taken at face value. Any auto-rewriting of the verdict
        // (e.g. "promote pass-with-issues to concerns" or "demote
        // needs_correction-without-corrections to concerns") is a
        // state-machine layer that the orchestrator LLM doesn't need —
        // it sees the full per-dimension breakdown including issues,
        // corrections, and missing_goals via the rendered markdown and
        // decides next steps itself. CLAUDE.md rule 13.
        const verdict = sub.verdict as IntegrityVerdict

        collector.dimensions.set(d.id, { id: d.id, verdict, issues, corrections, graphCorrections, missingGoals })
        return `OK: ${d.id}=${verdict} recorded (${issues.length} issue(s), ${corrections.length} goal correction(s), ${graphCorrections.length} graph correction(s), ${missingGoals.length} missing_goal(s)).`
      },
    })
  }

  function buildSubmitIntegrityTool(collector: IntegrityCollector) {
    return tool({
      description:
        "Finalize integrity review after every submit_<dimension_id>_verdict tool has been called. " +
        "Call this with final=true.",
      inputSchema: IntegritySubmitSchema,
      execute: async () => {
        const missing = INTEGRITY_DIMENSIONS.filter((d) => !collector.dimensions.has(d.id)).map((d) => d.id)
        if (missing.length > 0) {
          return `Error: missing dimension verdicts: ${missing.join(", ")}. Submit each missing dimension before submit_integrity_review.`
        }
        if (!collector.acceptanceVerdict) {
          return "Error: missing acceptance verdict. Call submit_acceptance_verdict before submit_integrity_review."
        }
        collector.finalized = true
        const aggregate = aggregateIntegrityVerdict(
          INTEGRITY_DIMENSIONS.map((d) => collector.dimensions.get(d.id)!),
          collector.acceptanceVerdict,
        )
        return `PASS: integrity review finalized with aggregate verdict ${aggregate}.`
      },
    })
  }

  const startedAt = Date.now()
  let lastDroppedCorrections = 0
  const collector = buildIntegrityCollector()
  const acceptanceFacets = deriveIntegrityAcceptanceFacets({
    designSpecs: input.designSpecs,
    attachments: input.attachments,
    changedFiles: input.acceptance?.changedFiles ?? [],
    goals,
  })
  const acceptanceOutput = createIntegrityAcceptanceOutputTools({
    collector,
    requiredEvidenceFacets: acceptanceFacets,
  })
  const acceptanceTools = input.taskID
    ? createIntegrityAcceptanceTools({
        taskID: input.taskID,
        goals: goals.map(goalToDeliveryGoalInfo),
        delivery: input.acceptance,
        attachments: input.attachments,
        signal: input.signal,
      })
    : {}
  let activeReviewID: string | undefined
  const out = await runAgentSession<IntegrityCollector>({
    kind: "integrity",
    core: [INTEGRITY_CORE, ACCEPTANCE_REVIEW_CORE].join("\n\n"),
    sessionTitle: `Integrity Review: ${input.taskTitle}`,
    parentSessionID: input.parentSessionID,
    taskID: input.taskID,
    signal: input.signal,
    toolKit: {
      tools: {
        ...Object.fromEntries(
          INTEGRITY_DIMENSIONS.map((d) => [`submit_${d.id}_verdict`, buildDimensionTool(collector, d)] as const),
        ),
        ...acceptanceTools,
        ...acceptanceOutput.tools,
        submit_integrity_review: buildSubmitIntegrityTool(collector),
      },
      getCollector: () => collector,
      buildReport: () => buildIntegrityReport(collector),
    },
    buildUserPrompt: () => buildIntegrityPrompt(promptInput),
    buildUserParts:
      input.attachments && input.attachments.length > 0
        ? async () => {
            const text = buildIntegrityPrompt(promptInput)
            const inline = await AttachmentStore.inlineFileParts(input.attachments!)
            const enrichedText = text + AttachmentStore.renderAttachmentInventory(input.attachments)
            return [{ type: "text" as const, text: enrichedText }, ...inline]
          }
        : undefined,
    terminalTool: {
      toolName: "submit_integrity_review",
      isSatisfied: (collector) => collector.finalized,
      shouldExposeOnlyTerminalTool: (collector) =>
        INTEGRITY_DIMENSIONS.every((dimension) => collector.dimensions.has(dimension.id)) && !!collector.acceptanceVerdict,
    },
    stream: createReviewReasoningForwarder({
      taskID: input.taskID,
      reviewID: () => activeReviewID,
      phase: "integrity",
      attempt: () => 1,
      source: "architect.integrity",
    }),
    onSessionCreated: (session) => {
      input.onSessionCreated?.(session.id)
      activeReviewID = reviewIDForIntegrity(session.id)
      emitIntegrityLifecycle("started", input.taskID, session.id, 0, 0)
      const ticker = input.taskID
        ? setInterval(() => {
            emitIntegrityLifecycle("progress", input.taskID, session.id, 0, Date.now() - startedAt)
          }, 20_000)
        : null
      return {
        dispose: () => {
          if (ticker) clearInterval(ticker)
        },
      }
    },
  })

  const finalCollector = out.collector
  const missing = INTEGRITY_DIMENSIONS.filter((d) => !finalCollector.dimensions.has(d.id)).map((d) => d.id)
  if (missing.length > 0) {
    throw new Error(
      `integrity reviewer skipped dimension verdict tools — ` +
        `missingDimensions=${missing.join(",")}, ` +
        `submittedDimensions=${[...finalCollector.dimensions.keys()].join(",") || "none"}`,
    )
  }
  if (!finalCollector.finalized) {
    throw new Error(
      `integrity reviewer did not call submit_integrity_review after submitting ` +
        `${finalCollector.dimensions.size} dimension verdict(s).`,
    )
  }
  if (!finalCollector.acceptanceVerdict) {
    throw new Error("integrity reviewer did not call submit_acceptance_verdict before submit_integrity_review.")
  }
  lastDroppedCorrections = finalCollector.droppedCorrections.length
  const normalised = INTEGRITY_DIMENSIONS.map((d) => finalCollector.dimensions.get(d.id)!)
  const result = synthesizeResult(normalised, summarizeIntegrity(normalised, finalCollector.acceptanceVerdict), finalCollector.acceptanceVerdict)

  log.info("integrity review completed", {
    verdict: result.verdict,
    perDimension: result.dimensions.map((d) => `${d.id}=${d.verdict}`).join(","),
    issues: result.issues.length,
    corrections: result.corrections.length,
    missingGoals: result.missingGoals.length,
    droppedCorrections: lastDroppedCorrections,
    streamErrors: out.streamErrors.length,
    attempts: 1,
  })

  emitIntegrityEvent(input.taskID, out.session.id, result, 1)
  return { ...result, sessionID: out.session.id }
}

// ---------------------------------------------------------------------------
// Result synthesis — fold per-dimension results into the public IntegrityResult
// ---------------------------------------------------------------------------

function synthesizeResult(
  dimensions: readonly IntegrityDimensionResult[],
  summary: string,
  acceptance: AcceptanceReviewVerdictType,
): IntegrityResult {
  return {
    verdict: aggregateIntegrityVerdict(dimensions, acceptance),
    summary,
    dimensions: [...dimensions],
    issues: dimensions.flatMap((d) => d.issues),
    corrections: dimensions.flatMap((d) => d.corrections),
    graphCorrections: dimensions.flatMap((d) => d.graphCorrections),
    missingGoals: dimensions.flatMap((d) => d.missingGoals),
    acceptance,
  }
}

function syntheticAcceptanceRejection(summary: string): AcceptanceReviewVerdictType {
  return {
    verdict: "rejected",
    summary,
    deferred_checks: [],
    tool_call_evidence: [
      {
        tool: "integrity_contract",
        passed: false,
        detail: summary.length >= 8 ? summary : "integrity contract failed",
      },
    ],
    rejection_details: [
      {
        category: "quality",
        error: summary.length >= 8 ? summary : "integrity contract failed",
      },
    ],
  }
}

function deriveIntegrityAcceptanceFacets(input: {
  designSpecs?: VisualSpec[]
  attachments?: Array<{ mime: string }>
  changedFiles: string[]
  goals: GoalContractFields[]
}): AcceptanceEvidenceFacetType[] {
  const facets = new Set<AcceptanceEvidenceFacetType>()
  const files = input.changedFiles.map((file) => file.replaceAll("\\", "/"))
  const hasRuntimeScenario = input.goals.some((goal) => (goal.acceptance_specs ?? []).some((spec) => spec.scenario))
  const hasImageReference = (input.attachments ?? []).some((a) => (a.mime ?? "").startsWith("image/"))
  const hasDesignSpecs = (input.designSpecs ?? []).length > 0
  const touchesFrontend = files.some(
    (file) =>
      /(^|\/)(src\/)?(app|pages|components)\//.test(file) ||
      /\.(tsx|jsx|vue|svelte|astro|css|scss)$/.test(file) ||
      /(^|\/)(index\.html|vite\.config\.|next\.config\.)/.test(file),
  )
  const touchesRuntime = files.some(
    (file) =>
      /(^|\/)(api|routes|server|controllers|handlers|bin|cli)\//.test(file) ||
      /(^|\/)app\/api\//.test(file) ||
      /(server|routes|api|cli|main|index)\.[cm]?[jt]sx?$/.test(file) ||
      /^package\.json$/.test(file),
  )
  if (hasRuntimeScenario || touchesRuntime || touchesFrontend) facets.add("runtime")
  if (touchesRuntime || touchesFrontend || hasRuntimeScenario) facets.add("startup")
  if (touchesFrontend || hasDesignSpecs || hasImageReference) facets.add("frontend")
  if (hasDesignSpecs || hasImageReference || touchesFrontend) facets.add("visual")
  return [...facets].sort()
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

function aggregateIntegrityVerdict(
  dimensions: readonly IntegrityDimensionResult[],
  acceptance: AcceptanceReviewVerdictType,
): IntegrityVerdict {
  if (acceptance.verdict === "rejected") return "needs_correction"
  return aggregateVerdict(dimensions)
}

function summarizeIntegrity(
  dimensions: readonly IntegrityDimensionResult[],
  acceptance: AcceptanceReviewVerdictType,
): string {
  const verdict = aggregateIntegrityVerdict(dimensions, acceptance)
  const issueCount = dimensions.reduce((sum, d) => sum + d.issues.length, 0)
  const correctionCount = dimensions.reduce(
    (sum, d) => sum + d.corrections.length + d.graphCorrections.length + d.missingGoals.length,
    0,
  )
  const acceptancePart =
    acceptance.verdict === "accepted"
      ? `acceptance accepted`
      : `acceptance rejected with ${acceptance.rejection_details.length} rejection detail(s)`
  return `Integrity ${verdict}: ${issueCount} issue(s), ${correctionCount} correction action(s), ${acceptancePart}.`
}

// ---------------------------------------------------------------------------
// Soft-fail emission + lifecycle events
// ---------------------------------------------------------------------------

async function emitSoftIntegrity(
  input: { taskID?: string; parentSessionID?: string; taskTitle: string },
  result: IntegrityResult,
): Promise<string | undefined> {
  if (!input.taskID) return undefined
  if (!input.parentSessionID) return undefined
  const { Session } = await import("@/session")
  const session = await Session.createNext({
    kind: "integrity",
    parentID: input.parentSessionID,
    title: `Integrity Review: ${input.taskTitle}`,
    directory: Instance.directory,
  })
  emitIntegrityEvent(input.taskID, session.id, result, 0)
  return session.id
}

function emitIntegrityEvent(
  taskID: string | undefined,
  sessionID: string | undefined,
  result: IntegrityResult,
  attempts: number,
): void {
  if (!taskID) return
  if (!sessionID) {
    throw new Error(
      `integrity.review.completed: sessionID required but missing (taskID=${taskID}). ` +
        `reviewIntegrity must create a child session before invoking SessionPrompt.prompt.`,
    )
  }
  const payload = {
    taskID,
    sessionID,
    verdict: result.verdict,
    summary: result.summary,
    dimensions: result.dimensions.map((d) => ({
      id: d.id,
      verdict: d.verdict,
      issueCount: d.issues.length,
      correctionCount: d.corrections.length,
      graphCorrectionCount: d.graphCorrections.length,
      missingGoalCount: d.missingGoals.length,
    })),
    issues: result.issues.map((i) => ({
      type: i.type,
      description: i.description,
      requirement_ids: i.requirementIDs,
      spec_ids: i.specIDs,
    })),
    corrections: result.corrections.map((c) => ({
      action: c.action,
      goalID: c.goalID,
      reason: c.reason,
      updatesTitle: c.updates?.title,
      updatesObjective: c.updates?.objective,
    })),
    graphCorrections: result.graphCorrections.map((c) => ({
      kind: c.kind,
      action: c.action,
      reason: c.reason,
    })),
    missingGoals: result.missingGoals.map((g) => ({
      title: g.title,
      objective: g.objective,
      reason: g.reason,
    })),
    acceptance: {
      verdict: result.acceptance.verdict,
      summary: result.acceptance.summary,
      startup_verification: result.acceptance.startup_verification,
      frontend_check: result.acceptance.frontend_check,
      deferred_checks: result.acceptance.deferred_checks,
      tool_call_evidence: result.acceptance.tool_call_evidence,
      rejection_details:
        result.acceptance.verdict === "rejected" ? result.acceptance.rejection_details : [],
      launch_command:
        result.acceptance.verdict === "accepted" ? result.acceptance.launch_command : undefined,
    },
    attempts,
  }
  void EngineProtocol.emit(EngineEvent.IntegrityReviewCompleted, payload, { source: "architect.integrity" })
}

function emitIntegrityLifecycle(
  phase: "started" | "progress",
  taskID: string | undefined,
  sessionID: string | undefined,
  attempt: number,
  elapsedMs: number,
): void {
  if (!taskID || !sessionID) {
    log.warn("integrity lifecycle event skipped — missing taskID/sessionID", {
      phase,
      hasTaskID: !!taskID,
      hasSessionID: !!sessionID,
    })
    return
  }
  log.info("integrity lifecycle emit", { phase, taskID, sessionID, attempt, elapsedMs })
  const reviewID = reviewIDForIntegrity(sessionID)
  if (phase === "started") {
    emitReviewStreamStarted({ taskID, reviewID, phase: "integrity", sessionID, source: "architect.integrity" })
    return
  }
  emitReviewStreamProgress({
    taskID,
    reviewID,
    phase: "integrity",
    currentStep: "agent",
    attempt,
    elapsedMs,
    source: "architect.integrity",
  })
}

// ---------------------------------------------------------------------------
// Apply integrity corrections to goal list
// ---------------------------------------------------------------------------

/**
 * Apply integrity-result corrections to the goal list. Returns a new array.
 * Only acts when aggregate verdict is `needs_correction` AND the contributing
 * dimensions actually proposed goal-layer corrections.
 */
export function applyIntegrityCorrections(goals: GoalContractFields[], result: IntegrityResult): GoalContractFields[] {
  if (result.verdict !== "needs_correction") return goals
  if (result.corrections.length === 0 && result.missingGoals.length === 0) return goals

  let corrected = [...goals]

  for (const correction of result.corrections) {
    if (correction.action === "modify" && correction.updates) {
      corrected = corrected.map((g) => (g.id === correction.goalID ? { ...g, ...correction.updates } : g))
    } else if (correction.action === "remove") {
      corrected = corrected.filter((g) => g.id !== correction.goalID)
    }
    // "split" actions are not applied directly; the missing-goal proposals
    // below carry the resulting sub-goals.
  }

  for (const missing of result.missingGoals) {
    const normalizedTitle = missing.title.toLowerCase().trim()
    if (corrected.some((g) => g.title.toLowerCase().trim() === normalizedTitle)) continue
    const newGoalID = `goal_integrity_${corrected.length + 1}`
    // Wrap each plain-text hint in a minimal LlmJudge placeholder so the
    // evaluator still has something deterministic to score. Architect retry
    // can later refine these into heuristic / prebuilt scorers; the
    // placeholder is stable enough that the goal can be dispatched without
    // a re-run.
    const acceptance_specs: AcceptanceSpec[] = missing.acceptance_spec_hints.map((hint, i) => ({
      id: `acc-${newGoalID}-${i + 1}`,
      source_requirement_id: "integrity-pending",
      goal_id: newGoalID,
      title: hint.length > 80 ? hint.slice(0, 77) + "..." : hint,
      scorers: [
        {
          type: "llm_judge",
          name: `judge-${i + 1}`,
          criteria: hint,
        },
      ],
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

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

function buildIntegrityPrompt(input: {
  userRequest: string
  taskTitle: string
  goals: GoalContractFields[]
  requirements?: ParsedRequirement[]
  requirementDecisions?: RequirementsDecision[]
  requirementStatus?: RequirementStatusRow[]
  designSpecs?: VisualSpec[]
  contractGraph: ArchitectContractGraph
  decisionLog?: DecisionLog
  acceptance?: IntegrityAcceptanceContext
}): string {
  const sections: string[] = []

  sections.push(renderDimensionCatalogue())

  sections.push(
    `# User Request (ORIGINAL — this is the ground truth)\n\nTitle: ${input.taskTitle}\n\n${input.userRequest}`,
  )

  if (input.requirements && input.requirements.length > 0) {
    const reqText = input.requirements.map((r) => `- **${r.id}** (${r.type}): ${r.description}`).join("\n")
    sections.push(
      `# Requirements (${input.requirements.length}) — generated REQ rows are coverage evidence\n\n` +
        `Start from the original user request above, then use these REQ-N rows to judge whether ` +
        `requirements extraction captured every user-visible capability at the right acceptance ` +
        `granularity. For each captured REQ-N, match it against the goals' \`requirement_ids\` and ` +
        `the acceptance_specs whose \`source_requirement_id\` equals the REQ id.\n\n${reqText}`,
    )
  }

  // Requirement → claiming-goal reverse-lookup table. Rendered when both REQs
  // and goals are present so the LLM sees REQ-N → which goal claims it (via
  // requirement_ids) → which acceptance_specs cover it (via
  // source_requirement_id) without re-deriving from the goal contracts list.
  if (input.requirements && input.requirements.length > 0 && input.goals.length > 0) {
    const lines: string[] = []
    lines.push(`# Requirement → Goal Coverage Map`)
    lines.push("")
    for (const req of input.requirements) {
      const claimingGoals = input.goals.filter((g) => (g.requirement_ids ?? []).includes(req.id))
      if (claimingGoals.length === 0) {
        lines.push(`- **${req.id}** — _no goal claims this REQ via requirement_ids_`)
        continue
      }
      const goalSummaries = claimingGoals.map((g) => {
        const relatedSpecs = (g.acceptance_specs ?? []).filter((s) => s.source_requirement_id === req.id)
        const specRefs = relatedSpecs.map((s) => `${s.id}/${s.severity}`).join(", ")
        return `${g.id} (${specRefs || "no related specs"})`
      })
      lines.push(`- **${req.id}** — ${goalSummaries.join("; ")}`)
    }
    sections.push(lines.join("\n"))
  }

  if (input.requirementStatus && input.requirementStatus.length > 0) {
    const lines: string[] = []
    lines.push(`# Requirement Status Snapshot (post-build raw evidence)`)
    lines.push("")
    lines.push(
      "Each row is a pure projection from the database — REQ-N → claiming goal(s) → tip goal_run " +
        "status + per-spec scorer outcomes. The host does NOT pre-compute completion verdicts. " +
        "You walk these rows under `requirement_fidelity` and decide done / partial / not_done from " +
        "the raw evidence (rule 6.1: prompt-over-host invariant).",
    )
    lines.push("")
    for (const row of input.requirementStatus) {
      lines.push(`## ${row.reqID} — ${row.reqDescription}`)
      if (row.claimingGoals.length === 0) {
        lines.push("- _no claiming goal_ (this should also surface as `uncovered` in fidelity)")
        continue
      }
      for (const cg of row.claimingGoals) {
        const specBits = cg.specOutcomes.map((s) => {
          const passed = s.passed === true ? "passed" : s.passed === false ? "FAILED" : "no-evidence"
          const summary = s.summary ? ` (${s.summary})` : ""
          return `${s.specID}/${s.severity}=${passed}${summary}`
        })
        const specStr = specBits.length > 0 ? specBits.join(", ") : "no related specs evaluated"
        lines.push(`- **${cg.goalID}** "${cg.goalTitle}" runStatus=${cg.runStatus}: ${specStr}`)
      }
    }
    sections.push(lines.join("\n"))
  }

  if (input.acceptance) {
    const changed = input.acceptance.changedFiles.slice(0, 80)
    const omitted = input.acceptance.changedFiles.length - changed.length
    const diffLines = (input.acceptance.diffs ?? []).slice(0, 12).map((diff) => {
      const stats = [diff.status, diff.additions != null ? `+${diff.additions}` : "", diff.deletions != null ? `-${diff.deletions}` : ""]
        .filter(Boolean)
        .join(" ")
      return `- ${diff.file}${stats ? ` (${stats})` : ""}`
    })
    sections.push(
      [
        "# Integrated Acceptance Context",
        "",
        `Summary: ${input.acceptance.summary || "(no summary)"}`,
        "",
        `Changed files (${input.acceptance.changedFiles.length}${omitted > 0 ? `; first ${changed.length}, ${omitted} omitted` : ""}):`,
        ...changed.map((file) => `- ${file}`),
        diffLines.length > 0 ? "\nRepresentative diffs:" : "",
        ...diffLines,
        "",
        "Use inspect_delivery_context for full goal reports, diffs, changed files, attachments, and upstream context when needed. The tool is exposed inside this integrity session; evidence from that tool is session-bound acceptance evidence.",
      ]
        .filter((line) => line !== "")
        .join("\n"),
    )
  }

  if (input.requirementDecisions && input.requirementDecisions.length > 0) {
    const decText = input.requirementDecisions.map((d) => `- **${d.key}** = ${d.value} — ${d.reason}`).join("\n")
    sections.push(`# Foundational Decisions\n\n${decText}`)
  }

  if (input.designSpecs && input.designSpecs.length > 0) {
    sections.push(
      renderVisualContractPromptSection({
        specs: input.designSpecs,
        instructions: [
          "The following advisory visual constraints came from design_analysis.",
          "Use them under `requirement_fidelity` (uncovered visual specs the user requested) and " +
            "`hallucination` (specs the design-analyst could not have read off the reference image, " +
            "e.g. exact hex codes when the image was not actually attached).",
        ],
      }),
    )
  }

  sections.push(`# Goal Contracts (${input.goals.length} goals — supporting context)\n`)
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

  sections.push(
    "Now review every dimension above. For `requirement_fidelity`, start from the original user " +
      "request and judge whether requirements extraction was complete; generated REQ rows are " +
      "evidence, not the audit universe. Then walk captured REQs (and the Requirement Status " +
      "Snapshot when present) row by row, NOT goal contracts. If an issue maps to an existing REQ, " +
      "set `requirement_ids`; if the issue is a missing extraction from the original request, leave " +
      "`requirement_ids` empty and cite the exact user phrase. Post-build issues that point at " +
      "failing acceptance specs MUST also set `spec_ids`. Cite REQ-N / spec ids / goal ids / " +
      "verbatim user phrases as evidence in each issue.",
  )

  return sections.join("\n\n")
}
