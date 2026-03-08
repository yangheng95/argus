import z from "zod"
import fs from "fs"
import path from "path"
import { GoalInput } from "@/orchestrator/model"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { PlannerAgent, type PlannerOutputType, type ReplanContext } from "./agent"

const log = Log.create({ service: "planner" })

/** Max time to wait for PlannerAgent before surfacing a planner failure.
 *  Override via OPENCORVUS_PLANNER_TIMEOUT_MS env var (useful for tests). */
function plannerTimeoutMs() {
  return Number(process.env.OPENCORVUS_PLANNER_TIMEOUT_MS) || 120_000
}

// ---------------------------------------------------------------------------
// Spec analysis schema — output of LLM-based spec expansion
// ---------------------------------------------------------------------------

const SpecAnalysis = z.object({
  expanded_spec: z.string(),
  ambiguities: z.array(z.string()),
  questions: z.array(
    z.object({
      question: z.string(),
      context: z.string(),
      default_assumption: z.string(),
    }),
  ),
  goals: z.array(
    z.object({
      description: z.string(),
      criteria: z.string(),
      priority: z.enum(["blocking", "advisory"]),
    }),
  ),
  risk_areas: z.array(z.string()),
  confidence: z.number().transform((v) => Math.max(0, Math.min(1, v))),
})
type SpecAnalysisResult = z.infer<typeof SpecAnalysis>

const Clarification = z.object({
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
type ClarificationResult = z.infer<typeof Clarification>

function plannerMeta(input: {
  quality: "compiled"
  source: "planner_agent"
  clarificationSource: "model" | "heuristic" | "suppressed" | "none"
}) {
  return {
    role: "headless_compiler" as const,
    quality: input.quality,
    source: input.source,
    clarification_source: input.clarificationSource,
  }
}

export class PlannerFailureError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "PlannerFailureError"
  }
}

/**
 * HeadlessPlannerService — orchestrator-facing planning stage.
 *
 * Generates execution prompts with LLM-powered spec analysis.
 *
 * New flow:
 *   1. Analyze the spec with an LLM to expand, decompose, and identify ambiguities
 *   2. Generate specific goals with verifiable criteria
 *   3. If confidence is low and questions exist, return them for orchestrator to ask
 *   4. Build a detailed execution prompt incorporating the expanded spec
 *
 * Planning is mandatory. If the planner agent fails, surface the error.
 */
