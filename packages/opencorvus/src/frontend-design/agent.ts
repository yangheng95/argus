/**
 * Frontend Design Agent - produces a mirror-grounded frontend template from
 * screenshots / mockups / live URLs.
 *
 * The submit_frontend_template payload lands in the frontend-design decision log
 * and is the authoritative frontend/source-handoff/visual contract for
 * requirements, architect, build, and acceptance.
 * `engine_task.design_specs` is no longer required for handoff; if present, it is
 * only a compact anchor list beside the frontend template.
 *
 * Architecture constraints:
 * ✓ May materialize frontend-design source projects through its own tools
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
import z from "zod"
import { runAgentSession } from "@/agent/runner"
import { withFactCheckRegistration } from "@/prompt/fragments/fact-check-registration"
import { createAgentContextTools } from "@/agent/context-tools"
import { Log } from "@/util/log"
import { AttachmentStore } from "@/storage/attachment-store"
import { renderUserRequestSection } from "@/intent/request-prompt"
import { Instance } from "@/project/instance"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { deriveUrlSignals } from "@/engine/task-signals"
import { EngineConfig } from "@/engine/config"
import type { Tool } from "@/tool/tool"
import { BashTool } from "@/tool/bash"
import { EditTool } from "@/tool/edit"
import { WriteTool } from "@/tool/write"
import { ApplyPatchTool } from "@/tool/apply_patch"
import { WebCloneSourceAuditTool } from "@/tool/web-clone-source-audit"
import type { AgentReport } from "@/agent/report"
import {
  WebpageAnalyzeTool,
  WebpageCompileTool,
  WebpageEvaluateTool,
  WebpageExtractTool,
  WebpageImageAnalyzeTool,
  WebpageImageCompileTool,
  WebpageImageExtractTool,
  WebpageRenderTool,
  WebpageRuntimeStateTool,
  WebpageTextDiffTool,
  WebpageVisionJudgeTool,
} from "@/mirror/tools"
import type { VisualSpec } from "./types"
import { createFrontendTemplateOutputTools, type FrontendTemplateFinal, type FrontendTemplateOutputCollector } from "./output-tools"
import { createReadAttachmentTool } from "./read-attachment-tool"
import { createUrlScreenshotTool } from "./url-screenshot-tool"
import { createFrontendSkeletonProjectTool } from "./skeleton-project-tool"
import {
  FRONTEND_DESIGN_CONTEXT_TOOL_IDS,
  FRONTEND_DESIGN_IMPLEMENTATION_TOOL_IDS,
  FRONTEND_DESIGN_MIRROR_ANALYSIS_TOOL_IDS,
  FRONTEND_DESIGN_SESSION_TOOL_IDS,
  FRONTEND_DESIGN_UTILITY_TOOL_IDS,
} from "./static-tools"
import {
  readHostPreparedCompactEvidence,
  renderHostPreparedFrontendProjectSection,
  summarizeHostPreparedSourceProject,
  summarizeHostPreparedSourceAudit,
  summarizeReferencePixels,
  type HostPreparedFrontendProject,
} from "./host-prepared-source-project"

import FRONTEND_DESIGN_CORE from "@/prompt/core/frontend-design-core.txt"

const log = Log.create({ service: "frontend-design" })

interface FrontendProcessTracePersistence {
  processTraceFile: string
  iterationStateFile: string
  pending: Promise<void>
}

const frontendProcessTracePersistence = new WeakMap<FrontendDesignAgent.ProcessTrace, FrontendProcessTracePersistence>()

export namespace FrontendDesignAgent {
  export interface ProcessTrace {
    version: 1
    purpose: "frontend-design-process-trace"
    events: ProcessTraceEvent[]
  }

  export interface ProcessTraceEvent {
    name: string
    status: "started" | "passed" | "failed"
    timestamp: string
    details?: Record<string, unknown>
  }

  export interface IterationState {
    version: 1
    purpose: "frontend-design-rawproject-iteration-state"
    completedReplacements: Array<Record<string, unknown>>
    blockedReplacements: Array<Record<string, unknown>>
    deferredReplacements: Array<Record<string, unknown>>
    remainingSourceDebt: string[]
    lastUpdated: string
  }

  export interface Result {
    specs: VisualSpec[]
    designSystem: string
    techStack: string[]
    frontendTemplate: string
    finalAcceptanceMode: FrontendTemplateFinal["final_acceptance_mode"]
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
    processTrace: ProcessTrace
    processTraceArtifact?: string
    iterationStateArtifact?: string
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
    const processTrace = createFrontendProcessTrace()
    await configureFrontendProcessTracePersistence(input.taskID, processTrace)
    const contextTools = createFrontendDesignContextTools()
    const mirrorAnalysisTools = await createMirrorAnalysisTools({ taskID: input.taskID, signal: input.signal }, processTrace)
    const implementationTools = await createFrontendImplementationTools({ taskID: input.taskID, signal: input.signal }, processTrace)
    const utilityTools = await createFrontendUtilityTools({ taskID: input.taskID, signal: input.signal }, processTrace)
    const screenshotToolKit = createUrlScreenshotTool()
    const skeletonProjectToolKit = createFrontendSkeletonProjectTool({
      taskID: input.taskID,
      onToolEvent: (event) => recordFrontendProcessEvent(processTrace, event),
    })
    const processTraceToolKit = createFrontendProcessTraceTools(processTrace)
    const outputToolKit = createFrontendTemplateOutputTools({ autoIteration })
    const submitFrontendTemplateTool = createFrontendSubmitTools(outputToolKit)
    const hostPreparedFrontendProject = await resolveHostPreparedFrontendProject(input.taskID)
    const projectID = (() => {
      try {
        return Instance.project.id
      } catch {
        return ""
      }
    })()
    const agentTools = {
      ...implementationTools,
      ...contextTools,
      ...screenshotToolKit,
      ...utilityTools,
      ...skeletonProjectToolKit,
      ...processTraceToolKit,
      ...mirrorAnalysisTools,
      ...createReadAttachmentTool(projectID),
      ...submitFrontendTemplateTool,
    }
    assertFrontendStaticToolSurface(agentTools)
    recordFrontendStaticToolSurface(processTrace, Object.keys(agentTools))
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
        tools: agentTools,
        getCollector: () => outputToolKit.getCollector(),
        buildReport: () => appendFrontendProcessTrace(outputToolKit.buildReport(), processTrace),
      },
      buildUserPrompt: () => buildUserPrompt(input, autoIteration, hostPreparedFrontendProject),
      buildUserParts: () => buildPromptParts(input, autoIteration, hostPreparedFrontendProject),
      terminalTool: {
        toolName: "submit_frontend_template",
        isSatisfied: (collector: FrontendTemplateOutputCollector) => !!collector.final,
        shouldExposeOnlyTerminalTool: () => false,
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

    const persistedArtifacts = await flushFrontendProcessTracePersistence(processTrace)
    const processTraceArtifact = persistedArtifacts?.processTraceArtifact ?? await writeFrontendProcessTraceArtifact(input.taskID, processTrace)
    const iterationStateArtifact = persistedArtifacts?.iterationStateArtifact ?? await writeFrontendIterationStateArtifact(input.taskID, processTrace)
    const report = appendFrontendProcessTrace(outputToolKit.buildReport(), processTrace, {
      processTraceArtifact,
      iterationStateArtifact,
    })

    return {
      specs,
      designSystem: structured.design_system,
      techStack: structured.tech_stack,
      frontendTemplate: structured.frontend_template,
      finalAcceptanceMode: structured.final_acceptance_mode,
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
      processTrace,
      processTraceArtifact,
      iterationStateArtifact,
      report,
      sessionID: out.session.id,
    }
  }

  /**
   * Render optional VisualSpec anchors into a prompt section suitable for
   * integrity acceptance review's user-prompt "Design Contract" block.
   */
  export function renderForAcceptance(specs: readonly VisualSpec[], designSystem?: string): string {
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
  const targetProjectRef = hostPreparedFrontendProject ? "." : "web-clone-target"
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
        ? "These URL screenshot captures are stored for provenance but are not inlined into this prompt. Use the task-runtime webpage evidence and mirror analysis tools for any missing evidence, then read the named source artifacts and write the frontend template. "
        : "These files are attached to this message as multimodal content — read the pixels directly. Do NOT use webfetch. Prefer these attached screenshots over re-capturing the same page. " +
          (hasLiveHttpUrl
            ? "If the brief includes an additional live http(s) webpage URL that is not already represented here, use the mirror analysis tools to acquire missing evidence once before writing specs. "
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
        ? "No screenshots, mockups, or design materials were attached yet. If the request includes a live http(s) webpage URL, use the mirror analysis tools to acquire missing evidence once. If evidence acquisition fails, report the exact failure; do not invent page facts. "
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
    "# Target Acceptance Project Contract\n\n" +
    `Default target acceptance project root: \`${targetProjectRef}\`. ` +
    "If the workspace already contains a real frontend app, inspect and use that existing app as the target. Root files alone are not a real frontend app: benchmark workspaces often contain minimal `package.json`, `tsconfig.json`, `data/`, `.git/`, and `.opencorvus/` shell files without app source, and those shell files should not become the acceptance project. If no real app exists, create the runnable target app in the default target directory rather than inside `frontend-design-skeleton` or by overwriting root shell files. " +
    "Populate the target acceptance project directly with file-edit tools by copying/adapting the runnable baseline from `frontend-design-skeleton` first, then replacing selected regions. " +
    "After the skeleton exists, the first target-project editing pass is skeleton-baseline adoption: create/adapt `package.json`, `index.html`, `tsconfig.json`, `vite.config.ts`, `src/main.tsx`, the skeleton `src/App.tsx` entry wiring, baseline CSS/assets/data needed for render, and a README/source note that names the skeleton evidence source. This is not freehand scaffolding and not a directory-only setup command; it is the required runnable baseline copied from extracted source evidence into the target app. Do this before calling `record_frontend_region_selection` for a large region. Do not begin a new target with only isolated `src/components/*` and `src/data/*` files while package/config/entrypoints are missing. After baseline adoption, run install/build/render evidence against the target project and compare it with `reference.png`; do not build or render inside `frontend-design-skeleton`. Then call `record_frontend_region_selection` for the concrete source region being migrated. Target writes after selection must be owned by that selected region until `record_frontend_replacement_result` is called. The selected vertical slice means the selected component, its region-owned data/mock/API module when applicable, its scoped style/asset resolver module, and `App.tsx` wiring that replaces the corresponding baseline boundary. Further reads after selection must be limited to direct imports or explicitly named data/style/asset sidecars for that selected region; do not read unrelated skeleton page wrappers, footer/economy/FAQ/chart/list files, whole manifests, broad source data, or exhaustive asset/style catalogs before the selected component/data/style/App slice exists. Do not chase every `AssetPath`, `svgPaths`, `asset_*.path.txt`, CSS token, or `critical.css` variable before the first selected-region write; preserve observed asset IDs/token names through a target-owned resolver/data module and let same-region render/audit feedback drive exact path/token repair. Selection starts a source-migration transaction, not another open-ended exploration pass. One region selection authorizes edits only for that named source region's data, component, style, assets, and App wiring. Do not call `record_frontend_region_selection` for another region until the current region has a factual `record_frontend_replacement_result`. A data module, mock fixture, or API adapter is not a neutral shared setup file during region extraction: it belongs to the currently selected region, must contain only data proven by that region's row/source evidence, and must not include footer/economy/news/calendar/FAQ/map/chart/card/list records from regions that have not been selected and recorded yet. App wiring is also region-scoped after baseline adoption: `src/App.tsx` may import and mount only the current region's component plus components whose regions already have completed replacement results; future region slots may be non-rendering comments/source debt only, never visible placeholder panels, fake spacers, `min-height` filler, placeholder text, or imports for components that are not actually implemented. Before writing files for a different source region such as footer, economy tables, news, calendar, FAQ, map, chart, or card/list groups, first record the current region result and then call `record_frontend_region_selection` for that next source region. Cross-region combined data indexes may be created only after each included region has its own completed replacement result. Do not write imports for future components; create each imported component/data/style module in the same source-coverage pass. Before styling the selected region, inspect `reference.png`/reference-pixel evidence and current-region style sidecars; visible pixels override generic site-theme assumptions. Later package/config edits are allowed only as integration changes after reading the exact target file; they must not replace the skeleton-baseline source with a blank scaffold. " +
    "When a target-root file already exists, read that exact file first with `read_file`, then edit or overwrite it; use direct `write` only for genuinely new target-project source files and assets, letting the write tool create their parent directories. " +
    "Default implementation stack for webpage replicas without an existing app contract: React + Vite + TypeScript with project-owned mock/API data modules. " +
    "Default scoped styling approach: CSS Modules or colocated project-owned CSS sidecars imported by semantic components; do not runtime-load raw source-site CSS bundles as the app styling system. " +
    `The final \`submit_frontend_template.frontend_project.project_root\` should be \`${targetProjectRef}\` when this default root is used, with entrypoints such as \`${targetProjectRef}/package.json\`, \`${targetProjectRef}/src/main.tsx\`, \`${targetProjectRef}/src/App.tsx\`, semantic component modules, data modules, style modules, and verification artifacts.`,
  )

  sections.push(
    "# Live URL Capture\n\n" +
    `For visual webpage URLs, first check the task-runtime evidence at \`${mirrorRef}/prd-evidence-summary.md\`, \`${mirrorRef}/source-ir/component-tree.json\`, \`${mirrorRef}/source-ir/content-model.json\`, \`${mirrorRef}/source-ir/layout-map.json\`, \`${mirrorRef}/source-ir/style-tokens.json\`, \`${mirrorRef}/source-ir/interaction-hints.json\`, \`${mirrorRef}/source-ir/interaction-state-snapshots.json\`, \`${mirrorRef}/source-skeleton/critical.css\`, \`${mirrorRef}/visual-surface-candidates.json\`, and the task-runtime source package \`${sourcePackageRef}/implementation-blueprint.md\` when present. Use \`${mirrorRef}/source-skeleton/index.html\` only as raw evidence for exact hierarchy/source ids or missing text. ` +
    "Use mirror analysis tools only if those files are missing or stale — not `webfetch`, not dynamic skills, and not screenshot-only analysis. " +
    "After evidence exists, stop acquiring and read the named source artifacts before finalizing; never inline raw extraction JSON or stored URL screenshot base64 into the frontend template prompt. " +
    (autoIteration
        ? "Because assistant.auto_iteration=true, do at least two frontend template review passes before `submit_frontend_template`: first check page inventory and visual coverage, then check downstream frontend replica implementability. "
      : "Because assistant.auto_iteration=false, do one bounded frontend template review pass before `submit_frontend_template`; report remaining gaps in completeness_review/open_questions instead of looping automatically. ") +
    `For webpage replicas, after the task-runtime source package \`${sourcePackageRef}/\` exists, call \`create_frontend_skeleton_project\` to create the high-fidelity skeleton evidence project at \`${skeletonProjectRef}/\` before \`submit_frontend_template\`. ` +
    `Pass \`${skeletonProjectRef}\` as the skeleton outputDir, or omit outputDir so the tool uses that default. Do not pass \`${targetProjectRef}\` or any target app root to \`create_frontend_skeleton_project\`. ` +
    "The generated skeleton project is frontend_design's source-evidence baseline, not the final worktree. Do not move, rename, install, build, render, or start a dev/preview server inside `frontend-design-skeleton` in maintainable acceptance. After creating it, inspect bounded entry evidence (`sourceProjectManifest.json`, `sourceDomIterationState.ts`, named `sourceDomReplacementPlan.ts` rows, source-region component files, and current-region data/style/asset excerpts) plus the target project component/package structure; then extract the skeleton's observed source structure, data, styles, and assets into the target acceptance project as project-owned semantic components/data modules/scoped styles. Build should receive the target project that frontend_design already populated, and only perform integration and precision fixes. If the generator cannot produce that high-fidelity source evidence project, record the exact materialization defect in `frontend_project.notes`. " +
    "Describe this as rawproject source-region refactoring: all new components, styles, and data modules must trace to rawproject source nodes/regions/assets/reference screenshots, and replacement work must happen source-region by source-region. " +
    "When the target is an existing frontend project, inspect package manifests and obvious component/UI directories if tools are available, then tell downstream agents whether to add a route/page to the existing app, adopt the source baseline into the root app, or stop on a materialization blocker. " +
    "In principle, downstream implementation must reuse existing project components/design-system primitives first and mature maintained libraries second; custom code is limited to simple page-specific glue or micro-adjust layout/spacing. Charts, maps, tables, calendars, popovers, dialogs, menus, forms, virtualized lists, drag/drop, editors, rich media, and complex layouts require reusable project or library options when available. " +
    "Your final report should not be a component catalog. Put known problems, evidence gaps, extraction-vs-rewrite risk, source organization, debug commands, reuse decisions, PRD delta boundaries, and agent handoff notes into `quality_project_contract`, `completeness_review`, and `open_questions`; leave `component_inventory` empty unless the provider requires a legacy compatibility summary. " +
    renderFinalAcceptanceModeInstruction(Boolean(hostPreparedFrontendProject)) + " " +
    "After the source project tool returns, record the skeleton evidence paths, replacement-plan sidecars, and warnings in `reference_artifacts` and `frontend_project.notes`, then read `sourceProjectManifest.json`, `sourceDomIterationState.ts`, and the bounded skeleton root files needed to adopt the target baseline. Treat `nextSourceDomReplacement` as the first source-region queue item only, not as permission to skip target baseline adoption. Before selecting a large region, copy/adapt the skeleton's runnable app baseline into the target acceptance project: `package.json`, `index.html`, `tsconfig.json`, `vite.config.ts`, `src/main.tsx`, skeleton `src/App.tsx` entry wiring, baseline CSS/assets/data needed for render, and a README/source note. Before any install/build/render/server command, create or populate that target acceptance project and perform all runnable commands there, never in `frontend-design-skeleton`. Run the baseline build/render/visual comparison first so later source-region replacements have a measured visual baseline. Then use pre-selection browsing only for choosing the next source region: after the iteration state and candidate replacement-plan row identify a region, read that candidate component/row evidence and call `record_frontend_region_selection` immediately. The candidate component read is the last source component read before selection: do not read a second `src/components/source-dom/*` file, any `src/components/semantic/*` file, sibling semantic components, page wrappers, broad source-IR/style/data inventories, or root config files unless they are part of the already completed baseline adoption. Do not read `sourceData.ts`, `svgPaths.ts`, raw HTML, or generated CSS wholesale; use search/excerpt reads only for the current region's named data/style/asset evidence. For every in-scope replacement-plan row, call `record_frontend_region_selection` before editing, then use your normal file-edit tools to extract only that selected source region's source-dom/rawcode evidence into the target acceptance project with semantic components, data modules, scoped styles, mock/API adapters when data is visible, and owned assets. After selecting a row, do not continue open-ended reading: if the selected region source has already been read, write the target component/data/style/App slice next. Additional reads after selection must be direct imports or explicitly named data/style/asset sidecars for that same selected region, not unrelated skeleton wrappers, footer/economy/FAQ/chart/list files, whole manifests, broad source data, or exhaustive `AssetPath`/`svgPaths`/`asset_*.path.txt`/CSS-token scans. Preserve observed asset IDs/token names in target-owned resolver/data modules before exact path bodies or token values are fully chased; same-region render/audit evidence decides which unresolved asset/style details need repair. Target code must be a maintainable refactor of the selected source component/row: copy or transcribe the observed labels, numeric data, source IDs, class responsibilities, SVG paths/assets, and interaction states from that selected evidence into target modules; do not invent simplified SVGs, remembered menu labels, approximate table values, or generic site styling when the selected evidence has exact values. If the selected skeleton file is already semantic, first port that component faithfully into the target project before any redesign: preserve its data object shape, `rootSourceNodeId` or source-region metadata, `data-*`/ARIA attributes, class names including intentional spaces, wrapper nesting, `target`/`rel`, menu/dropdown/offer state fields, `AssetPath` or asset resolver usage, asset path references, circles, fills, viewBox/width/height, and helper component responsibilities. You may add types or split files. Do not flatten nested DOM. Do not replace asset references with guessed inline SVG paths. Do not drop source IDs, accessibility/state attributes, or simplify wrappers before target render and source-audit evidence proves the selected region still matches. Keep data/mock/API adapter files region-owned during extraction: if a file name sounds shared, its contents still must be limited to the selected region until other regions have their own recorded replacement results. If the selected row is navigation, do not create economy/table/news/footer data; if the selected row is an economy table, do not create navigation/footer data. Do not batch unrelated region files under a previous region selection; crossing to footer/economy/news/calendar/FAQ/map/chart/card/list work requires a fresh region selection after a factual result for the prior region. Once a region is selected, every filesystem-changing target edit must be owned by that selected region until `record_frontend_replacement_result` is called; writing footer, economy table, FAQ, map, chart, card/list, root data, or combined data files while `HeaderNavigation` is the selected region is off-region work. App imports are part of the same region ownership after baseline adoption: do not import components or data modules for regions that have not been created in the current pass or completed earlier. Do not implement by freehand redrawing, and do not use the skeleton project itself as the final work area. For charts, maps, calendars, tables, or other complex controls, use source data/assets and an existing project component or mature maintained library when applicable; if you cannot build the real control from source evidence in the current pass, record blocked/deferred source debt instead of rendering a labeled placeholder box. After each replacement, build the target project, use one explicit running target URL, call `webpage_render` for that URL, compare the rendered region against `reference.png` using `webpage_evaluate`, call `webpage_vision_judge` for visual/semantic mismatches such as wrong light/dark theme, density, alignment, missing controls, placeholder UI, or fake spacers, then repair the same region before selecting another region. If a server is needed, start one target server for one chosen URL and then immediately call `webpage_render`; with the `bash` tool, long-lived Vite/dev/preview servers must be started by passing the tool parameter `background: true` and the command string itself must not contain shell background operators such as `&`. Reuse the returned PID/URL for render evidence; if curl succeeds inside the start command but `webpage_render` gets connection refused afterward, the server was short-lived and must be restarted once with `background: true`, not replaced by multiple host/port/server experiments. Do not try multiple dev/preview/Python/Vite servers, do not call `skill` for visual verification, and do not use shell listings or build success as visual evidence. After that evidence exists, call `record_frontend_replacement_result` with completed/blocked/deferred status, changed target-project files, evidence artifacts, remaining source debt, and the next region. Do not record completed for target source that still contains placeholder UI/text/classes, fake `min-height` filler, or rendered future-region filler. Do not describe a build as final while `remainingSourceDebt` is non-empty; it is only the current region's build. Verification must include target project build evidence, `webpage_render` screenshot evidence, measured `webpage_evaluate` evidence when renderable, and zero-finding `web_clone_source_audit` evidence on the target project before claiming final maintainability. Do not alter evaluators, other agent prompts, communication paths, raw mirror/source packages, or generated evidence outputs to satisfy the report. " +
    "The final `submit_frontend_template.frontend_project` field should name the target acceptance project root and entrypoints, mark role=implementation_target only when all requested-surface replacement-plan rows are completed or proven out of scope and the target app source no longer imports/renders `SourceDomPage`, `src/components/source-dom/*`, or `src/data/sourceDom*` raw baseline modules. Never mark `frontend-design-skeleton` itself as implementation_target. In maintainable mode, role=source_baseline_input means frontend_design is explicitly incomplete or blocked; it is not a Build follow-up contract. " +
    "Do not use todo or scratchpad tools for template review; write the review-pass findings directly into the final frontend template fields.",
  )

  if (hostPreparedFrontendProject) {
    sections.push(renderHostPreparedFrontendProjectSection(hostPreparedFrontendProject))
  }

  return sections.join("\n\n")
}

