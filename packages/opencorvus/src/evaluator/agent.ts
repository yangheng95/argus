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
import { streamText, generateObject, stepCountIs } from "ai"
import type { LanguageModelV2 } from "@ai-sdk/provider"
import z from "zod"
import type { TextHooks } from "@/llm/api"
import { verificationHints } from "@/check/policy"
import { Provider } from "@/provider/provider"
import { createEvaluatorTools } from "./tools"
import { Memory } from "@/memory"
import { Preference } from "@/preference"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { toolGuard } from "@/util/tool-guard"
import { OrchestratorConfig } from "@/orchestrator/config"
import { loadStageSkills } from "@/orchestrator/skill-inject"
import { Config } from "@/config/config"

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

/** Alias used by the orchestrator persist layer and delivery agent. */
export type GoalJudgmentType = EvaluatorAnalysisType

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
  requirement_ids?: string[]
}

export interface DeliveryInfo {
  summary: string
  changedFiles: string[]
  diffs?: Array<{ file: string; diff?: string }>
}

// ---------------------------------------------------------------------------
// EvaluatorAgent
// ---------------------------------------------------------------------------

export namespace EvaluatorAgent {
  export async function analyze(input: {
    task: { title: string; request: string; sessionID?: string }
    goals: GoalInfo[]
    delivery: DeliveryInfo
    checkResults: CheckResult[]
    stream?: TextHooks
  }): Promise<EvaluatorAnalysisType> {
    const language = await agentLanguageModel()
    if (!language) throw new Error("evaluator: no LLM model available")

    const evalCfg = (await OrchestratorConfig.get()).evaluator

    // Full evaluator tool set: codebase exploration + memory + preferences
    const guard = toolGuard(createEvaluatorTools({ sessionID: input.task.sessionID }))

    // Pre-fetch context: historical failures + preferences (like planner's prefetchContext)
    const context = prefetchEvaluatorContext(input)

    log.info("evaluator agent starting", {
      title: input.task.title,
      checks: input.checkResults.length,
      goals: input.goals.length,
      changedFiles: input.delivery.changedFiles.length,
      model: language.modelId,
      prefetchedContext: context.length > 0,
      config: evalCfg,
    })

    // ── Phase 1: Investigation ────────────────────────────────────────────────
    // LLM explores the codebase using tools and writes a findings report.
    // Context may grow large here — that's fine. We only need the TEXT summary.
    const investigationStream = streamText({
      model: language,
      stopWhen: stepCountIs(evalCfg.max_steps),
      tools: guard.tools,
      maxOutputTokens: 4096,
      abortSignal: AbortSignal.any([AbortSignal.timeout(evalCfg.timeout_ms), guard.signal]),
      system: await goalJudgeSystem(),
      prompt: buildInvestigationPrompt(input, context),
      ...(input.stream as TextHooks<typeof guard.tools> | undefined),
      onStepFinish: guard.onStepFinish as any,
    })
    const [investigationText, investigationSteps, investigationFinishReason] = await Promise.all([
      investigationStream.text,
      investigationStream.steps,
      investigationStream.finishReason,
    ])

    const toolCallCount = investigationSteps.reduce(
      (sum, s) => sum + (Array.isArray((s as any).toolCalls) ? (s as any).toolCalls.length : 0),
      0,
    )

    log.info("evaluator phase 1 (investigation) finished", {
      steps: investigationSteps.length,
      toolCalls: toolCallCount,
      finishReason: investigationFinishReason,
      findingsLength: investigationText.length,
    })

    // ── Phase 2: Judgment ─────────────────────────────────────────────────────
    // Fresh context: investigation findings + compact task summary → structured verdict.
    // generateObject guarantees schema-complete output regardless of project size.
    const { object: verdict } = await generateObject({
      model: language,
      schema: EvaluatorAnalysis,
      maxRetries: 2,
      system: JUDGMENT_SYSTEM,
      prompt: buildJudgmentPrompt(input, investigationText),
    })

    log.info("evaluator phase 2 (judgment) finished", {
      verdict: verdict.verdict,
      classification: verdict.classification,
      goalsPassed: verdict.goal_statuses.filter((g) => g.status === "passed").length,
      goalsFailed: verdict.goal_statuses.filter((g) => g.status === "failed").length,
      hasReplanGuidance: !!verdict.replan_guidance,
    })

    return verdict
  }
}


