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
 * ✓ Works from multimodal attachments (screenshots, PDF) and can capture a
 *   live webpage PNG via `url_screenshot` when the brief includes a visual URL.
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
import type { VisualSpec } from "./types"
import { createDesignOutputTools } from "./output-tools"
import { createReadAttachmentTool } from "./read-attachment-tool"
import { createUrlScreenshotTool } from "./url-screenshot-tool"

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
     * The complete visual input available at dispatch time. Callers may have
     * already resolved URLs into PNG attachments here (intent="visual_reference").
     * The agent may additionally capture a live http(s) webpage via its
     * dedicated `url_screenshot` tool when the brief contains an uncaptured
     * visual URL, but it never uses webfetch.
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
  const { max_steps: MAX_STEPS } = orchCfg.design_analyst

  const model = await resolveAgentModel("design-analyst", { taskID: input.taskID })

  if (input.signal?.aborted) throw new Error("design analyst aborted after model resolution")

  const plannerTools = await filterAgentTools(createPlannerTools(), "design-analyst")
  const screenshotToolKit = createUrlScreenshotTool()
  const outputToolKit = createDesignOutputTools()
  const projectID = (() => {
    try { return Instance.project.id } catch { return "" }
  })()
  const guard = toolGuard({
    ...plannerTools,
    ...screenshotToolKit,
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
    signal: input.signal,
    hooks: passthroughHooks,
    policies: {
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
  const hasLiveHttpUrl = /https?:\/\/\S+/i.test(input.request)

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
      "the pixels directly. Do NOT use webfetch. Prefer these attached " +
      "screenshots over re-capturing the same page. " +
      (hasLiveHttpUrl
        ? "If the brief includes an additional live http(s) webpage URL that is not already represented here, call `url_screenshot` first to capture it as a PNG. "
        : "") +
      "Your whole job is to derive the visual contract from what is in front of you.",
    )
  } else {
    sections.push(
      "# No visual references attached\n\n" +
      (hasLiveHttpUrl
        ? "No screenshots, mockups, or design materials were attached yet. If the request includes a live http(s) webpage URL, call `url_screenshot` first to capture a PNG visual reference. If capture fails, work from the textual brief only. "
        : "No screenshots, mockups, or design materials were provided. ") +
      "Extract the visual contract from the textual brief only when no visual input is available; register specs that " +
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

  sections.push(
    "# Live URL Capture\n\n" +
    "For visual webpage URLs, use `url_screenshot` — not `webfetch`. " +
    "`url_screenshot` returns a PNG as a multimodal tool result so you can inspect the pixels directly. " +
    "Do NOT use `webpage_extract`; that mirror pipeline belongs to later build-stage cloning work, not this design-analysis step.",
  )

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

