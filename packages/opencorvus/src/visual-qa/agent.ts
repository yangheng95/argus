import type { ToolSet } from "ai"
import { runAgentSession } from "@/agent/runner"
import { Agent } from "@/agent/agent"
import type { AgentSessionContinuation } from "@/engine/stage-continuation"
import { createAgentContextTools } from "@/agent/context-tools"
import { filterAgentTools } from "@/agent/filter-tools"
import { withFactCheckRegistration } from "@/prompt/fragments/fact-check-registration"
import { renderUserRequestSection } from "@/intent/request-prompt"
import { Log } from "@/util/log"
import { createAiSdkToolFromInfo } from "@/tool/ai-sdk-adapter"
import type { Tool } from "@/tool/tool"
import { BashTool } from "@/tool/bash"
import { BrowserPreviewReferenceRegionsTool } from "@/tool/browser-preview-reference-regions"
import { BrowserPreviewCompareScrollSlicesTool } from "@/tool/browser-preview-compare-scroll-slices"
import { BrowserPreviewLayoutGeometryTool } from "@/tool/browser-preview-layout-geometry"
import { BrowserPreviewTool } from "@/tool/browser-preview"
import { EditTool } from "@/tool/edit"
import { WriteTool } from "@/tool/write"
import { ApplyPatchTool } from "@/tool/apply_patch"
import { SkillTool } from "@/tool/skill"
import { RequestOrchestratorDecisionTool } from "@/tool/request-orchestrator-decision"
import {
  VISUAL_QA_CONTEXT_TOOL_IDS,
  VISUAL_QA_IMPLEMENTATION_TOOL_IDS,
  VISUAL_QA_SESSION_TOOL_IDS,
  VISUAL_QA_UTILITY_TOOL_IDS,
} from "./static-tools"
import { createVisualQaOutputTools, type VisualQaCollector } from "./output-tools"
import type { VisualQaAcceptance, VisualQaReport } from "./schema"
import { renderVisualQaProductDesignPrinciples } from "./product-design-principles"

import VISUAL_QA_CORE from "@/prompt/core/visual-qa-core.txt"

const log = Log.create({ service: "visual-qa" })

export namespace VisualQaAgent {
  export interface AnalyzeInput {
    taskTitle: string
    taskRequest: string
    reason: string
    focus?: string
    appUrl?: string
    previewCommand?: string
    frontendDesign?: string
    frontendResearch?: string
    integrityContext?: string
    buildEvidence?: string
    priorVisualQa?: string
    projectRoot?: string
    referenceParityRequired?: boolean
    requiredReferenceRegions?: string[]
    taskID?: string
    parentSessionID?: string
    model?: { providerID: string; modelID: string }
    signal?: AbortSignal
    onStatus?: (summary: string) => void | Promise<void>
    onSessionCreated?: (sessionID: string) => void
    continuation?: AgentSessionContinuation
  }

  export interface AnalyzeResult {
    report: VisualQaReport
    acceptance: VisualQaAcceptance
    sessionID: string
  }

  export async function analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
    const outputToolKit = createVisualQaOutputTools({
      taskID: input.taskID,
      projectRoot: input.projectRoot,
      referenceParityRequired: input.referenceParityRequired,
      requiredReferenceRegions: input.requiredReferenceRegions,
    })
    const contextTools = await createVisualQaContextTools({
      taskID: input.taskID,
      sessionID: input.parentSessionID,
    })
    const implementationTools = await createVisualQaImplementationTools({ taskID: input.taskID, signal: input.signal })
    const utilityTools = await createVisualQaUtilityTools({ taskID: input.taskID, signal: input.signal })
    const agentTools = {
      ...contextTools,
      ...utilityTools,
      ...implementationTools,
      ...outputToolKit.tools,
    }
    assertVisualQaStaticToolSurface(agentTools)

