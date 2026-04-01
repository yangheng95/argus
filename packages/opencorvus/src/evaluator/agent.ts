/**
 * EvaluatorAgent — An independent LLM agent that investigates deliveries,
 * reads code, assesses each goal, and produces a structured verdict.
 *
 * The evaluator is the INDEPENDENT quality gate. It must never be the same
 * agent that wrote or fixed the code. Its job is to verify, not to repair.
 *
 * Two phases:
 * 1. Investigation: LLM uses tools (read_file, search_code, etc.) to examine
 *    the delivery, understand what was built, and verify goal criteria.
 * 2. Judgment: A separate LLM call produces a structured verdict (no tools).
 *
 * The agent decides its own evaluation strategy — which tools to use, how deep
 * to investigate, which goals need more scrutiny — based on the context.
 */
import { streamText, generateObject, stepCountIs } from "ai"
import type { LanguageModelV2 } from "@ai-sdk/provider"
import z from "zod"
import type { TextHooks } from "@/llm/api"
import { Provider } from "@/provider/provider"
import { createEvaluatorTools } from "./tools"
import { Memory } from "@/memory"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { toolGuard } from "@/util/tool-guard"
import { OrchestratorConfig } from "@/orchestrator/config"
import { operatorNotesSection } from "@/orchestrator/helpers"
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
    task: { title: string; request: string; sessionID?: string; taskID?: string }
    goals: GoalInfo[]
    delivery: DeliveryInfo
    checkResults: CheckResult[]
    stream?: TextHooks
  }): Promise<EvaluatorAnalysisType> {
    const language = await agentLanguageModel()
    if (!language) throw new Error("evaluator: no LLM model available")

    const evalCfg = (await OrchestratorConfig.get()).evaluator
    const guard = toolGuard(createEvaluatorTools({ sessionID: input.task.sessionID }))
    const context = prefetchContext(input)

    log.info("evaluator agent starting", {
      title: input.task.title,
      checks: input.checkResults.length,
      goals: input.goals.length,
      changedFiles: input.delivery.changedFiles.length,
      model: language.modelId,
    })

    // ── Phase 1: Investigation ────────────────────────────────────
    // The agent decides its own strategy: which tools to use, how deep
    // to investigate, which goals need more scrutiny.
    const investigationStream = streamText({
      model: language,
      stopWhen: stepCountIs(evalCfg.max_steps),
      tools: guard.tools,
      maxOutputTokens: 4096,
      abortSignal: AbortSignal.any([AbortSignal.timeout(evalCfg.timeout_ms), guard.signal]),
      system: await evaluatorSystem(),
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

    log.info("evaluator investigation finished", {
      steps: investigationSteps.length,
      toolCalls: toolCallCount,
      finishReason: investigationFinishReason,
      findingsLength: investigationText.length,
    })

    // ── Phase 2: Judgment ─────────────────────────────────────────
    // Fresh context with investigation findings → structured verdict.
    const phase2TimeoutMs = Math.max(evalCfg.timeout_ms, 120_000)
    let verdict: z.infer<typeof EvaluatorAnalysis> | undefined
    try {
      const { object } = await generateObject({
        model: language,
        schema: EvaluatorAnalysis,
        maxRetries: 2,
        abortSignal: AbortSignal.timeout(phase2TimeoutMs),
        system: JUDGMENT_SYSTEM,
        prompt: buildJudgmentPrompt(input, investigationText),
      })
      verdict = object
    } catch (err) {
      // Try to recover JSON from markdown code fences
      const rawText = typeof (err as any)?.text === "string" ? (err as any).text : undefined
      if (rawText) {
        const stripped = rawText.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "").trim()
        try {
          verdict = EvaluatorAnalysis.parse(JSON.parse(stripped))
          log.info("evaluator judgment: recovered JSON from code fence")
        } catch { /* recovery failed */ }
      }
      if (!verdict) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        log.warn("evaluator judgment failed", { error: errorMsg })
        throw new Error(`Evaluator judgment failed: ${errorMsg}`)
      }
    }

    log.info("evaluator judgment finished", {
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
// Model resolution
// ---------------------------------------------------------------------------

async function agentLanguageModel(): Promise<LanguageModelV2 | undefined> {
  try {
    const evalCfg = (await OrchestratorConfig.get()).evaluator
    const modelStr = process.env.OPENCORVUS_EVALUATOR_MODEL || evalCfg.model
    let providerID: string
    let modelID: string
    if (modelStr) {
      const parsed = Provider.parseModel(modelStr)
      providerID = parsed.providerID
      modelID = parsed.modelID
    } else {
      const def = await Provider.defaultModel()
      if (!def) return undefined
      providerID = def.providerID
      modelID = def.modelID
    }
    const model = await Provider.getModel(providerID, modelID)
    return await Provider.getLanguage(model)
  } catch (err) {
    log.error("evaluator model resolution failed", { error: String(err) })
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Pre-fetch context
// ---------------------------------------------------------------------------

function prefetchContext(input: {
  task: { title: string; request: string; sessionID?: string }
  checkResults: CheckResult[]
  delivery: DeliveryInfo
}): string {
  const sections: string[] = []
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
  } catch { /* best-effort */ }
  return sections.join("\n\n")
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

function buildInvestigationPrompt(
  input: {
    task: { title: string; request: string; taskID?: string }
    goals: GoalInfo[]
    delivery: DeliveryInfo
    checkResults: CheckResult[]
  },
  context?: string,
): string {
  const sections: string[] = []

  sections.push(`# Task\n\nTitle: ${input.task.title}\nRequest: ${input.task.request}`)

  if (input.task.taskID) {
    const notes = operatorNotesSection(input.task.taskID)
    if (notes) sections.push(notes)
  }

  sections.push(
    `# Goals (${input.goals.length})\n\n` +
      input.goals
        .map(
          (g, i) =>
            `${i}. [${g.priority}] ${g.description}\n   Criteria: ${g.criteria}` +
            (g.check_selector?.length ? `\n   Checks: ${g.check_selector.join(", ")}` : "") +
            (g.requirement_ids?.length ? `\n   Requirements: ${g.requirement_ids.join(", ")}` : ""),
        )
        .join("\n\n"),
  )

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

  sections.push(
    `# Delivery\n\nSummary: ${input.delivery.summary}\n\nChanged files (${input.delivery.changedFiles.length}):\n` +
      input.delivery.changedFiles.map((f) => `- ${f}`).join("\n"),
  )

  if (input.delivery.diffs && input.delivery.diffs.length > 0) {
    const diffText = input.delivery.diffs
      .filter((d) => d.diff)
      .slice(0, 8)
      .map((d) => `--- ${d.file} ---\n${truncate(d.diff!, 1200)}`)
      .join("\n\n")
    if (diffText) sections.push(`# Code Diffs (up to 8 files)\n\n${diffText}`)
  }

  if (context) sections.push(`# Pre-fetched Context\n\n${context}`)

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

    `# Investigation Findings\n\n${investigationFindings || "(no findings)"}`,

    `# Instructions\n\nBased on the investigation findings, produce a structured JSON verdict for all ${input.goals.length} goal(s).\n` +
      `Every goal must have a status with specific evidence from the findings.\n` +
      `Write in the same language as the task request.`,
  ].join("\n\n")
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen) + "\n... (truncated)"
}

function indent(text: string, prefix = "   "): string {
  return text.split("\n").map((line) => prefix + line).join("\n")
}

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const INVESTIGATOR_SYSTEM = `You are an independent evaluator for OpenCorvus. Your job is to investigate a delivery and write a detailed findings report.

You are NOT the delivery agent. You did NOT write this code. You are here to verify it independently.

## Tools Available

- **read_file**: Read file contents — verify implementations, read failing tests
- **find_files**: Find files by glob — discover test files, configs, related modules
- **search_code**: Regex search across codebase — find usages, imports, patterns
- **list_directory**: List directory contents — check file existence, project structure
- **memory_search**: Search for prior failures and known issues
- **memory_write**: Persist failure patterns for future evaluations
- **preference_list**: Check project conventions

## Your Evaluation Strategy

You decide how deep to investigate. Consider:

**Signals that need DEEP investigation (8-15 tool calls):**
- Failed automated checks — you MUST understand the root cause
- Complex multi-goal deliveries — each goal needs independent verification
- Large diffs (10+ files) — more surface area for bugs
- Blocking goals — higher stakes, need thorough evidence

**Signals that allow LIGHTER investigation (3-6 tool calls):**
- All automated checks pass AND few goals AND small diff
- Advisory-only goals (no blocking goals)
- Single-file changes with clear test coverage

**Minimum investigation regardless of signals:**
- Read at least 1-2 changed files to verify the actual implementation
- For every goal, you need SPECIFIC evidence (file path + line number)
- Check tests actually test the right thing (not trivially passing)

## Evidence Standards

Every claim MUST cite a file path and line number from your tool results.

GOOD: "read_file src/auth.ts confirmed: validateToken at lines 23-45 checks expiry and signature."
BAD: "The code looks correct." / "Tests pass." / "Build succeeded."

## Output

Write a findings report (NOT JSON) with:
1. **Evaluation strategy chosen** — why this level of investigation
2. **Per-goal findings** — one section per goal with file:line evidence
3. **Convention compliance** — any violations found
4. **Root cause analysis** — if any failures

When you discover a non-obvious root cause or pattern, use **memory_write** to persist it.

## Rules
- Never fabricate evidence — only cite actual tool results
- Do NOT output JSON or a verdict — that happens in a separate phase
- Do NOT fix code — report problems, let the delivery agent fix them
- Write in the same language as the task request`

const JUDGMENT_SYSTEM = `You are producing a structured verdict based on investigation findings.

## Verdict Rules

- **Accept**: core functionality works, all verifiable criteria pass with evidence.
- **Reject**: concrete code-level failures the executor CAN fix. Must include replan_guidance.
- **Inconclusive**: ONLY for genuinely unmeasurable criteria (runtime metrics, device-specific, UX requiring human eval). Never use for repeated failures.

## Classification

- **transient**: Flaky test, race condition — retry will likely work. Rare.
- **environment**: Missing dependency, wrong runtime.
- **input**: Ambiguous or impossible request.
- **permission**: Missing filesystem/network access.
- **evaluation**: Code partially correct, targeted fixes needed. Most common.
- **strategy**: Fundamental approach wrong, needs different plan.
- **unknown**: Cannot determine. Very rare.

## Replan Guidance (required for "evaluation" and "strategy")

Be specific:
- **root_cause**: The exact technical error with file path and line number.
- **what_failed**: Which component/file/test.
- **suggested_strategy**: Concrete fix, not "fix the bug".
- **avoid_approaches**: What was tried and failed.

## Rules
- goal_statuses MUST include ALL goals, in order.
- Evidence must cite file paths from investigation findings.
- Write in the same language as the task request.`

/** Default evaluator system prompt. Exported for agent registry and prompt catalog. */
export const EVALUATOR_DEFAULT_SYSTEM = INVESTIGATOR_SYSTEM

/** Config-aware resolver: config.prompt.evaluator_system > config.agent.evaluator.prompt > default + skills. */
export async function evaluatorSystem(): Promise<string> {
  const config = await Config.get()
  const systemOverride = (config as Record<string, unknown>).prompt as Record<string, unknown> | undefined
  if (typeof systemOverride?.evaluator_system === "string") return systemOverride.evaluator_system
  const agentPrompt = (config.agent as Record<string, any> | undefined)?.evaluator?.prompt
  const core = typeof agentPrompt === "string" ? agentPrompt : INVESTIGATOR_SYSTEM
  const orchCfg = await OrchestratorConfig.get()
  const skills = await loadStageSkills(orchCfg.evaluator.skills)
  return core + skills
}
