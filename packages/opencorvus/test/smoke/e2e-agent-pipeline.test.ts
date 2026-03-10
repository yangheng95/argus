/**
 * End-to-end test for the independent-context agent pipeline.
 *
 * Calls REAL LLM (qwen3.5-plus via DashScope) to verify:
 * 1. PlannerAgent explores the codebase with tools and produces structured output
 * 2. EvaluatorAgent analyzes check results and classifies failures
 * 3. Full pipeline: plan → evaluate (accepted) → evaluate (rejected) → replan context construction
 *
 * Requires DASHSCOPE_API_KEY in environment.
 * Run: DASHSCOPE_API_KEY=xxx bun test test/smoke/e2e-agent-pipeline.test.ts
 */
import { describe, test, expect } from "bun:test"
import { generateText, stepCountIs, tool } from "ai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import z from "zod"
import { PlannerOutput, type PlannerOutputType, type ReplanContext } from "@/planner/agent"
import {
  EvaluatorAnalysis,
  type EvaluatorAnalysisType,
} from "@/evaluator/agent"
import { createCodebaseTools } from "@/orchestrator/codebase-tools"

// ---------------------------------------------------------------------------
// LLM setup — use qwen3.5-plus via DashScope OpenAI-compatible API
// ---------------------------------------------------------------------------

const DASHSCOPE_API_KEY = process.env.CODING_DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY
const HAS_LLM = !!DASHSCOPE_API_KEY
const TIMEOUT = 120_000

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

// ---------------------------------------------------------------------------
// System prompts (copied from agent modules to test independently)
// ---------------------------------------------------------------------------

const PLANNER_SYSTEM = `You are a senior software architect. Your job is to analyze a development task, explore the codebase thoroughly, and create a comprehensive development plan.

## Your Process

### Phase 1: EXPLORE the codebase (MANDATORY — do not skip)

Before producing any plan, you MUST use the provided tools to understand the project:
1. List the project root to see top-level structure
2. Read package.json (or equivalent) to understand the tech stack
3. List the source directory structure
4. Read 2-3 key files related to the task

Spend at least 3-5 tool calls exploring.

### Phase 2: PLAN based on what you learned

Create a detailed plan with goals, subtasks, and risks.

### Phase 3: OUTPUT as JSON

Respond with ONLY a JSON object (no markdown fences):
{
  "prd": "Expanded PRD with technical context from exploration...",
  "summary": "One-line summary",
  "goals": [{ "description": "...", "criteria": "...", "priority": "blocking", "check_selector": ["build","test"] }],
  "milestones": [{ "title": "...", "goal_indices": [0] }],
  "subtasks": [{ "title": "...", "description": "...", "order": 1 }],
  "risks": ["..."],
  "assumptions": [{ "question": "...", "assumption": "..." }]
}

Rules:
- ALWAYS explore the codebase before planning
- goals.criteria must be concrete and verifiable
- Every blocking goal MUST have at least one check_selector
- Write in the same language as the request`

const EVALUATOR_SYSTEM = `You are a senior code reviewer. Analyze the results of a coding task.

## Process

1. REVIEW automated check results
2. INVESTIGATE failures using tools if needed
3. ASSESS each goal independently
4. CLASSIFY failure type if verdict is "rejected":
   - transient: flaky test, retry will fix
   - environment: missing dependency
   - input: ambiguous task
   - permission: blocked action
   - evaluation: partially correct, needs fixes
   - strategy: fundamental approach is wrong
   - unknown: can't determine

5. OUTPUT as JSON:
{
  "verdict": "accepted|rejected|inconclusive",
  "classification": "transient|environment|input|permission|evaluation|strategy|unknown",
  "summary": "...",
  "goal_statuses": [{ "goal_index": 0, "status": "passed|failed|inconclusive", "evidence": "...", "reasoning": "..." }],
  "replan_guidance": { "root_cause": "...", "what_failed": "...", "suggested_strategy": "...", "avoid_approaches": ["..."] }
}

Rules:
- replan_guidance REQUIRED when classification is "evaluation" or "strategy"
- goal_statuses MUST include ALL goals
- Write in the same language as the task`

// ---------------------------------------------------------------------------
// JSON extraction helper
// ---------------------------------------------------------------------------

