/**
 * HeadlessSpecAgent — the orchestrator-owned specification stage that expands a
 * task request into a precise, grounded implementation specification.
 *
 * Positioned as a first-class agent alongside the PlannerAgent:
 * 1. Memory recall — searches project memory for prior work, patterns, gotchas
 * 2. Preference awareness — respects project conventions and constraints
 * 3. Codebase exploration — reads files, searches code, lists directories
 * 4. Web research — searches external documentation when needed
 * 5. Structured output — scope, requirements, acceptance criteria
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
import { Identifier } from "@/id/id"
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

export const RequirementSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  priority: z.enum(["blocking", "advisory"]).default("blocking"),
  acceptance: z.array(z.string().min(1)).min(1),
  evidence_refs: z.array(z.string()).default([]),
  non_goals: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type Requirement = z.infer<typeof RequirementSchema>

/**
 * An architectural layer produced by the spec agent.
 * Layers are ordered from foundational (no dependencies) to most dependent.
 * The goal stage uses this to partition requirements and derive build order —
 * it is the single authoritative source for system structure on this task.
 */
export const ArchitecturalLayerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  depends_on: z.array(z.string()).default([]),
})
export type ArchitecturalLayer = z.infer<typeof ArchitecturalLayerSchema>

export const SpecDraftSchema = z.object({
  summary: z.string(),
  content: z.string(),
  requirements: z.array(RequirementSchema).default([]),
  architectural_layers: z.array(ArchitecturalLayerSchema).optional(),
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

export const SpecOutput = z.object({
  summary: z.string().describe("One-line summary of the specification"),
  content: z.string().describe("Full markdown specification with Scope, Requirements, Constraints, Out-of-Scope, Evidence, Risks, and Open Questions"),
  scope: z.string().describe("What is in scope for this task"),
  out_of_scope: z.string().optional().describe("Explicitly excluded items"),
  requirements: z.array(RequirementSchema).describe("Formulated requirements — precise, verifiable, and grounded in explored evidence"),
  architectural_layers: z.array(ArchitecturalLayerSchema).optional().describe("Ordered architectural layers for this task, from foundational to most dependent. Required when the task spans multiple system components."),
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
export const parseSpecOutput = (text: string) => extractJSON(text)
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
      requirements: parsed.requirements.length,
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

  const minReqs = estimateMinimumRequirements(input.request)
  if (minReqs >= 6) {
    sections.push(
      [
        "# Large PRD Guidance",
        "",
        `This is a large, multi-feature request. You MUST generate at least ${minReqs} separate requirements.`,
        "Each numbered sub-feature (e.g. 10.1.1, 10.1.2) in the PRD should map to its own requirement.",
        "Do NOT collapse multiple sub-features into a single broad requirement.",
        "Each requirement must be specific enough that a single coding session can implement and verify it.",
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
        "- Rewrite the specification from scratch instead of lightly editing the previous draft",
        retryContext.reasons.some((r) => r.includes("tool call"))
          ? `- Make at least ${MIN_TOOL_CALLS} tool calls to explore the codebase`
          : "",
        retryContext.reasons.some((r) => r.includes("file path") || r.includes("evidence"))
          ? "- Include specific file paths and evidence sources from your exploration"
          : "",
        retryContext.reasons.some((r) => r.includes("Requirements") || r.includes("requirement"))
          ? "- Define concrete requirements with explicit acceptance statements and evidence references"
          : "",
        retryContext.reasons.some((r) => r.includes("content"))
          ? "- Write a detailed specification with all required sections (>500 chars)"
          : "",
        "**Requirement rules for this attempt:**",
        "- Under # Requirements, output the numbered list immediately. Do not add a preface like '包含功能' or '功能模块' before item 1",
        "- Each requirement must include what must be true plus at least one verifiable acceptance statement",
        "- Cite explored files, APIs, or references in evidence_refs or surrounding requirement text",
        "- Do not decompose the task into implementation stages or execution slices in the spec stage",
      ]
        .filter(Boolean)
        .join("\n"),
    )
  }

  if (input.goals && input.goals.length > 0) {
    sections.push(
      `# User-Provided Goals\n\nIncorporate these goals into the specification. Ensure each goal has corresponding formulated requirements, but do not turn the spec into an execution plan.\n\n${input.goals
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

function normalizeTextList(value: unknown, separators: RegExp = /(?:\r?\n|[;；|])/): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))]
  }
  if (typeof value !== "string") return []
  return [...new Set(value
    .split(separators)
    .map((item) => item.trim())
    .filter(Boolean))]
}

function normalizeRequirementID(value: unknown, seen: Set<string>) {
  const candidate = typeof value === "string" ? value.trim() : ""
  if (candidate && !seen.has(candidate)) {
    seen.add(candidate)
    return candidate
  }
  let next = Identifier.ascending("requirement")
  while (seen.has(next)) next = Identifier.ascending("requirement")
  seen.add(next)
  return next
}

function normalizeRequirement(
  raw: unknown,
  index: number,
  options?: { seen?: Set<string>; defaultEvidence?: string[] },
): Requirement | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return
  const record = raw as Record<string, unknown>
  const title = typeof record.title === "string" && record.title.trim()
    ? record.title.trim()
    : specTitle(
        typeof record.description === "string" && record.description.trim()
          ? record.description
          : `Requirement ${index + 1}`,
      ) || `Requirement ${index + 1}`
  const description = typeof record.description === "string" && record.description.trim()
    ? record.description.trim()
    : title
  const acceptance = normalizeTextList(
    record.acceptance ?? record.criteria ?? record.verification ?? record.done_definition,
  )
  const evidence_refs = normalizeTextList(
    record.evidence_refs ?? record.evidence ?? options?.defaultEvidence ?? [],
    /(?:\r?\n|[;,，；|])/,
  )
  const non_goals = normalizeTextList(record.non_goals ?? record.non_goal)
  const metadata =
    record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
      ? { ...(record.metadata as Record<string, unknown>) }
      : undefined
  const check_selector = parseCheckSelectors(record.check_selector)
  if (check_selector.length > 0) {
    if (metadata) metadata.check_selector = check_selector
    else record.metadata = { check_selector }
  }
  return RequirementSchema.parse({
    id: normalizeRequirementID(record.id, options?.seen ?? new Set<string>()),
    title,
    description,
    priority: record.priority === "advisory" ? "advisory" : "blocking",
    acceptance: acceptance.length > 0 ? acceptance : [description],
    evidence_refs,
    non_goals: non_goals.length > 0 ? non_goals : undefined,
    metadata: metadata ?? (check_selector.length > 0 ? { check_selector } : undefined),
  })
}

function normalizeRequirements(value: unknown, defaultEvidence: string[]): Requirement[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  return value
    .map((item, index) => normalizeRequirement(item, index, { seen, defaultEvidence }))
    .filter((item): item is Requirement => !!item)
}

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
  const parseErr = tryParseJSON(raw)
  if (parseErr.ok) {
    obj = parseErr.value
  } else {
    const trimmed = trimToLastComplete(raw)
    const retryErr = tryParseJSON(trimmed)
    if (retryErr.ok) {
      obj = retryErr.value
    } else {
      throw new Error(`spec output invalid JSON: ${parseErr.error instanceof Error ? parseErr.error.message : String(parseErr.error)}`)
    }
  }

  const evidence_sources = normalizeTextList(obj.evidence_sources ?? [], /(?:\r?\n|[;,，；|])/)
  obj.requirements = normalizeRequirements(obj.requirements, evidence_sources)
  if (Array.isArray(obj.assumptions)) {
    obj.assumptions = obj.assumptions.filter((a: any) => a && typeof a === "object" && a.question && a.assumption)
  }
  if (Array.isArray(obj.clarifications)) {
    obj.clarifications = obj.clarifications.filter((c: any) => c && typeof c === "object" && c.question)
  }
  if (Array.isArray(obj.architectural_layers)) {
    obj.architectural_layers = normalizeArchitecturalLayers(obj.architectural_layers)
    if (obj.architectural_layers.length === 0) delete obj.architectural_layers
  }

  if (!obj.summary) obj.summary = ""
  if (!obj.content) obj.content = ""
  if (!obj.scope) obj.scope = ""
  if (!Array.isArray(obj.requirements)) obj.requirements = []
  if (!Array.isArray(obj.assumptions)) obj.assumptions = []
  if (!Array.isArray(obj.risks)) obj.risks = []
  obj.evidence_sources = evidence_sources
  if (!Array.isArray(obj.unresolved_questions)) obj.unresolved_questions = []

  try {
    return SpecOutput.parse(obj)
  } catch (zodErr) {
    throw new Error(`spec output failed schema validation: ${zodErr instanceof Error ? zodErr.message : String(zodErr)}`)
  }
}

function extractSpecText(text: string): SpecOutputType {
  const raw = text.trim()
  if (!raw) throw new Error("spec output empty")
  if (raw.startsWith("{") || raw.includes("```json")) return extractJSON(raw)

  const evidence = parseListSection(raw, ["Evidence", "Evidence Sources", "依据", "证据"], { respectHeadingLevel: true })
  const requirements = parseRequirements(raw, evidence)
  const assumptions = parseNamedPairs(sectionBody(raw, ["Assumptions", "假设"], { respectHeadingLevel: true }))
  const risks = parseListSection(raw, ["Risks", "风险"], { respectHeadingLevel: true })
  const open = parseListSection(raw, ["Open Questions", "Unresolved Questions", "开放问题", "待确认问题"], { respectHeadingLevel: true })
  const architecturalLayersRaw = parseArchitecturalLayersFromMarkdown(raw)
  const architectural_layers = architecturalLayersRaw.length >= 2 ? architecturalLayersRaw : undefined

  return normalizeSpecOutput({
    summary: sectionBody(raw, ["Summary", "摘要"], { respectHeadingLevel: true }).split("\n")[0]?.trim() || firstContentLine(raw),
    content: raw,
    scope: sectionBody(raw, ["Scope", "范围"], { respectHeadingLevel: true }) || firstContentLine(raw),
    out_of_scope: sectionBody(raw, ["Out-of-Scope", "Out of Scope", "范围外"], { respectHeadingLevel: true }) || undefined,
    requirements,
    architectural_layers,
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
    requirements: Array.isArray(input.requirements) ? input.requirements : [],
    architectural_layers: Array.isArray(input.architectural_layers) && input.architectural_layers.length >= 2
      ? input.architectural_layers
      : undefined,
    assumptions: Array.isArray(input.assumptions) ? input.assumptions : [],
    risks: Array.isArray(input.risks) ? input.risks : [],
    evidence_sources: Array.isArray(input.evidence_sources) ? input.evidence_sources : [],
    unresolved_questions: Array.isArray(input.unresolved_questions) ? input.unresolved_questions : [],
  }
}

function normalizeArchitecturalLayers(raw: unknown[]): ArchitecturalLayer[] {
  return raw
    .filter((l): l is Record<string, unknown> => !!l && typeof l === "object" && !Array.isArray(l))
    .filter((l) => typeof l.id === "string" && l.id.trim())
    .map((l) => ({
      id: String(l.id).trim().toLowerCase().replace(/[^a-z0-9_]/g, "_"),
      name: typeof l.name === "string" && l.name.trim() ? l.name.trim() : String(l.id).trim(),
      description: typeof l.description === "string" ? l.description.trim() : "",
      depends_on: Array.isArray(l.depends_on)
        ? l.depends_on.map(String).map((s) => s.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_")).filter(Boolean)
        : [],
    }))
}

/**
 * Parse the `# Architecture` section from spec markdown output.
 *
 * Each line format (produced by spec agent):
 *   - id: <id> | name: <name> | description: <desc> | depends_on: [<id>, ...]
 */
function parseArchitecturalLayersFromMarkdown(text: string): ArchitecturalLayer[] {
  const body = sectionBody(text, ["Architecture", "架构", "架构层"], { respectHeadingLevel: true })
  if (!body.trim()) return []
  const layers: ArchitecturalLayer[] = []
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.replace(/^[-*•]\s*/, "").trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const parts: Record<string, string> = {}
    for (const segment of trimmed.split("|")) {
      const colonIdx = segment.indexOf(":")
      if (colonIdx < 0) continue
      const key = segment.slice(0, colonIdx).trim().toLowerCase()
      const value = segment.slice(colonIdx + 1).trim()
      parts[key] = value
    }
    if (!parts.id?.trim()) continue
    const dependsOnMatch = (parts.depends_on ?? parts["depends on"] ?? "").match(/\[([^\]]*)\]/)
    const depends_on = dependsOnMatch
      ? dependsOnMatch[1].split(",").map((s) => s.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_")).filter(Boolean)
      : []
    layers.push({
      id: parts.id.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_"),
      name: parts.name?.trim() || parts.id.trim(),
      description: parts.description?.trim() || "",
      depends_on,
    })
  }
  return layers
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
  const minimumRequirements = estimateMinimumRequirements(request)
  const requirementAcceptances = spec.requirements.reduce((count, item) => count + item.acceptance.length, 0)

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
    reasons.push("Spec content too short - must include Scope, Requirements, Constraints, and evidence. Target 600+ chars")
  }

  if (spec.requirements.length >= minimumRequirements) {
    score += 0.3
  } else if (!largeRequest && spec.requirements.length >= 1) {
    score += 0.2
  } else {
    reasons.push(`Requirements are under-specified - define at least ${minimumRequirements} concrete requirements${largeRequest ? " for large multi-feature requests" : ""}`)
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

  if (requirementAcceptances >= Math.max(spec.requirements.length, minimumRequirements)) {
    score += 0.1
  } else {
    reasons.push("Requirements need clearer acceptance statements - every requirement should be independently verifiable")
  }

  const evidenceLinkedRequirements = spec.requirements.filter((item) => item.evidence_refs.length > 0).length
  if (evidenceLinkedRequirements >= Math.max(1, Math.floor(spec.requirements.length / 2))) {
    score += 0.1
  } else if (spec.requirements.length > 0) {
    reasons.push("Requirements should cite evidence_refs from explored files or references")
  }

  return { score: Math.min(score, 1), reasons, broadTitles: [] }
}

function isLargeSpecRequest(request: string) {
  const lines = request.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const bullets = lines.filter((line) => /^[-*\u2022]|^\d+[.)\u3001]/.test(line)).length
  const headings = lines.filter((line) => /^#{1,6}\s+/.test(line)).length
  return request.length >= 1200 || bullets >= 8 || headings >= 3
}

function estimateMinimumRequirements(request: string): number {
  const lines = request.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  // Count hierarchical numbered sub-sections (e.g., "10.1.1 Feature Name")
  const subSections = lines.filter((l) => /^\d+\.\d+\.\d+\s/.test(l)).length
  if (subSections >= 10) return Math.max(8, Math.ceil(subSections / 2))
  if (subSections >= 5) return Math.max(6, subSections)
  if (isLargeSpecRequest(request)) return 4
  return 2
}

function parseRequirements(text: string, defaultEvidence: string[]): Requirement[] {
  const body = sectionBody(text, ["Requirements", "Requirement", "\u9700\u6c42", "\u8981\u6c42"], { respectHeadingLevel: true })
  if (!body.trim()) return []
  const blocks = splitSpecBlocks(body)
  const seen = new Set<string>()
  const requirements = blocks
    .flatMap((block, index) => {
      const head = cleanSpecLine(block[0] || "")
      if (!head || isSpecMetadataKey(head) || isSpecPreambleLine(head)) return []
      const record = parseSpecRecordLines(block.slice(1))
      const detailLines = block.slice(1)
        .map((line) => cleanSpecLine(line))
        .filter((line) => line && !isSpecMetadataKey(line) && !isSpecPreambleLine(line))
      const description = [
        record.description,
        record.requirement,
        detailLines.join(" "),
      ]
        .map((item) => item?.trim() || "")
        .find(Boolean) || head
      const acceptance = [
        ...normalizeTextList(record.acceptance),
        ...normalizeTextList(record.criteria),
        ...normalizeTextList(record.verification),
      ]
      const evidence_refs = normalizeTextList(record.evidence, /(?:\r?\n|[;,，；|])/)
      const non_goals = normalizeTextList(record.non_goals)
      const selectors = parseCheckSelectors(record.check_selector)
      return [RequirementSchema.parse({
        id: normalizeRequirementID(record.id, seen),
        title: specTitle(head) || `Requirement ${index + 1}`,
        description: description.slice(0, 1_000),
        priority: inferSpecPriority(head, record.priority),
        acceptance: acceptance.length > 0 ? acceptance : [description.slice(0, 400)],
        evidence_refs: evidence_refs.length > 0 ? evidence_refs : defaultEvidence,
        non_goals: non_goals.length > 0 ? non_goals : undefined,
        metadata: selectors.length > 0 ? { check_selector: selectors } : undefined,
      })]
    })
  return requirements
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
  if (["acceptance criteria", "done definition", "完成定义"].includes(value)) return "acceptance"
  if (["requirement", "requirements", "要求"].includes(value)) return "requirement"
  if (["verification", "verify", "校验", "验证"].includes(value)) return "verification"
  if (["evidence", "evidence ref", "evidence refs", "证据"].includes(value)) return "evidence"
  if (["non_goal", "non_goals", "non-goal", "non-goals", "non goal", "non goals", "out of scope", "非目标", "不包含"].includes(value)) return "non_goals"
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
    "acceptance criteria",
    "done definition",
    "requirement",
    "requirements",
    "verification",
    "verify",
    "evidence",
    "evidence ref",
    "evidence refs",
    "non_goal",
    "non_goals",
    "non-goal",
    "non-goals",
    "non goal",
    "non goals",
    "out of scope",
    "priority",
    "check_selector",
    "check selectors",
    "checks",
    "描述",
    "说明",
    "标准",
    "验收",
    "完成定义",
    "要求",
    "验证",
    "校验",
    "证据",
    "非目标",
    "不包含",
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

function parseCheckSelectors(value?: unknown) {
  if (Array.isArray(value)) {
    return [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))]
  }
  if (typeof value !== "string") return []
  return [...new Set(value
    .split(/[,\s，；;|]+/)
    .map((item) => item.trim())
    .filter(Boolean))]
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

export const SPEC_SYSTEM = `You are a senior software architect acting as the specification brain for OpenCorvus, an autonomous coding orchestrator. Your job is to explore the codebase deeply, understand the context, and produce a precise, grounded specification that downstream goal and planning agents can rely on.

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

You are NOT the goal decomposer and NOT the planner. Do NOT turn the task into execution stages, implementation waves, or workload slices.

Your job is to:
1. Understand what the user is asking for
2. Explore the codebase to ground the request in reality
3. Identify gaps, ambiguities, constraints, dependencies, and risks
4. Formulate precise requirements with explicit acceptance statements
5. Surface unresolved questions that genuinely block requirement clarity

The downstream goal agent will decompose the workload later. Your output is the source-of-truth formulation layer.

## Your Process

### Phase 0: RECALL

1. Search memory with task keywords. If pre-fetched memory exists, search only for gaps.
2. List preferences unless pre-fetched. Preferences are BINDING.

### Phase 1: EXPLORE

You MUST explore thoroughly. A spec without specific file paths is worthless.
Minimum 5 tool calls required. Aim for 8-15 for complex tasks.

After exploration, you should know:
- What already exists that's relevant to the task
- The coding patterns and conventions to follow
- The exact types, interfaces, and APIs involved
- What dependencies and constraints exist
- What evidence supports each major requirement

### Phase 1.5: RESEARCH

For external APIs, unfamiliar libraries, or protocols, use web_search when necessary.

### Phase 2: SPECIFY

Your spec must be CONCRETE, not abstract. Reference specific files, functions, types, routes, schemas, or configs discovered via tools.

#### 2a. Architecture Layers (required for multi-component tasks)

When the task spans 3 or more distinct system components, you MUST produce an \`# Architecture\` section. This is the single authoritative declaration of system structure — the downstream goal agent will use it to partition requirements and determine build order. It will NOT re-derive architecture on its own.

Rules:
- Layers must be SPECIFIC to this task. Bad: "backend", "frontend". Good: "diary_persistence", "auth_service", "diary_crud_api".
- Order from foundational (no dependencies) to most dependent.
- Each layer on its own line in this exact format:
  \`- id: <snake_case_id> | name: <Human Name> | description: <what files/code lives here> | depends_on: [<id>, ...]\`
- Use \`depends_on: []\` for foundational layers.

Example for a diary app:
- id: project_setup | name: Project Setup | description: package.json, tsconfig, build tooling | depends_on: []
- id: persistence | name: Data Persistence | description: database schema, migrations, ORM models | depends_on: [project_setup]
- id: auth | name: Authentication | description: auth routes, JWT, session management | depends_on: [persistence]
- id: diary_core | name: Diary Core API | description: CRUD routes for diary entries, tags, moods | depends_on: [auth, persistence]
- id: review_ui | name: Review & Timeline | description: timeline view, calendar, search | depends_on: [diary_core]
- id: verification | name: Test Suite | description: automated tests covering all layers | depends_on: [diary_core, review_ui]

Omit the Architecture section ONLY for simple single-feature tasks (≤ 2 requirements).

#### 2b. Requirements

The key output is a formulation-oriented \`# Requirements\` section. Each requirement must say:
- What must be true
- How acceptance will be judged
- What explored evidence supports it
- Optional non-goals or exclusions if needed

GOOD requirement:
1. Overlay render lifecycle is owned by \`packages/opencorvus/src/...\`
   - Description: ...
   - Acceptance: ...
   - Evidence Refs: \`packages/opencorvus/src/...\`

BAD requirement:
1. Build the whole architecture

### Phase 3: OUTPUT

When you have finished exploring and are ready to deliver the spec, output plain markdown only. Do NOT output JSON.

Use these exact sections in order:
- \`# Summary\`
- \`# Architecture\` (if multi-component — see Phase 2a)
- \`# Scope\`
- \`# Requirements\`
- \`# Constraints\`
- \`# Out-of-Scope\`
- \`# Evidence\`
- \`# Risks\`
- \`# Open Questions\`

Under \`# Requirements\`, include a numbered list. Each requirement should use this structure when possible:
1. Title
   - Description: ...
   - Acceptance: ...
   - Evidence Refs: ...
   - Non-Goals: ... (optional)

Do NOT add a \`# Spec Items\` section unless the user explicitly asks for one. Do NOT encode execution ordering or iterative stages in the spec.

## Rules

- ALWAYS explore the codebase before writing the spec.
- Every file path in the spec MUST come from actual tool results or pre-read files.
- Requirements must be verifiable. Every blocking requirement needs an explicit acceptance statement.
- Requirements should cite evidence from explored files, documentation, or memory when relevant.
- Do NOT decompose the task into implementation slices, waves, or stages.
- Do NOT reject a requirement merely because it is broad; breadth is handled later by the goal stage.
- Write in the same language as the request.
- If rewriting after failure, revise the formulation to address the discovered requirement or scope failure.
- Clarifications are for requirement ambiguity only. Never ask about implementation approach, technical choices, file structure, or execution steps.
- If the task spans 3+ components, the Architecture section is MANDATORY. A missing Architecture section forces the downstream goal agent to guess system structure, producing worse goal ordering and dependencies.

## Quality Self-Check

Before outputting the final markdown, verify each of these. If ANY answer is NO, use more tools:

1. Did I make at least 5 tool calls to explore the codebase?
2. Does the content reference specific file paths discovered via tools?
3. Does every blocking requirement include an acceptance statement?
4. Are evidence sources populated with actual files or references I consulted?
5. Does the spec contain scope, constraints, and out-of-scope boundaries?
6. Could a downstream goal agent decompose this workload without re-exploring the codebase?
7. Does the summary accurately describe the specification in one line?
8. If the task spans 3+ components, does the spec include an \`# Architecture\` section with task-specific layer IDs and \`depends_on\` edges?

## Output Format

- Use markdown headings exactly as specified above, target 800-2500 chars. Be concise but specific.
- Prefer 3-8 requirements for non-trivial tasks, but optimize for correctness and coverage rather than arbitrary slicing.
- For greenfield projects, include detailed technical design in the markdown sections: data structures, UI layout, state management, interaction flows, external constraints.
- Output plain markdown only. Do NOT output JSON.`
