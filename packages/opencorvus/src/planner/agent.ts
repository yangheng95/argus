/**
 * HeadlessPlannerAgent — the orchestrator-owned planning stage that expands a
 * task request into PRD/goals/milestones/subtasks/risks for downstream
 * execution.
 *
 * Capabilities:
 * 1. Memory recall — searches project memory for prior work, patterns, gotchas
 * 2. Preference awareness — respects project conventions and constraints
 * 3. Codebase exploration — reads files, searches code, lists directories
 * 4. Web research — searches external documentation when needed
 * 5. Structured output — PRD, goals, milestones, subtasks, risks, assumptions
 * 6. Replan — receives structured failure analysis and produces alternative strategies
 */
import { generateText, stepCountIs, type LanguageModelV2 } from "ai"
import z from "zod"
import { Provider } from "@/provider/provider"
import { createPlannerTools, prefetchContext } from "./tools"
import { Filesystem } from "@/util/filesystem"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import path from "path"

const log = Log.create({ service: "planner-agent" })

// ---------------------------------------------------------------------------
// Output schema — what the planner agent produces
// ---------------------------------------------------------------------------

export const PlannerOutput = z.object({
  prd: z.string().describe("Expanded PRD with full technical context from codebase exploration"),
  summary: z.string().describe("One-line summary of the plan"),
  goals: z.array(
    z.object({
      description: z.string(),
      criteria: z.string(),
      priority: z.enum(["blocking", "advisory"]),
      check_selector: z.array(z.string()).optional(),
    }),
  ),
  milestones: z
    .array(
      z.object({
        title: z.string(),
        description: z.string().optional(),
        goal_indices: z.array(z.number()),
      }),
    )
    .optional(),
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
}

// ---------------------------------------------------------------------------
// HeadlessPlannerAgent
// ---------------------------------------------------------------------------

const MAX_STEPS = 30
const TIMEOUT_MS = 300_000

export namespace HeadlessPlannerAgent {
  export async function plan(input: {
    title: string
    request: string
    /** User-provided goals — planner should refine/expand, not discard */
    userGoals?: Array<{ description: string; criteria: string; priority?: string }>
    replanContext?: ReplanContext
    /** External abort signal (overrides internal timeout when provided) */
    signal?: AbortSignal
  }): Promise<PlannerOutputType> {
    // Check abort signal early — setup calls (model resolution, memory search) can be slow
    if (input.signal?.aborted) throw new Error("planner aborted before model resolution")

    const language = await agentLanguageModel()
    if (!language) throw new Error("no LLM model available for planner agent")
    if (input.signal?.aborted) throw new Error("planner aborted after model resolution")

    // Extract working directory from request (eval tasks specify it explicitly)
    const cwdMatch =
      input.request.match(/(?:绝对路径|absolute path)[：:\s]*([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i) ??
      input.request.match(/(?:工作目录|working dir(?:ectory)?)[^\n]*?([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i)
    const taskWorkDir = cwdMatch ? cwdMatch[1].replace(/[/\\]+$/, "") : undefined

    // Create tools with the correct working directory for the task.
    // Without this, the codebase tools use Instance.directory (project root)
    // instead of the task's working directory (e.g., eval workspace).
    const tools = createPlannerTools(taskWorkDir)

    const fileRefs = await resolveFileReferences(input.request, taskWorkDir)
    if (input.signal?.aborted) throw new Error("planner aborted before context prefetch")

    const context = prefetchContext(input.title, input.request)
    const userPrompt = buildUserPrompt(input, fileRefs, context)

    log.info("planner agent starting", {
      title: input.title,
      isReplan: !!input.replanContext,
      model: language.modelId,
      prefetchedContext: context.length > 0,
      fileRefsFound: fileRefs.length,
      taskWorkDir,
      toolCount: Object.keys(tools).length,
    })

    const result = await generateText({
      model: language as LanguageModelV2,
      stopWhen: stepCountIs(MAX_STEPS),
      tools,
      maxTokens: 32768,
      abortSignal: input.signal ?? AbortSignal.timeout(TIMEOUT_MS),
      system: PLANNER_SYSTEM,
      prompt: userPrompt,
    })

    // Collect text from all steps — the model may output JSON across multiple steps
    // Try result.text first, then concatenate all step texts
    let allText = result.text?.trim() || ""
    if (!allText || !allText.includes("{")) {
      allText = result.steps.map((s) => s.text).filter(Boolean).join("\n")
    }

    log.info("planner agent finished", {
      steps: result.steps.length,
      finishReason: result.finishReason,
      textLength: allText.length,
      textPreview: allText.slice(0, 200),
    })

    // Count actual tool calls — a plan without exploration is worthless
    const toolCallCount = result.steps.reduce(
      (sum, s) => sum + (Array.isArray((s as any).toolCalls) ? (s as any).toolCalls.length : 0),
      0,
    )

    // Extract JSON from collected text
    let parsed = extractJSON(allText)

    // If JSON was truncated and critical fields are thin, synthesize from exploration + request
    if (parsed.prd.length < 100 || parsed.subtasks.length < 2) {
      log.warn("planner: plan seems truncated, synthesizing from exploration", {
        prdLength: parsed.prd.length,
        subtasksCount: parsed.subtasks.length,
      })
      parsed = synthesizeFromExploration(parsed, input, result.steps)
    }

    // Validate plan quality: the plan should contain file paths discovered
    // from exploration, not just echo the original request.
    const planQuality = validatePlanQuality(parsed, input.request, toolCallCount)
    log.info("planner agent output", {
      goals: parsed.goals.length,
      subtasks: parsed.subtasks.length,
      milestones: parsed.milestones?.length ?? 0,
      risks: parsed.risks.length,
      prdLength: parsed.prd.length,
      toolCalls: toolCallCount,
      quality: planQuality,
    })

    if (planQuality.score < 0.3) {
      log.warn("planner: plan quality is very low — likely echoing request without exploration", {
        ...planQuality,
      })
    }

    return parsed
  }
}

// Backwards-compatible alias during the architecture transition.
export import PlannerAgent = HeadlessPlannerAgent

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function extractJSON(text: string): PlannerOutputType {
  let raw = text.trim()

  // Try fenced JSON block
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) raw = fenced[1].trim()

  // Try to find a JSON object in the text
  if (!raw.startsWith("{")) {
    const match = raw.match(/(\{[\s\S]*\})/)
    if (match) raw = match[1]
  }

  // If no closing brace, the JSON is truncated — try to repair it
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
      // Log the raw text for debugging
      log.error("planner: JSON parse failed after all repair attempts", {
        error: String(parseErr.error),
        rawLength: raw.length,
        rawHead: raw.slice(0, 500),
        rawTail: raw.slice(-300),
      })
      throw parseErr.error
    }
  }

  // Normalize LLM output quirks before strict validation
  if (Array.isArray(obj.goals)) {
    for (const g of obj.goals) {
      if (g.priority && g.priority !== "blocking" && g.priority !== "advisory") {
        g.priority = "advisory"
      }
    }
  }
  if (Array.isArray(obj.subtasks)) {
    for (let i = 0; i < obj.subtasks.length; i++) {
      if (obj.subtasks[i].order == null) obj.subtasks[i].order = i + 1
    }
  }

  // Fill in missing required fields when the JSON was truncated
  if (!obj.prd) obj.prd = ""
  if (!obj.summary) obj.summary = ""
  if (!Array.isArray(obj.goals)) obj.goals = []
  if (!Array.isArray(obj.subtasks)) obj.subtasks = []
  if (!Array.isArray(obj.risks)) obj.risks = []

  return PlannerOutput.parse(obj)
}

function tryParse(text: string): { ok: true; value: any } | { ok: false; error: Error } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (err) {
    return { ok: false, error: err as Error }
  }
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
 * Synthesize a complete plan from partial LLM output + tool exploration results + user request.
 * Called when the LLM's JSON output was truncated and critical fields are missing/incomplete.
 */
function synthesizeFromExploration(
  partial: PlannerOutputType,
  input: { title: string; request: string },
  steps: any[],
): PlannerOutputType {
  const result = { ...partial }

  // Collect file paths discovered during exploration
  const discoveredFiles = new Set<string>()
  const explorationNotes: string[] = []
  for (const step of steps) {
    if (!step.toolCalls) continue
    for (let i = 0; i < step.toolCalls.length; i++) {
      const call = step.toolCalls[i]
      if (call.toolName === "read_file" && call.args?.path) {
        discoveredFiles.add(call.args.path)
      }
      if (call.toolName === "list_directory" && call.args?.path) {
        discoveredFiles.add(call.args.path + "/")
      }
      // Collect tool result summaries for PRD synthesis
      const toolResult = step.toolResults?.[i]
      if (toolResult?.result && typeof toolResult.result === "string") {
        const preview = toolResult.result.slice(0, 200)
        if (call.toolName === "read_file") {
          explorationNotes.push(`Read ${call.args.path}: ${preview}`)
        } else if (call.toolName === "search_code") {
          explorationNotes.push(`Search "${call.args.pattern}": ${preview}`)
        }
      }
    }
  }

  // Extract requirements from request text for subtask synthesis
  const requirements: string[] = []
  const CN_ACTION = /^(?:添加|修改|删除|创建|导出|导入|确保|实现|重构|优化|移除|更新|替换|支持|使用)/
  const EN_ACTION = /^(?:add|create|modify|delete|remove|implement|ensure|replace|fix|refactor|export|import)\s/i
  for (const line of input.request.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.length < 4) continue
    if (/^[-*•]\s+/.test(trimmed)) requirements.push(trimmed.replace(/^[-*•]\s+/, ""))
    else if (/^\d+[.、)）]\s+/.test(trimmed)) requirements.push(trimmed.replace(/^\d+[.、)）]\s+/, ""))
    else if (CN_ACTION.test(trimmed) || EN_ACTION.test(trimmed)) requirements.push(trimmed)
  }

  // Extract file references from request
  const FILE_EXTS = "ts|tsx|js|jsx|py|rs|go|java|json|yaml|yml|toml|md|css|html|sql"
  const fileRefs = new Set<string>()
  const btPat = new RegExp("`([./]?(?:[\\w@-]+[/\\\\])*[\\w.-]+\\.(?:" + FILE_EXTS + "))`", "g")
  let m: RegExpExecArray | null
  while ((m = btPat.exec(input.request)) !== null) fileRefs.add(m[1])
  const barePat = new RegExp(
    "(?:^|[\\s,;，；（(])(\\.?(?:[\\w@-]+[/\\\\])+[\\w.-]+\\.(?:" + FILE_EXTS + "))(?=[\\s,;，；）)。:：]|$)", "gm",
  )
  while ((m = barePat.exec(input.request)) !== null) fileRefs.add(m[1].trim())

  // Synthesize PRD if too short
  if (result.prd.length < 200) {
    const prdParts: string[] = []
    if (fileRefs.size > 0) prdParts.push(`**Files**: ${Array.from(fileRefs).join(", ")}`)
    if (discoveredFiles.size > 0) {
      const relevant = Array.from(discoveredFiles).filter(f => !f.endsWith("/")).slice(0, 10)
      if (relevant.length > 0) prdParts.push(`**Explored**: ${relevant.join(", ")}`)
    }
    if (requirements.length > 0) {
      prdParts.push(`**Requirements**:\n${requirements.map(r => `- ${r}`).join("\n")}`)
    }
    if (explorationNotes.length > 0) {
      prdParts.push(`**Exploration Notes**:\n${explorationNotes.slice(0, 5).map(n => `- ${n}`).join("\n")}`)
    }
    // Prepend any partial PRD content we already have
    const existingPrd = result.prd.trim()
    result.prd = existingPrd
      ? existingPrd + "\n\n" + prdParts.join("\n\n")
      : prdParts.join("\n\n")
  }

  // Synthesize subtasks from requirements if missing
  if (result.subtasks.length < 2 && requirements.length > 0) {
    const files = Array.from(fileRefs)
    const synthSubtasks = []
    if (files.length > 0) {
      synthSubtasks.push({
        title: `Analyze ${files.slice(0, 3).join(", ")}`,
        description: `Read and understand the source files: ${files.join(", ")}. Identify types, exports, and patterns.`,
        order: 1,
      })
    }
    for (let i = 0; i < requirements.length; i++) {
      synthSubtasks.push({
        title: requirements[i].slice(0, 80),
        description: requirements[i],
        order: (files.length > 0 ? 2 : 1) + i,
      })
    }
    synthSubtasks.push({
      title: "Verify changes",
      description: "Run build, test, and lint checks to ensure all changes work correctly.",
      order: synthSubtasks.length + 1,
    })
    // Merge: keep any existing subtasks, add synthesized ones for gaps
    if (result.subtasks.length === 0) {
      result.subtasks = synthSubtasks
    } else {
      // Keep existing, add verification if missing
      const hasVerify = result.subtasks.some(s => /verify|test|check|验证|测试/.test(s.title.toLowerCase()))
      if (!hasVerify) {
        result.subtasks.push(synthSubtasks[synthSubtasks.length - 1])
      }
    }
  }

  // Synthesize goals if missing
  if (result.goals.length === 0) {
    const goals: PlannerOutputType["goals"] = []
    if (fileRefs.size > 0) {
      goals.push({
        description: "TypeScript compilation succeeds",
        criteria: "`bunx tsc --noEmit` exits 0",
        priority: "blocking",
        check_selector: ["build"],
      })
    }
    const testFiles = Array.from(fileRefs).filter(f => f.includes("test"))
    if (testFiles.length > 0) {
      goals.push({
        description: `Tests pass: ${testFiles.join(", ")}`,
        criteria: `\`bun test ${testFiles.join(" ")}\` passes all assertions`,
        priority: "blocking",
        check_selector: ["test"],
      })
    }
    if (goals.length > 0) result.goals = goals
  }

  // Ensure summary
  if (!result.summary || result.summary.length < 10) {
    result.summary = input.title
  }

  log.info("planner: synthesized plan from exploration", {
    prdLength: result.prd.length,
    subtasks: result.subtasks.length,
    goals: result.goals.length,
    discoveredFiles: discoveredFiles.size,
    requirements: requirements.length,
  })

  return result
}

