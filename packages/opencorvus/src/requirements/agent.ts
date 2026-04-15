/**
 * RequirementsAgent — the single entry point for task requirements analysis.
 *
 * Replaces the old Spec Agent + Goal Agent two-stage pipeline.
 * Takes a raw user request and produces GoalContractFields[] directly,
 * seeding the Decision Log with foundational technical decisions.
 *
 * Architecture invariants (from specs/new-arch.svg):
 * ① RequirementsAgent is the sole producer of GoalContractFields.
 * ② DB mapping is lossless: each field gets its own column.
 * ③ acceptance_specs are the typed source of truth (heuristic + rubric).
 * ④ owned_paths is the hard write boundary for Executor.
 * ⑤ Contract is immutable once created. Only re-running requirements analysis can change it.
 */
import { stepCountIs } from "ai"
import type { TextHooks } from "@/llm/api"
import { Provider } from "@/provider/provider"
import { createPlannerTools, prefetchContext } from "@/planner/tools"
import { Log } from "@/util/log"
import { toolGuard } from "@/util/tool-guard"
import { OrchestratorConfig } from "@/orchestrator/config"
import { AttachmentStore } from "@/storage/attachment-store"
import { AgentRuntime } from "@/agent/runtime"
import { clarificationTranscriptSection, operatorNotesSection } from "@/orchestrator/helpers"
import { loadStageSkills } from "@/orchestrator/skill-inject"
import { Config } from "@/config/config"
import type { RequirementsOutput, ParsedGoalContract, RequirementsDecision, ParsedRequirement, TraceabilityEntry } from "./types"
import { createRequirementsOutputTools, type RequirementsCollector, type RegisteredGoal } from "./output-tools"
import type { GoalContractFields } from "@/pipeline/types"
import type { DecisionLog } from "@/decision-log"

import REQUIREMENTS_CORE from "@/prompt/core/requirements-core.txt"

const log = Log.create({ service: "requirements-agent" })

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface RequirementsResult {
  summary: string
  /** All requirements extracted from user input (explicit + implicit) */
  requirements: ParsedRequirement[]
  goals: GoalContractFields[]
  decisions: RequirementsDecision[]
  /** Requirement → Goal traceability matrix */
  traceability: TraceabilityEntry[]
}

// ---------------------------------------------------------------------------
// Retry context — for re-running requirements analysis after failed execution
// ---------------------------------------------------------------------------

export interface RequirementsRetryContext {
  previousGoals: Array<{
    title: string
    status: string
    evidence: string
  }>
  failureAnalysis: {
    classification: string
    summary: string
    rootCause: string
    suggestedStrategy: string
    avoidApproaches: string[]
  }
}

// ---------------------------------------------------------------------------
// RequirementsAgent public API
// ---------------------------------------------------------------------------

export namespace RequirementsAgent {
  /**
   * Analyze a task request into executable goal contracts.
   * Single entry point — replaces SpecAgent.initial() + GoalAgent.initial().
   */
  export async function run(input: {
    title: string
    request: string
    /** Base64 image attachments — injected as vision content alongside the request text. */
    attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>
    /** Capped design spec from an earlier design_analysis call. Rendered as a
     *  dedicated prompt section so it's visible to this agent only — it is
     *  NOT concatenated into task.request, so downstream sub-agents stay
     *  unaffected. */
    designSpec?: string
    taskID?: string
    sessionID?: string
    signal?: AbortSignal
    stream?: TextHooks
    onStatus?: (summary: string) => void | Promise<void>
    /** Optional Decision Log — seeded with foundational decisions. */
    decisionLog?: DecisionLog
    /** Optional retry context for re-running requirements after failure. */
    retryContext?: RequirementsRetryContext
  }): Promise<RequirementsResult> {
    return runInternal(input)
  }
}

// ---------------------------------------------------------------------------
// Internal implementation
// ---------------------------------------------------------------------------

