/**
 * Per-goal Planner — creates implementation steps for a single goal.
 *
 * Unlike the old global Planner that planned all goals at once, this runs
 * INSIDE each GoalPipeline, producing plan_node steps scoped to one goal.
 *
 * Observation domain (from SVG spec):
 *   • GoalContract full (objective + acceptance_specs + owned_paths)
 *   • user original input (task.request)
 *   • Decision Log (full)
 *   • predecessor code (HEAD — available in worktree)
 *   • project files (via tools)
 *   • operator notes
 *   • tech stack context (from Decision Log)
 */
import { stepCountIs } from "ai"
import { Provider } from "@/provider/provider"
import { Agent } from "@/agent/agent"
import { createPlannerTools, prefetchContext } from "@/planner/tools"
import { filterAgentTools } from "@/agent/filter-tools"
import { toolGuard } from "@/util/tool-guard"
import { Log } from "@/util/log"
import { AgentRuntime } from "@/agent/runtime"
import { resolveAgentModel } from "@/agent/model"
import { EngineConfig, clarificationTranscriptSection, operatorNotesSection } from "@/engine"
import { extractTag } from "@/util/parse-section-tags"
import type { TextHooks } from "@/llm/api"
import { renderSpecsAsText } from "@/acceptance/types"
import { renderVisualContractPromptSection } from "@/design-analyst/prompt-section"
import type { VisualSpec } from "@/design-analyst/types"
import type { GoalContract } from "@/pipeline/types"
import type { DecisionLog } from "@/decision-log"
import PLANNER_CORE from "@/prompt/core/planner-core.txt"

const log = Log.create({ service: "pipeline-planner" })
const ARCHITECT_CONTRACT_VALUE_CAP = 4_000

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
/**
 * Run the per-goal planner.
 *
 * CONTRACT: the caller MUST have written the intent bundle at
 * `workDir/.opencorvus/intent/` before invoking this. The produced
 * plan_steps are consumed by an executor which reads that bundle
 * as its authoritative copy of the user's request. The planner's
 * system prompt advertises the bundle unconditionally — if the
 * caller has not mounted it, the downstream executor will fail
 * to resolve the path, which is the correct loud failure mode.
 * Do not add a conditional to suppress the bundle reference.
 */
export async function planGoal(input: {
  contract: GoalContract
  decisionLog?: DecisionLog
  designSpecs?: VisualSpec[]
  workDir?: string
  sessionID?: string
  signal?: AbortSignal
  stream?: TextHooks
}): Promise<PlanSteps> {
  const { contract, signal } = input
  const { goal, task } = contract

  if (signal?.aborted) throw new Error("planner aborted")

  const orchCfg = await EngineConfig.get()
  const planCfg = orchCfg.planner
  const MAX_STEPS = planCfg.max_steps
  const TIMEOUT_MS = planCfg.timeout_ms

  // Resolve model — per-agent model from Agent.Info (config: agent.planner.model),
  // falling back to the user's most recent in-session model pick when no per-agent
  // override is configured.
  const model = await resolveAgentModel("planner", { taskID: task.id })

  const guard = toolGuard(await filterAgentTools(createPlannerTools(input.workDir), "planner"))
  const context = prefetchContext(task.title, task.request)

  // Build Decision Log section — goal-scoped reads only. The full task log
  // (toPromptSection) was previously injected wholesale into every per-goal
  // planner, so each planner's prompt grew O(N goals × M decisions). We now
  // include only entries that are task-scoped (no goalID) or attached to
  // THIS goal — peer goals' local notes belong in their own planner runs.
  let decisionSection = ""
  let architectSection = ""
  if (input.decisionLog) {
    decisionSection = input.decisionLog.phasePromptSectionForGoal("requirements", contract.goal.id, "Decisions (relevant to this goal)")
    architectSection = input.decisionLog.phasePromptSectionForGoal(
      "architect",
      contract.goal.id,
      "Architect Consensus",
      { valueCap: ARCHITECT_CONTRACT_VALUE_CAP },
    )
  }

  const systemPrompt = await buildPlannerSystem()
  const userPrompt = buildPlannerPrompt(contract, context, decisionSection, task.request, architectSection, input.designSpecs)

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
    onStepFinish: guard.onStepFinish,
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

/**
 * System prompt for the per-goal planner.
 *
 * Assumes the caller has mounted the intent bundle before dispatching
 * the downstream executor (see `planGoal` contract). The prompt
 * advertises the bundle unconditionally — it is the only supported
 * production mode.
 */
export async function buildPlannerSystem(): Promise<string> {
  // Agent.get returns undefined for unconfigured agents — absence is not an
  // error, we fall through to the built-in PLANNER_CORE. Any other failure
  // (e.g. config load threw) propagates.
  const agent = await Agent.get("planner")
  const agentPrompt = agent?.prompt
  return typeof agentPrompt === "string" ? agentPrompt : PLANNER_CORE
}

export function buildPlannerPrompt(
  contract: GoalContract,
  context: string,
  decisionSection: string,
  taskRequest: string,
  architectSection?: string,
  designSpecs?: VisualSpec[],
): string {
  const { goal, dependencies } = contract
  const sections: string[] = []

  sections.push(`# Goal Contract\n\n**${goal.title}**\n\nObjective: ${goal.objective}\n\nAcceptance Specs:\n${renderSpecsAsText(goal.acceptance_specs ?? [])}`)

  if (goal.owned_paths.length > 0) {
    sections.push(`## Owned Paths (EXCLUSIVE write access)\n\n${goal.owned_paths.map(p => `- ${p}`).join("\n")}`)
  }

  if (dependencies.length > 0) {
    // Dependencies surface only their declared interfaces, not their full
    // objective. The objective is the dependency's own implementation
    // directive; the planner only needs to know what the dependency exports
    // to its consumers. Legitimate no-export goals (kind: verification /
    // system) are listed by title with an explicit no-interface note.
    const deps = dependencies.map((g) => {
      if (g.exports?.length) {
        return `- **${g.title}** — exports: ${g.exports.join(", ")}`
      }
      return `- **${g.title}** — (kind: ${g.kind}; no exported interfaces)`
    })
    sections.push(`## Dependencies (completed before this goal)\n\n${deps.join("\n")}`)
  }

  if (goal.imports?.length) {
    sections.push(`## Imports (from dependencies)\n\n${goal.imports.map(i => `- ${i}`).join("\n")}`)
  }

  if (goal.exports?.length) {
    sections.push(`## Exports (this goal must provide)\n\n${goal.exports.map(e => `- ${e}`).join("\n")}`)
  }

  sections.push(`## Task Context\n\n${taskRequest}`)

  if (designSpecs && designSpecs.length > 0) {
    sections.push(renderVisualContractPromptSection({
      specs: designSpecs,
      instructions: [
        "The following advisory visual constraints came from design_analysis.",
        "Use them when planning UI, layout, responsive, and interaction work relevant to this goal.",
      ],
    }))
  }

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

  const clarifications = clarificationTranscriptSection(contract.task.id)
  if (clarifications) sections.push(clarifications)
  const notes = operatorNotesSection(contract.task.id)
  if (notes) sections.push(notes)

  sections.push("Now explore the codebase, then output your implementation plan using <plan_title> and <plan_steps> tags.")

  return sections.join("\n\n")
}