export namespace HeadlessPlannerService {
  export async function initial(input: {
    title: string
    request: string
    goals?: z.infer<typeof GoalInput>[]
    allowClarification?: boolean
  }) {
    const hasUserGoals = input.goals && input.goals.length > 0

    // Pre-analyze the request: extract file references, requirements, entities.
    // This is fast (sync disk reads) and gives planner failures useful context.
    const analysis = preAnalyzeRequest(input.request)
    if (analysis.files.length > 0) {
      log.info("pre-analysis found referenced files", {
        refs: analysis.files.map((f) => f.ref),
        requirements: analysis.requirements.length,
        entities: analysis.entities,
        workDir: analysis.workDir,
      })
    }

    // ALWAYS use PlannerAgent — even with user-provided goals, the agent explores
    // the codebase and produces a detailed plan grounded in real file paths.
    // User goals are passed as context for the agent to refine and expand.
    // Hard timeout via Promise.race + abort signal for cleanup.
    const timeoutMs = plannerTimeoutMs()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const agentResult = await Promise.race([
      PlannerAgent.plan({
        title: input.title,
        request: input.request,
        userGoals: hasUserGoals
          ? input.goals!.map((g) => ({
              description: g.description,
              criteria: g.criteria,
              priority: g.priority,
            }))
          : undefined,
        signal: controller.signal,
      }).catch((error) => {
        throw new PlannerFailureError("planner agent failed", { cause: error })
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new PlannerFailureError(`planner timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]).finally(() => {
      clearTimeout(timer)
      controller.abort()
    })

    // When user provided explicit goals, use them (they have the correct check_selectors
    // and metadata). The agent's PRD, subtasks, risks provide the codebase context.
    if (hasUserGoals) {
      return agentOutputToDraft(
        input.title,
        input.request,
        { ...agentResult, goals: agentResult.goals },
        "initial",
        undefined,
        undefined,
        input.allowClarification !== false,
        input.goals,
      )
    }

    return agentOutputToDraft(input.title, input.request, agentResult, "initial", undefined, undefined, input.allowClarification !== false)
  }

  export async function replan(input: {
    title: string
    request: string
    goals: z.infer<typeof GoalInput>[]
    previousPrompt: string
    previousPlanID: string
    failureSummary: string
    replanContext?: ReplanContext
  }) {
    // Build replan context (use structured analysis if available, otherwise infer from summary)
    const replanCtx: ReplanContext = input.replanContext ?? {
      previousSummary: summarize(input.previousPrompt),
      failureAnalysis: {
        classification: "unknown",
        summary: input.failureSummary,
        rootCause: input.failureSummary,
        suggestedStrategy: "Analyze the failure and try a different approach",
        avoidApproaches: [],
      },
      previousGoalStatuses: input.goals.map((g) => ({
        description: g.description,
        status: "failed",
        evidence: input.failureSummary,
      })),
    }

    // Try PlannerAgent — independent-context agent with codebase awareness
    const agentResult = await PlannerAgent.plan({
      title: input.title,
      request: input.request,
      replanContext: replanCtx,
    }).catch((error) => {
      throw new PlannerFailureError("planner agent replan failed", { cause: error })
    })
    return agentOutputToDraft(input.title, input.request, agentResult, "replan", input.previousPlanID, input.failureSummary)
  }
}

// Backwards-compatible alias during the architecture transition.
export import PlannerService = HeadlessPlannerService

// ---------------------------------------------------------------------------
// Agent output → PlanDraft conversion
// ---------------------------------------------------------------------------

function agentOutputToDraft(
  title: string,
  request: string,
  output: PlannerOutputType,
  strategy: "initial" | "replan",
  previousPlanID?: string,
  failureSummary?: string,
  allowClarification = true,
  /** When user provided explicit goals, prefer them over agent-generated ones */
  userGoals?: z.infer<typeof GoalInput>[],
) {
  // User-provided goals take precedence — they have the correct check_selectors and metadata.
  // Agent goals are used when no user goals were provided.
  const goals = userGoals && userGoals.length > 0
    ? userGoals.map((g) => ({
        description: g.description,
        criteria: g.criteria,
        priority: g.priority ?? ("blocking" as const),
        metadata: {
          check_selector: g.metadata?.check_selector ?? inferSelectors(`${g.description} ${g.criteria}`),
        },
      }))
    : output.goals.map((g) => ({
        description: g.description,
        criteria: g.criteria,
        priority: g.priority,
        metadata: {
          check_selector: g.check_selector ?? inferSelectors(`${g.description} ${g.criteria}`),
        },
      }))

  const prompt = renderAgentPrompt({
    title,
    request,
    prd: output.prd,
    goals,
    subtasks: output.subtasks,
    risks: output.risks,
    assumptions: output.assumptions,
    strategy,
    milestones: output.milestones?.map((m) => ({ title: m.title })),
  })

  const steps = output.subtasks
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((s, i) => `${s.order ?? i + 1}. ${s.title}: ${s.description}`)
  const clarification = allowClarification ? deriveClarification(request, output) : undefined
  const clarificationSource =
    !allowClarification
      ? "suppressed"
      : Array.isArray(output.clarifications) && output.clarifications.length > 0
        ? "model"
        : clarification
          ? "heuristic"
          : "none"

  return {
    summary: output.summary,
    prompt,
    goals,
    metadata: {
      strategy: strategy as "initial" | "replan",
      steps,
      failure_summary: failureSummary,
      previous_plan_id: previousPlanID,
      milestones: output.milestones,
      risks: output.risks,
      planner: plannerMeta({
        quality: "compiled",
        source: "planner_agent",
        clarificationSource,
      }),
      clarification,
      spec_analysis: {
        expanded_spec: output.prd,
        ambiguities: clarification?.questions.map((item) => item.question) ?? [],
        questions:
          clarification?.questions.map((item) => ({
            question: item.question,
            context: item.context ?? clarification.reason,
            default_assumption: item.default_assumption ?? "",
          })) ?? [],
        goals: goals.map((goal) => ({
          description: goal.description,
          criteria: goal.criteria,
          priority: goal.priority ?? "blocking",
        })),
        risk_areas: output.risks,
        confidence: clarification ? 0.45 : 0.9,
      },
    },
  }
}

function renderAgentPrompt(input: {
  title: string
  request: string
  prd: string
  goals: Array<{ description: string; criteria: string; priority?: string; metadata?: { check_selector?: string[] } }>
  subtasks: Array<{ title: string; description: string; order?: number }>
  risks: string[]
  assumptions?: Array<{ question: string; assumption: string }>
  strategy?: "initial" | "replan"
  milestones?: Array<{ title: string }>
}) {
  const sections = [
    `You are executing a headless coding task inside OpenCorvus.

Task: ${input.title}

## Specification

### Original Request
${input.request.trim()}

### Expanded Specification (from codebase analysis)
${input.prd.trim()}`,
  ]

  if (input.assumptions && input.assumptions.length > 0) {
    sections.push(
      `### Assumptions\n${input.assumptions
        .map((a, i) => `${i + 1}. **${a.question}**\n   → ${a.assumption}`)
        .join("\n\n")}`,
    )
  }

  // Goals with check selectors for self-verification
  sections.push(
    `## Goals\n${input.goals
      .map((g, i) => {
        const checks = g.metadata?.check_selector
        const checksLine = checks?.length ? `\n   Checks: ${checks.join(", ")}` : ""
        return `${i + 1}. [${g.priority ?? "blocking"}] ${g.description}\n   Criteria: ${g.criteria}${checksLine}`
      })
      .join("\n\n")}\n\nAfter completing all subtasks, verify EVERY blocking goal by running its listed checks. A goal without evidence of passing is a goal not met.`,
  )

  sections.push(
    `## Subtasks (execute in order)\n${input.subtasks
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((s, i) => `${s.order ?? i + 1}. **${s.title}**\n   ${s.description}`)
      .join("\n\n")}`,
  )

  if (input.risks.length > 0) {
    sections.push(
      `## Risk Areas\n${input.risks.map((r) => `- ${r}`).join("\n")}`,
    )
  }

  sections.push(buildWorkflowSection({
    taskType: input.strategy ?? "initial",
    hasRelevantMemory: false,
    hasPriorFailure: input.strategy === "replan",
    milestones: input.milestones,
  }))

  return sections.join("\n\n")
}

// ---------------------------------------------------------------------------
// Pre-analysis — deterministic extraction before LLM call
// ---------------------------------------------------------------------------

interface RequestAnalysis {
  /** Files mentioned in the request, resolved and pre-read */
  files: Array<{ ref: string; absPath: string; content: string }>
  /** Structured requirements extracted from bullet/numbered lists */
  requirements: string[]
  /** Code entities (type/class/function names) mentioned */
  entities: string[]
  /** Working directory extracted from the request */
  workDir?: string
}

function preAnalyzeRequest(request: string): RequestAnalysis {
  const FILE_EXTS = "ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|json|yaml|yml|toml|md|css|html|sql|sh|vue|svelte"

  // 1. Extract working directory
  let workDir: string | undefined
  const cwdMatch =
    request.match(/(?:绝对路径|absolute path)[：:\s]*([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i) ??
    request.match(/(?:工作目录|working dir(?:ectory)?)[^\n]*?([A-Z]:[/\\][^\s)）]+|\/[^\s)）]+)/i)
  if (cwdMatch) workDir = cwdMatch[1].replace(/[/\\]+$/, "")

  // 2. Extract file references
  const refs = new Set<string>()
  let match: RegExpExecArray | null

  // @file:path or @path
  const atPat = /@(?:file:)?([./a-zA-Z][\w./\\-]*\.\w+)/g
  while ((match = atPat.exec(request)) !== null) refs.add(match[1])

  // Backtick-wrapped: `src/router.ts`
  const btPat = new RegExp("`([./]?(?:[\\w@-]+[/\\\\])*[\\w.-]+\\.(?:" + FILE_EXTS + "))`", "g")
  while ((match = btPat.exec(request)) !== null) refs.add(match[1])

  // Bare relative paths with at least one slash: src/router.ts
  const barePat = new RegExp(
    "(?:^|[\\s,;，；（(])(\\.?(?:[\\w@-]+[/\\\\])+[\\w.-]+\\.(?:" + FILE_EXTS + "))(?=[\\s,;，；）)。:：]|$)",
    "gm",
  )
  while ((match = barePat.exec(request)) !== null) refs.add(match[1].trim())

  // Resolve and read files
  const baseDirs: string[] = []
  if (workDir) baseDirs.push(workDir)
  try { baseDirs.push(Instance.directory) } catch { /* may not be initialized */ }
  try { if (!baseDirs.includes(Instance.worktree)) baseDirs.push(Instance.worktree) } catch { /* ok */ }

  const files: RequestAnalysis["files"] = []
  for (const ref of refs) {
    if (path.isAbsolute(ref)) {
      const content = readFileSafe(ref)
      if (content) files.push({ ref, absPath: ref, content })
      continue
    }
    for (const base of baseDirs) {
      const abs = path.resolve(base, ref)
      const content = readFileSafe(abs)
      if (content) {
        files.push({ ref, absPath: abs, content })
        break
      }
    }
  }

  // 3. Extract structured requirements (bullet points, numbered items, action-verb lines)
  const requirements: string[] = []
  // Chinese action verbs don't need a trailing space (Chinese has no word spacing)
  const CN_ACTION_PAT = /^(?:添加|修改|删除|创建|导出|导入|确保|实现|重构|优化|移除|更新|替换|支持|使用|配置|设置|检查|启用|禁用)/
  // English action verbs require a trailing space to avoid matching mid-sentence words
  const EN_ACTION_PAT = /^(?:add|create|modify|delete|remove|implement|ensure|replace|fix|refactor|export|import|enable|disable|configure|check|support)\s/i
  for (const line of request.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.length < 4) continue
    if (/^[-*•]\s+/.test(trimmed)) {
      requirements.push(trimmed.replace(/^[-*•]\s+/, ""))
    } else if (/^\d+[.、)）]\s+/.test(trimmed)) {
      requirements.push(trimmed.replace(/^\d+[.、)）]\s+/, ""))
    } else if (CN_ACTION_PAT.test(trimmed) || EN_ACTION_PAT.test(trimmed)) {
      requirements.push(trimmed)
    }
  }

  // 4. Extract code entities (backtick-wrapped names, type/class/function keywords)
  const entitySet = new Set<string>()
  // English order: keyword Name (e.g., "class Router", "type Middleware")
  const entPat = /`(\w+)`|(?:class|type|interface|function|method)\s+(\w+)/gi
  while ((match = entPat.exec(request)) !== null) {
    const name = match[1] || match[2]
    if (name && name.length > 1 && !/^(the|and|or|is|to|a|of|in)$/i.test(name)) entitySet.add(name)
  }
  // Chinese order: Name 类型/方法/函数/接口 (e.g., "Middleware 类型", "Router 类")
  const cnPat = /(\w{2,})\s*(?:类型|类|方法|函数|接口)/g
  while ((match = cnPat.exec(request)) !== null) {
    entitySet.add(match[1])
  }

  return { files, requirements, entities: [...entitySet], workDir }
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

