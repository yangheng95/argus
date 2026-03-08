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
import { generateText, stepCountIs } from "ai"
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
// PlannerAgent
// ---------------------------------------------------------------------------

const MAX_STEPS = 30
const TIMEOUT_MS = 300_000

export namespace PlannerAgent {
  export async function plan(input: {
    title: string
    request: string
    replanContext?: ReplanContext
  }): Promise<PlannerOutputType> {
    const model = await agentModel()
    if (!model) throw new Error("no LLM model available for planner agent")

    const language = await Provider.getLanguage(model)
    const tools = createPlannerTools()

    const fileRefs = await resolveFileReferences(input.request)
    const context = prefetchContext(input.title, input.request)
    const userPrompt = buildUserPrompt(input, fileRefs, context)

    log.info("planner agent starting", {
      title: input.title,
      isReplan: !!input.replanContext,
      model: `${model.providerID}/${model.id}`,
      prefetchedContext: context.length > 0,
      toolCount: Object.keys(tools).length,
    })

    const result = await generateText({
      model: language,
      stopWhen: stepCountIs(MAX_STEPS),
      tools,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      system: PLANNER_SYSTEM,
      prompt: userPrompt,
    })

    // Collect text from all steps — the model may output JSON in any step
    const allText = result.text || result.steps.map((s) => s.text).filter(Boolean).join("\n")

    log.info("planner agent finished", {
      steps: result.steps.length,
      finishReason: result.finishReason,
      textLength: allText.length,
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

  const obj = JSON.parse(raw)
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
  return PlannerOutput.parse(obj)
}

async function agentModel() {
  // Prefer the user's default model (likely has best tool support)
  const def = await Provider.defaultModel().catch(() => undefined)
  if (def) {
    const model = await Provider.getModel(def.providerID, def.modelID).catch(() => undefined)
    if (model) return model
  }
  // Fallback: DashScope/Qwen (same model as opencode/opencorvus)
  if (process.env.DASHSCOPE_API_KEY) {
    return await Provider.getModel("alibaba-cn", "qwen3.5-plus").catch(() => undefined)
  }
  // Fallback: DeepSeek (good tool support, affordable)
  if (process.env.DEEPSEEK_API_KEY) {
    return await Provider.getModel("deepseek", "deepseek-chat").catch(() => undefined)
  }
  // Fallback: Moonshot
  if (process.env.MOONSHOT_API_KEY) {
    return (
      (await Provider.getModel("moonshotai-cn", "kimi-k2.5").catch(() => undefined)) ??
      (await Provider.getModel("moonshotai", "kimi-k2.5").catch(() => undefined))
    )
  }
  return undefined
}

/**
 * 解析 request 中的 @file:path 或 @path 引用，读取文件内容。
 * 支持格式：@file:src/foo.ts, @src/foo.ts, @./specs/doc.md
 */
async function resolveFileReferences(request: string): Promise<Array<{ ref: string; path: string; content: string }>> {
  // 匹配 @file:path 或 @path（路径不含空白，以 / . 或字母开头）
  const pattern = /@(?:file:)?([./a-zA-Z][\w./\\-]*\.\w+)/g
  const refs = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = pattern.exec(request)) !== null) {
    refs.add(match[1])
  }
  if (refs.size === 0) return []

  const results: Array<{ ref: string; path: string; content: string }> = []
  for (const ref of refs) {
    const resolved = path.isAbsolute(ref) ? ref : path.resolve(Instance.worktree, ref)
    try {
      const content = await Filesystem.readText(resolved)
      if (content) {
        // 限制单文件内容大小，防止上下文爆炸
        const truncated = content.length > 8000 ? content.slice(0, 8000) + "\n\n... (truncated)" : content
        results.push({ ref, path: resolved, content: truncated })
      }
    } catch {
      log.warn("file reference not found", { ref, resolved })
    }
  }
  return results
}

function buildUserPrompt(
  input: {
    title: string
    request: string
    replanContext?: ReplanContext
  },
  fileRefs?: Array<{ ref: string; path: string; content: string }>,
  context?: string,
): string {
  const sections = [`# Task\n\nTitle: ${input.title}\n\nRequest:\n${input.request}`]

  // Inject prefetched context (auto-recalled memory + active preferences)
  if (context) {
    sections.push(`# Project Context (Pre-fetched)\n\n${context}`)
  }

  // 将引用的文件内容附加到 prompt 中
  if (fileRefs && fileRefs.length > 0) {
    const refSections = fileRefs.map(
      (f) => `### @${f.ref}\n\`\`\`\n${f.content}\n\`\`\``,
    )
    sections.push(`# Referenced Files\n\n${refSections.join("\n\n")}`)
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

  sections.push(
    "Now recall memory, check preferences, explore the codebase, then produce your plan as a JSON object.",
  )
  return sections.join("\n\n")
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const PLANNER_SYSTEM = `You are a senior software architect acting as the planning brain for OpenCorvus, an autonomous coding orchestrator. Your job is to leverage accumulated project knowledge, explore the codebase, and create a comprehensive development plan.

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

### Phase 0: RECALL — Leverage Past Experience (DO THIS FIRST)

Before touching the codebase, recall what you already know:

1. **Search memory** (memory_search) with keywords from the task. Try 1-2 searches with different phrasings.
   Prior sessions may have documented solutions, known gotchas, architectural decisions,
   or approaches you should follow or extend.
   If pre-fetched memory is provided in the task context, review it and search for more only if needed.

2. **List preferences** (preference_list) to see current project conventions and constraints.
   If pre-fetched preferences are provided in the task context, you can skip this call.
   Preferences are BINDING — your plan must respect them.

### Phase 1: EXPLORE — Understand the Codebase (MANDATORY)

Explore the codebase with purpose — don't explore blindly:

1. List the project root and key directories to understand layout
2. Read package.json (or equivalent) for tech stack, scripts, dependencies
3. Read config files (tsconfig.json, etc.) for build setup
4. Read 2-3 key source files related to the task for existing patterns and conventions
5. Search (grep) for relevant code patterns, function names, types mentioned in the request
6. Trace dependencies — what depends on code you'll change? What will your changes depend on?

**Exploration budget**: 8-12 tool calls for recall + codebase combined.
A blind plan is a bad plan, but over-exploring wastes budget.

### Phase 1.5: RESEARCH — External Knowledge (if needed)

If the task involves external APIs, third-party libraries, unfamiliar protocols,
or systems you haven't encountered — use web_search to find current documentation.
Do NOT guess what can be looked up. Skip this phase for internal-only tasks.

### Phase 2: PLAN — Synthesize Everything

Based on memory, preferences, codebase exploration, and any web research, create:

1. **Expanded PRD**: Detailed technical specification with:
   - Exact file paths from exploration
   - Patterns and conventions to follow (from preferences AND codebase)
   - Dependencies, APIs, edge cases, error handling
   - Gotchas and lessons from memory

2. **Goals**: Specific, measurable acceptance criteria
   - Each must be independently verifiable
   - Blocking goals MUST have at least one check_selector
   - Include functional goals AND quality gates

3. **Subtasks**: Ordered execution steps
   - Reference specific files and patterns from exploration
   - Each independently executable and verifiable
   - Order: setup → core → integration → tests → verification
   - Include verification steps ("run tests", "typecheck", "grep for residuals")

4. **Milestones**: Group related goals (optional, for complex tasks)

5. **Risks**: What could go wrong? What assumptions might be incorrect?

6. **Clarifications**: Only if a CRITICAL ambiguity blocks safe implementation
   - At most 1 clarification
   - Prefer actionable questions over vague ones

### Phase 3: OUTPUT as JSON

After exploring and planning, respond with ONLY a JSON object (no markdown fences, no surrounding text):

{
  "prd": "Expanded PRD with full technical context...",
  "summary": "One-line summary of the plan",
  "goals": [
    {
      "description": "What to achieve",
      "criteria": "Concrete acceptance criteria (e.g., 'bun run build exits with code 0')",
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
      "title": "Subtask name",
      "description": "Detailed instructions with specific file paths and patterns to follow",
      "order": 1
    }
  ],
  "risks": ["Risk description"],
  "assumptions": [
    {
      "question": "Ambiguous aspect of the request",
      "assumption": "What we will assume"
    }
  ],
  "clarifications": [
    {
      "header": "Scope",
      "question": "Which specific module should this change target?",
      "context": "The request is too broad to implement safely.",
      "default_assumption": "Start with the most directly related module."
    }
  ]
}

## Rules

- ALWAYS recall memory and preferences FIRST. Past experience is the cheapest intelligence.
- ALWAYS explore the codebase before planning. A plan without codebase context is worthless.
- goals.criteria must be concrete and machine-verifiable when possible
- goals.check_selector maps to: build, test, lint, verify_cmd, startup, ui_review, code_quality, code_review, dead_code_review, judge
- Every blocking goal MUST have at least one check_selector
- subtasks should reference specific files and patterns from exploration
- Write in the same language as the request (Chinese request → Chinese plan)
- If replanning: your new plan MUST differ from the previous failed approach
- Respect all preferences — they are binding project conventions
- The prd field should be detailed enough that a coding agent can implement without further questions
- After finishing tool calls, STOP and output JSON immediately — do not make additional tool calls`
