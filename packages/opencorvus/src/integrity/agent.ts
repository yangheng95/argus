/**
 * Integrity Review — multi-dimension review of architect output.
 *
 * Successor to the fidelity reviewer. Where fidelity asked one question
 * ("does the goal set cover the user request?"), integrity asks four,
 * registered in `dimensions.ts`:
 *
 *   1. goal_fidelity         — coverage of the user's literal request
 *   2. technical_feasibility — viability of the proposed contracts
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
 *   • Diagnostic-only dimensions (see registry: hallucination) get a slimmer
 *     schema with no corrections / missing_goals fields — the schema itself
 *     prevents diagnostic dimensions from mutating goals.
 *   • The LLM closes with SessionLoop's `StructuredOutput({ summary })`.
 *     The runtime accepts the run only when every dimension has been
 *     submitted and the structured terminal output is present. Aggregate
 *     verdict is the worst per-dimension verdict (computed here, not by the
 *     LLM).
 */
import { tool } from "ai"
import z from "zod"
import INTEGRITY_CORE from "@/prompt/core/integrity-core.txt"
import { Log } from "@/util/log"
import { runAgentSession } from "@/agent/runner"
import { EngineProtocol } from "@/engine/protocol"
import { Event as EngineEvent } from "@/engine/model"
import type { GoalContractFields } from "@/pipeline/types"
import { AcceptanceSpecSchema, renderSpecsAsText } from "@/acceptance/types"
import type { AcceptanceSpec } from "@/acceptance/types"
import { Instance } from "@/project/instance"
import type { VisualSpec } from "@/design-analyst/types"
import { renderVisualContractPromptSection } from "@/design-analyst/prompt-section"
import type { DecisionLog } from "@/decision-log"
import type { ParsedRequirement, RequirementsDecision } from "@/requirements/types"
import { buildMirrorToolsPromptSection } from "@/prompt/mirror-tools"
import { AttachmentStore } from "@/storage/attachment-store"
import {
  INTEGRITY_DIMENSIONS,
  renderDimensionCatalogue,
  type IntegrityDimension,
  type IntegrityIssueType,
} from "./dimensions"

const log = Log.create({ service: "integrity-review" })

// ---------------------------------------------------------------------------
// Types — public API
// ---------------------------------------------------------------------------

export type IntegrityVerdict = "pass" | "concerns" | "needs_correction"

export interface IntegrityIssue {
  type: IntegrityIssueType
  description: string
  /** Related goal IDs, REQ ids, or spec ids depending on dimension. */
  goalIDs?: string[]
  evidence?: string
}

export interface GoalCorrection {
  action: "modify" | "split" | "remove"
  goalID: string
  reason: string
  updates?: Partial<Pick<GoalContractFields, "title" | "objective" | "acceptance_specs" | "owned_paths">>
}

export interface MissingGoal {
  title: string
  objective: string
  acceptance_specs: AcceptanceSpec[]
  owned_paths: string[]
  kind: string
  priority: "blocking" | "advisory"
  reason: string
}

export interface IntegrityDimensionResult {
  id: IntegrityDimension["id"]
  verdict: IntegrityVerdict
  issues: IntegrityIssue[]
  corrections: GoalCorrection[]
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
  /** Cross-dimension union of goal-mutating corrections (only from dimensions
   *  whose `canProposeCorrections=true`). Diagnostic-only dimensions never
   *  contribute here. */
  corrections: GoalCorrection[]
  /** Cross-dimension union of proposed missing goals. */
  missingGoals: MissingGoal[]
}

// ---------------------------------------------------------------------------
// Tool input schemas (snake_case at the wire to match AcceptanceSpec naming;
// camelCase IntegrityResult on receive). Per-dimension tools each carry a
// dimension-scoped issue enum so issue-type smuggling is structurally
// impossible; diagnostic-only dimensions get a slimmer schema with no
// corrections / missing_goals fields.
// ---------------------------------------------------------------------------

const VerdictEnum = z.enum(["pass", "concerns", "needs_correction"])

const GoalCorrectionUpdates = z.object({
  title: z.string().optional(),
  objective: z.string().optional(),
  acceptance_specs: z.array(AcceptanceSpecSchema).optional(),
  owned_paths: z.array(z.string()).optional(),
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
  acceptance_specs: z.array(AcceptanceSpecSchema).min(1),
  owned_paths: z.array(z.string()).min(1),
  kind: z.enum(["bootstrap", "feature", "verification", "integration", "system"]),
  priority: z.enum(["blocking", "advisory"]),
  reason: z.string().min(1),
})

