/**
 * Per-goal Eval Agent — autonomous judge for a single goal's delivery.
 *
 * Unlike the old evaluator with predefined check selectors, this agent:
 * - Has NO predefined checks
 * - Reads code to infer test strategy
 * - Detects React/Vue → build+dev server
 * - Detects API → curl/httpie
 * - Detects DB → migration check
 * - Can run_command arbitrary commands
 *
 * Observation domain (from SVG spec):
 *   • GoalContract (esp. done_definition)
 *   • executor delivery + diff
 *   • project files (tools)
 *   • run_command (tools)
 *   • Decision Log
 *   • user original input
 *   • NO predefined checks
 */
import { streamText, stepCountIs } from "ai"
import { Provider } from "@/provider/provider"
import { createPlannerTools } from "@/planner/tools"
import { toolGuard } from "@/util/tool-guard"
import { Log } from "@/util/log"
import { AgentTrace } from "@/util/agent-trace"
import { OrchestratorConfig } from "@/orchestrator/config"
import { extractTag } from "@/util/parse-section-tags"
import type { TextHooks } from "@/llm/api"
import type { GoalContract, PipelineDelivery, EvalVerdict, FailureClass } from "@/pipeline/types"
import type { DecisionLog } from "@/decision-log"

const log = Log.create({ service: "pipeline-evaluator" })

/**
 * Evaluate a goal's delivery against its done_definition.
 *
 * The eval agent is autonomous — it reads the code, infers what tests to run,
 * executes them, and produces a verdict. No check selectors or predefined
 * evaluation pipeline.
 */
export async function evaluateGoal(input: {
  contract: GoalContract
  delivery: PipelineDelivery
  decisionLog?: DecisionLog
  workDir?: string
  sessionID?: string
  signal?: AbortSignal
  stream?: TextHooks
}): Promise<EvalVerdict> {
  const { contract, delivery, signal } = input
  const { goal, task } = contract

  if (signal?.aborted) throw new Error("eval aborted")

  const orchCfg = await OrchestratorConfig.get()
  const MAX_STEPS = orchCfg.evaluator?.max_steps ?? 30
  const TIMEOUT_MS = orchCfg.evaluator?.timeout_ms ?? 300_000

  const def = await Provider.defaultModel().catch(() => undefined)
  if (!def) throw new Error("no LLM model available for per-goal evaluator")
  const model = await Provider.getModel(def.providerID, def.modelID)
  const language = await Provider.getLanguage(model)

  const guard = toolGuard(createPlannerTools(input.workDir, input.sessionID))

  // Build Decision Log section
  let decisionSection = ""
  if (input.decisionLog) {
    decisionSection = input.decisionLog.toPromptSection()
  }

  const systemPrompt = buildEvalSystem()
  const userPrompt = buildEvalPrompt(contract, delivery, decisionSection, task.request)

  const baseSignal = signal ?? AbortSignal.timeout(TIMEOUT_MS)
  const stream = streamText({
    model: language,
    stopWhen: stepCountIs(MAX_STEPS),
    tools: guard.tools,
    maxOutputTokens: 16384,
    abortSignal: AbortSignal.any([baseSignal, guard.signal]),
    system: systemPrompt,
    messages: [{ role: "user" as const, content: userPrompt }],
    ...(input.stream?.onChunk ? { onChunk: input.stream.onChunk as any } : {}),
    ...(input.stream?.onError ? { onError: input.stream.onError } : {}),
    onStepFinish: guard.onStepFinish as any,
  })

  const [resultText, resultSteps] = await Promise.all([
    stream.text,
    stream.steps,
  ])

  let allText = resultText?.trim() || ""
  if (!allText) {
    allText = resultSteps.map((s) => s.text).filter(Boolean).join("\n")
  }

  const toolCallCount = resultSteps.reduce(
    (sum, s) => sum + (Array.isArray((s as any).toolCalls) ? (s as any).toolCalls.length : 0),
    0,
  )

  log.info("per-goal evaluator finished", {
    goalID: goal.id,
    textLength: allText.length,
    toolCalls: toolCallCount,
  })

  AgentTrace.capture("pipeline-evaluator", 1,
    { system: systemPrompt, messages: [{ role: "user", content: userPrompt }] },
    allText,
    { goalID: goal.id, model: language.modelId, toolCalls: toolCallCount },
  )

  return parseEvalOutput(allText, goal.id)
}

// ---------------------------------------------------------------------------
// Parse eval output into EvalVerdict
// ---------------------------------------------------------------------------