function renderFinalAcceptanceModeInstruction(hostPrepared: boolean): string {
  if (hostPrepared) {
    return [
      "For host-prepared webpage clone turns, frame the work as source-region refactoring of the captured rawproject.",
      "Set `submit_frontend_template.final_acceptance_mode` to `maintainable_replacement_required` whenever the operator asks for maintainability, real implementation, component reuse, or replacement of generated/mechanical output.",
      "The captured skeleton project is evidence and a temporary seed; do not downgrade host-prepared rawproject refinement to visual-baseline acceptance.",
    ].join(" ")
  }
  return "Set `submit_frontend_template.final_acceptance_mode` to `maintainable_replacement_required` whenever the user asks for maintainability, real implementation, component reuse, or replacing generated/mechanical output."
}

function createFrontendProcessTrace(): FrontendDesignAgent.ProcessTrace {
  return {
    version: 1,
    purpose: "frontend-design-process-trace",
    events: [],
  }
}

function recordFrontendProcessEvent(
  trace: FrontendDesignAgent.ProcessTrace,
  input: Omit<FrontendDesignAgent.ProcessTraceEvent, "timestamp">,
): void {
  trace.events.push({
    ...input,
    timestamp: new Date().toISOString(),
  })
  scheduleFrontendProcessTracePersistence(trace)
}

