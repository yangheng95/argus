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
 *
 * Phase 3-b migration (specs/new-arch/16-unified-teardown.md §7-3): runs via
 * SessionPrompt.prompt + extraTools instead of AgentRuntime.run + a private
 * finalize_intent tool. Terminal fields arrive through SessionLoop's
 * StructuredOutput tool driven by `format: { type: "json_schema", schema }`;
 * incremental slots / missing / clarifications are collected by agent-scoped
 * tools injected via SessionPrompt.withExtraTools.
 */
import z from "zod"
import { createPlannerTools } from "@/planner/tools"
import { filterAgentTools } from "@/agent/filter-tools"
import { Log } from "@/util/log"
import { resolveAgentModel } from "@/agent/model"
import { EngineConfig } from "@/engine"
import { loadStageSkills } from "@/engine/skill-inject"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import type { Message } from "@/session/message"
import type { IntentAnalysisResult } from "./types"
import {
  collectorToResult,
  createIntentOutputTools,
  IntentFinalSchema,
  type IntentFinal,
} from "./output-tools"

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
    /** Parent session — this agent creates its own child session under it.
     *  When absent the child session is top-level. */
    parentSessionID?: string
    /** Explicit model override (provider/model). Skips `resolveAgentModel`
     *  and `config.model` resolution. Used by smoke tests and by callers
     *  that already resolved a model for a wider pipeline step. */
    model?: { providerID: string; modelID: string }
    signal?: AbortSignal
    onStatus?: (summary: string) => void | Promise<void>
  }

  export interface AnalyzeOutput {
    result: IntentAnalysisResult
    /** The child session created for this invocation. Callers may inspect
     *  its message stream for audit / UI rendering. */
    sessionID: string
  }

  export async function analyze(input: AnalyzeInput): Promise<AnalyzeOutput> {
    return run(input)
  }
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function run(input: IntentAnalysisAgent.AnalyzeInput): Promise<IntentAnalysisAgent.AnalyzeOutput> {
  if (input.signal?.aborted) throw new Error("intent-analysis agent aborted")

  let model: Awaited<ReturnType<typeof resolveAgentModel>> | undefined
  if (input.model) {
    const { Provider } = await import("@/provider/provider")
    model = await Provider.getModel(input.model.providerID, input.model.modelID).catch(() => undefined)
  } else {
    model = await resolveAgentModel("intent-analysis", { taskID: input.taskID }).catch(
      () => undefined,
    )
  }
  if (!model) throw new Error("no LLM model available for intent-analysis agent")

  if (input.signal?.aborted) throw new Error("intent-analysis agent aborted after model resolution")

  const plannerTools = await filterAgentTools(createPlannerTools(), "intent-analysis")
  const outputToolKit = createIntentOutputTools()

  await input.onStatus?.("Intent-analysis agent: analyzing user request")

  const systemPrompt = await intentSystem()
  const userPrompt = buildUserPrompt(input)

  log.info("intent-analysis agent starting", {
    requestLength: input.request.length,
    model: model.id,
  })

  const childSession = await Session.createNext({
    kind: "intent-analysis",
    parentID: input.parentSessionID,
    title: input.title ? `Intent: ${input.title}` : "Intent analysis",
    directory: Instance.directory,
  })

  const extraTools = { ...plannerTools, ...outputToolKit.tools }
  const enableMap: Record<string, boolean> = Object.fromEntries(
    Object.keys(extraTools).map((name) => [name, true]),
  )

  let finalMessage: Message.WithParts | undefined
  await SessionPrompt.withExtraTools(childSession.id, extraTools, async () => {
    finalMessage = await SessionPrompt.prompt({
      sessionID: childSession.id,
      model: { providerID: model.providerID, modelID: model.api.id },
      agent: "intent-analysis",
      system: systemPrompt,
      tools: enableMap,
      format: {
        type: "json_schema",
        schema: z.toJSONSchema(IntentFinalSchema) as Record<string, unknown>,
        retryCount: 2,
      },
      parts: [{ type: "text", text: userPrompt }],
    }) as Message.WithParts
  })

  if (input.signal?.aborted) throw new Error("intent-analysis agent aborted during prompt")
  if (!finalMessage) throw new Error("intent-analysis: SessionPrompt.prompt returned no message")

  const structured = (finalMessage.info as Message.Assistant).structured as IntentFinal | undefined

  const collector = outputToolKit.getCollector()
  const result = collectorToResult(collector, structured)

  log.info("intent-analysis agent finished", {
    intent_class: result.intent_class,
    complexity: result.complexity,
    slots: result.extracted_slots.length,
    missing: result.missing_info.length,
    clarifications: result.clarifications.length,
    confidence: result.confidence,
    structuredMissing: !structured,
  })

  return {
    result,
    sessionID: childSession.id,
  }
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
      "ask_clarification calls as warranted, then call the StructuredOutput " +
      "tool exactly once at the end with the terminal intent_class, " +
      "complexity, confidence, and summary fields.",
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
