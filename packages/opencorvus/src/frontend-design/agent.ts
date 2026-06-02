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
import { SkillTool } from "@/tool/skill"
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
  const targetProjectRef = "."
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
    "# Target Delivery Project Contract\n\n" +
    `Default target delivery project root: \`${targetProjectRef}\` (the current workspace root). ` +
    "If the workspace already contains a frontend app, inspect and use that existing app as the target. If it does not, create the runnable target app at the workspace root rather than inside `frontend-design-skeleton`. " +
    "Benchmark workspaces often already contain minimal root files such as `package.json`, `tsconfig.json`, `data/`, `.git/`, and `.opencorvus/`; treat those as an editable target-project shell and populate it directly with file-edit tools (`src/main.tsx`, `src/App.tsx`, semantic components, data modules, CSS modules, and scripts) instead of running project scaffolding commands that expect an empty directory. " +
    "Configuration manifests are late-stage integration files, not the first workload. After the skeleton exists, the first target-project edits should create source files: `src/main.tsx`, `src/App.tsx`, semantic components, data modules, mock/API adapters, CSS modules/sidecars, and owned assets. Read and edit `package.json`, `tsconfig.json`, or bundler config only immediately before a late integration/build command after source coverage exists. " +
    "When a target-root file already exists, read that exact file first with `read_file`, then edit or overwrite it; use direct `write` only for genuinely new target-project files and directories. " +
    "Default implementation stack for webpage replicas without an existing app contract: React + Vite + TypeScript with project-owned mock/API data modules. " +
    "Default scoped styling approach: CSS Modules or colocated project-owned CSS sidecars imported by semantic components; do not runtime-load raw source-site CSS bundles as the app styling system. " +
    "The final `submit_frontend_template.frontend_project.project_root` should be `.` when this default root is used, with entrypoints such as `package.json`, `src/main.tsx`, `src/App.tsx`, semantic component modules, data modules, style modules, and verification artifacts.",
  )

  sections.push(
    "# Live URL Capture\n\n" +
    `For visual webpage URLs, first check the task-runtime evidence at \`${mirrorRef}/prd-evidence-summary.md\`, \`${mirrorRef}/source-ir/component-tree.json\`, \`${mirrorRef}/source-ir/content-model.json\`, \`${mirrorRef}/source-ir/layout-map.json\`, \`${mirrorRef}/source-ir/style-tokens.json\`, \`${mirrorRef}/source-ir/interaction-hints.json\`, \`${mirrorRef}/source-skeleton/critical.css\`, \`${mirrorRef}/visual-surface-candidates.json\`, and the task-runtime source package \`${sourcePackageRef}/implementation-blueprint.md\` when present. Use \`${mirrorRef}/source-skeleton/index.html\` only as raw evidence for exact hierarchy/source ids or missing text. ` +
    "Use the matched webpage reference skill only if those files are missing or stale — not `webfetch` and not screenshot-only analysis. " +
    "After evidence exists, stop acquiring and read the named source artifacts before finalizing; never inline raw extraction JSON or stored URL screenshot base64 into the frontend template prompt. " +
    (autoIteration
        ? "Because assistant.auto_iteration=true, do at least two frontend template review passes before `submit_frontend_template`: first check page inventory and visual coverage, then check downstream frontend replica implementability. "
      : "Because assistant.auto_iteration=false, do one bounded frontend template review pass before `submit_frontend_template`; report remaining gaps in completeness_review/open_questions instead of looping automatically. ") +
    `For webpage replicas, after the task-runtime source package \`${sourcePackageRef}/\` exists, call \`create_frontend_skeleton_project\` to create the high-fidelity skeleton evidence project at \`${skeletonProjectRef}/\` before \`submit_frontend_template\`. ` +
    "The generated skeleton project is frontend_design's source-evidence baseline, not the final worktree. Do not run install/build/render/dev-server commands inside `frontend-design-skeleton` in maintainable delivery. After creating it, inspect bounded entry evidence (`sourceProjectManifest.json`, `sourceDomIterationState.ts`, named `sourceDomReplacementPlan.ts` rows, source-region component files, and current-region data/style/asset excerpts) plus the target project component/package structure; then extract the skeleton's observed source structure, data, styles, and assets into the target delivery project as project-owned semantic components/data modules/scoped styles. Build should receive the target project that frontend_design already populated, and only perform integration and precision fixes. If the generator cannot produce that high-fidelity source evidence project, record the exact materialization defect in `frontend_project.notes`. " +
    "Describe this as rawproject source-region refactoring: all new components, styles, and data modules must trace to rawproject source nodes/regions/assets/reference screenshots, and replacement work must happen source-region by source-region. " +
    "When the target is an existing frontend project, inspect package manifests and obvious component/UI directories if tools are available, then tell downstream agents whether to add a route/page to the existing app, adopt the source baseline into the root app, or stop on a materialization blocker. " +
    "In principle, downstream implementation must reuse existing project components/design-system primitives first and mature maintained libraries second; custom code is limited to simple page-specific glue or micro-adjust layout/spacing. Charts, maps, tables, calendars, popovers, dialogs, menus, forms, virtualized lists, drag/drop, editors, rich media, and complex layouts require reusable project or library options when available. " +
    "Your final report should not be a component catalog. Put known problems, evidence gaps, extraction-vs-rewrite risk, source organization, debug commands, reuse decisions, PRD delta boundaries, and agent handoff notes into `quality_project_contract`, `completeness_review`, and `open_questions`; leave `component_inventory` empty unless the provider requires a legacy compatibility summary. " +
    renderFinalDeliveryModeInstruction(Boolean(hostPreparedFrontendProject)) + " " +
    "After the source project tool returns, record the skeleton evidence paths, replacement-plan sidecars, and warnings in `reference_artifacts` and `frontend_project.notes`, then read `sourceProjectManifest.json`, `sourceDomIterationState.ts`, and the replacement-plan rows needed for the current named source regions. Treat `nextSourceDomReplacement` as the first queue item only, not as the workload limit. Do not read `sourceData.ts`, `svgPaths.ts`, raw HTML, or generated CSS wholesale; use search/excerpt reads only for the current region's named data/style/asset evidence. Before any build/render/server command, create or populate the target delivery project specified by the Target Delivery Project Contract and perform all runnable commands there. Source coverage comes before manifest/config tuning: create the target `src` tree, components, data modules, CSS, and assets before spending turns on root config edits. For every in-scope replacement-plan row, call `record_frontend_region_selection` before editing, then use your normal file-edit and command tools to extract source-dom/rawcode evidence into the target delivery project with semantic components, data modules, scoped styles, mock/API adapters when data is visible, and owned assets. Do not implement by freehand redrawing, and do not use the skeleton project itself as the final work area. After each replacement call `record_frontend_replacement_result` with completed/blocked/deferred status, changed target-project files, evidence artifacts, remaining source debt, and the next region. Verification must include target project build evidence, measured `webpage_evaluate` evidence when renderable, and zero-finding `web_clone_source_audit` evidence on the target project before claiming final maintainability. Do not alter evaluators, other agent prompts, communication paths, raw mirror/source packages, or generated evidence outputs to satisfy the report. " +
    "The final `submit_frontend_template.frontend_project` field should name the target delivery project root and entrypoints, mark role=implementation_target only when all requested-surface replacement-plan rows are completed or proven out of scope and the target app source no longer imports/renders `SourceDomPage`, `src/components/source-dom/*`, or `src/data/sourceDom*` raw baseline modules. Never mark `frontend-design-skeleton` itself as implementation_target. In maintainable mode, role=source_baseline_input means frontend_design is explicitly incomplete or blocked; it is not a Build follow-up contract. " +
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
      "The captured skeleton project is evidence and a temporary seed; do not downgrade host-prepared rawproject refinement to visual-baseline delivery.",
    ].join(" ")
  }
  return "Set `submit_frontend_template.final_delivery_mode` to `maintainable_replacement_required` whenever the user asks for maintainability, real implementation, component reuse, or replacing generated/mechanical output."
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
        "Record the frontend_design agent's selected rawproject source region before extracting it from the skeleton evidence into the target delivery project. " +
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
        visualEvidence: z.array(z.string()).default([]).describe("Rendered screenshots, webpage_evaluate reports, or visual-diff artifacts used for this replacement."),
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
  const finalDeliveryMode = stringField(args, "finalDeliveryMode")
  if (finalDeliveryMode) details.finalDeliveryMode = finalDeliveryMode
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
  const tools = {
    skill: await createFrontendTool(SkillTool, input, trace),
  }
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
