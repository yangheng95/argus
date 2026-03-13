/**
 * HeadlessSpecAgent — the orchestrator-owned specification stage that expands a
 * task request into a precise, grounded implementation specification.
 *
 * Positioned as a first-class agent alongside the PlannerAgent:
 * 1. Memory recall — searches project memory for prior work, patterns, gotchas
 * 2. Preference awareness — respects project conventions and constraints
 * 3. Codebase exploration — reads files, searches code, lists directories
 * 4. Web research — searches external documentation when needed
 * 5. Structured output — scope, requirements, acceptance criteria, spec items
 * 6. Rewrite — receives failure analysis and revises spec for replan
 */
import { generateText, stepCountIs, tool } from "ai"
import type { LanguageModelV2 } from "@ai-sdk/provider"
import z from "zod"
import { Provider } from "@/provider/provider"
import { createPlannerTools, prefetchContext } from "@/planner/tools"
import { Filesystem } from "@/util/filesystem"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { unattendedProject } from "@/orchestrator/unattended"
import { Env } from "@/env"
import fs from "fs"
import path from "path"

const log = Log.create({ service: "spec-agent" })

// ---------------------------------------------------------------------------
// Shared types — canonical spec types used across planner/orchestrator
// ---------------------------------------------------------------------------

export const Clarification = z.object({
  reason: z.string(),
  questions: z.array(
    z.object({
      header: z.string(),
      question: z.string(),
      context: z.string().optional(),
      default_assumption: z.string().optional(),
    }),
  ),
})
export type ClarificationResult = z.infer<typeof Clarification>

export const SpecDraftSchema = z.object({
  summary: z.string(),
  content: z.string(),
  goals: z.array(
    z.object({
      description: z.string(),
      criteria: z.string(),
      priority: z.enum(["blocking", "advisory"]).default("blocking"),
      metadata: z
        .object({
          check_selector: z.array(z.string()).optional(),
        })
        .optional(),
    }),
  ).default([]),
  assumptions: z.array(
    z.object({
      question: z.string(),
      assumption: z.string(),
    }),
  ).default([]),
  risks: z.array(z.string()).default([]),
  clarifications: Clarification.shape.questions.optional(),
})
export type SpecDraft = z.infer<typeof SpecDraftSchema>

// ---------------------------------------------------------------------------
// Output schema — what the spec agent produces
// ---------------------------------------------------------------------------

export const SpecItemSchema = z.object({
  title: z.string().describe("Short title of the spec item"),
  description: z.string().describe("Detailed description of what must be implemented"),
  check_selector: z.array(z.string()).optional().describe("Which checks validate this item (build, test, lint, spec_check, etc.)"),
  priority: z.enum(["blocking", "advisory"]).default("blocking"),
})
export type SpecItem = z.infer<typeof SpecItemSchema>

export const SpecGoalSchema = z.object({
  description: z.string().describe("Goal contract this task must satisfy"),
  criteria: z.string().describe("How to verify the goal as satisfied"),
  priority: z.enum(["blocking", "advisory"]).default("blocking"),
  metadata: z
    .object({
      check_selector: z.array(z.string()).optional(),
    })
    .optional(),
})
export type SpecGoal = z.infer<typeof SpecGoalSchema>

export const SpecOutput = z.object({
  summary: z.string().describe("One-line summary of the specification"),
  content: z.string().describe("Full markdown specification with Scope, Requirements, Constraints, Acceptance Criteria, Out-of-Scope, Open Questions"),
  scope: z.string().describe("What is in scope for this task"),
  out_of_scope: z.string().optional().describe("Explicitly excluded items"),
  goals: z.array(SpecGoalSchema).describe("Authoritative task goals owned by this specification"),
  spec_items: z.array(SpecItemSchema).describe("Required spec items — each must be verifiably implemented"),
  assumptions: z.array(
    z.object({
      question: z.string(),
      assumption: z.string(),
    }),
  ).default([]),
  risks: z.array(z.string()).default([]),
  evidence_sources: z.array(z.string()).default([]).describe("Files, URLs, or memory entries consulted during spec creation"),
  unresolved_questions: z.array(z.string()).default([]).describe("Questions that could not be answered by codebase exploration"),
  clarifications: z
    .array(
      z.object({
        header: z.string(),
        question: z.string(),
        context: z.string().optional(),
        default_assumption: z.string().optional(),
      }),
    )
    .optional(),
})
export type SpecOutputType = z.infer<typeof SpecOutput>

// ---------------------------------------------------------------------------
// Rewrite context — structured failure information for spec revision
// ---------------------------------------------------------------------------

export interface SpecRewriteContext {
  previousSpec: string
  failureAnalysis: {
    classification: string
    summary: string
    rootCause: string
    suggestedStrategy: string
    avoidApproaches: string[]
  }
  previousGoalStatuses: Array<{
    description: string
    status: string
    evidence: string
  }>
}

// ---------------------------------------------------------------------------
// HeadlessSpecAgent
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 300_000
const MIN_TOOL_CALLS = 3
const QUALITY_RETRY_THRESHOLD = 0.4
const MAX_SPEC_ATTEMPTS = 2

function maxSteps() {
  const value = Number.parseInt(Env.get("OPENCORVUS_SPEC_AGENT_MAX_STEPS") ?? "", 10)
  return Number.isFinite(value) && value > 0 ? value : 20
}

export namespace HeadlessSpecAgent {
  /**
   * Generate an initial spec from a task request.
   * Explores the codebase to ground the specification in reality.
   */
  export async function initial(input: {
    title: string
    request: string
    goals?: Array<{ description: string; criteria: string; priority?: string }>
    signal?: AbortSignal
  }): Promise<SpecOutputType> {
    return run({ ...input, mode: "initial" })
  }

