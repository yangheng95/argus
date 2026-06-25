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
import { BrowserPreviewBindLocalModuleTool } from "@/tool/browser-preview-bind-local-module"
import { BrowserPreviewCompareScrollSlicesTool } from "@/tool/browser-preview-compare-scroll-slices"
import { BrowserPreviewCompareRegionsTool } from "@/tool/browser-preview-compare-regions"
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
import type { VisualQaReport } from "./schema"
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

    log.info("visual QA finished", {
      sessionID: out.session.id,
      accepted: collector.final.accepted,
      findings: collector.final.findings.length,
      evidence: collector.final.evidence.length,
    })

    return { report: collector.final, sessionID: out.session.id }
  }
}

function buildVisualQaUserPrompt(input: VisualQaAgent.AnalyzeInput): string {
  const sections = [
    "# Delegation\n\nOrchestrator is asking visual-qa to run the final frontend visual GUI and functional product review for the task. GUI means Graphical User Interface: the visible application screen and controls. Visual QA and integrity are peer post-build review agents: visual-qa owns focused frontend visual/product-design evidence, while integrity owns system-completeness final acceptance. Consume task-scoped frontend_design/build evidence plus any prior integrity evidence as the source of truth, test the real rendered product, repair in-scope visual or functional defects when safe, and submit one structured visual QA report. Review like a picky professional product designer and design QA reviewer: decide whether the product is fit to generate or ship, and list concrete production blockers when it is not. Do not give draft-quality, visibly incomplete, clipped, fake, or misleading UI the benefit of the doubt. Visual QA is not a style-only pass: if the component family, visualization type, layout structure, information architecture, or interaction model is fundamentally wrong, block delivery and require removing/replacing/rebuilding that component instead of CSS tweaking. Repair coarse-to-fine: component truth and visible functionality first, layout/composition second, spacing/typography/color/state-style polish last. Do not chase visual scores or external judge verdicts; Visual QA acceptance is the structured report's own accepted/blocker fields. Reference/clone fidelity is in scope only when the current task, current goal, or acceptance evidence explicitly requires reference parity. For explicitly required reference/clone regions with source evidence and local implementation regions, call `browser_preview_bind_local_module` for missing or questionable bindings and then pass the binding to `browser_preview_compare_regions`. Treat `browser_preview_bind_local_module` evidence as `source-binding`: it proves a local/source binding candidate only and cannot be cited as final Reference vs Implementation proof. For final completed-page visual sweeps, `browser_preview_compare_scroll_slices` may compare a prepared reference screenshot slice with the implementation at the same absolute scrollY; cite it only as supporting visual_diff evidence, never as reference_comparison proof. If the task or latest user instruction scopes a clone/parity task to desktop only, request only `desktop` viewport region comparison evidence and do not block on mobile or tablet reference evidence.",
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
        "This task has structured visual/reference parity acceptance. Use `reference_parity.required=true` and cite fresh " +
        "`browser_preview_compare_regions` reference-comparison artifact IDs for the required regions when you can produce them. " +
        "Standalone screenshots and `browser_preview_compare_scroll_slices` may support the review but are weaker than Reference vs Implementation comparison. " +
        "If the bind/compare chain cannot run after repair attempts, report the exact blocker or evidence gap instead of inventing proof.",
    )
  }
  pushContextSection(sections, "Frontend Design Context", input.frontendDesign)
  pushContextSection(sections, "Frontend Research Context", input.frontendResearch)
  pushContextSection(sections, "Integrity Review Context", input.integrityContext)
  pushContextSection(sections, "Build Evidence Context", input.buildEvidence)
  pushContextSection(sections, "Prior Visual QA Context", input.priorVisualQa)
  sections.push(
    "# Required Output\n\n" +
      "Call `submit_visual_qa_report` exactly once. A passing report must include fresh evidence paths or URLs, coverage of checked GUI regions/viewports/states/functions, no open critical/major finding, no production_blockers, no follow_up_task, and evidence that coarse component/function defects named by build evidence or integrity are actually repaired before style polish. If explicit reference parity is in scope, produce task-scoped `reference-comparison` evidence from `browser_preview_compare_regions` for required bound regions when the bind/compare chain can run; otherwise name the blocker or remaining evidence gap in the report instead of inventing proof. If the surface is not production-ready, set accepted=false and list production_blockers with principle_ids, region, reason, user-visible impact, evidence refs, and required correction. If a production blocker cannot be safely fixed by visual-qa inside the current worktree, include follow_up_task with a complete new-round task request tied to the blocker IDs; do not simply end with a failed report. If you repair files, include changed_files and verification evidence.",
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
    browser_preview_bind_local_module: await createVisualQaTool(BrowserPreviewBindLocalModuleTool, input),
    browser_preview_compare_regions: await createVisualQaTool(BrowserPreviewCompareRegionsTool, input),
    browser_preview_compare_scroll_slices: await createVisualQaTool(BrowserPreviewCompareScrollSlicesTool, input),
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
