/**
 * EvaluatorAgent — An independent-context agent that analyzes evaluation results,
 * classifies failures, assesses each goal individually, and produces structured
 * replan guidance.
 *
 * Unlike the old exit-code-only evaluator, this agent:
 * 1. Receives automated check results (build/test/lint output)
 * 2. Reads failing test files and changed code to understand root cause
 * 3. Classifies the failure type (transient, strategy, environment, etc.)
 * 4. Evaluates each goal independently against the delivery
 * 5. Produces targeted replan guidance when needed
 */
import { generateText, stepCountIs } from "ai"
import z from "zod"
import { Provider } from "@/provider/provider"
import { createEvaluatorTools } from "./tools"
import { Log } from "@/util/log"

const log = Log.create({ service: "evaluator-agent" })

// ---------------------------------------------------------------------------
// Output schema
// ---------------------------------------------------------------------------

export const FailureClassification = z.enum([
  "transient",
  "environment",
  "input",
  "permission",
  "evaluation",
  "strategy",
  "unknown",
])

export const ReplanGuidance = z.object({
  root_cause: z.string().describe("What actually went wrong at the technical level"),
  what_failed: z.string().describe("Which specific part of the delivery failed"),
  suggested_strategy: z.string().describe("How the next attempt should approach the problem differently"),
  avoid_approaches: z.array(z.string()).describe("Approaches that were tried and failed — do not repeat"),
})

export const GoalAssessment = z.object({
  goal_index: z.number(),
  status: z.enum(["passed", "failed", "inconclusive"]),
  evidence: z.string().describe("Specific evidence supporting this assessment"),
  reasoning: z.string().describe("Why this goal was assessed this way"),
})

export const EvaluatorAnalysis = z.object({
  verdict: z.enum(["accepted", "rejected", "inconclusive"]),
  classification: FailureClassification,
  summary: z.string(),
  goal_statuses: z.array(GoalAssessment),
  replan_guidance: ReplanGuidance.nullish(),
})

export type EvaluatorAnalysisType = z.infer<typeof EvaluatorAnalysis>

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CheckResult {
  name: string
  status: "passed" | "failed" | "skipped"
  evidence?: string
}

export interface GoalInfo {
  description: string
  criteria: string
  priority: "blocking" | "advisory"
  check_selector?: string[]
}

export interface DeliveryInfo {
  summary: string
  changedFiles: string[]
  diffs?: Array<{ file: string; diff?: string }>
}

// ---------------------------------------------------------------------------
// EvaluatorAgent
// ---------------------------------------------------------------------------

const MAX_STEPS = 15
const TIMEOUT_MS = 180_000

