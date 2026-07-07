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
import { BrowserPreviewReferenceRegionsTool } from "@/tool/browser-preview-reference-regions"
import { BrowserPreviewCompareScrollSlicesTool } from "@/tool/browser-preview-compare-scroll-slices"
import { BrowserPreviewLayoutGeometryTool } from "@/tool/browser-preview-layout-geometry"
import { BrowserPreviewTool } from "@/tool/browser-preview"
import { SkillTool } from "@/tool/skill"
import { RequestOrchestratorDecisionTool } from "@/tool/request-orchestrator-decision"
import {
  VISUAL_QA_CONTEXT_TOOL_IDS,
  VISUAL_QA_EVIDENCE_TOOL_IDS,
  VISUAL_QA_RUNTIME_EVIDENCE_TOOL_IDS,
  VISUAL_QA_SESSION_TOOL_IDS,
  VISUAL_QA_UTILITY_TOOL_IDS,
} from "./static-tools"
import { createVisualQaOutputTools, type VisualQaCollector } from "./output-tools"
import type { VisualQaAcceptance, VisualQaReport } from "./schema"
import { renderVisualQaProductDesignPrinciples } from "./product-design-principles"
import { renderAgentContextPackets, type AgentContextPacket } from "@/agent/context-packet"
import { visualQaDispatchContextFromPackets } from "./context"

import VISUAL_QA_CORE from "@/prompt/core/visual-qa-core.txt"

const log = Log.create({ service: "visual-qa" })

export namespace VisualQaAgent {
  export interface AnalyzeInput {
    taskTitle: string
    taskRequest: string
    reason: string
    focus?: string
    contextPackets?: AgentContextPacket[]
    projectRoot?: string
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
    const dispatchContext = visualQaDispatchContextFromPackets(input.contextPackets)
    const outputToolKit = createVisualQaOutputTools({
      taskID: input.taskID,
      projectRoot: input.projectRoot,
      referenceParityRequired: dispatchContext.referenceParityRequired,
      requiredReferenceRegions: dispatchContext.requiredReferenceRegions,
    })
    const contextTools = await createVisualQaContextTools({
      taskID: input.taskID,
      sessionID: input.parentSessionID,
    })
    const evidenceTools = await createVisualQaEvidenceTools({ taskID: input.taskID, signal: input.signal })
    const utilityTools = await createVisualQaUtilityTools({ taskID: input.taskID, signal: input.signal })
    const agentTools = {
      ...contextTools,
      ...utilityTools,
      ...evidenceTools,
      ...outputToolKit.tools,
    }
    assertVisualQaStaticToolSurface(agentTools)