function buildWorkflowSection(input: {
  taskType: "initial" | "replan" | "retry"
  hasRelevantMemory: boolean
  hasPriorFailure: boolean
  failureClassification?: string
  milestones?: Array<{ title: string }>
}): string {
  const sections: string[] = ["## Execution Guide"]

  if (input.taskType === "retry") {
    sections.push(
      `This is a **retry** — focus on the specific failure, not broad exploration.`,
      `1. Read the failure details above. Identify the exact failing check and root cause.`,
      `2. Make targeted fixes — do not refactor or change unrelated code.`,
      `3. Re-run the failing checks to verify your fix.`,
    )
  } else if (input.taskType === "replan") {
    sections.push(
      `This is a **replan** after a failed attempt. Read the Replan Context below.`,
      `1. Understand what went wrong. Do NOT repeat the failed approach.`,
      `2. Try a different strategy as suggested in the failure analysis.`,
      `3. Verify each step before moving on.`,
    )
  } else {
    sections.push(
      `Execute the subtasks above in order. For each:`,
      `1. Use \`planner\` tool to track progress (add_task → in_progress → completed).`,
      `2. Implement the change, then immediately verify it (typecheck, test, etc.).`,
      `3. Record discoveries via \`memory\` tool — written memories survive across sessions.`,
      ``,
      `After all subtasks: run ALL checks listed in the Goals section and confirm every blocking goal is met.`,
    )
  }

  if (input.milestones && input.milestones.length > 0) {
    sections.push(
      `\n**Milestones**: ${input.milestones.map((m, i) => `${i + 1}. ${m.title}`).join(" | ")}`,
    )
  }

  sections.push(
    `\n**Tools**: memory (search/write knowledge), preference (project conventions — binding), planner (task tracking), goal (acceptance criteria), task (parallel sub-agents), websearch/webfetch (external docs).`,
  )

  return sections.join("\n")
}