function buildIssueInput(d: IntegrityDimension) {
  // Per-dimension issue enum — schema-level guard against cross-dimension
  // issue-type smuggling.
  const types = d.issueTypes as readonly string[]
  return z.object({
    type: z.enum(types as [string, ...string[]]),
    description: z.string().min(1),
    goal_ids: z.array(z.string()).optional(),
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
      missing_goals: z.array(MissingGoalInput),
    })
  }
  return z.object({
    verdict: VerdictEnum,
    issues: z.array(issue),
  })
}

export const IntegrityFinalSchema = z.object({
  summary: z.string().min(1),
})
export type IntegrityFinal = z.infer<typeof IntegrityFinalSchema>

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
 * `submit_<dimension_id>_verdict`, then closes with StructuredOutput.
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
  decisionLog?: DecisionLog
  /** Task attachments (user reference images) — forwarded to the reviewer as
   *  multimodal user-message parts so visual goal-fidelity judgements have the
   *  pixels in front of them, not just text design_specs. */
  attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>
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
      id: "goal_fidelity",
      verdict: "needs_correction",
      issues: [{ type: "uncovered", description: "No goals produced" }],
      corrections: [],
      missingGoals: [],
    }
    const result = synthesizeResult([dim], "No goals produced — architect must rerun.")
    const softSessionID = await emitSoftIntegrity(input, result)
    if (softSessionID) input.onSessionCreated?.(softSessionID)
    return { ...result, sessionID: softSessionID ?? "" }
  }

  const goalIDs = new Set(goals.map((g) => g.id))
  const collector: {
    dimensions: Map<IntegrityDimension["id"], IntegrityDimensionResult>
    droppedCorrections: string[]
  } = {
    dimensions: new Map(),
    droppedCorrections: [],
  }

  function buildDimensionTool(d: IntegrityDimension) {
    const correctionsClause = d.canProposeCorrections
      ? ` Mutating corrections + missing_goals are allowed under this dimension; reference only goal_ids that appear in the goal list.`
      : ` Diagnostic-only dimension — schema has no corrections / missing_goals fields.`
    return tool({
      description:
        `Submit the ${d.title} (${d.id}) dimension verdict. Call EXACTLY ONCE for ` +
        `this dimension. Allowed issue types: ${d.issueTypes.join(", ")}.${correctionsClause}`,
      inputSchema: buildDimensionInput(d),
      execute: async (raw) => {
        const sub = raw as z.infer<ReturnType<typeof buildDimensionInput>> & {
          corrections?: z.infer<typeof GoalCorrectionInput>[]
          missing_goals?: z.infer<typeof MissingGoalInput>[]
        }

        const issues: IntegrityIssue[] = sub.issues.map((it) => ({
          type: it.type as IntegrityIssueType,
          description: it.description,
          goalIDs: it.goal_ids,
          evidence: it.evidence,
        }))

        let corrections: GoalCorrection[] = []
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
          missingGoals = (sub.missing_goals ?? []).map((m) => ({
            title: m.title,
            objective: m.objective,
            acceptance_specs: m.acceptance_specs,
            owned_paths: m.owned_paths,
            kind: m.kind,
            priority: m.priority,
            reason: m.reason,
          }))
        }

        // Verdict reconciliation: if the LLM said `pass` but listed issues /
        // corrections, escalate. If it said `needs_correction` with nothing
        // concrete, demote to `pass`.
        let verdict = sub.verdict as IntegrityVerdict
        if (verdict === "pass" && (issues.length > 0 || corrections.length > 0 || missingGoals.length > 0)) {
          verdict = corrections.length > 0 || missingGoals.length > 0 ? "needs_correction" : "concerns"
        }
        if (verdict === "needs_correction" && issues.length === 0 && corrections.length === 0 && missingGoals.length === 0) {
          verdict = "pass"
        }

        collector.dimensions.set(d.id, { id: d.id, verdict, issues, corrections, missingGoals })
        return `OK: ${d.id}=${verdict} recorded (${issues.length} issue(s), ${corrections.length} correction(s), ${missingGoals.length} missing_goal(s)).`
      },
    })
  }

  const dimensionTools = Object.fromEntries(
    INTEGRITY_DIMENSIONS.map((d) => [`submit_${d.id}_verdict`, buildDimensionTool(d)] as const),
  )

  const startedAt = Date.now()
  const out = await runAgentSession({
    kind: "integrity",
    core: INTEGRITY_CORE,
    sessionTitle: `Integrity Review: ${input.taskTitle}`,
    parentSessionID: input.parentSessionID,
    taskID: input.taskID,
    signal: input.signal,
    toolKit: {
      tools: dimensionTools,
      getCollector: () => collector,
    },
    buildUserPrompt: () => buildIntegrityPrompt(input),
    buildUserParts: (input.attachments && input.attachments.length > 0)
      ? async () => {
          const text = buildIntegrityPrompt(input)
          const { referenceOnly } = AttachmentStore.partition(input.attachments!)
          const inline = await AttachmentStore.inlineFileParts(input.attachments!)
          const enrichedText = text + AttachmentStore.renderReferenceList(referenceOnly)
          return [{ type: "text" as const, text: enrichedText }, ...inline]
        }
      : undefined,
    onSessionCreated: (session) => {
      input.onSessionCreated?.(session.id)
      emitIntegrityLifecycle("started", input.taskID, session.id, 0, 0)
      const ticker = input.taskID
        ? setInterval(() => {
            emitIntegrityLifecycle(
              "progress",
              input.taskID,
              session.id,
              0,
              Date.now() - startedAt,
            )
          }, 20_000)
        : null
      return { dispose: () => { if (ticker) clearInterval(ticker) } }
    },
    format: {
      schema: z.toJSONSchema(IntegrityFinalSchema) as Record<string, unknown>,
      retryCount: 2,
    },
  })

  const structured = out.structured as IntegrityFinal | undefined
  const missingDimensions = INTEGRITY_DIMENSIONS
    .filter((d) => !collector.dimensions.has(d.id))
    .map((d) => d.id)

  if (!structured || missingDimensions.length > 0) {
    throw new Error(
      `integrity reviewer did not complete structured contract ` +
        `(sessionID=${out.session.id}, structuredMissing=${!structured}, ` +
        `submittedDimensions=${[...collector.dimensions.keys()].join(",") || "none"}, ` +
        `missingDimensions=${missingDimensions.join(",") || "none"}, streamErrors=${out.streamErrors.length})`,
    )
  }

  const normalised = INTEGRITY_DIMENSIONS.map((d) => collector.dimensions.get(d.id)!)
  const result = synthesizeResult(normalised, structured.summary)

  log.info("integrity review completed", {
    verdict: result.verdict,
    perDimension: result.dimensions.map((d) => `${d.id}=${d.verdict}`).join(","),
    issues: result.issues.length,
    corrections: result.corrections.length,
    missingGoals: result.missingGoals.length,
    droppedCorrections: collector.droppedCorrections.length,
    streamErrors: out.streamErrors.length,
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
): IntegrityResult {
  return {
    verdict: aggregateVerdict(dimensions),
    summary,
    dimensions: [...dimensions],
    issues: dimensions.flatMap((d) => d.issues),
    corrections: dimensions.flatMap((d) => d.corrections),
    missingGoals: dimensions.flatMap((d) => d.missingGoals),
  }
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
      missingGoalCount: d.missingGoals.length,
    })),
    issues: result.issues.map((i) => ({ type: i.type, description: i.description })),
    corrections: result.corrections.map((c) => ({
      action: c.action,
      goalID: c.goalID,
      reason: c.reason,
      updatesTitle: c.updates?.title,
      updatesObjective: c.updates?.objective,
    })),
    missingGoals: result.missingGoals.map((g) => ({
      title: g.title,
      objective: g.objective,
      reason: g.reason,
    })),
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
  const def = phase === "started" ? EngineEvent.IntegrityReviewStarted : EngineEvent.IntegrityReviewProgress
  const properties =
    phase === "started"
      ? { taskID, sessionID }
      : { taskID, sessionID, attempt, elapsedMs }
  log.info("integrity lifecycle emit", { phase, taskID, sessionID, attempt, elapsedMs })
  EngineProtocol.emit(def as any, properties as any, { source: "architect.integrity" }).catch(
    (err) => {
      log.error("integrity lifecycle emit failed", {
        phase,
        taskID,
        sessionID,
        error: err instanceof Error ? err.message : String(err),
      })
    },
  )
}

