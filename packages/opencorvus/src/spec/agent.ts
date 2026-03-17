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
import { stepCountIs } from "ai"
import { type TextHooks } from "@/llm/api"
import z from "zod"
import { extractRawJSON, repairTruncatedJSON, sanitizeJSON, trimToLastComplete, tryParseJSON } from "@/llm/json-repair"
import { completeHeadlessText, resolveHeadlessLanguageModel } from "@/llm/headless"
import { type FailureAnalysis, type PreviousGoalStatus } from "@/orchestrator/failure"
import { createPlannerTools, prefetchContext } from "@/planner/tools"
import { collectText, ensureMeaningfulSummary, firstContentLine, parseListSection, parseNamedPairs, sectionBody, summarizeToolUsage } from "@/util/agent-text"
import { Config } from "@/config/config"
import { Filesystem } from "@/util/filesystem"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { Env } from "@/env"
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

export const SpecDraftGoal = z.object({
  description: z.string(),
  criteria: z.string(),
  priority: z.enum(["blocking", "advisory"]).optional(),
  source: z.enum(["spec", "system"]).optional(),
  metadata: z.object({ check_selector: z.array(z.string()).optional() }).catchall(z.unknown()).optional(),
})

export const SpecDraftSchema = z.object({
  summary: z.string(),
  content: z.string(),
  /** Execution goals derived from spec_items — one goal per iterative stage */
  goals: z.array(SpecDraftGoal).default([]),
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

export const SpecOutput = z.object({
  summary: z.string().describe("One-line summary of the specification"),
  content: z.string().describe("Full markdown specification with Scope, Requirements, Constraints, Out-of-Scope, Open Questions, Spec Items"),
  scope: z.string().describe("What is in scope for this task"),
  out_of_scope: z.string().optional().describe("Explicitly excluded items"),
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
  failureAnalysis: FailureAnalysis
  previousGoalStatuses: PreviousGoalStatus[]
}

// ---------------------------------------------------------------------------
// HeadlessSpecAgent
// ---------------------------------------------------------------------------

const MIN_TOOL_CALLS = 3
const QUALITY_RETRY_THRESHOLD = 0.6
const MAX_SPEC_ATTEMPTS = 3

function maxSteps() {
  const value = Number.parseInt(Env.get("OPENCORVUS_SPEC_AGENT_MAX_STEPS") ?? "", 10)
  return Number.isFinite(value) && value > 0 ? value : 30
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
    sessionID?: string
    metadata?: Record<string, unknown>
    signal?: AbortSignal
    stream?: TextHooks
    onStatus?: (summary: string) => void | Promise<void>
  }): Promise<SpecOutputType> {
    return run({ ...input, mode: "initial" })
  }

  /**
   * Compile/fill a spec during the spec compilation phase.
   * Called when the spec is in "blocked" state and needs gap-filling.
   */
  export async function compile(input: {
    title: string
    request: string
    previousSpec?: string
    goals?: Array<{ description: string; criteria: string; priority?: string }>
    sessionID?: string
    metadata?: Record<string, unknown>
    signal?: AbortSignal
    stream?: TextHooks
    onStatus?: (summary: string) => void | Promise<void>
  }): Promise<SpecOutputType> {
    return run({ ...input, mode: "compile" })
  }

  /**
   * Rewrite a spec based on failure analysis from a previous execution.
   */
  export async function rewrite(input: {
    title: string
    request: string
    rewriteContext: SpecRewriteContext
    goals?: Array<{ description: string; criteria: string; priority?: string }>
    sessionID?: string
    metadata?: Record<string, unknown>
    signal?: AbortSignal
    stream?: TextHooks
    onStatus?: (summary: string) => void | Promise<void>
  }): Promise<SpecOutputType> {
    return run({ ...input, mode: "rewrite" })
  }
}

export { HeadlessSpecAgent as SpecAgent }
export const parseSpecOutput = (text: string) => extractJSON(text, true)
export const parseSpecMarkdown = (text: string) => extractSpecText(text)

// ---------------------------------------------------------------------------
// Internal implementation
// ---------------------------------------------------------------------------

async function run(input: {
  title: string
  request: string
  mode: "initial" | "compile" | "rewrite"
  goals?: Array<{ description: string; criteria: string; priority?: string }>
  previousSpec?: string
  rewriteContext?: SpecRewriteContext
  sessionID?: string
  metadata?: Record<string, unknown>
  signal?: AbortSignal
  stream?: TextHooks
  onStatus?: (summary: string) => void | Promise<void>
}): Promise<SpecOutputType> {
  if (input.signal?.aborted) throw new Error("spec agent aborted before model resolution")

  const { model, language } = await resolveHeadlessLanguageModel({
    label: "spec",
    metadata: input.metadata,
    sessionID: input.sessionID,
  })

  if (input.signal?.aborted) throw new Error("spec agent aborted after model resolution")

  // Extract working directory from request
  const cwdMatch =
    input.request.match(/(?:绝对路径|absolute path)[：:\s]*([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i) ??
    input.request.match(/(?:工作目录|working dir(?:ectory)?)[^\n]*?([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i)
  const taskWorkDir = cwdMatch ? cwdMatch[1].replace(/[/\\]+$/, "") : undefined

  const enableWebSearch = shouldEnableSpecWebSearch(input.request)
  const allTools = createPlannerTools(taskWorkDir, { web: enableWebSearch })
  if (!enableWebSearch) delete allTools.web_search

  const fileRefs = await resolveFileReferences(input.request, taskWorkDir)
  if (input.signal?.aborted) throw new Error("spec agent aborted before context prefetch")

  const context = prefetchContext(input.title, input.request)

  let lastParsed: SpecOutputType | undefined
  let lastQuality: { score: number; reasons: string[]; broadTitles: string[] } | undefined

  for (let attempt = 0; attempt < MAX_SPEC_ATTEMPTS; attempt++) {
    if (input.signal?.aborted) throw new Error("spec agent aborted before attempt " + (attempt + 1))

    const retryContext = attempt > 0 && lastQuality
      ? { previousScore: lastQuality.score, reasons: lastQuality.reasons, broadTitles: lastQuality.broadTitles, attempt }
      : undefined
    const userPrompt = buildUserPrompt(input, fileRefs, context, retryContext)

    log.info("spec agent starting", {
      title: input.title,
      mode: input.mode,
      model: language.modelId,
      prefetchedContext: context.length > 0,
      fileRefsFound: fileRefs.length,
      taskWorkDir,
      enableWebSearch,
      toolCount: Object.keys(allTools).length,
      attempt: attempt + 1,
      retryReason: retryContext ? `score ${retryContext.previousScore} < ${QUALITY_RETRY_THRESHOLD}` : undefined,
    })

    let result: {
      text?: string
      finishReason?: string
      steps: Array<{ text?: string; toolCalls?: unknown[]; toolResults?: unknown[] }>
    }
    try {
      result = await completeHeadlessText({
        label: "spec",
        model,
        language,
        sessionID: input.sessionID,
        stopWhen: [stepCountIs(maxSteps())],
        tools: allTools,
        maxOutputTokens: 32768,
        timeoutMs: false,
        abortSignal: input.signal,
        system: await specSystem(enableWebSearch),
        prompt: userPrompt,
        ...(input.stream ? input.stream : {}),
      })
    } catch (error) {
      log.error("spec agent primary run failed", {
        attempt: attempt + 1,
        error: String(error),
      })
      throw error
    }
    const toolCallCount = result.steps.reduce(
      (sum, s) => sum + (Array.isArray((s as any).toolCalls) ? (s as any).toolCalls.length : 0),
      0,
    )
    const toolUsage = summarizeToolUsage(result.steps)

    log.info("spec agent tool usage", {
      attempt: attempt + 1,
      finishReason: result.finishReason,
      stepCount: result.steps.length,
      toolCallCount,
      toolUsage,
    })
    let allText = collectText(result)
    if (!allText.trim()) {
      log.error("spec: primary run produced no final text", {
        steps: result.steps.length,
        finishReason: result.finishReason,
        attempt: attempt + 1,
      })
      throw new Error("spec agent produced no markdown output")
    }

    log.info("spec agent finished via raw text output", {
      steps: result.steps.length,
      finishReason: result.finishReason,
      textLength: allText.length,
      textPreview: allText.slice(0, 200),
      attempt: attempt + 1,
    })

    let parsed = extractSpecText(allText)

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

    lastParsed = parsed
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
    await input.onStatus?.(`Spec retry attempt ${attempt + 2}: ${specQuality.reasons.join("; ")}`)
  }

  return lastParsed!
}

// ---------------------------------------------------------------------------
// User prompt building
// ---------------------------------------------------------------------------

export function shouldEnableSpecWebSearch(request: string) {
  if (/https?:\/\//i.test(request)) return true
  if (/(oauth|webhook|stripe|twilio|slack|discord|telegram|openai|anthropic|github api|gitlab api|google maps|notion api|airtable|s3|aws sdk|cloudflare api)/i.test(request)) return true
  return !isLargeSpecRequest(request)
}

export async function specSystem(enableWebSearch = false) {
  const config = await Config.get()
  const base = typeof config.prompt?.spec_system === "string" ? config.prompt.spec_system : SPEC_SYSTEM
  if (enableWebSearch) return base
  return base
    .replace("- **web_search**: Search the web for external documentation (use only when needed)\n", "")
    .replace('For external APIs, unfamiliar libraries, or protocols ? use web_search.', 'Rely on the provided request, project memory, preferences, and codebase tools. Do not perform external research unless the request includes explicit external documentation URLs or third-party API requirements.')
    .replace('Use web_search if needed for reference implementations.', 'Do not leave the workspace for reference research in this run; ground the specification in the provided request and codebase context.')
}

function buildUserPrompt(
  input: {
    title: string
    request: string
    mode: "initial" | "compile" | "rewrite"
    goals?: Array<{ description: string; criteria: string; priority?: string }>
    previousSpec?: string
    rewriteContext?: SpecRewriteContext
  },
  fileRefs: Array<{ ref: string; content: string }>,
  context: string,
  retryContext?: { previousScore: number; reasons: string[]; broadTitles: string[]; attempt: number },
): string {
  const sections = [`# Task\n\nTitle: ${input.title}\n\nRequest:\n${input.request}`]

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
        "- Rewrite the specification from scratch instead of lightly editing the previous draft",
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
        retryContext.broadTitles.length > 0 ? "- Split every broad item listed below into narrower implementation slices" : "",
        retryContext.broadTitles.length > 0 ? "" : "",
        retryContext.broadTitles.length > 0 ? "**Broad items that MUST be split:**" : "",
        ...retryContext.broadTitles.map((title) => `- ${title}`),
        retryContext.broadTitles.length > 0 ? "" : "",
        "**Spec item rules for this attempt:**",
        "- Under # Spec Items, output the numbered list immediately. Do not add a preface like '包含功能' or '功能模块' before item 1",
        "- For this large request, produce exactly 8-10 spec items",
        "- Treat the spec items as iterative implementation stages in one evolving workspace",
        "- Each item must cover one implementation slice only, not an umbrella feature bundle",
        "- Do not combine independent domains such as auth + storage + sync, or timeline + calendar + search, into one item",
        "- Prefer vertical slices such as editor CRUD, timeline feed, calendar browsing, search/filter, reminder jobs, privacy lock, sync queue, stats dashboard, settings, and tests",
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

  if (input.previousSpec) {
    sections.push(`# Previous Specification (for revision)\n\n${input.previousSpec}`)
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
        "Produce your specification as plain markdown with the required section headings.",
    )
  } else {
    sections.push(
      "Now recall memory, check preferences, explore the codebase thoroughly, " +
        "then produce your specification as plain markdown with the required section headings.",
    )
  }

  return sections.join("\n\n")
}

// ---------------------------------------------------------------------------
// JSON extraction & repair (mirrors planner/agent.ts logic)
// ---------------------------------------------------------------------------

function extractJSON(text: string, strict = false): SpecOutputType {
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
    if (strict) throw new Error("spec output invalid JSON: truncated JSON")
    log.warn("spec: JSON appears truncated, attempting repair", { length: raw.length })
    raw = repairTruncatedJSON(raw)
  }

  let obj: any
  const parseErr = tryParseJSON(raw)
  if (parseErr.ok) {
    obj = parseErr.value
  } else {
    const trimmed = trimToLastComplete(raw)
    const retryErr = tryParseJSON(trimmed)
    if (retryErr.ok) {
      obj = retryErr.value
    } else {
      if (strict) {
        throw new Error(`spec output invalid JSON: ${parseErr.error instanceof Error ? parseErr.error.message : String(parseErr.error)}`)
      }
      log.error("spec: JSON parse failed after all repair attempts", {
        error: String(parseErr.error),
        rawLength: raw.length,
      })
      obj = { summary: "", content: "", scope: "", spec_items: [], assumptions: [], risks: [], evidence_sources: [], unresolved_questions: [] }
    }
  }

  // Normalize
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

  if (!obj.summary) obj.summary = ""
  if (!obj.content) obj.content = ""
  if (!obj.scope) obj.scope = ""
  if (!Array.isArray(obj.spec_items)) obj.spec_items = []
  if (!Array.isArray(obj.assumptions)) obj.assumptions = []
  if (!Array.isArray(obj.risks)) obj.risks = []
  if (!Array.isArray(obj.evidence_sources)) obj.evidence_sources = []
  if (!Array.isArray(obj.unresolved_questions)) obj.unresolved_questions = []

  try {
    return SpecOutput.parse(obj)
  } catch (zodErr) {
    if (strict) {
      throw new Error(`spec output failed schema validation: ${zodErr instanceof Error ? zodErr.message : String(zodErr)}`)
    }
    log.error("spec: Zod validation failed, returning with defaults", { error: String(zodErr) })
    return SpecOutput.parse({
      summary: obj.summary || "",
      content: obj.content || "",
      scope: obj.scope || "",
      spec_items: [],
      assumptions: [],
      risks: Array.isArray(obj.risks) ? obj.risks : [],
      evidence_sources: [],
      unresolved_questions: [],
    })
  }
}

function extractSpecText(text: string): SpecOutputType {
  const raw = text.trim()
  if (!raw) throw new Error("spec output empty")
  if (raw.startsWith("{") || raw.includes("```json")) return extractJSON(raw)

  const items = parseSpecItems(raw)
  const assumptions = parseNamedPairs(sectionBody(raw, ["Assumptions", "假设"], { respectHeadingLevel: true }))
  const risks = parseListSection(raw, ["Risks", "风险"], { respectHeadingLevel: true })
  const evidence = parseListSection(raw, ["Evidence", "Evidence Sources", "依据", "证据"], { respectHeadingLevel: true })
  const open = parseListSection(raw, ["Open Questions", "Unresolved Questions", "开放问题", "待确认问题"], { respectHeadingLevel: true })

  return normalizeSpecOutput({
    summary: sectionBody(raw, ["Summary", "摘要"], { respectHeadingLevel: true }).split("\n")[0]?.trim() || firstContentLine(raw),
    content: raw,
    scope: sectionBody(raw, ["Scope", "范围"], { respectHeadingLevel: true }) || firstContentLine(raw),
    out_of_scope: sectionBody(raw, ["Out-of-Scope", "Out of Scope", "范围外"], { respectHeadingLevel: true }) || undefined,
    spec_items: items,
    assumptions,
    risks,
    evidence_sources: evidence,
    unresolved_questions: open,
  })
}

function normalizeSpecOutput(input: SpecOutputType): SpecOutputType {
  return {
    ...input,
    summary: input.summary ?? "",
    content: input.content ?? "",
    scope: input.scope ?? "",
    spec_items: Array.isArray(input.spec_items) ? input.spec_items : [],
    assumptions: Array.isArray(input.assumptions) ? input.assumptions : [],
    risks: Array.isArray(input.risks) ? input.risks : [],
    evidence_sources: Array.isArray(input.evidence_sources) ? input.evidence_sources : [],
    unresolved_questions: Array.isArray(input.unresolved_questions) ? input.unresolved_questions : [],
  }
}

// ---------------------------------------------------------------------------
// Quality validation
// ---------------------------------------------------------------------------

export function validateSpecQuality(
  spec: SpecOutputType,
  request: string,
  toolCallCount: number,
): { score: number; reasons: string[]; broadTitles: string[] } {
  let score = 0
  const reasons: string[] = []
  const largeRequest = isLargeSpecRequest(request)
  const minimumItems = largeRequest ? 7 : 3
  const maximumItems = largeRequest ? 10 : 8
  const maxBroadItems = 0
  const broadTitles = spec.spec_items.filter((item) => isBroadSpecItem(item)).map((item) => item.title)
  const broadItems = broadTitles.length

  if (toolCallCount >= 5) {
    score += 0.2
  } else if (toolCallCount >= 2) {
    score += 0.1
  } else {
    reasons.push(`Only ${toolCallCount} tool calls - explore the codebase more thoroughly (min ${MIN_TOOL_CALLS})`)
  }

  if (spec.content.length >= 1000) {
    score += 0.25
  } else if (spec.content.length >= 600) {
    score += 0.15
  } else if (spec.content.length >= 250) {
    score += 0.08
  } else {
    reasons.push("Spec content too short - must include Scope, Requirements, Constraints. Target 600+ chars")
  }

  if (spec.spec_items.length >= minimumItems) {
    score += 0.3
  } else if (!largeRequest && spec.spec_items.length >= 2) {
    score += 0.2
  } else if (!largeRequest && spec.spec_items.length >= 1) {
    score += 0.1
  } else {
    reasons.push(`Spec items too coarse - define at least ${minimumItems} concrete, independently verifiable spec items${largeRequest ? " for large multi-feature requests" : ""}`)
  }

  if (spec.evidence_sources.length >= 2) {
    score += 0.1
  } else if (spec.evidence_sources.length >= 1) {
    score += 0.05
  } else {
    reasons.push("No evidence sources - list the files and resources you consulted")
  }

  const pathPattern = /[\w/\\-]+\.\w+/g
  const pathCount = (spec.content.match(pathPattern) || []).length
  const technicalKeywords = /\b(API|class|function|interface|module|component|state|event|handler|render|canvas|DOM|HTTP|WebSocket|database|schema|endpoint|route)\b/gi
  const techCount = (spec.content.match(technicalKeywords) || []).length
  if (pathCount >= 2 || techCount >= 8) {
    score += 0.15
  } else if (pathCount >= 1 || techCount >= 4) {
    score += 0.07
  } else {
    reasons.push("Spec content lacks specific file paths or detailed technical design keywords")
  }

  if (broadItems > maxBroadItems) {
    reasons.push(`Spec items still contain ${broadItems} umbrella item(s) - split broad deliverables into narrower executable goals: ${broadTitles.slice(0, 4).join(", ")}${broadTitles.length > 4 ? ", ..." : ""}`)
  }

  if (largeRequest && spec.spec_items.length > maximumItems) {
    reasons.push(`Large multi-feature requests should stay within ${minimumItems}-${maximumItems} execution-sized spec items`)
  }

  if (largeRequest && (spec.spec_items.length < minimumItems || spec.spec_items.length > maximumItems || broadItems > maxBroadItems)) {
    return {
      score: Math.min(score, 0.49),
      reasons,
      broadTitles,
    }
  }

  return { score: Math.min(score, 1), reasons, broadTitles }
}

function isLargeSpecRequest(request: string) {
  const lines = request.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const bullets = lines.filter((line) => /^[-*\u2022]|^\d+[.)\u3001]/.test(line)).length
  const headings = lines.filter((line) => /^#{1,6}\s+/.test(line)).length
  return request.length >= 1200 || bullets >= 8 || headings >= 3
}

export function isBroadSpecItem(item: SpecItem) {
  const title = item.title.trim()
  const detail = item.description.trim()
  const text = `${title} ${detail}`
  const conjunction = /( and |,|\/|与|和|及|、|\+)/i.test(title)
  if (/(\u6574\u4f53\u67b6\u6784|\u5b8c\u6574\u5e94\u7528|\u5168\u91cf\u5e94\u7528|UI \u9875\u9762\u5f00\u53d1|\u9875\u9762\u5f00\u53d1|\u7528\u6237\u8ba4\u8bc1\u670d\u52a1\u5b9e\u73b0|\u6570\u636e\u6a21\u578b\u4e0e\u672c\u5730\u5b58\u50a8\u5b9e\u73b0|CRUD \u4e0e\u81ea\u52a8\u4fdd\u5b58\u529f\u80fd)/i.test(text)) return true
  if (
    conjunction &&
    /(\u914d\u7f6e|\u5efa\u7acb|\u521b\u5efa|\u5b9e\u73b0|configure|setup|create|implement)/i.test(`${title} ${detail}`) &&
    /(auth|\u8ba4\u8bc1|\u767b\u5f55|\u6ce8\u518c|token|session)/i.test(`${title} ${detail}`) &&
    /(supabase|postgres|schema|rls|storage|bucket|\u540e\u7aef|\u5b58\u50a8)/i.test(`${title} ${detail}`) &&
    /(sync|queue|offline|background|\u540c\u6b65|\u79bb\u7ebf|\u540e\u53f0)/i.test(`${title} ${detail}`)
  ) return true
  const groups = [
    /(architecture|bootstrap|foundation|initiali[sz]ation|架构|基础架构|项目初始化|项目架构|搭建)/i,
    /(data model|model layer|entity|entities|schema|type definition|state management|store|数据模型|模型层|实体|类型定义|状态管理)/i,
    /(crud|create|edit|delete|remove|restore|draft|editor|创建|编辑|删除|移除|恢复|草稿|日记)/i,
    /(mood|tag|心情|标签)/i,
    /(auth|\u8ba4\u8bc1|\u767b\u5f55|\u6ce8\u518c|token|session)/i,
    /(supabase|postgres|schema|rls|storage|bucket|\u540e\u7aef|\u5b58\u50a8)/i,
    /(sync|queue|offline|background|\u540c\u6b65|\u79bb\u7ebf|\u540e\u53f0)/i,
    /(ui|screen|view|layout|\u754c\u9762|\u9875\u9762|\u89c6\u56fe|\u5e03\u5c40)/i,
    /(database|sqlite|drizzle|migration|fts|\u6570\u636e\u5e93|\u8fc1\u79fb)/i,
    /(image|upload|thumbnail|\u56fe\u7247|\u4e0a\u4f20|\u7f29\u7565\u56fe)/i,
    /(search|filter|\u641c\u7d22|\u7b5b\u9009)/i,
    /(security|biometric|secure-store|\u5bc6\u7801|\u751f\u7269\u8bc6\u522b|\u5e94\u7528\u9501)/i,
    /(web|responsive|browser|pwa|\u54cd\u5e94\u5f0f)/i,
  ].filter((pattern) => pattern.test(text)).length
  const verbs = (text.match(/(\u914d\u7f6e|\u5efa\u7acb|\u521b\u5efa|\u5b9e\u73b0|\u652f\u6301|configure|setup|create|implement|support)/gi) || []).length
  return conjunction && groups >= 2 && verbs >= 1
}

function parseSpecItems(text: string): SpecItem[] {
  const body = sectionBody(text, ["Spec Items", "Specification Items", "Goals", "\u89c4\u683c\u9879", "\u76ee\u6807"], { respectHeadingLevel: true })
  const source = body || sectionBody(text, ["Acceptance Criteria", "\u9a8c\u6536\u6807\u51c6"], { respectHeadingLevel: true }) || text
  const items = splitSpecBlocks(source)
    .flatMap((block) => {
      const head = cleanSpecLine(block[0] || "")
      if (!head || isSpecMetadataKey(head) || isSpecPreambleLine(head)) return []
      const record = parseSpecRecordLines(block.slice(1))
      const lines = block.slice(1)
        .map((line) => cleanSpecLine(line))
        .filter((line) => line && !isSpecMetadataKey(line) && !isSpecPreambleLine(line))
      const childLines = block.slice(1)
        .filter((line) => /^[-*•]\s+/.test(line.trim()))
        .map((line) => cleanSpecLine(line))
        .filter((line) => line && !isSpecMetadataKey(line) && !isSpecPreambleLine(line) && !isVerificationLine(line))
      const description = [
        record.description,
        record.criteria,
        record.requirement,
        lines.join(" "),
        record.verification,
        record.evidence,
      ]
        .map((item) => item?.trim() || "")
        .find(Boolean)
      const priority = inferSpecPriority(head, record.priority)
      const selectors = parseCheckSelectors(record.check_selector)
      const check_selector = priority === "blocking"
        ? selectors.length > 0 ? selectors : inferSpecChecks([head, description, record.verification, record.evidence].filter(Boolean).join(" "))
        : undefined
      const base: SpecItem = {
        title: specTitle(head),
        description: (description || head).slice(0, 400),
        priority,
        check_selector,
      }
      const children = shouldExpandBroadSpecItem(base, childLines)
        ? childLines
            .map((line) => specChildItem(line, priority, selectors))
            .filter((item): item is SpecItem => !!item)
        : []
      return children.length >= 2 ? children : [base]
    })
    .filter((item) => item.title && item.description)
  return items.slice(0, 12)
}

function shouldExpandBroadSpecItem(item: SpecItem, lines: string[]) {
  if (!isBroadSpecItem(item)) return false
  if (lines.length < 2) return false
  if (/(project bootstrap|project initialization|architecture setup|项目初始化|架构搭建)/i.test(item.title)) return false
  return /( and |,|\/|与|和|及|、)/i.test(item.title)
}

function isVerificationLine(line: string) {
  return /^(verification|verify|check selector|criteria|description|evidence|验证|验收|检查器|检查|说明|描述)[:：]?/i.test(line)
}

function specChildItem(line: string, priority: SpecItem["priority"], selectors: string[]): SpecItem | undefined {
  const title = specTitle(line)
  if (!title || title.length < 6) return
  const check_selector = priority === "blocking"
    ? selectors.length > 0 ? selectors : inferSpecChecks(line)
    : undefined
  return {
    title,
    description: line.slice(0, 240),
    priority,
    check_selector,
  } satisfies SpecItem
}

function inferSpecChecks(text: string) {
  const selectors = new Set<string>()
  if (/test|\u6d4b\u8bd5|\u7528\u4f8b/i.test(text)) selectors.add("test")
  if (/lint|\u683c\u5f0f|\u98ce\u683c/i.test(text)) selectors.add("lint")
  if (/startup|\u542f\u52a8|\u8fd0\u884c/i.test(text)) selectors.add("startup")
  if (/ui|\u754c\u9762|\u4ea4\u4e92|\u89c6\u89c9/i.test(text)) selectors.add("ui_review")
  if (selectors.size === 0) selectors.add("build")
  return [...selectors]
}

function splitSpecBlocks(text: string) {
  const blocks: string[][] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const numbered = isNumberedSpecLine(line)
    const bulleted = /^[-*\u2022]\s+/.test(line)
    const current = blocks[blocks.length - 1]
    const currentNumbered = current ? isNumberedSpecLine(current[0] || "") : false
    const next = cleanSpecLine(line)
    if (numbered) {
      blocks.push([line])
      continue
    }
    if (!current) {
      blocks.push([line])
      continue
    }
    if (bulleted && !currentNumbered && !isSpecMetadataKey(next)) {
      blocks.push([line])
      continue
    }
    current.push(line)
  }
  return blocks
}

function stripSpecFormatting(line: string) {
  return line
    .trim()
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*\u2022]\s+/, "")
    .replace(/^\*\*(.+)\*\*$/, "$1")
    .replace(/^__(.+)__$/, "$1")
    .replace(/^`(.+)`$/, "$1")
    .trim()
}

function isNumberedSpecLine(line: string) {
  return /^\d+[.)\u3001]\s+/.test(stripSpecFormatting(line))
}

