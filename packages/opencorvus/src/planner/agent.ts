/**
 * HeadlessPlannerAgent — the orchestrator-owned planning stage that expands a
 * task request into PRD/waves/subtasks/risks for downstream
 * execution.
 *
 * Capabilities:
 * 1. Memory recall — searches project memory for prior work, patterns, gotchas
 * 2. Preference awareness — respects project conventions and constraints
 * 3. Codebase exploration — reads files, searches code, lists directories
 * 4. Web research — searches external documentation when needed
 * 5. Structured output — PRD, waves, subtasks, risks, assumptions
 * 6. Replan — receives structured failure analysis and produces alternative strategies
 */
import { stepCountIs } from "ai"
import z from "zod"
import { completeHeadlessText, resolveHeadlessLanguageModel } from "@/llm/headless"
import { createPlannerTools, prefetchContext } from "./tools"
import { Filesystem } from "@/util/filesystem"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { unattendedProject } from "@/orchestrator/unattended"
import { Env } from "@/env"
import { type TextHooks } from "@/llm/api"
import path from "path"
import { Config } from "@/config/config"
import { WaveContract, normalizePlanWaves } from "@/orchestrator/wave"

const log = Log.create({ service: "planner-agent" })

// ---------------------------------------------------------------------------
// Output schema — what the planner agent produces
// ---------------------------------------------------------------------------

export const PlannerOutput = z.object({
  prd: z.string().describe("Expanded PRD with full technical context from codebase exploration"),
  summary: z.string().describe("One-line summary of the plan"),
  waves: z.array(WaveContract).optional(),
  subtasks: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      order: z.number().optional(),
    }),
  ),
  risks: z.array(z.string()),
  assumptions: z
    .array(
      z.object({
        question: z.string(),
        assumption: z.string(),
      }),
    )
    .optional(),
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

export type PlannerOutputType = z.infer<typeof PlannerOutput>

// ---------------------------------------------------------------------------
// Replan context — structured failure information from the evaluator agent
// ---------------------------------------------------------------------------

export interface WaveStatus {
  title: string
  waveIndex: number
  status: "passed" | "partial" | "failed" | "pending"
  goals: Array<{ description: string; status: string }>
}

export interface ReplanContext {
  previousSummary: string
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
  previousWaves?: WaveStatus[]
}

// ---------------------------------------------------------------------------
// HeadlessPlannerAgent
// ---------------------------------------------------------------------------

const MIN_TOOL_CALLS = 3
const QUALITY_RETRY_THRESHOLD = 0.5
const MAX_PLAN_ATTEMPTS = 2

function maxSteps() {
  const value = Number.parseInt(Env.get("OPENCORVUS_PLANNER_AGENT_MAX_STEPS") ?? "", 10)
  return Number.isFinite(value) && value > 0 ? value : 20
}