    log.info("visual QA starting", {
      taskID: input.taskID,
      contextPackets: input.contextPackets?.map((packet) => packet.id) ?? [],
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
        stageOwnedToolIDs: Object.keys(outputToolKit.tools),
        getCollector: () => outputToolKit.getCollector(),
        buildReport: () => outputToolKit.buildReport(),
      },
      buildUserPrompt: () => buildVisualQaUserPrompt(input, dispatchContext),
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

function buildVisualQaUserPrompt(
  input: VisualQaAgent.AnalyzeInput,
  dispatchContext = visualQaDispatchContextFromPackets(input.contextPackets),
): string {
  const sections = [
    "# Delegation\n\nOrchestrator is asking visual-qa to run the frontend visual GUI and functional product review for the task before the Orchestrator final lifecycle decision. GUI means Graphical User Interface: the visible application screen and controls. Visual QA and integrity are peer post-implementation review agents: visual-qa owns focused frontend visual/product-design review evidence, while integrity owns system-completeness review evidence. Orchestrator owns completion or failure. Consume only the task-scoped context packets supplied below as upstream evidence, test the real rendered product, and submit one structured visual QA report. Visual QA is report-only: do not edit files, run shell repair commands, or claim code repair. Register every concrete review check first with `register_visual_qa_check_item`; register evidence rows only after you actually captured or inspected the screenshot, browser preview comparison, console/network output, command output, source artifact, or other concrete evidence. A check item may leave `evidence_refs` empty during initial registration; after evidence capture, either overwrite the check item with registered evidence refs or rely on registered evidence rows whose `check_ids` include that check. Every coverage row, finding, production blocker, DOM problem region, unresolved module problem, and reference parity ref must cite registered `check_ids` and must reuse refs from registered `register_visual_qa_evidence` rows. Do not fill schema refs from intent, plans, executor prose, or guessed artifact names. Review like a picky professional product designer and design QA reviewer: decide whether the product is fit to generate or ship, and list concrete production blockers when it is not. Do not give draft-quality, visibly incomplete, clipped, fake, or misleading UI the benefit of the doubt. Visual QA is not a style-only pass: if the component family, visualization type, layout structure, information architecture, or interaction model is fundamentally wrong, block delivery and require removing/replacing/rebuilding that component instead of CSS tweaking. Review coarse-to-fine: component truth and visible functionality first, layout/composition second, spacing/typography/color/state-style polish last. Do not chase visual scores or external judge verdicts; Visual QA acceptance is the structured report's own accepted/blocker fields. When a visual blocker maps to a rendered Document Object Model (DOM) node, include `problem_dom_regions` with selector/locator, DOM path, bounded HTML excerpt, parent/sibling context, bbox, computed styles, attributes, and code-search terms so the current workflow's implementation owner can repair the right source module; screenshots remain the visual proof. Reference/clone fidelity is in scope only when the current task, current goal, or acceptance evidence explicitly requires reference parity. For explicitly required reference/clone regions with source evidence and local implementation regions, prioritize screenshot comparison, inspect fresh Browser MCP screenshot/observe evidence and screen-by-screen visual evidence against the source contract, use `browser_preview_reference_regions` only for one source-binding module comparison when source and local module semantics match, and use `browser_preview_compare_scroll_slices` for supporting side-by-side page-slice evidence when the source reference screenshot and implementation scroll offset are meaningful. For each comparison artifact, read `comparison_guidance.side_by_side_legend`: LEFT is the source/reference image and RIGHT is the rendered/local implementation; use its checklist to inspect layout alignment drift, missing or wrong icons/assets, color and surface differences, spacing/density anomalies, typography and clipping defects, hallucinated or missing content, wrong component family, chart/table/map scale errors, state-style mismatches, layering issues, scoped desktop viewport drift, and fake placeholder UI. For each required reference region key, register a check item with matching `reference_region_key`. `browser_preview_reference_regions` is for concrete component or module regions; do not use it to bind a first-viewport slice, whole-page screenshot, body/main/app root, or page-shell locator as formal proof. It does not run a second reference-comparison pass and does not auto-call scroll-slice or screenshot tools after bind failure. For first-viewport and screen-by-screen checks, use `browser_preview_compare_scroll_slices` with `scrollY` and `sliceHeight` aligned to the source slice. For edge alignment, shared content rails, margin, padding, gap, overflow, or desktop width scaling claims, call `browser_preview_layout_geometry` against the persisted preview target and affected implementation regions. When two or more regions should align, pass explicit `alignmentGroups` for the shared left/right/center/width/height edges so the manifest records numeric spread instead of prose only. Cite it only as supporting geometry evidence. For completed-page visual sweeps, inspect the page screen by screen: call `browser_preview_compare_scroll_slices` repeatedly for viewport-sized slices and cite them only as supporting visual_diff evidence. Do not judge the whole webpage from one full-page screenshot, one giant screenshot attachment, or a one-shot visual judge verdict. For frontend replica / clone / visual parity / reference-page recreation tasks, request only `desktop` evidence by default. Do not request, evaluate, or block on mobile/tablet reference evidence unless the latest current operator instruction explicitly asks for tablet/mobile/responsive/multi-end migration as a separate task scope. When the current task explicitly authorizes multiple viewport, responsive, or multi-end review, or when you actually inspect more than one viewport, register a `multi-viewport-alignment` check item covering shared layout anchors, section order, gutters, persistent controls, text wrapping, overflow behavior, and critical interactions across the scoped viewports.",
    "Tool result acceptance discipline: `state.status=completed`, returned attachments, job IDs, or registered evidence rows are not acceptance proof. For `browser_preview_evidence:*` refs, inspect the returned artifacts and rely on the tool result's own `operation` and `status`; failed visual_diff results and diagnostic-only layout-geometry must become blockers or supporting diagnostics, not pass evidence. For `browser_preview_compare_scroll_slices`, cite the returned `browser_preview_evidence:<evidenceID>` ref, not the job ID or a bare side-by-side path, and only as passing visual_diff support when the result status is `passed`.",
    "Geometry alignment discipline: broad heading or section enumeration is only a discovery aid. The submitted `browser_preview_layout_geometry` request must use explicit task-scoped region ids, and shared-rail `alignmentGroups` must include every affected downstream section such as `News` when it belongs to the same content rail.",
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
  if (dispatchContext.appUrl?.trim()) sections.push(`# Known Preview URL\n\n${dispatchContext.appUrl}`)
  if (dispatchContext.previewCommand?.trim()) {
    sections.push(
      "# Suggested Preview Command\n\n" +
        `${dispatchContext.previewCommand}\n\n` +
        "Use Node for Playwright/browser automation on Windows. Do not launch Playwright through bun.",
    )
  }
  if (dispatchContext.referenceParityRequired) {
    sections.push(
      "# Reference Parity Evidence Contract\n\n" +
        "This task has structured visual/reference parity acceptance. Use `reference_parity.required=true`. Put only formal `reference-comparison` evidence refs in `reference_comparison_evidence_refs`; cite screenshot or visual_diff refs as supporting evidence rows, not as formal reference parity refs. List exact blockers for any region that remains unverified. " +
        "A one-shot whole-page screenshot judge is not valid completion evidence. Do not invent reference-comparison refs.",
    )
  }
  const contextPackets = renderAgentContextPackets(input.contextPackets)
  if (contextPackets) sections.push(contextPackets)
  sections.push(
    "# Required Output\n\n" +
      "Call `submit_visual_qa_report` exactly once after registering check items and every report row. The final submit call only sets accepted and summary; do not put findings, blockers, evidence, DOM regions, coverage, or reference parity arrays in the final payload. A passing report must include registered check_items, fresh screenshot-bearing durable evidence refs tied to check_ids through registered evidence rows, coverage of checked GUI regions/viewports/states/functions tied to check_ids, no failed/inconclusive check_items, no open critical/major finding, no production_blockers, no unresolved_code_module_problems, and evidence that coarse component/function defects named by context packets are absent in the current rendered product before style polish is accepted. Durable evidence refs use OpenCorvus evidence namespaces such as `browser_preview_evidence:*`, research/design evidence namespaces, or AttachmentStore `/attachment/...` URLs; do not put bare filesystem paths, file URLs, command text, or `screenshot://` labels in report refs. If the report covers more than one viewport, it must include a `multi-viewport-alignment` check item with coverage spanning those viewports. If explicit reference parity is in scope, cite registered formal `reference-comparison` evidence in `reference_comparison_evidence_refs` when available, use per-screen screenshots or scroll-slice comparisons only as supporting evidence for page-level analysis, register a check item for each required reference region, and name any remaining evidence gap instead of inventing proof or reference-comparison refs. If the surface is not production-ready, set accepted=false and list production_blockers with principle_ids, region, reason, user-visible impact, registered evidence refs, required correction, and check_ids. For each DOM-localizable visual blocker, add `problem_dom_regions` tied to the blocker ID and check_ids with locator, DOM path, bounded outer_html_excerpt, parent/sibling context, bbox, computed_style, attributes, code_search_terms, and registered evidence refs. If a production blocker maps to code that the current workflow's implementation owner must change, report unresolved_code_module_problems tied to blocker IDs and check_ids with a concrete code module reference entity and observed problem; do not submit a new-task request.",
  )
  return sections.join("\n\n")
}

async function createVisualQaContextTools(input: { taskID?: string; sessionID?: string }): Promise<ToolSet> {
  return selectVisualQaStaticTools(
    await filterAgentTools(createAgentContextTools(), "visual-qa", input),
    VISUAL_QA_CONTEXT_TOOL_IDS,
    "visual-qa context",
  )
}

async function createVisualQaEvidenceTools(input: { taskID?: string; signal?: AbortSignal }): Promise<ToolSet> {
  const tools = {
    browser_preview: await createVisualQaTool(BrowserPreviewTool, input),
    browser_preview_reference_regions: await createVisualQaTool(BrowserPreviewReferenceRegionsTool, input),
    browser_preview_compare_scroll_slices: await createVisualQaTool(BrowserPreviewCompareScrollSlicesTool, input),
    browser_preview_layout_geometry: await createVisualQaTool(BrowserPreviewLayoutGeometryTool, input),
  }
  return selectVisualQaStaticTools(tools, VISUAL_QA_RUNTIME_EVIDENCE_TOOL_IDS, "visual-qa evidence")
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
  createVisualQaEvidenceTools,
  createVisualQaUtilityTools,
  assertVisualQaStaticToolSurface,
}
