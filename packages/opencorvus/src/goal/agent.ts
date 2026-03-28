/**
 * HeadlessGoalAgent — the orchestrator-owned goal decomposition stage that
 * transforms spec requirements into executable implementation goal contracts.
 *
 * Positioned as a first-class agent alongside SpecAgent and PlannerAgent:
 * 1. Memory recall — searches project memory for prior decompositions, patterns
 * 2. Preference awareness — respects project conventions and constraints
 * 3. Codebase exploration — reads files, searches code, discovers module structure
 * 4. Web research — when requirements involve unfamiliar technology
 * 5. Structured output — GoalDraft with coverage-validated goal contracts
 * 6. Iterative quality gate — retries until all spec requirements are covered
 */
import { streamText, stepCountIs } from "ai"
import type { TextHooks } from "@/llm/api"
import z from "zod"
import { Provider } from "@/provider/provider"
import { createPlannerTools, prefetchContext } from "@/planner/tools"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { toolGuard } from "@/util/tool-guard"
import { parseGoalText, type ParsedGoalDraft } from "./parse-goal-text"
import { OrchestratorConfig } from "@/orchestrator/config"
import { loadStageSkills } from "@/orchestrator/skill-inject"
import { Config } from "@/config/config"
import type { SpecDraft } from "@/spec/agent"
import type { GoalDraft } from "./service"

import GOAL_CORE from "@/prompt/core/goal-core.txt"

const log = Log.create({ service: "goal-agent" })

// ---------------------------------------------------------------------------
// Replan context — structured failure information for goal re-decomposition
// ---------------------------------------------------------------------------

