import z from "zod"
import { GoalInput } from "@/orchestrator/model"
import { Log } from "@/util/log"
import { PlannerAgent, type PlannerOutputType, type ReplanContext } from "./agent"

const log = Log.create({ service: "planner" })

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

/**
 * PlannerService — generates execution prompts with LLM-powered spec analysis.
 *
 * New flow:
 *   1. Analyze the spec with an LLM to expand, decompose, and identify ambiguities
 *   2. Generate specific goals with verifiable criteria
 *   3. If confidence is low and questions exist, return them for orchestrator to ask
 *   4. Build a detailed execution prompt incorporating the expanded spec
 *
 * Falls back to template-based planning if LLM is unavailable.
 */
export namespace PlannerService {
  export async function initial(input: {
    title: string
    request: string
    goals?: z.infer<typeof GoalInput>[]
    allowClarification?: boolean
  }) {
    // If user provided explicit goals, skip agent planning
    if (input.goals && input.goals.length > 0) {
      return templatePlan(input.title, input.request, input.goals, false)
    }

    // Use PlannerAgent — independent-context agent that explores codebase before planning
    const agentResult = await PlannerAgent.plan({
      title: input.title,
      request: input.request,
    }).catch((error) => {
      log.warn("planner agent failed, falling back to template", { error: error?.message ?? String(error) })
      return undefined
    })

    if (!agentResult) {
      const goals = normalizeGoals(input.request)
      return templatePlan(input.title, input.request, goals, input.allowClarification !== false)
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
      log.warn("planner agent replan failed, falling back to template", { error: error?.message ?? String(error) })
      return undefined
    })

    if (agentResult) {
      return agentOutputToDraft(input.title, input.request, agentResult, "replan", input.previousPlanID, input.failureSummary)
    }

