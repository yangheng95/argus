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
 * The reviewer is a single-call tool-use loop:
 *   • The LLM sees the original request + REQ-N + decisions + design specs
 *     + goal contracts + decision log.
 *   • It MUST invoke `submit_integrity_verdict` exactly once with a
 *     Zod-validated structured verdict. Each dimension carries its own
 *     verdict / issues / corrections / missing_goals; the aggregate verdict
 *     is the worst per-dimension verdict (computed here, not by the LLM).
 *   • Diagnostic-only dimensions (see registry: hallucination) MUST NOT
 *     emit corrections — the orchestrator re-runs upstream when it sees
 *     hallucination findings.
 */
import { tool } from "ai"
import z from "zod"
import INTEGRITY_CORE from "@/prompt/core/integrity-core.txt"
import { Log } from "@/util/log"
import { resolveAgentModel } from "@/agent/model"
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
import {
  ALL_INTEGRITY_ISSUE_TYPES,
  INTEGRITY_DIMENSIONS,
  dimensionForIssueType,
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
// Tool input schema (snake_case at the wire to match AcceptanceSpec naming;
// camelCase IntegrityResult on receive)
// ---------------------------------------------------------------------------

const DimensionIDEnum = z.enum(INTEGRITY_DIMENSIONS.map((d) => d.id) as [string, ...string[]])
const IssueTypeEnum = z.enum(ALL_INTEGRITY_ISSUE_TYPES as [string, ...string[]])
const VerdictEnum = z.enum(["pass", "concerns", "needs_correction"])

const IntegrityIssueInput = z.object({
  type: IssueTypeEnum,
  description: z.string().min(1),
  goal_ids: z.array(z.string()).optional(),
  evidence: z.string().optional(),
})

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

const DimensionResultInput = z.object({
  id: DimensionIDEnum,
  verdict: VerdictEnum,
  issues: z.array(IntegrityIssueInput),
  corrections: z.array(GoalCorrectionInput),
  missing_goals: z.array(MissingGoalInput),
})

const SubmitIntegrityInput = z.object({
  dimensions: z.array(DimensionResultInput),
  summary: z.string().min(1),
})

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
 * Run integrity review across every registered dimension. Single tool-call pass —
 * no codebase exploration. The reviewer compares the goal set + upstream evidence
 * against the user request and submits a structured verdict via
 * `submit_integrity_verdict`.
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

  // Empty-goal-set and missing-model paths are soft exits that synthesize a
  // verdict without invoking the LLM. Both need a sessionID for the overlay
  // to render a card — create a transient session up front.
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
  const model = await resolveAgentModel("integrity", { taskID: input.taskID }).catch(() => undefined)
  if (!model) {
    log.warn("no LLM available for integrity review, skipping")
    const passDimensions: IntegrityDimensionResult[] = INTEGRITY_DIMENSIONS.map((d) => ({
      id: d.id,
      verdict: "pass" as const,
      issues: [],
      corrections: [],
      missingGoals: [],
    }))
    const result = synthesizeResult(passDimensions, "No model available — integrity review skipped.")
    const softSessionID = await emitSoftIntegrity(input, result)
    if (softSessionID) input.onSessionCreated?.(softSessionID)
    return { ...result, sessionID: softSessionID ?? "" }
  }

  const goalIDs = new Set(goals.map((g) => g.id))
  const collector: { result: IntegrityResult | undefined } = { result: undefined }

  const submitTool = tool({
    description:
      "Submit the integrity verdict for the architect output. Call EXACTLY ONCE after " +
      "evaluating every dimension. All fields are schema-validated; on validation error " +
      "you will receive a message describing the failure and must call again.",
    inputSchema: SubmitIntegrityInput,
    execute: async ({ dimensions, summary }) => {
      // Per-dimension normalisation. Validate that each issue.type belongs to
      // the dimension it was filed under (no smuggling), drop corrections
      // pointing at unknown goal ids, and clear corrections on diagnostic-only
      // dimensions (those need to surface concerns, not silently mutate goals).
      const normalised: IntegrityDimensionResult[] = []
      const droppedCorrections: string[] = []
      const wrongDimensionIssues: string[] = []
      const strippedDiagnostic: string[] = []

      // Ensure every registered dimension is represented exactly once. The LLM
      // is told to return one entry per dimension; if it omits one we synthesize
      // a defensive `concerns` row so the orchestrator notices the omission
      // rather than silently treating it as `pass`.
      const supplied = new Map<string, typeof dimensions[number]>()
      for (const d of dimensions) supplied.set(d.id, d)

      for (const reg of INTEGRITY_DIMENSIONS) {
        const sub = supplied.get(reg.id)
        if (!sub) {
          normalised.push({
            id: reg.id,
            verdict: "concerns",
            issues: [
              {
                type: reg.issueTypes[0]!,
                description: `Dimension '${reg.id}' was not addressed by the reviewer — treat as unverified.`,
              },
            ],
            corrections: [],
            missingGoals: [],
          })
          continue
        }

        const issues: IntegrityIssue[] = []
        for (const it of sub.issues) {
          const owner = dimensionForIssueType(it.type as IntegrityIssueType)
          if (owner && owner !== reg.id) {
            wrongDimensionIssues.push(`${it.type}@${reg.id}->${owner}`)
            continue
          }
          issues.push({
            type: it.type as IntegrityIssueType,
            description: it.description,
            goalIDs: it.goal_ids,
            evidence: it.evidence,
          })
        }

        let corrections: GoalCorrection[] = []
        let missingGoals: MissingGoal[] = []
        if (reg.canProposeCorrections) {
          for (const c of sub.corrections) {
            if (!goalIDs.has(c.goal_id)) {
              droppedCorrections.push(c.goal_id)
              continue
            }
            corrections.push({
              action: c.action,
              goalID: c.goal_id,
              reason: c.reason,
              updates: c.updates,
            })
          }
          missingGoals = sub.missing_goals.map((m) => ({
            title: m.title,
            objective: m.objective,
            acceptance_specs: m.acceptance_specs,
            owned_paths: m.owned_paths,
            kind: m.kind,
            priority: m.priority,
            reason: m.reason,
          }))
        } else {
          if (sub.corrections.length > 0 || sub.missing_goals.length > 0) {
            strippedDiagnostic.push(reg.id)
          }
        }

        // Verdict reconciliation per dimension: if the LLM said `pass` but
        // listed issues/corrections, escalate. If it said `needs_correction`
        // with nothing concrete, demote to `pass`. Same logic as fidelity's
        // pre-existing reconciliation, applied per-dimension here.
        let verdict = sub.verdict as IntegrityVerdict
        if (verdict === "pass" && (issues.length > 0 || corrections.length > 0 || missingGoals.length > 0)) {
          verdict = corrections.length > 0 || missingGoals.length > 0 ? "needs_correction" : "concerns"
        }
        if (verdict === "needs_correction" && issues.length === 0 && corrections.length === 0 && missingGoals.length === 0) {
          verdict = "pass"
        }

        normalised.push({ id: reg.id, verdict, issues, corrections, missingGoals })
      }

      const result = synthesizeResult(normalised, summary)
      collector.result = result

      const notes: string[] = []
      if (droppedCorrections.length > 0) {
        notes.push(`dropped ${droppedCorrections.length} correction(s) referencing unknown goal IDs: ${droppedCorrections.join(", ")}`)
      }
      if (wrongDimensionIssues.length > 0) {
        notes.push(`${wrongDimensionIssues.length} issue(s) filed under wrong dimension: ${wrongDimensionIssues.join(", ")}`)
      }
      if (strippedDiagnostic.length > 0) {
        notes.push(`stripped corrections from diagnostic-only dimension(s): ${strippedDiagnostic.join(", ")}`)
      }
      const note = notes.length > 0 ? ` (${notes.join("; ")})` : ""
      return `OK: aggregate verdict "${result.verdict}" recorded — ${result.dimensions.map((d) => `${d.id}=${d.verdict}`).join(", ")}${note}`
    },
  })

  const startedAt = Date.now()
  const out = await runAgentSession({
    kind: "integrity",
    core: INTEGRITY_CORE,
    sessionTitle: `Integrity Review: ${input.taskTitle}`,
    parentSessionID: input.parentSessionID,
    taskID: input.taskID,
    model: { providerID: model.providerID, modelID: model.api.id },
    signal: input.signal,
    toolKit: {
      tools: { submit_integrity_verdict: submitTool },
      getCollector: () => collector,
    },
    buildUserPrompt: () => buildIntegrityPrompt(input),
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
  })

  if (!collector.result) {
    throw new Error(
      `integrity reviewer did not call submit_integrity_verdict ` +
        `(sessionID=${out.session.id}, streamErrors=${out.streamErrors.length})`,
    )
  }

  log.info("integrity review completed", {
    verdict: collector.result.verdict,
    perDimension: collector.result.dimensions.map((d) => `${d.id}=${d.verdict}`).join(","),
    issues: collector.result.issues.length,
    corrections: collector.result.corrections.length,
    missingGoals: collector.result.missingGoals.length,
    streamErrors: out.streamErrors.length,
  })

  emitIntegrityEvent(input.taskID, out.session.id, collector.result, 1)
  return { ...collector.result, sessionID: out.session.id }
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
    "phrases as evidence in each issue. Call `submit_integrity_verdict` ONCE with the " +
    "per-dimension breakdown — do NOT collapse dimensions, do NOT include a top-level " +
    "verdict (the runtime aggregates from per-dimension verdicts).",
  )

  return sections.join("\n\n")
}