function extractJSONFromResult<T>(result: { text: string; steps: Array<{ text: string }> }, schema: z.ZodType<T>): T {
  // Collect text from all steps — model may output JSON before final step
  const allText = result.text || result.steps.map((s) => s.text).filter(Boolean).join("\n")
  let raw = allText.trim()
  // Strip markdown fences
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) raw = fenced[1].trim()
  // Find JSON object
  if (!raw.startsWith("{")) {
    const match = raw.match(/(\{[\s\S]*\})/)
    if (match) raw = match[1]
  }
  try {
    const obj = JSON.parse(raw)
    // Normalize LLM output quirks before strict validation
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
  } catch (e) {
    console.error("JSON parse failed, text length:", raw.length, "first 200 chars:", raw.slice(0, 200))
    throw e
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_LLM)("E2E: PlannerAgent with real LLM (qwen3.5-plus)", () => {
  let planOutput: PlannerOutputType

  test("explores codebase with tools and produces structured plan", async () => {
    const model = createModel()
    const tools = createCodebaseTools(process.cwd())

    const result = await generateText({
      model,
      stopWhen: stepCountIs(15),
      tools,
      abortSignal: AbortSignal.timeout(TIMEOUT),
      system: PLANNER_SYSTEM,
      prompt: `# Task\n\nTitle: 添加健康检查接口\n\nRequest:\n在 server 模块新增 GET /health 接口，返回 { status: 'ok', uptime: process.uptime() }。需要有单元测试。\n\nNow explore the codebase to understand the project, then produce your plan as a JSON object.`,
    })

    console.log("\n=== PlannerAgent Result ===")
    console.log("Steps:", result.steps.length)
    console.log("Finish reason:", result.finishReason)

    // Verify multi-step tool use (proof of independent context)
    expect(result.steps.length).toBeGreaterThan(1)
    console.log("Tool calls per step:")
    for (const [i, step] of result.steps.entries()) {
      const toolCalls = step.toolCalls?.length ?? 0
      if (toolCalls > 0) {
        console.log(`  Step ${i + 1}: ${toolCalls} tool calls — ${step.toolCalls?.map((tc) => tc.toolName).join(", ")}`)
      }
    }

    // Count total tool calls
    const totalToolCalls = result.steps.reduce((sum, step) => sum + (step.toolCalls?.length ?? 0), 0)
    console.log("Total tool calls:", totalToolCalls)
    expect(totalToolCalls).toBeGreaterThanOrEqual(2) // Must have explored the codebase

    // Parse the output
    planOutput = extractJSONFromResult(result, PlannerOutput)

    console.log("\nPlan output:")
    console.log("  Summary:", planOutput.summary)
    console.log("  PRD length:", planOutput.prd.length, "chars")
    console.log("  Goals:", planOutput.goals.length)
    for (const g of planOutput.goals) {
      console.log(`    [${g.priority}] ${g.description}`)
      console.log(`      Criteria: ${g.criteria}`)
    }
    console.log("  Subtasks:", planOutput.subtasks.length)
    console.log("  Risks:", planOutput.risks.length)
    console.log("  Milestones:", planOutput.milestones?.length ?? 0)

    // Structure validation
    expect(planOutput.prd).toBeTruthy()
    expect(planOutput.prd.length).toBeGreaterThan(50)
    expect(planOutput.summary).toBeTruthy()
    expect(planOutput.goals.length).toBeGreaterThan(0)
    expect(planOutput.subtasks.length).toBeGreaterThan(0)

    // Goals must have required fields
    for (const goal of planOutput.goals) {
      expect(goal.description).toBeTruthy()
      expect(goal.criteria).toBeTruthy()
      expect(["blocking", "advisory"]).toContain(goal.priority)
    }

    // PRD should contain codebase-specific details (proof of exploration, not blind planning)
    const prdLower = planOutput.prd.toLowerCase()
    const hasCodebaseContext =
      prdLower.includes("hono") ||
      prdLower.includes("route") ||
      prdLower.includes("server") ||
      prdLower.includes("src/") ||
      prdLower.includes("package.json") ||
      prdLower.includes("opencorvus")
    expect(hasCodebaseContext).toBe(true)
  }, TIMEOUT)

  test("at least one blocking goal with check_selector", () => {
    expect(planOutput).toBeDefined()
    const blocking = planOutput.goals.filter((g) => g.priority === "blocking")
    expect(blocking.length).toBeGreaterThan(0)
  })
})

