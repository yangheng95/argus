/**
 * Frontend Design Agent - produces a mirror-grounded frontend template from
 * screenshots / mockups / live URLs.
 *
 * The submit_frontend_template payload lands in the frontend-design decision log
 * and is the authoritative frontend/source-handoff/visual contract for
 * requirements, architect, build, and delivery.
 * `engine_task.design_specs` is no longer required for handoff; if present, it is
 * only a compact anchor list beside the frontend template.
 *
 * Architecture constraints:
 * ✗ Cannot modify files or execute code
 * ✗ Cannot call other agents
 * ✓ Reads codebase to discover existing design patterns/component libraries
 * ✓ Works from multimodal attachments (screenshots, PDF) and can capture a
 *   live webpage PNG via `url_screenshot` when the brief includes a visual URL.
 * ✓ Emits terminal frontend template fields and the high-quality project
 *   contract via submit_frontend_template.
 *
 * Implementation: thin shell over `runAgentSession`. The runner owns
 * model / session / prompt-composition / abort / stream-error handling.
 */
import { tool, type ToolSet } from "ai"
import { runAgentSession } from "@/agent/runner"
import { withFactCheckRegistration } from "@/prompt/fragments/fact-check-registration"
import { createAgentContextTools } from "@/agent/context-tools"
import { filterAgentTools } from "@/agent/filter-tools"
import { Log } from "@/util/log"
import { AttachmentStore } from "@/storage/attachment-store"
import { renderUserRequestSection } from "@/intent/request-prompt"
import { Instance } from "@/project/instance"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { deriveUrlSignals } from "@/engine/task-signals"
import { EngineConfig } from "@/engine/config"
import type { Tool } from "@/tool/tool"
import type { AgentReport } from "@/agent/report"
import {
  WebpageAnalyzeTool,
  WebpageCompileTool,
  WebpageExtractTool,
  WebpageImageAnalyzeTool,
  WebpageImageCompileTool,
  WebpageImageExtractTool,
} from "@/mirror/tools"
import type { VisualSpec } from "./types"
import { createFrontendTemplateOutputTools, type FrontendTemplateFinal, type FrontendTemplateOutputCollector } from "./output-tools"
import { createReadAttachmentTool } from "./read-attachment-tool"
import { createUrlScreenshotTool } from "./url-screenshot-tool"
import { createFrontendSkeletonProjectTool } from "./skeleton-project-tool"
import {
  maybeCreateHostPreparedFrontendProject,
  readHostPreparedCompactEvidence,
  renderHostPreparedFrontendProjectSection,
  selectFrontendTemplateSubmitTool,
  summarizeHostPreparedSourceProject,
  summarizeReferencePixels,
  type HostPreparedFrontendProject,
} from "./host-prepared-source-project"

import FRONTEND_DESIGN_CORE from "@/prompt/core/frontend-design-core.txt"

const log = Log.create({ service: "frontend-design" })

export namespace FrontendDesignAgent {
  export interface Result {
    specs: VisualSpec[]
    designSystem: string
    techStack: string[]
    frontendTemplate: string
    finalDeliveryMode: FrontendTemplateFinal["final_delivery_mode"]
    fillableModules: string
    componentInventory: string
    componentReusePlan: FrontendTemplateFinal["component_reuse_plan"]
    baselineReplacementPlan: FrontendTemplateFinal["baseline_replacement_plan"]
    qualityProjectContract: string
    materialInventory: string
    frontendProject: {
      status: "created" | "not_created" | "blocked"
      role: "source_baseline_input" | "visual_baseline_input" | "implementation_target" | "blocked"
      project_root: string
      source_package: string
      entrypoints: string[]
      generation_tool: string
      notes: string[]
    }
    visualConsistencyContract: string
    uiDataContract: string
    templateIterationNotes: string[]
    completenessReview: string
    referenceArtifacts: string[]
    openQuestions: string[]
    report: AgentReport
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
    /** Parent session — a child "frontend-design" session is created under it. */
    parentSessionID?: string
    model?: { providerID: string; modelID: string }
    signal?: AbortSignal
    onStatus?: (summary: string) => void | Promise<void>
    onSessionCreated?: (sessionID: string) => void
  }

