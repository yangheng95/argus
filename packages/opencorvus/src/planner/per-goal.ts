/**
 * Per-goal Planner — creates implementation steps for a single goal.
 *
 * Unlike the old global Planner that planned all goals at once, this runs
 * INSIDE each GoalPipeline, producing plan_node steps scoped to one goal.
 *
 * Observation domain (from SVG spec):
 *   • GoalContract full (objective + done_definition + owned_paths)
 *   • user original input (task.request)
 *   • Decision Log (full)
 *   • predecessor code (HEAD — available in worktree)
 *   • project files (via tools)
 *   • operator notes
 *   • tech stack context (from Decision Log)
 */
import { stepCountIs } from "ai"
import { Provider } from "@/provider/provider"
import { createPlannerTools, prefetchContext } from "@/planner/tools"
import { toolGuard } from "@/util/tool-guard"
import { Log } from "@/util/log"
import { AgentRuntime } from "@/agent/runtime"
import { OrchestratorConfig } from "@/orchestrator/config"
import { operatorNotesSection } from "@/orchestrator/helpers"
import { extractTag } from "@/util/parse-section-tags"
import type { TextHooks } from "@/llm/api"
import type { GoalContract } from "@/pipeline/types"
import type { DecisionLog } from "@/decision-log"

import PLAN_CORE from "@/prompt/core/plan-core.txt"

const log = Log.create({ service: "pipeline-planner" })

export interface PlanSteps {
  title: string
  brief: string
}

/**
 * Run the per-goal planner. Returns implementation steps for a single goal.
 *
 * This is a lightweight wrapper — not the full PlannerService. It focuses
 * on producing actionable steps for the executor, scoped to one goal's
 * owned_paths and objective.
 */
