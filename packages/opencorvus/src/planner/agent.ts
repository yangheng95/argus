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
import { streamText, stepCountIs } from "ai"
import type { LanguageModelV2 } from "@ai-sdk/provider"
import z from "zod"
import { Provider } from "@/provider/provider"
import { createPlannerTools, prefetchContext } from "./tools"
import { Filesystem } from "@/util/filesystem"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { parsePlanText } from "./parse-plan-text"
import { OrchestratorConfig } from "@/orchestrator/config"
import path from "path"
import PLAN_CORE from "@/prompt/core/plan-core.txt"

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
      check_selector: z.array(z.string()).default(["build", "test"]),
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

export interface WaveStatus {
  title: string
  waveIndex: number
  status: "passed" | "failed" | "partial" | "pending"
  goals: Array<{
    description: string
    status: string
  }>
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
    requirement_ids?: string[]
  }>
  failedRequirements?: Array<{
    id: string
    title: string
    reason: string
  }>
  previousWaves?: WaveStatus[]
}

// ---------------------------------------------------------------------------
// HeadlessPlannerAgent
// ---------------------------------------------------------------------------

// 默认值来自 OrchestratorConfig.defaults.planner，仅用于函数签名默认参数
const { planner: PLANNER_DEFAULTS } = OrchestratorConfig.defaults