function recordFrontendStaticToolSurface(trace: FrontendDesignAgent.ProcessTrace, toolNames: string[]): void {
  recordFrontendProcessEvent(trace, {
    name: "frontend_design_static_tool_surface",
    status: "passed",
    details: {
      tools: Array.from(new Set(toolNames)).sort(),
    },
  })
}

async function writeFrontendProcessTraceArtifact(
  taskID: string | undefined,
  trace: FrontendDesignAgent.ProcessTrace,
): Promise<string | undefined> {
  if (!taskID) return undefined
  const file = ProjectRuntimePaths.taskAbsolute(Instance.directory, taskID, "frontend-design", "frontend-design-process-trace.json")
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(trace, null, 2), "utf8")
  return file
}

async function configureFrontendProcessTracePersistence(
  taskID: string | undefined,
  trace: FrontendDesignAgent.ProcessTrace,
): Promise<{ processTraceArtifact?: string; iterationStateArtifact?: string }> {
  if (!taskID) return {}
  const dir = ProjectRuntimePaths.taskAbsolute(Instance.directory, taskID, "frontend-design")
  const persistence: FrontendProcessTracePersistence = {
    processTraceFile: path.join(dir, "frontend-design-process-trace.json"),
    iterationStateFile: path.join(dir, "frontend-design-iteration-state.json"),
    pending: Promise.resolve(),
  }
  frontendProcessTracePersistence.set(trace, persistence)
  await fs.mkdir(dir, { recursive: true })
  await persistFrontendProcessTraceNow(trace, persistence)
  return {
    processTraceArtifact: persistence.processTraceFile,
    iterationStateArtifact: persistence.iterationStateFile,
  }
}