describe.skipIf(!HAS_LLM)("E2E: EvaluatorAgent with real LLM (qwen3.5-plus)", () => {
  test("produces accepted verdict when all checks pass", async () => {
    const model = createModel()

    // No tools for all-pass — evaluator should produce verdict without investigation
    const result = await generateText({
      model,
      stopWhen: stepCountIs(5),
      abortSignal: AbortSignal.timeout(TIMEOUT),
      system: EVALUATOR_SYSTEM,
      prompt: `# Task\n\nTitle: 添加健康检查接口\nRequest: 新增 GET /health\n\n# Goals (1)\n\n0. [blocking] GET /health 返回 200\n   Criteria: HTTP 200 with { status: 'ok' }\n\n# Automated Check Results\n\nPassed: 3 | Failed: 0 | Total: 3\n\n[PASS] build\n[PASS] test — 12 tests passed\n[PASS] lint\n\n# Delivery\n\nSummary: Added GET /health returning { status: 'ok', uptime }\nChanged files: src/server/routes/health.ts, test/server/health.test.ts\n\nAnalyze the results. Then produce your analysis as a JSON object.`,
    })

    console.log("\n=== EvaluatorAgent: ALL PASS ===")
    console.log("Steps:", result.steps.length)

    const analysis = extractJSONFromResult(result, EvaluatorAnalysis)
    console.log("Verdict:", analysis.verdict)
    console.log("Classification:", analysis.classification)
    console.log("Summary:", analysis.summary)

    expect(analysis.verdict).toBe("accepted")
    expect(analysis.goal_statuses.length).toBeGreaterThanOrEqual(1)
    expect(analysis.goal_statuses[0].status).toBe("passed")
  }, TIMEOUT)

  test("classifies test failure and produces replan guidance", async () => {
    const model = createModel()
    const tools = createCodebaseTools(process.cwd())
    const evalTools = { read_file: tools.read_file, search_code: tools.search_code }

    const result = await generateText({
      model,
      stopWhen: stepCountIs(10),
      tools: evalTools,
      abortSignal: AbortSignal.timeout(TIMEOUT),
      system: EVALUATOR_SYSTEM,
      prompt: `# Task\n\nTitle: 添加健康检查接口\nRequest: 新增 GET /health，返回 { status: 'ok' }\n\n# Goals (2)\n\n0. [blocking] GET /health 返回 { status: 'ok' }\n   Criteria: 响应体 JSON 包含 status 字段且值为 'ok'\n   Checks: build, test\n\n1. [blocking] 有单元测试覆盖\n   Criteria: test/server/health.test.ts 存在且通过\n   Checks: test\n\n# Automated Check Results\n\nPassed: 2 | Failed: 1 | Total: 3\n\n[PASS] build — tsc exit code 0\n[FAIL] test\n   Output:\n   FAIL test/server/health.test.ts\n     ✗ GET /health returns correct body\n       Expected: { status: 'ok' }\n       Received: { msg: 'healthy' }\n       at test/server/health.test.ts:15:5\n[PASS] lint\n\n# Delivery\n\nSummary: Added GET /health but response body is wrong\nChanged files: src/server/routes/health.ts, test/server/health.test.ts\n\nAnalyze the results. If any checks failed, use tools to investigate. Then produce your analysis as a JSON object.`,
    })

    console.log("\n=== EvaluatorAgent: TEST FAILURE ===")
    console.log("Steps:", result.steps.length)

    const analysis = extractJSONFromResult(result, EvaluatorAnalysis)
    console.log("Verdict:", analysis.verdict)
    console.log("Classification:", analysis.classification)
    console.log("Summary:", analysis.summary)
    for (const gs of analysis.goal_statuses) {
      console.log(`  Goal ${gs.goal_index}: ${gs.status} — ${gs.evidence.slice(0, 100)}`)
    }
    if (analysis.replan_guidance) {
      console.log("Replan:")
      console.log("  Root cause:", analysis.replan_guidance.root_cause)
      console.log("  Strategy:", analysis.replan_guidance.suggested_strategy)
    }

    expect(analysis.verdict).toBe("rejected")
    expect(["evaluation", "strategy"]).toContain(analysis.classification)
    expect(analysis.goal_statuses.length).toBe(2)
    expect(analysis.goal_statuses[0].status).toBe("failed")
    expect(analysis.replan_guidance).toBeDefined()
    expect(analysis.replan_guidance!.root_cause).toBeTruthy()
  }, TIMEOUT)

  test("classifies wrong-framework build error as strategy failure", async () => {
    const model = createModel()

    const result = await generateText({
      model,
      stopWhen: stepCountIs(5),
      abortSignal: AbortSignal.timeout(TIMEOUT),
      system: EVALUATOR_SYSTEM,
      prompt: `# Task\n\nTitle: 用 Hono 写 REST API\nRequest: 在项目中用 Hono 实现 /api/users\n\n# Goals (1)\n\n0. [blocking] REST API 正常运行\n   Criteria: bun run build 成功且 /api/users 可访问\n   Checks: build\n\n# Automated Check Results\n\nPassed: 0 | Failed: 1 | Total: 1\n\n[FAIL] build\n   Output:\n   error: Cannot find module 'express'\n   Require stack: src/api.ts\n   This project uses Hono, not Express. Express is not in package.json.\n\n# Delivery\n\nSummary: Created src/api.ts with Express-based REST API\nChanged files: src/api.ts\n\nAnalyze the results. Then produce your analysis as a JSON object.`,
    })

    console.log("\n=== EvaluatorAgent: STRATEGY FAILURE ===")

    const analysis = extractJSONFromResult(result, EvaluatorAnalysis)
    console.log("Verdict:", analysis.verdict)
    console.log("Classification:", analysis.classification)
    console.log("Root cause:", analysis.replan_guidance?.root_cause)
    console.log("Avoid:", analysis.replan_guidance?.avoid_approaches)

    expect(analysis.verdict).toBe("rejected")
    // Should recognize wrong framework as strategy problem
    expect(["strategy", "evaluation", "environment"]).toContain(analysis.classification)
    expect(analysis.replan_guidance).toBeDefined()
    expect(analysis.replan_guidance!.avoid_approaches.length).toBeGreaterThan(0)
  }, TIMEOUT)
})

