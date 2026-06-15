import { tool, type ToolSet } from "ai"
import { runAgentSession } from "@/agent/runner"
import { Agent } from "@/agent/agent"
import { createAgentContextTools } from "@/agent/context-tools"
import { filterAgentTools } from "@/agent/filter-tools"
import { withFactCheckRegistration } from "@/prompt/fragments/fact-check-registration"
import { renderUserRequestSection } from "@/intent/request-prompt"
import { Log } from "@/util/log"
import type { Tool } from "@/tool/tool"
import { BashTool } from "@/tool/bash"
import { BrowserPreviewTool } from "@/tool/browser-preview"
import { EditTool } from "@/tool/edit"
import { WriteTool } from "@/tool/write"
import { ApplyPatchTool } from "@/tool/apply_patch"
import { SkillTool } from "@/tool/skill"
import {
  WebpageRenderTool,
  WebpageEvaluateTool,
  WebpageTextDiffTool,
  WebpageVisionJudgeTool,
} from "@/frontend-design/tools"
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
    taskID?: string
    parentSessionID?: string
    model?: { providerID: string; modelID: string }
    signal?: AbortSignal
    onStatus?: (summary: string) => void | Promise<void>
    onSessionCreated?: (sessionID: string) => void
  }

  export interface AnalyzeResult {
    report: VisualQaReport
    sessionID: string
  }

  export async function analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
    const outputToolKit = createVisualQaOutputTools()
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
    "# Delegation\n\nOrchestrator is asking visual-qa to run post-goal-batch frontend visual GUI fidelity and functional testing. GUI means Graphical User Interface: the visible application screen and controls. Visual QA and integrity are peer post-build review agents: visual-qa owns focused frontend visual/product-design evidence, while integrity owns system-completeness final acceptance. Consume task-scoped frontend_design/build evidence plus any prior integrity evidence as the source of truth, test the real rendered product, repair in-scope visual or functional defects when safe, and submit one structured visual QA report. Review like a picky professional product designer and design QA reviewer: decide whether the product is fit to generate or ship, and list concrete production blockers when it is not. Do not give draft-quality, visibly incomplete, clipped, fake, or misleading UI the benefit of the doubt. Visual QA is not a style-only pass: if the component family, visualization type, layout structure, information architecture, or interaction model is fundamentally wrong, block delivery and require removing/replacing/rebuilding that component instead of CSS tweaking. Repair coarse-to-fine: component truth and visible functionality first, layout/composition second, spacing/typography/color/state-style polish last. If any reference image is present, it is the authoritative visual truth: require 1:1 layout and style fidelity. 1:1 means one-to-one visible geometry and styling, not a relaxed similarity standard. Numeric similarity scores are evidence, not the verdict; do not use a fixed score as the only pass/fail rule.",
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
  pushContextSection(sections, "Frontend Design Context", input.frontendDesign)
  pushContextSection(sections, "Frontend Research Context", input.frontendResearch)
  pushContextSection(sections, "Integrity Review Context", input.integrityContext)
  pushContextSection(sections, "Build Evidence Context", input.buildEvidence)
  pushContextSection(sections, "Prior Visual QA Context", input.priorVisualQa)
  sections.push(
    "# Required Output\n\n" +
      "Call `submit_visual_qa_report` exactly once. A passing report needs fresh evidence paths or URLs, coverage of checked GUI regions/viewports/states/functions, no open critical/major finding, no production_blockers, no follow_up_task, and evidence that coarse component/function defects named by build evidence or integrity are actually repaired before style polish. With a reference image, accepted=true also requires evidence that the rendered screenshot matches the reference image's layout geometry, spacing, typography, colors, component styling, and visible state styling 1:1. If the surface is not production-ready, set accepted=false and list production_blockers with principle_ids, region, reason, user-visible impact, evidence refs, and required correction. If a production blocker cannot be safely fixed by visual-qa inside the current worktree, include follow_up_task with a complete new-round task request tied to the blocker IDs; do not simply end with a failed report. If you repair files, include changed_files and verification evidence.",
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
    bash: await createVisualQaTool(BashTool, input),
    edit: await createVisualQaTool(EditTool, input),
    write: await createVisualQaTool(WriteTool, input),
    apply_patch: await createVisualQaTool(ApplyPatchTool, input),
    webpage_render: await createVisualQaTool(WebpageRenderTool, input),
    webpage_evaluate: await createVisualQaTool(WebpageEvaluateTool, input),
    webpage_text_diff: await createVisualQaTool(WebpageTextDiffTool, input),
    webpage_vision_judge: await createVisualQaTool(WebpageVisionJudgeTool, input),
  }
  return selectVisualQaStaticTools(tools, VISUAL_QA_IMPLEMENTATION_TOOL_IDS, "visual-qa implementation")
}

async function createVisualQaUtilityTools(input: { taskID?: string; signal?: AbortSignal }): Promise<ToolSet> {
  const agent = await Agent.get("visual-qa")
  if (!agent) throw new Error("visual-qa agent definition is missing")
  const tools = {
    skill: await createVisualQaTool(SkillTool, input, { agent }),
  }
  return selectVisualQaStaticTools(tools, VISUAL_QA_UTILITY_TOOL_IDS, "visual-qa utility")
}

async function createVisualQaTool(
  info: Tool.Info,
  input: { taskID?: string; signal?: AbortSignal },
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
      return initialized.execute(args as never, {
        sessionID: meta?.sessionID ?? "",
        messageID: meta?.messageID ?? "",
        callID: meta?.toolCallID,
        agent: "visual-qa",
        abort,
        messages: [],
        extra: { taskID: input.taskID },
        metadata: () => {},
        ask: async () => {},
      })
    },
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