export interface GoalRedecomposeContext {
  previousGoals: Array<{
    description: string
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
// HeadlessGoalAgent
// ---------------------------------------------------------------------------

const { goal: GOAL_DEFAULTS } = OrchestratorConfig.defaults

export namespace HeadlessGoalAgent {
  /**
   * Generate initial goal decomposition from spec requirements.
   * Explores the codebase to ground goals in real file paths.
   */
  export async function initial(input: {
    title: string
    request: string
    spec: SpecDraft
    goalHints?: Array<{ description: string; criteria: string; priority?: string }>
    sessionID?: string
    signal?: AbortSignal
    stream?: TextHooks
    onStatus?: (summary: string) => void | Promise<void>
  }): Promise<GoalDraft> {
    return run({ ...input, mode: "initial" })
  }

  /**
   * Recompile goals after a failed execution.
   * Receives failure analysis and restructures goals accordingly.
   */
  export async function recompile(input: {
    title: string
    request: string
    spec: SpecDraft
    redecomposeContext?: GoalRedecomposeContext
    goalHints?: Array<{ description: string; criteria: string; priority?: string }>
    sessionID?: string
    signal?: AbortSignal
    stream?: TextHooks
    onStatus?: (summary: string) => void | Promise<void>
  }): Promise<GoalDraft> {
    return run({ ...input, mode: "recompile" })
  }
}

export { HeadlessGoalAgent as GoalAgent }

// ---------------------------------------------------------------------------
// Internal implementation
// ---------------------------------------------------------------------------

async function run(input: {
  title: string
  request: string
  spec: SpecDraft
  mode: "initial" | "recompile"
  goalHints?: Array<{ description: string; criteria: string; priority?: string }>
  redecomposeContext?: GoalRedecomposeContext
  sessionID?: string
  signal?: AbortSignal
  stream?: TextHooks
  onStatus?: (summary: string) => void | Promise<void>
}): Promise<GoalDraft> {
  if (input.signal?.aborted) throw new Error("goal agent aborted before model resolution")

  const orchCfg = await OrchestratorConfig.get()
  const {
    max_steps: MAX_STEPS,
    timeout_ms: TIMEOUT_MS,
    quality_threshold: QUALITY_RETRY_THRESHOLD,
    max_attempts: MAX_GOAL_ATTEMPTS,
  } = orchCfg.goal

  const def = await Provider.defaultModel().catch(() => undefined)
  if (!def) throw new Error("no LLM model available for goal agent")
  const model = await Provider.getModel(def.providerID, def.modelID)
  const language = await Provider.getLanguage(model)

  if (input.signal?.aborted) throw new Error("goal agent aborted after model resolution")

  // Extract working directory from request
  const cwdMatch =
    input.request.match(/(?:绝对路径|absolute path)[：:\s]*([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i) ??
    input.request.match(/(?:工作目录|working dir(?:ectory)?)[^\n]*?([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i)
  const taskWorkDir = cwdMatch ? cwdMatch[1].replace(/[/\\]+$/, "") : undefined

  const guard = toolGuard(createPlannerTools(taskWorkDir, input.sessionID))

  if (input.signal?.aborted) throw new Error("goal agent aborted before context prefetch")

  const context = prefetchContext(input.title, input.request)

  // Collect requirement IDs for post-hoc coverage logging
  const specRequirementIds = new Set(
    (input.spec.requirements ?? []).map((r: any) => typeof r === "object" && r?.id ? String(r.id) : "").filter(Boolean),
  )

  let lastParsed: ParsedGoalDraft | undefined
  let lastQuality: { score: number; reasons: string[] } | undefined

  for (let attempt = 0; attempt < MAX_GOAL_ATTEMPTS; attempt++) {
    if (input.signal?.aborted) throw new Error("goal agent aborted before attempt " + (attempt + 1))

    await input.onStatus?.(`Goal agent attempt ${attempt + 1}/${MAX_GOAL_ATTEMPTS}`)

    const retryContext = attempt > 0 && lastQuality
      ? { previousScore: lastQuality.score, reasons: lastQuality.reasons, attempt }
      : undefined
    const userPrompt = buildUserPrompt(input, context, retryContext, QUALITY_RETRY_THRESHOLD)

    log.info("goal agent starting", {
      title: input.title,
      mode: input.mode,
      model: language.modelId,
      attempt: attempt + 1,
      requirementCount: specRequirementIds.size,
      retryReason: retryContext ? `score ${retryContext.previousScore} < ${QUALITY_RETRY_THRESHOLD}` : undefined,
    })

    const baseSignal = input.signal ?? AbortSignal.timeout(TIMEOUT_MS)
    const stream = streamText({
      model: language,
      stopWhen: stepCountIs(MAX_STEPS),
      tools: guard.tools,
      maxOutputTokens: 32768,
      abortSignal: AbortSignal.any([baseSignal, guard.signal]),
      system: await goalSystem(),
      prompt: userPrompt,
      ...(input.stream?.onChunk ? { onChunk: input.stream.onChunk as any } : {}),
      ...(input.stream?.onError ? { onError: input.stream.onError } : {}),
      onStepFinish: guard.onStepFinish as any,
    })

    const [resultText, resultSteps, resultFinishReason] = await Promise.all([
      stream.text,
      stream.steps,
      stream.finishReason,
    ])

    const toolCallCount = resultSteps.reduce(
      (sum, s) => sum + (Array.isArray((s as any).toolCalls) ? (s as any).toolCalls.length : 0),
      0,
    )

    let allText = resultText?.trim() || ""
    if (!allText) {
      allText = resultSteps.map((s) => s.text).filter(Boolean).join("\n")
    }

    log.info("goal agent finished", {
      steps: resultSteps.length,
      finishReason: resultFinishReason,
      textLength: allText.length,
      toolCalls: toolCallCount,
      attempt: attempt + 1,
    })

    const parsed = parseGoalText(allText)
    lastParsed = parsed

    // Coverage is logged for observability but the agent's two-phase process
    // (Step 1: map requirements → explicit goals, Step 2: fill implicit goals)
    // is the primary mechanism — not a programmatic retry gate.
    const coveredIds = new Set(parsed.goals.flatMap((g) => g.requirement_ids))
    const uncoveredIds = [...specRequirementIds].filter((id) => !coveredIds.has(id))
    const explicitCount = parsed.goals.filter((g) => g.source === "explicit").length
    const implicitCount = parsed.goals.filter((g) => g.source === "implicit").length

    const goalQuality = validateGoalQuality(parsed, specRequirementIds, toolCallCount)
    lastQuality = goalQuality

    log.info("goal agent output", {
      goals: parsed.goals.length,
      explicit: explicitCount,
      implicit: implicitCount,
      toolCalls: toolCallCount,
      uncoveredRequirements: uncoveredIds.length > 0 ? uncoveredIds : undefined,
      quality: goalQuality,
      attempt: attempt + 1,
    })

    if (goalQuality.score >= QUALITY_RETRY_THRESHOLD || attempt >= MAX_GOAL_ATTEMPTS - 1) {
      if (uncoveredIds.length > 0) {
        log.warn("goal agent: some requirements not covered", { uncoveredIds })
      }
      return toDraft(parsed)
    }

    log.warn("goal agent: quality below threshold, retrying", {
      score: goalQuality.score,
      threshold: QUALITY_RETRY_THRESHOLD,
      reasons: goalQuality.reasons,
    })
  }

  if (!lastParsed) throw new Error("Goal agent produced no output after all attempts")
  return toDraft(lastParsed)
}

// ---------------------------------------------------------------------------
// Convert ParsedGoalDraft to GoalDraft (matching existing schema)
// ---------------------------------------------------------------------------

function toDraft(parsed: ParsedGoalDraft): GoalDraft {
  return {
    summary: parsed.summary || "Goal decomposition",
    goals: parsed.goals.map((g) => {
      return {
        id: g.id,
        title: g.title,
        objective: g.objective,
        requirement_ids: g.requirement_ids,
        depends_on_goal_ids: g.depends_on_goal_ids,
        owned_paths: g.owned_paths,
        done_definition: g.done_definition,
        qa_profile: g.qa_profile,
        priority: g.priority,
        kind: g.kind as any,
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// User prompt building
// ---------------------------------------------------------------------------

function buildUserPrompt(
  input: {
    title: string
    request: string
    spec: SpecDraft
    mode: "initial" | "recompile"
    goalHints?: Array<{ description: string; criteria: string; priority?: string }>
    redecomposeContext?: GoalRedecomposeContext
  },
  context: string,
  retryContext?: { previousScore: number; reasons: string[]; attempt: number },
  qualityThreshold = GOAL_DEFAULTS.quality_threshold,
): string {
  const sections = [`# Task\n\nTitle: ${input.title}\n\nRequest:\n${input.request}`]

  // Include spec requirements
  const requirements = input.spec.requirements ?? []
  if (requirements.length > 0) {
    const reqLines = requirements.map((r: any) => {
      const id = r.id || "?"
      const title = r.title || ""
      const desc = r.description || ""
      const acceptance = Array.isArray(r.acceptance) ? r.acceptance.join("; ") : ""
      const priority = r.priority || "blocking"
      const selectors = Array.isArray(r.check_selector) ? r.check_selector.join(", ")
        : Array.isArray(r.metadata?.check_selector) ? r.metadata.check_selector.join(", ") : ""
      return [
        `- **${id}**: ${title} [${priority}]`,
        desc ? `  Description: ${desc}` : "",
        acceptance ? `  Acceptance: ${acceptance}` : "",
        selectors ? `  Check selectors: ${selectors}` : "",
      ].filter(Boolean).join("\n")
    })
    sections.push(`# Spec Requirements (${requirements.length} total)\n\nEach requirement MUST be covered by at least one goal.\n\n${reqLines.join("\n\n")}`)
  }

  // Include spec content summary
  if (input.spec.content) {
    const content = input.spec.content.length > 4000
      ? input.spec.content.slice(0, 4000) + "\n... (truncated)"
      : input.spec.content
    sections.push(`# Spec Content\n\n${content}`)
  }

  // Include architectural layers if available
  if (Array.isArray(input.spec.architectural_layers) && input.spec.architectural_layers.length > 0) {
    const layerLines = input.spec.architectural_layers.map((l: any) =>
      `- **${l.id}**: ${l.name} — ${l.description}${l.kind ? ` [${l.kind}]` : ""}${l.depends_on?.length ? ` (depends on: ${l.depends_on.join(", ")})` : ""}`,
    )
    sections.push(`# Architectural Layers\n\nUse these as a guide for goal organization:\n\n${layerLines.join("\n")}`)
  }

  if (retryContext) {
    sections.push(
      [
        "# QUALITY RETRY — Previous Goals Were Insufficient",
        "",
        `Score: ${retryContext.previousScore.toFixed(2)} / ${qualityThreshold}. Attempt ${retryContext.attempt + 1}.`,
        "",
        "**Issues:**",
        ...retryContext.reasons.map((r) => `- ${r}`),
        "",
        "Fix all issues. Use tools to explore the codebase if you haven't already.",
      ].join("\n"),
    )
  }

  if (input.goalHints && input.goalHints.length > 0) {
    sections.push(
      `# User-Provided Goal Hints\n\nIncorporate these hints into your decomposition:\n\n${input.goalHints
        .map((g, i) => `${i + 1}. [${g.priority ?? "blocking"}] ${g.description}\n   Criteria: ${g.criteria}`)
        .join("\n")}`,
    )
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
        "The previous execution FAILED. You must restructure goals to address the failure.",
        "",
        "## Failure Analysis",
        `Classification: ${ctx.failureAnalysis.classification}`,
        `Summary: ${ctx.failureAnalysis.summary}`,
        `Root Cause: ${ctx.failureAnalysis.rootCause}`,
        `Suggested Strategy: ${ctx.failureAnalysis.suggestedStrategy}`,
        "",
        "## Approaches to AVOID (these already failed)",
        ...ctx.failureAnalysis.avoidApproaches.map((a) => `- ${a}`),
        "",
        "## Previous Goal Results",
        ...ctx.previousGoals.map(
          (g) => `- ${g.description}: **${g.status}** — ${g.evidence}`,
        ),
      ].join("\n"),
    )
  }

  sections.push(
    "Now recall memory, check preferences, explore the codebase thoroughly, " +
    "then output your goal decomposition using section tags as described in your instructions. " +
    "Ensure EVERY spec requirement is covered.",
  )

  return sections.join("\n\n")
}

// ---------------------------------------------------------------------------
// Quality validation
// ---------------------------------------------------------------------------

function validateGoalQuality(
  parsed: ParsedGoalDraft,
  specRequirementIds: Set<string>,
  toolCallCount: number,
): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []

  // Tool usage (0.20)
  if (toolCallCount >= 5) score += 0.20
  else if (toolCallCount >= 2) score += 0.10
  else if (toolCallCount === 0) reasons.push("No tool calls — goals not grounded in codebase")
  else reasons.push(`Only ${toolCallCount} tool call — may be insufficient`)

  // Goal count (0.10)
  if (parsed.goals.length >= 2) score += 0.10
  else if (parsed.goals.length >= 1) score += 0.05
  else reasons.push("No goals produced")

  // Requirement coverage (0.30)
  if (specRequirementIds.size > 0) {
    const coveredIds = new Set(parsed.goals.flatMap((g) => g.requirement_ids))
    const uncovered = [...specRequirementIds].filter((id) => !coveredIds.has(id))
    const ratio = 1 - uncovered.length / specRequirementIds.size
    score += 0.30 * ratio
    if (uncovered.length > 0) {
      reasons.push(`${uncovered.length} requirement(s) not covered: ${uncovered.slice(0, 5).join(", ")}`)
    }
  } else {
    score += 0.15
  }

  // Owned paths (0.20)
  const withPaths = parsed.goals.filter((g) => g.owned_paths.length > 0).length
  if (withPaths === parsed.goals.length && parsed.goals.length > 0) score += 0.20
  else if (withPaths > 0) { score += 0.10; reasons.push(`${parsed.goals.length - withPaths} goal(s) missing owned_paths`) }
  else if (parsed.goals.length > 0) reasons.push("No goals have owned_paths")

  // Done definitions (0.20)
  const withDone = parsed.goals.filter((g) => g.done_definition && g.done_definition.length > 10).length
  if (withDone === parsed.goals.length && parsed.goals.length > 0) score += 0.20
  else if (withDone > 0) { score += 0.10; reasons.push(`${parsed.goals.length - withDone} goal(s) missing done_definition`) }
  else if (parsed.goals.length > 0) reasons.push("No goals have done_definition")

  return { score: Math.min(score, 1), reasons }
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

/** Full default system prompt. Exported for tests and catalog. */
export const GOAL_SYSTEM = GOAL_CORE

/** Config-aware resolver: checks config.prompt.goal_system first, then config.agent.goal.prompt, otherwise the core prompt + skills. */
export async function goalSystem(): Promise<string> {
  const config = await Config.get()
  const systemOverride = (config as Record<string, unknown>).prompt as Record<string, unknown> | undefined
  if (typeof systemOverride?.goal_system === "string") return systemOverride.goal_system
  const agentPrompt = (config.agent as Record<string, any> | undefined)?.goal?.prompt
  const core = typeof agentPrompt === "string" ? agentPrompt : GOAL_CORE
  const orchCfg = await OrchestratorConfig.get()
  const skills = await loadStageSkills(orchCfg.goal.skills)
  return core + skills
}
