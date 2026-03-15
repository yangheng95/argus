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
import { stepCountIs, tool } from "ai"
import type { LanguageModelV2 } from "@ai-sdk/provider"
import z from "zod"
import { verificationHints } from "@/check/policy"
import { Provider } from "@/provider/provider"
import { createEvaluatorTools } from "./tools"
import { Memory } from "@/memory"
import { Preference } from "@/preference"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { Env } from "@/env"
import { completeText, type TextHooks } from "@/llm/api"
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

const MAX_STEPS = 25

function evaluatorTimeoutMs() {
  const raw = Env.get("OPENCORVUS_EVALUATOR_AGENT_TIMEOUT_MS")
  const parsed = Number.parseInt(raw ?? "", 10)
  return Number.isFinite(parsed) ? parsed : 480_000
}

type AnalyzeInput = {
  task: { title: string; request: string; sessionID?: string }
  goals: GoalInfo[]
  delivery: DeliveryInfo
  checkResults: CheckResult[]
  stream?: TextHooks
}

export namespace EvaluatorAgent {
  export async function analyze(input: AnalyzeInput): Promise<EvaluatorAnalysisType> {
    const resolved = await agentLanguageModel()
    if (!resolved) throw new Error("Evaluator analysis model is unavailable")
    const { language, isReasoning } = resolved
    const timeoutMs = evaluatorTimeoutMs()

    // Full evaluator tool set: codebase exploration + memory + preferences
    const explorationTools = createEvaluatorTools({ sessionID: input.task.sessionID })
    let submittedAnalysis: EvaluatorAnalysisType | undefined
    const tools = {
      ...explorationTools,
      submit_analysis: tool({
        description:
          "Submit the final evaluation analysis after investigation. " +
          "Call this tool ONCE when you have finished investigating and are ready to deliver the analysis.",
        inputSchema: EvaluatorAnalysis,
        execute: async (args) => {
          submittedAnalysis = args as EvaluatorAnalysisType
          return "Evaluation analysis submitted successfully."
        },
      }),
    }

    // Pre-fetch context: historical failures + preferences (like planner's prefetchContext)
    const context = prefetchEvaluatorContext(input)
    const userPrompt = buildUserPrompt(input, context)

    log.info("evaluator agent starting", {
      title: input.task.title,
      checks: input.checkResults.length,
      goals: input.goals.length,
      changedFiles: input.delivery.changedFiles.length,
      model: language.modelId,
      prefetchedContext: context.length > 0,
    })

    const MAX_RETRIES = 2
    let parsed: EvaluatorAnalysisType | undefined
    let lastError: Error | undefined
    let toolCallCount = 0

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        log.info("evaluator agent retrying", { attempt, reason: lastError?.message })
      }
      submittedAnalysis = undefined

      let result: {
        text?: string
        finishReason?: string
        steps: Array<{ text?: string; toolCalls?: unknown[]; toolResults?: unknown[] }>
      }
      try {
        result = await completeText({
          model: language,
          stopWhen: stepCountIs(MAX_STEPS),
          tools,
          // reasoning models (e.g. qwen3.5-plus) reject toolChoice="required" — use "auto" instead
          toolChoice: isReasoning ? "auto" : "required",
          maxOutputTokens: 16384,
          timeoutMs,
          abortSignal: AbortSignal.timeout(timeoutMs),
          system: await evaluatorSystem(),
          prompt: userPrompt,
          ...(input.stream ?? {}),
        })
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        log.warn("evaluator agent generateText failed", { attempt, error: lastError.message })
        continue
      }

      toolCallCount = result.steps.reduce(
        (sum, s) => {
          const step = s as { toolCalls?: unknown[] }
          return sum + (Array.isArray(step.toolCalls) ? step.toolCalls.length : 0)
        },
        0,
      )

      log.info("evaluator agent finished", {
        attempt,
        steps: result.steps.length,
        toolCalls: toolCallCount,
        finishReason: result.finishReason,
        textLength: collectText(result).length,
      })

