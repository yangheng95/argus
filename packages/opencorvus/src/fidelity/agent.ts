/**
 * Fidelity Review — verifies goal coverage against the ORIGINAL user input.
 *
 * The reviewer is a single-call tool-use loop:
 *   • The LLM sees the original request + the registered goal contracts.
 *   • It MUST invoke the `submit_fidelity_verdict` tool exactly once with a
 *     Zod-validated structured verdict (verdict + issues + corrections +
 *     missing_goals).
 *   • Provider tool-call APIs guarantee the input is valid JSON; Zod enforces
 *     the shape. There is no JSON-string fallback path — if the model never
 *     submits, the review fails loudly.
 */
import { tool } from "ai"
import z from "zod"
import FIDELITY_CORE from "@/prompt/core/fidelity-core.txt"
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

const log = Log.create({ service: "fidelity-review" })

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FidelityIssue {
  type: "uncovered" | "partial" | "distorted" | "merged_incorrectly"
  description: string
  /** Related goal IDs (if applicable) */
  goalIDs?: string[]
}

export interface GoalCorrection {
  action: "modify" | "split" | "remove"
  goalID: string
  reason: string
  /** Updated fields (for modify action) */
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

export interface FidelityResult {
  verdict: "faithful" | "needs_correction"
  issues: FidelityIssue[]
  corrections: GoalCorrection[]
  missingGoals: MissingGoal[]
}

// ---------------------------------------------------------------------------
// Tool input schemas (snake_case at the wire to match AcceptanceSpec field
// naming; mapped to camelCase FidelityResult on receive)
// ---------------------------------------------------------------------------

const FidelityIssueInput = z.object({
  type: z.enum(["uncovered", "partial", "distorted", "merged_incorrectly"]),
  description: z.string().min(1),
  goal_ids: z.array(z.string()).optional(),
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

const SubmitFidelityInput = z.object({
  verdict: z.enum(["faithful", "needs_correction"]),
  issues: z.array(FidelityIssueInput),
  corrections: z.array(GoalCorrectionInput),
  missing_goals: z.array(MissingGoalInput),
})

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Review goals against the original user input for coverage and fidelity.
 *
 * Single tool-call pass — no codebase exploration. The reviewer compares the
 * goal set against the user's literal request and submits a structured
 * verdict via `submit_fidelity_verdict`.
 */
export async function reviewFidelity(input: {
  userRequest: string
  taskTitle: string
  goals: GoalContractFields[]
  /** Upstream evidence the reviewer must see to judge coverage:
   *  - requirements: the REQ-N list architect decomposed against
   *  - requirementDecisions: runtime / stack / test-framework decisions
   *  - designSpecs: advisory visual contract from design-analyst
   *  - decisionLog: architect's phase-level decisions recorded so far
   *
   *  Without these the reviewer only sees the user's raw sentence + the
   *  finished goal list and cannot tell whether the goal set actually
   *  covers requirements / decisions / visual intent. Architect must
   *  forward whatever upstream context it received into every fidelity
   *  run (same as it did for its own prompt). */
  requirements?: ParsedRequirement[]
  requirementDecisions?: RequirementsDecision[]
  designSpecs?: VisualSpec[]
  decisionLog?: DecisionLog
  signal?: AbortSignal
  /** Task ID for cache stickiness — same key requirements used keeps hexin
   *  on the same upstream pool, so prompt cache hits across stages. Also
   *  used as the aggregate for the FidelityReviewCompleted event so the
   *  overlay can render a native verdict card on the fidelity session. */
  taskID?: string
  /** Architect session ID. Fidelity review is promoted to a first-class
   *  child session under this parent so the overlay renders an independent
   *  agent card for each invocation. */
  parentSessionID?: string
}): Promise<FidelityResult> {
  const { goals } = input

  if (input.taskID && !input.parentSessionID) {
    throw new Error(
      `reviewFidelity requires parentSessionID for task-backed runs (taskID=${input.taskID}). ` +
        `The orchestrator's fidelity tool must attach a parent session before dispatch.`,
    )
  }

  // Empty-goal-set and missing-model paths are soft exits that synthesize a
  // verdict without invoking the LLM. Both need a sessionID for the overlay
  // to render a card — create a transient session up front. If no parent
  // session is supplied (CLI dry-run with no taskID) the event emitter
  // silently skips.
  if (goals.length === 0) {
    const result: FidelityResult = {
      verdict: "needs_correction",
      issues: [{ type: "uncovered", description: "No goals produced" }],
      corrections: [],
      missingGoals: [],
    }
    await emitSoftFidelity(input, result)
    return result
  }
  const model = await resolveAgentModel("fidelity", { taskID: input.taskID }).catch(() => undefined)
  if (!model) {
    log.warn("no LLM available for fidelity review, skipping")
    const result: FidelityResult = { verdict: "faithful", issues: [], corrections: [], missingGoals: [] }
    await emitSoftFidelity(input, result)
    return result
  }

  const goalIDs = new Set(goals.map((g) => g.id))
  const collector: { result: FidelityResult | undefined } = { result: undefined }

  const submitTool = tool({
    description:
      "Submit the fidelity verdict for the goal set. Call EXACTLY ONCE after evaluating " +
      "the goals against the original user request. All fields are schema-validated; on " +
      "validation error you will receive a message describing the failure and must call again.",
    inputSchema: SubmitFidelityInput,
    execute: async ({ verdict, issues, corrections, missing_goals }) => {
      // Drop corrections that point at unknown goal IDs — the reviewer
      // sometimes invents IDs. We don't auto-repair (no fallback); we drop
      // and surface the count so the model can resubmit with the right IDs
      // if the verdict changes shape.
      const droppedCorrections: string[] = []
      const keptCorrections: GoalCorrection[] = []
      for (const c of corrections) {
        if (!goalIDs.has(c.goal_id)) {
          droppedCorrections.push(c.goal_id)
          continue
        }
        keptCorrections.push({
          action: c.action,
          goalID: c.goal_id,
          reason: c.reason,
          updates: c.updates,
        })
      }

      let normalized: FidelityResult = {
        verdict,
        issues: issues.map((i) => ({
          type: i.type,
          description: i.description,
          goalIDs: i.goal_ids,
        })),
        corrections: keptCorrections,
        missingGoals: missing_goals.map((m) => ({
          title: m.title,
          objective: m.objective,
          acceptance_specs: m.acceptance_specs,
          owned_paths: m.owned_paths,
          kind: m.kind,
          priority: m.priority,
          reason: m.reason,
        })),
      }

      // Verdict reconciliation: if the model says "faithful" but lists
      // corrections/missing goals, treat as needs_correction. Inverse too.
      // The model occasionally gets the verdict label wrong while the
      // body is consistent.
      if (
        normalized.verdict === "faithful" &&
        (normalized.corrections.length > 0 || normalized.missingGoals.length > 0)
      ) {
        normalized = { ...normalized, verdict: "needs_correction" }
      }
      if (
        normalized.verdict === "needs_correction" &&
        normalized.issues.length === 0 &&
        normalized.corrections.length === 0 &&
        normalized.missingGoals.length === 0
      ) {
        normalized = { ...normalized, verdict: "faithful" }
      }

      collector.result = normalized

      const droppedNote = droppedCorrections.length > 0
        ? ` (dropped ${droppedCorrections.length} correction(s) referencing unknown goal IDs: ${droppedCorrections.join(", ")})`
        : ""
      return `OK: verdict "${normalized.verdict}" recorded — ${normalized.issues.length} issues, ${normalized.corrections.length} corrections, ${normalized.missingGoals.length} missing goals${droppedNote}`
    },
  })

  // onSessionCreated runs right after runner creates the child session.
  // Fires the "Started" event + a 20s progress ticker, both scoped to the
  // fresh session.id. The returned disposer clears the ticker when the
  // runner finishes (success or failure).
  const startedAt = Date.now()
  const out = await runAgentSession({
    kind: "fidelity",
    core: FIDELITY_CORE,
    sessionTitle: `Fidelity Review: ${input.taskTitle}`,
    parentSessionID: input.parentSessionID,
    taskID: input.taskID,
    model: { providerID: model.providerID, modelID: model.api.id },
    signal: input.signal,
    toolKit: {
      tools: { submit_fidelity_verdict: submitTool },
      getCollector: () => collector,
    },
    buildUserPrompt: () => buildFidelityPrompt(input),
    onSessionCreated: (session) => {
      emitFidelityLifecycle("started", input.taskID, session.id, 0, 0)
      const ticker = input.taskID
        ? setInterval(() => {
            emitFidelityLifecycle(
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
      `fidelity reviewer did not call submit_fidelity_verdict ` +
        `(sessionID=${out.session.id}, streamErrors=${out.streamErrors.length})`,
    )
  }

  log.info("fidelity review completed", {
    verdict: collector.result.verdict,
    issues: collector.result.issues.length,
    corrections: collector.result.corrections.length,
    missingGoals: collector.result.missingGoals.length,
    streamErrors: out.streamErrors.length,
  })

  // attempts=1 because phase-3-b-7 migration absorbs Zod retries inside
  // AI SDK's tool-input-validation path (the overlay suppresses "attempt N"
  // when attempt is 1, matching the pre-migration behavior).
  emitFidelityEvent(input.taskID, out.session.id, collector.result, 1)
  return collector.result
}

/**
 * Soft-fail path for the two early exits (no goals / no model). Materializes
 * a transient session for overlay attribution so the verdict card can render,
 * then emits the terminal event. Silent when no parentSessionID is supplied
 * (CLI dry-runs).
 */
async function emitSoftFidelity(
  input: { taskID?: string; parentSessionID?: string; taskTitle: string },
  result: FidelityResult,
): Promise<void> {
  if (!input.taskID) return
  if (!input.parentSessionID) return
  const { Session } = await import("@/session")
  const session = await Session.createNext({
    kind: "fidelity",
    parentID: input.parentSessionID,
    title: `Fidelity Review: ${input.taskTitle}`,
    directory: Instance.directory,
  })
  emitFidelityEvent(input.taskID, session.id, result, 0)
}

/** Broadcast the parsed fidelity verdict so the overlay can render a native
 *  verdict block (badge + issues list + corrections diff) on the fidelity
 *  session card. Silently skips when the caller did not provide a taskID
 *  (e.g. CLI dry-runs) — EngineProtocol requires a taskID to persist to
 *  protocol_event. */
function emitFidelityEvent(
  taskID: string | undefined,
  sessionID: string | undefined,
  result: FidelityResult,
  attempts: number,
): void {
  if (!taskID) return
  if (!sessionID) {
    // sessionID is required for the overlay to attach the verdict payload to
    // the fidelity agent session. A missing value would otherwise force the
    // frontend back onto the synthetic-card path we are removing.
    throw new Error(
      `fidelity.review.completed: sessionID required but missing (taskID=${taskID}). ` +
        `reviewFidelity must create a fidelity child session before invoking SessionPrompt.prompt.`,
    )
  }
  const payload = {
    taskID,
    sessionID,
    verdict: result.verdict,
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
  void EngineProtocol.emit(EngineEvent.FidelityReviewCompleted, payload, { source: "architect.fidelity" })
}

/** Emit fidelity review lifecycle events — Started and Progress — while the
 *  LLM call is in flight. Started fires once before the tool-use loop;
 *  Progress fires every 20s while we wait. Both advance the benchmark
 *  alive-stall detector and feed the overlay's running fidelity session
 *  card header (tree-writer's handleFidelityStarted / handleFidelityProgress
 *  own the card lifecycle). Silently skips when taskID or sessionID is
 *  missing — CLI dry-runs don't need liveness events. */
function emitFidelityLifecycle(
  phase: "started" | "progress",
  taskID: string | undefined,
  sessionID: string | undefined,
  attempt: number,
  elapsedMs: number,
): void {
  if (!taskID || !sessionID) {
    log.warn("fidelity lifecycle event skipped — missing taskID/sessionID", {
      phase,
      hasTaskID: !!taskID,
      hasSessionID: !!sessionID,
    })
    return
  }
  const def = phase === "started" ? EngineEvent.FidelityReviewStarted : EngineEvent.FidelityReviewProgress
  const properties =
    phase === "started"
      ? { taskID, sessionID }
      : { taskID, sessionID, attempt, elapsedMs }
  log.info("fidelity lifecycle emit", { phase, taskID, sessionID, attempt, elapsedMs })
  EngineProtocol.emit(def as any, properties as any, { source: "architect.fidelity" }).catch(
    (err) => {
      log.error("fidelity lifecycle emit failed", {
        phase,
        taskID,
        sessionID,
        error: err instanceof Error ? err.message : String(err),
      })
    },
  )
}

// ---------------------------------------------------------------------------
// Chunk forwarder — routes AI-SDK stream chunks into FidelityReviewChunk
// ---------------------------------------------------------------------------

/** Throttled forwarder that takes AI-SDK stream chunks and emits
 *  FidelityReviewChunk events for the overlay's running fidelity card.
 *
 *  ONLY `reasoning-delta` is forwarded. Tool-input-delta is the partial JSON
 *  of the `submit_fidelity_verdict` protocol payload — rendering those
 *  bytes on screen would reveal raw tool arguments, which is exactly what
 *  the tool-call architecture is supposed to hide (structured verdict is
 *  delivered via FidelityReviewCompleted). Non-reasoning models simply
 *  won't stream anything here; their 5-15s tool-call latency is small
 *  enough that no streaming is needed. Reasoning models (qwq, deepseek-r1,
 *  o1, sonnet-thinking) emit minutes of reasoning-delta and that IS the
 *  liveness the operator needs.
 *
 *  Why throttle: provider streams fire tokens at tens of events/s but
 *  protocol_event is persisted per emit. 500ms batching caps row count to
 *  ~360 per 180s review — well under storage overhead budget.
 *
 *  Attempt counter: each re-entry into the reasoning stream after a
 *  validation retry increments attempt so the overlay can open a fresh
 *  reasoning part for each retry (avoids merging reasoning from different
 *  attempts into one block). We detect attempt boundaries via
 *  tool-input-start for the verdict tool — each new start means the model
 *  is kicking off a fresh submission.
 *
 *  Silent when taskID or sessionID is absent (CLI dry-runs). */
interface FidelityChunkForwarder {
  handleChunk(arg: { chunk: any }): void
  flushAll(): Promise<void>
  dispose(): void
}

function createFidelityChunkForwarder(opts: {
  taskID: string | undefined
  sessionID: string | undefined
  intervalMs: number
}): FidelityChunkForwarder {
  const inactive: FidelityChunkForwarder = {
    handleChunk: () => {},
    flushAll: async () => {},
    dispose: () => {},
  }
  if (!opts.taskID || !opts.sessionID) return inactive

  const FIDELITY_TOOL = "submit_fidelity_verdict"
  let attempt = 0

  let buffer = ""
  let timer: ReturnType<typeof setTimeout> | null = null

  const emit = async (delta: string) => {
    if (!delta) return
    try {
      await EngineProtocol.emit(
        EngineEvent.FidelityReviewChunk,
        {
          taskID: opts.taskID!,
          sessionID: opts.sessionID!,
          kind: "reasoning" as const,
          delta,
          attempt: Math.max(attempt, 1),
        },
        { source: "architect.fidelity" },
      )
    } catch (err) {
      log.error("fidelity chunk emit failed", {
        taskID: opts.taskID,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const flush = async () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (!buffer) return
    const delta = buffer
    buffer = ""
    await emit(delta)
  }

  const armFlush = () => {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      void flush()
    }, opts.intervalMs)
  }

  return {
    handleChunk({ chunk }) {
      const type = chunk?.type
      if (type === "tool-input-start" && chunk.toolName === FIDELITY_TOOL) {
        attempt += 1
        return
      }
      if (type === "reasoning-delta") {
        const text = typeof chunk.text === "string" ? chunk.text : ""
        if (!text) return
        buffer += text
        armFlush()
        return
      }
    },
    async flushAll() {
      await flush()
    },
    dispose() {
      if (timer) clearTimeout(timer)
      timer = null
      buffer = ""
    },
  }
}

// ---------------------------------------------------------------------------
// Apply corrections to goal list
// ---------------------------------------------------------------------------

/**
 * Apply fidelity corrections to the goal list. Returns a new array.
 */
export function applyFidelityCorrections(
  goals: GoalContractFields[],
  result: FidelityResult,
): GoalContractFields[] {
  if (result.verdict === "faithful") return goals

  let corrected = [...goals]

  // Apply modifications
  for (const correction of result.corrections) {
    if (correction.action === "modify" && correction.updates) {
      corrected = corrected.map(g =>
        g.id === correction.goalID
          ? { ...g, ...correction.updates }
          : g,
      )
    } else if (correction.action === "remove") {
      corrected = corrected.filter(g => g.id !== correction.goalID)
    }
    // "split" actions are not applied directly; the upstream fidelity pass lists
    // the resulting sub-goals in missingGoals and they are added below.
  }

  // Add missing goals
  for (const missing of result.missingGoals) {
    // Dedup: skip if title already exists
    const normalizedTitle = missing.title.toLowerCase().trim()
    if (corrected.some(g => g.title.toLowerCase().trim() === normalizedTitle)) continue

    corrected.push({
      id: `goal_fidelity_${corrected.length + 1}`,
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

function buildFidelitySystem(): string {
  return FIDELITY_CORE
}

function buildFidelityPrompt(input: {
  userRequest: string
  taskTitle: string
  goals: GoalContractFields[]
  requirements?: ParsedRequirement[]
  requirementDecisions?: RequirementsDecision[]
  designSpecs?: VisualSpec[]
  decisionLog?: DecisionLog
}): string {
  const sections: string[] = []

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
        "Use them to judge whether the goal set covers the visual/interaction intent; " +
          "an uncovered spec is evidence the goal decomposition is incomplete.",
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
    "Now compare the goals against the user request, the requirement list, foundational " +
    "decisions, and the visual contract (when present). Call `submit_fidelity_verdict` with " +
    "your verdict; cite specific REQ-N / spec IDs in your issue descriptions when the goal " +
    "set leaves them uncovered or distorted.",
  )

  return sections.join("\n\n")
}
