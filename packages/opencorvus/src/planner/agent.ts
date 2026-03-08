/**
 * PlannerAgent — A full-featured planning agent that mirrors the upstream
 * opencode plan skill workflow.
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
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { Provider } from "@/provider/provider"
import { Config } from "@/config/config"
import { Env } from "@/env"
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
// PlannerAgent
// ---------------------------------------------------------------------------

const MAX_STEPS = 30
const TIMEOUT_MS = 300_000

export namespace PlannerAgent {
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
      maxTokens: 16384,
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

    // Extract JSON from collected text
    const parsed = extractJSON(allText)

    log.info("planner agent output", {
      goals: parsed.goals.length,
      subtasks: parsed.subtasks.length,
      milestones: parsed.milestones?.length ?? 0,
      risks: parsed.risks.length,
      prdLength: parsed.prd.length,
    })

    return parsed
  }
}

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
 * Resolve a LanguageModelV2 for the planner agent.
 *
 * Strategy:
 * 1. Try Provider system (respects config, auth, models.dev database)
 * 2. If Provider fails (stale models.dev cache, missing model ID), fall back to
 *    direct model creation using config's baseURL + API key.
 * 3. Last resort: env var API keys with hardcoded provider defaults.
 */
async function agentLanguageModel(): Promise<LanguageModelV2 | undefined> {
  // --- Path 1: Provider system (best case) ---
  const def = await Provider.defaultModel().catch((err) => {
    log.warn("planner: Provider.defaultModel() failed", { error: String(err) })
    return undefined
  })
  if (def) {
    log.info("planner: default model resolved", { providerID: def.providerID, modelID: def.modelID })
    try {
      const model = await Provider.getModel(def.providerID, def.modelID)
      const language = await Provider.getLanguage(model)
      log.info("planner: model ready via Provider", { modelId: language.modelId })
      return language
    } catch (err) {
      log.warn("planner: Provider.getModel/getLanguage failed for default — trying direct fallback", {
        providerID: def.providerID,
        modelID: def.modelID,
        error: String(err),
      })
    }

    // --- Path 2: Direct model creation (bypasses stale models.dev cache) ---
    // The model is configured but not in the models database. Create it directly
    // using the provider's baseURL and API key from config/env.
    const directModel = await createDirectModel(def.providerID, def.modelID)
    if (directModel) return directModel
  }

  // --- Path 3: Env var fallbacks ---
  const dashscopeKey = getDashscopeKey()
  if (dashscopeKey) {
    log.info("planner: trying DashScope env fallback")
    try {
      const model = await Provider.getModel("alibaba-cn", "qwen3.5-plus")
      return await Provider.getLanguage(model)
    } catch {
      // Provider doesn't have the model — create directly
      return createDirectDashscope(dashscopeKey, "qwen3.5-plus")
    }
  }

  if (process.env.DEEPSEEK_API_KEY) {
    log.info("planner: trying DeepSeek env fallback")
    try {
      const model = await Provider.getModel("deepseek", "deepseek-chat")
      return await Provider.getLanguage(model)
    } catch {
      return undefined
    }
  }

  if (process.env.MOONSHOT_API_KEY) {
    log.info("planner: trying Moonshot env fallback")
    try {
      const model =
        (await Provider.getModel("moonshotai-cn", "kimi-k2.5").catch(() => undefined)) ??
        (await Provider.getModel("moonshotai", "kimi-k2.5").catch(() => undefined))
      if (model) return await Provider.getLanguage(model)
    } catch {
      return undefined
    }
  }

  log.error("planner: NO model available — no default model, no API keys")
  return undefined
}

/** Get DashScope API key from Instance-scoped env or process.env */
function getDashscopeKey(): string | undefined {
  try {
    return Env.get("DASHSCOPE_API_KEY") || process.env.DASHSCOPE_API_KEY || process.env.CODING_DASHSCOPE_API_KEY
  } catch {
    return process.env.DASHSCOPE_API_KEY || process.env.CODING_DASHSCOPE_API_KEY
  }
}

/**
 * Create a LanguageModelV2 directly, bypassing the Provider models database.
 * Used when the model exists in config but not in the stale models.dev cache.
 */