function scheduleFrontendProcessTracePersistence(trace: FrontendDesignAgent.ProcessTrace): void {
  const persistence = frontendProcessTracePersistence.get(trace)
  if (!persistence) return
  persistence.pending = persistence.pending
    .catch(() => undefined)
    .then(() => persistFrontendProcessTraceNow(trace, persistence))
  persistence.pending.catch((error) => {
    log.warn("frontend design process trace persistence failed", {
      error: error instanceof Error ? error.message : String(error),
    })
  })
}

async function flushFrontendProcessTracePersistence(
  trace: FrontendDesignAgent.ProcessTrace,
): Promise<{ processTraceArtifact: string; iterationStateArtifact: string } | undefined> {
  const persistence = frontendProcessTracePersistence.get(trace)
  if (!persistence) return undefined
  await persistence.pending.catch((error) => {
    log.warn("frontend design process trace persistence flush failed", {
      error: error instanceof Error ? error.message : String(error),
    })
  })
  await persistFrontendProcessTraceNow(trace, persistence)
  return {
    processTraceArtifact: persistence.processTraceFile,
    iterationStateArtifact: persistence.iterationStateFile,
  }
}

async function persistFrontendProcessTraceNow(
  trace: FrontendDesignAgent.ProcessTrace,
  persistence: FrontendProcessTracePersistence,
): Promise<void> {
  await fs.mkdir(path.dirname(persistence.processTraceFile), { recursive: true })
  await Promise.all([
    fs.writeFile(persistence.processTraceFile, JSON.stringify(trace, null, 2), "utf8"),
    fs.writeFile(persistence.iterationStateFile, JSON.stringify(buildFrontendIterationState(trace), null, 2), "utf8"),
  ])
}