    log.info("visual QA starting", {
      taskID: input.taskID,
      hasFrontendDesign: Boolean(input.frontendDesign?.trim()),
      hasBuildEvidence: Boolean(input.buildEvidence?.trim()),
      focus: input.focus,
    })

    const out = await runAgentSession({
      kind: "visual-qa",
      core: withFactCheckRegistration(VISUAL_QA_CORE),
      sessionTitle: `Visual QA: ${input.taskTitle}`,
      parentSessionID: input.parentSessionID,
      taskID: input.taskID,
      model: input.model,
      signal: input.signal,
      continuation: input.continuation,
      onStatus: input.onStatus ?? (() => {}),
      onSessionCreated: input.onSessionCreated
        ? (session) => {
            input.onSessionCreated!(session.id)
          }
        : undefined,
      toolKit: {
        tools: agentTools,
        getCollector: () => outputToolKit.getCollector(),
        buildReport: () => outputToolKit.buildReport(),
      },
      buildUserPrompt: () => buildVisualQaUserPrompt(input),
      terminalTool: {
        toolName: "submit_visual_qa_report",
        isSatisfied: (collector: VisualQaCollector) => Boolean(collector.final),
        shouldExposeOnlyTerminalTool: () => false,
      },
    })

    const collector = outputToolKit.getCollector()
    if (!collector.final) {
      throw new Error("Visual QA agent did not call submit_visual_qa_report.")
    }
    if (!collector.acceptance) {
      throw new Error("Visual QA agent submitted a report without an acceptance record.")
    }

    log.info("visual QA finished", {
      sessionID: out.session.id,
      accepted: collector.acceptance.effectiveAccepted,
      submittedAccepted: collector.acceptance.submittedAccepted,
      findings: collector.final.findings.length,
      evidence: collector.final.evidence.length,
    })

    return { report: collector.final, acceptance: collector.acceptance, sessionID: out.session.id }
  }
}

