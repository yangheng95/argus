/**
 * Architect Agent — cross-goal consensus coordination.
 *
 * Position: After Requirements, before Plan. Orchestrator decides when to invoke.
 * Reads ALL GoalContracts, explores codebase, resolves abstract exports/imports
 * into precise TypeScript contracts, writes binding consensus to Decision Log.
 *
 * Hard boundaries (from architecture spec):
 * ✗ Cannot modify GoalContracts (immutable after Requirements)
 * ✗ Cannot execute code/commands
 * ✗ Cannot write/modify files
 * ✗ Cannot call other agents
 * ✗ Cannot change goal set
 * ✓ Only produces Decision Log entries + ArchitectBlueprint
 */
import { stepCountIs } from "ai"
import type { TextHooks } from "@/llm/api"
import { Provider } from "@/provider/provider"
import { createPlannerTools } from "@/planner/tools"
import { filterAgentTools } from "@/agent/filter-tools"
import { Log } from "@/util/log"
import { toolGuard } from "@/util/tool-guard"
import { AgentRuntime } from "@/agent/runtime"
import { resolveAgentModel } from "@/agent/model"
import { EngineConfig } from "@/engine"
import { Config } from "@/config/config"
import type { GoalContractFields } from "@/pipeline/types"
import type { DecisionLog } from "@/decision-log"
import { renderSpecsAsText } from "@/acceptance/types"
import type { ArchitectResult, ArchitectBlueprint, ArchitectDecisionKey } from "./types"
import { createArchitectOutputTools } from "./output-tools"

import ARCHITECT_CORE from "@/prompt/core/architect-core.txt"

const log = Log.create({ service: "architect-agent" })

