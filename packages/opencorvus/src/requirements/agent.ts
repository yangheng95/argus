/**
 * RequirementsAgent — parses a user task into REQ-N requirements + foundational
 * technical decisions (runtime / frameworks / test strategy). Seeds the
 * Decision Log with the decisions under phase="requirements" so downstream
 * agents build on the same foundation.
 *
 * This agent deliberately does NOT produce goals, metric specs, challenge
 * seeds, traceability, or cross-goal contracts — the Architect owns those.
 * The narrow surface is enforced by the tool list (register_requirement +
 * register_decision) and by the RequirementsResult type shape.
 *
 * Phase 3-b migration (specs/new-arch/16-unified-teardown.md §7-3): runs via
 * SessionPrompt.prompt + extraTools instead of AgentRuntime.run + a private
 * finalize_requirements tool. Terminal `summary` arrives through SessionLoop's
 * StructuredOutput tool (RequirementsFinalSchema); incremental
 * register_requirement / register_decision tools stay as agent-scoped extras.
 */
import z from "zod"
import type { TextHooks } from "@/llm/api"
import { createPlannerTools, prefetchContext } from "@/planner/tools"
import { filterAgentTools } from "@/agent/filter-tools"
import { Log } from "@/util/log"
import { EngineConfig, clarificationTranscriptSection, operatorNotesSection } from "@/engine"
import { AttachmentStore } from "@/storage/attachment-store"
import { resolveAgentModel } from "@/agent/model"
import { loadStageSkills } from "@/engine/skill-inject"
import { Config } from "@/config/config"
import type { VisualSpec } from "@/design-analyst/types"
import { renderVisualContractPromptSection } from "@/design-analyst/prompt-section"
import { buildMirrorToolsPromptSection } from "@/prompt/mirror-tools"
import { Instance } from "@/project/instance"
import { Provider } from "@/provider/provider"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import type { Message } from "@/session/message"
import { Identifier } from "@/id/id"
import type {
  ParsedRequirement,
  RequirementsDecision,
  RequirementsOutput,
} from "./types"
import {
  createRequirementsOutputTools,
  RequirementsFinalSchema,
  type RequirementsCollector,
  type RequirementsFinal,
} from "./output-tools"
import type { DecisionLog } from "@/decision-log"

import REQUIREMENTS_CORE from "@/prompt/core/requirements-core.txt"

const log = Log.create({ service: "requirements-agent" })

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface RequirementsResult {
  summary: string
  /** All requirements extracted from user input (explicit + implicit) */
  requirements: ParsedRequirement[]
  /** Foundational technical decisions (runtime, framework, test strategy, …). */
  decisions: RequirementsDecision[]
}

// ---------------------------------------------------------------------------
// RequirementsAgent public API
// ---------------------------------------------------------------------------

export namespace RequirementsAgent {
  export interface RunInput {
    title: string
    request: string
    /** Base64 image attachments — injected as vision content alongside the request text. */
    attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>
    /** Advisory visual contract produced by design_analysis. */
    designSpecs?: VisualSpec[]
    taskID?: string
    /** Parent session — a child "requirements" session is created under it. */
    parentSessionID?: string
    /** Explicit model override (provider/model). Skips `resolveAgentModel`. */
    model?: { providerID: string; modelID: string }
    signal?: AbortSignal
    /** Legacy passthrough; not wired after the SessionPrompt migration. */
    stream?: TextHooks
    onStatus?: (summary: string) => void | Promise<void>
    /** Optional Decision Log — seeded with foundational decisions. */
    decisionLog?: DecisionLog
  }

  /**
   * Parse a task request into REQ-N requirements + foundational decisions.
   * Goal decomposition happens downstream in the Architect, not here.
   */
  export async function run(input: RunInput): Promise<RequirementsResult> {
    return runInternal(input)
  }
}

// ---------------------------------------------------------------------------
// Internal implementation
// ---------------------------------------------------------------------------