      try {
        if (submittedAnalysis) {
          parsed = normalizeAnalysis(submittedAnalysis, input.goals.length)
        } else {
          let allText = collectText(result)
          if (!allText.trim()) {
            log.warn("evaluator: primary run produced no final text or submit_analysis call, forcing consolidation", {
              attempt,
              steps: result.steps.length,
              finishReason: result.finishReason,
            })
            const forced = await finalizeAnalysis(language, input, result.steps, timeoutMs, isReasoning, input.stream)
            if (forced.submittedAnalysis) {
              submittedAnalysis = forced.submittedAnalysis
              parsed = normalizeAnalysis(submittedAnalysis, input.goals.length)
            } else {
              allText = collectText(forced.result)
              parsed = extractJSON(allText, input.goals.length)
            }
          } else {
            parsed = extractJSON(allText, input.goals.length)
          }
        }
      } catch (err) {
        lastError = new Error(`Evaluator analysis returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`)
        log.warn("evaluator: JSON extraction failed, will retry", {
          attempt,
          error: String(err),
          textLength: collectText(result).length,
        })
        continue
      }

      const MIN_TOOL_CALLS = 3
      if (toolCallCount < MIN_TOOL_CALLS) {
        lastError = new Error(`Evaluator analysis was too shallow (${parsed.verdict}): only ${toolCallCount}/${MIN_TOOL_CALLS} required tool calls`)
        log.warn("evaluator: agent made too few tool calls, will retry", { attempt, verdict: parsed.verdict, toolCalls: toolCallCount })
        parsed = undefined
        continue
      }

      break
    }

    if (!parsed) {
      throw lastError ?? new Error("Evaluator analysis failed after retries")
    }

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

