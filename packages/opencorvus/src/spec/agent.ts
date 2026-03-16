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
import z from "zod"
import { Provider } from "@/provider/provider"
import { createPlannerTools, prefetchContext } from "@/planner/tools"
import { Filesystem } from "@/util/filesystem"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { Env } from "@/env"
import { completeText } from "@/llm/api"
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
  content: z.string().describe("Full markdown specification with Scope, Requirements, Constraints, Acceptance Criteria, Out-of-Scope, Open Questions"),
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

const MIN_TOOL_CALLS = 3
const QUALITY_RETRY_THRESHOLD = 0.6
const MAX_SPEC_ATTEMPTS = 2

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
    signal?: AbortSignal
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
    signal?: AbortSignal
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
    signal?: AbortSignal
  }): Promise<SpecOutputType> {
    return run({ ...input, mode: "rewrite" })
  }
}

export { HeadlessSpecAgent as SpecAgent }
export const parseSpecOutput = (text: string) => extractJSON(text, true)

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
  signal?: AbortSignal
}): Promise<SpecOutputType> {
  if (input.signal?.aborted) throw new Error("spec agent aborted before model resolution")

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

  const allTools = createPlannerTools(taskWorkDir)

  const fileRefs = await resolveFileReferences(input.request, taskWorkDir)
  if (input.signal?.aborted) throw new Error("spec agent aborted before context prefetch")

  const context = prefetchContext(input.title, input.request)

  let lastParsed: SpecOutputType | undefined
  let lastQuality: { score: number; reasons: string[] } | undefined

  for (let attempt = 0; attempt < MAX_SPEC_ATTEMPTS; attempt++) {
    if (input.signal?.aborted) throw new Error("spec agent aborted before attempt " + (attempt + 1))

    const retryContext = attempt > 0 && lastQuality
      ? { previousScore: lastQuality.score, reasons: lastQuality.reasons, attempt }
      : undefined
    const userPrompt = buildUserPrompt(input, fileRefs, context, retryContext)

    log.info("spec agent starting", {
      title: input.title,
      mode: input.mode,
      model: language.modelId,
      prefetchedContext: context.length > 0,
      fileRefsFound: fileRefs.length,
      taskWorkDir,
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
      result = await completeText({
        model: language,
        stopWhen: [stepCountIs(maxSteps())],
        tools: allTools,
        maxOutputTokens: 32768,
        timeoutMs: false,
        abortSignal: input.signal,
        system: SPEC_SYSTEM,
        prompt: userPrompt,
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
  }

  return lastParsed!
}

// ---------------------------------------------------------------------------
// User prompt building
// ---------------------------------------------------------------------------

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
  retryContext?: { previousScore: number; reasons: string[]; attempt: number },
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
  const parseErr = tryParse(raw)
  if (parseErr.ok) {
    obj = parseErr.value
  } else {
    const trimmed = trimToLastComplete(raw)
    const retryErr = tryParse(trimmed)
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

function collectText(result: {
  text?: string
  steps: Array<{ text?: string }>
}) {
  const direct = result.text?.trim() || ""
  if (direct) return direct
  return result.steps.map((step) => step.text?.trim() || "").filter(Boolean).join("\n\n")
}

function extractSpecText(text: string): SpecOutputType {
  const raw = text.trim()
  if (!raw) throw new Error("spec output empty")
  if (raw.startsWith("{") || raw.includes("```json")) return extractJSON(raw)

  const items = parseSpecItems(raw)
  const assumptions = parseNamedPairs(sectionBody(raw, ["Assumptions", "假设"]))
  const risks = parseListSection(raw, ["Risks", "风险"])
  const evidence = parseListSection(raw, ["Evidence", "Evidence Sources", "依据", "证据"])
  const open = parseListSection(raw, ["Open Questions", "Unresolved Questions", "开放问题", "待确认问题"])

  return normalizeSpecOutput({
    summary: sectionBody(raw, ["Summary", "摘要"]).split("\n")[0]?.trim() || firstContentLine(raw),
    content: raw,
    scope: sectionBody(raw, ["Scope", "范围"]) || firstContentLine(raw),
    out_of_scope: sectionBody(raw, ["Out-of-Scope", "Out of Scope", "范围外"]) || undefined,
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
  if (spec.content.length >= 1000) {
    score += 0.25
  } else if (spec.content.length >= 600) {
    score += 0.15
  } else if (spec.content.length >= 250) {
    score += 0.08
  } else {
    reasons.push("Spec content too short — must include Scope, Requirements, Constraints, Acceptance Criteria. Target 600+ chars")
  }

  // Spec items quality (0.3 max — most important dimension)
  if (spec.spec_items.length >= 3) {
    score += 0.3
  } else if (spec.spec_items.length >= 2) {
    score += 0.2
  } else if (spec.spec_items.length >= 1) {
    score += 0.1
  } else {
    reasons.push("No spec items — define at least 3 concrete, verifiable spec items for non-trivial tasks")
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
  if (pathCount >= 2 || techCount >= 8) {
    score += 0.15
  } else if (pathCount >= 1 || techCount >= 4) {
    score += 0.07
  } else {
    reasons.push("Spec content lacks specific file paths or detailed technical design keywords")
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

function sectionBody(text: string, names: string[]) {
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const title = lines[i].trim().replace(/^#{1,6}\s*/, "")
    if (!names.some((name) => title.localeCompare(name, "en", { sensitivity: "accent" }) === 0)) continue
    const body: string[] = []
    for (let j = i + 1; j < lines.length; j++) {
      if (/^#{1,6}\s+/.test(lines[j].trim())) break
      body.push(lines[j])
    }
    return body.join("\n").trim()
  }
  return ""
}

function parseListSection(text: string, names: string[]) {
  return sectionBody(text, names)
    .split(/\r?\n/)
    .flatMap((line) => {
      const value = line.trim().replace(/^[-*•]\s+/, "").replace(/^\d+[.)、]\s+/, "")
      return value ? [value] : []
    })
}

function parseNamedPairs(text: string) {
  return text.split(/\r?\n/).flatMap((line) => {
    const value = line.trim().replace(/^[-*•]\s+/, "").replace(/^\d+[.)、]\s+/, "")
    if (!value) return []
    const pair = value.split(/[:：]/)
    if (pair.length < 2) return []
    return [{
      question: pair[0].trim(),
      assumption: pair.slice(1).join(":").trim(),
    }]
  })
}

function parseSpecItems(text: string): SpecItem[] {
  const body = sectionBody(text, ["Spec Items", "Specification Items", "Goals", "规格项", "目标"])
  const source = body || sectionBody(text, ["Acceptance Criteria", "验收标准"]) || text
  const items = splitSpecBlocks(source)
    .flatMap((block) => {
      const head = cleanSpecLine(block[0] || "")
      if (!head || isSpecMetadataKey(head)) return []
      const record = parseSpecRecordLines(block.slice(1))
      const description = [
        record.description,
        record.criteria,
        record.requirement,
        record.verification,
        record.evidence,
        block.slice(1)
          .map((line) => cleanSpecLine(line))
          .filter((line) => line && !isSpecMetadataKey(line))
          .join(" "),
      ]
        .map((item) => item?.trim() || "")
        .find(Boolean)
      const priority = inferSpecPriority(head, record.priority)
      const selectors = parseCheckSelectors(record.check_selector)
      const check_selector = priority === "blocking"
        ? selectors.length > 0 ? selectors : inferSpecChecks([head, description].filter(Boolean).join(" "))
        : undefined
      return [{
        title: specTitle(head),
        description: (description || head).slice(0, 400),
        priority,
        check_selector,
      }]
    })
    .filter((item) => item.title && item.description)
  return items.slice(0, 8)
}

function inferSpecChecks(text: string) {
  const selectors = new Set<string>()
  if (/test|测试|用例/i.test(text)) selectors.add("test")
  if (/lint|格式|风格/i.test(text)) selectors.add("lint")
  if (/startup|启动|运行/i.test(text)) selectors.add("startup")
  if (/ui|界面|交互|视觉/i.test(text)) selectors.add("ui_review")
  if (selectors.size === 0) selectors.add("build")
  return [...selectors]
}

function splitSpecBlocks(text: string) {
  const blocks: string[][] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const numbered = /^\d+[.)、]\s+/.test(line)
    const bulleted = /^[-*•]\s+/.test(line)
    const current = blocks[blocks.length - 1]
    const currentNumbered = current ? /^\d+[.)、]\s+/.test(current[0] || "") : false
    const next = cleanSpecLine(line)
    if (numbered) {
      blocks.push([line])
      continue
    }
    if (bulleted && (!current || (!currentNumbered && !isSpecMetadataKey(next)))) {
      blocks.push([line])
      continue
    }
    if (!current) {
      blocks.push([line])
      continue
    }
    current.push(line)
  }
  return blocks
}

function cleanSpecLine(line: string) {
  return line.trim().replace(/^[-*•]\s+/, "").replace(/^\d+[.)、]\s+/, "").trim()
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

function specTitle(line: string) {
  const cleaned = cleanSpecLine(line)
  const [head] = cleaned.split(/[:：]/)
  return head.trim().slice(0, 80)
}

function inferSpecPriority(head: string, value?: string) {
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

function firstContentLine(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => !!line && !/^#{1,6}\s+/.test(line))
    || ""
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
- GOOD: "The SpecAgent class in spec/agent.ts exports initial(), compile(), and rewrite() methods, each returning SpecOutputType"
- BAD: "Create a spec agent" (too vague)

**Content** — Must include these markdown sections:
- **Scope**: What is included in this task
- **Requirements**: Functional and behavioral requirements, referencing specific code
- **Constraints**: Technical constraints discovered from codebase exploration
- **Acceptance Criteria**: Concrete, testable criteria linked to spec items
- **Out-of-Scope**: What is explicitly excluded
- **Open Questions**: Remaining ambiguities

### Phase 3: OUTPUT — Emit markdown only

When you have finished exploring and are ready to deliver the spec, output plain markdown only. Do NOT output JSON.

Use these exact sections in order:
- \`# Summary\`
- \`# Scope\`
- \`# Requirements\`
- \`# Constraints\`
- \`# Acceptance Criteria\`
- \`# Spec Items\`
- \`# Evidence\`
- \`# Risks\`
- \`# Open Questions\`

Under \`# Spec Items\`, include 3-6 numbered items. Each item must include a short title and one verification-oriented sentence.

## Rules

- ALWAYS explore the codebase before writing the spec. No exceptions.
- Every file path in the spec MUST come from actual tool results or pre-read files.
- spec_items must be verifiable — each should have clear success/failure criteria.
- spec_items.check_selector maps to: build, test, lint, verify_cmd, startup, ui_review, code_quality, code_review, dead_code_review, spec_check
- Every blocking spec item MUST have at least one check_selector.
- Write in the same language as the request (Chinese request → Chinese spec).
- If rewriting after failure: revise the spec to address the root cause.
- After finishing exploration, output the markdown specification directly.

## Quality Self-Check (MANDATORY)

Before outputting the final markdown, verify each of these. If ANY answer is NO, use more tools:

1. Did I make at least ${MIN_TOOL_CALLS} tool calls to explore the codebase?
2. Does the content reference specific file paths discovered via tools?
3. Are all spec items concrete and verifiable (not vague aspirations)?
4. Does each blocking spec item have a check_selector?
5. Are evidence_sources populated with actual files I consulted?
6. Could a planner create implementation steps from this spec WITHOUT further exploration?
7. Does the summary accurately describe the specification in one line?

## Output Format

- Content: Use markdown headings exactly as specified above, target 800-2500 chars. Be concise but specific.
- Spec Items: Include at least 3-6 concrete items for non-trivial tasks. Each item should be independently verifiable.
- For greenfield projects (creating something new with no existing codebase): Include detailed technical design in the markdown sections — data structures, UI layout, state management, interaction flows. Use web_search if needed for reference implementations.
- Output plain markdown only. Do NOT output JSON.`
