/**
 * DecomposeAgent — the single entry point for task decomposition.
 *
 * Replaces the old Spec Agent + Goal Agent two-stage pipeline.
 * Takes a raw user request and produces GoalContractFields[] directly,
 * seeding the Decision Log with foundational technical decisions.
 *
 * Architecture invariants (from specs/new-arch.svg):
 * ① DecomposeAgent is the sole producer of GoalContractFields.
 * ② DB mapping is lossless: each field gets its own column.
 * ③ done_definition must be Eval Agent executable.
 * ④ owned_paths is the hard write boundary for Executor.
 * ⑤ Contract is immutable once created. Only re-decompose can change it.
 */
import { stepCountIs } from "ai"
import type { TextHooks } from "@/llm/api"
import { Provider } from "@/provider/provider"
import { ProviderLLM } from "@/provider/llm"
import { createPlannerTools, prefetchContext } from "@/planner/tools"
import { Log } from "@/util/log"
import { toolGuard } from "@/util/tool-guard"
import { createInactivityGuard } from "@/util/inactivity-guard"
import { AgentTrace } from "@/util/agent-trace"
import { OrchestratorConfig } from "@/orchestrator/config"
import { operatorNotesSection } from "@/orchestrator/helpers"
import { loadStageSkills } from "@/orchestrator/skill-inject"
import { Config } from "@/config/config"
import type { DecomposeOutput, ParsedGoalContract, DecomposeDecision, ParsedRequirement, TraceabilityEntry } from "./types"
import { createDecomposeOutputTools, type DecomposeCollector, type RegisteredGoal } from "./output-tools"
import { parseRecommendedNext } from "@/architect/parse-recommended"
import type { GoalContractFields } from "@/pipeline/types"
import type { DecisionLog } from "@/decision-log"
import type { RecommendedNext } from "@/architect/types"

import DECOMPOSE_CORE from "@/prompt/core/decompose-core.txt"

const log = Log.create({ service: "decompose-agent" })

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface DecomposeResult {
  summary: string
  /** All requirements extracted from user input (explicit + implicit) */
  requirements: ParsedRequirement[]
  goals: GoalContractFields[]
  decisions: DecomposeDecision[]
  /** Requirement → Goal traceability matrix */
  traceability: TraceabilityEntry[]
  /** Recommended next actions for Task Agent */
  recommendedNext: RecommendedNext[]
}

// ---------------------------------------------------------------------------
// Redecompose context — for retry after failed execution
// ---------------------------------------------------------------------------