export namespace HeadlessPlannerAgent {
  export async function plan(input: {
    title: string
    request: string
    /** User-provided goals -- planner should refine/expand, not discard */
    userGoals?: Array<{ description: string; criteria: string; priority?: string }>
    spec?: { summary?: string; content: string }
    replanContext?: ReplanContext
    /** External abort signal (overrides internal timeout when provided) */
    signal?: AbortSignal
    /** Stream hooks for onChunk/onError — routes AI SDK events to the caller */
    stream?: import("@/llm/api").TextHooks
  }): Promise<PlannerOutputType> {
    // Check abort signal early -- setup calls (model resolution, memory search) can be slow
    if (input.signal?.aborted) throw new Error("planner aborted before model resolution")

    const orchCfg = await OrchestratorConfig.get()
    const { max_steps: MAX_STEPS, timeout_ms: TIMEOUT_MS, min_tool_calls: MIN_TOOL_CALLS, quality_threshold: QUALITY_RETRY_THRESHOLD, max_attempts: MAX_PLAN_ATTEMPTS } = orchCfg.planner

    const resolved = await agentLanguageModel()
    if (!resolved) throw new Error("no LLM model available for planner agent")
    const { language, model } = resolved
    if (input.signal?.aborted) throw new Error("planner aborted after model resolution")

    // Extract working directory from request (eval tasks specify it explicitly)
    const cwdMatch =
      input.request.match(/(?:绝对路径|absolute path)[：:\s]*([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i) ??
      input.request.match(/(?:工作目录|working dir(?:ectory)?)[^\n]*?([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i)
    const taskWorkDir = cwdMatch ? cwdMatch[1].replace(/[/\\]+$/, "") : undefined

    // Create tools with the correct working directory for the task.
    // Without this, the codebase tools use Instance.directory (project root)
    // instead of the task's working directory (e.g., eval workspace).
    const providerWebSearch = await Provider.getWebSearchTool(model).catch(() => undefined)
    const allTools = createPlannerTools(taskWorkDir, { providerWebSearch })

    const fileRefs = await resolveFileReferences(input.request, taskWorkDir)
    if (input.signal?.aborted) throw new Error("planner aborted before context prefetch")

    const context = prefetchContext(input.title, input.request)

    // Quality-gated retry loop: if the first plan attempt scores below
    // QUALITY_RETRY_THRESHOLD, retry once with enhanced prompt that includes
    // quality feedback from the previous attempt.
    let lastParsed: PlannerOutputType | undefined
    let lastQuality: { score: number; reasons: string[] } | undefined

    for (let attempt = 0; attempt < MAX_PLAN_ATTEMPTS; attempt++) {
      if (input.signal?.aborted) throw new Error("planner aborted before attempt " + (attempt + 1))

      const retryContext = attempt > 0 && lastQuality
        ? { previousScore: lastQuality.score, reasons: lastQuality.reasons, attempt }
        : undefined
      const userPrompt = buildUserPrompt(input, fileRefs, context, retryContext, MIN_TOOL_CALLS, QUALITY_RETRY_THRESHOLD)

      log.info("planner agent starting", {
        title: input.title,
        isReplan: !!input.replanContext,
        model: language.modelId,
        prefetchedContext: context.length > 0,
        fileRefsFound: fileRefs.length,
        taskWorkDir,
        toolCount: Object.keys(allTools).length,
        attempt: attempt + 1,
        config: orchCfg.planner,
        retryReason: retryContext ? `score ${retryContext.previousScore} < ${QUALITY_RETRY_THRESHOLD}` : undefined,
      })

      const stream = streamText({
        model: language,
        stopWhen: stepCountIs(MAX_STEPS),
        tools: allTools,
        maxOutputTokens: 32768,
        abortSignal: input.signal ?? AbortSignal.timeout(TIMEOUT_MS),
        system: PLANNER_SYSTEM(MIN_TOOL_CALLS),
        prompt: userPrompt,
        ...(input.stream?.onChunk ? { onChunk: input.stream.onChunk as any } : {}),
        ...(input.stream?.onError ? { onError: input.stream.onError } : {}),
      })

      const [resultText, resultSteps, resultFinishReason] = await Promise.all([
        stream.text,
        stream.steps,
        stream.finishReason,
      ])

      // Count actual tool calls
      const toolCallCount = resultSteps.reduce(
        (sum, s) => sum + (Array.isArray((s as any).toolCalls) ? (s as any).toolCalls.length : 0),
        0,
      )

      // Collect all text output across steps
      let allText = resultText?.trim() || ""
      if (!allText) {
        allText = resultSteps.map((s) => s.text).filter(Boolean).join("\n")
      }

      log.info("planner agent finished", {
        steps: resultSteps.length,
        finishReason: resultFinishReason,
        textLength: allText.length,
        toolCalls: toolCallCount,
        attempt: attempt + 1,
      })

      // Parse structured sections from text output
      let parsed: PlannerOutputType = parsePlanText(allText)

      // Log if plan seems truncated — no fallback synthesis, force retry instead
      if (parsed.prd.length < 100 || parsed.subtasks.length < 2) {
        log.warn("planner: plan seems truncated or empty, will retry via quality gate", {
          prdLength: parsed.prd.length,
          subtasksCount: parsed.subtasks.length,
        })
      }

      // Ensure summary is meaningful (not garbage like "## heading" or empty)
      parsed.summary = ensureMeaningfulSummary(parsed.summary, input.title)

      // Validate plan quality
      const planQuality = validatePlanQuality(parsed, input.request, toolCallCount, MIN_TOOL_CALLS)
      log.info("planner agent output", {
        goals: parsed.goals.length,
        subtasks: parsed.subtasks.length,
        milestones: parsed.milestones?.length ?? 0,
        risks: parsed.risks.length,
        prdLength: parsed.prd.length,
        toolCalls: toolCallCount,
        quality: planQuality,
        attempt: attempt + 1,
      })

      lastParsed = parsed
      lastQuality = planQuality

      // If quality is acceptable or we've exhausted retries, return
      if (planQuality.score >= QUALITY_RETRY_THRESHOLD || attempt >= MAX_PLAN_ATTEMPTS - 1) {
        if (planQuality.score < 0.3) {
          log.warn("planner: final plan quality is very low", { ...planQuality, attempt: attempt + 1 })
        }
        return parsed
      }

      // Quality too low -- retry with feedback
      log.warn("planner: plan quality below threshold, retrying", {
        score: planQuality.score,
        threshold: QUALITY_RETRY_THRESHOLD,
        reasons: planQuality.reasons,
        toolCalls: toolCallCount,
        minToolCalls: MIN_TOOL_CALLS,
      })
    }

    // Should never reach here, but satisfy TypeScript
    return lastParsed!
  }
}

export { HeadlessPlannerAgent as PlannerAgent }
export { parsePlanText as parsePlannerOutput }

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
  minToolCalls = PLANNER_DEFAULTS.min_tool_calls,
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
    reasons.push(`${toolCallCount} tool calls — no codebase exploration (min ${minToolCalls})`)
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
async function agentLanguageModel(): Promise<{ language: LanguageModelV2; model: Awaited<ReturnType<typeof Provider.getModel>> } | undefined> {
  const def = await Provider.defaultModel().catch((err) => {
    log.error("planner: Provider.defaultModel() failed", { error: String(err) })
    return undefined
  })
  if (!def) return undefined
  log.info("planner: default model resolved", { providerID: def.providerID, modelID: def.modelID })
  const model = await Provider.getModel(def.providerID, def.modelID)
  const language = await Provider.getLanguage(model)
  log.info("planner: model ready via Provider", { modelId: language.modelId })
  return { language, model }
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
    spec?: { summary?: string; content: string }
    replanContext?: ReplanContext
  },
  fileRefs?: Array<{ ref: string; path: string; content: string }>,
  context?: string,
  retryContext?: { previousScore: number; reasons: string[]; attempt: number },
  minToolCalls = PLANNER_DEFAULTS.min_tool_calls,
  qualityThreshold = PLANNER_DEFAULTS.quality_threshold,
): string {
  const sections = [`# Task\n\nTitle: ${input.title}\n\nRequest:\n${input.request}`]

  // If this is a quality retry, inject feedback from the previous attempt
  if (retryContext) {
    sections.push(
      [
        "# QUALITY RETRY - Previous Attempt Was Insufficient",
        "",
        `Your previous plan scored ${retryContext.previousScore.toFixed(2)} / 1.0 (threshold: ${qualityThreshold}). Attempt ${retryContext.attempt + 1}.`,
        "",
        "**Issues found:**",
        ...retryContext.reasons.map((r) => `- ${r}`),
        "",
        "**MANDATORY requirements for this attempt:**",
        `- Make at least ${minToolCalls} tool calls to explore the codebase (list_directory, read_file, search_code)`,
        "- Write a DETAILED PRD with bullet points — at least 500 characters, covering files, changes, patterns, and verification commands",
        "- Each goal MUST have a detailed description AND concrete, executable criteria (e.g., 'bun test src/x.test.ts passes')",
        "- Subtasks MUST reference specific file paths discovered from your exploration",
        "- Include at least 3 goals with specific check_selectors",
        "",
        "**DO NOT be brief or concise.** Your output must be thorough and comprehensive.",
        "A short plan is ALWAYS rejected. Produce detailed, specific, actionable output.",
      ]
        .filter(Boolean)
        .join("\n"),
    )
  }

  // Include user-provided goals so the planner can refine and expand them
  if (input.userGoals && input.userGoals.length > 0) {
    sections.push(
      `# User-Provided Goals\n\nThe user specified these goals. Incorporate them into your plan, refine their criteria to be more specific, and add any missing goals discovered during codebase exploration.\n\n${input.userGoals
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
        ...(ctx.failedRequirements && ctx.failedRequirements.length > 0
          ? [
              "",
              `## Failed Requirements (must be addressed in this plan)`,
              ...ctx.failedRequirements.map(
                (r) => `- [${r.id}] **${r.title}**: ${r.reason}`,
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
        "Output your plan using section tags as described in your instructions.",
    )
  } else {
    sections.push(
      "Now recall memory, check preferences, explore the codebase thoroughly, " +
        "then output your plan using section tags as described in your instructions.",
    )
  }
  return sections.join("\n\n")
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const PLANNER_SYSTEM = (minToolCalls = PLANNER_DEFAULTS.min_tool_calls) =>
  PLAN_CORE + "\n\n" + headlessPlanAdditions(minToolCalls)

function headlessPlanAdditions(minToolCalls: number) {
  return `## Available Tools

- **memory_search**: Search project memory for prior work, patterns, gotchas
- **memory_get**: Read full content of a memory file by ID
- **preference_list**: List active project conventions and constraints (BINDING)
- **read_file**: Read file contents with line numbers
- **find_files**: Find files matching a glob pattern
- **search_code**: Search file contents with regex (ripgrep)
- **list_directory**: List files and directories at a path
- **web_search**: Search the web for documentation, best practices, framework comparisons, and latest API references. USE THIS PROACTIVELY — always research before choosing frameworks, libraries, or architectural patterns.

## Headless Mode Requirements

Minimum ${minToolCalls} tool calls required during Phase 1. Aim for 8-15 for complex tasks.

Use the tools listed above to execute exploration strategies described in the core process:
- Phase 0: Use **memory_search** and **preference_list**
- Phase 1: Use **list_directory**, **read_file**, **search_code**, **find_files** following the strategies for modification vs new-module tasks
- Phase 1.5: Use **web_search** for research

## Quality Self-Check (MANDATORY)

Before outputting, verify each of these. If ANY answer is NO, use more tools to fill the gap:

1. Did I make at least ${minToolCalls} tool calls to explore the codebase?
2. Does EVERY goal have a detailed description explaining the specific outcome? (not just "tests pass")
3. Does every goal criteria include an exact command AND expected outcome?
4. Do subtasks reference specific file paths (not "relevant files" — actual paths)?
5. Is the PRD concise but complete (bullet points, not paragraphs)?
6. Could an executor implement this plan WITHOUT asking follow-up questions?
7. Does the summary accurately describe the plan in one line? (not a file path or heading)`
}