    // Fallback: template-based replan
    const goals = normalizeGoals(input.request, input.goals)
    const steps = [...PLAN_MODE_STEPS, `Correct the previously failed outcome: ${input.failureSummary}`]
    return {
      summary: summarize(`${input.request}\n\nReplan reason: ${input.failureSummary}`),
      prompt: renderReplanPrompt({
        title: input.title,
        request: input.request,
        goals,
        previousPrompt: input.previousPrompt,
        failureSummary: input.failureSummary,
      }),
      goals,
      metadata: {
        strategy: "replan" as const,
        steps,
        failure_summary: input.failureSummary,
        previous_plan_id: input.previousPlanID,
      },
    }
  }
}

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
) {
  const goals = output.goals.map((g) => ({
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
  })

  const steps = output.subtasks
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((s, i) => `${s.order ?? i + 1}. ${s.title}: ${s.description}`)
  const clarification = allowClarification ? deriveClarification(request, output) : undefined

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

  sections.push(WORKFLOW_SECTION)

  return sections.join("\n\n")
}

// ---------------------------------------------------------------------------
// Template-based plan (fallback)
// ---------------------------------------------------------------------------

function templatePlan(
  title: string,
  request: string,
  goals: z.infer<typeof GoalInput>[],
  allowClarification = true,
) {
  const clarification = allowClarification ? heuristicClarification(request) : undefined
  return {
    summary: summarize(request),
    prompt: renderPlanModePrompt({ title, request, goals }),
    goals,
    metadata: {
      strategy: "initial" as const,
      steps: PLAN_MODE_STEPS,
      clarification,
      spec_analysis:
        clarification
          ? {
              expanded_spec: request,
              ambiguities: clarification.questions.map((item) => item.question),
              questions: clarification.questions.map((item) => ({
                question: item.question,
                context: item.context ?? clarification.reason,
                default_assumption: item.default_assumption ?? "",
              })),
              goals: goals.map((goal) => ({
                description: goal.description,
                criteria: goal.criteria,
                priority: goal.priority ?? "blocking",
              })),
              risk_areas: [],
              confidence: 0.2,
            }
          : undefined as SpecAnalysisResult | undefined,
    },
  }
}

// ---------------------------------------------------------------------------
// Plan-mode workflow steps (mirrors upstream Claude Code plan-mode phases)
// ---------------------------------------------------------------------------

const PLAN_MODE_STEPS = [
  "Explore the codebase to understand architecture, conventions, and affected areas.",
  "Use the planner tool to decompose the task into a hierarchical subtask tree.",
  "Execute each subtask in order, updating planner status as you go.",
  "Run acceptance checks and verify the requested outcome.",
]

// ---------------------------------------------------------------------------
// Prompt generation — enhanced with spec analysis
// ---------------------------------------------------------------------------

function renderPlanModePrompt(input: {
  title: string
  request: string
  goals: z.infer<typeof GoalInput>[]
}) {
  return `You are executing a headless coding task inside OpenCorvus.

Task: ${input.title}

Request:
${input.request.trim()}

Goals:
${input.goals.map((goal, index) => `${index + 1}. ${goal.description}\n   Criteria: ${goal.criteria}`).join("\n\n")}

${WORKFLOW_SECTION}`
}

const WORKFLOW_SECTION = `## Planning & Execution Workflow

Follow this structured workflow. Do NOT skip any phase.

### Phase 0: Recall — Leverage Prior Knowledge

Before touching code, recall what you already know:

1. **Search memory** — Call \`memory\` with \`action: "search"\` and \`scope: "all"\` using keywords from the task.
   Try 1-2 searches with different phrasings to find prior solutions, known gotchas, or established patterns.
2. **Check preferences** — Call \`preference\` with \`action: "list"\` and \`scope: "all"\` to see current project conventions.
   Preferences are BINDING — your implementation must respect them.

If the assistant-brief above already contains memory and preferences, review them first and only search for more if needed.

### Phase 1: Explore & Understand

Before making any changes, gain a thorough understanding of the codebase:

1. **Read relevant files** — Identify the files and modules affected by this task. Use read, glob, and grep tools to explore.
2. **Understand conventions** — Look at existing patterns, naming conventions, test structure, and architecture.
3. **Identify dependencies** — Find what depends on the code you'll change and what your changes depend on.

Use up to 3 parallel \`task\` (Explore) agents if the scope is broad. Use 1 if the task is well-scoped.

### Phase 2: Plan with the Planner Tool

Use the \`planner\` tool to create a structured task decomposition:

1. Call \`planner\` with action \`add_task\` for each major step.
2. Use \`parentId\` to create subtasks where appropriate.
3. Each task should have a clear, verifiable goal.
4. Order tasks logically: setup → core changes → tests → verification.
5. Use \`planner\` with action \`scratchpad_write\` to record critical findings, gotchas, and constraints.

Include a final verification task that runs the acceptance checks listed in the Goals section.

### Phase 3: Execute & Verify Incrementally

Work through your plan systematically with per-step verification:

\`\`\`
For each subtask:
  1. planner({ action: "update_task", taskId, status: "in_progress" })
  2. Execute the work (read → edit/write → verify)
  3. Run a quick check for this unit (e.g., typecheck, run related test)
  4. planner({ action: "update_task", taskId, status: "completed" })
  5. memory({ action: "write", title: "...", content: "..." }) — record any discoveries or gotchas
\`\`\`

**CRITICAL**: Verify each subtask before moving to the next. Do NOT batch all verification to the end.
Catch errors early so failures are isolated and fixable.

### Phase 4: Final Verification

After all subtasks complete:

1. Run ALL acceptance checks referenced in the Goals section (build, test, lint, etc.).
2. For each goal, verify the criteria is met and note the evidence.
3. Summarize what changed, what was verified, and any remaining risks.
4. Write a final memory entry summarizing: what was built, key decisions, tricky parts, and logical next steps.

## Available High-Level Tools

Beyond basic file tools (read, edit, write, glob, grep, bash), you have:

- **memory** — Search/read/write project knowledge. Always recall before starting. Write discoveries as you go.
- **preference** — List/read project conventions. These are binding.
- **planner** — Structured task decomposition with scratchpad. Use throughout to track progress.
- **goal** — View and track acceptance goals during execution.
- **task** — Spawn parallel sub-agents for exploration or independent subtasks.
- **websearch** / **webfetch** — Look up external APIs, documentation, or guides when needed.
- **skill** — Load specialized skills for specific task types.

## Constraints

- Work autonomously until the task is complete or blocked.
- If you need clarification or approval, use the existing question or permission flow.
- Use the planner tool throughout to track progress — do not skip it.
- Write memory entries for non-obvious discoveries — if the session is cut short, only written memories survive.
- When finished, ensure all planner tasks are marked completed and provide a final summary.`

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

  return `${renderPlanModePrompt({
    title: input.title,
    request: input.request,
    goals: input.goals,
  })}

## Replan Context

The previous attempt failed. You MUST address the failure before proceeding.

Previous plan context:
${truncatedPrevious}

Failure summary:
${input.failureSummary}

**Instructions for replanning:**
1. Analyze what went wrong in the previous attempt.
2. Use the planner tool to create a NEW task decomposition that addresses the failure.
3. Do not repeat the same approach that failed — adjust your strategy.
4. Continue until all blocking goals are satisfied or you are blocked on external input.`
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
    const [first] = output.clarifications
    if (!first) return undefined
    return {
      reason: first.context ?? "Critical ambiguity requires user clarification before execution.",
      questions: [first],
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