export interface RedecomposeContext {
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
// DecomposeAgent public API
// ---------------------------------------------------------------------------

export namespace DecomposeAgent {
  /**
   * Decompose a task request into executable goal contracts.
   * Single entry point — replaces SpecAgent.initial() + GoalAgent.initial().
   */
  export async function decompose(input: {
    title: string
    request: string
    /** Base64 image attachments — injected as vision content alongside the request text. */
    attachments?: Array<{ mime: string; data: string; filename?: string }>
    taskID?: string
    sessionID?: string
    signal?: AbortSignal
    stream?: TextHooks
    onStatus?: (summary: string) => void | Promise<void>
    /** Optional Decision Log — seeded with foundational decisions. */
    decisionLog?: DecisionLog
    /** Optional re-decompose context for retry after failure. */
    redecomposeContext?: RedecomposeContext
  }): Promise<DecomposeResult> {
    return run(input)
  }
}

// ---------------------------------------------------------------------------
// Internal implementation
// ---------------------------------------------------------------------------

async function run(input: {
  title: string
  request: string
  attachments?: Array<{ mime: string; data: string; filename?: string }>
  taskID?: string
  sessionID?: string
  signal?: AbortSignal
  stream?: TextHooks
  onStatus?: (summary: string) => void | Promise<void>
  decisionLog?: DecisionLog
  redecomposeContext?: RedecomposeContext
}): Promise<DecomposeResult> {
  if (input.signal?.aborted) throw new Error("decompose agent aborted before model resolution")

  const orchCfg = await OrchestratorConfig.get()
  const {
    max_steps: MAX_STEPS,
    timeout_ms: TIMEOUT_MS,
    quality_threshold: QUALITY_RETRY_THRESHOLD,
    max_attempts: MAX_ATTEMPTS,
  } = orchCfg.decompose

  const def = await Provider.defaultModel().catch(() => undefined)
  if (!def) throw new Error("no LLM model available for decompose agent")
  const model = await Provider.getModel(def.providerID, def.modelID)

  if (input.signal?.aborted) throw new Error("decompose agent aborted after model resolution")

  // Extract working directory from request
  const cwdMatch =
    input.request.match(/(?:绝对路径|absolute path)[：:\s]*([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i) ??
    input.request.match(/(?:工作目录|working dir(?:ectory)?)[^\n]*?([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i)
  const taskWorkDir = cwdMatch ? cwdMatch[1].replace(/[/\\]+$/, "") : undefined

  // Merge planner tools (codebase exploration) + structured output tools (goal registration).
  // Each registration tool call is small (~500 bytes) — no buffering risk.
  const plannerTools = createPlannerTools(taskWorkDir, input.sessionID)
  const outputToolKit = createDecomposeOutputTools(taskWorkDir)
  const guard = toolGuard({ ...plannerTools, ...outputToolKit.tools })

  if (input.signal?.aborted) throw new Error("decompose agent aborted before context prefetch")

  const context = prefetchContext(input.title, input.request)

  let lastParsed: DecomposeOutput | undefined
  let lastQuality: { score: number; reasons: string[] } | undefined

  const systemPrompt = await decomposeSystem()
  const initialPrompt = buildUserPrompt(input, context)
  const initialContent = buildMultimodalContent(initialPrompt, input.attachments)
  let messages: any[] = [{ role: "user" as const, content: initialContent }]
  let cumulativeToolCalls = 0

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (input.signal?.aborted) throw new Error("decompose agent aborted before attempt " + (attempt + 1))

    await input.onStatus?.(`Decompose agent attempt ${attempt + 1}/${MAX_ATTEMPTS}`)

    if (attempt > 0 && lastQuality) {
      messages.push({
        role: "user" as const,
        content: buildRetryMessage(lastQuality, QUALITY_RETRY_THRESHOLD, attempt),
      })
    }

    log.info("decompose agent starting", {
      title: input.title,
      model: model.id,
      attempt: attempt + 1,
      retryReason: attempt > 0 && lastQuality ? `score ${lastQuality.score} < ${QUALITY_RETRY_THRESHOLD}` : undefined,
    })

    const stallController = new AbortController()
    const stallGuard = createInactivityGuard(TIMEOUT_MS, () => {
      log.warn("decompose agent stall timeout", { taskID: input.taskID })
      stallController.abort(new Error("stall timeout"))
    })
    const abortSignals: AbortSignal[] = [stallController.signal, guard.signal]
    if (input.signal) abortSignals.push(input.signal)

    const stream = await ProviderLLM.stream({
      model,
      stopWhen: stepCountIs(MAX_STEPS),
      tools: guard.tools,
      abortSignal: AbortSignal.any(abortSignals),
      system: systemPrompt,
      messages,
      cacheKey: input.taskID ? `task-${input.taskID}-decompose` : undefined,
      onChunk: async (arg: any) => {
        stallGuard.bump()
        if (input.stream?.onChunk) await (input.stream.onChunk as any)(arg)
      },
      ...(input.stream?.onError ? { onError: input.stream.onError } : {}),
      onStepFinish: guard.onStepFinish as any,
    })

    let resultText: string, resultSteps: any[], resultFinishReason: any
    try {
      ;[resultText, resultSteps, resultFinishReason] = await Promise.all([
        stream.text,
        stream.steps,
        stream.finishReason,
      ])
    } finally {
      stallGuard.clear()
    }

    const toolCallCount = resultSteps.reduce(
      (sum, s) => sum + (Array.isArray((s as any).toolCalls) ? (s as any).toolCalls.length : 0),
      0,
    )
    cumulativeToolCalls += toolCallCount

    let allText = resultText?.trim() || ""
    if (!allText) {
      allText = resultSteps.map((s) => s.text).filter(Boolean).join("\n")
    }

    log.info("decompose agent finished", {
      steps: resultSteps.length,
      finishReason: resultFinishReason,
      textLength: allText.length,
      toolCalls: toolCallCount,
      cumulativeToolCalls,
      attempt: attempt + 1,
    })

    AgentTrace.capture("decompose", attempt + 1,
      { system: systemPrompt, messages: messages.map((m: any) => ({ role: m.role, content: typeof m.content === "string" ? m.content : JSON.stringify(m.content) })) },
      allText,
      { model: model.id, toolCalls: cumulativeToolCalls, finishReason: resultFinishReason },
    )

    // Structured tool-call output is the only supported path. If the LLM did
    // not register any goals via register_goal, treat this attempt as a hard
    // failure — no text-parsing fallback (see CLAUDE.md "no fallback" rule).
    const collector = outputToolKit.getCollector()
    if (collector.goals.length === 0) {
      log.warn("decompose agent: no goals registered via tool calls", {
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
    log.info("decompose agent: using structured output", {
      goals: parsed.goals.length,
      requirements: parsed.requirements.length,
      decisions: parsed.decisions.length,
    })
    lastParsed = parsed

    const quality = validateQuality(parsed, cumulativeToolCalls)
    lastQuality = quality

    log.info("decompose agent output", {
      goals: parsed.goals.length,
      decisions: parsed.decisions.length,
      toolCalls: cumulativeToolCalls,
      quality,
      attempt: attempt + 1,
    })

    if (quality.score >= QUALITY_RETRY_THRESHOLD || attempt >= MAX_ATTEMPTS - 1) {
      const result = toResult(parsed, allText)

      // Seed Decision Log with foundational decisions
      if (input.decisionLog && result.decisions.length > 0) {
        for (const decision of result.decisions) {
          input.decisionLog.append({
            phase: "decompose",
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

    log.warn("decompose: quality below threshold, retrying", {
      score: quality.score,
      threshold: QUALITY_RETRY_THRESHOLD,
      reasons: quality.reasons,
    })
  }

  if (!lastParsed) throw new Error("Decompose agent produced no output after all attempts")
  return toResult(lastParsed, "")
}

// ---------------------------------------------------------------------------
// Convert parsed output to DecomposeResult
// ---------------------------------------------------------------------------

function toResult(parsed: DecomposeOutput, rawText?: string): DecomposeResult {
  const goals = parsed.goals.map(goalToContract)
  // Generate recommended_next from LLM output or default heuristic
  let recommendedNext: RecommendedNext[] = []
  if (rawText) {
    recommendedNext = parseRecommendedNext(rawText)
  }
  // Default recommendation: multi-goal → architect, single-goal → create_run + submit_execution
  // (per-goal planning happens automatically inside the execution engine, not as a Task Agent step)
  if (recommendedNext.length === 0 && goals.length > 1) {
    recommendedNext.push({
      agent: "architect",
      reason: `${goals.length} goals with cross-dependencies — architect coordination recommended`,
      confidence: 0.9,
      priority: "required",
    })
  } else if (recommendedNext.length === 0 && goals.length === 1) {
    recommendedNext.push({
      agent: "create_run",
      reason: "Single goal — create run then submit_execution (planning happens automatically inside execution)",
      confidence: 0.9,
      priority: "required",
    })
  }
  return {
    summary: parsed.summary || "Task decomposition",
    requirements: parsed.requirements,
    goals,
    decisions: parsed.decisions,
    traceability: parsed.traceability,
    recommendedNext,
  }
}

// ---------------------------------------------------------------------------
// Convert structured collector → DecomposeOutput (same shape as text parsing)
// ---------------------------------------------------------------------------

function collectorToOutput(collector: DecomposeCollector): DecomposeOutput {
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
      done_definition: g.done_definition,
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
    done_definition: g.done_definition,
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
 * Build an AI SDK content array from text + optional image attachments.
 * When no attachments are present, returns the plain string (more efficient).
 * When attachments exist, returns a content array with text + file parts.
 *
 * AI SDK FilePart: { type: "file", data: base64string, mediaType, filename? }
 */
function buildMultimodalContent(
  text: string,
  attachments?: Array<{ mime: string; data: string; filename?: string }>,
) {
  if (!attachments?.length) return text
  return [
    { type: "text" as const, text },
    ...attachments.map((a) => ({
      type: "file" as const,
      data: a.data,
      mediaType: a.mime,
      ...(a.filename ? { filename: a.filename } : {}),
    })),
  ]
}

// ---------------------------------------------------------------------------
// User prompt
// ---------------------------------------------------------------------------

function buildUserPrompt(
  input: {
    title: string
    request: string
    taskID?: string
    redecomposeContext?: RedecomposeContext
  },
  context: string,
): string {
  const sections = [`# Task\n\nTitle: ${input.title}\n\nRequest:\n${input.request}`]

  if (input.taskID) {
    const notes = operatorNotesSection(input.taskID)
    if (notes) sections.push(notes)
  }

  if (context) {
    sections.push(`# Project Context (Pre-fetched)\n\n${context}`)
  }

  if (input.redecomposeContext) {
    const ctx = input.redecomposeContext
    sections.push(
      [
        "# Redecomposition Context",
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
    "# QUALITY RETRY — Previous Decomposition Was Insufficient",
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
  parsed: DecomposeOutput,
  toolCallCount: number,
): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []

  // Requirement extraction (0.15) — did the agent parse the input exhaustively?
  if (parsed.requirements.length >= 3) score += 0.15
  else if (parsed.requirements.length >= 1) score += 0.07
  else reasons.push("No requirements extracted from user input — decompose must parse input line by line")

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

  // Goal count (0.05)
  if (parsed.goals.length >= 1) score += 0.05
  else reasons.push("No goals produced")

  // Owned paths (0.15)
  const withPaths = parsed.goals.filter((g) => g.owned_paths.length > 0).length
  if (withPaths === parsed.goals.length && parsed.goals.length > 0) score += 0.15
  else if (withPaths > 0) { score += 0.07; reasons.push(`${parsed.goals.length - withPaths} goal(s) missing owned_paths`) }
  else if (parsed.goals.length > 0) reasons.push("No goals have owned_paths")

  // Done definitions (0.15)
  const withDone = parsed.goals.filter((g) => g.done_definition.length > 10).length
  if (withDone === parsed.goals.length && parsed.goals.length > 0) score += 0.15
  else if (withDone > 0) { score += 0.07; reasons.push(`${parsed.goals.length - withDone} goal(s) missing done_definition`) }
  else if (parsed.goals.length > 0) reasons.push("No goals have done_definition")

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

export const DECOMPOSE_SYSTEM = DECOMPOSE_CORE

async function decomposeSystem(): Promise<string> {
  const config = await Config.get()
  const systemOverride = (config as Record<string, unknown>).prompt as Record<string, unknown> | undefined
  if (typeof systemOverride?.decompose_system === "string") return systemOverride.decompose_system
  const agentPrompt = (config.agent as Record<string, any> | undefined)?.decompose?.prompt
  const core = typeof agentPrompt === "string" ? agentPrompt : DECOMPOSE_CORE
  const orchCfg = await OrchestratorConfig.get()
  const skills = await loadStageSkills(orchCfg.decompose.skills, "decompose")
  return core + skills
}
