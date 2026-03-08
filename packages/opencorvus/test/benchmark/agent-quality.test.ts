/**
 * Agent Quality Benchmark — evaluates the output quality of Planner and Evaluator agents.
 *
 * Architecture overview:
 *   - **PlannerAgent**: Independent LLM agent (30 steps, 5min timeout) with codebase exploration tools.
 *     Receives task request → explores codebase → produces structured plan (PRD, goals, subtasks, risks).
 *   - **EvaluatorAgent**: Independent LLM agent (15 steps, 3min timeout) with investigation tools.
 *     Receives check results + delivery → investigates failures → produces verdict + per-goal assessment + replan guidance.
 *   - **Goal evaluation**: Two-layer — (1) automated checks (build/test/lint exit codes), (2) EvaluatorAgent LLM assessment.
 *
 * Quality dimensions measured:
 *   Planner:
 *     P1. Exploration depth — did it use tools before planning?
 *     P2. PRD grounding — does expanded spec contain codebase-specific details?
 *     P3. Goal specificity — measurable criteria with check_selectors?
 *     P4. Subtask actionability — reference specific files/patterns?
 *     P5. Language matching — responds in the same language as the request?
 *     P6. Replan differentiation — produces a different plan vs previous failure?
 *
 *   Evaluator:
 *     E1. Verdict accuracy — correct accepted/rejected for clear scenarios
 *     E2. Classification accuracy — correct failure type (strategy vs evaluation vs transient)
 *     E3. Goal assessment accuracy — per-goal status matches ground truth
 *     E4. Evidence specificity — references files, tests, error messages (not vague)
 *     E5. Replan guidance quality — root cause is specific, strategy is actionable
 *
 * Requires DASHSCOPE_API_KEY in environment.
 * Run: DASHSCOPE_API_KEY=sk-sp-xxx bun test test/benchmark/agent-quality.test.ts --timeout 300000
 */
import { describe, test, expect } from "bun:test"
import { generateText, stepCountIs } from "ai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import z from "zod"
import { PlannerOutput, type PlannerOutputType } from "@/planner/agent"
import { EvaluatorAnalysis, type EvaluatorAnalysisType } from "@/evaluator/agent"
import { createCodebaseTools } from "@/orchestrator/codebase-tools"

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY
const HAS_LLM = !!DASHSCOPE_API_KEY
const TIMEOUT = 180_000

function createModel() {
  const baseURL = DASHSCOPE_API_KEY?.startsWith("sk-sp-")
    ? "https://coding.dashscope.aliyuncs.com/v1"
    : "https://dashscope.aliyuncs.com/compatible-mode/v1"
  const provider = createOpenAICompatible({
    name: "dashscope",
    baseURL,
    apiKey: DASHSCOPE_API_KEY!,
  })
  return provider.languageModel("qwen3.5-plus")
}

// System prompts (same as production agents)
const PLANNER_SYSTEM = `You are a senior software architect acting as the planning brain for OpenCorvus, an autonomous coding orchestrator. Your job is to leverage accumulated project knowledge, explore the codebase, and create a comprehensive development plan.

## Available Tools

- **read_file**: Read file contents with line numbers
- **find_files**: Find files matching a glob pattern
- **search_code**: Search file contents with regex (ripgrep)
- **list_directory**: List files and directories at a path

## Your Process

### Phase 1: EXPLORE — Understand the Codebase (MANDATORY)

Explore the codebase with purpose:
1. List the project root and key directories
2. Read package.json for tech stack, scripts, dependencies
3. Read 2-3 key source files related to the task
4. Search for relevant code patterns

Exploration budget: 4-8 tool calls.

### Phase 2: PLAN — Synthesize Everything

Based on codebase exploration, create:
1. **Expanded PRD**: Detailed technical specification with exact file paths
2. **Goals**: Specific, measurable acceptance criteria with check_selectors
3. **Subtasks**: Ordered execution steps referencing specific files
4. **Risks**: What could go wrong?

### Phase 3: OUTPUT as JSON

Respond with ONLY a JSON object (no markdown fences):
{
  "prd": "Expanded PRD with file paths and conventions from exploration...",
  "summary": "One-line summary",
  "goals": [{ "description": "...", "criteria": "...", "priority": "blocking", "check_selector": ["build","test"] }],
  "milestones": [{ "title": "...", "description": "...", "goal_indices": [0] }],
  "subtasks": [{ "title": "...", "description": "...", "order": 1 }],
  "risks": ["..."],
  "assumptions": [{ "question": "...", "assumption": "..." }],
  "clarifications": [{ "header": "...", "question": "...", "context": "...", "default_assumption": "..." }]
}

Rules:
- ALWAYS explore the codebase before planning
- goals.criteria must be concrete and machine-verifiable
- Every blocking goal MUST have at least one check_selector
- check_selector options: build, test, lint, verify_cmd, startup, ui_review, code_quality, code_review, dead_code_review, judge
- subtasks should reference specific files from exploration
- Write in the same language as the request
- After finishing tool calls, STOP and output JSON immediately`

