/**
 * Intent Analysis Agent — early-stage intent disambiguation.
 *
 * Position: before any planning agent (Requirements / Planner / Architect).
 * Reads the raw user request (typically very short) and returns a structured
 * IntentAnalysisResult — intent class, complexity band, extracted slots,
 * missing-info keys, clarification questions, overall confidence, summary.
 *
 * This agent is intentionally NOT wired into the orchestrator workflow yet.
 * Callers invoke `IntentAnalysisAgent.analyze(...)` explicitly when ready.
 *
 * Hard boundaries:
 *   ✗ Cannot modify files, run shell, call other agents
 *   ✗ Cannot persist state outside of its return value
 *   ✓ May use read-only codebase tools (read/find/search/list) to ground
 *     complexity estimation in reality
 *   ✓ Only produces IntentAnalysisResult via structured tool calls
 */
import { stepCountIs } from "ai"
import type { TextHooks } from "@/llm/api"
import { createPlannerTools } from "@/planner/tools"
import { filterAgentTools } from "@/agent/filter-tools"
import { Log } from "@/util/log"
import { toolGuard } from "@/util/tool-guard"
import { AgentRuntime } from "@/agent/runtime"
import { resolveAgentModel } from "@/agent/model"
import { EngineConfig } from "@/engine"
import { loadStageSkills } from "@/engine/skill-inject"
import { Config } from "@/config/config"
import type { IntentAnalysisResult } from "./types"
import { collectorToResult, createIntentOutputTools } from "./output-tools"

import INTENT_CORE from "@/prompt/core/intent-analysis-core.txt"

const log = Log.create({ service: "intent-analysis-agent" })

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export namespace IntentAnalysisAgent {
  export interface AnalyzeInput {
    /** Raw user request — usually short, may be ambiguous. */
    request: string
    /** Optional short title / channel context. */
    title?: string
    /** Task ID used to resolve per-task model and cache key. */
    taskID?: string
    /** Session ID — if supplied, stream output is persisted by caller-side hooks. */
    sessionID?: string
    signal?: AbortSignal
    stream?: TextHooks
    onStatus?: (summary: string) => void | Promise<void>
  }

  export async function analyze(input: AnalyzeInput): Promise<IntentAnalysisResult> {
    return run(input)
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function run(input: IntentAnalysisAgent.AnalyzeInput): Promise<IntentAnalysisResult> {
  if (input.signal?.aborted) throw new Error("intent-analysis agent aborted")

  const orchCfg = await EngineConfig.get()
  const { max_steps: MAX_STEPS, timeout_ms: TIMEOUT_MS } = orchCfg.intent_analysis

  const model = await resolveAgentModel("intent-analysis", { taskID: input.taskID }).catch(
    () => undefined,
  )
  if (!model) throw new Error("no LLM model available for intent-analysis agent")

  if (input.signal?.aborted) throw new Error("intent-analysis agent aborted after model resolution")

  const plannerTools = await filterAgentTools(createPlannerTools(), "intent-analysis")
  const outputToolKit = createIntentOutputTools()
  const guard = toolGuard({ ...plannerTools, ...outputToolKit.tools })

  await input.onStatus?.("Intent-analysis agent: analyzing user request")

  const systemPrompt = await intentSystem()
  const userPrompt = buildUserPrompt(input)

  log.info("intent-analysis agent starting", {
    requestLength: input.request.length,
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
    agent: "intent-analysis",
    model,
    system: systemPrompt,
    messages: [{ role: "user" as const, content: userPrompt }],
    tools: guard.tools,
    stopWhen: stepCountIs(MAX_STEPS),
    cacheKey: input.taskID ? `task-${input.taskID}-intent-analysis` : undefined,
    sessionID: input.sessionID ?? "",
    taskID: input.taskID,
    stage: "intent-analysis",
    signal: AbortSignal.any(abortSignals),
    onStepFinish: guard.onStepFinish,
    hooks: passthroughHooks,
    policies: {
      progressTimeoutMs: TIMEOUT_MS,
      failurePolicy: "collect",
    },
  })

  log.info("intent-analysis agent finished", {
    steps: runResult.steps.length,
    finishReason: runResult.finishReason,
    toolCalls: runResult.toolCallCount,
  })

  const collector = outputToolKit.getCollector()
  if (!collector.finalized) {
    throw new Error(
      "Intent-analysis agent did not call finalize_intent. " +
        "Check the model's tool-calling behavior or the intent-analysis prompt.",
    )
  }

  const result = collectorToResult(collector)

  log.info("intent-analysis agent output", {
    intent_class: result.intent_class,
    complexity: result.complexity,
    slots: result.extracted_slots.length,
    missing: result.missing_info.length,
    clarifications: result.clarifications.length,
    confidence: result.confidence,
  })

  return result
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildUserPrompt(input: IntentAnalysisAgent.AnalyzeInput): string {
  const sections: string[] = []
  if (input.title && input.title.trim()) {
    sections.push(`# Title\n\n${input.title.trim()}`)
  }
  sections.push(`# User Request\n\n${input.request}`)
  sections.push(
    "Analyze the request. Emit extract_slot / flag_missing_info / " +
      "ask_clarification calls as warranted, then call finalize_intent " +
      "exactly once to close the analysis.",
  )
  return sections.join("\n\n")
}

async function intentSystem(): Promise<string> {
  // Single-source skill injection. `config.agent["intent-analysis"].prompt`
  // appends to the canonical CORE; it cannot replace it. The skill loader
  // is the only injection path; no bypass field exists.
  const config = await Config.get()
  const userAppend = (config.agent as Record<string, any> | undefined)?.["intent-analysis"]?.prompt
  const core = typeof userAppend === "string" && userAppend.trim().length > 0
    ? INTENT_CORE + "\n\n" + userAppend
    : INTENT_CORE
  const orchCfg = await EngineConfig.get()
  const skills = await loadStageSkills(orchCfg.intent_analysis.skills, "intent-analysis")
  return core + skills
}
