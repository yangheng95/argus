/**
 * Intent Analysis Agent — front-of-pipeline intent disambiguation.
 *
 * Position: before any planning agent (Requirements / Architect). Reads
 * the raw user request and returns a structured IntentAnalysisResult
 * (intent class, complexity band, extracted slots, missing info keys,
 * clarification questions, overall confidence, one-sentence summary).
 *
 * Hard boundaries:
 *   ✗ Cannot modify files, run shell, call other agents
 *   ✗ Cannot persist state outside of its return value
 *   ✓ May use read-only codebase tools (read/find/search/list) to ground
 *     complexity estimation in the repo's actual shape
 *   ✓ Produces IntentAnalysisResult via structured tool calls only
 *
 * Implementation: the agent is a thin shell over `runAgentSession` — the
 * runner owns model resolution, child-session creation, system-prompt
 * composition (core + config-append + skills), prompt invocation, abort
 * propagation, stream-error capture. Agent-specific code is limited to
 * the user-prompt text and the structured output tools.
 */
import z from "zod"
import { runAgentSession } from "@/agent/runner"
import type { AgentSessionContinuation } from "@/engine/stage-continuation"
import { withFactCheckRegistration } from "@/prompt/fragments/fact-check-registration"
import { AttachmentStore } from "@/storage/attachment-store"
import { renderUserRequestSection } from "@/intent/request-prompt"
import { createAgentContextTools } from "@/agent/context-tools"
import { filterAgentTools } from "@/agent/filter-tools"
import { Log } from "@/util/log"
import type { IntentAnalysisResult } from "./types"
import { collectorToResult, createIntentOutputTools, IntentFinalSchema, type IntentFinal } from "./output-tools"

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
    taskID?: string
    /** Parent session — a child "intent-analysis" session is created under it. */
    parentSessionID?: string
    /** Multimodal attachments the user uploaded with the task (images, PDFs,
     *  etc.). Surfaced into the user-message text section AND inlined as
     *  multimodal file parts so the model can actually look at them while
     *  classifying intent. */
    attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>
    model?: { providerID: string; modelID: string }
    signal?: AbortSignal
    continuation?: AgentSessionContinuation
    onSessionCreated?: (sessionID: string) => void
    onStatus?: (summary: string) => void | Promise<void>
  }

  export interface AnalyzeOutput {
    result: IntentAnalysisResult
    /** Child session created by the runner. */
    sessionID: string
  }

  export async function analyze(input: AnalyzeInput): Promise<AnalyzeOutput> {
    const toolKit = await buildToolKit({ taskID: input.taskID, sessionID: input.parentSessionID })
    const out = await runAgentSession({
      kind: "intent-analysis",
      core: withFactCheckRegistration(INTENT_CORE),
      sessionTitle: input.title ? `Intent: ${input.title}` : "Intent analysis",
      parentSessionID: input.parentSessionID,
      taskID: input.taskID,
      model: input.model,
      signal: input.signal,
      continuation: input.continuation,
      onSessionCreated: input.onSessionCreated
        ? (session) => {
            input.onSessionCreated!(session.id)
          }
        : undefined,
      onStatus: input.onStatus,
      toolKit: {
        tools: toolKit.tools,
        getCollector: toolKit.getCollector,
        buildReport: toolKit.buildReport,
      },
      buildUserPrompt: () => buildUserPrompt(input),
      buildUserParts: async () => {
        const text = buildUserPrompt(input)
        const enrichedText = text + AttachmentStore.renderAttachmentInventory(input.attachments)
        const inlineParts = await AttachmentStore.inlineFileParts(input.attachments)
        return [{ type: "text" as const, text: enrichedText }, ...inlineParts]
      },
      format: {
        schema: z.toJSONSchema(IntentFinalSchema) as Record<string, unknown>,
        retryCount: 2,
      },
    })

    const structured = out.structured as IntentFinal | undefined
    if (!structured) {
      // Should never happen: the runner now throws on
      // `finalMessage.info.error` AND the SessionLoop emits a
      // StructuredOutputError when the model finishes without calling
      // StructuredOutput. Reaching this branch means one of those guards
      // is broken — fail loud rather than fabricate defaults (rule 7).
      throw new Error(
        `intent-analysis: runAgentSession returned without a StructuredOutput payload (sessionID=${out.session.id})`,
      )
    }
    const result = collectorToResult(out.collector, structured)

    log.info("intent-analysis agent finished", {
      intent_class: result.intent_class,
      complexity: result.complexity,
      slots: result.extracted_slots.length,
      missing: result.missing_info.length,
      clarifications: result.clarifications.length,
      confidence: result.confidence,
    })

    return { result, sessionID: out.session.id }
  }
}

// ---------------------------------------------------------------------------
// Tool kit — shared read-only context tools + intent-specific collector tools.
// ---------------------------------------------------------------------------

async function buildToolKit(opts?: { taskID?: string; sessionID?: string }) {
  const contextTools = await filterAgentTools(createAgentContextTools(), "intent-analysis", opts)
  const outputToolKit = createIntentOutputTools()
  return {
    tools: { ...contextTools, ...outputToolKit.tools },
    getCollector: () => outputToolKit.getCollector(),
    buildReport: outputToolKit.buildReport,
  }
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildUserPrompt(input: IntentAnalysisAgent.AnalyzeInput): string {
  const sections: string[] = []
  sections.push(
    "# Delegation\n\nOrchestrator is asking intent-analysis to read this task request and return a grounded intent analysis.",
  )
  if (input.title && input.title.trim()) {
    sections.push(`# Title\n\n${input.title.trim()}`)
  }
  sections.push(renderUserRequestSection({ heading: "# User Request", request: input.request, taskID: input.taskID }))
  return sections.join("\n\n")
}