const EVALUATOR_SYSTEM = `You are a senior code reviewer and QA engineer. Analyze the results of a coding task.

## Available Tools
- **read_file**: Read file contents with line numbers
- **find_files**: Find files matching a glob pattern
- **search_code**: Search file contents with regex
- **list_directory**: List files and directories at a path

## Process

1. REVIEW automated check results
2. INVESTIGATE failures using tools
3. ASSESS each goal independently
4. CLASSIFY failure type:
   - transient: flaky test, retry will fix
   - environment: missing dependency, build tool issue
   - input: ambiguous or impossible task
   - permission: blocked action
   - evaluation: partially correct, needs targeted fixes
   - strategy: fundamental approach is wrong
   - unknown: can't determine

5. OUTPUT as JSON:
{
  "verdict": "accepted|rejected|inconclusive",
  "classification": "transient|environment|input|permission|evaluation|strategy|unknown",
  "summary": "Concise explanation",
  "goal_statuses": [{ "goal_index": 0, "status": "passed|failed|inconclusive", "evidence": "...", "reasoning": "..." }],
  "replan_guidance": { "root_cause": "...", "what_failed": "...", "suggested_strategy": "...", "avoid_approaches": ["..."] }
}

Rules:
- replan_guidance REQUIRED when classification is "evaluation" or "strategy"
- goal_statuses MUST include ALL goals
- evidence must reference specific files, test names, or check output
- Write in the same language as the task`

// ---------------------------------------------------------------------------
// JSON extraction helper
// ---------------------------------------------------------------------------

function extractJSON<T>(result: { text: string; steps: Array<{ text: string }> }, schema: z.ZodType<T>): T {
  const allText = result.text || result.steps.map((s) => s.text).filter(Boolean).join("\n")
  let raw = allText.trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) raw = fenced[1].trim()
  if (!raw.startsWith("{")) {
    const match = raw.match(/(\{[\s\S]*\})/)
    if (match) raw = match[1]
  }
  const obj = JSON.parse(raw)
  // Normalize LLM quirks
  if (typeof obj === "object" && obj) {
    if (!obj.classification && "verdict" in obj) obj.classification = "evaluation"
    if (Array.isArray(obj.goals)) {
      for (const g of obj.goals) {
        if (g.priority && g.priority !== "blocking" && g.priority !== "advisory") g.priority = "advisory"
      }
    }
    if (Array.isArray(obj.subtasks)) {
      for (let i = 0; i < obj.subtasks.length; i++) {
        if (obj.subtasks[i].order == null) obj.subtasks[i].order = i + 1
      }
    }
  }
  return schema.parse(obj)
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

interface Score {
  dimension: string
  score: number      // 0-1
  maxScore: number   // always 1
  detail: string
}

function score(dimension: string, passed: boolean, detail: string): Score {
  return { dimension, score: passed ? 1 : 0, maxScore: 1, detail }
}

function scorePartial(dimension: string, value: number, detail: string): Score {
  return { dimension, score: Math.max(0, Math.min(1, value)), maxScore: 1, detail }
}

function printScorecard(title: string, scores: Score[]) {
  const total = scores.reduce((s, sc) => s + sc.score, 0)
  const max = scores.reduce((s, sc) => s + sc.maxScore, 0)
  const pct = max > 0 ? Math.round((total / max) * 100) : 0
  console.log(`\n╔══════════════════════════════════════════════════════════╗`)
  console.log(`║ ${title.padEnd(57)}║`)
  console.log(`║ Score: ${total.toFixed(1)}/${max} (${pct}%)${" ".repeat(Math.max(0, 44 - String(pct).length))}║`)
  console.log(`╠══════════════════════════════════════════════════════════╣`)
  for (const s of scores) {
    const mark = s.score >= 1 ? "✓" : s.score > 0 ? "△" : "✗"
    const pctStr = `${Math.round(s.score * 100)}%`
    console.log(`║ ${mark} ${s.dimension.padEnd(25)} ${pctStr.padStart(4)} │ ${s.detail.slice(0, 24).padEnd(24)}║`)
  }
  console.log(`╚══════════════════════════════════════════════════════════╝`)
  return { total, max, pct }
}