async function createDirectModel(providerID: string, modelID: string): Promise<LanguageModelV2 | undefined> {
  try {
    const config = await Config.get()
    const providerConfig = config.provider?.[providerID]
    const baseURL = providerConfig?.options?.baseURL as string | undefined

    // Get the API key from Provider (it might have loaded from auth.json)
    const provider = await Provider.getProvider(providerID)
    const apiKey = provider?.key

    if (!apiKey) {
      // Try env vars
      if (providerID === "alibaba-cn" || providerID === "alibaba") {
        const key = getDashscopeKey()
        if (key) return createDirectDashscope(key, modelID, baseURL)
      }
      log.warn("planner: no API key for direct model creation", { providerID, modelID })
      return undefined
    }

    const url = baseURL ?? provider?.options?.baseURL as string | undefined
    log.info("planner: creating direct model (bypassing models.dev cache)", {
      providerID,
      modelID,
      baseURL: url,
    })

    const sdk = createOpenAICompatible({
      name: providerID,
      baseURL: url ?? `https://api.${providerID}.com/v1`,
      apiKey,
    })
    return sdk.languageModel(modelID)
  } catch (err) {
    log.warn("planner: direct model creation failed", { providerID, modelID, error: String(err) })
    return undefined
  }
}

/** Create a DashScope model directly with known configuration */
function createDirectDashscope(apiKey: string, modelID: string, baseURL?: string): LanguageModelV2 {
  log.info("planner: creating direct DashScope model", { modelID, baseURL })
  const sdk = createOpenAICompatible({
    name: "alibaba-cn",
    baseURL: baseURL ?? "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey,
  })
  return sdk.languageModel(modelID)
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

Your output must be CONCRETE, not abstract. Every item must reference specific files, functions, or commands from your exploration.

**PRD** — Write a detailed technical specification:
- List every file to create/modify with full paths (e.g., "Create \`src/utils/parser.ts\`", "Modify \`src/handler.ts\` lines 45-60")
- Describe the exact changes: what to add, what to modify, what to remove
- Reference existing patterns by file path (e.g., "Follow the pattern in \`src/utils/validator.ts:validateInput()\`")
- Note dependencies: imports to add, types to extend, tests to update
- Include build/test commands to verify (e.g., "\`bun test test/parser.test.ts\`", "\`bunx tsc --noEmit\`")

**Goals** — Each with machine-verifiable criteria:
- BAD: "Code compiles successfully" → GOOD: "\`bunx tsc --noEmit\` exits with code 0"
- BAD: "Tests pass" → GOOD: "\`bun test test/parser.test.ts\` passes all assertions"
- BAD: "Feature works" → GOOD: "GET /api/parse?q=test returns 200 with {result: 'test'}"

**Subtasks** — Ordered execution steps with implementation details:
- BAD: "Implement the parser" → GOOD: "Create \`src/utils/parser.ts\` exporting \`parseQuery(input: string): ParseResult\`. Use the tokenizer pattern from \`src/utils/lexer.ts:tokenize()\`. Handle edge cases: empty input (return empty result), malformed input (throw ParseError). Add JSDoc matching the style in \`src/utils/validator.ts\`."
- Each subtask should tell the executor WHAT to do, WHERE to do it, and HOW to verify it
- Include verification commands for each subtask, not just at the end

### Phase 3: OUTPUT as JSON

Respond with ONLY a JSON object:

{
  "prd": "Detailed technical spec with exact file paths, code patterns, and verification commands...",
  "summary": "One-line summary",
  "goals": [
    {
      "description": "What to achieve",
      "criteria": "Machine-verifiable criterion (exact command + expected outcome)",
      "priority": "blocking",
      "check_selector": ["build", "test"]
    }
  ],
  "milestones": [
    {
      "title": "Milestone name",
      "description": "What this milestone covers",
      "goal_indices": [0, 1]
    }
  ],
  "subtasks": [
    {
      "title": "Short title",
      "description": "Detailed implementation instructions: which file to modify, what to add/change, which pattern to follow, how to verify",
      "order": 1
    }
  ],
  "risks": ["Specific risk with mitigation"],
  "assumptions": [
    {
      "question": "Ambiguous aspect",
      "assumption": "What we will assume and why"
    }
  ],
  "clarifications": []
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

## Quality Self-Check (before outputting JSON)

Before producing your final JSON, verify:
1. Does the PRD reference SPECIFIC file paths, function names, and line ranges? (not generic "the source file")
2. Does every subtask say WHAT to change, WHERE (exact file), and HOW to verify?
3. Are test files and test commands explicitly listed?
4. If pre-read files were provided, did you analyze their structure (types, exports, methods)?
5. Would an executor be able to implement this plan WITHOUT asking any questions?

If any answer is NO, go back and make one more exploration tool call to fill the gap.`