function cleanSpecLine(line: string) {
  return stripSpecFormatting(line).replace(/^\d+[.)\u3001]\s+/, "").trim()
}

function parseSpecRecordLines(lines: string[]) {
  const record: Record<string, string> = {}
  for (const line of lines) {
    const value = cleanSpecLine(line)
    const match = value.match(/^([a-zA-Z_ -]+|描述|说明|标准|验收|校验|验证|证据|优先级|检查|检查器)[:：]\s*(.+)$/)
    if (!match) continue
    record[normalizeSpecKey(match[1])] = match[2].trim()
  }
  return record
}

function normalizeSpecKey(key: string) {
  const value = key.trim().toLowerCase()
  if (["description", "desc", "描述", "说明"].includes(value)) return "description"
  if (["criteria", "criterion", "acceptance", "验收", "标准"].includes(value)) return "criteria"
  if (["requirement", "requirements", "要求"].includes(value)) return "requirement"
  if (["verification", "verify", "校验", "验证"].includes(value)) return "verification"
  if (["evidence", "证据"].includes(value)) return "evidence"
  if (["priority", "优先级"].includes(value)) return "priority"
  if (["check_selector", "check selectors", "checks", "检查", "检查器"].includes(value)) return "check_selector"
  return value
}

function isSpecMetadataKey(line: string) {
  const match = cleanSpecLine(line).match(/^([^:：]+)[:：]/)
  if (!match) return false
  return [
    "description",
    "desc",
    "criteria",
    "criterion",
    "acceptance",
    "requirement",
    "requirements",
    "verification",
    "verify",
    "evidence",
    "priority",
    "check_selector",
    "check selectors",
    "checks",
    "描述",
    "说明",
    "标准",
    "验收",
    "要求",
    "验证",
    "校验",
    "证据",
    "优先级",
    "检查",
    "检查器",
  ].includes(match[1].trim().toLowerCase())
}

