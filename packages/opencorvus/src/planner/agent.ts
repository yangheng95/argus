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
 *
 * Phase 3-b-4 migration (specs/new-arch/16-unified-teardown.md §7-3): runs via
 * SessionPrompt.prompt + extraTools instead of AgentRuntime.run + a private
 * submit_plan tool. The plan arrives through SessionLoop's StructuredOutput
 * (PlannerReportSchema). No incremental tools survive — the planner's output
 * is a single terminal payload.
 */
import z from "zod"
import { Provider } from "@/provider/provider"
import { Agent } from "@/agent/agent"
import { createPlannerTools, prefetchContext } from "@/planner/tools"
import { filterAgentTools } from "@/agent/filter-tools"
import { Log } from "@/util/log"
import { resolveAgentModel } from "@/agent/model"
import { EngineConfig, clarificationTranscriptSection, operatorNotesSection } from "@/engine"
import type { TextHooks } from "@/llm/api"
import { renderSpecsAsText } from "@/acceptance/types"
import { renderVisualContractPromptSection } from "@/design-analyst/prompt-section"
import type { VisualSpec } from "@/design-analyst/types"
import type { GoalContract } from "@/pipeline/types"
import type { DecisionLog } from "@/decision-log"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import type { Message } from "@/session/message"
import { PlannerReportSchema, plannerReportFromStructured } from "./output-tools"
import PLANNER_CORE from "@/prompt/core/planner-core.txt"

const log = Log.create({ service: "pipeline-planner" })
const ARCHITECT_CONTRACT_VALUE_CAP = 4_000

export interface PlanSteps {
  title: string
  brief: string
  file_actions: Array<{ path: string; intent: string }>
  verification_commands: Array<{ command: string; purpose: string }>
}

