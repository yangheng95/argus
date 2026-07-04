/**
 * RequirementsAgent — parses a user task into REQ-N requirements +
 * foundational technical decisions (runtime / framework / test strategy).
 * Seeds the Decision Log with the decisions under phase="requirements"
 * so downstream agents build on the same foundation.
 *
 * This agent deliberately does NOT produce goals, metric specs, challenge
 * seeds, traceability, or cross-goal contracts — the Architect owns those.
 * The narrow surface is enforced by the tool list (register_requirement +
 * register_decision) and by the RequirementsResult type shape.
 *
 * Implementation: shell over `runAgentSession`. The runner owns model
 * resolution, child-session creation, system-prompt composition, abort /
 * stream-error handling. Agent-specific code is the user prompt builder
 * (with prefetched repo context + clarification transcript + design
 * frontend template + optional visual anchors + multimodal attachments) and the output
 * tool kit.
 */
import { runAgentSession } from "@/agent/runner"
import { withFactCheckRegistration } from "@/prompt/fragments/fact-check-registration"
import { createAgentContextTools, prefetchContext } from "@/agent/context-tools"
import { createAgentCoordinationRuntimeTools } from "@/agent/coordination-runtime-tools"
import { filterAgentTools } from "@/agent/filter-tools"
import { Log } from "@/util/log"
import { clarificationTranscriptSection, operatorNotesSection } from "@/engine"
import { AttachmentStore } from "@/storage/attachment-store"
import { renderUserRequestSection } from "@/intent/request-prompt"
import type { VisualSpec } from "@/frontend-design/types"
import { renderVisualContractPromptSection } from "@/frontend-design/prompt-section"
import {
  allResearchEvidenceRefsForTask,
  renderFrontendResearchBriefPromptSection,
  renderResearchBriefPromptSection,
} from "@/research/prompt-section"
import type { AgentSessionContinuation } from "@/engine/stage-continuation"
import type { ParsedRequirement, RequirementsDecision, RequirementsOutput } from "./types"
import { createRequirementsOutputTools, summarizeRequirements, type RequirementsCollector } from "./output-tools"
import type { DecisionLog } from "@/decision-log"

import REQUIREMENTS_CORE from "@/prompt/core/requirements-core.txt"