// ---------------------------------------------------------------------------
// Planner Benchmarks
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_LLM)("Planner Agent Quality", () => {
  // ═══════════════════════════════════════════════════
  // B1: Simple task — should produce concise, accurate plan
  // ═══════════════════════════════════════════════════
  test("B1: Simple task — concise plan with correct scope", async () => {
    const model = createModel()
    const tools = createCodebaseTools(process.cwd())

    const result = await generateText({
      model,
      stopWhen: stepCountIs(15),
      tools,
      abortSignal: AbortSignal.timeout(TIMEOUT),
      system: PLANNER_SYSTEM,
      prompt: `# Task\n\nTitle: Add GET /health endpoint\n\nRequest:\nAdd a GET /health endpoint to the server that returns { status: "ok" }. Include a unit test.\n\nExplore the codebase, then produce your plan as JSON.`,
    })

    const totalToolCalls = result.steps.reduce((s, step) => s + (step.toolCalls?.length ?? 0), 0)
    const plan = extractJSON(result, PlannerOutput)

    const scores: Score[] = []

    // P1: Exploration depth
    scores.push(scorePartial(
      "P1: Exploration depth",
      Math.min(1, totalToolCalls / 3),
      `${totalToolCalls} tool calls`,
    ))

    // P2: PRD grounding — should mention actual project details
    const prdLower = plan.prd.toLowerCase()
    const groundedTerms = ["hono", "route", "server", "src/", "test/", "package.json", "bun"].filter(
      (t) => prdLower.includes(t),
    )
    scores.push(scorePartial(
      "P2: PRD grounding",
      Math.min(1, groundedTerms.length / 3),
      `${groundedTerms.length} codebase refs`,
    ))

    // P3: Goal specificity
    const blockingGoals = plan.goals.filter((g) => g.priority === "blocking")
    const goalsWithSelectors = plan.goals.filter((g) => g.check_selector && g.check_selector.length > 0)
    const goalsWithCriteria = plan.goals.filter((g) => g.criteria.length > 20)
    scores.push(scorePartial(
      "P3: Goal specificity",
      (blockingGoals.length > 0 ? 0.4 : 0) +
        (goalsWithSelectors.length > 0 ? 0.3 : 0) +
        (goalsWithCriteria.length > 0 ? 0.3 : 0),
      `${plan.goals.length}g, ${goalsWithSelectors.length} selectors`,
    ))

    // P4: Subtask actionability — should reference files
    const subtasksWithFiles = plan.subtasks.filter(
      (s) => /\.(ts|js|json|py)/.test(s.description) || s.description.includes("src/") || s.description.includes("test/"),
    )
    scores.push(scorePartial(
      "P4: Subtask actionability",
      plan.subtasks.length > 0 ? Math.min(1, subtasksWithFiles.length / plan.subtasks.length + 0.3) : 0,
      `${subtasksWithFiles.length}/${plan.subtasks.length} with files`,
    ))

    // P5: Scope appropriateness — simple task should have few goals/subtasks
    const scopeOk = plan.goals.length <= 4 && plan.subtasks.length <= 6
    scores.push(score("P5: Scope proportionality", scopeOk, `${plan.goals.length}g, ${plan.subtasks.length}s`))

    // No clarification needed for clear task
    const noClarification = !plan.clarifications || plan.clarifications.length === 0
    scores.push(score("P6: No false clarification", noClarification, noClarification ? "clean" : "unnecessary ask"))

    printScorecard("B1: Planner — Simple Task", scores)

    // Hard requirements
    expect(plan.goals.length).toBeGreaterThan(0)
    expect(plan.subtasks.length).toBeGreaterThan(0)
    expect(plan.prd.length).toBeGreaterThan(30)
    expect(totalToolCalls).toBeGreaterThanOrEqual(2)
  }, TIMEOUT)

  // ═══════════════════════════════════════════════════
  // B2: Complex task — should produce thorough, multi-goal plan
  // ═══════════════════════════════════════════════════
  test("B2: Complex task — thorough multi-goal plan", async () => {
    const model = createModel()
    const tools = createCodebaseTools(process.cwd())

    const result = await generateText({
      model,
      stopWhen: stepCountIs(20),
      tools,
      abortSignal: AbortSignal.timeout(TIMEOUT),
      system: PLANNER_SYSTEM,
      prompt: `# Task\n\nTitle: Refactor orchestrator retry logic\n\nRequest:\nRefactor the orchestrator retry/replan logic in src/orchestrator/runtime.ts:\n1. Extract retry policy into a separate module (src/orchestrator/retry-policy.ts)\n2. Add exponential backoff for transient failures\n3. Add a max wall-time budget that kills stuck tasks\n4. Ensure all existing tests still pass\n5. Add unit tests for the new retry policy module\n\nExplore the codebase thoroughly, then produce your plan as JSON.`,
    })

    const totalToolCalls = result.steps.reduce((s, step) => s + (step.toolCalls?.length ?? 0), 0)
    const plan = extractJSON(result, PlannerOutput)

    const scores: Score[] = []

    // P1: Exploration depth — complex task needs more exploration
    scores.push(scorePartial(
      "P1: Exploration depth",
      Math.min(1, totalToolCalls / 5),
      `${totalToolCalls} tool calls`,
    ))

    // P2: PRD grounding — should mention runtime.ts, retry, replan
    const prdLower = plan.prd.toLowerCase()
    const groundedTerms = [
      "runtime.ts", "replan", "retry", "orchestrator", "budget",
      "service.ts", "handleevaluation", "retryor",
    ].filter((t) => prdLower.includes(t))
    scores.push(scorePartial(
      "P2: PRD grounding",
      Math.min(1, groundedTerms.length / 4),
      `${groundedTerms.length} specific refs`,
    ))

    // P3: Goal coverage — should cover all 5 requirements
    const goalTexts = plan.goals.map((g) => `${g.description} ${g.criteria}`.toLowerCase())
    const covers = [
      goalTexts.some((g) => g.includes("retry") || g.includes("policy") || g.includes("extract")),
      goalTexts.some((g) => g.includes("backoff") || g.includes("exponential")),
      goalTexts.some((g) => g.includes("wall") || g.includes("timeout") || g.includes("budget") || g.includes("stuck")),
      goalTexts.some((g) => g.includes("existing") || g.includes("pass") || g.includes("regression")),
      goalTexts.some((g) => g.includes("unit test") || g.includes("test") || g.includes("spec")),
    ]
    scores.push(scorePartial(
      "P3: Requirement coverage",
      covers.filter(Boolean).length / covers.length,
      `${covers.filter(Boolean).length}/5 requirements`,
    ))

    // P4: Goal quality
    const blockingWithSelectors = plan.goals.filter(
      (g) => g.priority === "blocking" && g.check_selector && g.check_selector.length > 0,
    )
    scores.push(scorePartial(
      "P4: Blocking goals + selectors",
      plan.goals.length > 0 ? blockingWithSelectors.length / plan.goals.length : 0,
      `${blockingWithSelectors.length}/${plan.goals.length}`,
    ))

    // P5: Subtask ordering and detail
    const orderedCorrectly = plan.subtasks.every((s, i) => i === 0 || (s.order ?? 0) >= (plan.subtasks[i - 1].order ?? 0))
    const hasFileRefs = plan.subtasks.filter((s) => /\.(ts|js)/.test(s.description) || s.description.includes("src/")).length
    scores.push(scorePartial(
      "P5: Subtask quality",
      (orderedCorrectly ? 0.5 : 0) + Math.min(0.5, hasFileRefs / Math.max(1, plan.subtasks.length)),
      `ordered=${orderedCorrectly}, ${hasFileRefs} file refs`,
    ))

    // P6: Risk identification
    scores.push(score(
      "P6: Risks identified",
      plan.risks.length > 0,
      `${plan.risks.length} risks`,
    ))

    // P7: Milestones for complex tasks
    scores.push(score(
      "P7: Has milestones",
      (plan.milestones?.length ?? 0) > 0,
      `${plan.milestones?.length ?? 0} milestones`,
    ))

    printScorecard("B2: Planner — Complex Task", scores)

    // Hard requirements
    expect(plan.goals.length).toBeGreaterThanOrEqual(3)
    expect(plan.subtasks.length).toBeGreaterThanOrEqual(3)
    expect(totalToolCalls).toBeGreaterThanOrEqual(3)
  }, TIMEOUT)

  // ═══════════════════════════════════════════════════
  // B3: Chinese task — should respond in Chinese
  // ═══════════════════════════════════════════════════
  test("B3: Chinese task — responds in Chinese", async () => {
    const model = createModel()
    const tools = createCodebaseTools(process.cwd())

    const result = await generateText({
      model,
      stopWhen: stepCountIs(15),
      tools,
      abortSignal: AbortSignal.timeout(TIMEOUT),
      system: PLANNER_SYSTEM,
      prompt: `# Task\n\nTitle: 添加健康检查接口\n\nRequest:\n在 server 模块新增 GET /health 接口，返回 { status: 'ok', uptime: process.uptime() }。需要有单元测试覆盖。\n\n先探索代码库，然后输出 JSON 格式的计划。`,
    })

    const plan = extractJSON(result, PlannerOutput)

    const scores: Score[] = []

    // P5: Language matching — PRD and goals should contain Chinese
    const hasChinese = (text: string) => /[\u3400-\u9fff]/.test(text)
    const prdChinese = hasChinese(plan.prd)
    const goalsChinese = plan.goals.some((g) => hasChinese(g.description) || hasChinese(g.criteria))
    const subtasksChinese = plan.subtasks.some((s) => hasChinese(s.title) || hasChinese(s.description))

    scores.push(score("P5a: PRD in Chinese", prdChinese, prdChinese ? "yes" : "no"))
    scores.push(score("P5b: Goals in Chinese", goalsChinese, goalsChinese ? "yes" : "no"))
    scores.push(score("P5c: Subtasks in Chinese", subtasksChinese, subtasksChinese ? "yes" : "no"))

    // Still should be grounded in codebase
    const totalToolCalls = result.steps.reduce((s, step) => s + (step.toolCalls?.length ?? 0), 0)
    scores.push(scorePartial("P1: Exploration depth", Math.min(1, totalToolCalls / 3), `${totalToolCalls} tool calls`))

    printScorecard("B3: Planner — Chinese Language", scores)

    expect(plan.goals.length).toBeGreaterThan(0)
    // At least one dimension should be in Chinese
    expect(prdChinese || goalsChinese || subtasksChinese).toBe(true)
  }, TIMEOUT)

  // ═══════════════════════════════════════════════════
  // B4: Replan differentiation — new plan vs failed approach
  // ═══════════════════════════════════════════════════
  test("B4: Replan — produces different approach after failure", async () => {
    const model = createModel()
    const tools = createCodebaseTools(process.cwd())

    const replanPrompt = `# Task

Title: 实现 WebSocket 通知推送

Request:
在 server 中实现 WebSocket 端点 /ws/notify，支持客户端订阅任务状态变更通知。

# Replan Context

The previous plan FAILED.

## Previous Plan Summary
Used polling-based approach with SSE (Server-Sent Events) on /api/events endpoint.

## Failure Analysis
Classification: strategy
Summary: SSE approach doesn't support bidirectional communication. Client can't send subscription filters.
Root Cause: SSE is unidirectional (server→client only). The requirement needs client→server messages for subscription management.
Suggested Strategy: Use proper WebSocket (ws:// protocol) with Hono's websocket upgrade support.

## Approaches to AVOID
- Do NOT use SSE/EventSource — it's unidirectional and already failed
- Do NOT use HTTP polling — too much overhead

## Previous Goal Results
- WebSocket connection established: **failed** — SSE is not WebSocket
- Client can subscribe to task updates: **failed** — No client→server channel

Explore the codebase briefly, then produce a NEW plan as JSON. The plan MUST differ from the failed SSE approach.`

    const result = await generateText({
      model,
      stopWhen: stepCountIs(15),
      tools,
      abortSignal: AbortSignal.timeout(TIMEOUT),
      system: PLANNER_SYSTEM,
      prompt: replanPrompt,
    })

    const plan = extractJSON(result, PlannerOutput)

    const scores: Score[] = []

    // P6: Replan differentiation — should NOT mention SSE/EventSource as the approach
    const prdLower = plan.prd.toLowerCase()
    const subtaskTexts = plan.subtasks.map((s) => `${s.title} ${s.description}`.toLowerCase()).join(" ")
    const allText = `${prdLower} ${subtaskTexts}`

    const usesWebSocket = allText.includes("websocket") || allText.includes("ws://") || allText.includes("upgrade")
    const avoidsSSE = !allText.includes("server-sent") && !allText.includes("eventsource")

    scores.push(score("P6a: Uses WebSocket", usesWebSocket, usesWebSocket ? "yes" : "no"))
    scores.push(score("P6b: Avoids failed SSE", avoidsSSE, avoidsSSE ? "clean" : "repeats SSE"))

    // Should acknowledge the failure context
    const acknowledgesFailure = prdLower.includes("previous") || prdLower.includes("failed") ||
      prdLower.includes("sse") || prdLower.includes("bidirectional")
    scores.push(score("P6c: Acknowledges failure", acknowledgesFailure, acknowledgesFailure ? "yes" : "no"))

    // Should still be grounded in codebase
    const totalToolCalls = result.steps.reduce((s, step) => s + (step.toolCalls?.length ?? 0), 0)
    scores.push(scorePartial("P1: Exploration depth", Math.min(1, totalToolCalls / 2), `${totalToolCalls} tool calls`))

    printScorecard("B4: Planner — Replan Differentiation", scores)

    expect(plan.goals.length).toBeGreaterThan(0)
    expect(usesWebSocket).toBe(true)
  }, TIMEOUT)
})

