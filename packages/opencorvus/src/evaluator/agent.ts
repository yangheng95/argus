/**
 * GoalJudge — An independent-context agent that analyzes evaluation results,
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
import { stepCountIs } from "ai"
import z from "zod"
import { verificationHints } from "@/check/policy"
import { extractRawJSON, repairTruncatedJSON, sanitizeJSON, trimToLastComplete, tryParseJSON } from "@/llm/json-repair"
import { completeHeadlessText, resolveHeadlessLanguageModel } from "@/llm/headless"
import { createEvaluatorTools } from "./tools"
import { Memory } from "@/memory"
import { Preference } from "@/preference"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { Env } from "@/env"
import { type TextHooks } from "@/llm/api"
import { Config } from "@/config/config"
import { collectText, countToolCalls, firstContentLine, sectionBody, splitBlocks } from "@/util/agent-text"

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

export const GoalJudgment = z.object({
  verdict: z.enum(["accepted", "rejected", "inconclusive"]),
  classification: FailureClassification,
  summary: z.string(),
  goal_statuses: z.array(GoalAssessment),
  replan_guidance: ReplanGuidance.nullish(),
})

export type GoalJudgmentType = z.infer<typeof GoalJudgment>

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
// GoalJudge
// ---------------------------------------------------------------------------

const MAX_STEPS = 25

function evaluatorTimeoutMs() {
  const raw = Env.get("OPENCORVUS_EVALUATOR_AGENT_TIMEOUT_MS")
  const parsed = Number.parseInt(raw ?? "", 10)
  return Number.isFinite(parsed) ? parsed : 480_000
}

type AnalyzeInput = {
  task: { title: string; request: string; sessionID?: string; metadata?: Record<string, unknown> }
  goals: GoalInfo[]
  delivery: DeliveryInfo
  checkResults: CheckResult[]
  stream?: TextHooks
}

export namespace GoalJudge {
  export async function analyze(input: AnalyzeInput): Promise<GoalJudgmentType> {
    const resolved = await resolveHeadlessLanguageModel({
      label: "evaluator",
      metadata: input.task.metadata,
      sessionID: input.task.sessionID,
    })
    if (!resolved) throw new Error("Evaluator analysis model is unavailable")
    const { language, model } = resolved
    const timeoutMs = evaluatorTimeoutMs()

    // Full evaluator tool set: codebase exploration + memory + preferences
    const explorationTools = createEvaluatorTools({ sessionID: input.task.sessionID })

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
    let parsed: GoalJudgmentType | undefined
    let lastError: Error | undefined
    let toolCallCount = 0

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        log.info("evaluator agent retrying", { attempt, reason: lastError?.message })
      }

      let result: {
        text?: string
        finishReason?: string
        steps: Array<{ text?: string; toolCalls?: unknown[]; toolResults?: unknown[] }>
      }
      try {
        result = await completeHeadlessText({
          label: "evaluator",
          model,
          language,
          sessionID: input.task.sessionID,
          stopWhen: [stepCountIs(MAX_STEPS)],
          tools: explorationTools,
          maxOutputTokens: 16384,
          timeoutMs: false,
          abortSignal: AbortSignal.timeout(timeoutMs),
          system: await goalJudgeSystem(),
          prompt: userPrompt,
          ...(input.stream as TextHooks<typeof explorationTools> | undefined),
        })
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        log.warn("evaluator agent generateText failed", { attempt, error: lastError.message })
        continue
      }

      toolCallCount = countToolCalls(result.steps)

      log.info("evaluator agent finished", {
        attempt,
        steps: result.steps.length,
        toolCalls: toolCallCount,
        finishReason: result.finishReason,
        textLength: collectText(result).length,
      })

      try {
        const allText = collectText(result)
        if (!allText.trim()) {
          throw new Error("evaluator agent produced no markdown output")
        }
        parsed = extractGoalText(allText, input.goals.length)
      } catch (err) {
        lastError = new Error(`Evaluator analysis returned invalid output: ${err instanceof Error ? err.message : String(err)}`)
        log.warn("evaluator: output extraction failed, will retry", {
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

export const parseGoalJudgment = extractJSON

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function extractJSON(text: string, goalCount: number): GoalJudgmentType {
  let raw = extractRawJSON(text)

  raw = sanitizeJSON(raw)

  // Handle truncated JSON — same repair logic as planner agent
  if (raw.startsWith("{") && !raw.endsWith("}")) {
    log.warn("evaluator: JSON appears truncated, attempting repair", { length: raw.length, tail: raw.slice(-100) })
    raw = repairTruncatedJSON(raw)
  }

  let obj: any
  const parseErr = tryParseJSON(raw)
  if (parseErr.ok) {
    obj = parseErr.value
  } else {
    const trimmed = trimToLastComplete(raw)
    const retryErr = tryParseJSON(trimmed)
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

function extractGoalText(text: string, goalCount: number): GoalJudgmentType {
  const raw = text.trim()
  if (!raw) throw new Error("evaluator output empty")
  if (raw.startsWith("{") || raw.includes("```json")) return extractJSON(raw, goalCount)

  return normalizeAnalysis({
    verdict: sectionBody(raw, ["Verdict", "结论"]).split(/\r?\n/)[0]?.trim().toLowerCase(),
    classification: sectionBody(raw, ["Classification", "分类"]).split(/\r?\n/)[0]?.trim().toLowerCase(),
    summary: sectionBody(raw, ["Summary", "摘要"]) || firstContentLine(raw),
    goal_statuses: parseGoalStatuses(sectionBody(raw, ["Goal Statuses", "Goals", "目标评估", "目标状态"])),
    replan_guidance: parseReplanGuidance(sectionBody(raw, ["Replan Guidance", "Guidance", "改进建议", "重规划建议"])),
  }, goalCount)
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
function normalizeAnalysis(input: unknown, goalCount: number): GoalJudgmentType {
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

  return GoalJudgment.parse(obj)
}

function parseRecordLines(lines: string[]) {
  const record: Record<string, string> = {}
  for (const line of lines) {
    const value = line.trim().replace(/^[-*•]\s+/, "")
    const match = value.match(/^([a-zA-Z_ ]+|状态|证据|原因|根因|失败项|建议策略|避免方式)[:：]\s*(.+)$/)
    if (!match) continue
    record[match[1].trim().toLowerCase()] = match[2].trim()
  }
  return record
}

function parseGoalStatuses(text: string) {
  return splitBlocks(text).map((block, index) => {
    const title = block[0].replace(/^[-*•]\s+/, "").replace(/^\d+[.)、]\s+/, "").trim()
    const record = parseRecordLines(block.slice(1))
    const goalIndex = (() => {
      const fromTitle = title.match(/\d+/)?.[0]
      const next = Number.parseInt(record["goal_index"] || record["目标"] || fromTitle || String(index), 10)
      return Number.isInteger(next) ? next : index
    })()
    return {
      goal_index: goalIndex,
      status: (record["status"] || record["状态"] || "inconclusive").toLowerCase(),
      evidence: record["evidence"] || record["证据"] || title,
      reasoning: record["reasoning"] || record["原因"] || title,
    }
  })
}

function parseReplanGuidance(text: string) {
  if (!text.trim()) return undefined
  const record = parseRecordLines(text.split(/\r?\n/))
  const avoid = (record["avoid_approaches"] || record["避免方式"] || "")
    .split(/[;\n,，；]+/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (!record["root_cause"] && !record["根因"] && !record["suggested_strategy"] && !record["建议策略"]) {
    return undefined
  }
  return {
    root_cause: record["root_cause"] || record["根因"] || "",
    what_failed: record["what_failed"] || record["失败项"] || "",
    suggested_strategy: record["suggested_strategy"] || record["建议策略"] || "",
    avoid_approaches: avoid,
  }
}

// ---------------------------------------------------------------------------
// Pre-fetch context — give the evaluator a head start before tool calls
// ---------------------------------------------------------------------------

function prefetchEvaluatorContext(input: {
  task: { title: string; request: string; sessionID?: string; metadata?: Record<string, unknown> }
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
      "IMPORTANT: There are FAILED checks. You MUST investigate each failure using tools before producing your final markdown evaluation.\n" +
        "1. read_file on the failing test/source to understand WHAT failed\n" +
        "2. read_file on the changed files to understand WHAT was delivered\n" +
        "3. Compare: does the delivery match the goal criteria?\n" +
        "4. Then produce your final markdown evaluation.",
    )
  } else {
    sections.push(
      "All automated checks passed. Verify code quality by reading the changed files, checking convention compliance, " +
        "and assessing whether each goal's criteria is truly satisfied (not just that checks pass). " +
        "Then produce your final markdown evaluation.",
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

export const GOAL_JUDGE_SYSTEM = `You are a senior code reviewer and QA engineer acting as the evaluation brain for OpenCorvus. Your job is to rigorously analyze a coding task delivery, investigate the actual code, and emit a final evaluation as plain markdown that downstream runtime can parse directly.

A shallow evaluation is worse than no evaluation. You must investigate deeply enough to give the next attempt actionable guidance.

## Available Tools

- **read_file**: Verify implementations and read failing tests
- **find_files**: Discover related tests, configs, modules
- **search_code**: Find usages, imports, and patterns
- **list_directory**: Verify project structure and file existence
- **memory_search**: Search historical failures and prior context
- **preference_list**: Load project conventions

## Process

### Phase 0: RECALL

1. Search memory for similar failures unless pre-fetched context already covers it.
2. List preferences unless already pre-fetched.

### Phase 1: REVIEW CHECKS

- If checks failed, identify which checks failed and what they indicate.
- If checks passed, still verify that the implementation actually satisfies the goals.

### Phase 2: INVESTIGATE

Minimum 3 tool calls required. Read actual files before deciding.

You must determine:
- What was actually delivered
- Whether each goal is truly satisfied
- The concrete root cause of any failure
- Whether conventions were violated in a task-relevant way

### Phase 3: OUTPUT

Output plain markdown only. Do not output JSON. Do not call a submit tool.

Use these exact top-level sections in order:
- \`# Verdict\`
- \`# Classification\`
- \`# Summary\`
- \`# Goal Statuses\`
- \`# Replan Guidance\`

Formatting rules:

Under \`# Verdict\`, write exactly one of:
- accepted
- rejected
- inconclusive

Under \`# Classification\`, write exactly one of:
- transient — the check or test failed due to timing, flakiness, or infrastructure noise; a simple retry will fix it
- environment — a missing dependency, broken build tool, or platform incompatibility is the root cause
- input — the task specification itself is ambiguous, self-contradictory, or truly impossible to implement; do NOT use this when the executor merely misread or misapplied a clear spec element
- permission — the executor was blocked by access controls or sandbox restrictions
- evaluation — the implementation is partially or mostly correct but has specific, targeted issues (wrong field name, missing edge case, incorrect logic in one method); use this when the fix is clear and the code is salvageable
- strategy — the fundamental approach is architecturally wrong and must be rewritten from scratch
- unknown — cannot determine

**Classification decision rule**: If the spec is clear AND the executor produced code that almost works but made a naming, typing, or logic error, classify as \`evaluation\`. Reserve \`input\` strictly for cases where the spec itself is the problem (contradictory requirements, impossible constraints, missing critical information).

Under \`# Goal Statuses\`, each goal must be a numbered block in this shape:

1. Goal 0
- status: passed
- evidence: specific files, tests, line-level observations, or check outputs
- reasoning: why this goal is passed, failed, or inconclusive

Under \`# Replan Guidance\`, include whenever verdict is \`rejected\` — omit only when classification is \`transient\`, \`environment\`, \`input\`, or \`permission\`:
- root_cause: ...
- what_failed: ...
- suggested_strategy: ...
- avoid_approaches: item one; item two

## Rules

- ALWAYS investigate using tools before outputting.
- Every file path, test name, and technical claim must come from actual tool results.
- You must include every goal in \`# Goal Statuses\`.
- Evidence must be specific, not generic.
- Section headings must always use the English names shown in Phase 3 above. Write body text (evidence, reasoning, summaries, guidance) in the same language as the task request.
- If required evidence is missing, reject or mark inconclusive instead of guessing.

## Quality Self-Check

Before outputting markdown, verify:
1. I made at least 3 investigation tool calls.
2. Every goal has evidence tied to concrete files/tests/output.
3. Replan guidance is concrete when the delivery is rejected.
4. Passing checks were cross-checked against actual changed code.
5. I did not fabricate evidence.`

export async function goalJudgeSystem() {
  const config = await Config.get()
  return typeof config.prompt?.evaluator_system === "string" ? config.prompt.evaluator_system : GOAL_JUDGE_SYSTEM
}
