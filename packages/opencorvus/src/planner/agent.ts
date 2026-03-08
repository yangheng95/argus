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
    /** User-provided goals — planner should refine/expand, not discard */
    userGoals?: Array<{ description: string; criteria: string; priority?: string }>
    replanContext?: ReplanContext
    /** External abort signal (overrides internal timeout when provided) */
    signal?: AbortSignal
  }): Promise<PlannerOutputType> {
    // Check abort signal early — setup calls (model resolution, memory search) can be slow
    if (input.signal?.aborted) throw new Error("planner aborted before model resolution")

    const model = await agentModel()
    if (!model) throw new Error("no LLM model available for planner agent")
    if (input.signal?.aborted) throw new Error("planner aborted after model resolution")

    const language = await Provider.getLanguage(model)
    const tools = createPlannerTools()

    const fileRefs = await resolveFileReferences(input.request)
    if (input.signal?.aborted) throw new Error("planner aborted before context prefetch")

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
      abortSignal: input.signal ?? AbortSignal.timeout(TIMEOUT_MS),
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
- Every file path in your plan MUST come from actual tool results — never guess paths.
- goals.criteria must be executable commands with expected outcomes, not vague statements.
- goals.check_selector maps to: build, test, lint, verify_cmd, startup, ui_review, code_quality, code_review, dead_code_review, judge
- Every blocking goal MUST have at least one check_selector.
- subtask descriptions must reference specific files, functions, and patterns discovered during exploration.
- Write in the same language as the request (Chinese request → Chinese plan).
- If replanning: your new plan MUST differ from the previous failed approach.
- The prd field must be detailed enough that an executor agent can implement everything without further exploration.
- After finishing tool calls, output JSON immediately.
- Do NOT produce generic advice like "follow best practices" or "handle edge cases" — be specific about WHICH practices and WHICH edge cases.`