function parseEvalOutput(text: string, goalID: string): EvalVerdict {
  const verdictRaw = extractTag(text, "verdict")?.trim().toLowerCase()
  const evidenceRaw = extractTag(text, "evidence") || ""
  const reasoningRaw = extractTag(text, "reasoning") || text
  const failureClassRaw = extractTag(text, "failure_class")?.trim().toLowerCase()

  const pass = verdictRaw === "pass" || verdictRaw === "accepted"
  const verdict = pass ? "accepted" as const : verdictRaw === "inconclusive" ? "inconclusive" as const : "rejected" as const

  const evidence = evidenceRaw
    .split("\n")
    .map(line => line.trim().replace(/^[-•]\s*/, ""))
    .filter(Boolean)

  let failureClass: FailureClass | undefined
  if (!pass && failureClassRaw) {
    if (failureClassRaw === "bug" || failureClassRaw === "plan_wrong" || failureClassRaw === "goal_wrong") {
      failureClass = failureClassRaw
    } else {
      failureClass = "bug" // default to most common
    }
  }

  if (evidence.length === 0 && !pass) {
    evidence.push("No specific evidence provided by eval agent")
  }

  log.info("eval verdict parsed", { goalID, verdict, pass, failureClass, evidenceCount: evidence.length })

  return {
    pass,
    verdict,
    evidence,
    reasoning: reasoningRaw.slice(0, 2000), // cap reasoning length
    failureClass,
  }
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildEvalSystem(): string {
  return [
    "You are an autonomous evaluation agent for OpenCorvus.",
    "You judge whether a goal's implementation satisfies its done_definition.",
    "",
    "## Your Process",
    "",
    "1. READ the goal's done_definition carefully — this is your ONLY acceptance criteria",
    "2. EXAMINE the executor's delivery (changed files, diffs)",
    "3. EXPLORE the codebase to understand the context",
    "4. INFER what tests/checks to run based on the code:",
    "   - TypeScript/JavaScript project → look for test runner (bun test, vitest, jest), run it",
    "   - React/Vue app → check build succeeds (npm run build / bun run build)",
    "   - API endpoint → test with curl or by reading test files",
    "   - Database changes → verify migrations",
    "   - Config changes → validate syntax",
    "5. RUN the tests/checks using run_command",
    "6. CHECK for owned_paths violations (files modified outside owned_paths = REJECT)",
    "7. PRODUCE your verdict",
    "",
    "## Rules",
    "",
    "- You have NO predefined checks. YOU decide what to test based on the code.",
    "- Use run_command to actually execute tests, build, lint, etc.",
    "- A goal passes ONLY if done_definition is fully satisfied",
    "- If tests fail, classify WHY:",
    "  - bug: code has errors that can be fixed by re-executing",
    "  - plan_wrong: the implementation approach is fundamentally wrong",
    "  - goal_wrong: the goal itself is poorly defined or impossible",
    "",
    "## Output Format",
    "",
    "<verdict>pass | fail | inconclusive</verdict>",
    "<evidence>",
    "- Evidence item 1 (test output, check result, observation)",
    "- Evidence item 2",
    "</evidence>",
    "<reasoning>",
    "Why you reached this verdict. Reference specific test outputs and code.",
    "</reasoning>",
    "<failure_class>bug | plan_wrong | goal_wrong</failure_class>",
    "(only include failure_class if verdict is fail)",
  ].join("\n")
}

function buildEvalPrompt(
  contract: GoalContract,
  delivery: PipelineDelivery,
  decisionSection: string,
  taskRequest: string,
): string {
  const { goal } = contract
  const sections: string[] = []

  sections.push(`# Goal Contract\n\n**${goal.title}**\n\nDone Definition (YOUR ACCEPTANCE CRITERIA):\n${goal.done_definition}`)

  if (goal.owned_paths.length > 0) {
    sections.push(`## Owned Paths (file boundary — changes outside = violation)\n\n${goal.owned_paths.map(p => `- ${p}`).join("\n")}`)
  }

  // Delivery summary
  sections.push(`## Executor Delivery\n\nSummary: ${delivery.summary}\n\nChanged files (${delivery.diffs.length}):`)
  for (const diff of delivery.diffs.slice(0, 50)) {
    const status = diff.status ?? "modified"
    const adds = diff.additions ?? 0
    const dels = diff.deletions ?? 0
    sections.push(`- ${diff.file} [${status}] +${adds}/-${dels}`)
  }
  if (delivery.diffs.length > 50) {
    sections.push(`... and ${delivery.diffs.length - 50} more files`)
  }

  sections.push(`## Task Context\n\n${taskRequest}`)

  if (decisionSection) {
    sections.push(decisionSection)
  }

  sections.push(
    "Now examine the delivery, explore the codebase, run appropriate tests, " +
    "and produce your evaluation verdict using the output tags.",
  )

  return sections.join("\n\n")
}
