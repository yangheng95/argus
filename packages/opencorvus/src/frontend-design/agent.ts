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
import fs from "node:fs/promises"
import path from "node:path"
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
import type { Tool } from "@/tool/tool"
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
import { generateWebCloneSkeletonProject, type GenerateWebCloneSkeletonProjectOutput } from "@/web-clone/skeleton-project-generator"

import FRONTEND_DESIGN_CORE from "@/prompt/core/frontend-design-core.txt"

const log = Log.create({ service: "frontend-design" })

const FRONTEND_SKELETON_ENTRYPOINTS = [
  "README.md",
  "index.html",
  "public/source.html",
  "src/App.jsx",
  "src/generated/singlefile-body.html",
  "src/generated/singlefile-head-styles.html",
  "src/slots.json",
  "reference.png",
]

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
      role: "visual_baseline_input" | "implementation_target" | "blocked"
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
    const skeletonProjectToolKit = createFrontendSkeletonProjectTool()
    const outputToolKit = createFrontendTemplateOutputTools({ autoIteration })
    const submitFrontendTemplateTool = selectFrontendTemplateSubmitTool(outputToolKit)
    const projectID = (() => {
      try {
        return Instance.project.id
      } catch {
        return ""
      }
    })()
    const hostPreparedFrontendProject = await maybeCreateHostPreparedFrontendProject()
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
          ...(hostPreparedFrontendProject ? {} : contextTools),
          ...acquisitionTools,
          ...(hostPreparedFrontendProject ? {} : createReadAttachmentTool(projectID)),
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
        shouldExposeOnlyTerminalTool: () => shouldScopeFrontendTemplateSubmitTool(!!hostPreparedFrontendProject),
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

