/**
 * Design Analyst Agent — produces a VisualSpec[] visual contract from
 * screenshots / mockups / live URLs.
 *
 * The specs are advisory. They land on `engine_task.design_specs` and are
 * rendered in the delivery agent's prompt as a checklist. There is no
 * automatic verification — delivery decides whether each spec was honored
 * when it does its adversarial visual review, and may cite a spec id in
 * `rejection_details.visual_spec_id` when a rejection traces back to one.
 *
 * Architecture constraints:
 * ✗ Cannot modify files or execute code
 * ✗ Cannot call other agents
 * ✓ Reads codebase to discover existing design patterns/component libraries
 * ✓ Works from multimodal attachments (screenshots, PDF) and the shared
 *   mirror cache at `mirror/extracted-page.json`; does NOT fetch URLs directly.
 * ✓ Emits specs via register_*_spec tools + finalize_design_requirements
 */
import { stepCountIs } from "ai"
import type { TextHooks } from "@/llm/api"
import { createPlannerTools } from "@/planner/tools"
import { filterAgentTools } from "@/agent/filter-tools"
import { Log } from "@/util/log"
import { toolGuard } from "@/util/tool-guard"
import { AttachmentStore } from "@/storage/attachment-store"
import { AgentRuntime } from "@/agent/runtime"
import { resolveAgentModel } from "@/agent/model"
import { EngineConfig } from "@/engine"
import { loadStageSkills } from "@/engine/skill-inject"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { buildMirrorToolsPromptSection } from "@/prompt/mirror-tools"
import type { VisualSpec } from "./types"
import { createDesignOutputTools } from "./output-tools"
import { createReadAttachmentTool } from "./read-attachment-tool"

import DESIGN_ANALYST_CORE from "@/prompt/core/design-analyst-core.txt"

const log = Log.create({ service: "design-analyst" })

export namespace DesignAnalystAgent {
  export interface Result {
    specs: VisualSpec[]
    designSystem: string
    techStack: string[]
  }

  export async function analyze(input: {
    title: string
    request: string
    /**
     * The complete visual input. Any URL the caller resolved is already
     * captured as a PNG attachment here (intent="visual_reference"). The
     * agent never receives raw URLs — that is a deliberate single-source
     * rule: the orchestrator side is responsible for turning URL / Figma /
     * material references into PNG bytes before calling analyze().
     */
    attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string; intent?: string; source?: string }>
    taskID?: string
    sessionID?: string
    signal?: AbortSignal
    stream?: TextHooks
    onStatus?: (summary: string) => void | Promise<void>
  }): Promise<Result> {
    return run(input)
  }

  /**
   * Render a VisualSpec[] into a prompt section suitable for delivery's
   * user-prompt "Design Contract (advisory)" block. Grouped by category,
   * bullet-listed with id + severity + title + requirement + applies_to.
   * Caller decides where to splice this into its prompt.
   */
  export function renderForDelivery(specs: readonly VisualSpec[], designSystem?: string): string {
    if (specs.length === 0) return ""
    const lines: string[] = []
    lines.push("# Design Contract (advisory — verify yourself during visual review)")
    lines.push("")
    lines.push(
      "Design-analyst extracted the following visual constraints from the reference(s). " +
      "These are CHECKLIST guidance, not automated rules — look at the rendered output and " +
      "judge each spec. When you reject on a visual issue that traces back to one of these " +
      "specs, cite its id in `rejection_details[].visual_spec_id`.",
    )
    if (designSystem && designSystem.trim()) {
      lines.push("")
      lines.push(`**Design system**: ${designSystem}`)
    }
    const categories: Array<VisualSpec["category"]> = [
      "color", "typography", "spacing", "layout", "component", "interaction", "responsive",
    ]
    for (const cat of categories) {
      const group = specs.filter((s) => s.category === cat)
      if (group.length === 0) continue
      lines.push("")
      lines.push(`## ${cat}`)
      for (const s of group) {
        const rat = s.rationale ? ` — ${s.rationale}` : ""
        lines.push(`- \`${s.id}\` [${s.severity}] **${s.title}**: ${s.requirement} @ ${s.applies_to}${rat}`)
      }
    }
    return lines.join("\n")
  }
}