export namespace HeadlessPlannerAgent {
  export async function plan(input: {
    title: string
    request: string
    /** Authoritative goals from spec -- planner uses them as execution constraints */
    userGoals?: Array<{ description: string; criteria: string; priority?: string }>
    sessionID?: string
    metadata?: Record<string, unknown>
    spec?: { summary?: string; content: string }
    replanContext?: ReplanContext
    timeoutMs?: number
    /** External abort signal (overrides internal timeout when provided) */
    signal?: AbortSignal
    stream?: TextHooks
    onStatus?: (summary: string) => void | Promise<void>
  }): Promise<PlannerOutputType> {
    // Check abort signal early -- setup calls (model resolution, memory search) can be slow
    if (input.signal?.aborted) throw new Error("planner aborted before model resolution")

    const resolved = await resolveHeadlessLanguageModel({
      label: "planner",
      metadata: input.metadata,
      sessionID: input.sessionID,
    })
    if (!resolved) throw new Error("no LLM model available for planner agent")
    const { language, model } = resolved
    if (input.signal?.aborted) throw new Error("planner aborted after model resolution")

    // Extract working directory from request (eval tasks specify it explicitly)
    const cwdMatch =
      input.request.match(/(?:绝对路径|absolute path)[：:\s]*([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i) ??
      input.request.match(/(?:工作目录|working dir(?:ectory)?)[^\n]*?([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i)
    const taskWorkDir = cwdMatch ? cwdMatch[1].replace(/[/\\]+$/, "") : undefined
    const fileRefs = await resolveFileReferences(input.request, taskWorkDir)
    if (input.signal?.aborted) throw new Error("planner aborted before context prefetch")

    const context = prefetchContext(input.title, input.request)
    const recallEnabled = context.length === 0
    // Create tools with the correct working directory for the task.
    // Without this, the codebase tools use Instance.directory (project root)
    // instead of the task's working directory (e.g., eval workspace).
    const explorationTools = createPlannerTools(taskWorkDir, { recall: recallEnabled })
    const unattended = await unattendedProject()

    // Quality-gated retry loop: if the first plan attempt scores below
    // QUALITY_RETRY_THRESHOLD, retry once with enhanced prompt that includes
    // quality feedback from the previous attempt.
    let lastQuality: { score: number; reasons: string[] } | undefined

    for (let attempt = 0; attempt < MAX_PLAN_ATTEMPTS; attempt++) {
      if (input.signal?.aborted) throw new Error("planner aborted before attempt " + (attempt + 1))

      const retryContext = attempt > 0 && lastQuality
        ? { previousScore: lastQuality.score, reasons: lastQuality.reasons, attempt }
        : undefined
      const userPrompt = buildUserPrompt(input, fileRefs, context, retryContext, unattended)
      const stepLimit = maxSteps()

      log.info("planner agent starting", {
        title: input.title,
        isReplan: !!input.replanContext,
        model: language.modelId,
        prefetchedContext: context.length > 0,
        fileRefsFound: fileRefs.length,
        taskWorkDir,
        toolCount: Object.keys(explorationTools).length,
        recallEnabled,
        unattended,
        attempt: attempt + 1,
        maxSteps: stepLimit,
        retryReason: retryContext ? `score ${retryContext.previousScore} < ${QUALITY_RETRY_THRESHOLD}` : undefined,
      })

      let result: {
        text?: string
        finishReason?: string
        steps: Array<{ text?: string; toolCalls?: unknown[]; toolResults?: unknown[] }>
      }
      result = await completeHeadlessText({
        label: "planner",
        model,
        language,
        sessionID: input.sessionID,
        stopWhen: [stepCountIs(stepLimit)],
        tools: explorationTools,
        maxOutputTokens: 32768,
        timeoutMs: false,
        abortSignal: input.signal,
        system: await plannerSystem(),
        prompt: userPrompt,
        ...(input.stream ?? {}),
      })
      const toolCallCount = result.steps.reduce(
        (sum, s) => {
          const step = s as { toolCalls?: unknown[] }
          return sum + (Array.isArray(step.toolCalls) ? step.toolCalls.length : 0)
        },
        0,
      )
      const toolUsage = summarizeToolUsage(result.steps)
      log.info("planner agent tool usage", {
        attempt: attempt + 1,
        finishReason: result.finishReason,
        stepCount: result.steps.length,
        toolCallCount,
        toolUsage,
      })

      const allText = collectText(result)
      if (!allText.trim()) {
        log.error("planner: primary run produced no final text", {
          steps: result.steps.length,
          finishReason: result.finishReason,
          attempt: attempt + 1,
        })
        throw new Error("planner agent produced no markdown output")
      }

      log.info("planner agent finished via text output", {
        steps: result.steps.length,
        finishReason: result.finishReason,
        textLength: allText.length,
        textPreview: allText.slice(0, 200),
        attempt: attempt + 1,
      })

      let parsed = extractPlannerText(allText)

      // Ensure summary is meaningful (not garbage like "## heading" or empty)
      parsed.summary = ensureMeaningfulSummary(parsed.summary, input.title)

      // Validate plan quality
      const planQuality = validatePlanQuality(parsed, input.request, toolCallCount, input.userGoals?.length ?? 0)
      log.info("planner agent output", {
        subtasks: parsed.subtasks.length,
        waves: parsed.waves?.length ?? 0,
        risks: parsed.risks.length,
        prdLength: parsed.prd.length,
        toolCalls: toolCallCount,
        quality: planQuality,
        attempt: attempt + 1,
      })

      lastQuality = planQuality

      if (planQuality.score >= QUALITY_RETRY_THRESHOLD) {
        return parsed
      }

      if (attempt >= MAX_PLAN_ATTEMPTS - 1) {
        log.error("planner: output quality below threshold", {
          score: planQuality.score,
          threshold: QUALITY_RETRY_THRESHOLD,
          reasons: planQuality.reasons,
          attempt: attempt + 1,
        })
        throw new Error(
          `planner output quality below threshold (${planQuality.score.toFixed(2)} < ${QUALITY_RETRY_THRESHOLD}): ${planQuality.reasons.join("; ") || "unknown quality failure"}`,
        )
      }

      // Quality too low -- retry with feedback
      log.warn("planner: plan quality below threshold, retrying", {
        score: planQuality.score,
        threshold: QUALITY_RETRY_THRESHOLD,
        reasons: planQuality.reasons,
        toolCalls: toolCallCount,
        minToolCalls: MIN_TOOL_CALLS,
      })
      await input.onStatus?.(`Planner retry attempt ${attempt + 2}: ${planQuality.reasons.join("; ")}`)
    }

    throw new Error("planner exhausted retries without producing a valid plan")
  }
}

export { HeadlessPlannerAgent as PlannerAgent }
export const parsePlannerOutput = extractJSON

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Ensure the plan summary is meaningful -- not garbage like "## heading",
 * empty string, or just echoing the first line of the request.
 */
function ensureMeaningfulSummary(summary: string, fallbackTitle: string): string {
  if (!summary) return fallbackTitle
  const trimmed = summary.trim()
  // Reject summaries that look like markdown headings, blank, or too short
  if (trimmed.length < 5) return fallbackTitle
  if (/^#+\s/.test(trimmed)) return fallbackTitle
  // Reject summaries that are just a file path or directory
  if (/^[./\\]/.test(trimmed) && !trimmed.includes(" ")) return fallbackTitle
  return trimmed
}

function extractJSON(text: string): PlannerOutputType {
  let raw = text.trim()

  // Try fenced JSON block (complete or truncated)
  const fencedComplete = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fencedComplete) {
    raw = fencedComplete[1].trim()
  } else {
    // Truncated fenced block: opening ``` but no closing ```
    const fencedOpen = raw.match(/```(?:json)?\s*([\s\S]*)/)
    if (fencedOpen && fencedOpen[1].includes("{")) {
      raw = fencedOpen[1].trim()
    }
  }

  // Try to find a JSON object in the text
  if (!raw.startsWith("{")) {
    // First try complete JSON object
    const match = raw.match(/(\{[\s\S]*\})/)
    if (match) {
      raw = match[1]
    } else {
      // Truncated: find the first { and take everything after
      const idx = raw.indexOf("{")
      if (idx >= 0) raw = raw.slice(idx)
    }
  }

  // Sanitize LLM JSON issues: unescaped backslashes, raw newlines in strings, etc.
  // Must run BEFORE truncation repair since raw control chars confuse the repairer.
  raw = sanitizeJSON(raw)

  // If no closing brace, the JSON is truncated -- try to repair it
  if (raw.startsWith("{") && !raw.endsWith("}")) {
    log.warn("planner: JSON appears truncated, attempting repair", { length: raw.length, tail: raw.slice(-100) })
    raw = repairTruncatedJSON(raw)
  }

  let obj: any
  // Try multiple parse strategies
  const parseErr = tryParse(raw)
  if (parseErr.ok) {
    obj = parseErr.value
  } else {
    // Try more aggressive repair: trim back to last complete JSON value
    const trimmed = trimToLastComplete(raw)
    const retryErr = tryParse(trimmed)
    if (retryErr.ok) {
      log.warn("planner: repaired truncated JSON by trimming", {
        originalLength: raw.length,
        trimmedLength: trimmed.length,
      })
      obj = retryErr.value
    } else {
      log.error("planner: JSON parse failed after all repair attempts", {
        error: String(parseErr.error),
        rawLength: raw.length,
        rawHead: raw.slice(0, 500),
        rawTail: raw.slice(-300),
      })
      throw new Error(`planner output invalid JSON: ${parseErr.error instanceof Error ? parseErr.error.message : String(parseErr.error)}`)
    }
  }

  // Normalize LLM output quirks before strict validation
  if (Array.isArray(obj.subtasks)) {
    // Filter out incomplete subtasks from truncated JSON
    obj.subtasks = obj.subtasks.filter((s: any) => s && typeof s === "object" && s.title)
    for (let i = 0; i < obj.subtasks.length; i++) {
      if (obj.subtasks[i].order == null) obj.subtasks[i].order = i + 1
      if (!obj.subtasks[i].description) obj.subtasks[i].description = obj.subtasks[i].title
    }
  }
  if (!Array.isArray(obj.waves) && Array.isArray(obj.milestones)) {
    obj.waves = obj.milestones
      .filter((item: unknown) => item && typeof item === "object" && !Array.isArray(item))
      .map((item: unknown) => {
        const wave = item as Record<string, unknown>
        return {
          title: wave.title,
          objective: wave.description,
          goal_indices: wave.goal_indices,
        }
      })
  }
  if (Array.isArray(obj.waves)) {
    obj.waves = obj.waves.filter((wave: unknown) => wave && typeof wave === "object" && !Array.isArray(wave))
  }
  if (Array.isArray(obj.assumptions)) {
    obj.assumptions = obj.assumptions.filter((a: any) => a && typeof a === "object" && a.question && a.assumption)
  }

  if (!obj || typeof obj !== "object" || Array.isArray(obj) || Object.keys(obj).length === 0) {
    throw new Error("planner output invalid JSON: parsed object is empty")
  }

  // Fill in missing required fields when the JSON was truncated
  if (!obj.prd) obj.prd = ""
  if (!obj.summary) obj.summary = ""
  if (!Array.isArray(obj.subtasks)) obj.subtasks = []
  if (!Array.isArray(obj.risks)) obj.risks = []
  if (!Array.isArray(obj.waves)) obj.waves = []

  try {
    return PlannerOutput.parse(obj)
  } catch (zodErr) {
    log.error("planner: Zod validation failed", {
      error: String(zodErr),
      subtasksCount: obj.subtasks?.length,
    })
    throw new Error(`planner output failed schema validation: ${zodErr instanceof Error ? zodErr.message : String(zodErr)}`)
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

function extractPlannerText(text: string): PlannerOutputType {
  const raw = text.trim()
  if (!raw) throw new Error("planner output empty")
  if (raw.startsWith("{") || raw.includes("```json")) return extractJSON(raw)

  return normalizePlanOutput(PlannerOutput.parse({
    summary: sectionBody(raw, ["Summary", "摘要"]).split("\n")[0]?.trim() || firstContentLine(raw),
    prd: sectionBody(raw, ["PRD", "Plan", "Implementation Plan", "技术方案", "执行方案"]) || raw,
    waves: parseWaves(sectionBody(raw, ["Waves", "Wave Contracts", "波次", "执行波次", "并行波次"])),
    subtasks: parseSubtasks(sectionBody(raw, ["Subtasks", "Tasks", "执行步骤", "子任务"]) || raw),
    risks: parseListSection(raw, ["Risks", "风险"]),
    assumptions: parseNamedPairs(sectionBody(raw, ["Assumptions", "假设"])),
    clarifications: parseClarifications(sectionBody(raw, ["Clarifications", "Questions", "澄清", "待确认问题"])),
  }))
}

/**
 * Sanitize common LLM JSON output issues:
 * - Unescaped backslashes (e.g., Windows paths: C:\Users)
 * - Real newlines inside JSON string values
 * - Markdown code blocks inside string values
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

function normalizePlanOutput(input: PlannerOutputType): PlannerOutputType {
  return {
    ...input,
    summary: input.summary ?? "",
    prd: input.prd ?? "",
    subtasks: Array.isArray(input.subtasks) ? input.subtasks : [],
    risks: Array.isArray(input.risks) ? input.risks : [],
    assumptions: Array.isArray(input.assumptions) ? input.assumptions : [],
  }
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

function parseClarifications(text: string) {
  return text.split(/\r?\n/).flatMap((line, index) => {
    const value = line.trim().replace(/^[-*•]\s+/, "").replace(/^\d+[.)、]\s+/, "")
    if (!value) return []
    const parts = value.split(/\s+\|\s+/)
    if (parts.length >= 2) {
      return [{
        header: parts[0].trim(),
        question: parts[1].trim(),
        context: parts[2]?.trim() || undefined,
        default_assumption: parts[3]?.trim() || undefined,
      }]
    }
    return [{
      header: `Question ${index + 1}`,
      question: value,
    }]
  })
}

function parseRecordLines(lines: string[]) {
  const record: Record<string, string> = {}
  for (const line of lines) {
    const value = line.trim().replace(/^[-*•]\s+/, "")
    const match = value.match(/^([a-zA-Z_ ]+|目标|路径|产物|依赖|并行度|描述|说明|验证|文件)[:：]\s*(.+)$/)
    if (!match) continue
    record[match[1].trim().toLowerCase()] = match[2].trim()
  }
  return record
}

function splitBlocks(text: string) {
  const lines = text.split(/\r?\n/)
  const blocks: string[][] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const numbered = /^\d+[.)、]\s+/.test(line)
    const bulleted = /^[-*•]\s+/.test(line)
    const current = blocks[blocks.length - 1]
    const currentNumbered = current ? /^\d+[.)、]\s+/.test(current[0] || "") : false
    if (numbered || (bulleted && !currentNumbered)) {
      blocks.push([line])
      continue
    }
    if (blocks.length === 0) {
      blocks.push([line])
      continue
    }
    blocks[blocks.length - 1].push(line)
  }
  return blocks
}

function parseCsv(value: string | undefined) {
  if (!value) return []
  return value
    .split(/[,\n，；;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function parseGoalIndices(value: string | undefined) {
  if (!value) return []
  return [...value.matchAll(/\d+/g)].flatMap((match) => {
    const next = Number.parseInt(match[0], 10)
    return Number.isInteger(next) ? [next] : []
  })
}

function parseSubtasks(text: string) {
  return splitBlocks(text).map((block, index) => {
    const title = block[0].replace(/^[-*•]\s+/, "").replace(/^\d+[.)、]\s+/, "").trim()
    const record = parseRecordLines(block.slice(1))
    const description = [
      record["description"],
      record["描述"],
      record["file"] ? `file: ${record["file"]}` : "",
      record["文件"] ? `file: ${record["文件"]}` : "",
      record["verify"] ? `verify: ${record["verify"]}` : "",
      record["验证"] ? `verify: ${record["验证"]}` : "",
      ...block.slice(1).filter((line) => !/^[a-zA-Z_ ]+[:：]\s*.+$/.test(line) && !/^(目标|路径|产物|依赖|并行度|描述|说明|验证|文件)[:：]\s*.+$/.test(line)),
    ].filter(Boolean).join(" ")
    return {
      title: title || `Task ${index + 1}`,
      description: description || title,
      order: index + 1,
    }
  }).filter((item) => item.title)
}

function parseWaves(text: string) {
  return splitBlocks(text).flatMap((block, index) => {
    const title = block[0].replace(/^[-*•]\s+/, "").replace(/^\d+[.)、]\s+/, "").trim()
    if (!title) return []
    const record = parseRecordLines(block.slice(1))
    return [{
      title,
      objective: record["objective"] || record["description"] || record["说明"] || record["描述"] || undefined,
      goal_indices: parseGoalIndices(record["goals"] || record["goal_indices"] || record["目标"]),
      owned_paths: parseCsv(record["owned_paths"] || record["paths"] || record["路径"]),
      produces: parseCsv(record["produces"] || record["产物"]),
      consumes: parseCsv(record["consumes"] || record["依赖"]),
    }]
  })
}

function firstContentLine(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => !!line && !/^#{1,6}\s+/.test(line))
    || ""
}

/**
 * Attempt to repair truncated JSON from LLM output.
 * When the LLM hits the output token limit, JSON is cut off mid-value.
 * Strategy: close all open strings, arrays, and objects.
 */
function repairTruncatedJSON(raw: string): string {
  let repaired = raw

  // If truncated inside a string, find and close it
  let inString = false
  let escaped = false
  for (let i = 0; i < repaired.length; i++) {
    const ch = repaired[i]
    if (escaped) { escaped = false; continue }
    if (ch === "\\") { escaped = true; continue }
    if (ch === '"') inString = !inString
  }
  if (inString) {
    // Truncated mid-string: find last valid string boundary and trim there
    // Or just close the string
    repaired += '"'
  }

  // Remove trailing partial key-value (e.g., `"key": "partial...` or `"key":`)
  repaired = repaired.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/, "")
  repaired = repaired.replace(/,\s*$/, "")

  // Count and close unclosed brackets
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

  // Remove any trailing comma that's now at the end
  repaired = repaired.replace(/,\s*$/, "")

  // Close remaining brackets/braces in reverse order
  while (stack.length > 0) repaired += stack.pop()

  return repaired
}

/**
 * Trim JSON back to the last complete value, then close all brackets.
 * More aggressive than repairTruncatedJSON — removes partial values entirely.
 */
function trimToLastComplete(raw: string): string {
  // Find positions of all complete value endings (}, ], ", true, false, null, number)
  let lastComplete = -1
  let inString = false
  let escaped = false
  let depth = 0

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (escaped) { escaped = false; continue }
    if (ch === "\\") { escaped = true; continue }
    if (ch === '"') {
      inString = !inString
      if (!inString) lastComplete = i // end of string
      continue
    }
    if (inString) continue
    if (ch === "{" || ch === "[") depth++
    else if (ch === "}" || ch === "]") {
      depth--
      lastComplete = i
    }
  }

  // Trim to last complete value
  if (lastComplete > 0 && lastComplete < raw.length - 1) {
    let trimmed = raw.slice(0, lastComplete + 1)
    // Remove trailing comma
    trimmed = trimmed.replace(/,\s*$/, "")
    // Close remaining brackets
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

/**
 * Validate that the planner output reflects actual codebase exploration,
 * not just echoing the user's request.
 *
 * Scoring (0.0 – 1.0):
 *   - toolCalls >= 5  → +0.3  (agent explored)
 *   - PRD has file paths not in request → +0.25  (discovered new info)
 *   - Subtasks reference file paths → +0.25
 *   - Subtasks include verification language → +0.2
 *   - PRD length > 300 chars → +0.25
 */
function validatePlanQuality(
  plan: PlannerOutputType,
  request: string,
  toolCallCount: number,
  goalCount: number,
): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []

  // 1. Tool call count — did the agent actually explore?
  if (toolCallCount >= 5) {
    score += 0.3
  } else if (toolCallCount >= 2) {
    score += 0.15
    reasons.push(`only ${toolCallCount} tool calls (need ≥5 for deep exploration)`)
  } else {
    reasons.push(`${toolCallCount} tool calls — no codebase exploration`)
  }

  // 2. PRD contains file paths not present in the request
  const FILE_PAT = /(?:[a-zA-Z_@][\w@-]*\/)+[\w.-]+\.(?:ts|tsx|js|jsx|py|rs|go|java|json|yaml|yml|toml|css|html|sql)/g
  const requestPaths = new Set(Array.from(request.matchAll(FILE_PAT)).map((m) => m[0]))
  const prdPaths = new Set(Array.from(plan.prd.matchAll(FILE_PAT)).map((m) => m[0]))
  const newPaths = [...prdPaths].filter((p) => !requestPaths.has(p))
  const greenfieldLayout = requestPaths.size >= 6
  if (newPaths.length >= 2) {
    score += 0.25
  } else if (greenfieldLayout && prdPaths.size >= 4) {
    score += 0.25
  } else if (newPaths.length === 1) {
    score += 0.12
    reasons.push("PRD has only 1 file path beyond the request")
  } else if (greenfieldLayout) {
    reasons.push("PRD does not reference enough concrete file paths for this greenfield file-layout request")
  } else {
    reasons.push("PRD contains no file paths discovered from exploration")
  }

  // 3. Subtasks reference specific file paths
  const subtaskText = plan.subtasks.map((s) => `${s.title} ${s.description}`).join(" ")
  const subtaskPaths = Array.from(subtaskText.matchAll(FILE_PAT))
  if (subtaskPaths.length >= 2) {
    score += 0.25
  } else {
    reasons.push("subtasks don't reference specific file paths")
  }

  // 4. Subtasks should include verification language
  if (/verify|test|check|assert|验证|测试|检查/i.test(subtaskText)) {
    score += 0.2
  } else {
    reasons.push("subtasks lack explicit verification steps")
  }

  // 5. PRD length — detailed specs are longer
  if (plan.prd.length >= 180) {
    score += 0.25
  } else {
    reasons.push(`PRD too short (${plan.prd.length} chars)`)
  }

  if (goalCount >= 4) {
    const waves = Array.isArray(plan.waves)
      ? plan.waves.flatMap((wave) => wave && typeof wave === "object" ? [wave] : [])
      : []
    const explicitCoverage = new Set<number>()
    const waveSizes = waves.map((wave) => Array.isArray(wave.goal_indices) ? wave.goal_indices.length : 0)
    const multiGoalWaves = waveSizes.filter((size) => size > 1).length
    for (const wave of waves) {
      for (const goalIndex of wave.goal_indices) {
        if (Number.isInteger(goalIndex) && goalIndex >= 0 && goalIndex < goalCount) explicitCoverage.add(goalIndex)
      }
    }
    const normalized = normalizePlanWaves({
      waves,
      goals: Array.from({ length: goalCount }, (_, index) => ({ description: `Goal ${index + 1}` })),
    })
    if (waves.length === 0) reasons.push("plan missing stage waves for a multi-goal task")
    if (explicitCoverage.size < goalCount) reasons.push(`waves cover only ${explicitCoverage.size}/${goalCount} goals`)
    if (multiGoalWaves > 0) reasons.push("each wave must contain exactly one goal for iterative execution")
    if (normalized.length < goalCount) reasons.push("plan must provide one iterative wave per goal")
    if (normalized.length > goalCount + 2) reasons.push("plan creates unnecessary extra waves instead of a direct iterative sequence")
    if (reasons.some((reason) => reason.includes("wave") || reason.includes("iterative"))) {
      return {
        score: Math.min(score, 0.49),
        reasons,
      }
    }
  }

  return { score: Math.min(1, score), reasons }
}

/**
 * Resolve a LanguageModelV2 for the planner agent.
 *
 * Strategy:
 * 1. Resolve the default model from Provider
 * 2. Load that exact model and language surface
 * 3. If that fails, surface the planner failure directly
 */
/**
 * 解析 request 中的文件引用，读取文件内容。
 * 支持格式：
 *   - @file:src/foo.ts, @src/foo.ts          （@前缀）
 *   - src/router.ts, ./src/router.ts          （裸路径）
 *   - `src/router.ts`                         （反引号包裹）
 *   - D:/path/to/file.ts                      （绝对路径）
 */
async function resolveFileReferences(
  request: string,
  extraBaseDir?: string,
): Promise<Array<{ ref: string; path: string; content: string }>> {
  const FILE_EXTS = "ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|json|yaml|yml|toml|md|css|html|sql|sh|vue|svelte"
  const refs = new Set<string>()
  let match: RegExpExecArray | null

  // Pattern 1: @file:path or @path (existing)
  const atPattern = /@(?:file:)?([./a-zA-Z][\w./\\-]*\.\w+)/g
  while ((match = atPattern.exec(request)) !== null) refs.add(match[1])

  // Pattern 2: Backtick-wrapped paths — `src/router.ts`
  const btPattern = new RegExp("`([./]?(?:[\\w@-]+[/\\\\])*[\\w.-]+\\.(?:" + FILE_EXTS + "))`", "g")
  while ((match = btPattern.exec(request)) !== null) refs.add(match[1])

  // Pattern 3: Bare relative paths — src/router.ts, ./src/router.ts
  // Must contain at least one slash to avoid false positives on plain words
  const barePattern = new RegExp(
    "(?:^|[\\s,;，；（(])(\\.?(?:[\\w@-]+[/\\\\])+[\\w.-]+\\.(?:" + FILE_EXTS + "))(?=[\\s,;，；）)。:：]|$)",
    "gm",
  )
  while ((match = barePattern.exec(request)) !== null) refs.add(match[1].trim())

  if (refs.size === 0) return []

  // Determine base directories to try
  const baseDirs: string[] = []
  try {
    baseDirs.push(Instance.worktree)
  } catch { /* Instance may not be initialized */ }
  if (extraBaseDir && !baseDirs.includes(extraBaseDir)) baseDirs.push(extraBaseDir)

  // Also extract explicit working directory from request text
  const cwdMatch = request.match(/(?:绝对路径|absolute path)[：:\s]*([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i)
    ?? request.match(/(?:工作目录|working dir(?:ectory)?)[^\n]*?([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i)
  if (cwdMatch) {
    const cwd = cwdMatch[1].replace(/[/\\]+$/, "")
    if (!baseDirs.includes(cwd)) baseDirs.push(cwd)
  }

  if (baseDirs.length === 0) return []

  const results: Array<{ ref: string; path: string; content: string }> = []
  for (const ref of refs) {
    if (path.isAbsolute(ref)) {
      const content = await tryRead(ref)
      if (content) results.push({ ref, path: ref, content })
      continue
    }
    // Try each base directory
    for (const base of baseDirs) {
      const resolved = path.resolve(base, ref)
      const content = await tryRead(resolved)
      if (content) {
        results.push({ ref, path: resolved, content })
        break
      }
    }
  }
  return results
}

async function tryRead(absPath: string): Promise<string | null> {
  try {
    const content = await Filesystem.readText(absPath)
    if (!content) return null
    return content.length > 8000 ? content.slice(0, 8000) + "\n\n... (truncated)" : content
  } catch {
    return null
  }
}

function buildUserPrompt(
  input: {
    title: string
    request: string
    userGoals?: Array<{ description: string; criteria: string; priority?: string }>
    spec?: { summary?: string; content: string }
    replanContext?: ReplanContext
  },
  fileRefs?: Array<{ ref: string; path: string; content: string }>,
  context?: string,
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
        "When a reasonable default keeps the task moving, choose it, document it in assumptions or risk notes, and continue execution.",
        "Only emit clarifications when the request is contradictory or impossible to execute safely without explicit human input.",
      ].join("\n"),
    )
  }

  // If this is a quality retry, inject feedback from the previous attempt
  if (retryContext) {
    sections.push(
      [
        "# QUALITY RETRY - Previous Attempt Was Insufficient",
        "",
        `Your previous plan scored ${retryContext.previousScore.toFixed(2)} / 1.0 (threshold: ${QUALITY_RETRY_THRESHOLD}).`,
        "",
        "**Issues found:**",
        ...retryContext.reasons.map((r) => `- ${r}`),
        "",
        "**You MUST fix these issues this time:**",
        retryContext.reasons.some((r) => r.includes("tool call"))
          ? `- Make at least ${MIN_TOOL_CALLS} tool calls to explore the codebase (list_directory, read_file, search_code)`
          : "",
        retryContext.reasons.some((r) => r.includes("file path"))
          ? "- Include specific file paths discovered from your exploration in PRD and subtasks"
          : "",
        retryContext.reasons.some((r) => r.includes("verification"))
          ? "- Add explicit verification language to subtasks (e.g., 'run bun test src/x.test.ts and confirm it passes')"
          : "",
        retryContext.reasons.some((r) => r.includes("wave") || r.includes("iterative"))
          ? "- Rewrite the plan into a strict iterative sequence with exactly one goal per wave in a single evolving workspace"
          : "",
        retryContext.reasons.some((r) => r.includes("PRD"))
          ? "- Write a detailed PRD with bullet points (>300 chars)"
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    )
  }

  // Include spec-owned goals so the planner can build an execution graph around them.
  if (input.userGoals && input.userGoals.length > 0) {
    sections.push(
      `# Authoritative Goals\n\nThese goals come from the approved specification. Do not redefine them or invent new acceptance goals here. Use them to shape the plan, waves, subtasks, and verification strategy.\n\n${input.userGoals
        .map((g, i) => `${i + 1}. [${g.priority ?? "blocking"}] ${g.description}\n   Criteria: ${g.criteria}`)
        .join("\n")}`,
    )
  }

  if (input.spec?.content) {
    sections.push(
      `# Approved Specification\n\n${input.spec.summary ? `Summary: ${input.spec.summary}\n\n` : ""}${input.spec.content}`,
    )
  }

  // Inject prefetched context (auto-recalled memory + active preferences)
  if (context) {
    sections.push(`# Project Context (Pre-fetched)\n\n${context}`)
  }

  // 将引用的文件内容附加到 prompt 中
  if (fileRefs && fileRefs.length > 0) {
    const refSections = fileRefs.map(
      (f) => `### ${f.ref}\n\`\`\`\n${f.content}\n\`\`\``,
    )
    sections.push(
      `# Referenced Files (Pre-read)\n\n` +
        `These files were extracted from the request and pre-read. Analyze them deeply:\n` +
        `- Identify exact types, classes, methods, and their signatures\n` +
        `- Note coding style, naming conventions, import patterns\n` +
        `- Find test patterns if test files are included\n` +
        `- You still MUST use tools to explore BEYOND these files (imports, usages, related modules)\n\n` +
        refSections.join("\n\n"),
    )
  }

  if (input.replanContext) {
    const ctx = input.replanContext
    sections.push(
      [
        "# Replan Context",
        "",
        "The previous plan FAILED. You must analyze the failure and produce a DIFFERENT strategy.",
        "",
        `## Previous Plan Summary`,
        ctx.previousSummary,
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
        ...(ctx.previousWaves && ctx.previousWaves.length > 0
          ? [
              "",
              `## Previous Wave Structure`,
              "",
              "The previous plan organized goals into these waves. Waves marked **passed** completed successfully — preserve their structure where possible and focus changes on failed/partial waves.",
              "",
              ...ctx.previousWaves.map((wave) =>
                [
                  `### ${wave.title} — **${wave.status}**`,
                  ...wave.goals.map((g) => `  - ${g.description}: ${g.status}`),
                ].join("\n"),
              ),
            ]
          : []),
      ].join("\n"),
    )
  }

  if (fileRefs && fileRefs.length > 0) {
    sections.push(
      "Pre-read files are provided above — analyze them before making tool calls. " +
        "Then use tools to explore related files, dependencies, test patterns, and build/test commands. " +
        "Produce your final answer as plain markdown using the required section headings and iterative stage format.",
    )
  } else {
    sections.push(
      "Now recall memory, check preferences, explore the codebase thoroughly, then produce your final answer as plain markdown using the required section headings and iterative stage format.",
    )
  }
  return sections.join("\n\n")
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const PLANNER_SYSTEM = `You are a senior software architect acting as the planning brain for OpenCorvus. Your job is to explore the codebase deeply, then emit an implementation plan as plain markdown that downstream agents can parse directly.

CRITICAL: You MUST use tools to explore the codebase BEFORE producing any plan. A plan produced without tool calls is ALWAYS rejected. You are scored on exploration depth, concrete file paths, and wave quality.

## Available Tools

- **memory_search**: Search project memory for prior work, patterns, gotchas
- **memory_get**: Read full content of a memory file by ID
- **preference_list**: List active project conventions and constraints (BINDING)
- **read_file**: Read file contents with line numbers
- **find_files**: Find files matching a glob pattern
- **search_code**: Search file contents with regex (ripgrep)
- **list_directory**: List files and directories at a path
- **web_search**: Search the web for external documentation (use only when needed)

## Your Process

### Phase 0: RECALL

1. Search memory with task keywords unless pre-fetched context already covers it.
2. List preferences unless pre-fetched.

### Phase 1: EXPLORE

When a spec is provided: focus on VALIDATION, not re-discovery. The spec already grounded the requirements in the codebase. Use tool calls to verify specific file paths from the spec, discover implementation-level details the spec may have omitted (exact function signatures, import chains, test patterns), and confirm build/test commands. Minimum 3 tool calls.

When NO spec is provided: full discovery mode. Minimum 5 tool calls. Aim for 8-15 for complex tasks.

You must discover:
- Exact files to create or modify
- Existing code patterns and naming conventions
- Build/test/lint commands
- Dependency and import chains
- Existing test patterns

### Phase 2: PLAN

Your plan must be concrete enough that an executor can implement it without guessing.

Use wave contracts as iterative stages in a single evolving workspace:
- Each wave represents the next coding stage; the same agent advances the same workspace forward.
- Every wave must contain exactly one goal.
- Goal N starts only after all previous waves pass.
- Every multi-goal plan must cover every goal exactly once.
- Use 0-based goal indices in the \`goals:\` field.

### Phase 3: OUTPUT

Output plain markdown only. Do not output JSON. Do not call a submit tool.

Use these exact top-level sections in order:
- \`# Summary\`
- \`# PRD\`
- \`# Waves\`
- \`# Subtasks\`
- \`# Risks\`
- \`# Assumptions\`
- \`# Clarifications\`

Required formatting rules:

Under \`# Waves\`, each wave must be a numbered block in this shape:

1. Wave title
- objective: one sentence
- goals: 0
- paths: path/to/file-a.ts, path/to/file-b.ts

Under \`# Subtasks\`, each subtask must be a numbered block in this shape:

1. Subtask title
- description: exact files, changes, and code patterns
- file: path/to/file.ts
- verify: exact command or check

Under \`# PRD\`, write bullet points only. Include files, architectural intent, verification strategy, and any wave-level constraints.

Under \`# Assumptions\`, write one item per line as \`question: assumption\`.

Under \`# Clarifications\`, only emit execution blockers. Format each line as:
- \`header | question | context | default_assumption\`

## Rules

- ALWAYS explore before planning.
- If a recall tool response contains \`RECALL_COMPLETE\`, stop recall immediately.
- Do not spam identical exploration calls.
- Every file path must come from actual tool results or pre-read files.
- Goals are authoritative and must not be redefined.
- Every multi-goal plan must use iterative one-goal-per-wave stages in the same single workspace.
- Write in the same language as the request.
- If replanning, the new strategy must differ from the failed one.
- Do not emit generic advice like "follow best practices". Name files, modules, commands, and concrete changes.
- clarifications are execution blockers only: emit them when the implementation path is genuinely unknowable (e.g., cannot determine which files to modify). Never ask about requirements, acceptance criteria, or scope — those are defined by the spec. Never ask what the user wants to build.

## Quality Self-Check

Before outputting markdown, verify:
1. I made at least 3 tool calls (5+ when no spec was provided).
2. PRD and subtasks reference concrete file paths.
3. Every subtask includes an explicit verification step.
4. Waves cover every goal exactly once for multi-goal tasks.
5. Each wave contains exactly one goal and advances the same workspace forward.
6. I did not create multi-goal waves or speculative future stages.
7. The summary is a real one-line plan summary, not a heading or file path.`

export async function plannerSystem() {
  const config = await Config.get()
  return typeof config.prompt?.planner_system === "string" ? config.prompt.planner_system : PLANNER_SYSTEM
}
