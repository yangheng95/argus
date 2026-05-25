/**
 * Design Analyst Agent — produces a mirror-grounded PRD/SPEC from screenshots /
 * mockups / live URLs.
 *
 * The submit_design_prd_spec payload lands in the design-analysis decision log
 * and is the authoritative contract for requirements, architect, build, and delivery.
 * `engine_task.design_specs` is no longer required for handoff; if present, it is
 * only a compact anchor list beside the PRD/SPEC.
 *
 * Architecture constraints:
 * ✗ Cannot modify files or execute code
 * ✗ Cannot call other agents
 * ✓ Reads codebase to discover existing design patterns/component libraries
 * ✓ Works from multimodal attachments (screenshots, PDF) and can capture a
 *   live webpage PNG via `url_screenshot` when the brief includes a visual URL.
 * ✓ Emits terminal PRD/SPEC fields via submit_design_prd_spec.
 *
 * Implementation: thin shell over `runAgentSession`. The runner owns
 * model / session / prompt-composition / abort / stream-error handling.
 */
import { runAgentSession } from "@/agent/runner"
import { withFactCheckRegistration } from "@/prompt/fragments/fact-check-registration"
import { createAgentContextTools } from "@/agent/context-tools"
import { filterAgentTools } from "@/agent/filter-tools"
import { Log } from "@/util/log"
import { AttachmentStore } from "@/storage/attachment-store"
import { renderUserRequestSection } from "@/intent/request-prompt"
import { Instance } from "@/project/instance"
import { deriveUrlSignals } from "@/engine/task-signals"
import { EngineConfig } from "@/engine/config"
import type { VisualSpec } from "./types"
import { createDesignOutputTools, type DesignOutputCollector } from "./output-tools"
import { createReadAttachmentTool } from "./read-attachment-tool"
import { createUrlScreenshotTool } from "./url-screenshot-tool"

import DESIGN_ANALYST_CORE from "@/prompt/core/design-analyst-core.txt"

const log = Log.create({ service: "design-analyst" })

export namespace DesignAnalystAgent {
  export interface Result {
    specs: VisualSpec[]
    designSystem: string
    techStack: string[]
    productSpec: string
    frontendSpec: string
    visualConsistencySpec: string
    backendSpec: string
    prdIterationNotes: string[]
    completenessReview: string
    referenceArtifacts: string[]
    openQuestions: string[]
  }

