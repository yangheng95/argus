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
 * ✓ Emits specs via register_*_spec tools; terminal design_system / tech_stack
 *   arrive via SessionLoop's StructuredOutput (DesignFinalSchema).
 *
 * Phase 3-b migration (specs/new-arch/16-unified-teardown.md §7-3): runs via
 * SessionPrompt.prompt + extraTools instead of AgentRuntime.run + a private
 * finalize_design_requirements tool. The multimodal attachments are threaded
 * through SessionPrompt.prompt's parts array; live URL capture and
 * read-attachment stay as agent-scoped extras.
 */
import z from "zod"
import type { TextHooks } from "@/llm/api"
import { createPlannerTools } from "@/planner/tools"
import { filterAgentTools } from "@/agent/filter-tools"
import { Log } from "@/util/log"
import { AttachmentStore } from "@/storage/attachment-store"
import { resolveAgentModel } from "@/agent/model"
import { EngineConfig } from "@/engine"
import { loadStageSkills } from "@/engine/skill-inject"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { Provider } from "@/provider/provider"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import type { Message } from "@/session/message"
import { Identifier } from "@/id/id"
import { pathToFileURL } from "bun"
import type { VisualSpec } from "./types"
import { createDesignOutputTools, DesignFinalSchema, type DesignFinal } from "./output-tools"
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

  export interface AnalyzeInput {
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
    /** Parent session — a child "design-analyst" session is created under it. */
    parentSessionID?: string
    /** Explicit model override (provider/model). Skips `resolveAgentModel`. */
    model?: { providerID: string; modelID: string }
    signal?: AbortSignal
    /** Legacy passthrough; no longer wired. Kept on the signature so callers
     *  do not have to churn. Smoke tests must drive streams through the
     *  session's own bus subscriptions. */
    stream?: TextHooks
    onStatus?: (summary: string) => void | Promise<void>
  }

  export async function analyze(input: AnalyzeInput): Promise<Result> {
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

async function run(input: DesignAnalystAgent.AnalyzeInput): Promise<DesignAnalystAgent.Result> {
  if (input.signal?.aborted) throw new Error("design analyst aborted before start")

  let model: Awaited<ReturnType<typeof resolveAgentModel>> | undefined
  if (input.model) {
    model = await Provider.getModel(input.model.providerID, input.model.modelID).catch(() => undefined)
  } else {
    model = await resolveAgentModel("design-analyst", { taskID: input.taskID }).catch(() => undefined)
  }
  if (!model) throw new Error("no LLM model available for design-analyst agent")

  if (input.signal?.aborted) throw new Error("design analyst aborted after model resolution")

  const plannerTools = await filterAgentTools(createPlannerTools(), "design-analyst")
  const screenshotToolKit = createUrlScreenshotTool()
  const outputToolKit = createDesignOutputTools()
  const projectID = (() => {
    try {
      return Instance.project.id
    } catch {
      return ""
    }
  })()
  const extraTools = {
    ...plannerTools,
    ...screenshotToolKit,
    ...createReadAttachmentTool(projectID),
    ...outputToolKit.tools,
  }
  const enableMap: Record<string, boolean> = Object.fromEntries(
    Object.keys(extraTools).map((name) => [name, true]),
  )

  if (input.signal?.aborted) throw new Error("design analyst aborted before LLM call")

  await input.onStatus?.("Design analyst: extracting visual contract")

  const systemPrompt = await designAnalystSystem()
  const userPrompt = buildUserPrompt(input)

  log.info("design analyst starting", {
    title: input.title,
    model: model.id,
    hasAttachments: !!input.attachments?.length,
    attachmentCount: input.attachments?.length ?? 0,
  })

  const childSession = await Session.createNext({
    kind: "design-analyst",
    parentID: input.parentSessionID,
    title: `Design: ${input.title}`,
    directory: Instance.directory,
  })

  const parts = await buildPromptParts(childSession.id, userPrompt, input.attachments)

  let finalMessage: Message.WithParts | undefined
  await SessionPrompt.withExtraTools(childSession.id, extraTools, async () => {
    finalMessage = (await SessionPrompt.prompt({
      sessionID: childSession.id,
      model: { providerID: model!.providerID, modelID: model!.api.id },
      agent: "design-analyst",
      system: systemPrompt,
      tools: enableMap,
      format: {
        type: "json_schema",
        schema: z.toJSONSchema(DesignFinalSchema) as Record<string, unknown>,
        retryCount: 2,
      },
      parts,
    })) as Message.WithParts
  })

  if (input.signal?.aborted) throw new Error("design analyst aborted during prompt")
  if (!finalMessage) throw new Error("design analyst: SessionPrompt.prompt returned no message")

  const structured = (finalMessage.info as Message.Assistant).structured as DesignFinal | undefined

  log.info("design analyst finished", {
    specs: outputToolKit.getSpecs().length,
    structuredMissing: !structured,
  })

  if (!structured) {
    throw new Error(
      "Design analyst agent did not finalize — StructuredOutput missing. " +
      "Check the model's tool-calling behavior or the design-analyst prompt.",
    )
  }

  return {
    specs: outputToolKit.getSpecs(),
    designSystem: structured.design_system,
    techStack: structured.tech_stack,
  }
}

/**
 * Build SessionPrompt-compatible message parts for the user turn.
 *
 * Text prompt comes first, then each multimodal attachment (images/PDFs)
 * lands as a FilePart. Text-like attachments are enumerated in the prompt
 * body itself as reference text so the LLM knows they exist (but actually
 * reads them via the read_attachment extra tool, not inline).
 */
async function buildPromptParts(
  sessionID: string,
  text: string,
  attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>,
) {
  const { multimodal, referenceOnly } = AttachmentStore.partition(attachments)
  const enrichedText = text + AttachmentStore.renderReferenceList(referenceOnly)
  const fileParts = await AttachmentStore.loadFileParts(multimodal)

  const parts: Array<
    | { type: "text"; text: string }
    | {
        type: "file"
        url: string
        mime: string
        filename?: string
      }
  > = [{ type: "text", text: enrichedText }]

  for (const fp of fileParts) {
    // AttachmentStore returns ai-sdk FilePart with `data` URL; our
    // PromptInput FilePart uses { url, mime }. The helper below rewrites
    // the payload so Session.saveMessage can persist the part without
    // trying to re-resolve a local file path.
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
    "observe must be a spec. Then call the StructuredOutput tool exactly once " +
    "with the terminal design_system + tech_stack fields to close the analysis.",
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

// pathToFileURL is imported for future use by callers that may want to
// convert local paths to attachments — it is a part of the AttachmentStore
// contract surface and keeping the import silences tree-shaking warnings.
void pathToFileURL
