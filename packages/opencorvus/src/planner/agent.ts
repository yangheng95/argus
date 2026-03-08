/**
 * PlannerAgent — An independent-context agent that explores the codebase
 * and generates a comprehensive development plan.
 *
 * Unlike the old one-shot LLM call, this agent:
 * 1. Reads project files (package.json, tsconfig, source code)
 * 2. Searches for relevant patterns and conventions
 * 3. Understands the existing architecture before planning
 * 4. Produces: expanded PRD, goals, milestones, subtask decomposition
 * 5. On replan: receives structured failure analysis and adjusts strategy
 */
import { generateText, stepCountIs } from "ai"
import z from "zod"
import { Provider } from "@/provider/provider"
import { createCodebaseTools } from "@/orchestrator/codebase-tools"
import { Log } from "@/util/log"

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

const MAX_STEPS = 20
const TIMEOUT_MS = 180_000

export namespace PlannerAgent {
  export async function plan(input: {
    title: string
    request: string
    replanContext?: ReplanContext
  }): Promise<PlannerOutputType> {
    const model = await agentModel()
    if (!model) throw new Error("no LLM model available for planner agent")

    const language = await Provider.getLanguage(model)
    const tools = createCodebaseTools()

    const userPrompt = buildUserPrompt(input)

    log.info("planner agent starting", {
      title: input.title,
      isReplan: !!input.replanContext,
      model: `${model.providerID}/${model.id}`,
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

  return PlannerOutput.parse(JSON.parse(raw))
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

function buildUserPrompt(input: {
  title: string
  request: string
  replanContext?: ReplanContext
}): string {
  const sections = [`# Task\n\nTitle: ${input.title}\n\nRequest:\n${input.request}`]

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
    "Now explore the codebase to understand the project, then produce your plan as a JSON object.",
  )
  return sections.join("\n\n")
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const PLANNER_SYSTEM = `You are a senior software architect. Your job is to analyze a development task, explore the codebase thoroughly, and create a comprehensive development plan.

## Your Process

### Phase 1: EXPLORE the codebase (MANDATORY — do not skip)

Before producing any plan, you MUST use the provided tools to understand the project:

1. List the project root to see top-level structure
2. Read package.json (or equivalent) to understand the tech stack, scripts, and dependencies
3. Read the main config files (tsconfig.json, vite.config.ts, etc.) for build configuration
4. List the source directory structure to understand the architecture
5. Read 2-3 key files related to the task to understand existing patterns and conventions
6. Search (grep) for relevant code patterns, function names, or types mentioned in the request

Spend 5-8 tool calls exploring (no more than 12). A blind plan is a bad plan, but spending too long exploring wastes budget. After exploring, STOP using tools and OUTPUT your JSON plan.

### Phase 2: PLAN based on what you learned

Based on your codebase understanding, create a detailed plan:

1. **Expanded PRD**: Rewrite the user's request as a detailed technical specification. Include:
   - What files need to be created or modified (with exact paths from your exploration)
   - What patterns and conventions to follow (based on what you read)
   - What dependencies or APIs to use
   - Edge cases and error handling requirements

2. **Goals**: Specific, measurable acceptance criteria. Each goal must be independently verifiable.

3. **Subtasks**: Ordered steps the coding agent should follow. Each subtask should be small enough to be independently executable.

4. **Milestones**: Group related goals into milestones (optional, for complex tasks).

5. **Risks**: What could go wrong? What assumptions might be wrong?

### Phase 3: OUTPUT as JSON

After exploring and planning, respond with ONLY a JSON object (no markdown fences, no explanation before or after):

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
      "description": "Detailed instructions for what to do",
      "order": 1
    }
  ],
  "risks": ["Risk description"],
  "assumptions": [
    {
      "question": "Ambiguous aspect of the request",
      "assumption": "What we will assume"
    }
  ]
}

## Rules

- ALWAYS explore the codebase before planning. A plan without codebase context is worthless.
- goals.criteria must be concrete and machine-verifiable when possible
- goals.check_selector maps to evaluator checks: build, test, lint, verify_cmd, startup, ui_review, code_quality, code_review, dead_code_review, judge
- Every blocking goal MUST have at least one check_selector
- subtasks should reference specific files and patterns you found during exploration
- Write in the same language as the request (Chinese request → Chinese plan)
- If replanning: your new plan MUST differ from the previous failed approach
- The prd field should be detailed enough that a coding agent can implement without further questions`