function buildFrontendIterationState(trace: FrontendDesignAgent.ProcessTrace): FrontendDesignAgent.IterationState {
  const replacementEvents = trace.events.filter((event) => event.name === "frontend_design_replacement_result")
  const completedReplacements = replacementEvents
    .filter((event) => event.details?.replacementStatus === "completed")
    .map((event) => event.details ?? {})
  const blockedReplacements = replacementEvents
    .filter((event) => event.details?.replacementStatus === "blocked")
    .map((event) => event.details ?? {})
  const deferredReplacements = replacementEvents
    .filter((event) => event.details?.replacementStatus === "deferred")
    .map((event) => event.details ?? {})
  const remainingSourceDebt = Array.from(new Set(replacementEvents.flatMap((event) => {
    const value = event.details?.remainingSourceDebt
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : []
  })))
  return {
    version: 1,
    purpose: "frontend-design-rawproject-iteration-state",
    completedReplacements,
    blockedReplacements,
    deferredReplacements,
    remainingSourceDebt,
    lastUpdated: trace.events.at(-1)?.timestamp ?? new Date().toISOString(),
  }
}

async function writeFrontendIterationStateArtifact(
  taskID: string | undefined,
  trace: FrontendDesignAgent.ProcessTrace,
): Promise<string | undefined> {
  if (!taskID) return undefined
  const file = ProjectRuntimePaths.taskAbsolute(Instance.directory, taskID, "frontend-design", "frontend-design-iteration-state.json")
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(buildFrontendIterationState(trace), null, 2), "utf8")
  return file
}