export const parseEvaluatorAnalysis = extractJSON

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function extractJSON(text: string, goalCount: number): EvaluatorAnalysisType {
  let raw = text.trim()

  const fencedComplete = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fencedComplete) {
    raw = fencedComplete[1].trim()
  } else {
    const fencedOpen = raw.match(/```(?:json)?\s*([\s\S]*)/)
    if (fencedOpen && fencedOpen[1].includes("{")) {
      raw = fencedOpen[1].trim()
    }
  }

  if (!raw.startsWith("{")) {
    const match = raw.match(/(\{[\s\S]*\})/)
    if (match) {
      raw = match[1]
    } else {
      const idx = raw.indexOf("{")
      if (idx >= 0) raw = raw.slice(idx)
    }
  }

  raw = sanitizeJSON(raw)

  // Handle truncated JSON — same repair logic as planner agent
  if (raw.startsWith("{") && !raw.endsWith("}")) {
    log.warn("evaluator: JSON appears truncated, attempting repair", { length: raw.length, tail: raw.slice(-100) })
    raw = repairTruncatedJSON(raw)
  }

  let obj: any
  const parseErr = tryParse(raw)
  if (parseErr.ok) {
    obj = parseErr.value
  } else {
    const trimmed = trimToLastComplete(raw)
    const retryErr = tryParse(trimmed)
    if (retryErr.ok) {
      log.warn("evaluator: repaired truncated JSON by trimming", {
        originalLength: raw.length,
        trimmedLength: trimmed.length,
      })
      obj = retryErr.value
    } else {
      log.error("evaluator: JSON parse failed after all repair attempts", {
        error: String(parseErr.error),
        rawLength: raw.length,
        rawHead: raw.slice(0, 500),
        rawTail: raw.slice(-300),
      })
      throw parseErr.error
    }
  }

  return normalizeAnalysis(obj, goalCount)
}

function tryParse(text: string): { ok: true; value: any } | { ok: false; error: Error } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (err) {
    return { ok: false, error: err as Error }
  }
}

function repairTruncatedJSON(raw: string): string {
  let repaired = raw

  // If truncated inside a string, close it
  let inString = false
  let escaped = false
  for (let i = 0; i < repaired.length; i++) {
    const ch = repaired[i]
    if (escaped) { escaped = false; continue }
    if (ch === "\\") { escaped = true; continue }
    if (ch === '"') inString = !inString
  }
  if (inString) repaired += '"'

  // Remove trailing partial key-value
  repaired = repaired.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/, "")
  repaired = repaired.replace(/,\s*$/, "")

  // Count and close unclosed brackets
  const stack: string[] = []
  inString = false
  escaped = false
  for (let i = 0; i < repaired.length; i++) {
    const ch = repaired[i]
    if (escaped) { escaped = false; continue }
    if (ch === "\\") { escaped = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === "{") stack.push("}")
    else if (ch === "[") stack.push("]")
    else if (ch === "}" || ch === "]") stack.pop()
  }

  repaired = repaired.replace(/,\s*$/, "")
  while (stack.length > 0) repaired += stack.pop()!

  return repaired
}

function trimToLastComplete(raw: string): string {
  let lastComplete = -1
  let inString = false
  let escaped = false

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    if (escaped) { escaped = false; continue }
    if (ch === "\\") { escaped = true; continue }
    if (ch === '"') {
      inString = !inString
      if (!inString) lastComplete = i
      continue
    }
    if (inString) continue
    if (ch === "{" || ch === "[") { /* depth++ */ }
    else if (ch === "}" || ch === "]") lastComplete = i
  }

  if (lastComplete > 0 && lastComplete < raw.length - 1) {
    let trimmed = raw.slice(0, lastComplete + 1)
    trimmed = trimmed.replace(/,\s*$/, "")
    const stack: string[] = []
    inString = false
    escaped = false
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i]
      if (escaped) { escaped = false; continue }
      if (ch === "\\") { escaped = true; continue }
      if (ch === '"') { inString = !inString; continue }
      if (inString) continue
      if (ch === "{") stack.push("}")
      else if (ch === "[") stack.push("]")
      else if (ch === "}" || ch === "]") stack.pop()
    }
    while (stack.length > 0) trimmed += stack.pop()!
    return trimmed
  }

  return repairTruncatedJSON(raw)
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
function sanitizeJSON(raw: string) {
  let out = ""
  let inString = false
  let i = 0
  while (i < raw.length) {
    const ch = raw[i]
    if (!inString) {
      if (ch === '"') inString = true
      out += ch
      i++
      continue
    }
    if (ch === "\\") {
      const next = raw[i + 1]
      if (next && '"\\\/bfnrtu'.includes(next)) {
        out += ch + next
        i += 2
        continue
      }
      out += "\\\\"
      i++
      continue
    }
    if (ch === '"') {
      inString = false
      out += ch
      i++
      continue
    }
    if (ch === "\n") {
      out += "\\n"
      i++
      continue
    }
    if (ch === "\r") {
      out += "\\r"
      i++
      continue
    }
    if (ch === "\t") {
      out += "\\t"
      i++
      continue
    }
    out += ch
    i++
  }
  return out
}

function normalizeAnalysis(input: unknown, goalCount: number): EvaluatorAnalysisType {
  const obj = input && typeof input === "object" ? { ...(input as Record<string, unknown>) } : {}

  if (!obj.classification) obj.classification = "evaluation"
  if (!obj.verdict) obj.verdict = "rejected"
  if (!obj.summary) obj.summary = "Evaluation analysis was truncated"
  if (!Array.isArray(obj.goal_statuses)) obj.goal_statuses = []
  if (!("replan_guidance" in obj)) obj.replan_guidance = undefined

  obj.goal_statuses = (obj.goal_statuses as unknown[]).flatMap((item, index) => {
    if (!item || typeof item !== "object") return []
    const row = { ...(item as Record<string, unknown>) }
    if (typeof row.goal_index !== "number") row.goal_index = index
    if (!row.status) row.status = "failed"
    if (!row.evidence) row.evidence = "Goal assessment was truncated in LLM output"
    if (!row.reasoning) row.reasoning = "The evaluator did not provide a complete assessment for this goal."
    return [row]
  })

  if ((obj.goal_statuses as unknown[]).length < goalCount) {
    for (let i = (obj.goal_statuses as unknown[]).length; i < goalCount; i++) {
      ;(obj.goal_statuses as Record<string, unknown>[]).push({
        goal_index: i,
        status: "failed",
        evidence: "Goal assessment was truncated in LLM output",
        reasoning: "The evaluator did not provide a complete assessment for this goal.",
      })
    }
  }

  return EvaluatorAnalysis.parse(obj)
}

function collectText(result: { text?: string; steps: Array<{ text?: string }> }) {
  const text = result.text?.trim() || ""
  if (text && text.includes("{")) return text
  return result.steps.map((step) => step.text).filter(Boolean).join("\n")
}

async function finalizeAnalysis(
  language: LanguageModelV2,
  input: AnalyzeInput,
  steps: Array<{ text?: string; toolCalls?: unknown[]; toolResults?: unknown[] }>,
  timeoutMs: number,
  isReasoning = false,
  stream?: TextHooks,
) {
  const transcript = steps
    .flatMap((step, index) => {
      const calls = Array.isArray(step.toolCalls)
        ? step.toolCalls.map((item) => `Step ${index + 1} tool_call: ${JSON.stringify(item).slice(0, 1200)}`)
        : []
      const results = Array.isArray(step.toolResults)
        ? step.toolResults.map((item) => `Step ${index + 1} tool_result: ${JSON.stringify(item).slice(0, 4000)}`)
        : []
      return [...calls, ...results]
    })
    .join("\n\n")

  let submittedAnalysis: EvaluatorAnalysisType | undefined
  const tools = {
    submit_analysis: tool({
      description:
        "Submit the final evaluation analysis after investigation. " +
        "Call this tool ONCE using the investigation transcript that was already gathered.",
      inputSchema: EvaluatorAnalysis,
      execute: async (args) => {
        submittedAnalysis = args as EvaluatorAnalysisType
        return "Evaluation analysis submitted successfully."
      },
    }),
  }

  const result = await completeText({
    model: language,
    stopWhen: stepCountIs(8),
    tools,
    toolChoice: isReasoning ? "auto" : "required",
    maxOutputTokens: 16384,
    timeoutMs: Math.min(timeoutMs, 120_000),
    abortSignal: AbortSignal.timeout(Math.min(timeoutMs, 120_000)),
    system:
      "You are finalizing an evaluation analysis after investigation is already complete. " +
      "Do not investigate again. Use the transcript provided, then call submit_analysis exactly once.",
    prompt: [
      buildUserPrompt(input),
      "# Investigation Transcript",
      transcript || "(no transcript captured)",
      "Now synthesize the final evaluation analysis and call submit_analysis exactly once.",
    ].join("\n\n"),
    ...(stream ?? {}),
  })

  return { result, submittedAnalysis }
}

async function agentLanguageModel(): Promise<{ language: LanguageModelV2; isReasoning: boolean } | undefined> {
  try {
    const def = await Provider.defaultModel()
    if (!def) return undefined
    log.info("evaluator: default model resolved", { providerID: def.providerID, modelID: def.modelID })
    const model = await Provider.getModel(def.providerID, def.modelID)
    const language = await Provider.getLanguage(model)
    const isReasoning = model.capabilities?.reasoning === true
    log.info("evaluator: model ready via Provider", { modelId: language.modelId, isReasoning })
    return { language, isReasoning }
  } catch (err) {
    log.error("evaluator: model resolution failed — evaluator will be unavailable", { error: String(err) })
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
  } catch (err) {
    log.warn("evaluator: memory prefetch failed", { error: err instanceof Error ? err.message : String(err) })
  }

  // 2. Inject active preferences for convention checking
  try {
    const projectId = Instance.project.id
    const prefs = Preference.merged({ projectID: projectId })
    if (prefs.length > 0) {
      const items = prefs.map((p) => `- **${p.key}**: ${p.value}`).join("\n")
      sections.push(
        "## Active Preferences (default conventions — explicit task constraints win on conflict)\n\n" +
          "Treat these as binding only when they do not conflict with the user request, approved spec, or explicit task boundaries.\n\n" +
          items,
      )
    }
  } catch (err) {
    log.warn("evaluator: preferences prefetch failed", { error: err instanceof Error ? err.message : String(err) })
  }

  return sections.length > 0 ? sections.join("\n\n") : ""
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

function buildUserPrompt(
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

  // Final instruction
  if (failedChecks.length > 0) {
    sections.push(
      "IMPORTANT: There are FAILED checks. You MUST investigate each failure using tools before producing your JSON output.\n" +
        "1. read_file on the failing test/source to understand WHAT failed\n" +
        "2. read_file on the changed files to understand WHAT was delivered\n" +
        "3. Compare: does the delivery match the goal criteria?\n" +
        "4. Then produce your JSON analysis.",
    )
  } else {
    sections.push(
      "All automated checks passed. Verify code quality by reading the changed files, checking convention compliance, " +
        "and assessing whether each goal's criteria is truly satisfied (not just that checks pass). " +
        "Then produce your JSON analysis.",
    )
  }

  return sections.join("\n\n")
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

export const EVALUATOR_SYSTEM = `You are a senior code reviewer and QA engineer acting as the evaluation brain for OpenCorvus, an autonomous coding orchestrator. Your job is to rigorously analyze a coding task delivery: review automated check outputs, investigate failures by reading actual code, assess whether each goal was truly met, and produce structured replan guidance when needed.

A shallow evaluation is WORSE than no evaluation — it causes the orchestrator to retry blindly. You must investigate deeply enough to give the next attempt actionable guidance.

## Available Tools

- **read_file**: Read file contents with line numbers — use this to verify code changes, read failing tests, check implementations
- **find_files**: Find files matching a glob pattern — use to discover test files, config files, related modules
- **search_code**: Search file contents with regex (ripgrep) — use to find imports, usages, patterns across the codebase
- **list_directory**: List files and directories at a path — use to verify file existence, check project structure
- **memory_search**: Search project memory for prior failures, known issues, historical patterns — use to avoid repeating mistakes
- **preference_list**: List project conventions and constraints (BINDING) — use to verify code quality compliance

## Your Process

### Phase 0: RECALL (1-2 tool calls)

1. **Search memory** (memory_search) with failure-related keywords from the check results. If pre-fetched memory exists in the prompt, only search for additional gaps.
2. **List preferences** (preference_list) unless already pre-fetched. Preferences are default conventions, but explicit task constraints and approved spec boundaries override them on conflict.

### Phase 1: REVIEW automated check results (no tool calls needed)

Analyze each check (build, test, lint, etc.) from the input:
- If ALL passed → proceed to Phase 2 for code quality verification (do NOT skip — passing checks ≠ correct implementation)
- If any FAILED → note which checks failed and what the output says, then investigate deeply in Phase 2

### Phase 2: INVESTIGATE (5-10 tool calls — this is the MOST IMPORTANT phase)

You MUST investigate using tools. An evaluation without reading actual code is worthless.

**When checks FAILED:**
1. **read_file** on the failing test file → understand what the test expected, what assertion failed
2. **read_file** on 2-3 changed source files → understand what the agent actually implemented
3. **search_code** for the failing function/class name → find where it's defined, imported, used
4. **read_file** on related existing code → understand the expected patterns, interfaces, contracts
5. **find_files** for related test files → check if other tests exist that should have been updated
6. **list_directory** on affected directories → verify expected files exist, no missing/extra files

**When ALL checks PASSED:**
1. **read_file** on 3-5 changed files → verify the implementation is correct, not just syntactically valid
2. **search_code** for key patterns from the goals → verify the feature actually works as described
3. **read_file** on test files → verify tests actually test the right behavior (not trivially passing)
4. **find_files** for config/build files → verify no stale references, correct imports

After investigation, you should know:
- EXACTLY what the agent implemented (not just what it claimed)
- Whether each goal's criteria is truly satisfied or just superficially passing
- The specific root cause of any failure (not guesses)
- Whether the code follows project conventions

### Phase 2.5: CONVENTION CHECK (1-3 tool calls, if applicable)

If preferences were loaded (from pre-fetch or Phase 0):
- Verify changed code follows naming conventions, file structure patterns, code style rules
- Check for anti-patterns explicitly called out in preferences
- If a preference conflicts with an explicit user request or approved task boundary, follow the task boundary and note the preference conflict without failing the delivery for that reason alone
- Convention violations ARE failures only when they do not conflict with explicit task constraints

### Phase 3: ASSESS each goal (no tool calls — synthesize from investigation)

For EACH goal in the input, determine pass/fail with SPECIFIC evidence from your investigation.

**Example GOOD goal assessment:**
{
  "goal_index": 0,
  "status": "passed",
  "evidence": "read_file src/middleware.ts confirmed: MiddlewareChain class implements onion model with before/after hooks at lines 15-42. next() correctly propagates through chain. read_file src/middleware.test.ts confirmed: test 'executes in onion order' at line 23 asserts before→handler→after sequence, test passes.",
  "reasoning": "Goal requires onion-model middleware chain. Implementation matches: each middleware calls next(), handler runs innermost, before/after hooks work. Test specifically verifies execution order. Build and test checks both pass."
}

**Example BAD goal assessment (DO NOT DO THIS):**
{
  "goal_index": 0,
  "status": "passed",
  "evidence": "Tests pass",
  "reasoning": "The build succeeded and tests passed so the goal is met"
}
— This is worthless! No file paths, no line numbers, no specific verification. The orchestrator cannot learn from this.

**Another BAD example:**
{
  "goal_index": 1,
  "status": "failed",
  "evidence": "Test failed",
  "reasoning": "The test output shows a failure"
}
— Which test? What assertion? What was expected vs actual? Without specifics, retry will repeat the same mistake.

### Phase 4: CLASSIFY and produce REPLAN GUIDANCE

**Classification** (choose based on investigation, not guessing):
- **transient**: Flaky test, network timeout, race condition — retry with same approach will likely work. RARE — don't use this as a default.
- **environment**: Missing dependency, wrong runtime version, build tool misconfiguration — needs environment fix, not code change.
- **input**: Task request is ambiguous, contradictory, or impossible — needs user clarification before retry.
- **permission**: Agent needed filesystem/network access it didn't have — needs permission change.
- **evaluation**: Code is partially correct but doesn't fully meet criteria — targeted code fixes needed. MOST COMMON for failures.
- **strategy**: Fundamental approach is wrong (wrong architecture, wrong library, wrong algorithm) — needs completely different plan. Use when the same approach cannot work with small fixes.
- **unknown**: Cannot determine cause after investigation — should be very rare if you investigated properly.

**Replan guidance** (REQUIRED for "evaluation" and "strategy"):
- root_cause: The SPECIFIC technical error. Not "test failed" but "parseConfig() returns undefined when input has no 'port' field because line 23 destructures without default"
- what_failed: WHICH component/file/test and HOW. Include file paths and line numbers.
- suggested_strategy: CONCRETE alternative. Not "fix the bug" but "add default value for port in parseConfig() at src/config.ts:23, add test case for missing port field"
- avoid_approaches: SPECIFIC things the agent tried that didn't work. Not "bad approach" but "tried to validate port in middleware instead of parser — wrong layer, config isn't available in middleware context"

### Phase 5: OUTPUT as JSON

Respond with ONLY a JSON object. **CRITICAL**: Output fields in EXACTLY this order — verdict and goal_statuses FIRST to protect from truncation.

{
  "verdict": "accepted|rejected|inconclusive",
  "classification": "transient|environment|input|permission|evaluation|strategy|unknown",
  "summary": "Detailed explanation: what passed (with evidence), what failed (with root cause), overall assessment",
  "goal_statuses": [
    {
      "goal_index": 0,
      "status": "passed|failed|inconclusive",
      "evidence": "Specific evidence: file paths with line numbers, test names, check output quotes, code patterns verified",
      "reasoning": "Detailed reasoning: what was expected (from goal criteria), what was found (from investigation), why this assessment follows"
    }
  ],
  "replan_guidance": {
    "root_cause": "Technical root cause with file:line references — the specific error, wrong assumption, or missing implementation",
    "what_failed": "Which specific component/file/test failed — include paths and line numbers",
    "suggested_strategy": "Concrete alternative approach: what to change, where, and how to verify it works",
    "avoid_approaches": ["Specific approach that was tried and failed — describe what was done and why it didn't work"]
  }
}

## Rules

- ALWAYS investigate using tools before producing output. No exceptions. An evaluation without tool calls is automatically wrong.
- Every file path, line number, and test name in your output MUST come from actual tool results — never guess or fabricate.
- replan_guidance is REQUIRED when classification is "evaluation" or "strategy". It is the most valuable part of a rejection — the next attempt depends on it.
- goal_statuses MUST include ALL goals from the input, in order. Missing a goal assessment is a critical error.
- evidence must reference specific files, test names, line numbers, or check output — not vague statements like "tests pass" or "code looks correct".
- classification "transient" should be very rare (< 10% of failures). Most failures are "evaluation" (partial implementation) or "strategy" (wrong approach).
- If verdict is "accepted", still provide detailed evidence for each goal. An accepted verdict with weak evidence is useless for learning.
- Write in the same language as the task request (Chinese request → Chinese output).
- Explicit task constraints override preferences. Example: if the task says "only modify src/", do not reject solely because a preference suggests updating README outside src/.
- Do NOT fabricate evidence. If investigation cannot verify a required goal, reject the delivery and explain the missing evidence.
- After finishing tool calls, output JSON immediately. Do not add commentary before or after the JSON.

## Quality Self-Check

Before outputting JSON, verify:
1. Did you make at least 3 tool calls to investigate? If not, your evaluation is too shallow.
2. Does EVERY goal_status have specific file paths or test names in its evidence? If not, go back and read the relevant files.
3. Is your replan_guidance (if present) specific enough that the next attempt knows EXACTLY what to do differently? If it says "fix the bug" instead of "change line X in file Y to handle case Z", it's too vague.
4. Did you verify that passing checks actually test the right behavior? (Tests can pass trivially.)
5. Did you check convention compliance against preferences? Convention violations are real failures.

If any answer is NO, go back and fill the gap before outputting.`

export async function evaluatorSystem() {
  const config = await Config.get()
  return typeof config.prompt?.evaluator_system === "string" ? config.prompt.evaluator_system : EVALUATOR_SYSTEM
}