export namespace EvaluatorAgent {
  export async function analyze(input: {
    task: { title: string; request: string }
    goals: GoalInfo[]
    delivery: DeliveryInfo
    checkResults: CheckResult[]
  }): Promise<EvaluatorAnalysisType> {
    const model = await agentModel()
    if (!model) throw new Error("no LLM model available for evaluator agent")

    const language = await Provider.getLanguage(model)
    // Full evaluator tool set: codebase exploration + memory + preferences
    const tools = createEvaluatorTools()

    const userPrompt = buildUserPrompt(input)

    log.info("evaluator agent starting", {
      title: input.task.title,
      checks: input.checkResults.length,
      goals: input.goals.length,
      changedFiles: input.delivery.changedFiles.length,
      model: `${model.providerID}/${model.id}`,
    })

    const result = await generateText({
      model: language,
      stopWhen: stepCountIs(MAX_STEPS),
      tools,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
      system: EVALUATOR_SYSTEM,
      prompt: userPrompt,
    })

    const allText = result.text || result.steps.map((s) => s.text).filter(Boolean).join("\n")

    log.info("evaluator agent finished", {
      steps: result.steps.length,
      finishReason: result.finishReason,
      textLength: allText.length,
    })

    const parsed = extractJSON(allText)

    log.info("evaluator agent output", {
      verdict: parsed.verdict,
      classification: parsed.classification,
      goalsPassed: parsed.goal_statuses.filter((g) => g.status === "passed").length,
      goalsFailed: parsed.goal_statuses.filter((g) => g.status === "failed").length,
      hasReplanGuidance: !!parsed.replan_guidance,
    })

    return parsed
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function extractJSON(text: string): EvaluatorAnalysisType {
  let raw = text.trim()

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) raw = fenced[1].trim()

  if (!raw.startsWith("{")) {
    const match = raw.match(/(\{[\s\S]*\})/)
    if (match) raw = match[1]
  }

  const obj = JSON.parse(raw)
  // Normalize empty classification (LLM sometimes leaves it empty for accepted verdicts)
  if (!obj.classification) obj.classification = "evaluation"
  return EvaluatorAnalysis.parse(obj)
}

async function agentModel() {
  const def = await Provider.defaultModel().catch(() => undefined)
  if (def) {
    const model = await Provider.getModel(def.providerID, def.modelID).catch(() => undefined)
    if (model) return model
  }
  // Fallback: DashScope/Qwen (same model as opencode/opencorvus)
  if (process.env.DASHSCOPE_API_KEY) {
    return await Provider.getModel("alibaba-cn", "qwen3.5-plus").catch(() => undefined)
  }
  if (process.env.DEEPSEEK_API_KEY) {
    return await Provider.getModel("deepseek", "deepseek-chat").catch(() => undefined)
  }
  if (process.env.MOONSHOT_API_KEY) {
    return (
      (await Provider.getModel("moonshotai-cn", "kimi-k2.5").catch(() => undefined)) ??
      (await Provider.getModel("moonshotai", "kimi-k2.5").catch(() => undefined))
    )
  }
  return undefined
}

function buildUserPrompt(input: {
  task: { title: string; request: string }
  goals: GoalInfo[]
  delivery: DeliveryInfo
  checkResults: CheckResult[]
}): string {
  const sections: string[] = []

  // Task context
  sections.push(`# Task\n\nTitle: ${input.task.title}\nRequest: ${input.task.request}`)

  // Goals
  sections.push(
    `# Goals (${input.goals.length})\n\n` +
      input.goals
        .map(
          (g, i) =>
            `${i}. [${g.priority}] ${g.description}\n   Criteria: ${g.criteria}` +
            (g.check_selector?.length ? `\n   Checks: ${g.check_selector.join(", ")}` : ""),
        )
        .join("\n\n"),
  )

  // Automated check results
  const failedChecks = input.checkResults.filter((c) => c.status === "failed")
  const passedChecks = input.checkResults.filter((c) => c.status === "passed")

  sections.push(
    `# Automated Check Results\n\n` +
      `Passed: ${passedChecks.length} | Failed: ${failedChecks.length} | Total: ${input.checkResults.length}\n\n` +
      input.checkResults
        .map((c) => {
          const icon = c.status === "passed" ? "PASS" : c.status === "failed" ? "FAIL" : "SKIP"
          const evidence = c.evidence ? `\n   Output:\n${indent(truncate(c.evidence, 1500))}` : ""
          return `[${icon}] ${c.name}${evidence}`
        })
        .join("\n\n"),
  )

  // Delivery summary
  sections.push(
    `# Delivery\n\nSummary: ${input.delivery.summary}\n\nChanged files (${input.delivery.changedFiles.length}):\n` +
      input.delivery.changedFiles.map((f) => `- ${f}`).join("\n"),
  )

  // Diffs (truncated)
  if (input.delivery.diffs && input.delivery.diffs.length > 0) {
    const diffText = input.delivery.diffs
      .filter((d) => d.diff)
      .slice(0, 5)
      .map((d) => `--- ${d.file} ---\n${truncate(d.diff!, 800)}`)
      .join("\n\n")
    if (diffText) {
      sections.push(`# Code Diffs (first 5 files)\n\n${diffText}`)
    }
  }

  sections.push(
    "Analyze the results. If any checks failed, use tools to investigate the root cause. " +
      "Then produce your analysis as a JSON object.",
  )

  return sections.join("\n\n")
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + "\n... (truncated)"
}

function indent(text: string, prefix = "   "): string {
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n")
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

const EVALUATOR_SYSTEM = `You are a senior code reviewer and QA engineer. Your job is to analyze the results of a coding task: review automated check outputs, investigate failures, and assess whether each goal was met.

## Available Tools

- **read_file**: Read file contents with line numbers
- **find_files**: Find files matching a glob pattern
- **search_code**: Search file contents with regex (ripgrep)
- **list_directory**: List files and directories at a path
- **memory_search**: Search project memory for prior failures, known issues, or historical patterns
- **preference_list**: List project conventions to check compliance

## Your Process

### Phase 1: REVIEW the automated check results

Look at each check (build, test, lint, etc.):
- If ALL passed → likely "accepted", but still verify code quality
- If any FAILED → investigate WHY using the tools

### Phase 2: INVESTIGATE failures (if any)

When checks fail, use tools to understand the root cause:
- Read the failing test file to understand what was expected
- Read the changed source files to see what the agent actually did
- Search for related code to understand if the change was correct
- List directories to check for missing or unexpected files
- Find test files related to changed code
- Search memory for similar past failures — the same issue may have been solved before

Spend 3-8 tool calls investigating. Don't guess — verify.

### Phase 2.5: CHECK conventions (if code quality goals exist)

If the goals include code quality, code review, or convention compliance:
- List preferences to see project conventions
- Verify the delivered code follows established patterns
- Check for violations of naming, structure, or documentation conventions

### Phase 3: ASSESS each goal independently

For EACH goal in the input, determine:
- Did the delivery satisfy the criteria?
- What evidence supports your assessment?
- Is the assessment based on check results, code review, or both?

### Phase 4: CLASSIFY the failure (if verdict is "rejected")

- **transient**: Flaky test, network issue, timing problem — retry will likely fix it
- **environment**: Missing dependency, wrong Node version, build tool issue — need env fix
- **input**: Task request is ambiguous or impossible — need user clarification
- **permission**: Agent needed to do something it wasn't allowed to do
- **evaluation**: Code is partially correct but doesn't fully meet criteria — targeted fixes needed
- **strategy**: Fundamental approach is wrong — needs a completely different plan
- **unknown**: Can't determine the cause

### Phase 5: OUTPUT as JSON

Respond with ONLY a JSON object:

{
  "verdict": "accepted|rejected|inconclusive",
  "classification": "transient|environment|input|permission|evaluation|strategy|unknown",
  "summary": "Concise explanation of the verdict",
  "goal_statuses": [
    {
      "goal_index": 0,
      "status": "passed|failed|inconclusive",
      "evidence": "Specific evidence (file names, test names, check output)",
      "reasoning": "Why this goal was assessed this way"
    }
  ],
  "replan_guidance": {
    "root_cause": "Technical root cause of the failure",
    "what_failed": "Which specific component/file/test failed",
    "suggested_strategy": "How to approach it differently next time",
    "avoid_approaches": ["What was tried and failed — don't repeat this"]
  }
}

## Rules

- replan_guidance is REQUIRED when classification is "evaluation" or "strategy"
- goal_statuses MUST include ALL goals from the input, in order
- evidence must reference specific files, test names, or check output — not vague statements
- classification "transient" should be rare — most failures are "evaluation" or "strategy"
- If verdict is "accepted", classification should still be provided (use "evaluation" as default for passed)
- Write in the same language as the task request
- Do NOT fabricate evidence. If you can't determine something, use "inconclusive"`