// ---------------------------------------------------------------------------
// Apply integrity corrections to goal list
// ---------------------------------------------------------------------------

/**
 * Apply integrity-result corrections to the goal list. Returns a new array.
 * Only acts when aggregate verdict is `needs_correction` AND the contributing
 * dimensions actually proposed goal-mutating corrections (diagnostic-only
 * dimensions do not, by construction).
 */
export function applyIntegrityCorrections(
  goals: GoalContractFields[],
  result: IntegrityResult,
): GoalContractFields[] {
  if (result.verdict !== "needs_correction") return goals
  if (result.corrections.length === 0 && result.missingGoals.length === 0) return goals

  let corrected = [...goals]

  for (const correction of result.corrections) {
    if (correction.action === "modify" && correction.updates) {
      corrected = corrected.map((g) =>
        g.id === correction.goalID
          ? { ...g, ...correction.updates }
          : g,
      )
    } else if (correction.action === "remove") {
      corrected = corrected.filter((g) => g.id !== correction.goalID)
    }
    // "split" actions are not applied directly; the missing-goal proposals
    // below carry the resulting sub-goals.
  }

  for (const missing of result.missingGoals) {
    const normalizedTitle = missing.title.toLowerCase().trim()
    if (corrected.some((g) => g.title.toLowerCase().trim() === normalizedTitle)) continue
    corrected.push({
      id: `goal_integrity_${corrected.length + 1}`,
      title: missing.title,
      objective: missing.objective,
      acceptance_specs: missing.acceptance_specs,
      owned_paths: missing.owned_paths,
      depends_on: [],
      exports: [],
      imports: [],
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
  designSpecs?: VisualSpec[]
  decisionLog?: DecisionLog
}): string {
  const sections: string[] = []

  sections.push(renderDimensionCatalogue())

  sections.push(`# User Request (ORIGINAL — this is the ground truth)\n\nTitle: ${input.taskTitle}\n\n${input.userRequest}`)

  if (input.requirements && input.requirements.length > 0) {
    const reqText = input.requirements
      .map((r) => `- **${r.id}** (${r.type}): ${r.description}`)
      .join("\n")
    sections.push(`# Requirements (${input.requirements.length}) — architect decomposed against this list\n\n${reqText}`)
  }

  if (input.requirementDecisions && input.requirementDecisions.length > 0) {
    const decText = input.requirementDecisions
      .map((d) => `- **${d.key}** = ${d.value} — ${d.reason}`)
      .join("\n")
    sections.push(`# Foundational Decisions\n\n${decText}`)
  }

  if (input.designSpecs && input.designSpecs.length > 0) {
    sections.push(renderVisualContractPromptSection({
      specs: input.designSpecs,
      instructions: [
        "The following advisory visual constraints came from design_analysis.",
        "Use them under `goal_fidelity` (uncovered visual specs) and `hallucination` " +
          "(specs the design-analyst could not have read off the reference image, " +
          "e.g. exact hex codes when the image was not actually attached).",
      ],
    }))
  }

  sections.push(`# Goal Contracts (${input.goals.length} goals)\n`)
  for (const goal of input.goals) {
    sections.push([
      `## ${goal.id}: ${goal.title}`,
      `Objective: ${goal.objective}`,
      `Acceptance Specs:\n${renderSpecsAsText(goal.acceptance_specs ?? [])}`,
      `Owned Paths: ${goal.owned_paths.join(", ") || "(none)"}`,
      `Priority: ${goal.priority}`,
      `Kind: ${goal.kind}`,
      goal.exports?.length ? `Exports: ${goal.exports.join("; ")}` : "",
      goal.imports?.length ? `Imports: ${goal.imports.join("; ")}` : "",
      goal.depends_on?.length ? `Depends on: ${goal.depends_on.join(", ")}` : "",
      goal.requirement_ids?.length ? `Requirement IDs: ${goal.requirement_ids.join(", ")}` : "",
    ].filter(Boolean).join("\n"))
  }

  const dlSection = input.decisionLog?.toPromptSection()
  if (dlSection) sections.push(dlSection)

  try {
    const mirrorSection = buildMirrorToolsPromptSection({ cwd: Instance.directory })
    if (mirrorSection.trim().length > 0) sections.push(mirrorSection)
  } catch {
    // Instance not initialised — advisory section, skip.
  }

  sections.push(
    "Now walk EVERY dimension above. Cite REQ-N / spec ids / goal ids / verbatim user " +
    "phrases as evidence in each issue. For EACH dimension call its own " +
    "`submit_<dimension_id>_verdict` tool exactly once, then close with a single " +
    "`StructuredOutput({ summary })` call. The runtime aggregates the " +
    "per-dimension verdicts — do NOT supply a top-level verdict.",
  )

  return sections.join("\n\n")
}