async function runInternal(input: {
  title: string
  request: string
  attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>
  designSpec?: string
  taskID?: string
  sessionID?: string
  signal?: AbortSignal
  stream?: TextHooks
  onStatus?: (summary: string) => void | Promise<void>
  decisionLog?: DecisionLog
  retryContext?: RequirementsRetryContext
}): Promise<RequirementsResult> {
  if (input.signal?.aborted) throw new Error("requirements agent aborted before model resolution")

  const orchCfg = await OrchestratorConfig.get()
  const {
    max_steps: MAX_STEPS,
    timeout_ms: TIMEOUT_MS,
    quality_threshold: QUALITY_RETRY_THRESHOLD,
    max_attempts: MAX_ATTEMPTS,
  } = orchCfg.requirements

  const { resolveAgentModel } = await import("@/agent/model")
  const model = await resolveAgentModel("requirements").catch(() => undefined)
  if (!model) throw new Error("no LLM model available for requirements agent")

  if (input.signal?.aborted) throw new Error("requirements agent aborted after model resolution")

  // Extract working directory from request
  const cwdMatch =
    input.request.match(/(?:绝对路径|absolute path)[：:\s]*([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i) ??
    input.request.match(/(?:工作目录|working dir(?:ectory)?)[^\n]*?([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i)
  const taskWorkDir = cwdMatch ? cwdMatch[1].replace(/[/\\]+$/, "") : undefined

  // Merge planner tools (codebase exploration) + structured output tools (goal registration).
  // Each registration tool call is small (~500 bytes) — no buffering risk.
  const plannerTools = createPlannerTools(taskWorkDir)
  const outputToolKit = createRequirementsOutputTools(taskWorkDir)
  const guard = toolGuard({ ...plannerTools, ...outputToolKit.tools })

  if (input.signal?.aborted) throw new Error("requirements agent aborted before context prefetch")

  const context = prefetchContext(input.title, input.request)

  let lastParsed: RequirementsOutput | undefined
  let lastQuality: { score: number; reasons: string[] } | undefined

  const systemPrompt = await requirementsSystem()
  const initialPrompt = buildUserPrompt(input, context)
  const initialContent = await buildMultimodalContent(initialPrompt, input.attachments)
  let messages: any[] = [{ role: "user" as const, content: initialContent }]
  let cumulativeToolCalls = 0

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (input.signal?.aborted) throw new Error("requirements agent aborted before attempt " + (attempt + 1))

    await input.onStatus?.(`Requirements agent attempt ${attempt + 1}/${MAX_ATTEMPTS}`)

    if (attempt > 0 && lastQuality) {
      messages.push({
        role: "user" as const,
        content: buildRetryMessage(lastQuality, QUALITY_RETRY_THRESHOLD, attempt),
      })
    }

    log.info("requirements agent starting", {
      title: input.title,
      model: model.id,
      attempt: attempt + 1,
      retryReason: attempt > 0 && lastQuality ? `score ${lastQuality.score} < ${QUALITY_RETRY_THRESHOLD}` : undefined,
    })

    const abortSignals: AbortSignal[] = [guard.signal]
    if (input.signal) abortSignals.push(input.signal)

    // RequirementsAgent is always invoked nested: the caller (task-agent or
    // requirements service) owns persistence via its own session-hooks and
    // forwards chunks through `input.stream`. We therefore wrap those into
    // a passthrough hooks object so AgentRuntime neither creates a duplicate
    // hooks nor requires a sessionID of its own.
    const passthroughHooks = {
      onChunk: input.stream?.onChunk,
      onError: input.stream?.onError,
      flush: async () => {},
      failures: { snapshot: () => ({ count: 0, items: [] as any[] }) },
    } as any
    const runResult = await AgentRuntime.run({
      agent: "requirements",
      model,
      system: systemPrompt,
      messages,
      tools: guard.tools,
      stopWhen: stepCountIs(MAX_STEPS),
      cacheKey: input.taskID ? `task-${input.taskID}-requirements` : undefined,
      sessionID: input.sessionID ?? "",
      taskID: input.taskID,
      stage: "requirements",
      signal: AbortSignal.any(abortSignals),
      onStepFinish: guard.onStepFinish as any,
      hooks: passthroughHooks,
      policies: {
        progressTimeoutMs: TIMEOUT_MS,
        // Caller-side hooks do their own failure accounting; don't let runtime
        // throw here — the caller will surface any persist errors.
        failurePolicy: "collect",
      },
    })

    const resultSteps = runResult.steps
    const resultFinishReason = runResult.finishReason
    cumulativeToolCalls += runResult.toolCallCount

    log.info("requirements agent finished", {
      steps: resultSteps.length,
      finishReason: resultFinishReason,
      textLength: (runResult.text?.trim() || "").length,
      toolCalls: runResult.toolCallCount,
      cumulativeToolCalls,
      attempt: attempt + 1,
    })

    // Structured tool-call output is the only supported path. If the LLM did
    // not register any goals via register_goal, treat this attempt as a hard
    // failure — no text-parsing fallback (see CLAUDE.md "no fallback" rule).
    const collector = outputToolKit.getCollector()
    if (collector.goals.length === 0) {
      log.warn("requirements agent: no goals registered via tool calls", {
        attempt: attempt + 1,
        toolCalls: cumulativeToolCalls,
        finishReason: resultFinishReason,
      })
      // Force a retry by setting an unusable parsed shape; the quality check
      // below will reject it and the loop will reset for the next attempt.
      lastParsed = undefined
      messages = [{ role: "user" as const, content: initialPrompt }]
      outputToolKit.reset()
      continue
    }

    const parsed = collectorToOutput(collector)
    log.info("requirements agent: using structured output", {
      goals: parsed.goals.length,
      requirements: parsed.requirements.length,
      decisions: parsed.decisions.length,
    })
    lastParsed = parsed

    const quality = validateQuality(parsed, cumulativeToolCalls)
    lastQuality = quality

    log.info("requirements agent output", {
      goals: parsed.goals.length,
      decisions: parsed.decisions.length,
      toolCalls: cumulativeToolCalls,
      quality,
      attempt: attempt + 1,
    })

    if (quality.score >= QUALITY_RETRY_THRESHOLD || attempt >= MAX_ATTEMPTS - 1) {
      const result = toResult(parsed)

      // Seed Decision Log with foundational decisions
      if (input.decisionLog && result.decisions.length > 0) {
        for (const decision of result.decisions) {
          input.decisionLog.append({
            phase: "requirements",
            key: decision.key,
            value: decision.value,
            reason: decision.reason,
          })
        }
      }

      return result
    }

    // Retry with fresh context — reset both messages and collector
    messages = [{ role: "user" as const, content: initialPrompt }]
    outputToolKit.reset()

    log.warn("requirements: quality below threshold, retrying", {
      score: quality.score,
      threshold: QUALITY_RETRY_THRESHOLD,
      reasons: quality.reasons,
    })
  }

  if (!lastParsed) throw new Error("Requirements agent produced no output after all attempts")
  return toResult(lastParsed)
}

// ---------------------------------------------------------------------------
// Convert parsed output to RequirementsResult
// ---------------------------------------------------------------------------

function toResult(parsed: RequirementsOutput): RequirementsResult {
  return {
    summary: parsed.summary || "Task decomposition",
    requirements: parsed.requirements,
    goals: parsed.goals.map(goalToContract),
    decisions: parsed.decisions,
    traceability: parsed.traceability,
  }
}

// ---------------------------------------------------------------------------
// Convert structured collector → RequirementsOutput (same shape as text parsing)
// ---------------------------------------------------------------------------

function collectorToOutput(collector: RequirementsCollector): RequirementsOutput {
  return {
    summary: collector.summary,
    requirements: collector.requirements.map(r => ({
      id: r.id,
      type: r.type,
      description: r.description,
    })),
    decisions: collector.decisions.map(d => ({
      key: d.key,
      value: d.value,
      reason: d.reason,
    })),
    goals: collector.goals.map((g): ParsedGoalContract => ({
      id: g.id,
      title: g.title,
      objective: g.objective,
      acceptance_specs: g.acceptance_specs,
      owned_paths: g.owned_paths,
      depends_on: g.depends_on,
      exports: g.exports,
      imports: g.imports,
      priority: g.priority,
      kind: g.kind,
      requirement_ids: g.requirement_ids,
      source: g.requirement_ids.length > 0 ? "explicit" : "implicit",
    })),
    traceability: collector.traceability.map(t => ({
      requirementID: t.requirementID,
      goalIDs: t.goalIDs,
    })),
  }
}

function goalToContract(g: ParsedGoalContract): GoalContractFields {
  return {
    id: g.id,
    title: g.title,
    objective: g.objective,
    acceptance_specs: g.acceptance_specs,
    owned_paths: g.owned_paths,
    depends_on: g.depends_on,
    exports: g.exports,
    imports: g.imports,
    priority: g.priority,
    kind: g.kind,
    requirement_ids: g.requirement_ids,
  }
}

// ---------------------------------------------------------------------------
// Multimodal content builder
// ---------------------------------------------------------------------------

/**
 * Build an AI SDK content array from text + optional attachment references.
 * When no attachments are present, returns the plain string (more efficient).
 * Otherwise reads the bytes back from AttachmentStore (the canonical location
 * on disk) and emits base64 file parts alongside the text part.
 *
 * AI SDK FilePart: { type: "file", data: base64string, mediaType, filename? }
 */
async function buildMultimodalContent(
  text: string,
  attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>,
) {
  const { multimodal, referenceOnly } = AttachmentStore.partition(attachments)
  const enrichedText = text + AttachmentStore.renderReferenceList(referenceOnly)
  const fileParts = await AttachmentStore.loadFileParts(multimodal)
  if (fileParts.length === 0) return enrichedText
  return [{ type: "text" as const, text: enrichedText }, ...fileParts]
}

// ---------------------------------------------------------------------------
// User prompt
// ---------------------------------------------------------------------------

function buildUserPrompt(
  input: {
    title: string
    request: string
    designSpec?: string
    taskID?: string
    retryContext?: RequirementsRetryContext
  },
  context: string,
): string {
  const sections = [`# Task\n\nTitle: ${input.title}\n\nRequest:\n${input.request}`]

  if (input.designSpec && input.designSpec.trim()) {
    // Design spec is scoped to this agent (see RequirementsAgent.run docs).
    // It is capped at source (DesignAnalystAgent.PROMPT_SECTION_CAP) — safe
    // to inline verbatim here.
    sections.push(input.designSpec)
  }

  if (input.taskID) {
    const clarifications = clarificationTranscriptSection(input.taskID)
    if (clarifications) sections.push(clarifications)
    const notes = operatorNotesSection(input.taskID)
    if (notes) sections.push(notes)
  }

  if (context) {
    sections.push(`# Project Context (Pre-fetched)\n\n${context}`)
  }

  if (input.retryContext) {
    const ctx = input.retryContext
    sections.push(
      [
        "# Requirements Retry Context",
        "",
        "The previous execution FAILED. Restructure goals to address the failure.",
        "",
        "## Failure Analysis",
        `Classification: ${ctx.failureAnalysis.classification}`,
        `Summary: ${ctx.failureAnalysis.summary}`,
        `Root Cause: ${ctx.failureAnalysis.rootCause}`,
        `Strategy: ${ctx.failureAnalysis.suggestedStrategy}`,
        "",
        "## Approaches to AVOID",
        ...ctx.failureAnalysis.avoidApproaches.map((a) => `- ${a}`),
        "",
        "## Previous Goal Results",
        ...ctx.previousGoals.map(
          (g) => `- ${g.title}: **${g.status}** — ${g.evidence}`,
        ),
      ].join("\n"),
    )
  }

  sections.push(
    "Now recall memory, check preferences, explore the codebase thoroughly, " +
    "record key technical decisions, then output your goal decomposition " +
    "using section tags as described in your instructions.",
  )

  return sections.join("\n\n")
}

// ---------------------------------------------------------------------------
// Retry message
// ---------------------------------------------------------------------------

function buildRetryMessage(
  lastQuality: { score: number; reasons: string[] },
  qualityThreshold: number,
  attempt: number,
): string {
  return [
    "# QUALITY RETRY — Previous Requirements Analysis Was Insufficient",
    "",
    `Score: ${lastQuality.score.toFixed(2)} / ${qualityThreshold}. Attempt ${attempt + 1}.`,
    "",
    "**Issues:**",
    ...lastQuality.reasons.map((r) => `- ${r}`),
    "",
    "You already explored the codebase — use that knowledge. Do NOT repeat tool calls. " +
    "Fix all issues and output improved goals with complete fields.",
  ].join("\n")
}

// ---------------------------------------------------------------------------
// Quality validation
// ---------------------------------------------------------------------------

function validateQuality(
  parsed: RequirementsOutput,
  toolCallCount: number,
): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []

  // Requirement extraction (0.15) — did the agent parse the input exhaustively?
  if (parsed.requirements.length >= 3) score += 0.15
  else if (parsed.requirements.length >= 1) score += 0.07
  else reasons.push("No requirements extracted from user input — requirements agent must parse input line by line")

  // Traceability (0.15) — every requirement mapped to a goal?
  if (parsed.requirements.length > 0 && parsed.traceability.length > 0) {
    const coveredReqs = new Set(parsed.traceability.map(t => t.requirementID))
    const uncovered = parsed.requirements.filter(r => !coveredReqs.has(r.id))
    if (uncovered.length === 0) score += 0.15
    else { score += 0.05; reasons.push(`${uncovered.length} requirement(s) not traced to goals: ${uncovered.map(r => r.id).join(", ")}`) }
  } else if (parsed.requirements.length > 0) {
    reasons.push("No traceability matrix — cannot verify requirement coverage")
  } else {
    score += 0.05 // no requirements = simple task, traceability less critical
  }

  // Tool usage (0.10)
  if (toolCallCount >= 5) score += 0.10
  else if (toolCallCount >= 2) score += 0.05
  else if (toolCallCount === 0) reasons.push("No tool calls — goals not grounded in codebase")

  // Goal count vs requirement count (0.05) — penalize both under-splitting and over-splitting
  if (parsed.goals.length === 0) {
    reasons.push("No goals produced")
  } else if (parsed.requirements.length >= 20 && parsed.goals.length <= 2) {
    reasons.push(`Under-split: ${parsed.goals.length} goal(s) for ${parsed.requirements.length} requirements — executor will fail on mega-goals. Need at least 4 goals for this scope.`)
  } else if (parsed.requirements.length >= 10 && parsed.goals.length <= 1) {
    reasons.push(`Under-split: 1 goal for ${parsed.requirements.length} requirements — split into at least 3 goals by subsystem.`)
  } else if (parsed.goals.length > 12) {
    score += 0.02
    reasons.push(`Over-split: ${parsed.goals.length} goals is excessive — merge related goals to reduce orchestration overhead.`)
  } else {
    score += 0.05
  }

  // Owned paths (0.15)
  const withPaths = parsed.goals.filter((g) => g.owned_paths.length > 0).length
  if (withPaths === parsed.goals.length && parsed.goals.length > 0) score += 0.15
  else if (withPaths > 0) { score += 0.07; reasons.push(`${parsed.goals.length - withPaths} goal(s) missing owned_paths`) }
  else if (parsed.goals.length > 0) reasons.push("No goals have owned_paths")

  // Acceptance specs (0.15) — every goal must have at least one spec.
  const withSpecs = parsed.goals.filter((g) => g.acceptance_specs.length > 0).length
  if (withSpecs === parsed.goals.length && parsed.goals.length > 0) score += 0.15
  else if (withSpecs > 0) { score += 0.07; reasons.push(`${parsed.goals.length - withSpecs} goal(s) missing acceptance_specs`) }
  else if (parsed.goals.length > 0) reasons.push("No goals have acceptance_specs")

  // Exports declared (0.10)
  const withExports = parsed.goals.filter((g) => g.exports.length > 0).length
  if (withExports >= parsed.goals.length * 0.5 && parsed.goals.length > 0) score += 0.10
  else if (withExports > 0) { score += 0.05; reasons.push("Most goals missing exports declarations") }

  // Decisions recorded (0.10)
  if (parsed.decisions.length >= 2) score += 0.10
  else if (parsed.decisions.length >= 1) score += 0.05

  // Self-contained objectives (0.05) — each goal objective long enough to be actionable?
  const withDetailedObj = parsed.goals.filter((g) => g.objective.length > 50).length
  if (withDetailedObj === parsed.goals.length && parsed.goals.length > 0) score += 0.05
  else if (parsed.goals.length > 0) reasons.push(`${parsed.goals.length - withDetailedObj} goal(s) have objectives too short to be self-contained`)

  return { score: Math.min(score, 1), reasons }
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const REQUIREMENTS_SYSTEM = REQUIREMENTS_CORE

async function requirementsSystem(): Promise<string> {
  const config = await Config.get()
  const systemOverride = (config as Record<string, unknown>).prompt as Record<string, unknown> | undefined
  if (typeof systemOverride?.requirements_system === "string") return systemOverride.requirements_system
  const agentPrompt = (config.agent as Record<string, any> | undefined)?.requirements?.prompt
  const core = typeof agentPrompt === "string" ? agentPrompt : REQUIREMENTS_CORE
  const orchCfg = await OrchestratorConfig.get()
  const skills = await loadStageSkills(orchCfg.requirements.skills, "requirements")
  return core + skills
}
