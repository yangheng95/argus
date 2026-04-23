/**
 * RequirementsAgent — parses a user task into REQ-N requirements + foundational
 * technical decisions (runtime / frameworks / test strategy). Seeds the
 * Decision Log with the decisions under phase="requirements" so downstream
 * agents build on the same foundation.
 *
 * This agent deliberately does NOT produce goals, metric specs, challenge
 * seeds, traceability, or cross-goal contracts — the Architect owns those.
 * The narrow surface is enforced by the tool list (register_requirement +
 * register_decision + finalize_requirements) and by the RequirementsResult
 * type shape.
 */
import { stepCountIs } from "ai"
import type { TextHooks } from "@/llm/api"
import { Provider } from "@/provider/provider"
import { createPlannerTools, prefetchContext } from "@/planner/tools"
import { filterAgentTools } from "@/agent/filter-tools"
import { Log } from "@/util/log"
import { toolGuard } from "@/util/tool-guard"
import { EngineConfig, clarificationTranscriptSection, operatorNotesSection } from "@/engine"
import { AttachmentStore } from "@/storage/attachment-store"
import { AgentRuntime } from "@/agent/runtime"
import { resolveAgentModel } from "@/agent/model"
import { loadStageSkills } from "@/engine/skill-inject"
import { Config } from "@/config/config"
import type { VisualSpec } from "@/design-analyst/types"
import { renderVisualContractPromptSection } from "@/design-analyst/prompt-section"
import { buildMirrorToolsPromptSection } from "@/prompt/mirror-tools"
import { Instance } from "@/project/instance"
import type {
  ParsedRequirement,
  RequirementsDecision,
  RequirementsOutput,
} from "./types"
import { createRequirementsOutputTools, type RequirementsCollector } from "./output-tools"
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
// Retry context — for re-running requirements analysis after failed execution
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// RequirementsAgent public API
// ---------------------------------------------------------------------------

export namespace RequirementsAgent {
  /**
   * Parse a task request into REQ-N requirements + foundational decisions.
   * Goal decomposition happens downstream in the Architect, not here.
   */
  export async function run(input: {
    title: string
    request: string
    /** Base64 image attachments — injected as vision content alongside the request text. */
    attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>
    /** Advisory visual contract produced by design_analysis. */
    designSpecs?: VisualSpec[]
    taskID?: string
    sessionID?: string
    signal?: AbortSignal
    stream?: TextHooks
    onStatus?: (summary: string) => void | Promise<void>
    /** Optional Decision Log — seeded with foundational decisions. */
    decisionLog?: DecisionLog
  }): Promise<RequirementsResult> {
    return runInternal(input)
  }
}

// ---------------------------------------------------------------------------
// Internal implementation
// ---------------------------------------------------------------------------