function buildVisualQaUserPrompt(input: VisualQaAgent.AnalyzeInput): string {
  const sections = [
    "# Delegation\n\nOrchestrator is asking visual-qa to run the final frontend visual GUI and functional product review for the task. GUI means Graphical User Interface: the visible application screen and controls. Visual QA and integrity are peer post-build review agents: visual-qa owns focused frontend visual/product-design evidence, while integrity owns system-completeness final acceptance. Consume task-scoped frontend_design/build evidence plus any prior integrity evidence as the source of truth, test the real rendered product, repair in-scope visual or functional defects when safe, and submit one structured visual QA report. Review like a picky professional product designer and design QA reviewer: decide whether the product is fit to generate or ship, and list concrete production blockers when it is not. Do not give draft-quality, visibly incomplete, clipped, fake, or misleading UI the benefit of the doubt. Visual QA is not a style-only pass: if the component family, visualization type, layout structure, information architecture, or interaction model is fundamentally wrong, block delivery and require removing/replacing/rebuilding that component instead of CSS tweaking. Repair coarse-to-fine: component truth and visible functionality first, layout/composition second, spacing/typography/color/state-style polish last. Do not chase visual scores or external judge verdicts; Visual QA acceptance is the structured report's own accepted/blocker fields. When a visual blocker maps to a rendered Document Object Model (DOM) node, include `problem_dom_regions` with selector/locator, DOM path, bounded HTML excerpt, parent/sibling context, bbox, computed styles, attributes, and code-search terms so Build can repair the right source module; screenshots remain the visual proof. Reference/clone fidelity is in scope only when the current task, current goal, or acceptance evidence explicitly requires reference parity. For explicitly required reference/clone regions with source evidence and local implementation regions, prioritize screenshot comparison, inspect fresh Browser MCP screenshot/observe evidence and screen-by-screen visual evidence against the source contract, use `browser_preview_reference_regions` only for one source-binding module comparison when source and local module semantics match, and use `browser_preview_compare_scroll_slices` for supporting side-by-side page-slice evidence when the source reference screenshot and implementation scroll offset are meaningful. `browser_preview_reference_regions` is for concrete component or module regions; do not use it to bind a first-viewport slice, whole-page screenshot, body/main/app root, or page-shell locator as formal proof. It does not run a second reference-comparison pass and does not auto-call scroll-slice or screenshot tools after bind failure. For first-viewport and screen-by-screen checks, use `browser_preview_compare_scroll_slices` with `scrollY` and `sliceHeight` aligned to the source slice. For edge alignment, margin, padding, gap, overflow, or desktop width scaling claims, call `browser_preview_layout_geometry` against the persisted preview target and affected implementation regions, and cite it only as supporting geometry evidence. For completed-page visual sweeps, inspect the page screen by screen: call `browser_preview_compare_scroll_slices` repeatedly for viewport-sized slices and cite them only as supporting visual_diff evidence. Do not judge the whole webpage from one full-page screenshot, one giant screenshot attachment, or a one-shot visual judge verdict. For frontend replica / clone / visual parity / reference-page recreation tasks, request only `desktop` evidence by default. Do not request, evaluate, or block on mobile/tablet reference evidence unless the latest current operator instruction explicitly asks for tablet/mobile/responsive/multi-end migration as a separate task scope.",
    renderUserRequestSection({
      heading: "# Task",
      title: input.taskTitle,
      request: input.taskRequest,
      taskID: input.taskID,
    }),
    renderVisualQaProductDesignPrinciples(),
    `# Dispatch Reason\n\n${input.reason}`,
  ]
  if (input.focus?.trim()) sections.push(`# Focus\n\n${input.focus}`)
  if (input.appUrl?.trim()) sections.push(`# Known Preview URL\n\n${input.appUrl}`)
  if (input.previewCommand?.trim()) {
    sections.push(
      "# Suggested Preview Command\n\n" +
        `${input.previewCommand}\n\n` +
        "Use Node for Playwright/browser automation on Windows. Do not launch Playwright through bun.",
    )
  }
  if (input.referenceParityRequired) {
    sections.push(
      "# Reference Parity Evidence Contract\n\n" +
        "This task has structured visual/reference parity acceptance. Use `reference_parity.required=true`, cite fresh task-scoped screenshot, visual_diff, or `reference-comparison` evidence for the required regions, and list exact blockers for any region that remains unverified. " +
        "A one-shot whole-page screenshot judge is not valid completion evidence. Do not invent reference-comparison refs.",
    )
  }
  pushContextSection(sections, "Frontend Design Context", input.frontendDesign)
  pushContextSection(sections, "Frontend Research Context", input.frontendResearch)
  pushContextSection(sections, "Integrity Review Context", input.integrityContext)
  pushContextSection(sections, "Build Evidence Context", input.buildEvidence)
  pushContextSection(sections, "Prior Visual QA Context", input.priorVisualQa)
  sections.push(
    "# Required Output\n\n" +
      "Call `submit_visual_qa_report` exactly once. A passing report must include fresh screenshot-bearing evidence paths or URLs, coverage of checked GUI regions/viewports/states/functions, no open critical/major finding, no production_blockers, no unresolved_code_module_problems, and evidence that coarse component/function defects named by build evidence or integrity are actually repaired before style polish. If explicit reference parity is in scope, cite `reference-comparison` evidence when available, use per-screen screenshots or scroll-slice comparisons for page-level analysis, and name any remaining evidence gap instead of inventing proof or reference-comparison refs. If the surface is not production-ready, set accepted=false and list production_blockers with principle_ids, region, reason, user-visible impact, evidence refs, and required correction. For each DOM-localizable visual blocker, add `problem_dom_regions` tied to the blocker ID with locator, DOM path, bounded outer_html_excerpt, parent/sibling context, bbox, computed_style, attributes, code_search_terms, and evidence refs. If a production blocker cannot be safely fixed by visual-qa inside the current worktree, report unresolved_code_module_problems tied to blocker IDs with a concrete code module reference entity and observed problem; do not submit a new-task request. If you repair files, include changed_files and verification evidence.",
  )
  return sections.join("\n\n")
}