const log = Log.create({ service: "requirements-agent" })

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface RequirementsResult {
  summary: string
  /** All requirements extracted from user input (explicit + implicit) */
  requirements: ParsedRequirement[]
  /** Foundational technical decisions (runtime, framework, test strategy, …). */
  decisions: RequirementsDecision[]
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export namespace RequirementsAgent {
  export interface RunInput {
    title: string
    request: string
    /** Base64 image attachments — injected as vision content alongside the request text. */
    attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>
    /** Advisory visual contract produced by frontend_design. */
    designSpecs?: VisualSpec[]
    /** Authoritative frontend template entries produced by frontend_design. */
    frontendDesign?: string
    taskID?: string
    parentSessionID?: string
    model?: { providerID: string; modelID: string }
    signal?: AbortSignal
    onStatus?: (summary: string) => void | Promise<void>
    continuation?: AgentSessionContinuation
    /** Fires once the runner session is created so callers (orchestrator
     *  dispatch tools) can capture the id for SSE event emission without
     *  needing a wrapper session. Rule 22 — single session per sub-agent. */
    onSessionCreated?: (sessionID: string) => void
    /** Optional Decision Log — seeded with foundational decisions. */
    decisionLog?: DecisionLog
  }

  /**
   * Parse a task request into REQ-N requirements + foundational decisions.
   * Goal decomposition happens downstream in the Architect, not here.
   */
  export async function run(input: RunInput): Promise<RequirementsResult & { sessionID: string }> {
    // Rule 11 / rule 25: the working directory is a structural fact
    // (`Instance.directory`), not something to keyword-regex out of the
    // user's free-form request. `createAgentContextTools()` resolves to the
    // correct root via Instance.directory by default.
    const coordinationTools = await createAgentCoordinationRuntimeTools({
      agent: "requirements",
      taskID: input.taskID,
      signal: input.signal,
    })
    const contextTools = await filterAgentTools(
      { ...createAgentContextTools(), ...coordinationTools },
      "requirements",
      {
        taskID: input.taskID,
        sessionID: input.parentSessionID,
      },
    )
    const outputToolKit = createRequirementsOutputTools({
      decisionLog: input.decisionLog,
      allowedResearchEvidenceRefs: allResearchEvidenceRefsForTask({
        taskID: input.taskID,
        request: input.request,
      }),
    })

    const context = prefetchContext(input.title, input.request)

    const out = await runAgentSession({
      kind: "requirements",
      core: withFactCheckRegistration(REQUIREMENTS_CORE),
      sessionTitle: `Requirements: ${input.title}`,
      parentSessionID: input.parentSessionID,
      taskID: input.taskID,
      model: input.model,
      signal: input.signal,
      continuation: input.continuation,
      onStatus: input.onStatus,
      onSessionCreated: input.onSessionCreated
        ? (session) => {
            input.onSessionCreated!(session.id)
          }
        : undefined,
      toolKit: {
        tools: { ...contextTools, ...outputToolKit.tools },
        stageOwnedToolIDs: Object.keys(outputToolKit.tools),
        getCollector: () => outputToolKit.getCollector(),
        buildReport: () => outputToolKit.buildReport(),
      },
      buildUserPrompt: () => buildUserPrompt(input, context),
      buildUserParts: () => buildPromptParts(buildUserPrompt(input, context), input.attachments),
      terminalTool: {
        toolName: "submit_requirements",
        isSatisfied: (collector) => collector.finalized,
        // Requirements has no host-side completeness signal: one registered
        // requirement is not proof that all explicit/implicit requirements and
        // decisions are done. Keep work tools visible and let terminal recovery
        // surface prose-stop misses instead of prematurely hiding collectors.
        shouldExposeOnlyTerminalTool: () => false,
      },
    })

    const collector = out.collector as RequirementsCollector

    // Collector tool-call output is the only supported path. If the LLM
    // did not register any requirements via register_requirement, treat
    // this as a hard contract failure — no text-parsing fallback (rule 1).
    if (collector.requirements.length === 0) {
      throw new Error(
        `requirements agent produced no requirements via register_requirement ` +
          `The orchestrator LLM must decide whether to re-invoke requirements, modify the ` +
          `task prompt, or fail the task — no coded retry loop.`,
      )
    }
    if (!collector.finalized) {
      throw new Error(
        `requirements agent did not call submit_requirements after registering ` +
          `${collector.requirements.length} requirement(s).`,
      )
    }

    const parsed = collectorToOutput(collector)
    log.info("requirements agent output", {
      requirements: parsed.requirements.length,
      decisions: parsed.decisions.length,
      finalized: collector.finalized,
    })

    const result: RequirementsResult = {
      summary: parsed.summary || "Requirements parsed",
      requirements: parsed.requirements,
      decisions: parsed.decisions,
    }

    return { ...result, sessionID: out.session.id }
  }
}

// ---------------------------------------------------------------------------
// Collector → RequirementsOutput
// ---------------------------------------------------------------------------

function collectorToOutput(collector: RequirementsCollector): RequirementsOutput {
  return {
    summary: summarizeRequirements(collector),
    requirements: collector.requirements.map((r) => ({
      id: r.id,
      type: r.type,
      description: r.description,
      acceptance: r.acceptance,
      non_goals: r.non_goals,
      evidence_refs: r.evidence_refs,
    })),
    decisions: collector.decisions.map((d) => ({
      key: d.key,
      value: d.value,
      reason: d.reason,
    })),
  }
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

async function buildPromptParts(
  text: string,
  attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>,
) {
  const enrichedText = text + AttachmentStore.renderAttachmentInventory(attachments)
  const inlineParts = await AttachmentStore.inlineFileParts(attachments)
  return [{ type: "text" as const, text: enrichedText }, ...inlineParts]
}

function buildUserPrompt(
  input: {
    title: string
    request: string
    designSpecs?: VisualSpec[]
    frontendDesign?: string
    taskID?: string
  },
  prefetched: string,
): string {
  const sections: string[] = []

  sections.push(
    "# Delegation\n\nOrchestrator is asking requirements to extract the task requirements and foundational decisions.",
  )
  sections.push(
    renderUserRequestSection({
      heading: "# Task",
      title: input.title,
      request: input.request,
      taskID: input.taskID,
    }),
  )

  if (input.taskID) {
    const clarifications = clarificationTranscriptSection(input.taskID)
    if (clarifications) {
      sections.push(
        [
          clarifications,
          "Concrete stack or deliverable answers from clarifications/operator notes outrank existing package.json dependencies.",
          "If the user explicitly chose a framework-free implementation, record that choice directly instead of inferring a framework from scaffold files.",
        ].join("\n\n"),
      )
    }
    const operatorNotes = operatorNotesSection(input.taskID)
    if (operatorNotes) sections.push(operatorNotes)
  }

  if (input.designSpecs && input.designSpecs.length > 0) {
    sections.push(renderVisualContractPromptSection({ specs: input.designSpecs }))
  }

  if (input.frontendDesign && input.frontendDesign.trim().length > 0) {
    sections.push(input.frontendDesign)
  }

  const researchBrief = renderResearchBriefPromptSection({
    taskID: input.taskID,
    request: input.request,
  })
  if (researchBrief) sections.push(researchBrief)
  const frontendResearchBrief = renderFrontendResearchBriefPromptSection({
    taskID: input.taskID,
    request: input.request,
  })
  if (frontendResearchBrief) sections.push(frontendResearchBrief)

  if (prefetched?.trim()) {
    sections.push(prefetched)
  }

  return sections.join("\n\n")
}