  export interface AnalyzeInput {
    title: string
    request: string
    /**
     * The complete visual input available at dispatch time. Callers may
     * have already resolved URLs into PNG attachments here
     * (intent="visual_reference"). The agent may additionally capture a
     * live http(s) webpage via its dedicated `url_screenshot` tool when
     * the brief contains an uncaptured visual URL, but it never uses
     * webfetch.
     */
    attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string; intent?: string; source?: string }>
    taskID?: string
    /** Parent session — a child "design-analyst" session is created under it. */
    parentSessionID?: string
    model?: { providerID: string; modelID: string }
    signal?: AbortSignal
    onStatus?: (summary: string) => void | Promise<void>
    onSessionCreated?: (sessionID: string) => void
  }

  export async function analyze(input: AnalyzeInput): Promise<Result & { sessionID: string }> {
    const autoIteration = (await EngineConfig.get()).auto_iteration === true
    const contextTools = await filterAgentTools(createAgentContextTools(), "design-analyst")
    const screenshotToolKit = createUrlScreenshotTool()
    const outputToolKit = createDesignOutputTools({ autoIteration })
    const submitDesignPrdSpecTool = selectDesignSubmitTool(outputToolKit)
    const projectID = (() => {
      try {
        return Instance.project.id
      } catch {
        return ""
      }
    })()
    const readAttachmentToolKit = createReadAttachmentTool(projectID)

    log.info("design analyst starting", {
      title: input.title,
      hasAttachments: !!input.attachments?.length,
      attachmentCount: input.attachments?.length ?? 0,
    })

    const out = await runAgentSession({
      kind: "design-analyst",
      core: withFactCheckRegistration([DESIGN_ANALYST_CORE, renderAutoIterationMode(autoIteration)].join("\n\n")),
      sessionTitle: `Design: ${input.title}`,
      parentSessionID: input.parentSessionID,
      taskID: input.taskID,
      model: input.model,
      signal: input.signal,
      onStatus: input.onStatus,
      onSessionCreated: input.onSessionCreated
        ? (session) => { input.onSessionCreated!(session.id) }
        : undefined,
      toolKit: {
        tools: {
          ...contextTools,
          ...screenshotToolKit,
          ...readAttachmentToolKit,
          ...submitDesignPrdSpecTool,
        },
        getCollector: () => outputToolKit.getCollector(),
        buildReport: () => outputToolKit.buildReport(),
      },
      buildUserPrompt: () => buildUserPrompt(input, autoIteration),
      buildUserParts: () => buildPromptParts(input, autoIteration),
      terminalTool: {
        toolName: "submit_design_prd_spec",
        isSatisfied: (collector: DesignOutputCollector) => !!collector.final,
        shouldExposeOnlyTerminalTool: shouldScopeDesignSubmitTool,
      },
    })

    const collector = out.collector as DesignOutputCollector
    const structured = collector.final
    const specs = collector.specs

    log.info("design analyst finished", {
      specs: specs.length,
      structuredMissing: !structured,
    })

    if (!structured) {
      throw new Error(
        "Design analyst agent did not finalize — submit_design_prd_spec missing. " +
        "Check the model's tool-calling behavior or the design-analyst prompt.",
      )
    }

    return {
      specs,
      designSystem: structured.design_system,
      techStack: structured.tech_stack,
      productSpec: structured.product_spec,
      frontendSpec: structured.frontend_spec,
      visualConsistencySpec: structured.visual_consistency_spec,
      backendSpec: structured.backend_spec,
      prdIterationNotes: structured.prd_iteration_notes,
      completenessReview: structured.completeness_review,
      referenceArtifacts: structured.reference_artifacts,
      openQuestions: structured.open_questions,
      sessionID: out.session.id,
    }
  }

  /**
   * Render optional VisualSpec anchors into a prompt section suitable for
   * integrity acceptance review's user-prompt "Design Contract" block.
   */
  export function renderForDelivery(specs: readonly VisualSpec[], designSystem?: string): string {
    if (specs.length === 0) return ""
    const lines: string[] = []
    lines.push("# Design Contract (verify yourself during visual review)")
    lines.push("")
    lines.push(
      "Design-analyst extracted the following visual constraints from the reference(s). " +
      "These are not automated scorer results — look at the rendered output and " +
      "verify each spec. When you reject on a visual issue that traces back to one of these " +
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

function shouldScopeDesignSubmitTool(): boolean {
  // PRD = Product Requirements Document; SPEC = implementation specification.
  // Design analysis must keep evidence-read tools available until the final
  // PRD/SPEC submission so it can read mirror artifacts and close gaps.
  return false
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

async function buildPromptParts(input: {
  title: string
  request: string
  attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string; intent?: string; source?: string }>
}, autoIteration = false) {
  const text = buildUserPrompt(input, autoIteration)
  const hasLiveHttpUrl = hasNonFigmaHttpUrl(input.request)
  const inlineAttachments = (input.attachments ?? []).filter((attachment) =>
    shouldInlineDesignAttachment(attachment, hasLiveHttpUrl),
  )
  const enrichedText = text + AttachmentStore.renderAttachmentInventory(inlineAttachments)
  const inlineParts = await AttachmentStore.inlineFileParts(inlineAttachments)
  return [{ type: "text" as const, text: enrichedText }, ...inlineParts]
}

function shouldInlineDesignAttachment(
  attachment: { source?: string },
  hasLiveHttpUrl: boolean,
): boolean {
  if (hasLiveHttpUrl && attachment.source === "url-screenshot") return false
  return true
}

function hasNonFigmaHttpUrl(text: string): boolean {
  return deriveUrlSignals(text).request_contains_url
}

function selectDesignSubmitTool(outputToolKit: ReturnType<typeof createDesignOutputTools>) {
  return {
    submit_design_prd_spec: outputToolKit.tools.submit_design_prd_spec,
  }
}

function renderAutoIterationMode(autoIteration: boolean): string {
  return [
    "## Auto Iteration Mode",
    autoIteration
      ? "- assistant.auto_iteration=true: perform at least two PRD/SPEC review passes before handoff when visual evidence is available."
      : "- assistant.auto_iteration=false: perform one bounded PRD/SPEC review pass before handoff; do not loop through additional PRD/SPEC revisions automatically.",
    "- In both modes, acquire missing mirror evidence at most once per source and finalize through `submit_design_prd_spec`.",
  ].join("\n")
}

function buildUserPrompt(input: {
  title: string
  request: string
  attachments?: Array<{ filename?: string; mime: string; intent?: string; source?: string }>
  taskID?: string
}, autoIteration = false): string {
  const sections = [
    "# Delegation\n\nOrchestrator is asking design-analysis to extract the visual contract for this task.",
    renderUserRequestSection({ heading: "# Task", title: input.title, request: input.request, taskID: input.taskID }),
  ]
  // URL presence is a *structural* detection (syntactic protocol scheme),
  // not a keyword policy: the agent decides whether to propose a
  // `url_screenshot` capture based on whether a web URL is even
  // available in the brief. Not a rule-11 violation.
  const hasLiveHttpUrl = hasNonFigmaHttpUrl(input.request)
  const figmaMcpAttachments = (input.attachments ?? []).filter((a) => a.source === "figma-mcp")
  if (figmaMcpAttachments.length > 0) {
    sections.push(
      "# Figma MCP Evidence\n\n" +
      "The Figma URL has already been materialized through the connected Figma MCP server. " +
      "Use the attached screenshot pixels plus the textual MCP artifacts in the attachment manifest as the source of truth. " +
      "Read markdown/text Figma MCP artifacts with `read_attachment` before submitting the PRD/SPEC. Do not call webpage tools for the Figma URL.",
    )
  }

  const visualAttachments = (input.attachments ?? []).filter(
    (a) => (a.intent ?? "") === "visual_reference" || a.mime.startsWith("image/") || a.mime === "application/pdf",
  )
  if (visualAttachments.length > 0) {
    const lines = visualAttachments.map((a, i) => {
      const name = a.filename ?? `attachment-${i + 1}`
      const source = a.source ? ` — captured from ${a.source}` : ""
      return `${i + 1}. \`${name}\` (${a.mime})${source}`
    }).join("\n")
    const allVisualsAreUrlScreenshots = visualAttachments.every((a) => a.source === "url-screenshot")
    const visualReferenceMode =
      hasLiveHttpUrl && allVisualsAreUrlScreenshots
        ? "These URL screenshot captures are stored for provenance but are not inlined into this prompt. Use the matched webpage reference skill to acquire any missing evidence once, then read the compact artifacts and write the PRD/SPEC. "
        : "These files are attached to this message as multimodal content — read the pixels directly. Do NOT use webfetch. Prefer these attached screenshots over re-capturing the same page. " +
          (hasLiveHttpUrl
            ? "If the brief includes an additional live http(s) webpage URL that is not already represented here, use the matched webpage reference skill to acquire missing evidence once before writing specs. "
            : "")
    sections.push(
      `# Visual References\n\n${lines}\n\n` +
      visualReferenceMode +
      "Your whole job is to derive the PRD/SPEC and visual-consistency contract from evidence, not taste.",
    )
  } else {
    sections.push(
      "# No visual references attached\n\n" +
      (hasLiveHttpUrl
        ? "No screenshots, mockups, or design materials were attached yet. If the request includes a live http(s) webpage URL, use the matched webpage reference skill to acquire missing evidence once. If evidence acquisition fails, report the exact failure; do not invent page facts. "
        : "No screenshots, mockups, or design materials were provided. ") +
      "Extract the PRD/SPEC from the textual brief only when no visual input is available. Do NOT invent " +
      "visual specifics that have no source in the brief.",
    )
  }

  sections.push(
    "If textual references (design tokens JSON, style-guide markdown, " +
    "brand-voice docs) appear in the attachment manifest, read them with " +
    "`read_attachment` — do NOT ignore or hallucinate their contents.",
  )

  sections.push(
    "# Live URL Capture\n\n" +
    "For visual webpage URLs, use the matched webpage reference skill — not `webfetch` and not screenshot-only analysis. " +
    "Acquire missing reference evidence once, then stop acquiring and read the compact artifacts before finalizing; never inline raw extraction JSON or stored URL screenshot base64 into the PRD/SPEC prompt. " +
    (autoIteration
      ? "Because assistant.auto_iteration=true, do at least two PRD/SPEC review passes before `submit_design_prd_spec`: first check page inventory and visual coverage, then check downstream frontend/backend implementability. "
      : "Because assistant.auto_iteration=false, do one bounded PRD/SPEC review pass before `submit_design_prd_spec`; report remaining gaps in completeness_review/open_questions instead of looping automatically. ") +
    "Do not use todo or scratchpad tools for PRD review; write the review-pass findings directly into the final PRD/SPEC fields.",
  )

  return sections.join("\n\n")
}

export const DesignAnalystTestHooks = {
  buildPromptParts,
  buildUserPrompt,
  selectDesignSubmitTool,
  shouldScopeDesignSubmitTool,
}