async function run(input: {
  title: string
  request: string
  attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string; intent?: string; source?: string }>
  taskID?: string
  sessionID?: string
  signal?: AbortSignal
  stream?: TextHooks
  onStatus?: (summary: string) => void | Promise<void>
}): Promise<DesignAnalystAgent.Result> {
  if (input.signal?.aborted) throw new Error("design analyst aborted before start")

  const orchCfg = await EngineConfig.get()
  const { max_steps: MAX_STEPS, timeout_ms: TIMEOUT_MS } = orchCfg.design_analyst

  const model = await resolveAgentModel("design-analyst", { taskID: input.taskID })

  if (input.signal?.aborted) throw new Error("design analyst aborted after model resolution")

  const plannerTools = await filterAgentTools(createPlannerTools(), "design-analyst")
  const outputToolKit = createDesignOutputTools()
  const projectID = (() => {
    try { return Instance.project.id } catch { return "" }
  })()
  const guard = toolGuard({
    ...plannerTools,
    ...createReadAttachmentTool(projectID),
    ...outputToolKit.tools,
  })

  if (input.signal?.aborted) throw new Error("design analyst aborted before LLM call")

  await input.onStatus?.("Design analyst: extracting visual contract")

  const systemPrompt = await designAnalystSystem()
  const userPrompt = buildUserPrompt(input)
  const userContent = await buildMultimodalContent(userPrompt, input.attachments)

  log.info("design analyst starting", {
    title: input.title,
    model: model.id,
    hasAttachments: !!input.attachments?.length,
    attachmentCount: input.attachments?.length ?? 0,
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
    agent: "design-analyst",
    model,
    system: systemPrompt,
    messages: [{ role: "user" as const, content: userContent }],
    tools: guard.tools,
    stopWhen: stepCountIs(MAX_STEPS),
    cacheKey: input.taskID ? `task-${input.taskID}-design-analyst` : undefined,
    sessionID: input.sessionID ?? "",
    taskID: input.taskID,
    stage: "design-analyst",
    signal: AbortSignal.any(abortSignals),
    onStepFinish: guard.onStepFinish,
    hooks: passthroughHooks,
    policies: {
      progressTimeoutMs: TIMEOUT_MS,
      failurePolicy: "collect",
    },
  })

  log.info("design analyst finished", {
    steps: runResult.steps.length,
    finishReason: runResult.finishReason,
    toolCalls: runResult.toolCallCount,
  })

  if (!outputToolKit.isFinalized()) {
    log.warn("design analyst: finalize_design_requirements never passed", {
      taskID: input.taskID,
      toolCalls: runResult.toolCallCount,
      finishReason: runResult.finishReason,
      specCount: outputToolKit.getSpecs().length,
    })
    throw new Error(
      "Design analyst agent did not finalize — visual contract is incomplete. " +
      "Check the model's tool-calling behavior.",
    )
  }

  return {
    specs: outputToolKit.getSpecs(),
    designSystem: outputToolKit.getDesignSystem(),
    techStack: outputToolKit.getTechStack(),
  }
}

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

function buildUserPrompt(input: {
  title: string
  request: string
  attachments?: Array<{ filename?: string; mime: string; intent?: string; source?: string }>
}): string {
  const sections = [`# Task\n\nTitle: ${input.title}\n\nRequest:\n${input.request}`]

  const visualAttachments = (input.attachments ?? []).filter(
    (a) => (a.intent ?? "") === "visual_reference" || a.mime.startsWith("image/") || a.mime === "application/pdf",
  )
  if (visualAttachments.length > 0) {
    const lines = visualAttachments.map((a, i) => {
      const name = a.filename ?? `attachment-${i + 1}`
      const source = a.source ? ` — captured from ${a.source}` : ""
      return `${i + 1}. \`${name}\` (${a.mime})${source}`
    }).join("\n")
    sections.push(
      `# Visual References (already attached)\n\n${lines}\n\n` +
      "These files are attached to this message as multimodal content — read " +
      "the pixels directly. Do NOT try to fetch anything over the network. " +
      "Design-analyst has no webfetch / webpage_extract / network tool: the " +
      "orchestrator already turned every URL / Figma frame / local material " +
      "into one of these PNGs before dispatching you. Your whole job is to " +
      "derive the visual contract from what is in front of you.",
    )
  } else {
    sections.push(
      "# No visual references attached\n\n" +
      "No screenshots, mockups, or design materials were provided. Extract " +
      "the visual contract from the textual brief only; register specs that " +
      "can be inferred from the request wording (e.g. named brand palettes, " +
      "explicit typography, explicit component mentions). Do NOT invent " +
      "specifics that have no source in the brief.",
    )
  }

  sections.push(
    "If textual references (design tokens JSON, style-guide markdown, " +
    "brand-voice docs) appear in the attachment manifest, read them with " +
    "`read_attachment` — do NOT ignore or hallucinate their contents.",
  )

  try {
    const mirrorSection = buildMirrorToolsPromptSection({ cwd: Instance.directory })
    if (mirrorSection.trim().length > 0) sections.push(mirrorSection)
  } catch {
    // Instance not initialised — advisory section, skip.
  }

  sections.push(
    "Extract the visual contract as a list of advisory VisualSpec entries. " +
    "Use the register_*_spec tools per category (color / typography / spacing / " +
    "layout / component / interaction / responsive). Every exact value you can " +
    "observe must be a spec. Then call finalize_design_requirements.",
  )

  return sections.join("\n\n")
}

async function designAnalystSystem(): Promise<string> {
  // Single-source skill injection. `config.agent["design-analyst"].prompt`
  // appends to the canonical CORE; it cannot replace it. The skill loader
  // is the only injection path; no bypass field exists.
  const config = await Config.get()
  const userAppend = (config.agent as Record<string, any> | undefined)?.["design-analyst"]?.prompt
  const core = typeof userAppend === "string" && userAppend.trim().length > 0
    ? DESIGN_ANALYST_CORE + "\n\n" + userAppend
    : DESIGN_ANALYST_CORE
  const orchCfg = await EngineConfig.get()
  const skills = await loadStageSkills(orchCfg.design_analyst.skills, "design-analyst")
  return core + skills
}