  /**
   * Rewrite a spec based on failure analysis from a previous execution.
   */
  export async function rewrite(input: {
    title: string
    request: string
    rewriteContext: SpecRewriteContext
    goals?: Array<{ description: string; criteria: string; priority?: string }>
    signal?: AbortSignal
  }): Promise<SpecOutputType> {
    return run({ ...input, mode: "rewrite" })
  }
}

export { HeadlessSpecAgent as SpecAgent }
export const parseSpecOutput = extractJSON

// ---------------------------------------------------------------------------
// Internal implementation
// ---------------------------------------------------------------------------

async function run(input: {
  title: string
  request: string
  mode: "initial" | "rewrite"
  goals?: Array<{ description: string; criteria: string; priority?: string }>
  rewriteContext?: SpecRewriteContext
  signal?: AbortSignal
}): Promise<SpecOutputType> {
  if (input.signal?.aborted) throw new Error("spec agent aborted before model resolution")

  // No model configured → throw below with clear error
  const def = await Provider.defaultModel().catch(() => undefined)
  if (!def) throw new Error("no LLM model available for spec agent")
  const model = await Provider.getModel(def.providerID, def.modelID)
  const language = await Provider.getLanguage(model)

  if (input.signal?.aborted) throw new Error("spec agent aborted after model resolution")

  // Extract working directory from request
  const cwdMatch =
    input.request.match(/(?:绝对路径|absolute path)[：:\s]*([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i) ??
    input.request.match(/(?:工作目录|working dir(?:ectory)?)[^\n]*?([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i)
  const taskWorkDir = cwdMatch ? cwdMatch[1].replace(/[/\\]+$/, "") : undefined
  const fileRefs = await resolveFileReferences(input.request, taskWorkDir)
  if (input.signal?.aborted) throw new Error("spec agent aborted before context prefetch")

  const context = prefetchContext(input.title, input.request)
  const recallEnabled = context.length === 0
  const explorationTools = createPlannerTools(taskWorkDir, { recall: recallEnabled })
  const unattended = await unattendedProject()

  // -----------------------------------------------------------------------
  // submit_spec tool — the model calls this to deliver structured spec data.
  // Tool-call arguments are parsed by the provider API, guaranteeing valid
  // JSON without any manual sanitize/repair.
  // -----------------------------------------------------------------------
  let submittedSpec: SpecOutputType | undefined
  const allTools = {
    ...explorationTools,
    submit_spec: tool({
      description:
        "Submit the final specification after codebase exploration. " +
        "Call this tool ONCE when you have finished exploring and are ready to deliver the spec. " +
        "All fields are required except where noted optional.",
      inputSchema: SpecOutput,
      execute: async (args) => {
        submittedSpec = args as SpecOutputType
        return "Specification submitted successfully."
      },
      }),
  }

  let lastQuality: { score: number; reasons: string[] } | undefined
  let lastSteps: Array<{ text?: string; toolCalls?: unknown[]; toolResults?: unknown[] }> | undefined
  let lastToolCallCount = 0

  for (let attempt = 0; attempt < MAX_SPEC_ATTEMPTS; attempt++) {
    if (input.signal?.aborted) throw new Error("spec agent aborted before attempt " + (attempt + 1))
    submittedSpec = undefined

    const retryContext = attempt > 0 && lastQuality
      ? { previousScore: lastQuality.score, reasons: lastQuality.reasons, attempt }
      : undefined
    const userPrompt = buildUserPrompt(input, fileRefs, context, retryContext, unattended)
    const stepLimit = maxSteps()
    const consolidationOnly = attempt > 0 && !!lastSteps && lastToolCallCount >= MIN_TOOL_CALLS

    log.info("spec agent starting", {
      title: input.title,
      mode: input.mode,
      model: language.modelId,
      prefetchedContext: context.length > 0,
      fileRefsFound: fileRefs.length,
      taskWorkDir,
      toolCount: Object.keys(allTools).length,
      recallEnabled,
      unattended,
      attempt: attempt + 1,
      maxSteps: stepLimit,
      consolidationOnly,
      retryReason: retryContext ? `score ${retryContext.previousScore} < ${QUALITY_RETRY_THRESHOLD}` : undefined,
    })

    let result: {
      text?: string
      finishReason?: string
      steps: Array<{ text?: string; toolCalls?: unknown[]; toolResults?: unknown[] }>
    }
    let toolCallCount: number

    if (consolidationOnly) {
      const forced = await finalizeSpec(language, input, lastSteps!, input.signal, retryContext)
      if (forced.submittedSpec) submittedSpec = forced.submittedSpec
      result = forced.result
      toolCallCount = lastToolCallCount
      log.info("spec agent retrying via consolidation", {
        attempt: attempt + 1,
        stepCount: result.steps.length,
        reusedToolCalls: toolCallCount,
      })
    } else {
      result = await generateText({
        model: language,
        stopWhen: stepCountIs(stepLimit),
        tools: allTools,
        toolChoice: "auto",
        maxOutputTokens: 32768,
        abortSignal: input.signal ?? AbortSignal.timeout(TIMEOUT_MS),
        system: SPEC_SYSTEM,
        prompt: userPrompt,
      })

      toolCallCount = result.steps.reduce(
        (sum, s) => {
          const step = s as { toolCalls?: unknown[] }
          return sum + (Array.isArray(step.toolCalls) ? step.toolCalls.length : 0)
        },
        0,
      )
      lastSteps = result.steps
      lastToolCallCount = toolCallCount
      const toolUsage = summarizeToolUsage(result.steps)
      log.info("spec agent tool usage", {
        attempt: attempt + 1,
        finishReason: result.finishReason,
        stepCount: result.steps.length,
        toolCallCount,
        submitSpecCalls: toolUsage["submit_spec"] ?? 0,
        toolUsage,
      })
    }

    // -----------------------------------------------------------------------
    // Priority 1: extract from submit_spec tool call (guaranteed valid JSON)
    // Priority 2: fallback to text JSON parsing (legacy / models that ignore tool)
    // -----------------------------------------------------------------------
    let parsed: SpecOutputType

    if (submittedSpec) {
      const submitted = submittedSpec as SpecOutputType
      log.info("spec agent finished via submit_spec tool call", {
        steps: result.steps.length,
        specItems: submitted.spec_items?.length ?? 0,
        contentLength: submitted.content?.length ?? 0,
        attempt: attempt + 1,
      })
      // Normalize arrays — tool call args may not have Zod defaults applied
      parsed = normalizeSpecOutput(submitted)
    } else {
      // Fallback: parse from text output
      let allText = result.text?.trim() || ""
      if (!allText || !allText.includes("{")) {
        allText = result.steps.map((s) => s.text).filter(Boolean).join("\n")
      }
      if (!allText.trim()) {
        log.warn("spec: primary run produced no final text or submit_spec call, forcing consolidation", {
          steps: result.steps.length,
          finishReason: result.finishReason,
          attempt: attempt + 1,
        })
        const forced = await finalizeSpec(language, input, result.steps, input.signal)
        if (forced.submittedSpec) {
          submittedSpec = forced.submittedSpec
        }
        allText = forced.result.text?.trim() || forced.result.steps.map((s) => s.text).filter(Boolean).join("\n")
      }

      if (submittedSpec) {
        const submitted = submittedSpec as SpecOutputType
        log.info("spec agent finished via forced submit_spec tool call", {
          steps: result.steps.length,
          specItems: submitted.spec_items?.length ?? 0,
          contentLength: submitted.content?.length ?? 0,
          attempt: attempt + 1,
        })
        parsed = normalizeSpecOutput(submitted)
      } else {
        log.info("spec agent finished via text output (no submit_spec call)", {
          steps: result.steps.length,
          finishReason: result.finishReason,
          textLength: allText.length,
          textPreview: allText.slice(0, 200),
          attempt: attempt + 1,
        })
        const extracted = tryExtractSpecOutput(allText)
        if (extracted.ok) {
          parsed = extracted.value
        } else {
          log.warn("spec: text output was not valid JSON, forcing consolidation", {
            error: extracted.error.message,
            steps: result.steps.length,
            finishReason: result.finishReason,
            textLength: allText.length,
            attempt: attempt + 1,
          })
          const forced = await finalizeSpec(language, input, result.steps, input.signal)
          if (forced.submittedSpec) {
            parsed = normalizeSpecOutput(forced.submittedSpec)
          } else {
            const forcedText = forced.result.text?.trim() || forced.result.steps.map((s) => s.text).filter(Boolean).join("\n")
            const forcedExtracted = tryExtractSpecOutput(forcedText)
            if (!forcedExtracted.ok) throw forcedExtracted.error
            parsed = forcedExtracted.value
          }
        }
      }
    }

    parsed.summary = ensureMeaningfulSummary(parsed.summary, input.title)

    const specQuality = validateSpecQuality(parsed, input.request, toolCallCount)
    log.info("spec agent output", {
      specItems: parsed.spec_items.length,
      contentLength: parsed.content.length,
      evidenceSources: parsed.evidence_sources.length,
      risks: parsed.risks.length,
      toolCalls: toolCallCount,
      quality: specQuality,
      attempt: attempt + 1,
    })

    lastQuality = specQuality

    if (specQuality.score >= QUALITY_RETRY_THRESHOLD) {
      return parsed
    }

    if (attempt >= MAX_SPEC_ATTEMPTS - 1) {
      log.error("spec: output quality below threshold", {
        score: specQuality.score,
        threshold: QUALITY_RETRY_THRESHOLD,
        reasons: specQuality.reasons,
        attempt: attempt + 1,
      })
      throw new Error(
        `spec output quality below threshold (${specQuality.score.toFixed(2)} < ${QUALITY_RETRY_THRESHOLD}): ${specQuality.reasons.join("; ") || "unknown quality failure"}`,
      )
    }

    log.warn("spec: spec quality below threshold, retrying", {
      score: specQuality.score,
      threshold: QUALITY_RETRY_THRESHOLD,
      reasons: specQuality.reasons,
      toolCalls: toolCallCount,
      minToolCalls: MIN_TOOL_CALLS,
    })
  }

  throw new Error("spec exhausted retries without producing a valid specification")
}

// ---------------------------------------------------------------------------
// User prompt building
// ---------------------------------------------------------------------------

function buildUserPrompt(
  input: {
    title: string
    request: string
    mode: "initial" | "rewrite"
    goals?: Array<{ description: string; criteria: string; priority?: string }>
    rewriteContext?: SpecRewriteContext
  },
  fileRefs: Array<{ ref: string; content: string }>,
  context: string,
  retryContext?: { previousScore: number; reasons: string[]; attempt: number },
  unattended = false,
): string {
  const sections = [`# Task\n\nTitle: ${input.title}\n\nRequest:\n${input.request}`]

  if (unattended) {
    sections.push(
      [
        "# Unattended Execution Policy",
        "",
        "This project runs unattended by default.",
        "Complete the task end-to-end autonomously.",
        "When details are missing but a reasonable default can unblock progress, choose it, record it in assumptions, and continue execution.",
        "Only emit clarifications when the request is contradictory or impossible to execute safely without explicit human input.",
      ].join("\n"),
    )
  }

  if (retryContext) {
    sections.push(
      [
        "# QUALITY RETRY - Previous Spec Was Insufficient",
        "",
        `Your previous spec scored ${retryContext.previousScore.toFixed(2)} / 1.0 (threshold: ${QUALITY_RETRY_THRESHOLD}).`,
        "",
        "**Issues found:**",
        ...retryContext.reasons.map((r) => `- ${r}`),
        "",
        "**You MUST fix these issues this time:**",
        retryContext.reasons.some((r) => r.includes("tool call"))
          ? `- Make at least ${MIN_TOOL_CALLS} tool calls to explore the codebase`
          : "",
        retryContext.reasons.some((r) => r.includes("file path") || r.includes("evidence"))
          ? "- Include specific file paths and evidence sources from your exploration"
          : "",
        retryContext.reasons.some((r) => r.includes("spec item"))
          ? "- Define concrete spec items with verifiable acceptance criteria"
          : "",
        retryContext.reasons.some((r) => r.includes("content"))
          ? "- Write a detailed specification with all required sections (>500 chars)"
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
  }

  if (input.goals && input.goals.length > 0) {
    sections.push(
      `# User-Provided Goals\n\nIncorporate these goals into the specification. Ensure each goal has corresponding spec items.\n\n${input.goals
        .map((g, i) => `${i + 1}. [${g.priority ?? "blocking"}] ${g.description}\n   Criteria: ${g.criteria}`)
        .join("\n")}`,
    )
  }

  if (context) {
    sections.push(`# Project Context (Pre-fetched)\n\n${context}`)
  }

  if (fileRefs && fileRefs.length > 0) {
    const refSections = fileRefs.map((f) => `### ${f.ref}\n\`\`\`\n${f.content}\n\`\`\``)
    sections.push(
      `# Referenced Files (Pre-read)\n\n` +
        `Analyze these files to understand the existing codebase:\n` +
        `- Identify types, APIs, patterns, conventions\n` +
        `- Note constraints and dependencies\n` +
        `- You still MUST use tools to explore BEYOND these files\n\n` +
        refSections.join("\n\n"),
    )
  }

  if (input.rewriteContext) {
    const ctx = input.rewriteContext
    sections.push(
      [
        "# Rewrite Context",
        "",
        "The previous execution FAILED. You must revise the spec to address the failure.",
        "",
        `## Previous Specification`,
        ctx.previousSpec,
        "",
        `## Failure Analysis`,
        `Classification: ${ctx.failureAnalysis.classification}`,
        `Summary: ${ctx.failureAnalysis.summary}`,
        `Root Cause: ${ctx.failureAnalysis.rootCause}`,
        `Suggested Strategy: ${ctx.failureAnalysis.suggestedStrategy}`,
        "",
        `## Approaches to AVOID (these already failed)`,
        ...ctx.failureAnalysis.avoidApproaches.map((a) => `- ${a}`),
        "",
        `## Previous Goal Results`,
        ...ctx.previousGoalStatuses.map(
          (g) => `- ${g.description}: **${g.status}** — ${g.evidence}`,
        ),
      ].join("\n"),
    )
  }

  if (fileRefs && fileRefs.length > 0) {
    sections.push(
      "Pre-read files are provided above — analyze them before making tool calls. " +
        "Then use tools to explore related files, dependencies, and patterns. " +
        "Produce your specification by calling the submit_spec tool.",
    )
  } else {
    sections.push(
      "Now recall memory, check preferences, explore the codebase thoroughly, " +
        "then produce your specification by calling the submit_spec tool.",
    )
  }

  return sections.join("\n\n")
}

async function finalizeSpec(
  language: LanguageModelV2,
  input: {
    title: string
    request: string
    mode: "initial" | "rewrite"
    goals?: Array<{ description: string; criteria: string; priority?: string }>
    rewriteContext?: SpecRewriteContext
    signal?: AbortSignal
  },
  steps: Array<{ text?: string; toolCalls?: unknown[]; toolResults?: unknown[] }>,
  signal?: AbortSignal,
  retryContext?: { previousScore: number; reasons: string[]; attempt: number },
) {
  const transcript = steps
    .flatMap((step, index) => {
      const calls = Array.isArray(step.toolCalls)
        ? step.toolCalls.map((item) => `Step ${index + 1} tool_call: ${JSON.stringify(item).slice(0, 1200)}`)
        : []
      const results = Array.isArray(step.toolResults)
        ? step.toolResults.map((item) => `Step ${index + 1} tool_result: ${JSON.stringify(item).slice(0, 4000)}`)
        : []
      return [...calls, ...results]
    })
    .join("\n\n")

  let submittedSpec: SpecOutputType | undefined
  const summaryTool = {
    submit_spec: tool({
      description:
        "Submit the final specification after codebase exploration. " +
        "Call this tool ONCE using the exploration transcript that was already gathered.",
      inputSchema: SpecOutput,
      execute: async (args) => {
        submittedSpec = args as SpecOutputType
        return "Specification submitted successfully."
      },
    }),
  }

  const result = await generateText({
    model: language,
    stopWhen: stepCountIs(8),
    tools: summaryTool,
    toolChoice: "required",
    maxOutputTokens: 16384,
    abortSignal: signal ?? AbortSignal.timeout(120_000),
    system:
      "You are finalizing a specification after an exploration attempt. " +
      "Do not explore again. Use the transcript if it is helpful, but do not claim that a missing or weak transcript blocks you. " +
      "If the repository is greenfield or nearly empty, use the task request as the primary source of truth and produce a concrete technical design. " +
      "Never return a placeholder saying more context is required when the request already contains implementation requirements. " +
      "Call submit_spec exactly once.",
    prompt: [
      `# Task\n\nTitle: ${input.title}\n\nRequest:\n${input.request}`,
      input.goals && input.goals.length > 0
        ? `# Requested Goals\n\n${input.goals.map((goal, index) => `${index + 1}. [${goal.priority ?? "blocking"}] ${goal.description}\n   Criteria: ${goal.criteria}`).join("\n")}`
        : "",
      input.rewriteContext
        ? [
            "# Rewrite Context",
            "",
            `Previous Spec:\n${input.rewriteContext.previousSpec}`,
            "",
            `Failure: ${input.rewriteContext.failureAnalysis.summary}`,
            `Root Cause: ${input.rewriteContext.failureAnalysis.rootCause}`,
            `Suggested Strategy: ${input.rewriteContext.failureAnalysis.suggestedStrategy}`,
          ].join("\n")
        : "",
      retryContext
        ? [
            "# Quality Retry Feedback",
            "",
            `Previous score: ${retryContext.previousScore.toFixed(2)}`,
            ...retryContext.reasons.map((reason) => `- ${reason}`),
          ].join("\n")
        : "",
      "# Exploration Transcript",
      transcript || "(no transcript captured)",
      "If the transcript is sparse, repetitive, or mostly memory lookups, synthesize a concrete greenfield specification from the request instead of reporting missing context.",
      "For greenfield tasks, define modules, data structures, APIs, tests, constraints, and acceptance criteria in detail.",
      "Now synthesize the final specification and call submit_spec exactly once.",
    ].join("\n\n"),
  })
  return { result, submittedSpec }
}

// ---------------------------------------------------------------------------
// JSON extraction & repair (mirrors planner/agent.ts logic)
// ---------------------------------------------------------------------------

function extractJSON(text: string): SpecOutputType {
  let raw = text.trim()

  const fencedComplete = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fencedComplete) {
    raw = fencedComplete[1].trim()
  } else {
    const fencedOpen = raw.match(/```(?:json)?\s*([\s\S]*)/)
    if (fencedOpen && fencedOpen[1].includes("{")) {
      raw = fencedOpen[1].trim()
    }
  }

  if (!raw.startsWith("{")) {
    const match = raw.match(/(\{[\s\S]*\})/)
    if (match) {
      raw = match[1]
    } else {
      const idx = raw.indexOf("{")
      if (idx >= 0) raw = raw.slice(idx)
    }
  }

  // Sanitize FIRST — fix unescaped backslashes, raw newlines inside strings, etc.
  // This must happen before truncation repair since raw control chars confuse the repairer.
  raw = sanitizeJSON(raw)

  if (raw.startsWith("{") && !raw.endsWith("}")) {
    log.warn("spec: JSON appears truncated, attempting repair", { length: raw.length })
    raw = repairTruncatedJSON(raw)
  }

  let obj: any
  const parseErr = tryParse(raw)
  if (parseErr.ok) {
    obj = parseErr.value
  } else {
    const trimmed = trimToLastComplete(raw)
    const retryErr = tryParse(trimmed)
    if (retryErr.ok) {
      obj = retryErr.value
    } else {
      log.error("spec: JSON parse failed after all repair attempts", {
        error: String(parseErr.error),
        rawLength: raw.length,
        rawHead: process.env.OPENCORVUS_DEBUG_SPEC === "1" ? raw.slice(0, 400) : undefined,
        rawTail: process.env.OPENCORVUS_DEBUG_SPEC === "1" ? raw.slice(-400) : undefined,
      })
      if (process.env.OPENCORVUS_DEBUG_SPEC === "1") {
        console.log("[spec-debug] raw-head:\n" + raw.slice(0, 400))
        console.log("[spec-debug] raw-tail:\n" + raw.slice(-400))
      }
      throw new Error(`spec output invalid JSON: ${parseErr.error instanceof Error ? parseErr.error.message : String(parseErr.error)}`)
    }
  }

  // Normalize
  if (Array.isArray(obj.goals)) {
    obj.goals = obj.goals.filter((goal: any) => goal && typeof goal === "object" && goal.description && goal.criteria)
    for (const goal of obj.goals) {
      if (goal.priority && goal.priority !== "blocking" && goal.priority !== "advisory") goal.priority = "blocking"
      if (goal.metadata?.check_selector && !Array.isArray(goal.metadata.check_selector)) {
        goal.metadata.check_selector = [String(goal.metadata.check_selector)]
      }
    }
  }
  if (Array.isArray(obj.spec_items)) {
    obj.spec_items = obj.spec_items.filter((s: any) => s && typeof s === "object" && s.title)
    for (const s of obj.spec_items) {
      if (!s.description) s.description = s.title
      if (s.priority && s.priority !== "blocking" && s.priority !== "advisory") s.priority = "blocking"
      if (s.check_selector && !Array.isArray(s.check_selector)) s.check_selector = [String(s.check_selector)]
    }
  }
  if (Array.isArray(obj.assumptions)) {
    obj.assumptions = obj.assumptions.filter((a: any) => a && typeof a === "object" && a.question && a.assumption)
  }
  if (Array.isArray(obj.clarifications)) {
    obj.clarifications = obj.clarifications.filter((c: any) => c && typeof c === "object" && c.question)
  }

  if (!obj || typeof obj !== "object" || Array.isArray(obj) || Object.keys(obj).length === 0) {
    throw new Error("spec output invalid JSON: parsed object is empty")
  }

  if (!obj.summary) obj.summary = ""
  if (!obj.content) obj.content = ""
  if (!obj.scope) obj.scope = ""
  if (!Array.isArray(obj.goals)) obj.goals = []
  if (!Array.isArray(obj.spec_items)) obj.spec_items = []
  if (!Array.isArray(obj.assumptions)) obj.assumptions = []
  if (!Array.isArray(obj.risks)) obj.risks = []
  if (!Array.isArray(obj.evidence_sources)) obj.evidence_sources = []
  if (!Array.isArray(obj.unresolved_questions)) obj.unresolved_questions = []

  try {
    return SpecOutput.parse(obj)
  } catch (zodErr) {
    log.error("spec: Zod validation failed", { error: String(zodErr) })
    throw new Error(`spec output failed schema validation: ${zodErr instanceof Error ? zodErr.message : String(zodErr)}`)
  }
}

function normalizeSpecOutput(input: SpecOutputType): SpecOutputType {
  return {
    ...input,
    summary: input.summary ?? "",
    content: input.content ?? "",
    scope: input.scope ?? "",
    goals: Array.isArray(input.goals) ? input.goals : [],
    spec_items: Array.isArray(input.spec_items) ? input.spec_items : [],
    assumptions: Array.isArray(input.assumptions) ? input.assumptions : [],
    risks: Array.isArray(input.risks) ? input.risks : [],
    evidence_sources: Array.isArray(input.evidence_sources) ? input.evidence_sources : [],
    unresolved_questions: Array.isArray(input.unresolved_questions) ? input.unresolved_questions : [],
  }
}

function summarizeToolUsage(steps: Array<{ toolCalls?: unknown[] }>) {
  const map: Record<string, number> = {}
  for (const step of steps) {
    const calls = Array.isArray(step.toolCalls) ? step.toolCalls : []
    for (const call of calls) {
      if (!call || typeof call !== "object" || !("toolName" in call)) continue
      const name = String((call as { toolName?: unknown }).toolName || "")
      if (!name) continue
      map[name] = (map[name] ?? 0) + 1
    }
  }
  return map
}

function tryExtractSpecOutput(text: string): { ok: true; value: SpecOutputType } | { ok: false; error: Error } {
  try {
    return { ok: true, value: extractJSON(text) }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }
}

/**
 * Sanitize common LLM JSON output issues:
 * - Unescaped backslashes (e.g., Windows paths: C:\Users)
 * - Real newlines inside JSON string values
 * - Markdown code fences inside string values (```javascript ... ```)
 */
function sanitizeJSON(raw: string): string {
  let result = ""
  let inString = false
  let i = 0
  while (i < raw.length) {
    const ch = raw[i]
    if (!inString) {
      if (ch === '"') inString = true
      result += ch
      i++
      continue
    }
    // Inside a string
    if (ch === "\\") {
      const next = raw[i + 1]
      // Valid JSON escapes: " \ / b f n r t u
      if (next && '"\\\/bfnrtu'.includes(next)) {
        result += ch + next
        i += 2
        continue
      }
      // Invalid escape: double the backslash to make it valid
      result += "\\\\"
      i++
      continue
    }
    if (ch === '"') {
      inString = false
      result += ch
      i++
      continue
    }
    if (ch === "\n") {
      result += "\\n"
      i++
      continue
    }
    if (ch === "\r") {
      result += "\\r"
      i++
      continue
    }
    if (ch === "\t") {
      result += "\\t"
      i++
      continue
    }
    result += ch
    i++
  }
  return result
}

function tryParse(text: string): { ok: true; value: any } | { ok: false; error: Error } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (err) {
    return { ok: false, error: err as Error }
  }
}

function repairTruncatedJSON(raw: string): string {
  let repaired = raw
  let inString = false
  let escaped = false
  for (let i = 0; i < repaired.length; i++) {
    const ch = repaired[i]
    if (escaped) { escaped = false; continue }
    if (ch === "\\") { escaped = true; continue }
    if (ch === '"') inString = !inString
  }
  if (inString) repaired += '"'

  repaired = repaired.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/, "")
  repaired = repaired.replace(/,\s*$/, "")

  const stack: string[] = []
  inString = false
  escaped = false
  for (let i = 0; i < repaired.length; i++) {
    const ch = repaired[i]
    if (escaped) { escaped = false; continue }
    if (ch === "\\") { escaped = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === "{") stack.push("}")
    else if (ch === "[") stack.push("]")
    else if (ch === "}" || ch === "]") stack.pop()
  }
  repaired = repaired.replace(/,\s*$/, "")
  while (stack.length > 0) repaired += stack.pop()
  return repaired
}

function trimToLastComplete(raw: string): string {
  let lastComplete = -1
  let inString = false
  let escaped = false

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (escaped) { escaped = false; continue }
    if (ch === "\\") { escaped = true; continue }
    if (ch === '"') {
      inString = !inString
      if (!inString) lastComplete = i
      continue
    }
    if (inString) continue
    if (ch === "}" || ch === "]") lastComplete = i
  }

  if (lastComplete > 0 && lastComplete < raw.length - 1) {
    let trimmed = raw.slice(0, lastComplete + 1)
    trimmed = trimmed.replace(/,\s*$/, "")
    const stack: string[] = []
    inString = false
    escaped = false
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i]
      if (escaped) { escaped = false; continue }
      if (ch === "\\") { escaped = true; continue }
      if (ch === '"') { inString = !inString; continue }
      if (inString) continue
      if (ch === "{") stack.push("}")
      else if (ch === "[") stack.push("]")
      else if (ch === "}" || ch === "]") stack.pop()
    }
    while (stack.length > 0) trimmed += stack.pop()
    return trimmed
  }
  return repairTruncatedJSON(raw)
}

// ---------------------------------------------------------------------------
// Quality validation
// ---------------------------------------------------------------------------

function validateSpecQuality(
  spec: SpecOutputType,
  request: string,
  toolCallCount: number,
): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []

  // Tool call depth (0.2 max)
  if (toolCallCount >= 5) {
    score += 0.2
  } else if (toolCallCount >= 2) {
    score += 0.1
  } else {
    reasons.push(`Only ${toolCallCount} tool calls — explore the codebase more thoroughly (min ${MIN_TOOL_CALLS})`)
  }

  // Content depth (0.25 max — spec should be thorough)
  if (spec.content.length >= 2000) {
    score += 0.25
  } else if (spec.content.length >= 1000) {
    score += 0.15
  } else if (spec.content.length >= 500) {
    score += 0.08
  } else {
    reasons.push("Spec content too short — must include detailed sections for Scope, Requirements, Constraints, Acceptance Criteria. Target 2000+ chars")
  }

  // Spec items quality (0.3 max — most important dimension)
  if (spec.spec_items.length >= 4) {
    score += 0.3
  } else if (spec.spec_items.length >= 2) {
    score += 0.2
  } else if (spec.spec_items.length >= 1) {
    score += 0.1
  } else {
    reasons.push("No spec items — define at least 4 concrete, verifiable spec items for non-trivial tasks")
  }

  if (spec.goals.length >= 2) {
    score += 0.1
  } else if (spec.goals.length >= 1) {
    score += 0.05
  } else {
    reasons.push("No goals — define authoritative blocking/advisory goals in the spec")
  }

  // Evidence sources (did the agent actually discover things?) (0.1 max)
  if (spec.evidence_sources.length >= 2) {
    score += 0.1
  } else if (spec.evidence_sources.length >= 1) {
    score += 0.05
  } else {
    reasons.push("No evidence sources — list the files and resources you consulted")
  }

  // File paths in content OR detailed technical design for greenfield (0.15 max)
  const pathPattern = /[\w/\\-]+\.\w+/g
  const pathCount = (spec.content.match(pathPattern) || []).length
  // For greenfield projects, technical keywords count as "grounding"
  const technicalKeywords = /\b(API|class|function|interface|module|component|state|event|handler|render|canvas|DOM|HTTP|WebSocket|database|schema|endpoint|route)\b/gi
  const techCount = (spec.content.match(technicalKeywords) || []).length
  if (pathCount >= 3 || techCount >= 10) {
    score += 0.15
  } else if (pathCount >= 1 || techCount >= 5) {
    score += 0.07
  } else {
    reasons.push("Spec content lacks specific file paths or detailed technical design keywords")
  }

  const nonTrivial = request.trim().length >= 200 || request.includes("\n")
  if (nonTrivial && spec.content.length < 500) {
    score = Math.min(score, QUALITY_RETRY_THRESHOLD - 0.01)
    reasons.push("Non-trivial task requires spec content >= 500 chars")
  }
  if (nonTrivial && spec.spec_items.length < 2) {
    score = Math.min(score, QUALITY_RETRY_THRESHOLD - 0.01)
    reasons.push("Non-trivial task requires at least 2 spec items")
  }

  return { score: Math.min(score, 1), reasons }
}

function ensureMeaningfulSummary(summary: string, fallbackTitle: string): string {
  if (!summary) return fallbackTitle
  const trimmed = summary.trim()
  if (trimmed.length < 5) return fallbackTitle
  if (/^#+\s/.test(trimmed)) return fallbackTitle
  if (/^[./\\]/.test(trimmed) && !trimmed.includes(" ")) return fallbackTitle
  return trimmed
}

// ---------------------------------------------------------------------------
// File reference resolution (mirrors planner/agent.ts)
// ---------------------------------------------------------------------------

async function resolveFileReferences(
  request: string,
  taskWorkDir?: string,
): Promise<Array<{ ref: string; content: string }>> {
  const FILE_EXTS = "ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|json|yaml|yml|toml|md|css|html|sql|sh|vue|svelte"
  const refs = new Set<string>()

  const atPat = /@(?:file:)?([./a-zA-Z][\w./\\-]*\.\w+)/g
  let match: RegExpExecArray | null
  while ((match = atPat.exec(request)) !== null) refs.add(match[1])

  const btPat = new RegExp("`([./]?(?:[\\w@-]+[/\\\\])*[\\w.-]+\\.(?:" + FILE_EXTS + "))`", "g")
  while ((match = btPat.exec(request)) !== null) refs.add(match[1])

  const baseDirs: string[] = []
  if (taskWorkDir) baseDirs.push(taskWorkDir)
  try { baseDirs.push(Instance.directory) } catch { /* ok */ }
  try { if (!baseDirs.includes(Instance.worktree)) baseDirs.push(Instance.worktree) } catch { /* ok */ }

  const results: Array<{ ref: string; content: string }> = []
  for (const ref of refs) {
    if (path.isAbsolute(ref)) {
      const content = readFileSafe(ref)
      if (content) results.push({ ref, content })
      continue
    }
    for (const base of baseDirs) {
      const abs = path.resolve(base, ref)
      const content = readFileSafe(abs)
      if (content) {
        results.push({ ref, content })
        break
      }
    }
  }
  return results
}

function readFileSafe(absPath: string, maxLen = 6000): string | null {
  try {
    const content = fs.readFileSync(absPath, "utf-8")
    if (!content) return null
    return content.length > maxLen ? content.slice(0, maxLen) + "\n... (truncated)" : content
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const SPEC_SYSTEM = `You are a senior software architect acting as the specification brain for OpenCorvus, an autonomous coding orchestrator. Your job is to explore the codebase deeply, understand the context, and produce a precise, grounded specification that downstream planning and execution agents can rely on.

CRITICAL: You MUST use tools to explore the codebase BEFORE producing any specification. A spec produced without tool calls is ALWAYS rejected. You are scored on exploration depth — specs that don't reference specific file paths, types, APIs, and patterns discovered via tools will be automatically retried.

## Available Tools

- **memory_search**: Search project memory for prior work, patterns, gotchas
- **memory_get**: Read full content of a memory file by ID
- **preference_list**: List active project conventions and constraints (BINDING)
- **read_file**: Read file contents with line numbers
- **find_files**: Find files matching a glob pattern
- **search_code**: Search file contents with regex (ripgrep)
- **list_directory**: List files and directories at a path
- **web_search**: Search the web for external documentation (use only when needed)
- **submit_spec**: Submit the final specification (call ONCE after exploration is complete)

## Your Role

You are NOT the planner. You do NOT decompose tasks into subtasks or implementation steps. Your job is to:
1. **Understand** what the user is asking for
2. **Explore** the codebase to ground requirements in reality
3. **Identify** gaps, ambiguities, constraints, and risks
4. **Define** precise, verifiable spec items (acceptance criteria)
5. **Define** authoritative goals the execution system must satisfy
6. **Surface** unresolved questions that need user input

The downstream PlannerAgent will take your spec and create implementation plans.

## Your Process

### Phase 0: RECALL (1-3 tool calls)

1. **Search memory** (memory_search) with task keywords. If pre-fetched memory exists, only search for gaps.
2. **List preferences** (preference_list) unless pre-fetched. Preferences are BINDING.

### Phase 1: EXPLORE (5-15 tool calls — MOST IMPORTANT phase)

You MUST explore thoroughly. A spec without specific file paths is worthless.
Minimum ${MIN_TOOL_CALLS} tool calls required. Aim for 8-15 for complex tasks.

Strategy (adapt based on task type):

**For modification tasks:**
1. **list_directory** on project root and relevant subdirectories
2. **read_file** on package.json / build config — tech stack, scripts
3. **search_code** for key types, functions mentioned in the request
4. **read_file** on 3-5 files directly related to the task
5. **find_files** to discover related modules, tests, configs
6. **search_code** for imports/usages of code to be modified
7. **read_file** on test files — understand existing patterns

**For new module/feature tasks:**
1. **list_directory** on the target package and similar existing modules
2. **read_file** on 2-3 existing modules — copy their structure
3. **search_code** for export/registration patterns
4. **read_file** on existing tests for test patterns

After exploration, you should know:
- What already exists that's relevant to the task
- The coding patterns and conventions to follow
- The exact types, interfaces, and APIs involved
- What dependencies and constraints exist
- What tests are needed and how they're structured

### Phase 1.5: RESEARCH (if needed)

For external APIs, unfamiliar libraries, or protocols — use web_search.

### Phase 2: SPECIFY — Synthesize into Grounded Specification

Your spec must be CONCRETE, not abstract. Reference specific files, functions, and types.
Think: "Could a planner create implementation steps from this spec without exploring the codebase again?"

**Spec Items** — Each must be independently verifiable:
- GOOD: "The SpecAgent module in spec/agent.ts exposes initial() and rewrite() for grounded specification generation and revision"
- BAD: "Create a spec agent" (too vague)

**Content** — Must include these markdown sections:
- **Scope**: What is included in this task
- **Requirements**: Functional and behavioral requirements, referencing specific code
- **Constraints**: Technical constraints discovered from codebase exploration
- **Acceptance Criteria**: Concrete, testable criteria linked to spec items
- **Out-of-Scope**: What is explicitly excluded
- **Open Questions**: Remaining ambiguities

### Phase 3: OUTPUT — Call submit_spec tool

When you have finished exploring and are ready to deliver the spec, call the **submit_spec** tool with all the required fields. Do NOT output raw JSON text — use the tool call instead.

The submit_spec tool accepts these fields:
- **summary**: One-line summary of the specification
- **scope**: What is in scope for this task
- **out_of_scope** (optional): What is explicitly excluded
- **goals**: Array of authoritative goals with description, criteria, priority, optional check_selector metadata
- **spec_items**: Array of verifiable items, each with title, description, check_selector, priority
- **assumptions**: Array of {question, assumption} pairs
- **risks**: Array of specific risks with codebase context
- **evidence_sources**: Array of file paths, URLs, memory entries consulted
- **unresolved_questions**: Questions that could not be answered
- **content**: Full markdown specification with Scope, Requirements, Constraints, Acceptance Criteria sections. Reference specific file paths. For greenfield projects, include detailed technical design. Target 2000-6000 chars.
- **clarifications** (optional): Array of {header, question, context, default_assumption}

## Rules

- ALWAYS explore the codebase before writing the spec. No exceptions.
- If a recall tool response contains \`RECALL_COMPLETE\`, stop recall immediately and do not call memory_search, memory_get, or preference_list again in this run.
- Do not spam identical exploration calls. Repeating the same tool with the same arguments more than twice is invalid; switch tools or submit_spec.
- Every file path in the spec MUST come from actual tool results or pre-read files.
- spec_items must be verifiable — each should have clear success/failure criteria.
- spec_items.check_selector maps to: build, test, lint, verify_cmd, startup, ui_review, code_quality, code_review, dead_code_review, spec_check
- Every blocking spec item MUST have at least one check_selector.
- Write in the same language as the request (Chinese request → Chinese spec).
- If rewriting after failure: revise the spec to address the root cause.
- After finishing exploration, call submit_spec with your specification. Do NOT output raw JSON text.
- If submit_spec is unavailable, output JSON as a fallback.

## Quality Self-Check (MANDATORY)

Before outputting JSON, verify each of these. If ANY answer is NO, use more tools:

1. Did I make at least ${MIN_TOOL_CALLS} tool calls to explore the codebase?
2. Does the content reference specific file paths discovered via tools?
3. Are all spec items concrete and verifiable (not vague aspirations)?
4. Are authoritative goals present and aligned with the specification?
5. Does each blocking spec item have a check_selector?
6. Are evidence_sources populated with actual files I consulted?
7. Could a planner create implementation steps from this spec WITHOUT further exploration?
8. Does the summary accurately describe the specification in one line?

## Output Format

- Content: Use markdown sections, target 2000-6000 chars. Be thorough and specific.
- Spec Items: Be DETAILED — they drive downstream planning and acceptance. Include at least 4-6 spec items for non-trivial tasks. Each item should be independently verifiable.
- For greenfield projects (creating something new with no existing codebase): Include detailed technical design in the content section — data structures, algorithms, UI layout, state management, interaction flows. Use web_search if needed for reference implementations.
- Call submit_spec exactly once after exploration is complete.
- Do NOT output raw JSON. Use the submit_spec tool call.`
