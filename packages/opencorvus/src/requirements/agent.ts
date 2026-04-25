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
 * specs + multimodal attachments) and the output tool kit.
 */
import z from "zod"
import { runAgentSession } from "@/agent/runner"
import { createPlannerTools, prefetchContext } from "@/planner/tools"
import { filterAgentTools } from "@/agent/filter-tools"
import { Log } from "@/util/log"
import { clarificationTranscriptSection, operatorNotesSection } from "@/engine"
import { AttachmentStore } from "@/storage/attachment-store"
import type { VisualSpec } from "@/design-analyst/types"
import { renderVisualContractPromptSection } from "@/design-analyst/prompt-section"
import { buildMirrorToolsPromptSection } from "@/prompt/mirror-tools"
import { Instance } from "@/project/instance"
import type {
  ParsedRequirement,
  RequirementsDecision,
  RequirementsOutput,
} from "./types"
import {
  createRequirementsOutputTools,
  RequirementsFinalSchema,
  type RequirementsCollector,
  type RequirementsFinal,
} from "./output-tools"
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
    /** Advisory visual contract produced by design_analysis. */
    designSpecs?: VisualSpec[]
    taskID?: string
    parentSessionID?: string
    model?: { providerID: string; modelID: string }
    signal?: AbortSignal
    onStatus?: (summary: string) => void | Promise<void>
    /** Optional Decision Log — seeded with foundational decisions. */
    decisionLog?: DecisionLog
  }

  /**
   * Parse a task request into REQ-N requirements + foundational decisions.
   * Goal decomposition happens downstream in the Architect, not here.
   */
  export async function run(input: RunInput): Promise<RequirementsResult> {
    // Rule 11 / rule 25: the working directory is a structural fact
    // (`Instance.directory`), not something to keyword-regex out of the
    // user's free-form request. `createPlannerTools()` resolves to the
    // correct root via Instance.directory by default.
    const plannerTools = await filterAgentTools(createPlannerTools(), "requirements")
    const outputToolKit = createRequirementsOutputTools()

    const context = prefetchContext(input.title, input.request)

    const out = await runAgentSession({
      kind: "requirements",
      core: REQUIREMENTS_CORE,
      sessionTitle: `Requirements: ${input.title}`,
      parentSessionID: input.parentSessionID,
      taskID: input.taskID,
      model: input.model,
      signal: input.signal,
      onStatus: input.onStatus,
      toolKit: {
        tools: { ...plannerTools, ...outputToolKit.tools },
        getCollector: () => outputToolKit.getCollector(),
      },
      buildUserPrompt: () => buildUserPrompt(input, context),
      buildUserParts: () => buildPromptParts(buildUserPrompt(input, context), input.attachments),
      format: {
        schema: z.toJSONSchema(RequirementsFinalSchema) as Record<string, unknown>,
        retryCount: 2,
      },
      skillsStage: "requirements",
    })

    const structured = out.structured as RequirementsFinal | undefined
    const collector = out.collector as RequirementsCollector

    // Structured tool-call output is the only supported path. If the LLM
    // did not register any requirements via register_requirement, treat
    // this as a hard contract failure — no text-parsing fallback (rule 1).
    if (collector.requirements.length === 0) {
      throw new Error(
        `requirements agent produced no requirements via register_requirement ` +
          `(structuredMissing=${!structured}). ` +
          `The orchestrator LLM must decide whether to re-invoke requirements, modify the ` +
          `task prompt, or fail the task — no coded retry loop.`,
      )
    }

    const parsed = collectorToOutput(collector, structured)
    log.info("requirements agent output", {
      requirements: parsed.requirements.length,
      decisions: parsed.decisions.length,
      structuredMissing: !structured,
    })

    const result: RequirementsResult = {
      summary: parsed.summary || "Requirements parsed",
      requirements: parsed.requirements,
      decisions: parsed.decisions,
    }

    // Seed Decision Log with foundational decisions
    if (input.decisionLog && result.decisions.length > 0) {
      for (const decision of result.decisions) {
        input.decisionLog.append({
          phase: "requirements",
          key: decision.key,
          value: decision.value,
          reason: decision.reason,
        })
      }
    }

    return result
  }
}

// ---------------------------------------------------------------------------
// Structured collector → RequirementsOutput
// ---------------------------------------------------------------------------

function collectorToOutput(
  collector: RequirementsCollector,
  final?: RequirementsFinal,
): RequirementsOutput {
  return {
    summary: final?.summary ?? "",
    requirements: collector.requirements.map((r) => ({
      id: r.id,
      type: r.type,
      description: r.description,
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
  const { multimodal, referenceOnly } = AttachmentStore.partition(attachments)
  const enrichedText = text + AttachmentStore.renderReferenceList(referenceOnly)
  const fileParts = await AttachmentStore.loadFileParts(multimodal)

  const parts: Array<
    | { type: "text"; text: string }
    | { type: "file"; url: string; mime: string; filename?: string }
  > = [{ type: "text", text: enrichedText }]

  for (const fp of fileParts) {
    if ("image" in fp && fp.image) {
      const data = typeof fp.image === "string" ? fp.image : undefined
      if (data) parts.push({ type: "file", url: data, mime: "image/*" })
      continue
    }
    if ("file" in fp && fp.file) {
      const f = fp.file as { data?: string | Uint8Array; mediaType?: string; filename?: string }
      if (typeof f.data === "string") {
        parts.push({ type: "file", url: f.data, mime: f.mediaType ?? "application/octet-stream", filename: f.filename })
      } else if (f.data instanceof Uint8Array) {
        const base64 = Buffer.from(f.data).toString("base64")
        const mime = f.mediaType ?? "application/octet-stream"
        parts.push({
          type: "file",
          url: `data:${mime};base64,${base64}`,
          mime,
          filename: f.filename,
        })
      }
    }
  }

  return parts
}

function buildUserPrompt(
  input: {
    title: string
    request: string
    designSpecs?: VisualSpec[]
    taskID?: string
  },
  prefetched: string,
): string {
  const sections: string[] = []

  sections.push(`# Task\n\nTitle: ${input.title}\n\nRequest:\n${input.request}`)

  if (input.designSpecs && input.designSpecs.length > 0) {
    sections.push(renderVisualContractPromptSection({ specs: input.designSpecs }))
  }

  if (prefetched?.trim()) {
    sections.push(prefetched)
  }

  if (input.taskID) {
    const clarifications = clarificationTranscriptSection(input.taskID)
    if (clarifications) sections.push(clarifications)
    const operatorNotes = operatorNotesSection(input.taskID)
    if (operatorNotes) sections.push(operatorNotes)
  }

  sections.push(buildMirrorToolsPromptSection({ cwd: Instance.directory }))

  sections.push(
    "Parse the user request. Call register_requirement per REQ-N entry, " +
      "register_decision per foundational decision (runtime / backend / test framework). " +
      "Then call the StructuredOutput tool exactly once with the terminal `summary` field " +
      "to close the analysis.",
  )

  return sections.join("\n\n")
}