function pushContextSection(sections: string[], heading: string, value?: string): void {
  const trimmed = value?.trim()
  if (!trimmed) return
  sections.push(trimmed.startsWith("#") ? trimmed : `# ${heading}\n\n${trimmed}`)
}

async function createVisualQaContextTools(input: { taskID?: string; sessionID?: string }): Promise<ToolSet> {
  return selectVisualQaStaticTools(
    await filterAgentTools(createAgentContextTools(), "visual-qa", input),
    VISUAL_QA_CONTEXT_TOOL_IDS,
    "visual-qa context",
  )
}

async function createVisualQaImplementationTools(input: { taskID?: string; signal?: AbortSignal }): Promise<ToolSet> {
  const tools = {
    browser_preview: await createVisualQaTool(BrowserPreviewTool, input),
    browser_preview_reference_regions: await createVisualQaTool(BrowserPreviewReferenceRegionsTool, input),
    browser_preview_compare_scroll_slices: await createVisualQaTool(BrowserPreviewCompareScrollSlicesTool, input),
    browser_preview_layout_geometry: await createVisualQaTool(BrowserPreviewLayoutGeometryTool, input),
    bash: await createVisualQaTool(BashTool, input),
    edit: await createVisualQaTool(EditTool, input),
    write: await createVisualQaTool(WriteTool, input),
    apply_patch: await createVisualQaTool(ApplyPatchTool, input),
  }
  return selectVisualQaStaticTools(tools, VISUAL_QA_IMPLEMENTATION_TOOL_IDS, "visual-qa implementation")
}

async function createVisualQaUtilityTools(input: { taskID?: string; signal?: AbortSignal }): Promise<ToolSet> {
  const agent = await Agent.get("visual-qa")
  if (!agent) throw new Error("visual-qa agent definition is missing")
  const tools = {
    skill: await createVisualQaTool(SkillTool, input, { agent }),
    request_orchestrator_decision: await createVisualQaTool(RequestOrchestratorDecisionTool, input),
  }
  return selectVisualQaStaticTools(tools, VISUAL_QA_UTILITY_TOOL_IDS, "visual-qa utility")
}

async function createVisualQaTool(
  info: Tool.Info,
  input: { taskID?: string; signal?: AbortSignal },
  initCtx?: Tool.InitContext,
) {
  return createAiSdkToolFromInfo({
    info,
    agent: "visual-qa",
    taskID: input.taskID,
    signal: input.signal,
    initCtx,
  })
}

function selectVisualQaStaticTools(tools: ToolSet, ids: readonly string[], label: string): ToolSet {
  const selected: ToolSet = {}
  for (const id of ids) {
    const item = tools[id]
    if (!item) throw new Error(`${label} static tool is missing: ${id}`)
    selected[id] = item
  }
  return selected
}

function assertVisualQaStaticToolSurface(tools: ToolSet): void {
  const expected = [...VISUAL_QA_SESSION_TOOL_IDS].sort()
  const actual = Object.keys(tools).sort()
  const expectedSet = new Set<string>(expected)
  const actualSet = new Set<string>(actual)
  const missing = expected.filter((id) => !actualSet.has(id))
  const extra = actual.filter((id) => !expectedSet.has(id))
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      "visual-qa runtime tool surface diverged from static definition: " +
        `missing=[${missing.join(", ")}] extra=[${extra.join(", ")}]`,
    )
  }
}

export const VisualQaTestHooks = {
  buildVisualQaUserPrompt,
  createVisualQaContextTools,
  createVisualQaImplementationTools,
  createVisualQaUtilityTools,
  assertVisualQaStaticToolSurface,
}
