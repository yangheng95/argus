/**
 * Architect Agent — cross-goal consensus coordination.
 *
 * Position: After Requirements, before Plan. Task Agent decides when to invoke.
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
import { Log } from "@/util/log"
import { toolGuard } from "@/util/tool-guard"
import { AgentRuntime } from "@/agent/runtime"
import { OrchestratorConfig } from "@/orchestrator/config"
import { Config } from "@/config/config"
import type { GoalContractFields } from "@/pipeline/types"
import type { DecisionLog } from "@/decision-log"
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

  const orchCfg = await OrchestratorConfig.get()
  const { max_steps: MAX_STEPS, timeout_ms: TIMEOUT_MS } = orchCfg.architect

  // Resolve model — use architect-specific model if configured, else default
  const archModel = orchCfg.architect.model
  let def: { providerID: string; modelID: string } | undefined
  if (archModel) {
    const [providerID, ...rest] = archModel.split("/")
    const modelID = rest.join("/")
    if (providerID && modelID) def = { providerID, modelID }
  }
  if (!def) def = await Provider.defaultModel().catch(() => undefined)
  if (!def) throw new Error("no LLM model available for architect agent")

  const model = await Provider.getModel(def.providerID, def.modelID)

  if (input.signal?.aborted) throw new Error("architect agent aborted after model resolution")

  // Read-only codebase tools + structured output tools (architect cannot write files)
  const goalIDs = input.goals.map(g => g.id)
  const outputToolKit = createArchitectOutputTools(goalIDs)
  const guard = toolGuard({ ...createPlannerTools(), ...outputToolKit.tools })

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
    onStepFinish: guard.onStepFinish as any,
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
    contracts: collector.contracts,
    summary: collector.summary || "Cross-goal coordination",
  }

  let entriesWritten = 0
  for (const contract of blueprint.contracts) {
    if (!VALID_CATEGORIES.has(contract.category)) continue
    input.decisionLog.append({
      goalID: contract.goalIDs[0] || undefined,
      phase: "architect",
      key: contract.category,
      value: `## ${contract.title}\n${contract.spec}`,
      reason: `Architect consensus for goals: ${contract.goalIDs.join(", ")}`,
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

  // All goals — include done_definition so architect can see exact acceptance
  // criteria and produce contracts that match what eval will verify.
  const goalsText = input.goals.map((g) => [
    `## ${g.id}: ${g.title}`,
    `objective: ${g.objective}`,
    `done_definition: ${g.done_definition}`,
    `owned_paths: ${g.owned_paths.join(", ") || "(none)"}`,
    `exports: ${g.exports.join("; ") || "(none)"}`,
    `imports: ${g.imports.join("; ") || "(none)"}`,
    `depends_on: ${g.depends_on.join(", ") || "(none)"}`,
    `kind: ${g.kind}`,
  ].join("\n")).join("\n\n")

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