function appendFrontendProcessTrace(
  report: AgentReport,
  trace: FrontendDesignAgent.ProcessTrace,
  artifacts?: { processTraceArtifact?: string; iterationStateArtifact?: string },
): AgentReport {
  const lines = [
    report.detail,
    "",
    "## Frontend Design Process Trace",
    "",
    artifacts?.processTraceArtifact ? `Process trace artifact: ${artifacts.processTraceArtifact}` : undefined,
    artifacts?.iterationStateArtifact ? `Iteration state artifact: ${artifacts.iterationStateArtifact}` : undefined,
    trace.events.length === 0
      ? "- No frontend_design tool events were recorded."
      : trace.events.map((event) => {
        const detail = event.details ? ` ${JSON.stringify(event.details)}` : ""
        return `- ${event.status}: ${event.name}${detail}`
      }).join("\n"),
  ].filter((line) => line !== undefined)
  return {
    summary: report.summary,
    detail: lines.join("\n"),
  }
}

function createFrontendProcessTraceTools(trace: FrontendDesignAgent.ProcessTrace): ToolSet {
  return {
    record_frontend_region_selection: tool({
      description:
        "Record the frontend_design agent's selected rawproject source region before extracting it from the skeleton evidence into the target acceptance project. " +
        "This is process evidence only: it does not replace source edits, audits, builds, or visual checks.",
      inputSchema: z.object({
        regionComponentName: z.string().describe("The generated source-dom region component selected for replacement."),
        regionFilePath: z.string().describe("The region file path from sourceDomReplacementPlan/sourceDomIterationState."),
        replacementPlanFile: z.string().describe("Path to the sourceDomReplacementPlan.ts row used as evidence."),
        iterationStateFile: z.string().describe("Path to sourceDomIterationState.ts used to identify the candidate."),
        recommendedComponentName: z.string().optional().describe("Semantic component name the agent intends to create or update."),
        replacementKind: z.string().optional().describe("Replacement kind from the sourceDomReplacementPlan row."),
        reason: z.string().optional().describe("Brief evidence-grounded reason for selecting this region now."),
      }),
      execute: async (params) => {
        recordFrontendProcessEvent(trace, {
          name: "frontend_design_region_selection",
          status: "passed",
          details: params,
        })
        await flushFrontendProcessTracePersistence(trace)
        return {
          title: "Frontend source region selection recorded",
          output: [
            "# Frontend source region selection recorded",
            "",
            `- Region: ${params.regionComponentName}`,
            `- Region file: ${params.regionFilePath}`,
            params.recommendedComponentName ? `- Replacement: ${params.recommendedComponentName}` : undefined,
            params.replacementKind ? `- Kind: ${params.replacementKind}` : undefined,
            "",
            "Next target edits should stay inside this selected region's data, component, style, assets, and App wiring.",
            "If you already read this selected region file, the next file-changing action should write the target vertical slice. Additional reads before that write must be direct imports or explicitly named data/style/asset sidecars for this selected region only, not unrelated skeleton wrappers, footer/economy/FAQ/chart/list files, whole manifests, broad source data, or exhaustive `AssetPath`/`svgPaths`/`asset_*.path.txt`/CSS-token scans.",
            "Do not pre-read every asset path or CSS token before writing. Preserve observed asset IDs/token names in target-owned resolver/data modules first, then use same-region render/audit evidence to decide exact path/token repairs.",
            "The next filesystem-changing target edits must belong to this selected region only. Do not write footer, economy table, FAQ, map, chart, card/list, root data, or combined data files until this region has a replacement result and the other region is selected.",
            "Refactor the selected source component/row into target-owned modules by transcribing its actual labels, numeric data, source IDs, class responsibilities, SVG paths/assets, and interaction states; do not invent simplified SVGs, approximate values, or generic styling from memory.",
            "If this selected file is already a semantic skeleton component, faithfully port it first: preserve its data object shape, root source IDs, `data-*`/ARIA attributes, exact class names, wrapper nesting, `target`/`rel`, menu/dropdown/offer state fields, `AssetPath` or asset resolver usage, asset path references, circles, fills, viewBox/width/height, and helper responsibilities. Do not replace asset references with guessed inline SVG paths or simplify nested JSX until target render and source-audit evidence proves parity.",
            "Data modules, mock fixtures, and API adapters are region-owned during extraction; do not put records from another source region into them until that other region has its own selection and replacement result.",
            "Do not select another region until you record this region's replacement result. App wiring may import only this region's component and previously completed region components.",
            "Before writing files for another region, build and render this region through one explicit target URL: start one server only if needed with bash `background: true` and no shell `&`, call webpage_render against the returned URL/PID lifetime, feed its screenshot into webpage_evaluate, call webpage_vision_judge for visible mismatches, repair this same region, then record this region's replacement result and call record_frontend_region_selection for the next region.",
            "If this region is a chart, map, table, calendar, or other complex control, implement the real source-backed control with a project component or mature library when applicable; a labeled placeholder box is blocked/deferred source debt, not a completed replacement.",
          ].filter(Boolean).join("\n"),
          metadata: { event: "frontend_design_region_selection", ...params },
        }
      },
    }),
    record_frontend_replacement_result: tool({
      description:
        "Record the result of one frontend_design rawproject source-region replacement attempt. " +
        "Use after source edits, build/audit/visual checks, or a concrete blocker. This writes process evidence only; it does not mark acceptance by itself.",
      inputSchema: z.object({
        regionComponentName: z.string().describe("Generated source-dom region component from sourceDomReplacementPlan/sourceDomIterationState."),
        replacementStatus: z.enum(["completed", "blocked", "deferred"]).describe("Current result for this named region replacement."),
        replacementComponentName: z.string().optional().describe("Semantic component created or updated for this region."),
        filesChanged: z.array(z.string()).default([]).describe("Project source files changed for this replacement attempt."),
        dataModules: z.array(z.string()).default([]).describe("Data modules extracted or updated."),
        styleModules: z.array(z.string()).default([]).describe("Scoped CSS/style modules extracted or updated."),
        removedGeneratedBoundaries: z.array(z.string()).default([]).describe("Generated source-dom files/imports/boundaries removed or shrunk after parity evidence."),
        visualEvidence: z.array(z.string()).default([]).describe("Rendered screenshots, webpage_render artifacts, webpage_evaluate reports, webpage_vision_judge notes, or visual-diff artifacts used for this replacement."),
        auditEvidence: z.array(z.string()).default([]).describe("web_clone_source_audit outputs used for this replacement."),
        remainingSourceDebt: z.array(z.string()).default([]).describe("Named source-dom/rawcode regions still unfinished after this attempt."),
        nextRegionComponentName: z.string().optional().describe("Next source region selected from iteration evidence, if known."),
        notes: z.string().optional().describe("Short evidence-grounded note for the result."),
      }),
      execute: async (params) => {
        recordFrontendProcessEvent(trace, {
          name: "frontend_design_replacement_result",
          status: params.replacementStatus === "blocked" ? "failed" : "passed",
          details: params,
        })
        await flushFrontendProcessTracePersistence(trace)
        return {
          title: "Frontend replacement result recorded",
          output: [
            "# Frontend replacement result recorded",
            "",
            `- Region: ${params.regionComponentName}`,
            `- Status: ${params.replacementStatus}`,
            params.replacementComponentName ? `- Replacement: ${params.replacementComponentName}` : undefined,
            params.remainingSourceDebt.length > 0 ? `- Remaining source debt: ${params.remainingSourceDebt.join(", ")}` : undefined,
            params.remainingSourceDebt.length > 0 ? "- Do not describe the build as final while source debt remains; continue source-region extraction or mark the final handoff incomplete/blocked." : undefined,
            "- Completed means source-backed semantic UI with render/evaluate/audit evidence, not placeholder UI/text/classes, fake spacers, or rendered future-region filler.",
          ].filter(Boolean).join("\n"),
          metadata: { event: "frontend_design_replacement_result", ...params },
        }
      },
    }),
  }
}

