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

export const PlanDraft = z.object({
  summary: z.string(),
  prompt: z.string(),
  goals: z.array(
    GoalInput.extend({
      metadata: z
        .object({
          check_selector: z.array(z.string()).optional(),
        })
        .optional(),
    }),
  ),
  metadata: z.object({
    strategy: z.enum(["initial", "replan"]),
    steps: z.array(z.string()),
    failure_summary: z.string().optional(),
    previous_plan_id: z.string().optional(),
    spec_analysis: SpecAnalysis.optional(),
  }),
})

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
  export async function initial(input: { title: string; request: string; goals?: z.infer<typeof GoalInput>[] }) {
    // If user provided explicit goals, skip agent planning
    if (input.goals && input.goals.length > 0) {
      return templatePlan(input.title, input.request, input.goals)
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
      return templatePlan(input.title, input.request, goals)
    }

    return agentOutputToDraft(input.title, input.request, agentResult, "initial")
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
    .sort((a, b) => a.order - b.order)
    .map((s) => `${s.order}. ${s.title}: ${s.description}`)

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
    },
  }
}

function renderAgentPrompt(input: {
  title: string
  request: string
  prd: string
  goals: Array<{ description: string; criteria: string; priority?: string }>
  subtasks: Array<{ title: string; description: string; order: number }>
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

  sections.push(
    `## Goals\n${input.goals
      .map((g, i) => `${i + 1}. [${g.priority ?? "blocking"}] ${g.description}\n   Criteria: ${g.criteria}`)
      .join("\n\n")}`,
  )

  sections.push(
    `## Subtasks (execute in order)\n${input.subtasks
      .sort((a, b) => a.order - b.order)
      .map((s) => `${s.order}. **${s.title}**\n   ${s.description}`)
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
) {
  return {
    summary: summarize(request),
    prompt: renderPlanModePrompt({ title, request, goals }),
    goals,
    metadata: {
      strategy: "initial" as const,
      steps: PLAN_MODE_STEPS,
      spec_analysis: undefined as SpecAnalysisResult | undefined,
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

Follow this structured workflow. Do NOT skip the planning phase.

### Phase 1: Explore & Understand

Before making any changes, gain a thorough understanding of the codebase:

1. **Read relevant files** — Identify the files and modules affected by this task. Use read, glob, and grep tools to explore.
2. **Understand conventions** — Look at existing patterns, naming conventions, test structure, and architecture.
3. **Identify dependencies** — Find what depends on the code you'll change and what your changes depend on.

Use up to 3 parallel agent (Explore) calls if the scope is broad. Use 1 if the task is well-scoped.

### Phase 2: Plan with the Planner Tool

Use the \`planner\` tool to create a structured task decomposition:

1. Call \`planner\` with action \`add_task\` for each major step.
2. Use \`parentId\` to create subtasks where appropriate.
3. Each task should have a clear, verifiable goal.
4. Order tasks logically: setup → core changes → tests → verification.

Example:
  planner({ action: "add_task", goal: "Read and understand the auth module" })
  planner({ action: "add_task", goal: "Implement the new validation logic" })
  planner({ action: "add_task", goal: "Update tests for the validation change" })
  planner({ action: "add_task", goal: "Run build and test to verify" })

### Phase 3: Execute

Work through your plan systematically:

1. Before starting each subtask, update its status to \`in_progress\`.
2. Complete the work for each subtask.
3. Mark each subtask as \`completed\` when done.
4. If blocked, mark the subtask as \`blocked\` and explain why.

### Phase 4: Verify

After implementation:
1. Run the relevant acceptance checks (build, test, lint).
2. Verify that all goals are met.
3. Summarize what changed, what was verified, and any remaining risks.

## Constraints

- Work autonomously until the task is complete or blocked.
- If you need clarification or approval, use the existing question or permission flow.
- Use the planner tool throughout to track progress — do not skip it.
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