async function runInternal(input: RequirementsAgent.RunInput): Promise<RequirementsResult> {
  if (input.signal?.aborted) throw new Error("requirements agent aborted before model resolution")

  // Resolve model — per-agent model from Agent.Info (config: agent.requirements.model),
  // falling back to the user's most recent in-session model pick when no per-agent
  // override is configured. Test callers can bypass this with input.model.
  let model: Awaited<ReturnType<typeof resolveAgentModel>> | undefined
  if (input.model) {
    model = await Provider.getModel(input.model.providerID, input.model.modelID).catch(() => undefined)
  } else {
    model = await resolveAgentModel("requirements", { taskID: input.taskID }).catch(() => undefined)
  }
  if (!model) throw new Error("no LLM model available for requirements agent")

  if (input.signal?.aborted) throw new Error("requirements agent aborted after model resolution")

  // Extract working directory from request — planner tools use it when present.
  const cwdMatch =
    input.request.match(/(?:绝对路径|absolute path)[：:\s]*([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i) ??
    input.request.match(/(?:工作目录|working dir(?:ectory)?)[^\n]*?([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i)
  const taskWorkDir = cwdMatch ? cwdMatch[1].replace(/[/\\]+$/, "") : undefined

  const plannerTools = await filterAgentTools(createPlannerTools(taskWorkDir), "requirements")
  const outputToolKit = createRequirementsOutputTools()
  const extraTools = { ...plannerTools, ...outputToolKit.tools }
  const enableMap: Record<string, boolean> = Object.fromEntries(
    Object.keys(extraTools).map((name) => [name, true]),
  )

  if (input.signal?.aborted) throw new Error("requirements agent aborted before context prefetch")

  const context = prefetchContext(input.title, input.request)

  const systemPrompt = await requirementsSystem()
  const userPrompt = buildUserPrompt(input, context)

  await input.onStatus?.("Requirements agent starting")

  log.info("requirements agent starting", {
    title: input.title,
    model: model.id,
  })

  const childSession = await Session.createNext({
    kind: "requirements",
    parentID: input.parentSessionID,
    title: `Requirements: ${input.title}`,
    directory: Instance.directory,
  })

  const parts = await buildPromptParts(userPrompt, input.attachments)

  let finalMessage: Message.WithParts | undefined
  await SessionPrompt.withExtraTools(childSession.id, extraTools, async () => {
    finalMessage = (await SessionPrompt.prompt({
      sessionID: childSession.id,
      model: { providerID: model!.providerID, modelID: model!.api.id },
      agent: "requirements",
      system: systemPrompt,
      tools: enableMap,
      format: {
        type: "json_schema",
        schema: z.toJSONSchema(RequirementsFinalSchema) as Record<string, unknown>,
        retryCount: 2,
      },
      parts,
    })) as Message.WithParts
  })

  if (input.signal?.aborted) throw new Error("requirements agent aborted during prompt")
  if (!finalMessage) throw new Error("requirements agent: SessionPrompt.prompt returned no message")

  const structured = (finalMessage.info as Message.Assistant).structured as RequirementsFinal | undefined

  // Structured tool-call output is the only supported path. If the LLM did
  // not register any requirements via register_requirement, treat this as a
  // hard contract failure — there is no text-parsing fallback.
  const collector = outputToolKit.getCollector()
  if (collector.requirements.length === 0) {
    throw new Error(
      `requirements agent produced no requirements via register_requirement ` +
      `(structuredMissing=${!structured}). ` +
      `The orchestrator LLM must decide whether to re-invoke requirements, modify the ` +
      `task prompt, or fail the task — no coded retry loop.`,
    )
  }

  const parsed = collectorToOutput(collector, structured)
  log.info("requirements agent output", {
    requirements: parsed.requirements.length,
    decisions: parsed.decisions.length,
    structuredMissing: !structured,
  })

  const result = toResult(parsed)

  // Seed Decision Log with foundational decisions
  if (input.decisionLog && result.decisions.length > 0) {
    for (const decision of result.decisions) {
      input.decisionLog.append({
        phase: "requirements",
        key: decision.key,
        value: decision.value,
        reason: decision.reason,
      })
    }
  }

  return result
}

// ---------------------------------------------------------------------------
// Convert parsed output to RequirementsResult
// ---------------------------------------------------------------------------

function toResult(parsed: RequirementsOutput): RequirementsResult {
  return {
    summary: parsed.summary || "Requirements parsed",
    requirements: parsed.requirements,
    decisions: parsed.decisions,
  }
}

// ---------------------------------------------------------------------------
// Convert structured collector → RequirementsOutput
// ---------------------------------------------------------------------------

function collectorToOutput(
  collector: RequirementsCollector,
  final?: RequirementsFinal,
): RequirementsOutput {
  return {
    summary: final?.summary ?? "",
    requirements: collector.requirements.map((r) => ({
      id: r.id,
      type: r.type,
      description: r.description,
    })),
    decisions: collector.decisions.map((d) => ({
      key: d.key,
      value: d.value,
      reason: d.reason,
    })),
  }
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

async function buildPromptParts(
  text: string,
  attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>,
) {
  const { multimodal, referenceOnly } = AttachmentStore.partition(attachments)
  const enrichedText = text + AttachmentStore.renderReferenceList(referenceOnly)
  const fileParts = await AttachmentStore.loadFileParts(multimodal)

  const parts: Array<
    | { type: "text"; text: string }
    | { type: "file"; url: string; mime: string; filename?: string }
  > = [{ type: "text", text: enrichedText }]

  for (const fp of fileParts) {
    if ("image" in fp && fp.image) {
      const data = typeof fp.image === "string" ? fp.image : undefined
      if (data) parts.push({ type: "file", url: data, mime: "image/*" })
      continue
    }
    if ("file" in fp && fp.file) {
      const f = fp.file as { data?: string | Uint8Array; mediaType?: string; filename?: string }
      if (typeof f.data === "string") {
        parts.push({ type: "file", url: f.data, mime: f.mediaType ?? "application/octet-stream", filename: f.filename })
      } else if (f.data instanceof Uint8Array) {
        const base64 = Buffer.from(f.data).toString("base64")
        const mime = f.mediaType ?? "application/octet-stream"
        parts.push({
          type: "file",
          url: `data:${mime};base64,${base64}`,
          mime,
          filename: f.filename,
        })
      }
    }
  }

  return parts.map((p) => ({ ...p, id: Identifier.ascending("part") }))
}

function buildUserPrompt(
  input: {
    title: string
    request: string
    designSpecs?: VisualSpec[]
    taskID?: string
  },
  prefetched: string,
): string {
  const sections: string[] = []

  sections.push(`# Task\n\nTitle: ${input.title}\n\nRequest:\n${input.request}`)

  if (input.designSpecs && input.designSpecs.length > 0) {
    sections.push(renderVisualContractPromptSection({ specs: input.designSpecs }))
  }

  if (prefetched?.trim()) {
    sections.push(prefetched)
  }

  if (input.taskID) {
    const clarifications = clarificationTranscriptSection(input.taskID)
    if (clarifications) sections.push(clarifications)
    const operatorNotes = operatorNotesSection(input.taskID)
    if (operatorNotes) sections.push(operatorNotes)
  }

  sections.push(buildMirrorToolsPromptSection({ cwd: Instance.directory }))

  sections.push(
    "Parse the user request. Call register_requirement per REQ-N entry, " +
      "register_decision per foundational decision (runtime / backend / test framework). " +
      "Then call the StructuredOutput tool exactly once with the terminal `summary` field " +
      "to close the analysis.",
  )

  return sections.join("\n\n")
}

async function requirementsSystem(): Promise<string> {
  const config = await Config.get()
  const userAppend = (config.agent as Record<string, any> | undefined)?.["requirements"]?.prompt
  const core = typeof userAppend === "string" && userAppend.trim().length > 0
    ? REQUIREMENTS_CORE + "\n\n" + userAppend
    : REQUIREMENTS_CORE
  const orchCfg = await EngineConfig.get()
  const skills = await loadStageSkills(orchCfg.requirements.skills, "requirements")
  return core + skills
}