function renderReplanPrompt(input: {
  title: string
  request: string
  goals: z.infer<typeof GoalInput>[]
  previousPrompt: string
  failureSummary: string
}) {
  const truncatedPrevious =
    input.previousPrompt.length > 3000
      ? input.previousPrompt.slice(0, 3000) + "\n...(truncated)"
      : input.previousPrompt

  return `You are executing a headless coding task inside OpenCorvus.

Task: ${input.title}

Request:
${input.request.trim()}

Goals:
${input.goals.map((goal, index) => `${index + 1}. [${goal.priority ?? "blocking"}] ${goal.description}\n   Criteria: ${goal.criteria}`).join("\n\n")}

## Replan Context

The previous attempt **failed**. You MUST use a DIFFERENT strategy.

### Failure Summary
${input.failureSummary}

### Previous Plan (for reference)
${truncatedPrevious}

## Instructions

1. Analyze the failure. Understand what went wrong and why.
2. Explore the codebase to verify your understanding — read the affected files.
3. Use the planner tool to create a NEW task decomposition that avoids the previous failure.
4. Execute the new plan. Verify each step immediately.
5. Run ALL acceptance checks. Confirm every blocking goal is met.

**Tools**: memory (search/write knowledge), preference (project conventions — binding), planner (task tracking), goal (acceptance criteria), task (parallel sub-agents).`
}