/**
 * Run the per-goal planner. Returns implementation steps for a single goal.
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
  /** Parent session — a child "planner" session is created under it. */
  parentSessionID?: string
  /** Explicit model override (provider/model). Skips `resolveAgentModel`. */
  model?: { providerID: string; modelID: string }
  signal?: AbortSignal
  /** Legacy passthrough; not wired after the SessionPrompt migration. */
  stream?: TextHooks
}): Promise<PlanSteps> {
  const { contract, signal } = input
  const { goal, task } = contract

  if (signal?.aborted) throw new Error("planner aborted")

  // Resolve model. Test callers may bypass resolveAgentModel with input.model.
  let model: Awaited<ReturnType<typeof resolveAgentModel>> | undefined
  if (input.model) {
    model = await Provider.getModel(input.model.providerID, input.model.modelID).catch(() => undefined)
  } else {
    model = await resolveAgentModel("planner", { taskID: task.id }).catch(() => undefined)
  }
  if (!model) throw new Error("no LLM model available for planner agent")

  const plannerTools = await filterAgentTools(createPlannerTools(input.workDir), "planner")
  const extraTools = { ...plannerTools }
  const enableMap: Record<string, boolean> = Object.fromEntries(
    Object.keys(extraTools).map((name) => [name, true]),
  )

  const context = prefetchContext(task.title, task.request)

  // Build Decision Log section — goal-scoped reads only. The full task log
  // (toPromptSection) was previously injected wholesale into every per-goal
  // planner, so each planner's prompt grew O(N goals × M decisions). We now
  // include only entries that are task-scoped (no goalID) or attached to
  // THIS goal — peer goals' local notes belong in their own planner runs.
  let decisionSection = ""
  let architectSection = ""
  if (input.decisionLog) {
    decisionSection = input.decisionLog.phasePromptSectionForGoal(
      "requirements",
      contract.goal.id,
      "Decisions (relevant to this goal)",
    )
    architectSection = input.decisionLog.phasePromptSectionForGoal(
      "architect",
      contract.goal.id,
      "Architect Consensus",
      { valueCap: ARCHITECT_CONTRACT_VALUE_CAP },
    )
  }

  const systemPrompt = await buildPlannerSystem()
  const userPrompt = buildPlannerPrompt(
    contract,
    context,
    decisionSection,
    task.request,
    architectSection,
    input.designSpecs,
  )

  const childSession = await Session.createNext({
    kind: "planner",
    parentID: input.parentSessionID,
    title: `Planner: ${goal.title}`,
    directory: input.workDir ?? Instance.directory,
  })

  let finalMessage: Message.WithParts | undefined
  await SessionPrompt.withExtraTools(childSession.id, extraTools, async () => {
    finalMessage = (await SessionPrompt.prompt({
      sessionID: childSession.id,
      model: { providerID: model!.providerID, modelID: model!.api.id },
      agent: "planner",
      system: systemPrompt,
      tools: enableMap,
      format: {
        type: "json_schema",
        schema: z.toJSONSchema(PlannerReportSchema) as Record<string, unknown>,
        retryCount: 2,
      },
      parts: [{ type: "text", text: userPrompt }],
    })) as Message.WithParts
  })

  if (signal?.aborted) throw new Error("planner aborted during prompt")
  if (!finalMessage) throw new Error("planner: SessionPrompt.prompt returned no message")

  const structured = (finalMessage.info as Message.Assistant).structured
  const plan = plannerReportFromStructured(structured)

  log.info("per-goal planner finished", {
    goalID: goal.id,
    titleLength: plan.title.length,
    briefLength: plan.brief.length,
    fileActions: plan.file_actions.length,
    verification: plan.verification_commands.length,
  })

  return {
    title: plan.title,
    brief: plan.brief,
    file_actions: plan.file_actions,
    verification_commands: plan.verification_commands,
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

  sections.push(
    `# Goal Contract\n\n**${goal.title}**\n\nObjective: ${goal.objective}\n\nAcceptance Specs:\n${renderSpecsAsText(goal.acceptance_specs ?? [])}`,
  )

  if (goal.owned_paths.length > 0) {
    sections.push(`## Owned Paths (EXCLUSIVE write access)\n\n${goal.owned_paths.map((p) => `- ${p}`).join("\n")}`)
  }

  if (dependencies.length > 0) {
    const deps = dependencies.map((g) => {
      if (g.exports?.length) {
        return `- **${g.title}** — exports: ${g.exports.join(", ")}`
      }
      return `- **${g.title}** — (kind: ${g.kind}; no exported interfaces)`
    })
    sections.push(`## Dependencies (completed before this goal)\n\n${deps.join("\n")}`)
  }

  if (goal.imports?.length) {
    sections.push(`## Imports (from dependencies)\n\n${goal.imports.map((i) => `- ${i}`).join("\n")}`)
  }

  if (goal.exports?.length) {
    sections.push(`## Exports (this goal must provide)\n\n${goal.exports.map((e) => `- ${e}`).join("\n")}`)
  }

  sections.push(`## Task Context\n\n${taskRequest}`)

  if (designSpecs && designSpecs.length > 0) {
    sections.push(
      renderVisualContractPromptSection({
        specs: designSpecs,
        instructions: [
          "The following advisory visual constraints came from design_analysis.",
          "Use them when planning UI, layout, responsive, and interaction work relevant to this goal.",
        ],
      }),
    )
  }

  if (architectSection) {
    sections.push(architectSection)
    sections.push(
      "**IMPORTANT**: The above architect contracts are BINDING. File paths, interface signatures, and export names MUST match exactly.",
    )
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

  sections.push(
    "Now explore the codebase, then deliver the final plan through the StructuredOutput " +
      "tool exactly once with { title, brief, file_actions[], verification_commands[] }.",
  )
  sections.push(
    "Do not end with plain text tags or an empty response. A missing StructuredOutput " +
      "call is a hard failure.",
  )

  return sections.join("\n\n")
}