export async function planGoal(input: {
  contract: GoalContract
  decisionLog?: DecisionLog
  workDir?: string
  sessionID?: string
  signal?: AbortSignal
  stream?: TextHooks
}): Promise<PlanSteps> {
  const { contract, signal } = input
  const { goal, task } = contract

  if (signal?.aborted) throw new Error("planner aborted")

  const orchCfg = await OrchestratorConfig.get()
  const planCfg = orchCfg.planner
  const MAX_STEPS = planCfg.max_steps
  const TIMEOUT_MS = planCfg.timeout_ms

  const def = await Provider.defaultModel().catch(() => undefined)
  if (!def) throw new Error("no LLM model available for per-goal planner")
  const model = await Provider.getModel(def.providerID, def.modelID)

  const guard = toolGuard(createPlannerTools(input.workDir, input.sessionID))
  const context = prefetchContext(task.title, task.request)

  // Build Decision Log section — architect consensus gets its own prominent section
  let decisionSection = ""
  let architectSection = ""
  if (input.decisionLog) {
    decisionSection = input.decisionLog.toPromptSection()
    architectSection = input.decisionLog.phasePromptSection("architect", "Architect Consensus")
  }

  const systemPrompt = buildPlannerSystem()
  const userPrompt = buildPlannerPrompt(contract, context, decisionSection, task.request, architectSection)

  const abortSignals: AbortSignal[] = [guard.signal]
  if (signal) abortSignals.push(signal)

  const passthroughHooks = {
    onChunk: input.stream?.onChunk,
    onError: input.stream?.onError,
    flush: async () => {},
    failures: { snapshot: () => ({ count: 0, items: [] as any[] }) },
  } as any
  const runResult = await AgentRuntime.run({
    agent: "planner",
    model,
    system: systemPrompt,
    messages: [{ role: "user" as const, content: userPrompt }],
    tools: guard.tools,
    stopWhen: stepCountIs(MAX_STEPS),
    cacheKey: `task-${task.id}-planner`,
    sessionID: "",
    taskID: task.id,
    stage: "planner",
    signal: AbortSignal.any(abortSignals),
    onStepFinish: guard.onStepFinish as any,
    hooks: passthroughHooks,
    policies: {
      progressTimeoutMs: TIMEOUT_MS,
      failurePolicy: "collect",
    },
  })
  const resultText = runResult.text
  const resultSteps = runResult.steps
  const toolCallCount = runResult.toolCallCount

  let allText = resultText?.trim() || ""
  if (!allText) {
    allText = resultSteps.map((s) => s.text).filter(Boolean).join("\n")
  }

  log.info("per-goal planner finished", {
    goalID: goal.id,
    textLength: allText.length,
    toolCalls: toolCallCount,
  })

  // Parse output — extract plan section or use full text
  const planBrief = extractTag(allText, "plan_steps") || extractTag(allText, "plan") || extractTag(allText, "steps") || allText
  const planTitle = extractTag(allText, "plan_title") || extractTag(allText, "title") || goal.title

  return {
    title: planTitle,
    brief: planBrief,
  }
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildPlannerSystem(): string {
  return [
    "You are a per-goal implementation planner for OpenCorvus.",
    "You receive a single GoalContract and must produce concrete implementation steps.",
    "",
    "Your steps will be executed by an autonomous coding agent in an isolated git worktree.",
    "The executor can ONLY write to the files listed in owned_paths.",
    "",
    "Rules:",
    "- EXPLORE the codebase first to understand current state",
    "- Reference specific file paths, function names, and types",
    "- Steps must be concrete and actionable (not vague)",
    "- Each step should be independently verifiable",
    "- Consider the done_definition — your steps must lead to it being satisfied",
    "- If the Decision Log has tech stack decisions, respect them",
    "",
    "Output format:",
    "<plan_title>Short plan title</plan_title>",
    "<plan_steps>",
    "Step-by-step implementation plan...",
    "</plan_steps>",
  ].join("\n")
}

function buildPlannerPrompt(
  contract: GoalContract,
  context: string,
  decisionSection: string,
  taskRequest: string,
  architectSection?: string,
): string {
  const { goal, allGoals } = contract
  const sections: string[] = []

  sections.push(`# Goal Contract\n\n**${goal.title}**\n\nObjective: ${goal.objective}\n\nDone Definition: ${goal.done_definition}`)

  if (goal.owned_paths.length > 0) {
    sections.push(`## Owned Paths (EXCLUSIVE write access)\n\n${goal.owned_paths.map(p => `- ${p}`).join("\n")}`)
  }

  if (goal.depends_on.length > 0) {
    const deps = goal.depends_on
      .map(id => allGoals.find(g => g.id === id))
      .filter(Boolean)
      .map(g => `- **${g!.title}**: ${g!.objective}${g!.exports?.length ? ` (exports: ${g!.exports.join(", ")})` : ""}`)
    if (deps.length > 0) {
      sections.push(`## Dependencies (completed before this goal)\n\n${deps.join("\n")}`)
    }
  }

  if (goal.imports?.length) {
    sections.push(`## Imports (from dependencies)\n\n${goal.imports.map(i => `- ${i}`).join("\n")}`)
  }

  if (goal.exports?.length) {
    sections.push(`## Exports (this goal must provide)\n\n${goal.exports.map(e => `- ${e}`).join("\n")}`)
  }

  sections.push(`## Task Context\n\n${taskRequest}`)

  // Architect consensus (binding contracts) — injected prominently before general decisions
  if (architectSection) {
    sections.push(architectSection)
    sections.push("**IMPORTANT**: The above architect contracts are BINDING. File paths, interface signatures, and export names MUST match exactly.")
  }

  if (decisionSection) {
    sections.push(decisionSection)
  }

  if (context) {
    sections.push(`## Pre-fetched Context\n\n${context}`)
  }

  const notes = operatorNotesSection(contract.task.id)
  if (notes) sections.push(notes)

  sections.push("Now explore the codebase, then output your implementation plan using <plan_title> and <plan_steps> tags.")

  return sections.join("\n\n")
}
