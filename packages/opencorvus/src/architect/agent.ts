/**
 * Architect Agent — cross-goal consensus coordination.
 *
 * Position: After Decompose, before Plan. Task Agent decides when to invoke.
 * Reads ALL GoalContracts, explores codebase, resolves abstract exports/imports
 * into precise TypeScript contracts, writes binding consensus to Decision Log.
 *
 * Hard boundaries (from architecture spec):
 * ✗ Cannot modify GoalContracts (immutable after Decompose)
 * ✗ Cannot execute code/commands
 * ✗ Cannot write/modify files
 * ✗ Cannot call other agents
 * ✗ Cannot change goal set
 * ✓ Only produces Decision Log entries + ArchitectBlueprint
 */
import { streamText, stepCountIs } from "ai"
import type { TextHooks } from "@/llm/api"
import { Provider } from "@/provider/provider"
import { createPlannerTools } from "@/planner/tools"
import { Log } from "@/util/log"
import { toolGuard } from "@/util/tool-guard"
import { createInactivityGuard } from "@/util/inactivity-guard"
import { AgentTrace } from "@/util/agent-trace"
import { OrchestratorConfig } from "@/orchestrator/config"
import { Config } from "@/config/config"
import type { GoalContractFields } from "@/pipeline/types"
import type { DecisionLog } from "@/decision-log"
import type { ArchitectResult, ArchitectBlueprint, ArchitectContract, RecommendedNext, ArchitectDecisionKey } from "./types"
import { parseYamlLikeList } from "@/util/parse-section-tags"
import { extractTag } from "@/util/parse-section-tags"

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
  const language = await Provider.getLanguage(model)

  if (input.signal?.aborted) throw new Error("architect agent aborted after model resolution")

  // Read-only codebase tools (architect cannot write files)
  const guard = toolGuard(createPlannerTools(undefined, undefined))

  await input.onStatus?.("Architect agent: coordinating cross-goal contracts")

  const systemPrompt = await architectSystem()
  const userPrompt = buildUserPrompt(input)

  log.info("architect agent starting", {
    goals: input.goals.length,
    model: language.modelId,
  })

  const stallController = new AbortController()
  const stallGuard = createInactivityGuard(TIMEOUT_MS, () => {
    log.warn("architect agent stall timeout", { taskID: input.taskID })
    stallController.abort(new Error("stall timeout"))
  })
  const abortSignals: AbortSignal[] = [stallController.signal, guard.signal]
  if (input.signal) abortSignals.push(input.signal)

  const stream = streamText({
    model: language,
    stopWhen: stepCountIs(MAX_STEPS),
    tools: guard.tools,
    maxOutputTokens: 16384,
    abortSignal: AbortSignal.any(abortSignals),
    system: systemPrompt,
    messages: [{ role: "user" as const, content: userPrompt }],
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

  let allText = resultText?.trim() || ""
  if (!allText) {
    allText = resultSteps.map((s) => s.text).filter(Boolean).join("\n")
  }

  const toolCallCount = resultSteps.reduce(
    (sum, s) => sum + (Array.isArray((s as any).toolCalls) ? (s as any).toolCalls.length : 0),
    0,
  )

  log.info("architect agent finished", {
    steps: resultSteps.length,
    finishReason: resultFinishReason,
    textLength: allText.length,
    toolCalls: toolCallCount,
  })

  AgentTrace.capture("architect", 1,
    { system: systemPrompt, messages: [{ role: "user", content: userPrompt }] },
    allText,
    { model: language.modelId, toolCalls: toolCallCount, finishReason: resultFinishReason },
  )

  // Parse output
  const blueprint = parseBlueprint(allText)
  const recommendedNext = parseRecommendedNext(allText)

  // Write contracts to Decision Log
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
    recommendedNext: recommendedNext.length,
  })

  return { blueprint, entriesWritten, recommendedNext }
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

  // All goals
  const goalsText = input.goals.map((g) => [
    `## ${g.id}: ${g.title}`,
    `objective: ${g.objective}`,
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

// ---------------------------------------------------------------------------
// Output parsing
// ---------------------------------------------------------------------------

function parseBlueprint(text: string): ArchitectBlueprint {
  const summary = extractTag(text, "architect_summary") || "Cross-goal coordination"
  const contractsRaw = extractTag(text, "contracts") || ""

  const contracts: ArchitectContract[] = []
  if (contractsRaw.trim()) {
    const items = parseYamlLikeList(contractsRaw)
    for (const item of items) {
      const category = item.category as ArchitectDecisionKey | undefined
      if (!category || !VALID_CATEGORIES.has(category)) continue
      contracts.push({
        category,
        title: item.title || category,
        spec: item.spec || "",
        goalIDs: splitCommaSeparated(item.goal_ids),
      })
    }
  }

  return { contracts, summary }
}

function parseRecommendedNext(text: string): RecommendedNext[] {
  const raw = extractTag(text, "recommended_next") || ""
  if (!raw.trim()) return []

  const items = parseYamlLikeList(raw)
  return items
    .filter((item) => item.agent)
    .map((item) => {
      let args: Record<string, unknown> | undefined
      if (item.args) {
        try { args = JSON.parse(item.args) } catch { args = undefined }
      }
      return {
        agent: item.agent!,
        args,
        reason: item.reason || "",
        confidence: Math.min(1, Math.max(0, parseFloat(item.confidence || "0.5"))),
        priority: (["required", "suggested", "optional"].includes(item.priority || "")
          ? item.priority
          : "suggested") as RecommendedNext["priority"],
      }
    })
}

function splitCommaSeparated(value: string | undefined): string[] {
  if (!value || !value.trim()) return []
  return value.split(/[,，]\s*/).map((s) => s.trim()).filter(Boolean)
}