async function runInternal(input: {
  title: string
  request: string
  attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>
  designSpecs?: VisualSpec[]
  taskID?: string
  sessionID?: string
  signal?: AbortSignal
  stream?: TextHooks
  onStatus?: (summary: string) => void | Promise<void>
  decisionLog?: DecisionLog
}): Promise<RequirementsResult> {
  if (input.signal?.aborted) throw new Error("requirements agent aborted before model resolution")

  const orchCfg = await EngineConfig.get()
  const {
    max_steps: MAX_STEPS,
  } = orchCfg.requirements

  // Resolve model — per-agent model from Agent.Info (config: agent.requirements.model),
  // falling back to the user's most recent in-session model pick when no per-agent
  // override is configured.
  const model = await resolveAgentModel("requirements", { taskID: input.taskID }).catch(() => undefined)
  if (!model) throw new Error("no LLM model available for requirements agent")

  if (input.signal?.aborted) throw new Error("requirements agent aborted after model resolution")

  // Extract working directory from request
  const cwdMatch =
    input.request.match(/(?:绝对路径|absolute path)[：:\s]*([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i) ??
    input.request.match(/(?:工作目录|working dir(?:ectory)?)[^\n]*?([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i)
  const taskWorkDir = cwdMatch ? cwdMatch[1].replace(/[/\\]+$/, "") : undefined

  // Planner tools (codebase exploration) + structured output tools (REQ-N +
  // decisions). Each registration tool call is small (~500 bytes) — no
  // buffering risk.
  const plannerTools = await filterAgentTools(createPlannerTools(taskWorkDir), "requirements")
  const outputToolKit = createRequirementsOutputTools()
  const guard = toolGuard({ ...plannerTools, ...outputToolKit.tools })

  if (input.signal?.aborted) throw new Error("requirements agent aborted before context prefetch")

  const context = prefetchContext(input.title, input.request)

  const systemPrompt = await requirementsSystem()
  const initialPrompt = buildUserPrompt(input, context)
  const initialContent = await buildMultimodalContent(initialPrompt, input.attachments)
  const messages: any[] = [{ role: "user" as const, content: initialContent }]

  await input.onStatus?.("Requirements agent starting")

  log.info("requirements agent starting", {
    title: input.title,
    model: model.id,
  })

  // RequirementsAgent is always invoked nested: the caller (orchestrator or
  // requirements service) owns persistence via its own session-hooks and
  // forwards chunks through `input.stream`. We therefore wrap those into
  // a passthrough hooks object so AgentRuntime neither creates a duplicate
  // hooks nor requires a sessionID of its own.
  const passthroughHooks = {
    onChunk: input.stream?.onChunk,
    onError: input.stream?.onError,
    flush: async () => {},
    failures: { snapshot: () => ({ count: 0, items: [] as any[] }) },
  } as any
  const runResult = await AgentRuntime.run({
    agent: "requirements",
    model,
    system: systemPrompt,
    messages,
    tools: guard.tools,
    stopWhen: stepCountIs(MAX_STEPS),
    cacheKey: input.taskID ? `task-${input.taskID}-requirements` : undefined,
    sessionID: input.sessionID ?? "",
    taskID: input.taskID,
    stage: "requirements",
    signal: input.signal,
    hooks: passthroughHooks,
    policies: {
      // Caller-side hooks do their own failure accounting; don't let runtime
      // throw here — the caller will surface any persist errors.
      failurePolicy: "collect",
    },
  })

  log.info("requirements agent finished", {
    steps: runResult.steps.length,
    finishReason: runResult.finishReason,
    textLength: (runResult.text?.trim() || "").length,
    toolCalls: runResult.toolCallCount,
  })

  // Structured tool-call output is the only supported path. If the LLM did
  // not register any requirements via register_requirement, treat this as a
  // hard contract failure — there is no text-parsing fallback, and the old
  // `validateQuality` score gate that used a coded 0/0.25/0.5 formula to
  // drive silent retries was a deterministic decision on LLM output
  // (CLAUDE.md rule 23) and has been retired.
  const collector = outputToolKit.getCollector()
  if (collector.requirements.length === 0) {
    throw new Error(
      `requirements agent produced no requirements via register_requirement ` +
      `(toolCalls=${runResult.toolCallCount}, finishReason=${runResult.finishReason}). ` +
      `The orchestrator LLM must decide whether to re-invoke requirements, modify the ` +
      `task prompt, or fail the task — no coded retry loop.`,
    )
  }

  const parsed = collectorToOutput(collector)
  log.info("requirements agent output", {
    requirements: parsed.requirements.length,
    decisions: parsed.decisions.length,
    toolCalls: runResult.toolCallCount,
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

function collectorToOutput(collector: RequirementsCollector): RequirementsOutput {
  return {
    summary: collector.summary,
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
// Multimodal content builder
// ---------------------------------------------------------------------------

/**
 * Build an AI SDK content array from text + optional attachment references.
 * When no attachments are present, returns the plain string (more efficient).
 * Otherwise reads the bytes back from AttachmentStore (the canonical location
 * on disk) and emits base64 file parts alongside the text part.
 *
 * AI SDK FilePart: { type: "file", data: base64string, mediaType, filename? }
 */
async function buildMultimodalContent(
  text: string,
  attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>,
) {
  const { multimodal, referenceOnly } = AttachmentStore.partition(attachments)
  const enrichedText = text + AttachmentStore.renderReferenceList(referenceOnly)
  const fileParts = await AttachmentStore.loadFileParts(multimodal)
  if (fileParts.length === 0) return enrichedText
  return [{ type: "text" as const, text: enrichedText }, ...fileParts]
}

// ---------------------------------------------------------------------------
// User prompt
// ---------------------------------------------------------------------------

function buildUserPrompt(
  input: {
    title: string
    request: string
    designSpecs?: VisualSpec[]
    taskID?: string
  },
  context: string,
): string {
  const sections = [`# Task\n\nTitle: ${input.title}\n\nRequest:\n${input.request}`]

  sections.push(
    [
      "# Input Contract",
      "",
      "The task title and request above are the authoritative user input for this stage.",
      "If clarifications, operator notes, or visual contract sections appear below, they are also authoritative.",
      "Do NOT search the workspace for shadow copies of the request, benchmark prompt files, or `.opencorvus/intent/*`.",
      "Requirements runs before per-goal worktrees exist, so `.opencorvus/intent/*` is not part of this stage contract.",
    ].join("\n"),
  )

  sections.push(
    [
      "# Authority Order",
      "",
      "Use this precedence when recording foundational decisions:",
      "1. The user's explicit request text.",
      "2. Answered clarifications and operator notes.",
      "3. The advisory visual contract for UI constraints.",
      "4. Existing repo evidence such as package.json, lockfiles, and current scaffolds.",
      "",
      "Concrete stack or deliverable answers from clarifications/operator notes outrank existing package.json dependencies, framework scaffolds, and prior assumptions.",
      "If the user explicitly chose a framework-free implementation, record that exact choice instead of upgrading it to the repo's current frontend scaffold.",
    ].join("\n"),
  )

  if (input.taskID) {
    const clarifications = clarificationTranscriptSection(input.taskID)
    if (clarifications) sections.push(clarifications)
    const notes = operatorNotesSection(input.taskID)
    if (notes) sections.push(notes)
  }

  if (input.designSpecs && input.designSpecs.length > 0) {
    sections.push(renderVisualContractPromptSection({
      specs: input.designSpecs,
      instructions: [
        "The following advisory visual constraints came from design_analysis.",
        "Convert them into concrete frontend / interaction requirements where relevant.",
        "Do not ignore them, and do not re-invent conflicting UI requirements.",
      ],
    }))
  }

  if (context) {
    sections.push(`# Project Context (Pre-fetched)\n\n${context}`)
  }

  try {
    const mirrorSection = buildMirrorToolsPromptSection({ cwd: Instance.directory })
    if (mirrorSection.trim().length > 0) sections.push(mirrorSection)
  } catch {
    // Instance not initialised in rare test paths — skip, section is
    // advisory only.
  }

  sections.push(
    "Now parse every requirement in the user's request line by line " +
    "(explicit and implicit), record foundational technical decisions " +
    "(runtime, backend framework, test framework, …), then call " +
    "finalize_requirements. Goal decomposition happens downstream — do NOT " +
    "emit goals, metric specs, challenge seeds, or cross-goal contracts here.",
  )

  return sections.join("\n\n")
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const REQUIREMENTS_SYSTEM = REQUIREMENTS_CORE

async function requirementsSystem(): Promise<string> {
  // Single-source skill injection: the stage's CORE constant is always
  // present; `config.agent.requirements.prompt` is APPENDED (not replaced)
  // so user additions ride on top of the canonical base. Skills then append
  // via the one-and-only loadStageSkills path — no config field can bypass
  // it. See specs/new-arch/11-agent-oop-protocol.md for the contract.
  const config = await Config.get()
  const userAppend = (config.agent as Record<string, any> | undefined)?.requirements?.prompt
  const core = typeof userAppend === "string" && userAppend.trim().length > 0
    ? REQUIREMENTS_CORE + "\n\n" + userAppend
    : REQUIREMENTS_CORE
  const orchCfg = await EngineConfig.get()
  const skills = await loadStageSkills(orchCfg.requirements.skills, "requirements")
  return core + skills
}