function shouldScopeFrontendTemplateSubmitTool(hostPrepared = false): boolean {
  // When the host has already materialized web-clone-source and created the
  // frontend-design skeleton, the model's job is contract synthesis. Keeping
  // acquisition/browser tools open has repeatedly led to tool-loop bloat.
  return hostPrepared
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

function selectFrontendTemplateSubmitTool(outputToolKit: ReturnType<typeof createFrontendTemplateOutputTools>) {
  return {
    submit_frontend_template: outputToolKit.tools.submit_frontend_template,
  }
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
  const sections = [
    "# Delegation\n\nOrchestrator is asking frontend_design to produce the high-quality frontend project contract, frontend template, fillable modules, component inventory, material inventory, and visual/data contracts for this task. Raw extracted DOM/CSS can be materialized only as a visual baseline input; it is not the frontend_design deliverable project.",
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
        ? "These URL screenshot captures are stored for provenance but are not inlined into this prompt. Use the matched webpage reference skill to acquire any missing evidence once, then read the compact artifacts and write the frontend template. "
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

  sections.push(
    "If textual references (design tokens JSON, style-guide markdown, " +
    "brand-voice docs) appear in the attachment manifest, read them with " +
    "`read_attachment` — do NOT ignore or hallucinate their contents.",
  )

  sections.push(
    "# Live URL Capture\n\n" +
    "For visual webpage URLs, first check the host-prepared evidence at `mirror/prd-evidence-summary.md`, `mirror/source-ir/component-tree.json`, `mirror/source-ir/content-model.json`, `mirror/source-ir/layout-map.json`, `mirror/source-ir/style-tokens.json`, `mirror/source-ir/interaction-hints.json`, `mirror/source-skeleton/critical.css`, `mirror/visual-surface-candidates.json`, and the visible `web-clone-source/implementation-blueprint.md` package when present. Use `mirror/source-skeleton/index.html` only as raw evidence for exact hierarchy/source ids or missing text. " +
    "Use the matched webpage reference skill only if those files are missing or stale — not `webfetch` and not screenshot-only analysis. " +
    "After evidence exists, stop acquiring and read the compact artifacts before finalizing; never inline raw extraction JSON or stored URL screenshot base64 into the frontend template prompt. " +
    (autoIteration
        ? "Because assistant.auto_iteration=true, do at least two frontend template review passes before `submit_frontend_template`: first check page inventory and visual coverage, then check downstream frontend replica implementability. "
      : "Because assistant.auto_iteration=false, do one bounded frontend template review pass before `submit_frontend_template`; report remaining gaps in completeness_review/open_questions instead of looping automatically. ") +
    "For webpage replicas, after the visible `web-clone-source/` package exists, call `create_frontend_skeleton_project` to create a project-owned visual baseline input before `submit_frontend_template`. " +
    "Do not confuse that baseline with delivery: `frontend_project.role` must be `visual_baseline_input` when the project renders extracted DOM/CSS, and `quality_project_contract` must define the high-quality maintainable target project that downstream Build must produce. If SingleFile HTML is available in the source package, prefer it through the tool; otherwise create the baseline from source-skeleton and record the fidelity warning in `frontend_project.notes`. " +
    "Set `submit_frontend_template.final_delivery_mode` to `maintainable_replacement_required` whenever the user asks for maintainability, real implementation, component reuse, or replacing generated/mechanical output. " +
    "After the skeleton tool returns, do not read the generated `public/source.html`, `src/generated/singlefile-body.html`, or `src/generated/singlefile-head-styles.html` inside frontend_design; those large files are baseline inputs, not the maintainable delivery project. Record the paths and warnings from the tool output in `frontend_project` and finalize. " +
    "The final `submit_frontend_template.frontend_project` field must name the created baseline root and entrypoints, mark role=visual_baseline_input, or mark an explicit blocker. " +
    "Do not use todo or scratchpad tools for template review; write the review-pass findings directly into the final frontend template fields.",
  )

  if (hostPreparedFrontendProject) {
    sections.push(renderHostPreparedFrontendProjectSection(hostPreparedFrontendProject))
  }

  return sections.join("\n\n")
}

interface HostPreparedFrontendProject {
  status: "created" | "blocked"
  projectRoot: string
  sourcePackage: string
  entrypoints: string[]
  generationTool: string
  warnings: string[]
  error?: string
  compactEvidence: string
}

async function maybeCreateHostPreparedFrontendProject(): Promise<HostPreparedFrontendProject | undefined> {
  const sourcePackage = path.resolve(Instance.directory, "web-clone-source")
  try {
    const stat = await fs.stat(sourcePackage)
    if (!stat.isDirectory()) return undefined
  } catch {
    return undefined
  }

  const projectRoot = path.resolve(Instance.directory, "frontend-design-skeleton")
  try {
    const output = await generateWebCloneSkeletonProject({
      sourcePackageDir: sourcePackage,
      outputDir: projectRoot,
      overwrite: false,
    })
    return {
      ...hostPreparedProjectFromOutput(output),
      compactEvidence: await readHostPreparedCompactEvidence({ sourcePackage, projectRoot }),
    }
  } catch (err) {
    if (await hasExistingSkeletonProject(projectRoot)) {
      return {
        status: "created",
        projectRoot,
        sourcePackage,
        entrypoints: FRONTEND_SKELETON_ENTRYPOINTS,
        generationTool: "host-prepared:create_frontend_skeleton_project",
        warnings: ["Existing frontend-design-skeleton directory was reused."],
        compactEvidence: await readHostPreparedCompactEvidence({ sourcePackage, projectRoot }),
      }
    }
    return {
      status: "blocked",
      projectRoot,
      sourcePackage,
      entrypoints: [],
      generationTool: "host-prepared:create_frontend_skeleton_project",
      warnings: [],
      error: err instanceof Error ? err.message : String(err),
      compactEvidence: await readHostPreparedCompactEvidence({ sourcePackage, projectRoot }),
    }
  }
}

function hostPreparedProjectFromOutput(output: GenerateWebCloneSkeletonProjectOutput): HostPreparedFrontendProject {
  return {
    status: "created",
    projectRoot: output.outputDir,
    sourcePackage: output.sourcePackageDir,
    entrypoints: FRONTEND_SKELETON_ENTRYPOINTS,
    generationTool: "host-prepared:create_frontend_skeleton_project",
    warnings: output.warnings,
    compactEvidence: "",
  }
}

async function readHostPreparedCompactEvidence(input: { sourcePackage: string; projectRoot: string }): Promise<string> {
  const files = [
    { title: "implementation-blueprint.md", file: path.join(input.sourcePackage, "implementation-blueprint.md"), maxChars: 12_000 },
    { title: "web-clone-context.md", file: path.join(input.sourcePackage, "web-clone-context.md"), maxChars: 12_000 },
    { title: "web-clone-implementation-contract.json", file: path.join(input.sourcePackage, "web-clone-implementation-contract.json"), maxChars: 16_000 },
    { title: "source-ir/component-tree.json", file: path.join(input.sourcePackage, "source-ir", "component-tree.json"), maxChars: 24_000 },
    { title: "source-ir/content-model.json", file: path.join(input.sourcePackage, "source-ir", "content-model.json"), maxChars: 28_000 },
    { title: "source-ir/style-tokens.json", file: path.join(input.sourcePackage, "source-ir", "style-tokens.json"), maxChars: 12_000 },
    { title: "source-ir/interaction-hints.json", file: path.join(input.sourcePackage, "source-ir", "interaction-hints.json"), maxChars: 14_000 },
    { title: "visual-surface-candidates.json", file: path.join(input.sourcePackage, "visual-surface-candidates.json"), maxChars: 18_000 },
    { title: "source-ir/source-quality-audit.json", file: path.join(input.sourcePackage, "source-ir", "source-quality-audit.json"), maxChars: 4_000 },
    { title: "source-skeleton/source-skeleton-audit.json", file: path.join(input.sourcePackage, "source-skeleton", "source-skeleton-audit.json"), maxChars: 4_000 },
    { title: "frontend-design-skeleton/README.md", file: path.join(input.projectRoot, "README.md"), maxChars: 5_000 },
    { title: "frontend-design-skeleton/src/slots.json", file: path.join(input.projectRoot, "src", "slots.json"), maxChars: 18_000 },
  ]
  const sections: string[] = []
  for (const item of files) {
    const text = await fs.readFile(item.file, "utf8").catch(() => "")
    if (!text.trim()) continue
    const clipped = text.length > item.maxChars
      ? `${text.slice(0, item.maxChars).trimEnd()}\n\n[clipped: ${text.length - item.maxChars} chars omitted from ${item.title}]`
      : text.trimEnd()
    sections.push(`## ${item.title}\n${clipped}`)
  }
  return sections.join("\n\n")
}

async function hasExistingSkeletonProject(projectRoot: string): Promise<boolean> {
  const required = [
    "index.html",
    path.join("public", "source.html"),
    path.join("src", "App.jsx"),
    path.join("src", "generated", "singlefile-body.html"),
    path.join("src", "generated", "singlefile-head-styles.html"),
    path.join("src", "slots.json"),
  ]
  for (const relative of required) {
    try {
      const stat = await fs.stat(path.join(projectRoot, relative))
      if (!stat.isFile() || stat.size === 0) return false
    } catch {
      return false
    }
  }
  return true
}

function renderHostPreparedFrontendProjectSection(project: HostPreparedFrontendProject): string {
  const lines = [
    "# Host-Prepared Frontend Project",
    "",
    "The host already prepared the frontend-design visual baseline project before this model turn. Do not call `create_frontend_skeleton_project` again unless status is blocked and you can name a different output path.",
    "This is a terminal-only host-prepared turn: `read_file`, `list_files`, shell, browser, and mirror acquisition tools are intentionally unavailable. Use the compact evidence embedded below; attempting discovery tools is an error.",
    "Do not read the generated `public/source.html`, `src/generated/singlefile-body.html`, or `src/generated/singlefile-head-styles.html` in frontend_design; they are large baseline inputs, not the maintainable delivery project. Register these facts in `submit_frontend_template.frontend_project` with role=visual_baseline_input, then define the high-quality project deliverable in `quality_project_contract` / `quality_project_items`.",
    "",
    `- status: ${project.status}`,
    "- role: visual_baseline_input",
    `- project_root: ${project.projectRoot}`,
    `- source_package: ${project.sourcePackage}`,
    `- generation_tool: ${project.generationTool}`,
    `- entrypoints: ${project.entrypoints.join(", ") || "(none)"}`,
  ]
  if (project.warnings.length > 0) {
    lines.push("- warnings:")
    for (const warning of project.warnings) lines.push(`  - ${warning}`)
  }
  if (project.error) lines.push(`- error: ${project.error}`)
  if (project.compactEvidence.trim()) {
    lines.push("")
    lines.push("# Host-Prepared Compact Evidence")
    lines.push(project.compactEvidence.trim())
  }
  lines.push("")
  lines.push("# Mandatory Finalization")
  lines.push("Only `submit_frontend_template` is available in this host-prepared turn. Submit from the embedded compact evidence now; do not attempt more discovery.")
  lines.push("Because this is a maintainable replacement task, set `final_delivery_mode` to `maintainable_replacement_required`, include non-empty `baseline_replacement_plan` entries for generated baseline regions, and include `quality_project_contract` / `quality_project_items` that describe the GPT-class maintainable target project: semantic component files, data modules, style modules, mature-library integrations, runtime entrypoints, and verification commands.")
  return lines.join("\n")
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
  selectFrontendTemplateSubmitTool,
  shouldScopeFrontendTemplateSubmitTool,
}