describe.skipIf(!HAS_LLM)("E2E: Full pipeline — Plan → Evaluate → ReplanContext", () => {
  test("complete lifecycle with real LLM calls", async () => {
    const model = createModel()
    const tools = createCodebaseTools(process.cwd())

    // ===== Step 1: Plan =====
    console.log("\n========== STEP 1: PLAN ==========")
    const planResult = await generateText({
      model,
      stopWhen: stepCountIs(10),
      tools,
      abortSignal: AbortSignal.timeout(TIMEOUT),
      system: PLANNER_SYSTEM,
      prompt: `# Task\n\nTitle: 添加 /ping 端点\n\nRequest:\n添加一个简单的 GET /ping 端点返回 "pong"。\n\nExplore the codebase briefly (2-3 tool calls), then produce your plan as JSON.`,
    })

    expect(planResult.steps.length).toBeGreaterThan(1)
    const planToolCalls = planResult.steps.reduce((s, step) => s + (step.toolCalls?.length ?? 0), 0)
    console.log(`Plan: ${planResult.steps.length} steps, ${planToolCalls} tool calls`)
    expect(planToolCalls).toBeGreaterThanOrEqual(2) // Must have explored

    const plan = extractJSONFromResult(planResult, PlannerOutput)
    console.log("Plan summary:", plan.summary)
    console.log("Plan goals:", plan.goals.length)
    expect(plan.goals.length).toBeGreaterThan(0)
    expect(plan.subtasks.length).toBeGreaterThan(0)

    // ===== Step 2: Evaluate (simulate failure) =====
    console.log("\n========== STEP 2: EVALUATE (failure) ==========")
    const goalsList = plan.goals
      .map((g, i) => `${i}. [${g.priority}] ${g.description}\n   Criteria: ${g.criteria}`)
      .join("\n\n")

    const evalResult = await generateText({
      model,
      stopWhen: stepCountIs(5),
      abortSignal: AbortSignal.timeout(TIMEOUT),
      system: EVALUATOR_SYSTEM,
      prompt: `# Task\n\nTitle: 添加 /ping 端点\nRequest: 添加 GET /ping 返回 "pong"\n\n# Goals (${plan.goals.length})\n\n${goalsList}\n\n# Automated Check Results\n\nPassed: 1 | Failed: 1 | Total: 2\n\n[PASS] build — tsc exit 0\n[FAIL] test\n   Output:\n   FAIL test/server/ping.test.ts\n     ✗ GET /ping returns pong\n       Expected: "pong"\n       Received: "ping"\n       at test:8\n\n# Delivery\n\nSummary: Added /ping but returns wrong string\nChanged files: src/server/routes/ping.ts\n\nAnalyze the results. Then produce your analysis as a JSON object.`,
    })

    const analysis = extractJSONFromResult(evalResult, EvaluatorAnalysis)
    console.log("Verdict:", analysis.verdict)
    console.log("Classification:", analysis.classification)
    console.log("Summary:", analysis.summary)
    expect(analysis.verdict).toBe("rejected")
    expect(analysis.goal_statuses.length).toBeGreaterThanOrEqual(1)

    // ===== Step 3: Build ReplanContext =====
    console.log("\n========== STEP 3: BUILD REPLAN CONTEXT ==========")
    const replanContext: ReplanContext = {
      previousSummary: plan.summary,
      failureAnalysis: {
        classification: analysis.classification,
        summary: analysis.summary,
        rootCause: analysis.replan_guidance?.root_cause ?? analysis.summary,
        suggestedStrategy: analysis.replan_guidance?.suggested_strategy ?? "",
        avoidApproaches: analysis.replan_guidance?.avoid_approaches ?? [],
      },
      previousGoalStatuses: analysis.goal_statuses.map((gs) => ({
        description: plan.goals[gs.goal_index]?.description ?? `Goal ${gs.goal_index}`,
        status: gs.status,
        evidence: gs.evidence,
      })),
    }

    console.log("ReplanContext built:")
    console.log("  Classification:", replanContext.failureAnalysis.classification)
    console.log("  Root cause:", replanContext.failureAnalysis.rootCause.slice(0, 100))
    console.log("  Avoid:", replanContext.failureAnalysis.avoidApproaches)
    console.log("  Previous goals:", replanContext.previousGoalStatuses.length)

    expect(replanContext.failureAnalysis.classification).toBeTruthy()
    expect(replanContext.previousGoalStatuses.length).toBeGreaterThan(0)

    // ===== Step 4: Replan with context =====
    console.log("\n========== STEP 4: REPLAN ==========")
    const replanSections = [
      `# Task\n\nTitle: 添加 /ping 端点\n\nRequest:\n添加 GET /ping 返回 "pong"。`,
      `# Replan Context\n\nThe previous plan FAILED.\n\n## Previous Plan Summary\n${replanContext.previousSummary}`,
      `## Failure Analysis\nClassification: ${replanContext.failureAnalysis.classification}\nSummary: ${replanContext.failureAnalysis.summary}\nRoot Cause: ${replanContext.failureAnalysis.rootCause}\nSuggested Strategy: ${replanContext.failureAnalysis.suggestedStrategy}`,
      `## Approaches to AVOID\n${replanContext.failureAnalysis.avoidApproaches.map((a) => `- ${a}`).join("\n")}`,
      `## Previous Goal Results\n${replanContext.previousGoalStatuses.map((g) => `- ${g.description}: **${g.status}** — ${g.evidence}`).join("\n")}`,
      "Explore the codebase briefly (2-3 tool calls MAX), then STOP using tools and OUTPUT your JSON plan. Do NOT exceed 5 tool calls.",
    ]

    const replanResult = await generateText({
      model,
      stopWhen: stepCountIs(20),
      tools,
      abortSignal: AbortSignal.timeout(TIMEOUT),
      system: PLANNER_SYSTEM,
      prompt: replanSections.join("\n\n"),
    })

    const replanToolCalls = replanResult.steps.reduce((s, step) => s + (step.toolCalls?.length ?? 0), 0)
    console.log(`Replan: ${replanResult.steps.length} steps, ${replanToolCalls} tool calls`)

    const replan = extractJSONFromResult(replanResult, PlannerOutput)
    console.log("Replan summary:", replan.summary)
    console.log("Replan goals:", replan.goals.length)
    console.log("Replan subtasks:", replan.subtasks.length)

    expect(replan.goals.length).toBeGreaterThan(0)
    expect(replan.subtasks.length).toBeGreaterThan(0)
    expect(replan.prd.length).toBeGreaterThan(50)

    console.log("\n========== PIPELINE COMPLETE ==========")
    console.log("Initial: plan", plan.goals.length, "goals,", plan.subtasks.length, "subtasks")
    console.log("Evaluate:", analysis.verdict, "/", analysis.classification)
    console.log("Replan:", replan.goals.length, "goals,", replan.subtasks.length, "subtasks")
  }, TIMEOUT * 4) // 4x timeout for 4 LLM calls
})