// ---------------------------------------------------------------------------
// Evaluator Benchmarks
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_LLM)("Evaluator Agent Quality", () => {
  // ═══════════════════════════════════════════════════
  // B5: All checks pass — should accept
  // ═══════════════════════════════════════════════════
  test("B5: All pass — verdict accepted with correct goal assessment", async () => {
    const model = createModel()

    const result = await generateText({
      model,
      stopWhen: stepCountIs(5),
      abortSignal: AbortSignal.timeout(TIMEOUT),
      system: EVALUATOR_SYSTEM,
      prompt: `# Task

Title: Add GET /health endpoint
Request: Add GET /health that returns { status: "ok" }. Include unit test.

# Goals (2)

0. [blocking] GET /health returns { status: "ok" }
   Criteria: HTTP 200 response with JSON body containing status field equals "ok"
   Checks: build, test

1. [advisory] Unit test covers the endpoint
   Criteria: test/server/health.test.ts exists and passes
   Checks: test

# Automated Check Results

Passed: 3 | Failed: 0 | Total: 3

[PASS] build
   Output: tsc compilation successful, 0 errors

[PASS] test — 15 tests passed, 0 failed
   Output:
   PASS src/server/routes/health.test.ts
     ✓ GET /health returns 200 (3ms)
     ✓ GET /health body contains status ok (2ms)
     ✓ GET /health returns valid JSON (1ms)
   Test Suites: 1 passed
   Tests: 3 passed

[PASS] lint — no issues found

# Delivery

Summary: Added GET /health endpoint with unit tests
Changed files (2):
- src/server/routes/health.ts
- test/server/health.test.ts

Analyze the results. Then produce your analysis as a JSON object.`,
    })

    const analysis = extractJSON(result, EvaluatorAnalysis)

    const scores: Score[] = []

    // E1: Verdict accuracy
    scores.push(score("E1: Verdict correct", analysis.verdict === "accepted", `verdict=${analysis.verdict}`))

    // E3: Goal assessment
    const allPassed = analysis.goal_statuses.length >= 2 &&
      analysis.goal_statuses.every((gs) => gs.status === "passed")
    scores.push(score("E3: All goals passed", allPassed, `${analysis.goal_statuses.length} goals assessed`))

    // E4: Evidence specificity
    const hasSpecificEvidence = analysis.goal_statuses.some(
      (gs) => gs.evidence.includes("health") || gs.evidence.includes("test") || gs.evidence.includes("200"),
    )
    scores.push(score("E4: Specific evidence", hasSpecificEvidence, hasSpecificEvidence ? "references test" : "vague"))

    // Should NOT have replan guidance for accepted
    const noReplan = !analysis.replan_guidance
    scores.push(score("E5: No replan for accept", noReplan, noReplan ? "clean" : "unnecessary replan"))

    printScorecard("B5: Evaluator — All Pass", scores)

    expect(analysis.verdict).toBe("accepted")
    expect(analysis.goal_statuses.length).toBeGreaterThanOrEqual(2)
  }, TIMEOUT)

  // ═══════════════════════════════════════════════════
  // B6: Test failure — should reject with evaluation classification
  // ═══════════════════════════════════════════════════
  test("B6: Test failure — correct rejection with replan guidance", async () => {
    const model = createModel()
    const tools = createCodebaseTools(process.cwd())

    const result = await generateText({
      model,
      stopWhen: stepCountIs(10),
      tools: { read_file: tools.read_file, search_code: tools.search_code },
      abortSignal: AbortSignal.timeout(TIMEOUT),
      system: EVALUATOR_SYSTEM,
      prompt: `# Task

Title: 实现用户列表 API
Request: 新增 GET /api/users 返回用户列表 JSON

# Goals (2)

0. [blocking] GET /api/users 返回用户列表
   Criteria: HTTP 200 响应，body 为 JSON 数组
   Checks: build, test

1. [blocking] 有单元测试
   Criteria: test 目录下有对应测试文件且测试通过
   Checks: test

# Automated Check Results

Passed: 2 | Failed: 1 | Total: 3

[PASS] build — compilation successful

[FAIL] test
   Output:
   FAIL test/server/users.test.ts
     ✗ GET /api/users returns user list
       Expected: Array with length > 0
       Received: { error: "Not found" }
       Status code: 404 (expected 200)
       at test/server/users.test.ts:18:5

     ✓ response is valid JSON

   Test Suites: 1 failed
   Tests: 1 passed, 1 failed

[PASS] lint

# Delivery

Summary: Added user list API but route registration is missing
Changed files (2):
- src/server/routes/users.ts
- test/server/users.test.ts

Analyze the results. Investigate the failure using tools. Then produce your analysis as a JSON object.`,
    })

    const analysis = extractJSON(result, EvaluatorAnalysis)

    const scores: Score[] = []

    // E1: Verdict accuracy
    scores.push(score("E1: Verdict correct", analysis.verdict === "rejected", `verdict=${analysis.verdict}`))

    // E2: Classification accuracy
    const correctClassification = analysis.classification === "evaluation" || analysis.classification === "strategy"
    scores.push(score("E2: Classification correct", correctClassification, `class=${analysis.classification}`))

    // E3: Goal assessment — goal 0 should fail, goal 1 could be inconclusive or partial
    const goal0Status = analysis.goal_statuses.find((gs) => gs.goal_index === 0)
    scores.push(score("E3a: Goal 0 failed", goal0Status?.status === "failed", `goal0=${goal0Status?.status}`))

    const goal1Status = analysis.goal_statuses.find((gs) => gs.goal_index === 1)
    const goal1Reasonable = goal1Status?.status === "failed" || goal1Status?.status === "inconclusive"
    scores.push(score("E3b: Goal 1 reasonable", goal1Reasonable === true, `goal1=${goal1Status?.status}`))

    // E4: Evidence specificity — should mention 404, route, users
    const evidenceTexts = analysis.goal_statuses.map((gs) => `${gs.evidence} ${gs.reasoning}`).join(" ").toLowerCase()
    const specificEvidence = evidenceTexts.includes("404") || evidenceTexts.includes("not found") ||
      evidenceTexts.includes("route") || evidenceTexts.includes("registration")
    scores.push(score("E4: Specific evidence", specificEvidence, specificEvidence ? "mentions 404/route" : "vague"))

    // E5: Replan guidance quality
    const hasReplan = !!analysis.replan_guidance
    scores.push(score("E5a: Has replan guidance", hasReplan, hasReplan ? "yes" : "missing"))
    if (hasReplan) {
      const rootCauseSpecific = analysis.replan_guidance!.root_cause.length > 20
      scores.push(score("E5b: Root cause specific", rootCauseSpecific, analysis.replan_guidance!.root_cause.slice(0, 24)))
      const hasStrategy = analysis.replan_guidance!.suggested_strategy.length > 15
      scores.push(score("E5c: Actionable strategy", hasStrategy, analysis.replan_guidance!.suggested_strategy.slice(0, 24)))
    }

    // E5: Summary in Chinese (matches task language)
    const hasChinese = /[\u3400-\u9fff]/.test(analysis.summary)
    scores.push(score("E5d: Summary in Chinese", hasChinese, hasChinese ? "yes" : "no"))

    printScorecard("B6: Evaluator — Test Failure", scores)

    expect(analysis.verdict).toBe("rejected")
    expect(analysis.goal_statuses.length).toBeGreaterThanOrEqual(2)
  }, TIMEOUT)

  // ═══════════════════════════════════════════════════
  // B7: Wrong framework — should classify as strategy failure
  // ═══════════════════════════════════════════════════
  test("B7: Wrong framework — strategy classification with avoid guidance", async () => {
    const model = createModel()

    const result = await generateText({
      model,
      stopWhen: stepCountIs(5),
      abortSignal: AbortSignal.timeout(TIMEOUT),
      system: EVALUATOR_SYSTEM,
      prompt: `# Task

Title: Add REST API with Hono
Request: Add REST API endpoints using Hono (the project's web framework)

# Goals (1)

0. [blocking] REST API runs successfully
   Criteria: bun run build succeeds and endpoints are accessible
   Checks: build

# Automated Check Results

Passed: 0 | Failed: 1 | Total: 1

[FAIL] build
   Output:
   error: Cannot find module 'express'
   at src/api.ts:1:22

   import express from 'express'  // ERROR: express is not installed
   const app = express()

   This project uses Hono, not Express.
   express is not in package.json dependencies.
   Existing routes use: import { Hono } from 'hono'

# Delivery

Summary: Created REST API but used Express instead of Hono
Changed files (1):
- src/api.ts

Analyze the results. Then produce your analysis as a JSON object.`,
    })

    const analysis = extractJSON(result, EvaluatorAnalysis)

    const scores: Score[] = []

    // E1: Verdict
    scores.push(score("E1: Verdict rejected", analysis.verdict === "rejected", `verdict=${analysis.verdict}`))

    // E2: Classification — strategy is ideal, environment is acceptable
    const isStrategy = analysis.classification === "strategy"
    scores.push(score("E2: Strategy classification", isStrategy, `class=${analysis.classification}`))

    // E5: Replan guidance — should mention Hono and avoid Express
    const hasReplan = !!analysis.replan_guidance
    scores.push(score("E5a: Has replan", hasReplan, hasReplan ? "yes" : "missing"))

    if (hasReplan) {
      const mentionsHono = analysis.replan_guidance!.suggested_strategy.toLowerCase().includes("hono")
      scores.push(score("E5b: Strategy mentions Hono", mentionsHono, mentionsHono ? "yes" : "no"))

      const avoidsExpress = analysis.replan_guidance!.avoid_approaches.some(
        (a) => a.toLowerCase().includes("express"),
      )
      scores.push(score("E5c: Avoids Express", avoidsExpress, avoidsExpress ? "yes" : "no"))
    }

    printScorecard("B7: Evaluator — Strategy Failure", scores)

    expect(analysis.verdict).toBe("rejected")
    expect(["strategy", "environment"]).toContain(analysis.classification)
  }, TIMEOUT)

  // ═══════════════════════════════════════════════════
  // B8: Flaky test — should classify as transient
  // ═══════════════════════════════════════════════════
  test("B8: Flaky test — transient classification", async () => {
    const model = createModel()

    const result = await generateText({
      model,
      stopWhen: stepCountIs(5),
      abortSignal: AbortSignal.timeout(TIMEOUT),
      system: EVALUATOR_SYSTEM,
      prompt: `# Task

Title: Add cache expiry
Request: Add TTL-based cache expiry to the data service

# Goals (1)

0. [blocking] Cache expires after TTL
   Criteria: test passes showing cached data is evicted after timeout
   Checks: build, test

# Automated Check Results

Passed: 2 | Failed: 1 | Total: 3

[PASS] build — compilation successful

[FAIL] test
   Output:
   PASS test/cache/ttl.test.ts (first run)
     ✓ cache entry exists immediately after set
     ✓ cache entry is evicted after TTL (flaky)

   FAIL test/cache/ttl.test.ts (second run — CI retry)
     ✓ cache entry exists immediately after set
     ✗ cache entry is evicted after TTL
       Timeout: test exceeded 5000ms deadline
       Expected cache.get("key") to be undefined after 1000ms wait
       But cache.get("key") still returned "value"
       Note: This test relies on setTimeout precision and has been flaky in CI

   Test infrastructure note: CI runners under load show ~200-500ms timer jitter

[PASS] lint

# Delivery

Summary: Implemented TTL cache with configurable expiry
Changed files (2):
- src/cache/ttl-cache.ts
- test/cache/ttl.test.ts

Analyze the results. Then produce your analysis as a JSON object.`,
    })

    const analysis = extractJSON(result, EvaluatorAnalysis)

    const scores: Score[] = []

    // E2: Classification — should recognize timing-based flakiness
    const isTransient = analysis.classification === "transient"
    const isEvaluation = analysis.classification === "evaluation"
    scores.push(score(
      "E2: Transient classification",
      isTransient,
      `class=${analysis.classification}`,
    ))

    // E4: Evidence should mention timing/flaky/timeout
    const evidenceAll = `${analysis.summary} ${analysis.goal_statuses.map((g) => g.evidence).join(" ")}`.toLowerCase()
    const mentionsTiming = evidenceAll.includes("timing") || evidenceAll.includes("flak") ||
      evidenceAll.includes("timeout") || evidenceAll.includes("jitter") || evidenceAll.includes("timer")
    scores.push(score("E4: Mentions timing", mentionsTiming, mentionsTiming ? "yes" : "no"))

    // Verdict could be either rejected (retry needed) or inconclusive
    const reasonableVerdict = analysis.verdict === "rejected" || analysis.verdict === "inconclusive"
    scores.push(score("E1: Reasonable verdict", reasonableVerdict, `verdict=${analysis.verdict}`))

    printScorecard("B8: Evaluator — Flaky Test", scores)

    // Hard: should at least recognize this is not a strategy problem
    expect(analysis.classification).not.toBe("strategy")
  }, TIMEOUT)

  // ═══════════════════════════════════════════════════
  // B9: Mixed results — partial goal success
  // ═══════════════════════════════════════════════════
  test("B9: Mixed results — partial goals with accurate per-goal assessment", async () => {
    const model = createModel()

    const result = await generateText({
      model,
      stopWhen: stepCountIs(5),
      abortSignal: AbortSignal.timeout(TIMEOUT),
      system: EVALUATOR_SYSTEM,
      prompt: `# Task

Title: Dashboard with charts and export
Request: Build a dashboard page with 3 charts and CSV export functionality

# Goals (3)

0. [blocking] Dashboard page renders without errors
   Criteria: bun run build succeeds, no runtime errors in browser console
   Checks: build

1. [blocking] Three charts display data correctly
   Criteria: Charts for revenue, users, and orders are visible with correct data binding
   Checks: test, ui_review

2. [advisory] CSV export works
   Criteria: Clicking export button downloads a valid CSV file
   Checks: test

# Automated Check Results

Passed: 2 | Failed: 2 | Total: 4

[PASS] build — compilation successful

[PASS] test — 8/10 tests passed
   Output:
   PASS test/dashboard/render.test.ts
     ✓ dashboard component renders (12ms)
     ✓ revenue chart renders with data (45ms)
     ✓ users chart renders with data (38ms)
     ✓ orders chart renders with data (42ms)
   FAIL test/dashboard/export.test.ts
     ✗ export button triggers CSV download
       Expected: download initiated
       Received: button click handler is undefined
     ✗ CSV contains correct headers
       Expected: "Date,Revenue,Users,Orders"
       Received: Error - export function not implemented

[FAIL] ui_review
   Output:
   UI Review: Charts render but revenue chart has wrong Y-axis label.
   Expected: "Revenue ($)" — Actual: "Revenue"
   Other charts look correct.

# Delivery

Summary: Dashboard with 3 charts, export stub not implemented
Changed files (4):
- src/dashboard/page.tsx
- src/dashboard/charts.tsx
- src/dashboard/export.ts
- test/dashboard/render.test.ts

Analyze the results. Then produce your analysis as a JSON object.`,
    })

    const analysis = extractJSON(result, EvaluatorAnalysis)

    const scores: Score[] = []

    // E1: Should reject (blocking goal 1 has ui_review issue)
    scores.push(score("E1: Verdict rejected", analysis.verdict === "rejected", `verdict=${analysis.verdict}`))

    // E3: Per-goal accuracy
    // Goal 0 (build passes) → should pass
    const g0 = analysis.goal_statuses.find((gs) => gs.goal_index === 0)
    scores.push(score("E3a: Goal 0 passed", g0?.status === "passed", `g0=${g0?.status}`))

    // Goal 1 (charts + ui_review fails) → should fail or inconclusive
    const g1 = analysis.goal_statuses.find((gs) => gs.goal_index === 1)
    const g1Correct = g1?.status === "failed" || g1?.status === "inconclusive"
    scores.push(score("E3b: Goal 1 failed/inc", g1Correct === true, `g1=${g1?.status}`))

    // Goal 2 (export not implemented) → should fail
    const g2 = analysis.goal_statuses.find((gs) => gs.goal_index === 2)
    scores.push(score("E3c: Goal 2 failed", g2?.status === "failed", `g2=${g2?.status}`))

    // E3: All 3 goals assessed
    scores.push(score("E3d: All goals assessed", analysis.goal_statuses.length >= 3, `${analysis.goal_statuses.length} goals`))

    // E4: Evidence should be specific
    const allEvidence = analysis.goal_statuses.map((gs) => `${gs.evidence} ${gs.reasoning}`).join(" ").toLowerCase()
    const mentionsExport = allEvidence.includes("export") || allEvidence.includes("csv")
    const mentionsChart = allEvidence.includes("chart") || allEvidence.includes("y-axis") || allEvidence.includes("revenue")
    scores.push(score("E4a: Mentions export issue", mentionsExport, mentionsExport ? "yes" : "no"))
    scores.push(score("E4b: Mentions chart issue", mentionsChart, mentionsChart ? "yes" : "no"))

    // E2: Classification should be evaluation (partial success, targeted fixes needed)
    scores.push(score("E2: Classification eval", analysis.classification === "evaluation", `class=${analysis.classification}`))

    printScorecard("B9: Evaluator — Mixed Results", scores)

    expect(analysis.goal_statuses.length).toBeGreaterThanOrEqual(3)
  }, TIMEOUT)
})

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_LLM)("Benchmark Summary", () => {
  test("prints quality dimensions reference", () => {
    console.log(`
┌──────────────────────────────────────────────────────────────┐
│ Agent Quality Benchmark — Dimensions Reference               │
├──────────────────────────────────────────────────────────────┤
│ PLANNER                                                      │
│   P1  Exploration depth      Did it use tools before plan?   │
│   P2  PRD grounding          Codebase-specific details?      │
│   P3  Goal specificity       Measurable + check_selectors?   │
│   P4  Subtask actionability  References specific files?      │
│   P5  Language matching       Same language as request?       │
│   P6  Replan differentiation  Different from failed plan?    │
│                                                              │
│ EVALUATOR                                                    │
│   E1  Verdict accuracy       Correct accepted/rejected?      │
│   E2  Classification         Correct failure type?           │
│   E3  Goal assessment        Per-goal status accurate?       │
│   E4  Evidence specificity   References files/tests/errors?  │
│   E5  Replan guidance        Specific root cause + strategy? │
└──────────────────────────────────────────────────────────────┘
    `)
  })
})