  export async function analyze(input: AnalyzeInput): Promise<Result & { sessionID: string }> {
    const autoIteration = (await EngineConfig.get()).auto_iteration === true
    const contextTools = await filterAgentTools(createAgentContextTools(), "frontend-design", {
      taskID: input.taskID,
      sessionID: input.parentSessionID,
    })
    const mirrorAnalysisTools = await createMirrorAnalysisTools({ taskID: input.taskID, signal: input.signal })
    const screenshotToolKit = createUrlScreenshotTool()
    const skeletonProjectToolKit = createFrontendSkeletonProjectTool({ taskID: input.taskID })
    const outputToolKit = createFrontendTemplateOutputTools({ autoIteration })
    const hostPreparedFrontendProject = await maybeCreateHostPreparedFrontendProject(input.taskID)
    const textOnlyNoVisualSource = isTextOnlyNoVisualSource(input)
    const submitFrontendTemplateTool = selectFrontendTemplateSubmitTool(
      outputToolKit,
      hostPreparedFrontendProject,
      textOnlyNoVisualSource ? { textOnlyBrief: { title: input.title, request: input.request } } : {},
    )
    const terminalOnlySubmit = shouldScopeFrontendTemplateSubmitTool({
      hostPrepared: !!hostPreparedFrontendProject,
      textOnlyNoVisualSource,
    })
    const projectID = (() => {
      try {
        return Instance.project.id
      } catch {
        return ""
      }
    })()
    const acquisitionTools = hostPreparedFrontendProject
      ? {}
      : {
          ...mirrorAnalysisTools,
          ...screenshotToolKit,
          ...skeletonProjectToolKit,
        }

    log.info("frontend design starting", {
      title: input.title,
      hasAttachments: !!input.attachments?.length,
      attachmentCount: input.attachments?.length ?? 0,
    })

    const out = await runAgentSession({
      kind: "frontend-design",
      core: withFactCheckRegistration([FRONTEND_DESIGN_CORE, renderAutoIterationMode(autoIteration)].join("\n\n")),
      sessionTitle: `Frontend design: ${input.title}`,
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
          ...(terminalOnlySubmit ? {} : hostPreparedFrontendProject ? {} : contextTools),
          ...(terminalOnlySubmit ? {} : acquisitionTools),
          ...(terminalOnlySubmit ? {} : hostPreparedFrontendProject ? {} : createReadAttachmentTool(projectID)),
          ...submitFrontendTemplateTool,
        },
        getCollector: () => outputToolKit.getCollector(),
        buildReport: () => outputToolKit.buildReport(),
      },
      buildUserPrompt: () => buildUserPrompt(input, autoIteration, hostPreparedFrontendProject),
      buildUserParts: () => buildPromptParts(input, autoIteration, hostPreparedFrontendProject),
      terminalTool: {
        toolName: "submit_frontend_template",
        isSatisfied: (collector: FrontendTemplateOutputCollector) => !!collector.final,
        shouldExposeOnlyTerminalTool: () => terminalOnlySubmit,
      },
    })

    const collector = out.collector as FrontendTemplateOutputCollector
    const structured = collector.final
    const specs = collector.specs

    log.info("frontend design finished", {
      specs: specs.length,
      structuredMissing: !structured,
    })

    if (!structured) {
      throw new Error(
        "Frontend design agent did not finalize — submit_frontend_template missing. " +
        "Check the model's tool-calling behavior or the frontend-design prompt.",
      )
    }

    const report = outputToolKit.buildReport()

    return {
      specs,
      designSystem: structured.design_system,
      techStack: structured.tech_stack,
      frontendTemplate: structured.frontend_template,
      finalDeliveryMode: structured.final_delivery_mode,
      fillableModules: structured.fillable_modules,
      componentInventory: structured.component_inventory,
      componentReusePlan: structured.component_reuse_plan,
      baselineReplacementPlan: structured.baseline_replacement_plan,
      qualityProjectContract: structured.quality_project_contract,
      materialInventory: structured.material_inventory,
      frontendProject: structured.frontend_project,
      visualConsistencyContract: structured.visual_consistency_contract,
      uiDataContract: structured.ui_data_contract,
      templateIterationNotes: structured.template_iteration_notes,
      completenessReview: structured.completeness_review,
      referenceArtifacts: structured.reference_artifacts,
      openQuestions: structured.open_questions,
      report,
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
      "Frontend-design extracted the following visual constraints from the reference(s). " +
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

function shouldScopeFrontendTemplateSubmitTool(input: {
  hostPrepared?: boolean
  textOnlyNoVisualSource?: boolean
} = {}): boolean {
  // When the host has already materialized web-clone-source and created the
  // frontend-design skeleton, the model's job is contract synthesis. Keeping
  // acquisition/browser tools open has repeatedly led to tool-loop bloat.
  if (input.hostPrepared) return true
  // With no visual attachment and no live URL there is no reference evidence to
  // acquire. The only durable output frontend_design can produce is the public
  // report derived from the textual brief, so pin directly to the terminal tool.
  return input.textOnlyNoVisualSource === true
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

async function buildPromptParts(input: {
  title: string
  request: string
  attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string; intent?: string; source?: string }>
}, autoIteration = false, hostPreparedFrontendProject?: HostPreparedFrontendProject) {
  const text = buildUserPrompt(input, autoIteration, hostPreparedFrontendProject)
  const hasLiveHttpUrl = hasNonFigmaHttpUrl(input.request)
  const inlineAttachments = (input.attachments ?? []).filter((attachment) =>
    shouldInlineFrontendDesignAttachment(attachment, hasLiveHttpUrl),
  )
  const enrichedText = text + AttachmentStore.renderAttachmentInventory(inlineAttachments)
  const inlineParts = await AttachmentStore.inlineFileParts(inlineAttachments)
  return [{ type: "text" as const, text: enrichedText }, ...inlineParts]
}

function shouldInlineFrontendDesignAttachment(
  attachment: { source?: string },
  hasLiveHttpUrl: boolean,
): boolean {
  if (hasLiveHttpUrl && attachment.source === "url-screenshot") return false
  return true
}

function hasNonFigmaHttpUrl(text: string): boolean {
  return deriveUrlSignals(text).request_contains_url
}

function isTextOnlyNoVisualSource(input: {
  request: string
  attachments?: Array<{ mime: string; intent?: string }>
}): boolean {
  if (hasNonFigmaHttpUrl(input.request)) return false
  return !(input.attachments ?? []).some((attachment) =>
    (attachment.intent ?? "") === "visual_reference" ||
    attachment.mime.startsWith("image/") ||
    attachment.mime === "application/pdf"
  )
}

function renderAutoIterationMode(autoIteration: boolean): string {
  return [
    "## Auto Iteration Mode",
    autoIteration
      ? "- assistant.auto_iteration=true: perform at least two frontend template review passes before handoff when visual evidence is available."
      : "- assistant.auto_iteration=false: perform one bounded frontend template review pass before handoff; do not loop through additional frontend template revisions automatically.",
    "- In both modes, acquire missing mirror evidence at most once per source and finalize through `submit_frontend_template`.",
  ].join("\n")
}

function buildUserPrompt(input: {
  title: string
  request: string
  attachments?: Array<{ filename?: string; mime: string; intent?: string; source?: string }>
  taskID?: string
}, autoIteration = false, hostPreparedFrontendProject?: HostPreparedFrontendProject): string {
  const runtimePaths = input.taskID ? ProjectRuntimePaths.frontendDesignPaths("", input.taskID) : undefined
  const mirrorRef = runtimePaths?.mirrorRelative ?? ".opencorvus/runtime/tasks/<taskID>/frontend-design/mirror"
  const sourcePackageRef = runtimePaths?.sourcePackageRelative ?? ".opencorvus/runtime/tasks/<taskID>/frontend-design/web-clone-source"
  const skeletonProjectRef = runtimePaths?.skeletonProjectRelative ?? ".opencorvus/runtime/tasks/<taskID>/frontend-design/frontend-design-skeleton"
  const sections = [
    "# Delegation\n\nOrchestrator is asking frontend_design to produce the high-quality frontend project contract, frontend template, fillable modules, material inventory, visual/data contracts, known implementation problems, and downstream agent handoff notes for this task. Web-clone source artifacts are implementation seeds and visual evidence; keep the handoff anchored to source-region traceability instead of a standalone component checklist.",
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
      "Read markdown/text Figma MCP artifacts with `read_attachment` before submitting the frontend template. Do not call webpage tools for the Figma URL.",
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
        ? "These URL screenshot captures are stored for provenance but are not inlined into this prompt. Use the matched webpage reference skill to acquire any missing evidence once, then read the named source artifacts and write the frontend template. "
        : "These files are attached to this message as multimodal content — read the pixels directly. Do NOT use webfetch. Prefer these attached screenshots over re-capturing the same page. " +
          (hasLiveHttpUrl
            ? "If the brief includes an additional live http(s) webpage URL that is not already represented here, use the matched webpage reference skill to acquire missing evidence once before writing specs. "
            : "")
    sections.push(
      `# Visual References\n\n${lines}\n\n` +
      visualReferenceMode +
      "Your whole job is to derive the frontend template and visual-consistency contract from evidence, not taste.",
    )
  } else {
    sections.push(
      "# No visual references attached\n\n" +
      (hasLiveHttpUrl
        ? "No screenshots, mockups, or design materials were attached yet. If the request includes a live http(s) webpage URL, use the matched webpage reference skill to acquire missing evidence once. If evidence acquisition fails, report the exact failure; do not invent page facts. "
        : "No screenshots, mockups, or design materials were provided. ") +
      "Extract the frontend design/replica contract from the textual brief only when no visual input is available. Do NOT invent " +
      "visual specifics that have no source in the brief.",
    )
  }

  if (isTextOnlyNoVisualSource(input)) {
    sections.push(
      "# Text-only frontend_design turn\n\n" +
      "No visual attachment, PDF, or live webpage URL is available in this delegation. " +
      "Do not inspect repository files or call acquisition tools for this turn. " +
      "Produce the public frontend_design report directly from the textual brief, and put uncertainty in `completeness_review` / `open_questions` instead of looping for missing evidence.",
    )
  }

  sections.push(
    "If textual references (design tokens JSON, style-guide markdown, " +
    "brand-voice docs) appear in the attachment manifest, read them with " +
    "`read_attachment` — do NOT ignore or hallucinate their contents.",
  )

  sections.push(
    "# Live URL Capture\n\n" +
    `For visual webpage URLs, first check the host-prepared task-runtime evidence at \`${mirrorRef}/prd-evidence-summary.md\`, \`${mirrorRef}/source-ir/component-tree.json\`, \`${mirrorRef}/source-ir/content-model.json\`, \`${mirrorRef}/source-ir/layout-map.json\`, \`${mirrorRef}/source-ir/style-tokens.json\`, \`${mirrorRef}/source-ir/interaction-hints.json\`, \`${mirrorRef}/source-skeleton/critical.css\`, \`${mirrorRef}/visual-surface-candidates.json\`, and the task-runtime source package \`${sourcePackageRef}/implementation-blueprint.md\` when present. Use \`${mirrorRef}/source-skeleton/index.html\` only as raw evidence for exact hierarchy/source ids or missing text. ` +
    "Use the matched webpage reference skill only if those files are missing or stale — not `webfetch` and not screenshot-only analysis. " +
    "After evidence exists, stop acquiring and read the named source artifacts before finalizing; never inline raw extraction JSON or stored URL screenshot base64 into the frontend template prompt. " +
    (autoIteration
        ? "Because assistant.auto_iteration=true, do at least two frontend template review passes before `submit_frontend_template`: first check page inventory and visual coverage, then check downstream frontend replica implementability. "
      : "Because assistant.auto_iteration=false, do one bounded frontend template review pass before `submit_frontend_template`; report remaining gaps in completeness_review/open_questions instead of looping automatically. ") +
    `For webpage replicas, after the task-runtime source package \`${sourcePackageRef}/\` exists, call \`create_frontend_skeleton_project\` to create the high-fidelity editable source project at \`${skeletonProjectRef}/\` before \`submit_frontend_template\`. ` +
    "The source project is the implementation starting point: downstream Build should copy/adapt its React entrypoints, source-dom region files, generated DOM JSX, CSS sidecars, SVG path data, FAQ/replacement-plan sidecars, public assets, data arrays, and asset references, then refine named regions in place from `sourceDomReplacementPlan.ts`. If the generator cannot produce that high-fidelity source project, record the exact materialization defect in `frontend_project.notes`. " +
    "Describe this as rawproject source-region refactoring: all new components, styles, and data modules must trace to rawproject source nodes/regions/assets/reference screenshots, and replacement work must happen source-region by source-region. " +
    "When the target is an existing frontend project, inspect package manifests and obvious component/UI directories if tools are available, then tell downstream agents whether to add a route/page to the existing app, adopt the source baseline into the root app, or stop on a materialization blocker. " +
    "In principle, downstream implementation must reuse existing project components/design-system primitives first and mature maintained libraries second; custom code is limited to simple page-specific glue or micro-adjust layout/spacing. Charts, maps, tables, calendars, popovers, dialogs, menus, forms, virtualized lists, drag/drop, editors, rich media, and complex layouts require reusable project or library options when available. " +
    "Your final report should not be a component catalog. Put known problems, evidence gaps, extraction-vs-rewrite risk, source organization, debug commands, reuse decisions, PRD delta boundaries, and agent handoff notes into `quality_project_contract`, `completeness_review`, and `open_questions`; leave `component_inventory` empty unless the provider requires a legacy compatibility summary. " +
    renderFinalDeliveryModeInstruction(Boolean(hostPreparedFrontendProject)) + " " +
    "After the source project tool returns, record the project paths, replacement-plan sidecars, and warnings in `frontend_project`, and make the high-fidelity React project itself the frontend_design deliverable source seed. Downstream verification must include measured `webpage_evaluate` evidence and zero-finding `web_clone_source_audit` evidence before claiming final maintainability. Do not alter evaluators, other agent prompts, communication paths, or generated outputs to satisfy the report. " +
    "The final `submit_frontend_template.frontend_project` field should name the created source project root and entrypoints, mark role=source_baseline_input because Build starts from it, or record the materialization defect. " +
    "Do not use todo or scratchpad tools for template review; write the review-pass findings directly into the final frontend template fields.",
  )

  if (hostPreparedFrontendProject) {
    sections.push(renderHostPreparedFrontendProjectSection(hostPreparedFrontendProject))
  }

  return sections.join("\n\n")
}

function renderFinalDeliveryModeInstruction(hostPrepared: boolean): string {
  if (hostPrepared) {
    return [
      "For host-prepared webpage clone turns, frame the work as source-region refactoring of the captured rawproject.",
      "Set `submit_frontend_template.final_delivery_mode` to `maintainable_replacement_required` whenever the operator asks for maintainability, real implementation, component reuse, or replacement of generated/mechanical output.",
      "Use `visual_baseline_allowed` only when the operator explicitly accepts the captured source project as the final documented source debt; even then, require traceable project-owned structure rather than screenshot, iframe, or invented component output.",
    ].join(" ")
  }
  return "Set `submit_frontend_template.final_delivery_mode` to `maintainable_replacement_required` whenever the user asks for maintainability, real implementation, component reuse, or replacing generated/mechanical output."
}

async function createMirrorAnalysisTools(input: { taskID?: string; signal?: AbortSignal }): Promise<ToolSet> {
  const infos: Tool.Info[] = [
    WebpageExtractTool,
    WebpageCompileTool,
    WebpageAnalyzeTool,
    WebpageImageExtractTool,
    WebpageImageCompileTool,
    WebpageImageAnalyzeTool,
  ]
  const entries = await Promise.all(infos.map(async (info) => {
    const initialized = await info.init()
    return [info.id, tool({
      description: initialized.description,
      inputSchema: initialized.parameters,
      execute: async (args, options) => {
        const meta = (options as { opencorvus?: { sessionID?: string; messageID?: string; toolCallID?: string } } | undefined)?.opencorvus
        const abort = (options as { abortSignal?: AbortSignal } | undefined)?.abortSignal ?? input.signal ?? new AbortController().signal
        return initialized.execute(args as never, {
          sessionID: meta?.sessionID ?? "",
          messageID: meta?.messageID ?? "",
          callID: meta?.toolCallID,
          agent: "frontend-design",
          abort,
          messages: [],
          extra: { taskID: input.taskID },
          metadata: () => {},
          ask: async () => {},
        })
      },
    })] as const
  }))
  return Object.fromEntries(entries)
}

export const FrontendDesignTestHooks = {
  buildPromptParts,
  buildUserPrompt,
  createMirrorAnalysisTools,
  isTextOnlyNoVisualSource,
  selectFrontendTemplateSubmitTool,
  shouldScopeFrontendTemplateSubmitTool,
  readHostPreparedCompactEvidence,
  summarizeHostPreparedSourceProject,
  summarizeReferencePixels,
}
