/**
 * Frontend Design Agent - produces an evidence-grounded frontend template from
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
import { Agent } from "@/agent/agent"
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
  WebpageRenderTool,
  WebpageRuntimeStateTool,
  WebpageTextDiffTool,
  WebpageVisionJudgeTool,
} from "@/frontend-design/tools"
import type { VisualSpec } from "./types"
import {
  createFrontendTemplateOutputTools,
  type FrontendTemplateFinal,
  type FrontendTemplateOutputCollector,
} from "./output-tools"
import { createReadAttachmentTool } from "./read-attachment-tool"
import { createUrlScreenshotTool } from "./url-screenshot-tool"
import { createFrontendSkeletonProjectTool } from "./skeleton-project-tool"
import {
  FRONTEND_DESIGN_CONTEXT_TOOL_IDS,
  FRONTEND_DESIGN_IMPLEMENTATION_TOOL_IDS,
  FRONTEND_DESIGN_WEBPAGE_EVIDENCE_TOOL_IDS,
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
    attachments?: Array<{
      sha: string
      url: string
      mime: string
      size: number
      filename?: string
      intent?: string
      source?: string
    }>
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
    const webpageEvidenceTools = await createWebpageEvidenceTools(
      { taskID: input.taskID, signal: input.signal },
      processTrace,
    )
    const implementationTools = await createFrontendImplementationTools(
      { taskID: input.taskID, signal: input.signal },
      processTrace,
    )
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
      ...webpageEvidenceTools,
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
        ? (session) => {
            input.onSessionCreated!(session.id)
          }
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
    const processTraceArtifact =
      persistedArtifacts?.processTraceArtifact ?? (await writeFrontendProcessTraceArtifact(input.taskID, processTrace))
    const iterationStateArtifact =
      persistedArtifacts?.iterationStateArtifact ??
      (await writeFrontendIterationStateArtifact(input.taskID, processTrace))
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
      "color",
      "typography",
      "spacing",
      "layout",
      "component",
      "interaction",
      "responsive",
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

async function buildPromptParts(
  input: {
    title: string
    request: string
    attachments?: Array<{
      sha: string
      url: string
      mime: string
      size: number
      filename?: string
      intent?: string
      source?: string
    }>
  },
  autoIteration = false,
  hostPreparedFrontendProject?: HostPreparedFrontendProject,
) {
  const text = buildUserPrompt(input, autoIteration, hostPreparedFrontendProject)
  const hasLiveHttpUrl = hasNonFigmaHttpUrl(input.request)
  const inlineAttachments = (input.attachments ?? []).filter((attachment) =>
    shouldInlineFrontendDesignAttachment(attachment, hasLiveHttpUrl),
  )
  const enrichedText = text + AttachmentStore.renderAttachmentInventory(inlineAttachments)
  const inlineParts = await AttachmentStore.inlineFileParts(inlineAttachments)
  return [{ type: "text" as const, text: enrichedText }, ...inlineParts]
}

function shouldInlineFrontendDesignAttachment(attachment: { source?: string }, hasLiveHttpUrl: boolean): boolean {
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
  return !(input.attachments ?? []).some(
    (attachment) =>
      (attachment.intent ?? "") === "visual_reference" ||
      attachment.mime.startsWith("image/") ||
      attachment.mime === "application/pdf",
  )
}

function renderAutoIterationMode(autoIteration: boolean): string {
  return [
    "## Auto Iteration Mode",
    autoIteration
      ? "- assistant.auto_iteration=true: perform at least two frontend template review passes before handoff when visual evidence is available."
      : "- assistant.auto_iteration=false: perform one bounded frontend template review pass before handoff; do not loop through additional frontend template revisions automatically.",
    "- In both modes, acquire missing webpage evidence at most once per source and finalize through `submit_frontend_template`.",
  ].join("\n")
}

function buildUserPrompt(
  input: {
    title: string
    request: string
    attachments?: Array<{ filename?: string; mime: string; intent?: string; source?: string }>
    taskID?: string
  },
  autoIteration = false,
  hostPreparedFrontendProject?: HostPreparedFrontendProject,
): string {
  const runtimePaths = input.taskID ? ProjectRuntimePaths.frontendDesignPaths("", input.taskID) : undefined
  const webpageEvidenceRef =
    runtimePaths?.webpageEvidenceRelative ?? ".opencorvus/runtime/tasks/<taskID>/frontend-design/webpage-evidence"
  const sourcePackageRef =
    runtimePaths?.sourcePackageRelative ?? ".opencorvus/runtime/tasks/<taskID>/frontend-design/web-clone-source"
  const skeletonProjectRef =
    runtimePaths?.skeletonProjectRelative ??
    ".opencorvus/runtime/tasks/<taskID>/frontend-design/frontend-design-skeleton"
  const visualSkeletonRef = input.taskID
    ? `.opencorvus/runtime/tasks/${input.taskID}/frontend-design/visual-html-skeleton`
    : ".opencorvus/runtime/tasks/<taskID>/frontend-design/visual-html-skeleton"
  const sections = [
    "# Delegation\n\nOrchestrator is asking frontend_design to produce the high-fidelity visual HTML skeleton contract, frontend template, fillable modules, material inventory, visual/data contracts, known transcription problems, and downstream agent handoff notes for this task. Web-clone source artifacts are visual skeleton seeds and evidence; keep the handoff anchored to source-region traceability instead of a standalone component checklist.",
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
    const lines = visualAttachments
      .map((a, i) => {
        const name = a.filename ?? `attachment-${i + 1}`
        const source = a.source ? ` — captured from ${a.source}` : ""
        return `${i + 1}. \`${name}\` (${a.mime})${source}`
      })
      .join("\n")
    const allVisualsAreUrlScreenshots = visualAttachments.every((a) => a.source === "url-screenshot")
    const visualReferenceMode =
      hasLiveHttpUrl && allVisualsAreUrlScreenshots
        ? "These URL screenshot captures are stored for provenance but are not inlined into this prompt. Use the task-runtime webpage evidence and webpage evidence tools for any missing evidence, then read the named source artifacts and write the frontend template. "
        : "These files are attached to this message as multimodal content — read the pixels directly. Do NOT use webfetch. Prefer these attached screenshots over re-capturing the same page. " +
          (hasLiveHttpUrl
            ? "If the brief includes an additional live http(s) webpage URL that is not already represented here, use the webpage evidence tools to acquire missing evidence once before writing specs. "
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
          ? "No screenshots, mockups, or design materials were attached yet. If the request includes a live http(s) webpage URL, use the webpage evidence tools to acquire missing evidence once. If evidence acquisition fails, report the exact failure; do not invent page facts. "
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
    "# Visual HTML Skeleton Contract\n\n" +
      "For webpage replica work, frontend_design's first workflow deliverable is a source-editable static HTML/CSS visual skeleton, not a complete application source tree and not compiled output. Report it as `submit_frontend_template.frontend_project.role=visual_baseline_input`, name its root and entrypoints such as `visual-html-skeleton/index.html`, external CSS files, owned assets, screenshots, and diff/evaluation artifacts, and state that it is not the implementation target or acceptance app root. Its source of authority is still `web-clone-source/source-ir/*`, `web-clone-source/source-skeleton/*`, assets, and `web-clone-source/reference.png`; if the skeleton conflicts with those artifacts or visible pixels, the original source evidence wins. Later workflow stages transcribe this HTML skeleton into project source. " +
      `Default visual HTML skeleton root: \`${visualSkeletonRef}\`. Report the public project root as \`visual-html-skeleton\` and the role as \`visual_baseline_input\`; do not name \`web-clone-target\`, a framework app root, or \`frontend-design-skeleton\` as the current workflow deliverable. ` +
      "If the workspace already contains a real frontend app, inspect it only to understand later transcription constraints; do not convert the current workflow into app-source completion. Root files alone are not a real frontend app: benchmark workspaces often contain minimal `package.json`, `tsconfig.json`, `data/`, `.git/`, and `.opencorvus/` shell files without app source, and those shell files should not become the skeleton deliverable. " +
      "Populate the visual HTML skeleton directly with file-edit tools by copying/adapting the visual structure, CSS, assets, and visible content from `frontend-design-skeleton` and `web-clone-source`, then refining selected visual regions. " +
      "After the source evidence skeleton exists, the first editing pass is visual skeleton adoption: create/adapt bounded static `index.html`, external CSS files, asset references, representative-state markup, screenshots/diff artifacts when available, and a README/source note that names the source evidence. This is not freehand scaffolding, not app-source bootstrap, and not mechanical replay of raw source DOM. Do not submit `dist/`, `build/`, `out/`, `/src/main.tsx`, Vite/React bootstraps, SingleFile/capture replay, `source-skeleton/index.html` copied wholesale, `SourceDomPage`/`src/components/source-dom/*` dumps, giant inline CSS/HTML payloads, iframe previews, `reference.png` screenshot wrappers, or unresolved `__WEB_CLONE_DATA_URI_ASSET__` placeholders as the skeleton. Render that HTML skeleton through a real static harness or browser path, compare it with `reference.png`, and refine visual regions from source evidence until the first workflow can pass HTML-design fidelity review. " +
      "For high-fidelity acceptance, call `webpage_evaluate` with `passThreshold: 96`; a score below 96/100 or similarity below 0.95 is unfinished visual debt, not a usable baseline. If measured evidence is below threshold, repair the same HTML skeleton from source evidence or submit an explicitly incomplete/blocked handoff that names the score, blocking regions, and next repair step; do not call the skeleton accepted, ready, complete, usable, or good enough for downstream transcription. " +
      "Before broad styling, extract visual tokens into `visual-html-skeleton/styles/tokens.css` from `web-clone-source/source-ir/style-tokens.json`, `source-ir/style-profile.json`, selected `layout-map.json` regions, `source-skeleton/critical.css`, and visible reference pixels. Use role-based CSS variables for color roles, typography, spacing/density, radii, borders, shadows/elevation, icon/media sizes, chart/map/table range colors, and responsive widths. Put layout and region rules in external CSS files that consume these variables. Do not invent tokens from brand memory, paste a giant original CSS bundle, or hide everything in inline styles; when tokens conflict with visible pixels, visible pixels plus region style-profile win and the report must name the mismatch. " +
      "Use `record_frontend_region_selection` and `record_frontend_replacement_result` to make region work observable when you refine major source regions, but the selected vertical slice is the HTML/CSS/assets/content for that visual region plus later transcription notes, not React/Vue app modules. Do not create future app components, package manifests, mock API modules, or framework routes in this workflow unless the current task explicitly asks to combine the HTML skeleton workflow and the project-transcription workflow. " +
      "When a visual skeleton file already exists, read that exact file first with `read_file`, then edit or overwrite it; use direct `write` only for genuinely new skeleton files and assets. " +
      "Default first-workflow stack for webpage replicas: source-editable static HTML/CSS/JavaScript only when needed for representative visual states. Keep `index.html` bounded and split token/layout/region rules into external CSS files; put images/SVG/canvas captures under skeleton-owned assets. Put later React/Vue/etc. project transcription constraints into `quality_project_contract`, not into the current skeleton source. " +
      "The final `submit_frontend_template.frontend_project.project_root` should name the visual skeleton root, with entrypoints such as `visual-html-skeleton/index.html`, `visual-html-skeleton/styles/tokens.css`, region CSS files, source asset paths, screenshots, and visual diff/evaluation artifacts.",
  )

  sections.push(
    "# Live URL Capture\n\n" +
      `For visual webpage URLs, first check the task-runtime evidence at \`${webpageEvidenceRef}/prd-evidence-summary.md\`, \`${webpageEvidenceRef}/source-ir/component-tree.json\`, \`${webpageEvidenceRef}/source-ir/content-model.json\`, \`${webpageEvidenceRef}/source-ir/layout-map.json\`, \`${webpageEvidenceRef}/source-ir/style-tokens.json\`, \`${webpageEvidenceRef}/source-ir/interaction-hints.json\`, \`${webpageEvidenceRef}/source-ir/interaction-state-snapshots.json\`, \`${webpageEvidenceRef}/source-skeleton/critical.css\`, \`${webpageEvidenceRef}/visual-surface-candidates.json\`, and the task-runtime source package \`${sourcePackageRef}/implementation-blueprint.md\` when present. Use \`${webpageEvidenceRef}/source-skeleton/index.html\` only as raw evidence for exact hierarchy/source ids or missing text. ` +
      "Use webpage evidence tools only if those files are missing or stale — not `webfetch`, not dynamic skills, and not screenshot-only analysis. " +
      "After evidence exists, stop acquiring and read the named source artifacts before finalizing; never inline raw extraction JSON or stored URL screenshot base64 into the frontend template prompt. " +
      (autoIteration
        ? "Because assistant.auto_iteration=true, do at least two frontend template review passes before `submit_frontend_template`: first check page inventory and visual coverage, then check downstream frontend replica implementability. "
        : "Because assistant.auto_iteration=false, do one bounded frontend template review pass before `submit_frontend_template`; report remaining gaps in completeness_review/open_questions instead of looping automatically. ") +
      `For webpage replicas, after the task-runtime source package \`${sourcePackageRef}/\` exists, call \`create_frontend_skeleton_project\` to create the high-fidelity skeleton evidence project at \`${skeletonProjectRef}/\` before \`submit_frontend_template\`. ` +
      `Pass \`${skeletonProjectRef}\` as the skeleton outputDir, or omit outputDir so the tool uses that default. Do not pass \`web-clone-target\`, \`${visualSkeletonRef}\`, or any target app root to \`create_frontend_skeleton_project\`. ` +
      "The generated skeleton project is frontend_design's source-evidence baseline, not the final worktree. Do not move, rename, install, build, render, or start a dev/preview server inside `frontend-design-skeleton` as the final HTML skeleton. After creating it, inspect bounded entry evidence (`sourceProjectManifest.json`, `sourceDomIterationState.ts`, named `sourceDomReplacementPlan.ts` rows, source-region component files, and current-region data/style/asset excerpts), then extract the observed visual structure, content, styles, and assets into the visual HTML skeleton. The rest of the workflow should improve and verify this HTML skeleton's fidelity; a later workflow transcribes it into a complete project. If the generator cannot produce high-fidelity source evidence, record the exact materialization defect in `frontend_project.notes`. " +
      "Describe this as rawproject source-region visual restoration: all skeleton HTML, CSS, assets, and representative states must trace to rawproject source nodes/regions/assets/reference screenshots, and visual replacement work should happen source-region by source-region. " +
      "When the target is an existing frontend project, inspect package manifests and obvious component/UI directories only to document later transcription constraints; do not turn this workflow into app-source implementation. " +
      "In principle, downstream implementation must reuse existing project components/design-system primitives first and mature maintained libraries second; custom code is limited to simple page-specific glue or micro-adjust layout/spacing. Charts, maps, tables, calendars, popovers, dialogs, menus, forms, virtualized lists, drag/drop, editors, rich media, and complex layouts require reusable project or library options when available. " +
      "Your final report should not be a component catalog. Put known problems, evidence gaps, extraction-vs-rewrite risk, source organization, debug commands, reuse decisions, PRD delta boundaries, and agent handoff notes into `quality_project_contract`, `completeness_review`, and `open_questions`; leave `component_inventory` empty unless the provider requires a legacy compatibility summary. " +
      renderFinalAcceptanceModeInstruction(Boolean(hostPreparedFrontendProject)) +
      " " +
      "For webpage replicas, set `final_acceptance_mode=visual_baseline_allowed` and `frontend_project.role=visual_baseline_input` for the first workflow, then put the future skeleton-to-project transcription contract into `quality_project_contract`, `visual_consistency_contract`, `reference_artifacts`, and `frontend_project.notes`; do not describe the HTML skeleton as Build's implementation target. " +
      "After the source project tool returns, record the skeleton evidence paths, replacement-plan sidecars, and warnings in `reference_artifacts` and `frontend_project.notes`, then read `sourceProjectManifest.json`, `sourceDomIterationState.ts`, bounded source-region evidence, `source-ir/*`, `source-skeleton/critical.css`, source assets, and `reference.png` only as needed to restore the static HTML/CSS skeleton. Treat `nextSourceDomReplacement` as the first visual-region queue item, not as a target-project extraction command. Before selecting a large region, create or adapt the visual skeleton's static `index.html`, CSS, assets, representative-state markup, screenshots/diff artifacts, and README/source note so the current workflow has a renderable HTML-design artifact. For every major in-scope visual region, call `record_frontend_region_selection` before editing that region's HTML/CSS/assets/content, then call `record_frontend_replacement_result` with completed/blocked/deferred status, changed skeleton files, evidence artifacts, remaining visual debt, and the next region. Additional reads after selection must be direct imports or explicitly named data/style/asset sidecars for that same visual region, not unrelated wrappers, whole manifests, broad source data, exhaustive asset scans, raw HTML dumps, or generated CSS wholesale. Do not implement by freehand redrawing; copy/transcribe observed labels, numeric data, source IDs, class responsibilities, SVG paths/assets, interaction-state visuals, wrapper nesting, ARIA/data attributes, and responsive rules from selected source evidence. For charts, maps, calendars, tables, or other complex controls, restore the observed component kind and visual/data surface from source evidence; if the real control cannot be restored in static HTML in this pass, record blocked/deferred visual debt instead of rendering a labeled placeholder box. Render the HTML skeleton through one explicit static URL or file path, compare it against `reference.png` with `webpage_render`, `webpage_evaluate` using `passThreshold: 96`, and `webpage_vision_judge` evidence when available, then repair the same region before selecting another region when the score is below 96/100 or the visual judge names mismatches. Do not use shell listings or build success as visual evidence. Do not alter evaluators, other agent prompts, communication paths, raw webpage evidence/source packages, or generated evidence outputs to satisfy the report. " +
      "The final `submit_frontend_template.frontend_project` field should name the visual HTML skeleton root and entrypoints, mark role=visual_baseline_input, and explicitly say the skeleton is source-editable static HTML/CSS, not compiled output, not raw source DOM replay, not the implementation target, not an acceptance app root, and not an independent design source. " +
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
      "For host-prepared webpage clone turns, frame the current frontend_design work as source-region visual restoration of the captured rawproject into a static HTML/CSS skeleton.",
      "Set `submit_frontend_template.final_acceptance_mode` to `visual_baseline_allowed` and `frontend_project.role=visual_baseline_input` for this first workflow unless the operator explicitly asks to combine visual skeleton creation and full project transcription in one pass.",
      "Put maintainability, real implementation, component reuse, and generated/mechanical-output replacement obligations into the future skeleton-to-project transcription contract instead of changing this workflow's deliverable.",
    ].join(" ")
  }
  return "Set `submit_frontend_template.final_acceptance_mode` to `visual_baseline_allowed` and `frontend_project.role=visual_baseline_input` for webpage replica first workflows; put maintainability, real implementation, component reuse, or generated/mechanical-output replacement requirements into the future skeleton-to-project transcription contract unless the operator explicitly asks to combine both workflows."
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
  const file = ProjectRuntimePaths.taskAbsolute(
    Instance.directory,
    taskID,
    "frontend-design",
    "frontend-design-process-trace.json",
  )
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
  const remainingSourceDebt = Array.from(
    new Set(
      replacementEvents.flatMap((event) => {
        const value = event.details?.remainingSourceDebt
        return Array.isArray(value)
          ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          : []
      }),
    ),
  )
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
  const file = ProjectRuntimePaths.taskAbsolute(
    Instance.directory,
    taskID,
    "frontend-design",
    "frontend-design-iteration-state.json",
  )
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
      : trace.events
          .map((event) => {
            const detail = event.details ? ` ${JSON.stringify(event.details)}` : ""
            return `- ${event.status}: ${event.name}${detail}`
          })
          .join("\n"),
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
        "Record the frontend_design agent's selected rawproject source region before restoring it from skeleton/source evidence into the static HTML/CSS visual skeleton. " +
        "This is process evidence only: it does not replace source edits, audits, builds, or visual checks.",
      inputSchema: z.object({
        regionComponentName: z.string().describe("The generated source-dom region component selected for replacement."),
        regionFilePath: z
          .string()
          .describe("The region file path from sourceDomReplacementPlan/sourceDomIterationState."),
        replacementPlanFile: z.string().describe("Path to the sourceDomReplacementPlan.ts row used as evidence."),
        iterationStateFile: z.string().describe("Path to sourceDomIterationState.ts used to identify the candidate."),
        recommendedComponentName: z
          .string()
          .optional()
          .describe("Semantic component name the agent intends to create or update."),
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
            "Next skeleton edits should stay inside this selected region's HTML, CSS, assets, visible content, and representative interaction-state visuals.",
            "If you already read this selected region file, the next file-changing action should write or repair the visual skeleton slice. Additional reads before that write must be direct imports or explicitly named data/style/asset sidecars for this selected region only, not unrelated skeleton wrappers, footer/economy/FAQ/chart/list files, whole manifests, broad source data, or exhaustive `AssetPath`/`svgPaths`/`asset_*.path.txt`/CSS-token scans.",
            "Do not pre-read every asset path or CSS token before writing. Preserve observed asset IDs/token names and source IDs in skeleton comments/attributes/report notes first, then use same-region render/evaluation evidence to decide exact path/token repairs.",
            "The next filesystem-changing skeleton edits must belong to this selected region only. Do not write footer, economy table, FAQ, map, chart, card/list, combined content, or unrelated CSS until this region has a replacement result and the other region is selected.",
            "Restore the selected source component/row into HTML/CSS/assets by transcribing its actual labels, numeric data, source IDs, class responsibilities, SVG paths/assets, and interaction-state visuals; do not invent simplified SVGs, approximate values, or generic styling from memory.",
            "If this selected file is already a semantic skeleton component, use it as source evidence for faithful HTML/CSS restoration: preserve its data object shape in notes, root source IDs, `data-*`/ARIA attributes, exact class names when needed for CSS reachability, wrapper nesting, `target`/`rel`, menu/dropdown/offer visual states, `AssetPath` or asset resolver usage, asset path references, circles, fills, viewBox/width/height, and helper responsibilities. Do not replace asset references with guessed inline SVG paths or simplify nested structure until skeleton render/evaluation evidence proves parity.",
            "Data/content snippets are region-owned during restoration; do not put records from another source region into them until that other region has its own selection and replacement result.",
            "Do not select another region until you record this region's replacement result. Skeleton root wiring may include only this region and previously completed region visuals.",
            "Before writing files for another region, render this region through one explicit static URL or file path, feed its screenshot into webpage_evaluate with passThreshold 96, call webpage_vision_judge for visible mismatches, repair this same region when the score is below 96/100, then record this region's replacement result and call record_frontend_region_selection for the next region.",
            "If this region is a chart, map, table, calendar, or other complex control, restore the observed component kind and source-backed visual/data surface; a labeled placeholder box is blocked/deferred visual debt, not a completed replacement.",
          ]
            .filter(Boolean)
            .join("\n"),
          metadata: { event: "frontend_design_region_selection", ...params },
        }
      },
    }),
    record_frontend_replacement_result: tool({
      description:
        "Record the result of one frontend_design rawproject source-region replacement attempt. " +
        "Use after source edits, build/audit/visual checks, or a concrete blocker. This writes process evidence only; it does not mark acceptance by itself.",
      inputSchema: z.object({
        regionComponentName: z
          .string()
          .describe("Generated source-dom region component from sourceDomReplacementPlan/sourceDomIterationState."),
        replacementStatus: z
          .enum(["completed", "blocked", "deferred"])
          .describe("Current result for this named region replacement."),
        replacementComponentName: z.string().optional().describe("Visual region/component restored for this region."),
        filesChanged: z
          .array(z.string())
          .default([])
          .describe("HTML skeleton files/assets changed for this replacement attempt."),
        dataModules: z
          .array(z.string())
          .default([])
          .describe("Source data/content snippets represented or noted for later transcription."),
        styleModules: z.array(z.string()).default([]).describe("CSS/style files extracted or updated."),
        removedGeneratedBoundaries: z
          .array(z.string())
          .default([])
          .describe(
            "Generated source-dom boundaries replaced in the visual skeleton or recorded as later transcription debt.",
          ),
        visualEvidence: z
          .array(z.string())
          .default([])
          .describe(
            "Rendered screenshots, webpage_render artifacts, webpage_evaluate reports, webpage_vision_judge notes, or visual-diff artifacts used for this replacement.",
          ),
        auditEvidence: z
          .array(z.string())
          .default([])
          .describe("Source traceability or source-quality outputs used for this replacement."),
        remainingSourceDebt: z
          .array(z.string())
          .default([])
          .describe("Named visual/source regions still unfinished after this attempt."),
        nextRegionComponentName: z
          .string()
          .optional()
          .describe("Next source region selected from iteration evidence, if known."),
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
            params.remainingSourceDebt.length > 0
              ? `- Remaining visual/source debt: ${params.remainingSourceDebt.join(", ")}`
              : undefined,
            params.remainingSourceDebt.length > 0
              ? "- Do not describe the HTML skeleton as final while visual/source debt remains; continue source-region restoration or mark the final handoff incomplete/blocked."
              : undefined,
            "- Completed means source-backed HTML/CSS/assets/content with render/evaluate evidence that passes high-fidelity comparison; a score below 96/100 is remaining visual debt, not placeholder UI/text/classes, fake spacers, or rendered future-region filler.",
          ]
            .filter(Boolean)
            .join("\n"),
          metadata: { event: "frontend_design_replacement_result", ...params },
        }
      },
    }),
  }
}

async function createFrontendTool(
  info: Tool.Info,
  input: { taskID?: string; signal?: AbortSignal },
  trace: FrontendDesignAgent.ProcessTrace,
  initCtx?: Tool.InitContext,
) {
  const initialized = await info.init(initCtx)
  return tool({
    description: initialized.description,
    inputSchema: initialized.parameters,
    execute: async (args, options) => {
      const meta = (
        options as { opencorvus?: { sessionID?: string; messageID?: string; toolCallID?: string } } | undefined
      )?.opencorvus
      const abort =
        (options as { abortSignal?: AbortSignal } | undefined)?.abortSignal ??
        input.signal ??
        new AbortController().signal
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
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function createFrontendSubmitTools(outputToolKit: ReturnType<typeof createFrontendTemplateOutputTools>): ToolSet {
  return {
    submit_frontend_template: outputToolKit.tools.submit_frontend_template,
  }
}

function createFrontendDesignContextTools(): ToolSet {
  return selectFrontendStaticTools(
    createAgentContextTools(),
    FRONTEND_DESIGN_CONTEXT_TOOL_IDS,
    "frontend-design context",
  )
}

function selectFrontendStaticTools(tools: ToolSet, ids: readonly string[], label: string): ToolSet {
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

async function createWebpageEvidenceTools(
  input: { taskID?: string; signal?: AbortSignal },
  trace = createFrontendProcessTrace(),
): Promise<ToolSet> {
  const tools = {
    webpage_extract: await createFrontendTool(WebpageExtractTool, input, trace),
    webpage_compile: await createFrontendTool(WebpageCompileTool, input, trace),
    webpage_analyze: await createFrontendTool(WebpageAnalyzeTool, input, trace),
    webpage_runtime_state: await createFrontendTool(WebpageRuntimeStateTool, input, trace),
  }
  return selectFrontendStaticTools(tools, FRONTEND_DESIGN_WEBPAGE_EVIDENCE_TOOL_IDS, "frontend-design webpage evidence")
}

async function createFrontendImplementationTools(
  input: { taskID?: string; signal?: AbortSignal },
  trace = createFrontendProcessTrace(),
): Promise<ToolSet> {
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

async function createFrontendUtilityTools(
  input: { taskID?: string; signal?: AbortSignal },
  trace = createFrontendProcessTrace(),
): Promise<ToolSet> {
  const agent = await Agent.get("frontend-design")
  if (!agent) throw new Error("frontend-design agent definition is missing")
  const tools = {
    skill: await createFrontendTool(SkillTool, input, trace, { agent }),
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
  createWebpageEvidenceTools,
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