// ---------------------------------------------------------------------------
// Model resolution — same 3-tier strategy as planner agent
// ---------------------------------------------------------------------------

/**
 * Resolve a LanguageModelV2 for the evaluator agent.
 *
 * Strategy:
 * 1. Resolve the default model from Provider
 * 2. Load that exact model and language surface
 * 3. If that fails, surface the evaluator failure directly
 */
async function agentLanguageModel(): Promise<LanguageModelV2 | undefined> {
  try {
    const def = await Provider.defaultModel()
    if (!def) return undefined
    log.info("evaluator: default model resolved", { providerID: def.providerID, modelID: def.modelID })
    const model = await Provider.getModel(def.providerID, def.modelID)
    const language = await Provider.getLanguage(model)
    log.info("evaluator: model ready via Provider", { modelId: language.modelId })
    return language
  } catch (err) {
    log.error("evaluator: model resolution failed", { error: String(err) })
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Pre-fetch context — give the evaluator a head start before tool calls
// ---------------------------------------------------------------------------

function prefetchEvaluatorContext(input: {
  task: { title: string; request: string; sessionID?: string }
  checkResults: CheckResult[]
  delivery: DeliveryInfo
}): string {
  const sections: string[] = []

  // 1. Search memory for similar past failures
  try {
    const projectId = Instance.project.id
    const failedChecks = input.checkResults.filter((c) => c.status === "failed")
    if (failedChecks.length > 0) {
      const query = failedChecks.map((c) => c.name).join(" ") + " failure " + input.task.title
      const recalled = Memory.promptSection({
        query,
        projectId,
        sessionID: input.task.sessionID,
        scope: "all",
        limit: 3,
        minScore: 0.15,
        heading: "Historical Context (Auto-Recalled)",
        includeEpisodes: true,
      })
      if (recalled) sections.push(recalled)
    }
  } catch {
    // best-effort
  }

  // 2. Inject active preferences for convention checking
  try {
    const projectId = Instance.project.id
    const prefs = Preference.merged({ projectID: projectId })
    if (prefs.length > 0) {
      const items = prefs.map((p) => `- **${p.key}**: ${p.value}`).join("\n")
      sections.push(`## Active Preferences (BINDING — check compliance)\n\n${items}`)
    }
  } catch {
    // best-effort
  }

  return sections.length > 0 ? sections.join("\n\n") : ""
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

function buildInvestigationPrompt(
  input: {
    task: { title: string; request: string }
    goals: GoalInfo[]
    delivery: DeliveryInfo
    checkResults: CheckResult[]
  },
  context?: string,
): string {
  const sections: string[] = []

  // Task context
  sections.push(`# Task\n\nTitle: ${input.task.title}\nRequest: ${input.task.request}`)

  // Goals — with verification guidance per goal
  sections.push(
    `# Goals (${input.goals.length})\n\n` +
      `You MUST assess EVERY goal below. For each, determine pass/fail with SPECIFIC evidence.\n\n` +
      input.goals
        .map(
          (g, i) =>
            `${i}. [${g.priority}] ${g.description}\n   Criteria: ${g.criteria}` +
            (g.check_selector?.length ? `\n   Checks: ${g.check_selector.join(", ")}` : "") +
            (g.requirement_ids?.length ? `\n   Requirements: ${g.requirement_ids.join(", ")}` : "") +
            `\n   → Verification: ${goalVerificationHint(g)}`,
        )
        .join("\n\n"),
  )

  // Automated check results — with analysis hints
  const failedChecks = input.checkResults.filter((c) => c.status === "failed")
  const passedChecks = input.checkResults.filter((c) => c.status === "passed")

  sections.push(
    `# Automated Check Results\n\n` +
      `Passed: ${passedChecks.length} | Failed: ${failedChecks.length} | Total: ${input.checkResults.length}\n\n` +
      input.checkResults
        .map((c) => {
          const icon = c.status === "passed" ? "PASS" : c.status === "failed" ? "FAIL" : "SKIP"
          const evidence = c.evidence ? `\n   Output:\n${indent(truncate(c.evidence, 2000))}` : ""
          return `[${icon}] ${c.name}${evidence}`
        })
        .join("\n\n"),
  )

  // Delivery summary
  sections.push(
    `# Delivery\n\nSummary: ${input.delivery.summary}\n\nChanged files (${input.delivery.changedFiles.length}):\n` +
      input.delivery.changedFiles.map((f) => `- ${f}`).join("\n"),
  )

  // Diffs (with more generous truncation)
  if (input.delivery.diffs && input.delivery.diffs.length > 0) {
    const diffText = input.delivery.diffs
      .filter((d) => d.diff)
      .slice(0, 8)
      .map((d) => `--- ${d.file} ---\n${truncate(d.diff!, 1200)}`)
      .join("\n\n")
    if (diffText) {
      sections.push(`# Code Diffs (up to 8 files)\n\n${diffText}`)
    }
  }

  // Pre-fetched context (historical failures + preferences)
  if (context) {
    sections.push(`# Pre-fetched Context\n\n${context}`)
  }

  // Final instruction for investigation phase
  if (failedChecks.length > 0) {
    sections.push(
      "IMPORTANT: There are FAILED checks. Investigate each failure using tools.\n" +
        "1. read_file on the failing test/source to understand WHAT failed\n" +
        "2. read_file on the changed files to understand WHAT was delivered\n" +
        "3. Compare: does the delivery match the goal criteria?\n" +
        "4. Write a detailed findings report — do NOT output JSON yet.",
    )
  } else {
    sections.push(
      "All automated checks passed. Verify code quality by reading the changed files, checking convention compliance, " +
        "and assessing whether each goal's criteria is truly satisfied (not just that checks pass). " +
        "Write a detailed findings report — do NOT output JSON yet.",
    )
  }

  return sections.join("\n\n")
}

function buildJudgmentPrompt(
  input: {
    task: { title: string; request: string }
    goals: GoalInfo[]
    delivery: DeliveryInfo
    checkResults: CheckResult[]
  },
  investigationFindings: string,
): string {
  const failedChecks = input.checkResults.filter((c) => c.status === "failed")
  const passedChecks = input.checkResults.filter((c) => c.status === "passed")

  return [
    `# Task\n\nTitle: ${input.task.title}\nRequest: ${input.task.request}`,

    `# Goals (${input.goals.length})\n\n` +
      input.goals
        .map(
          (g, i) =>
            `${i}. [${g.priority}] ${g.description}\n   Criteria: ${g.criteria}` +
            (g.check_selector?.length ? `\n   Checks: ${g.check_selector.join(", ")}` : ""),
        )
        .join("\n\n"),

    `# Automated Check Results\n\nPassed: ${passedChecks.length} | Failed: ${failedChecks.length}\n\n` +
      input.checkResults
        .map((c) => {
          const icon = c.status === "passed" ? "PASS" : c.status === "failed" ? "FAIL" : "SKIP"
          const evidence = c.evidence ? `\n   ${truncate(c.evidence, 800)}` : ""
          return `[${icon}] ${c.name}${evidence}`
        })
        .join("\n\n"),

    `# Investigation Findings\n\n${investigationFindings || "(no findings — investigation produced no output)"}`,

    `# Instructions\n\nBased on the investigation findings above, produce a structured verdict for all ${input.goals.length} goal(s). ` +
      `Every goal must have a status (passed/failed/inconclusive) with specific evidence from the findings. ` +
      `Write in the same language as the task request.`,
  ].join("\n\n")
}

function goalVerificationHint(goal: GoalInfo): string {
  const selectors = goal.check_selector ?? []
  const text = `${goal.description} ${goal.criteria}`
  return verificationHints(selectors, text).join("; ")
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

// Phase 1: Investigation system prompt — tool calls allowed, output is a findings report (not JSON)
const INVESTIGATOR_SYSTEM = `You are a senior code reviewer acting as the investigation phase for OpenCorvus's evaluator.

Your ONLY job in this phase is to investigate the delivery using tools and write a detailed findings report.
Do NOT output JSON. Do NOT produce a verdict. Write prose findings only — the judgment phase will produce the verdict separately.

A shallow investigation is WORSE than no investigation — it causes the orchestrator to retry blindly. Investigate deeply.

## Available Tools

- **read_file**: Read file contents with line numbers — use to verify code changes, read failing tests, check implementations
- **find_files**: Find files matching a glob pattern — use to discover test files, config files, related modules
- **search_code**: Search file contents with regex (ripgrep) — use to find imports, usages, patterns across the codebase
- **list_directory**: List files and directories at a path — use to verify file existence, check project structure
- **memory_search**: Search project memory for prior failures, known issues, historical patterns
- **preference_list**: List project conventions and constraints (BINDING — violations are real failures)

## Investigation Process

### Phase 0: RECALL (1-2 tool calls)
1. **memory_search** with failure-related keywords. If pre-fetched memory exists in the prompt, only fill gaps.
2. **preference_list** unless already pre-fetched.

### Phase 1: REVIEW check results (no tool calls)
Note what passed/failed from the automated check results in the prompt.

### Phase 2: INVESTIGATE (5-10 tool calls — most important)

**When checks FAILED:**
1. read_file the failing test → understand what assertion failed and what was expected
2. read_file 2-3 changed source files → understand what was actually implemented
3. search_code for the failing function/class → find definition, imports, usages
4. read_file related existing code → understand expected patterns and interfaces
5. find_files for related test files → check if other tests should have been updated
6. list_directory on affected dirs → verify expected files exist

**When ALL checks PASSED:**
1. read_file 3-5 changed files → verify correctness, not just syntactic validity
2. search_code for key patterns from the goals → verify the feature actually works
3. read_file test files → verify tests aren't trivially passing
4. find_files for config/build files → verify no stale references

### Phase 2.5: CONVENTION CHECK (1-3 tool calls)
Verify changed code follows preferences. Convention violations ARE failures.

## Evidence Quality

**GOOD evidence** (cite this way):
> read_file src/middleware.ts confirmed: MiddlewareChain class implements onion model with before/after hooks at lines 15-42. next() correctly propagates through chain.

**BAD evidence** (never write this):
> Tests pass. The code looks correct. Build succeeded.

Every claim must cite a specific file path and line number from actual tool results.

## Output Format

After tool calls, write a findings report with these sections:
1. **Check Results Summary**: what each automated check returned
2. **Per-goal findings** (one section per goal, numbered): what was found, file:line evidence, whether the criteria is satisfied
3. **Convention compliance**: any violations found
4. **Root cause analysis** (if any failures): the specific technical cause

## Quality Self-Check

Before writing the report, verify:
1. Did you make at least 3 tool calls? If not, investigate more.
2. Does every goal finding cite specific file paths and line numbers? If not, go read the files.
3. If there are failures, do you know the specific root cause (not "test failed" but "function X at line Y does Z instead of W")?

Rules:
- Every claim must come from actual tool results — never fabricate.
- Write in the same language as the task request.
- Do NOT output JSON or a verdict.`

// Phase 2: Judgment system prompt — no tools, structured output via generateObject
const JUDGMENT_SYSTEM = `You are the judgment phase for OpenCorvus's evaluator.

You receive a detailed investigation report and must produce a structured verdict. No tools available — base everything on the findings provided.

## Verdict Rules

- **Accept** when core functionality is implemented and all verifiable criteria pass with evidence.
- **Reject** when there are CONCRETE, CODE-LEVEL failures the executor CAN fix (missing files, broken logic, failing tests). Rejection MUST include specific replan_guidance so the executor knows exactly what to fix.
- **Inconclusive** ONLY for criteria that are genuinely unmeasurable in the current environment (runtime metrics like "sync rate ≥ 99%", device-specific features, UX criteria requiring human evaluation). Do NOT use inconclusive as a substitute for repeated failures — a test that fails 3 times is a real failure, not an inconclusive result.
- If the same failure has occurred in prior runs, the rejection replan_guidance MUST explain why previous attempts failed and suggest a DIFFERENT approach. The orchestrator uses replan_guidance to decide between retry and replan — vague guidance causes blind retries.

## Classification

Choose ONE based on the investigation findings:
- **transient**: Flaky test, race condition — retry same approach will likely work. RARE.
- **environment**: Missing dependency, wrong runtime, build tool misconfiguration.
- **input**: Task request is ambiguous, contradictory, or impossible.
- **permission**: Agent needed filesystem/network access it didn't have.
- **evaluation**: Code partially correct but doesn't fully meet criteria — targeted fixes needed. MOST COMMON.
- **strategy**: Fundamental approach is wrong — needs completely different plan.
- **unknown**: Cannot determine after investigation. Should be very rare.

## Replan Guidance (required for "evaluation" and "strategy")

Provide specific, actionable guidance:
- **root_cause**: The specific technical error. Not "test failed" but "parseConfig() returns undefined when input has no 'port' field because line 23 destructures without default"
- **what_failed**: Which component/file/test and how. Include file paths and line numbers.
- **suggested_strategy**: Concrete alternative. Not "fix the bug" but "add default value for port in parseConfig() at src/config.ts:23"
- **avoid_approaches**: What was tried and didn't work. Specific, not vague.

## Goal Status Evidence

Every goal_status must have evidence that cites specific file paths, test names, or line numbers from the investigation findings.

**GOOD:**
> "evidence": "Findings confirm: MiddlewareChain at src/middleware.ts:15-42 implements onion model. Test 'executes in onion order' at src/middleware.test.ts:23 passes."

**BAD:**
> "evidence": "Tests pass." / "Code looks correct." / "Build succeeded."

## Rules

- Base verdict ONLY on the investigation findings — do not guess or fabricate.
- goal_statuses MUST include ALL goals from the input, in order.
- replan_guidance is REQUIRED when classification is "evaluation" or "strategy".
- Write in the same language as the task request.`

/** Default evaluator system prompt (investigation phase). Exported for catalog. */
export const EVALUATOR_DEFAULT_SYSTEM = INVESTIGATOR_SYSTEM

/** Config-aware resolver: checks config.prompt.evaluator_system first, then config.agent.evaluator.prompt, otherwise the default + skills. */
export async function goalJudgeSystem(): Promise<string> {
  const config = await Config.get()
  const systemOverride = (config as Record<string, unknown>).prompt as Record<string, unknown> | undefined
  if (typeof systemOverride?.evaluator_system === "string") return systemOverride.evaluator_system
  const agentPrompt = (config.agent as Record<string, any> | undefined)?.evaluator?.prompt
  const core = typeof agentPrompt === "string" ? agentPrompt : INVESTIGATOR_SYSTEM
  const orchCfg = await OrchestratorConfig.get()
  const skills = await loadStageSkills(orchCfg.evaluator.skills)
  return core + skills
}