/**
 * Validate that the planner output reflects actual codebase exploration,
 * not just echoing the user's request.
 *
 * Scoring (0.0 – 1.0):
 *   - toolCalls >= 5  → +0.3  (agent explored)
 *   - PRD has file paths not in request → +0.25  (discovered new info)
 *   - Goals have concrete criteria (commands) → +0.2
 *   - Subtasks reference file paths → +0.15
 *   - PRD length > 300 chars → +0.1
 */
function validatePlanQuality(
  plan: PlannerOutputType,
  request: string,
  toolCallCount: number,
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
  if (newPaths.length >= 2) {
    score += 0.25
  } else if (newPaths.length === 1) {
    score += 0.12
    reasons.push("PRD has only 1 file path beyond the request")
  } else {
    reasons.push("PRD contains no file paths discovered from exploration")
  }

  // 3. Goals have concrete criteria (contain command-like patterns)
  const CMD_PAT = /`[^`]+`|bun |tsc |npm |npx |bunx |eslint |jest /i
  const goalsWithCriteria = plan.goals.filter((g) => CMD_PAT.test(g.criteria))
  if (goalsWithCriteria.length >= plan.goals.length * 0.5 && plan.goals.length > 0) {
    score += 0.2
  } else {
    reasons.push("goals lack concrete/executable criteria")
  }

  // 4. Subtasks reference specific file paths
  const subtaskText = plan.subtasks.map((s) => `${s.title} ${s.description}`).join(" ")
  const subtaskPaths = Array.from(subtaskText.matchAll(FILE_PAT))
  if (subtaskPaths.length >= 2) {
    score += 0.15
  } else {
    reasons.push("subtasks don't reference specific file paths")
  }

  // 5. PRD length — detailed specs are longer
  if (plan.prd.length >= 300) {
    score += 0.1
  } else {
    reasons.push(`PRD too short (${plan.prd.length} chars)`)
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
async function agentLanguageModel(): Promise<LanguageModelV2 | undefined> {
  const def = await Provider.defaultModel().catch((err) => {
    log.error("planner: Provider.defaultModel() failed", { error: String(err) })
    return undefined
  })
  if (!def) return undefined
  log.info("planner: default model resolved", { providerID: def.providerID, modelID: def.modelID })
  const model = await Provider.getModel(def.providerID, def.modelID)
  const language = await Provider.getLanguage(model)
  log.info("planner: model ready via Provider", { modelId: language.modelId })
  return language
}

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
    replanContext?: ReplanContext
  },
  fileRefs?: Array<{ ref: string; path: string; content: string }>,
  context?: string,
): string {
  const sections = [`# Task\n\nTitle: ${input.title}\n\nRequest:\n${input.request}`]

  // Include user-provided goals so the planner can refine and expand them
  if (input.userGoals && input.userGoals.length > 0) {
    sections.push(
      `# User-Provided Goals\n\nThe user specified these goals. Incorporate them into your plan, refine their criteria to be more specific, and add any missing goals discovered during codebase exploration.\n\n${input.userGoals
        .map((g, i) => `${i + 1}. [${g.priority ?? "blocking"}] ${g.description}\n   Criteria: ${g.criteria}`)
        .join("\n")}`,
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
      ].join("\n"),
    )
  }

  if (fileRefs && fileRefs.length > 0) {
    sections.push(
      "Pre-read files are provided above — analyze them before making tool calls. " +
        "Then use tools to explore related files, dependencies, test patterns, and build/test commands. " +
        "Produce your plan as a JSON object.",
    )
  } else {
    sections.push(
      "Now recall memory, check preferences, explore the codebase thoroughly, then produce your plan as a JSON object.",
    )
  }
  return sections.join("\n\n")
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const PLANNER_SYSTEM = `You are a senior software architect acting as the planning brain for OpenCorvus, an autonomous coding orchestrator. Your job is to explore the codebase deeply, then produce a plan so detailed and specific that an executor agent can implement it without guessing.

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

### Phase 0: RECALL (1-3 tool calls)

1. **Search memory** (memory_search) with task keywords. If pre-fetched memory exists, only search for gaps.
2. **List preferences** (preference_list) unless pre-fetched. Preferences are BINDING.

### Phase 1: EXPLORE (5-10 tool calls — this is the MOST IMPORTANT phase)

You MUST explore the codebase thoroughly. A plan without specific file paths is worthless.

1. **list_directory** on project root → understand top-level layout
2. **read_file** on package.json / tsconfig.json / build config → tech stack, scripts, build commands
3. **search_code** for key types, functions, interfaces mentioned in the request → find exact locations
4. **read_file** on 3-5 files directly related to the task → understand existing patterns, APIs, conventions
5. **find_files** to discover test files, related modules, config files in the affected area
6. **search_code** for imports/usages of code you'll modify → understand dependency chain

After exploration, you should know:
- The EXACT file paths to create or modify
- The existing code patterns and naming conventions to follow
- The build/test/lint commands and how to verify your changes
- What other code depends on what you'll change

### Phase 1.5: RESEARCH (if needed)

For external APIs, unfamiliar libraries, or protocols — use web_search. Skip for internal-only tasks.

### Phase 2: PLAN — Synthesize into Actionable Spec

Your output must be CONCRETE, not abstract. Reference specific files, functions, and commands.

**Goals** — DETAILED descriptions of what to achieve. Each goal must include:
- A clear description explaining the specific outcome (not just "tests pass" — say WHICH functionality must work and HOW)
- Machine-verifiable criteria with exact commands AND expected outcomes
- Relevant check_selectors
- Example GOOD goal: {"description": "Router 中间件链按洋葱模型执行：每个中间件依次调用 next()，handler 在最内层执行，中间件可以在 next() 前后执行逻辑，也可以短路直接返回 Response", "criteria": "bun test src/middleware.test.ts 通过，验证 before→handler→after 执行顺序正确", "priority": "blocking", "check_selector": ["test"]}
- Example BAD goal: {"description": "中间件测试通过", "criteria": "bun test exits 0"} — too vague!

**Subtasks** — Ordered steps: WHAT to change, WHERE (file path), HOW to verify
**PRD** — Bullet-point spec: files to modify, changes, patterns to follow, verification commands.

### Phase 3: OUTPUT as JSON

Respond with ONLY a JSON object. **CRITICAL**: Output fields in EXACTLY this order — summary and goals FIRST, prd LAST. This protects critical fields from truncation.

Keep PRD concise (bullet points, ≤ 2000 chars). Goals and subtasks should be DETAILED — do not sacrifice clarity for brevity.

{
  "summary": "One-line summary of the plan",
  "goals": [
    {
      "description": "Detailed description of what to achieve — explain the specific outcome, not just a command",
      "criteria": "Exact command + expected outcome (e.g., 'bun test src/foo.test.ts 通过所有断言')",
      "priority": "blocking",
      "check_selector": ["build", "test"]
    }
  ],
  "subtasks": [
    {
      "title": "Short title",
      "description": "Implementation details: which file to modify, what to add/change, which pattern to follow, how to verify",
      "order": 1
    }
  ],
  "risks": ["Specific risk with mitigation"],
  "milestones": [
    {
      "title": "Milestone name",
      "goal_indices": [0, 1]
    }
  ],
  "assumptions": [
    {
      "question": "Ambiguous aspect",
      "assumption": "What we will assume"
    }
  ],
  "prd": "Technical spec with bullet points: files to modify, exact changes, patterns to follow, verification commands. ≤ 2000 chars."
}

## Rules

- ALWAYS explore the codebase before planning. No exceptions.
- Every file path in your plan MUST come from actual tool results or pre-read files — never guess paths.
- goals.criteria must be executable commands with expected outcomes, not vague statements.
- goals.check_selector maps to: build, test, lint, verify_cmd, startup, ui_review, code_quality, code_review, dead_code_review, judge
- Every blocking goal MUST have at least one check_selector.
- subtask descriptions must reference specific files, functions, and patterns discovered during exploration.
- Write in the same language as the request (Chinese request → Chinese plan).
- If replanning: your new plan MUST differ from the previous failed approach.
- The prd field must be detailed enough that an executor agent can implement everything without further exploration.
- After finishing tool calls, output JSON immediately.
- Do NOT produce generic advice like "follow best practices" or "handle edge cases" — be specific about WHICH practices and WHICH edge cases.

## Quality Self-Check

Before outputting JSON, verify:
1. Does EVERY goal have a detailed description explaining the specific outcome? (not just "tests pass")
2. Does every goal criteria include an exact command AND expected outcome?
3. Do subtasks reference specific files, functions, and patterns?
4. Is the PRD concise but complete (bullet points, not paragraphs)?

If any answer is NO, go back and fill the gap.

## Output Format

- PRD: Use bullet points, keep under 2000 chars.
- Goals: Be DETAILED in description and criteria. Goals are the most important output.
- Subtasks: Include file paths and verification steps.
- Output fields in the order shown above (summary → goals → subtasks → ... → prd).`