function isSpecPreambleLine(line: string) {
  const normalized = cleanSpecLine(line).replace(/[：:]+$/, "").trim()
  return /(包含功能|功能模块|主要功能模块|建议拆分|建议功能模块)/i.test(normalized)
}

function specTitle(line: string) {
  const cleaned = cleanSpecLine(line)
  const [head] = cleaned.split(/[:：]/)
  return head.trim().slice(0, 80)
}

function inferSpecPriority(head: string, value?: string): "advisory" | "blocking" {
  return /advisory|建议|可选/i.test(`${head} ${value ?? ""}`) ? "advisory" : "blocking"
}

function parseCheckSelectors(value?: string) {
  return value
    ? [...new Set(value
      .split(/[,\s，；;|]+/)
      .map((item) => item.trim())
      .filter(Boolean))]
    : []
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
    const fs = require("fs")
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

export const SPEC_SYSTEM = `You are a senior software architect acting as the specification brain for OpenCorvus, an autonomous coding orchestrator. Your job is to explore the codebase deeply, understand the context, and produce a precise, grounded specification that downstream planning and execution agents can rely on.

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

## Your Role

You are NOT the planner. You do NOT decompose tasks into subtasks or implementation steps. Your job is to:
1. **Understand** what the user is asking for
2. **Explore** the codebase to ground requirements in reality
3. **Identify** gaps, ambiguities, constraints, and risks
4. **Define** precise, verifiable spec items (acceptance criteria)
5. **Surface** unresolved questions that need user input

The downstream PlannerAgent will take your spec and create implementation plans.

## Your Process

### Phase 0: RECALL (1-3 tool calls)

1. **Search memory** (memory_search) with task keywords. If pre-fetched memory exists, only search for gaps.
2. **List preferences** (preference_list) unless pre-fetched. Preferences are BINDING.

### Phase 1: EXPLORE (5-15 tool calls — MOST IMPORTANT phase)

You MUST explore thoroughly. A spec without specific file paths is worthless.
Minimum 5 tool calls required. Aim for 8-15 for complex tasks.

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
- GOOD: "The SpecAgent class in spec/agent.ts exports initial(), compile(), and rewrite() methods, each returning SpecOutputType"
- BAD: "Create a spec agent" (too vague)

**Content** — Must include these markdown sections:
- **Scope**: What is included in this task
- **Requirements**: Functional and behavioral requirements, referencing specific code
- **Constraints**: Technical constraints discovered from codebase exploration
- **Out-of-Scope**: What is explicitly excluded
- **Open Questions**: Remaining ambiguities

Do NOT include an \`# Acceptance Criteria\` section in content — acceptance criteria live exclusively in \`# Spec Items\` (each item's Description field). Duplicating them creates inconsistency with the goals passed to downstream agents.

### Phase 3: OUTPUT — Emit markdown only

When you have finished exploring and are ready to deliver the spec, output plain markdown only. Do NOT output JSON.

Use these exact sections in order:
- \`# Summary\`
- \`# Scope\`
- \`# Requirements\`
- \`# Constraints\`
- \`# Out-of-Scope\`
- \`# Spec Items\`
- \`# Evidence\`
- \`# Risks\`
- \`# Open Questions\`

Under \`# Spec Items\`, include 3-6 numbered items for ordinary tasks. For large greenfield or multi-feature requests, include 8-10 numbered items. Treat these items as iterative stages in one evolving workspace, and give each item a short title plus one verification-oriented sentence.

## Rules

- ALWAYS explore the codebase before writing the spec. No exceptions.
- Every file path in the spec MUST come from actual tool results or pre-read files.
- spec_items must be verifiable — each should have clear success/failure criteria.
- spec_items.check_selector maps to: build, test, lint, verify_cmd, startup, artifact, visual, puppeteer, ui_review, code_quality, code_review, dead_code_review, spec_check
  (artifact = produced binary/file artifact; visual = screenshot-based visual regression; puppeteer = browser automation check; these three are evaluator-managed and cannot be run by the executor directly)
- Every blocking spec item MUST have at least one check_selector.
- For non-trivial tasks, usually produce 3-8 execution-sized goals.
- Reject broad goals like "Build the complete app architecture" unless the user explicitly asks for a single umbrella deliverable.
- Large greenfield or multi-feature requests MUST be split into 8-10 iterative spec items. Avoid umbrella items like "project bootstrap and architecture setup" or "UI page development".
- Read the spec items as a stage sequence: earlier items establish foundations, later items refine or extend the same workspace.
- Each spec item must represent one implementation slice only. If an item bundles multiple independent capabilities with conjunctions like "与" / "和" / "及" / "、" / "and", split it.
- Do NOT put a preface line like "包含功能" or "包含的功能模块" under # Spec Items; start directly with item 1.
- Write in the same language as the request (Chinese request → Chinese spec).
- If rewriting after failure: revise the spec to address the root cause.
- After finishing exploration, output the markdown specification directly.
- clarifications are for requirement ambiguity only (what to build, scope boundaries, missing details). Never ask about implementation approach, technical choices, file structure, or execution steps — those belong to the planner.

## Quality Self-Check (MANDATORY)

Before outputting the final markdown, verify each of these. If ANY answer is NO, use more tools:

1. Did I make at least 5 tool calls to explore the codebase?
2. Does the content reference specific file paths discovered via tools?
3. Are all spec items concrete and verifiable (not vague aspirations)?
4. Does each blocking spec item have a check_selector?
5. Are evidence_sources populated with actual files I consulted?
6. Could a planner create implementation steps from this spec WITHOUT further exploration?
7. Does the summary accurately describe the specification in one line?
8. For large greenfield or multi-feature tasks, did I split the work into 8-10 narrow spec items instead of umbrella deliverables?

## Output Format

- Content: Use markdown headings exactly as specified above, target 800-2500 chars. Be concise but specific.
- Spec Items: Include at least 3-6 concrete items for non-trivial tasks. Each item should be independently verifiable.
- Format each spec item as:
  1. Title
     - Description: ...
     - Verification: ...
     - Check Selector: build/test/startup/ui_review/...
- For greenfield projects (creating something new with no existing codebase): Include detailed technical design in the markdown sections — data structures, UI layout, state management, interaction flows. Use web_search if needed for reference implementations.
- Output plain markdown only. Do NOT output JSON.`