async function createFrontendTool(info: Tool.Info, input: { taskID?: string; signal?: AbortSignal }, trace: FrontendDesignAgent.ProcessTrace) {
  const initialized = await info.init()
  return tool({
    description: initialized.description,
    inputSchema: initialized.parameters,
    execute: async (args, options) => {
      const meta = (options as { opencorvus?: { sessionID?: string; messageID?: string; toolCallID?: string } } | undefined)?.opencorvus
      const abort = (options as { abortSignal?: AbortSignal } | undefined)?.abortSignal ?? input.signal ?? new AbortController().signal
      recordFrontendProcessEvent(trace, { name: info.id, status: "started" })
      try {
        const result = await initialized.execute(args as never, {
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
        recordFrontendToolResultEvents(trace, info.id, args, result)
        await flushFrontendProcessTracePersistence(trace)
        return result
      } catch (error) {
        recordFrontendProcessEvent(trace, {
          name: info.id,
          status: "failed",
          details: { error: error instanceof Error ? error.message : String(error) },
        })
        await flushFrontendProcessTracePersistence(trace)
        throw error
      }
    },
  })
}

function recordFrontendToolResultEvents(
  trace: FrontendDesignAgent.ProcessTrace,
  toolID: string,
  args: unknown,
  result: { title?: unknown; metadata?: unknown },
): void {
  const details = summarizeFrontendToolResult(toolID, args, result)
  recordFrontendProcessEvent(trace, {
    name: toolID,
    status: "passed",
    details,
  })

  if (isFrontendSourceMutationTool(toolID)) {
    recordFrontendProcessEvent(trace, {
      name: "frontend_design_source_edit",
      status: "passed",
      details,
    })
  }

  if (toolID === "bash") {
    const command = stringField(args, "command")
    const normalized = normalizeFrontendBenchmarkCommand(command)
    if (normalized) {
      recordFrontendProcessEvent(trace, {
        name: normalized,
        status: "passed",
        details,
      })
    }
  }
}

function summarizeFrontendToolResult(
  toolID: string,
  args: unknown,
  result: { title?: unknown; metadata?: unknown },
): Record<string, unknown> {
  const details: Record<string, unknown> = {}
  if (typeof result.title === "string" && result.title.trim()) details.title = result.title
  const filePaths = extractFrontendMutationFiles(toolID, args, result.metadata)
  if (filePaths.length > 0) details.files = filePaths
  const command = stringField(args, "command")
  if (command) details.command = command
  const workdir = stringField(args, "workdir")
  if (workdir) details.workdir = workdir
  const finalAcceptanceMode = stringField(args, "finalAcceptanceMode")
  if (finalAcceptanceMode) details.finalAcceptanceMode = finalAcceptanceMode
  const metadata = asRecord(result.metadata)
  const audit = asRecord(metadata.audit)
  if (typeof audit.passed === "boolean") details.passed = audit.passed
  if (Array.isArray(audit.findings)) details.findings = audit.findings.slice(0, 8)
  return details
}

function isFrontendSourceMutationTool(toolID: string): boolean {
  return toolID === "edit" || toolID === "write" || toolID === "apply_patch"
}

function normalizeFrontendBenchmarkCommand(command: string | undefined): string | undefined {
  if (!command) return undefined
  const normalized = command.replace(/\s+/g, " ").trim().toLowerCase()
  if (/^(?:bun|bun\.exe|bun\.cmd) install(?:\s|$)/.test(normalized)) return "bun install"
  if (/^(?:bun|bun\.exe|bun\.cmd) run build(?:\s|$)/.test(normalized)) return "bun run build"
  return undefined
}

function extractFrontendMutationFiles(toolID: string, args: unknown, metadata: unknown): string[] {
  const files = new Set<string>()
  const directPath = stringField(args, "filePath")
  if (directPath) files.add(directPath)
  if (toolID === "apply_patch") {
    const meta = asRecord(metadata)
    const patchFiles = Array.isArray(meta.files) ? meta.files : []
    for (const item of patchFiles) {
      const record = asRecord(item)
      const relativePath = typeof record.relativePath === "string" ? record.relativePath : undefined
      const filePath = typeof record.filePath === "string" ? record.filePath : undefined
      if (relativePath) files.add(relativePath)
      else if (filePath) files.add(filePath)
    }
  }
  return Array.from(files)
}

function stringField(value: unknown, key: string): string | undefined {
  const record = asRecord(value)
  const field = record[key]
  return typeof field === "string" && field.trim() ? field : undefined
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function createFrontendSubmitTools(outputToolKit: ReturnType<typeof createFrontendTemplateOutputTools>): ToolSet {
  return {
    submit_frontend_template: outputToolKit.tools.submit_frontend_template,
  }
}

function createFrontendDesignContextTools(): ToolSet {
  return selectFrontendStaticTools(createAgentContextTools(), FRONTEND_DESIGN_CONTEXT_TOOL_IDS, "frontend-design context")
}

function selectFrontendStaticTools(
  tools: ToolSet,
  ids: readonly string[],
  label: string,
): ToolSet {
  const selected: ToolSet = {}
  for (const id of ids) {
    const item = tools[id]
    if (!item) throw new Error(`${label} static tool is missing: ${id}`)
    selected[id] = item
  }
  return selected
}

function assertFrontendStaticToolSurface(tools: ToolSet): void {
  const expected = [...FRONTEND_DESIGN_SESSION_TOOL_IDS].sort()
  const actual = Object.keys(tools).sort()
  const expectedSet = new Set<string>(expected)
  const actualSet = new Set<string>(actual)
  const missing = expected.filter((id) => !actualSet.has(id))
  const extra = actual.filter((id) => !expectedSet.has(id))
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      "frontend-design runtime tool surface diverged from static definition: " +
      `missing=[${missing.join(", ")}] extra=[${extra.join(", ")}]`,
    )
  }
}

async function createMirrorAnalysisTools(input: { taskID?: string; signal?: AbortSignal }, trace = createFrontendProcessTrace()): Promise<ToolSet> {
  const tools = {
    webpage_extract: await createFrontendTool(WebpageExtractTool, input, trace),
    webpage_compile: await createFrontendTool(WebpageCompileTool, input, trace),
    webpage_analyze: await createFrontendTool(WebpageAnalyzeTool, input, trace),
    webpage_runtime_state: await createFrontendTool(WebpageRuntimeStateTool, input, trace),
    webpage_image_extract: await createFrontendTool(WebpageImageExtractTool, input, trace),
    webpage_image_compile: await createFrontendTool(WebpageImageCompileTool, input, trace),
    webpage_image_analyze: await createFrontendTool(WebpageImageAnalyzeTool, input, trace),
  }
  return selectFrontendStaticTools(tools, FRONTEND_DESIGN_MIRROR_ANALYSIS_TOOL_IDS, "frontend-design mirror analysis")
}

async function createFrontendImplementationTools(input: { taskID?: string; signal?: AbortSignal }, trace = createFrontendProcessTrace()): Promise<ToolSet> {
  const tools = {
    bash: await createFrontendTool(BashTool, input, trace),
    edit: await createFrontendTool(EditTool, input, trace),
    write: await createFrontendTool(WriteTool, input, trace),
    apply_patch: await createFrontendTool(ApplyPatchTool, input, trace),
    web_clone_source_audit: await createFrontendTool(WebCloneSourceAuditTool, input, trace),
    webpage_render: await createFrontendTool(WebpageRenderTool, input, trace),
    webpage_evaluate: await createFrontendTool(WebpageEvaluateTool, input, trace),
    webpage_text_diff: await createFrontendTool(WebpageTextDiffTool, input, trace),
    webpage_vision_judge: await createFrontendTool(WebpageVisionJudgeTool, input, trace),
  }
  return selectFrontendStaticTools(tools, FRONTEND_DESIGN_IMPLEMENTATION_TOOL_IDS, "frontend-design implementation")
}

async function createFrontendUtilityTools(input: { taskID?: string; signal?: AbortSignal }, trace = createFrontendProcessTrace()): Promise<ToolSet> {
  void input
  void trace
  const tools = {}
  return selectFrontendStaticTools(tools, FRONTEND_DESIGN_UTILITY_TOOL_IDS, "frontend-design utility")
}

async function resolveHostPreparedFrontendProject(taskID?: string): Promise<HostPreparedFrontendProject | undefined> {
  if (!taskID) return undefined
  const paths = ProjectRuntimePaths.frontendDesignPaths(Instance.directory, taskID)
  const [sourcePackageExists, skeletonProjectExists] = await Promise.all([
    pathExists(paths.sourcePackageAbsolute),
    pathExists(paths.skeletonProjectAbsolute),
  ])
  if (!sourcePackageExists || !skeletonProjectExists) return undefined
  const sourceAuditEvidence = await summarizeHostPreparedSourceAudit({
    sourcePackage: paths.sourcePackageAbsolute,
    projectRoot: paths.skeletonProjectAbsolute,
  })
  const compactEvidence = await readHostPreparedCompactEvidence({
    sourcePackage: paths.sourcePackageAbsolute,
    projectRoot: paths.skeletonProjectAbsolute,
    sourceAuditEvidence,
  })
  return {
    status: "created",
    projectRoot: paths.skeletonProjectAbsolute,
    sourcePackage: paths.sourcePackageAbsolute,
    projectRootRef: paths.skeletonProjectRelative,
    sourcePackageRef: paths.sourcePackageRelative,
    entrypoints: [
      "README.md",
      "src/App.tsx",
      "src/components/SourceClonePage.tsx",
      "src/components/SourceDomPage.tsx",
      "src/styles.css",
    ],
    generationTool: "host-prepared:create_frontend_skeleton_project",
    warnings: [],
    compactEvidence,
    sourceReplacementPlan: [],
    sourceAuditEvidence,
  }
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await fs.stat(file)
    return true
  } catch {
    return false
  }
}

export const FrontendDesignTestHooks = {
  buildPromptParts,
  buildUserPrompt,
  appendFrontendProcessTrace,
  createFrontendProcessTraceTools,
  createFrontendSubmitTools,
  createFrontendDesignContextTools,
  createFrontendImplementationTools,
  createFrontendUtilityTools,
  createFrontendProcessTrace,
  assertFrontendStaticToolSurface,
  buildFrontendIterationState,
  createMirrorAnalysisTools,
  isTextOnlyNoVisualSource,
  recordFrontendStaticToolSurface,
  recordFrontendProcessEvent,
  recordFrontendToolResultEvents,
  readHostPreparedCompactEvidence,
  summarizeHostPreparedSourceAudit,
  summarizeHostPreparedSourceProject,
  summarizeReferencePixels,
  resolveHostPreparedFrontendProject,
  writeFrontendProcessTraceArtifact,
  writeFrontendIterationStateArtifact,
}