const VALID_CATEGORIES = new Set<ArchitectDecisionKey>([
  "directory_blueprint", "interface_contract", "export_manifest",
  "shared_type", "naming_convention", "dependency_order",
])

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export namespace ArchitectAgent {
  export async function coordinate(input: {
    goals: GoalContractFields[]
    taskRequest: string
    taskTitle: string
    taskID?: string
    decisionLog: DecisionLog
    signal?: AbortSignal
    stream?: TextHooks
    onStatus?: (summary: string) => void | Promise<void>
  }): Promise<ArchitectResult> {
    return run(input)
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function run(input: {
  goals: GoalContractFields[]
  taskRequest: string
  taskTitle: string
  taskID?: string
  decisionLog: DecisionLog
  signal?: AbortSignal
  stream?: TextHooks
  onStatus?: (summary: string) => void | Promise<void>
}): Promise<ArchitectResult> {
  if (input.signal?.aborted) throw new Error("architect agent aborted")

  const orchCfg = await EngineConfig.get()
  const { max_steps: MAX_STEPS, timeout_ms: TIMEOUT_MS } = orchCfg.architect

  // Resolve model — per-agent model from Agent.Info (config: agent.architect.model),
  // falling back to the user's most recent in-session model pick when no per-agent
  // override is configured.
  const model = await resolveAgentModel("architect", { taskID: input.taskID })

  if (input.signal?.aborted) throw new Error("architect agent aborted after model resolution")

  // Read-only codebase tools + structured output tools. The Architect is the
  // authoritative goal decomposer, so the output kit is seeded with the
  // goals already in flight (from Requirements or a prior Architect run) —
  // modify_goal / remove_goal operate against that seed.
  const seedGoals = input.goals.map((g) => ({
    id: g.id,
    title: g.title,
    objective: g.objective,
    acceptance_specs: g.acceptance_specs,
    owned_paths: g.owned_paths,
    depends_on: g.depends_on,
    exports: g.exports,
    imports: g.imports,
    priority: g.priority,
    kind: (g.kind as "bootstrap" | "feature" | "verification" | "integration" | "system") ?? "feature",
    requirement_ids: g.requirement_ids,
  }))
  const outputToolKit = createArchitectOutputTools({ existingGoals: seedGoals })
  const plannerTools = await filterAgentTools(createPlannerTools(), "architect")
  const guard = toolGuard({ ...plannerTools, ...outputToolKit.tools })

  await input.onStatus?.("Architect agent: coordinating cross-goal contracts")

  const systemPrompt = await architectSystem()
  const userPrompt = buildUserPrompt(input)

  log.info("architect agent starting", {
    goals: input.goals.length,
    model: model.id,
  })

  const abortSignals: AbortSignal[] = [guard.signal]
  if (input.signal) abortSignals.push(input.signal)

  const passthroughHooks = {
    onChunk: input.stream?.onChunk,
    onError: input.stream?.onError,
    flush: async () => {},
    failures: { snapshot: () => ({ count: 0, items: [] as any[] }) },
  } as any
  const runResult = await AgentRuntime.run({
    agent: "architect",
    model,
    system: systemPrompt,
    messages: [{ role: "user" as const, content: userPrompt }],
    tools: guard.tools,
    stopWhen: stepCountIs(MAX_STEPS),
    cacheKey: input.taskID ? `task-${input.taskID}-architect` : undefined,
    sessionID: "",
    taskID: input.taskID,
    stage: "architect",
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
  const resultFinishReason = runResult.finishReason
  const toolCallCount = runResult.toolCallCount

  log.info("architect agent finished", {
    steps: resultSteps.length,
    finishReason: resultFinishReason,
    textLength: (resultText?.trim() || "").length,
    toolCalls: toolCallCount,
  })

  const collector = outputToolKit.getCollector()
  if (collector.contracts.length === 0) {
    log.warn("architect agent: no contracts registered via tool calls", {
      taskID: input.taskID,
      goals: input.goals.length,
      finishReason: resultFinishReason,
    })
    throw new Error(
      "Architect agent did not register any contracts via register_contract. " +
      "Check the model's tool-calling behavior or the architect prompt.",
    )
  }
  const blueprint: ArchitectBlueprint = {
    contracts: collector.contracts.map((c) => ({
      category: c.category,
      title: c.title,
      spec: c.spec,
      goalIDs: c.goalIDs,
    })),
    summary: collector.summary || "Cross-goal coordination",
  }

  let entriesWritten = 0
  for (const contract of blueprint.contracts) {
    if (!VALID_CATEGORIES.has(contract.category)) continue
    // goalID dispatch:
    //   • Single-goal contract → tag with that goal so per-goal sub-agents
    //     reading `phasePromptSectionForGoal` see it.
    //   • Multi-goal contract → tag as task-scoped (omit goalID). Per-goal
    //     reads include `goal_id IS NULL` rows, so all goals see it. Tagging
    //     to only the first goal would hide cross-goal interface contracts
    //     from every other goal's executor.
    const tagAsGoalID = contract.goalIDs.length === 1 ? contract.goalIDs[0] : undefined
    input.decisionLog.append({
      goalID: tagAsGoalID,
      phase: "architect",
      key: contract.category,
      value: `## ${contract.title}\n${contract.spec}`,
      reason: `Architect consensus for goals: ${contract.goalIDs.join(", ") || "(task-wide)"}`,
    })
    entriesWritten++
  }

  log.info("architect agent output", {
    contracts: blueprint.contracts.length,
    entriesWritten,
  })

  return { blueprint, entriesWritten }
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildUserPrompt(input: {
  goals: GoalContractFields[]
  taskRequest: string
  taskTitle: string
  decisionLog: DecisionLog
}): string {
  const sections: string[] = []

  sections.push(`# Task\n\nTitle: ${input.taskTitle}\n\nRequest:\n${input.taskRequest}`)

  // Architect resolves cross-goal interfaces. It does not grade acceptance,
  // but it DOES need to see each goal's acceptance criteria text because
  // contracts (exports, types, file layout) must be consistent with what
  // the evaluator will ultimately verify. Earlier the full spec body was
  // dropped in favour of a plain count; that saved tokens but left the
  // architect system prompt claiming inputs it no longer received. Cap
  // per-goal spec text at 600 chars (enough for one interface-level
  // acceptance line; longer prose bodies live in the spec snapshot and
  // are available to downstream per-goal planners / evaluators).
  const ARCHITECT_SPECS_CAP = 600
  const goalsText = input.goals.map((g) => {
    const specs = (g.acceptance_specs ?? [])
    const specsRaw = renderSpecsAsText(specs)
    const specsTrim = specsRaw.length > ARCHITECT_SPECS_CAP
      ? specsRaw.slice(0, ARCHITECT_SPECS_CAP) + `… (truncated; ${specs.length} specs total, full bodies in spec snapshot)`
      : specsRaw
    return [
      `## ${g.id}: ${g.title}`,
      `objective: ${g.objective}`,
      `acceptance_specs (${specs.length}):\n${specsTrim}`,
      `owned_paths: ${g.owned_paths.join(", ") || "(none)"}`,
      `exports: ${g.exports.join("; ") || "(none)"}`,
      `imports: ${g.imports.join("; ") || "(none)"}`,
      `depends_on: ${g.depends_on.join(", ") || "(none)"}`,
      `kind: ${g.kind}`,
    ].join("\n")
  }).join("\n\n")

  sections.push(`# GoalContracts (${input.goals.length} goals)\n\n${goalsText}`)

  // Existing Decision Log
  const dlSection = input.decisionLog.toPromptSection()
  if (dlSection) sections.push(dlSection)

  sections.push(
    "Now explore the codebase to discover existing patterns, then resolve all cross-goal " +
    "interfaces into precise TypeScript contracts. Output using section tags as described.",
  )

  return sections.join("\n\n")
}

async function architectSystem(): Promise<string> {
  const config = await Config.get()
  const agentPrompt = (config.agent as Record<string, any> | undefined)?.architect?.prompt
  return typeof agentPrompt === "string" ? agentPrompt : ARCHITECT_CORE
}