// ---------------------------------------------------------------------------
// Goal helpers
// ---------------------------------------------------------------------------

function normalizeGoals(request: string, goals?: z.infer<typeof GoalInput>[]) {
  if (goals && goals.length > 0) return goals
  return [
    {
      description: summarize(request),
      criteria: "The requested change is implemented and acceptance checks pass.",
      priority: "blocking" as const,
      metadata: {
        check_selector: inferSelectors(request),
      },
    },
  ]
}

function deriveClarification(request: string, output: PlannerOutputType): ClarificationResult | undefined {
  if (Array.isArray(output.clarifications) && output.clarifications.length > 0) {
    const questions = output.clarifications.filter((item) => item.question?.trim())
    if (questions.length === 0) return undefined
    return {
      reason: questions[0]?.context ?? "Critical ambiguities require user clarification before execution.",
      questions,
    }
  }
  return heuristicClarification(request)
}

function heuristicClarification(request: string): ClarificationResult | undefined {
  const text = request.trim()
  if (!text) return undefined
  const lower = text.toLowerCase()
  const vague =
    text.length <= 18 ||
    [
      "优化性能",
      "修复bug",
      "修 bug",
      "修复问题",
      "重构",
      "优化一下",
      "improve performance",
      "fix bug",
      "refactor",
      "clean this up",
    ].some((item) => lower === item || text === item)
  if (!vague) return undefined
  const chinese = /[\u3400-\u9fff]/.test(text)
  return chinese
    ? {
        reason: "当前需求过于宽泛，直接执行容易偏离目标。",
        questions: [
          {
            header: "范围",
            question: "请明确这次要改的具体模块、页面或问题现象，以及你希望如何验收。",
            context: `原始请求：${text}`,
            default_assumption: "如果你不补充，我会优先处理当前仓库里最直接相关的热点问题。",
          },
        ],
      }
    : {
        reason: "The request is too broad to execute safely without a concrete target.",
        questions: [
          {
            header: "Scope",
            question: "Which specific module, page, or failure should this task target, and how should success be verified?",
            context: `Original request: ${text}`,
            default_assumption: "If no extra detail is provided, prioritize the most directly related hotspot in the repo.",
          },
        ],
      }
}

function inferSelectors(request: string) {
  const lower = request.toLowerCase()
  const selectors = new Set(["build", "test", "lint", "verify_cmd"])
  if (/(ui|ux|design|layout|页面|界面|交互|体验|accessibility)/.test(lower)) selectors.add("ui_review")
  if (/(code quality|maintain|readab|review|refactor|代码质量|可维护|可读)/.test(lower)) selectors.add("code_quality")
  if (/\bcr\b|code review|审查|代码评审|review finding|review comment/.test(lower)) selectors.add("code_review")
  if (/(dead code|unused code|unused export|obsolete|stale branch|死代码|无用代码|废弃分支|清理旧代码)/.test(lower))
    selectors.add("dead_code_review")
  if (/(startup|start normally|starts normally|boot|launch|serve|server|启动|运行起来|正常启动)/.test(lower))
    selectors.add("startup")
  return [...selectors]
}

function summarize(input: string) {
  const line = input
    .split("\n")
    .map((item) => item.trim())
    .find(Boolean)
  if (!line) return "Untitled plan"
  if (line.length <= 120) return line
  return line.slice(0, 117) + "..."
}
