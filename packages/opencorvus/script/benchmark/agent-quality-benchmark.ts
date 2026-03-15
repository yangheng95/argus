/**
 * Agent Quality Benchmark — evaluates PlannerAgent and EvaluatorAgent output quality.
 *
 * Architecture:
 *   - PlannerAgent: Independent LLM (30 steps, 5min) — explores codebase → structured plan
 *   - EvaluatorAgent: Independent LLM (15 steps, 3min) — investigates failures → verdict + goal assessment
 *   - Goal evaluation: Two-layer — (1) automated checks (exit codes), (2) LLM assessment
 *
 * Requires a live benchmark model. Defaults to alibaba-coding-plan-cn/kimi-k2.5 when available.
 * Run: bun run script/benchmark/agent-quality-benchmark.ts
 */
import { generateText, stepCountIs } from "ai"
import z from "zod"
import path from "path"
import fs from "fs"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { ensureBenchmarkModel, loadBenchmarkEnv, prepareDashscopeEnv, resolveBenchmarkModel } from "./env"

// ---------------------------------------------------------------------------
// Schema (inline to avoid import issues with @/ aliases)
// ---------------------------------------------------------------------------

const PlannerOutput = z.object({
  prd: z.string(),
  summary: z.string(),
  goals: z.array(z.object({
    description: z.string(),
    criteria: z.string(),
    priority: z.enum(["blocking", "advisory"]),
    check_selector: z.array(z.string()).optional(),
  })),
  milestones: z.array(z.object({
    title: z.string(),
    description: z.string().optional(),
    goal_indices: z.array(z.number()),
  })).optional(),
  subtasks: z.array(z.object({
    title: z.string(),
    description: z.string(),
    order: z.number().optional(),
  })),
  risks: z.array(z.string()),
  assumptions: z.array(z.object({
    question: z.string(),
    assumption: z.string(),
  })).optional(),
  clarifications: z.array(z.object({
    header: z.string(),
    question: z.string(),
    context: z.string().optional(),
    default_assumption: z.string().optional(),
  })).optional(),
})

const EvaluatorAnalysis = z.object({
  verdict: z.enum(["accepted", "rejected", "inconclusive"]),
  classification: z.enum(["transient", "environment", "input", "permission", "evaluation", "strategy", "unknown"]),
  summary: z.string(),
  goal_statuses: z.array(z.object({
    goal_index: z.number(),
    status: z.enum(["passed", "failed", "inconclusive"]),
    evidence: z.string(),
    reasoning: z.string(),
  })),
  replan_guidance: z.object({
    root_cause: z.string(),
    what_failed: z.string(),
    suggested_strategy: z.string(),
    avoid_approaches: z.array(z.string()),
  }).nullish(),
})

type PlannerOutputType = z.infer<typeof PlannerOutput>
type EvaluatorAnalysisType = z.infer<typeof EvaluatorAnalysis>

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

await loadBenchmarkEnv(import.meta.dir)
prepareDashscopeEnv()

const MODEL = await resolveBenchmarkModel(import.meta.dir)
if (!(await ensureBenchmarkModel(import.meta.dir, MODEL).then(() => true).catch(() => false))) {
  console.error(`Live benchmark model is unavailable: ${MODEL}`)
  process.exit(1)
}

const TIMEOUT = 300_000
const PROJECT_ROOT = path.resolve(import.meta.dir, "../..")
let lang: Promise<Awaited<ReturnType<typeof Provider.getLanguage>>> | undefined

function createModel() {
  lang ??= Instance.provide({
    directory: PROJECT_ROOT,
    fn: async () => {
      const parsed = Provider.parseModel(MODEL)
      const resolved = await Provider.getModel(parsed.providerID, parsed.modelID)
      return Provider.getLanguage(resolved)
    },
  })
  return lang
}

// Inline codebase tools (avoid @/ import issues)
function createCodebaseTools(projectDir: string) {
  const { tool } = require("ai")
  const safePath = (p: string) => {
    const resolved = path.resolve(projectDir, p || ".")
    if (!resolved.startsWith(projectDir)) return { error: "outside the project boundary" as const, resolved: "" }
    return { error: null, resolved }
  }

  return {
    read_file: tool({
      description: "Read file contents with line numbers",
      parameters: z.object({ path: z.string().describe("Relative path from project root") }),
      execute: async ({ path: filePath }: { path: string }) => {
        const { error, resolved } = safePath(filePath)
        if (error) return error
        try {
          const content = fs.readFileSync(resolved, "utf-8")
          const lines = content.split("\n")
          return lines.slice(0, 200).map((l, i) => `${i + 1}│${l}`).join("\n") +
            (lines.length > 200 ? `\n... (${lines.length} total lines)` : "")
        } catch { return `File not found: ${filePath}` }
      },
    }),
    find_files: tool({
      description: "Find files matching a glob pattern",
      parameters: z.object({ pattern: z.string().describe("Glob pattern, e.g. 'src/**/*.ts'") }),
      execute: async ({ pattern }: { pattern: string }) => {
        const glob = new Bun.Glob(pattern)
        const matches: string[] = []
        for await (const file of glob.scan({ cwd: projectDir, onlyFiles: true })) {
          matches.push(file)
          if (matches.length >= 50) break
        }
        return matches.length ? matches.join("\n") : "No files found"
      },
    }),
    search_code: tool({
      description: "Search file contents with regex (like grep)",
      parameters: z.object({
        pattern: z.string().describe("Regex pattern to search for"),
        glob: z.string().optional().describe("File glob to limit search, e.g. '*.ts'"),
      }),
      execute: async ({ pattern, glob: fileGlob }: { pattern: string; glob?: string }) => {
        try {
          const args = ["rg", "--no-heading", "-n", "--max-count=20", pattern]
          if (fileGlob) args.push("--glob", fileGlob)
          const result = Bun.spawnSync(args, { cwd: projectDir, stdout: "pipe", stderr: "ignore" })
          const output = result.stdout.toString().trim()
          return output || "No matches found"
        } catch { return "Search failed" }
      },
    }),
    list_directory: tool({
      description: "List files and directories at a path",
      parameters: z.object({ path: z.string().optional().describe("Relative path, defaults to project root") }),
      execute: async ({ path: dirPath }: { path?: string }) => {
        const { error, resolved } = safePath(dirPath || ".")
        if (error) return error
        try {
          const entries = fs.readdirSync(resolved, { withFileTypes: true })
          return entries.slice(0, 80).map((e) =>
            `${e.isDirectory() ? "📁" : "📄"} ${e.name}`
          ).join("\n")
        } catch { return `Directory not found: ${dirPath}` }
      },
    }),
  }
}

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const PLANNER_SYSTEM = `You are a senior software architect. Explore the codebase thoroughly, then create a comprehensive development plan.

## Available Tools
- **read_file**: Read file contents with line numbers
- **find_files**: Find files matching a glob pattern
- **search_code**: Search file contents with regex
- **list_directory**: List files and directories

## Process

### Phase 1: EXPLORE (MANDATORY — at least 3 tool calls)
1. List project root → understand structure
2. Read package.json → tech stack
3. Read 2-3 key files related to the task

### Phase 2: PLAN based on what you learned

### Phase 3: OUTPUT as JSON (no markdown fences):
{
  "prd": "Expanded PRD with file paths from exploration...",
  "summary": "One-line summary",
  "goals": [{ "description": "...", "criteria": "...", "priority": "blocking", "check_selector": ["build","test"] }],
  "milestones": [{ "title": "...", "description": "...", "goal_indices": [0] }],
  "subtasks": [{ "title": "...", "description": "...", "order": 1 }],
  "risks": ["..."],
  "assumptions": [{ "question": "...", "assumption": "..." }],
  "clarifications": []
}

Rules:
- ALWAYS explore before planning
- goals.criteria must be concrete and verifiable
- Every blocking goal MUST have check_selector
- check_selector options: build, test, lint, verify_cmd, startup
- subtasks should reference specific files
- Write in the same language as the request
- After tool calls, output JSON immediately`

const EVALUATOR_SYSTEM = `You are a senior code reviewer. Analyze coding task results.

## Available Tools
- **read_file**: Read file contents
- **search_code**: Search code with regex

## Process
1. REVIEW check results
2. INVESTIGATE failures with tools
3. ASSESS each goal
4. CLASSIFY failure: transient|environment|input|permission|evaluation|strategy|unknown
5. OUTPUT JSON:
{
  "verdict": "accepted|rejected|inconclusive",
  "classification": "...",
  "summary": "...",
  "goal_statuses": [{ "goal_index": 0, "status": "passed|failed|inconclusive", "evidence": "...", "reasoning": "..." }],
  "replan_guidance": { "root_cause": "...", "what_failed": "...", "suggested_strategy": "...", "avoid_approaches": ["..."] }
}

Rules:
- replan_guidance REQUIRED for "evaluation" or "strategy" classification
- goal_statuses MUST include ALL goals
- evidence must be specific (files, tests, errors)
- Write in same language as task`

// ---------------------------------------------------------------------------
// JSON extraction
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
  if (typeof obj === "object" && obj) {
    // Normalize classification: LLM may omit or use non-enum values
    const validClassifications = ["transient", "environment", "input", "permission", "evaluation", "strategy", "unknown"]
    if (!obj.classification || !validClassifications.includes(obj.classification)) {
      obj.classification = obj.verdict === "accepted" ? "evaluation" : "unknown"
    }
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
// Scoring
// ---------------------------------------------------------------------------

interface Score { dim: string; score: number; detail: string }

function sc(dim: string, passed: boolean, detail: string): Score {
  return { dim, score: passed ? 1 : 0, detail }
}
function sp(dim: string, value: number, detail: string): Score {
  return { dim, score: Math.max(0, Math.min(1, value)), detail }
}

function printCard(title: string, scores: Score[]) {
  const total = scores.reduce((s, x) => s + x.score, 0)
  const max = scores.length
  const pct = max > 0 ? Math.round((total / max) * 100) : 0
  console.log(`\n${"═".repeat(60)}`)
  console.log(`  ${title}`)
  console.log(`  Score: ${total.toFixed(1)}/${max} (${pct}%)`)
  console.log(`${"─".repeat(60)}`)
  for (const s of scores) {
    const mark = s.score >= 1 ? "✓" : s.score > 0 ? "△" : "✗"
    console.log(`  ${mark} ${s.dim.padEnd(28)} ${(Math.round(s.score * 100) + "%").padStart(4)}  ${s.detail.slice(0, 30)}`)
  }
  console.log(`${"═".repeat(60)}`)
  return { total, max, pct }
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

async function runBenchmark(name: string, fn: () => Promise<Score[]>, retries = 1): Promise<{ name: string; scores: Score[] }> {
  console.log(`\n▶ Running: ${name}`)
  const start = Date.now()
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) console.log(`  Retry ${attempt}...`)
      const scores = await fn()
      const elapsed = ((Date.now() - start) / 1000).toFixed(1)
      console.log(`  Completed in ${elapsed}s`)
      printCard(name, scores)
      return { name, scores }
    } catch (err: any) {
      if (attempt < retries && err.message.includes("JSON")) {
        console.log(`  JSON parse failed, retrying...`)
        continue
      }
      console.error(`  FAILED: ${err.message}`)
      return { name, scores: [sc("ERROR", false, err.message.slice(0, 30))] }
    }
  }
  return { name, scores: [sc("ERROR", false, "exhausted retries")] }
}

// ── B1: Planner — Simple Task ──

async function b1_plannerSimple(): Promise<Score[]> {
  const model = await createModel()
  const tools = createCodebaseTools(PROJECT_ROOT)

  const result = await generateText({
    model,
    stopWhen: stepCountIs(15),
    tools,
    abortSignal: AbortSignal.timeout(TIMEOUT),
    system: PLANNER_SYSTEM,
    prompt: `# Task\n\nTitle: Add GET /health endpoint\n\nRequest:\nAdd a GET /health endpoint to the server that returns { status: "ok" }. Include a unit test.\n\nExplore the codebase, then produce your plan as JSON.`,
  })

  const tc = result.steps.reduce((s, step) => s + (step.toolCalls?.length ?? 0), 0)
  console.log(`  Tool calls: ${tc}, Steps: ${result.steps.length}`)
  const plan = extractJSON(result, PlannerOutput)
  console.log(`  Plan: ${plan.goals.length} goals, ${plan.subtasks.length} subtasks, PRD ${plan.prd.length} chars`)

  const prdLower = plan.prd.toLowerCase()
  const grounded = ["hono", "route", "server", "src/", "test/", "package.json", "bun"].filter(t => prdLower.includes(t))
  const blockingGoals = plan.goals.filter(g => g.priority === "blocking")
  const goalsWithSelectors = plan.goals.filter(g => g.check_selector && g.check_selector.length > 0)
  const subtasksWithFiles = plan.subtasks.filter(s => /\.(ts|js|json)/.test(s.description) || s.description.includes("src/"))

  return [
    sp("P1: Exploration depth", Math.min(1, tc / 3), `${tc} tool calls`),
    sp("P2: PRD grounding", Math.min(1, grounded.length / 3), `${grounded.length} codebase refs: ${grounded.join(",")}`),
    sp("P3: Goal specificity", (blockingGoals.length > 0 ? 0.5 : 0) + (goalsWithSelectors.length > 0 ? 0.5 : 0), `${blockingGoals.length} blocking, ${goalsWithSelectors.length} selectors`),
    sp("P4: Subtask actionability", plan.subtasks.length > 0 ? Math.min(1, subtasksWithFiles.length / plan.subtasks.length + 0.2) : 0, `${subtasksWithFiles.length}/${plan.subtasks.length} with files`),
    sc("P5: Scope proportionality", plan.goals.length <= 4 && plan.subtasks.length <= 6, `${plan.goals.length}g, ${plan.subtasks.length}s`),
  ]
}

// ── B2: Planner — Complex Task ──

async function b2_plannerComplex(): Promise<Score[]> {
  const model = await createModel()
  const tools = createCodebaseTools(PROJECT_ROOT)

  const result = await generateText({
    model,
    stopWhen: stepCountIs(30),
    tools,
    abortSignal: AbortSignal.timeout(TIMEOUT),
    system: PLANNER_SYSTEM,
    prompt: `# Task\n\nTitle: Refactor orchestrator retry logic\n\nRequest:\nRefactor the orchestrator retry/replan logic in src/orchestrator/runtime.ts:\n1. Extract retry policy into a separate module\n2. Add exponential backoff for transient failures\n3. Add a max wall-time budget that kills stuck tasks\n4. Ensure all existing tests still pass\n5. Add unit tests for the new retry policy module\n\nExplore the codebase (5-8 tool calls MAX), then STOP using tools and OUTPUT your JSON plan. Do not exceed 10 tool calls total.`,
  })

  const tc = result.steps.reduce((s, step) => s + (step.toolCalls?.length ?? 0), 0)
  console.log(`  Tool calls: ${tc}, Steps: ${result.steps.length}`)
  const plan = extractJSON(result, PlannerOutput)
  console.log(`  Plan: ${plan.goals.length} goals, ${plan.subtasks.length} subtasks, PRD ${plan.prd.length} chars`)

  const prdLower = plan.prd.toLowerCase()
  const grounded = ["runtime.ts", "replan", "retry", "orchestrator", "budget", "service.ts"].filter(t => prdLower.includes(t))
  const goalTexts = plan.goals.map(g => `${g.description} ${g.criteria}`.toLowerCase())
  const covers = [
    goalTexts.some(g => g.includes("retry") || g.includes("policy") || g.includes("extract")),
    goalTexts.some(g => g.includes("backoff") || g.includes("exponential")),
    goalTexts.some(g => g.includes("wall") || g.includes("timeout") || g.includes("budget") || g.includes("stuck")),
    goalTexts.some(g => g.includes("existing") || g.includes("pass") || g.includes("regression")),
    goalTexts.some(g => g.includes("test") || g.includes("spec")),
  ]
  const blockingWithSelectors = plan.goals.filter(g => g.priority === "blocking" && g.check_selector?.length)

  return [
    sp("P1: Exploration depth", Math.min(1, tc / 5), `${tc} tool calls`),
    sp("P2: PRD grounding", Math.min(1, grounded.length / 3), `${grounded.join(",")}`),
    sp("P3: Requirement coverage", covers.filter(Boolean).length / covers.length, `${covers.filter(Boolean).length}/5 reqs`),
    sp("P4: Blocking goals + selectors", plan.goals.length > 0 ? blockingWithSelectors.length / plan.goals.length : 0, `${blockingWithSelectors.length}/${plan.goals.length}`),
    sc("P5: Has risks", plan.risks.length > 0, `${plan.risks.length} risks`),
    sc("P6: Has milestones", (plan.milestones?.length ?? 0) > 0, `${plan.milestones?.length ?? 0} milestones`),
  ]
}

// ── B3: Planner — Chinese Language ──

async function b3_plannerChinese(): Promise<Score[]> {
  const model = await createModel()
  const tools = createCodebaseTools(PROJECT_ROOT)

  const result = await generateText({
    model,
    stopWhen: stepCountIs(15),
    tools,
    abortSignal: AbortSignal.timeout(TIMEOUT),
    system: PLANNER_SYSTEM,
    prompt: `# Task\n\nTitle: 添加健康检查接口\n\nRequest:\n在 server 模块新增 GET /health 接口，返回 { status: 'ok', uptime: process.uptime() }。需要有单元测试覆盖。\n\n先探索代码库，然后输出 JSON 格式的计划。`,
  })

  const tc = result.steps.reduce((s, step) => s + (step.toolCalls?.length ?? 0), 0)
  const plan = extractJSON(result, PlannerOutput)
  const hasCn = (t: string) => /[\u3400-\u9fff]/.test(t)

  return [
    sc("P5a: PRD in Chinese", hasCn(plan.prd), hasCn(plan.prd) ? "yes" : "no"),
    sc("P5b: Goals in Chinese", plan.goals.some(g => hasCn(g.description)), plan.goals.some(g => hasCn(g.description)) ? "yes" : "no"),
    sc("P5c: Subtasks in Chinese", plan.subtasks.some(s => hasCn(s.title) || hasCn(s.description)), "checked"),
    sp("P1: Exploration depth", Math.min(1, tc / 3), `${tc} tool calls`),
  ]
}

// ── B5: Evaluator — All Pass ──

async function b5_evaluatorAllPass(): Promise<Score[]> {
  const model = await createModel()

  const result = await generateText({
    model,
    stopWhen: stepCountIs(5),
    abortSignal: AbortSignal.timeout(TIMEOUT),
    system: EVALUATOR_SYSTEM,
    prompt: `# Task\n\nTitle: Add GET /health endpoint\nRequest: Add GET /health that returns { status: "ok" }. Include unit test.\n\n# Goals (2)\n\n0. [blocking] GET /health returns { status: "ok" }\n   Criteria: HTTP 200 response with JSON body\n   Checks: build, test\n\n1. [advisory] Unit test covers the endpoint\n   Criteria: test/server/health.test.ts exists and passes\n   Checks: test\n\n# Automated Check Results\n\nPassed: 3 | Failed: 0 | Total: 3\n\n[PASS] build — compilation successful\n[PASS] test — 3 tests passed\n   Output: PASS test/server/health.test.ts\n     ✓ GET /health returns 200\n     ✓ body contains status ok\n[PASS] lint\n\n# Delivery\n\nSummary: Added GET /health with unit tests\nChanged files: src/server/routes/health.ts, test/server/health.test.ts\n\nProduce your analysis as JSON.`,
  })

  const a = extractJSON(result, EvaluatorAnalysis)
  console.log(`  Verdict: ${a.verdict}, Classification: ${a.classification}`)

  return [
    sc("E1: Verdict accepted", a.verdict === "accepted", `verdict=${a.verdict}`),
    sc("E3: All goals passed", a.goal_statuses.length >= 2 && a.goal_statuses.every(g => g.status === "passed"), `${a.goal_statuses.length} goals`),
    sc("E4: Specific evidence", a.goal_statuses.some(g => g.evidence.includes("health") || g.evidence.includes("test") || g.evidence.includes("200")), "checked"),
    sc("E5: No replan for accept", !a.replan_guidance, a.replan_guidance ? "has replan" : "clean"),
  ]
}

// ── B6: Evaluator — Test Failure ──

async function b6_evaluatorTestFail(): Promise<Score[]> {
  const model = await createModel()
  const tools = createCodebaseTools(PROJECT_ROOT)

  const result = await generateText({
    model,
    stopWhen: stepCountIs(10),
    tools: { read_file: tools.read_file, search_code: tools.search_code },
    abortSignal: AbortSignal.timeout(TIMEOUT),
    system: EVALUATOR_SYSTEM,
    prompt: `# Task\n\nTitle: 实现用户列表 API\nRequest: 新增 GET /api/users 返回用户列表\n\n# Goals (2)\n\n0. [blocking] GET /api/users 返回用户列表\n   Criteria: HTTP 200 响应，body 为 JSON 数组\n   Checks: build, test\n\n1. [blocking] 有单元测试\n   Criteria: test 目录下有测试文件且通过\n   Checks: test\n\n# Automated Check Results\n\nPassed: 2 | Failed: 1 | Total: 3\n\n[PASS] build\n[FAIL] test\n   Output:\n   FAIL test/server/users.test.ts\n     ✗ GET /api/users returns user list\n       Expected: Array with length > 0\n       Received: { error: "Not found" }\n       Status code: 404 (expected 200)\n[PASS] lint\n\n# Delivery\n\nSummary: Added user list API but route registration missing\nChanged files: src/server/routes/users.ts, test/server/users.test.ts\n\nInvestigate the failure. Produce analysis as JSON.`,
  })

  const a = extractJSON(result, EvaluatorAnalysis)
  console.log(`  Verdict: ${a.verdict}, Classification: ${a.classification}`)
  const g0 = a.goal_statuses.find(g => g.goal_index === 0)
  const evAll = a.goal_statuses.map(g => `${g.evidence} ${g.reasoning}`).join(" ").toLowerCase()

  return [
    sc("E1: Verdict rejected", a.verdict === "rejected", `verdict=${a.verdict}`),
    sc("E2: Classification eval/strat", a.classification === "evaluation" || a.classification === "strategy", `class=${a.classification}`),
    sc("E3: Goal 0 failed", g0?.status === "failed", `g0=${g0?.status}`),
    sc("E4: Evidence mentions 404/route", evAll.includes("404") || evAll.includes("not found") || evAll.includes("route"), "checked"),
    sc("E5: Has replan guidance", !!a.replan_guidance, a.replan_guidance ? "yes" : "missing"),
    sc("E5b: Chinese summary", /[\u3400-\u9fff]/.test(a.summary), /[\u3400-\u9fff]/.test(a.summary) ? "yes" : "no"),
  ]
}

// ── B7: Evaluator — Strategy Failure (wrong framework) ──

async function b7_evaluatorStrategy(): Promise<Score[]> {
  const model = await createModel()

  const result = await generateText({
    model,
    stopWhen: stepCountIs(5),
    abortSignal: AbortSignal.timeout(TIMEOUT),
    system: EVALUATOR_SYSTEM,
    prompt: `# Task\n\nTitle: Add REST API with Hono\nRequest: Implement REST API using Hono (the project's framework)\n\n# Goals (1)\n\n0. [blocking] REST API runs\n   Criteria: bun run build succeeds\n   Checks: build\n\n# Automated Check Results\n\nPassed: 0 | Failed: 1 | Total: 1\n\n[FAIL] build\n   Output:\n   error: Cannot find module 'express'\n   at src/api.ts:1:22\n   import express from 'express'  // Express is NOT installed\n   This project uses Hono, not Express.\n\n# Delivery\n\nSummary: Created REST API but used Express instead of Hono\nChanged files: src/api.ts\n\nProduce analysis as JSON.`,
  })

  const a = extractJSON(result, EvaluatorAnalysis)
  console.log(`  Verdict: ${a.verdict}, Classification: ${a.classification}`)

  return [
    sc("E1: Verdict rejected", a.verdict === "rejected", `verdict=${a.verdict}`),
    sc("E2: Strategy classification", a.classification === "strategy", `class=${a.classification}`),
    sc("E5a: Has replan", !!a.replan_guidance, a.replan_guidance ? "yes" : "missing"),
    sc("E5b: Strategy mentions Hono", !!a.replan_guidance?.suggested_strategy.toLowerCase().includes("hono"), "checked"),
    sc("E5c: Avoids Express", !!a.replan_guidance?.avoid_approaches.some(a => a.toLowerCase().includes("express")), "checked"),
  ]
}

// ── B9: Evaluator — Mixed Results ──

async function b9_evaluatorMixed(): Promise<Score[]> {
  const model = await createModel()

  const result = await generateText({
    model,
    stopWhen: stepCountIs(5),
    abortSignal: AbortSignal.timeout(TIMEOUT),
    system: EVALUATOR_SYSTEM,
    prompt: `# Task\n\nTitle: Dashboard with charts and export\nRequest: Build dashboard with 3 charts and CSV export\n\n# Goals (3)\n\n0. [blocking] Dashboard renders without errors\n   Criteria: build succeeds\n   Checks: build\n\n1. [blocking] Three charts display correctly\n   Criteria: Charts for revenue, users, orders are visible\n   Checks: test, ui_review\n\n2. [advisory] CSV export works\n   Criteria: Export button downloads valid CSV\n   Checks: test\n\n# Automated Check Results\n\nPassed: 2 | Failed: 2 | Total: 4\n\n[PASS] build\n[PASS] test — 8/10 passed\n   Output:\n   PASS test/dashboard/render.test.ts (4 passed)\n   FAIL test/dashboard/export.test.ts\n     ✗ export button triggers CSV download\n       button click handler is undefined\n     ✗ CSV contains correct headers\n       export function not implemented\n[FAIL] ui_review\n   Output: Revenue chart has wrong Y-axis label. Expected "Revenue ($)", got "Revenue"\n\n# Delivery\n\nSummary: Dashboard with 3 charts but export stub not implemented\nChanged files: src/dashboard/page.tsx, src/dashboard/charts.tsx, src/dashboard/export.ts\n\nProduce analysis as JSON.`,
  })

  const a = extractJSON(result, EvaluatorAnalysis)
  console.log(`  Verdict: ${a.verdict}, Goals: ${a.goal_statuses.map(g => `${g.goal_index}:${g.status}`).join(", ")}`)

  const g0 = a.goal_statuses.find(g => g.goal_index === 0)
  const g1 = a.goal_statuses.find(g => g.goal_index === 1)
  const g2 = a.goal_statuses.find(g => g.goal_index === 2)
  const evAll = a.goal_statuses.map(g => `${g.evidence} ${g.reasoning}`).join(" ").toLowerCase()

  return [
    sc("E1: Verdict rejected", a.verdict === "rejected", `verdict=${a.verdict}`),
    sc("E3a: Goal 0 passed (build ok)", g0?.status === "passed", `g0=${g0?.status}`),
    sc("E3b: Goal 1 failed (ui issue)", g1?.status === "failed" || g1?.status === "inconclusive", `g1=${g1?.status}`),
    sc("E3c: Goal 2 failed (no export)", g2?.status === "failed", `g2=${g2?.status}`),
    sc("E3d: All 3 goals assessed", a.goal_statuses.length >= 3, `${a.goal_statuses.length} goals`),
    sc("E4: Mentions export issue", evAll.includes("export") || evAll.includes("csv"), "checked"),
    sc("E4: Mentions chart issue", evAll.includes("chart") || evAll.includes("y-axis") || evAll.includes("revenue"), "checked"),
    sc("E2: Classification evaluation", a.classification === "evaluation", `class=${a.classification}`),
  ]
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗")
  console.log("║   OpenCorvus Agent Quality Benchmark                    ║")
  console.log(`║   Model: ${MODEL.padEnd(47)}║`)
  console.log(`║   Time:  ${new Date().toISOString().padEnd(47)}║`)
  console.log("╚══════════════════════════════════════════════════════════╝")

  const results: Array<{ name: string; scores: Score[] }> = []

  // Run benchmarks sequentially (each makes LLM calls)
  results.push(await runBenchmark("B1: Planner — Simple Task", b1_plannerSimple))
  results.push(await runBenchmark("B2: Planner — Complex Task", b2_plannerComplex))
  results.push(await runBenchmark("B3: Planner — Chinese Language", b3_plannerChinese))
  results.push(await runBenchmark("B5: Evaluator — All Pass", b5_evaluatorAllPass))
  results.push(await runBenchmark("B6: Evaluator — Test Failure", b6_evaluatorTestFail))
  results.push(await runBenchmark("B7: Evaluator — Strategy Failure", b7_evaluatorStrategy))
  results.push(await runBenchmark("B9: Evaluator — Mixed Results", b9_evaluatorMixed))

  // Final summary
  console.log("\n" + "═".repeat(60))
  console.log("  FINAL SUMMARY")
  console.log("─".repeat(60))

  let totalScore = 0, totalMax = 0
  for (const r of results) {
    const s = r.scores.reduce((a, x) => a + x.score, 0)
    const m = r.scores.length
    totalScore += s
    totalMax += m
    const pct = m > 0 ? Math.round((s / m) * 100) : 0
    const bar = "█".repeat(Math.round(pct / 5)) + "░".repeat(20 - Math.round(pct / 5))
    console.log(`  ${r.name.padEnd(38)} ${bar} ${pct}%`)
  }

  console.log("─".repeat(60))
  const overallPct = totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : 0
  console.log(`  OVERALL: ${totalScore.toFixed(1)}/${totalMax} (${overallPct}%)`)
  console.log("═".repeat(60))

  // Quality dimensions reference
  console.log(`
  Quality Dimensions:
    P1 Exploration depth       P2 PRD grounding          P3 Goal specificity
    P4 Subtask actionability   P5 Language/scope match   P6 Replan differentiation
    E1 Verdict accuracy        E2 Classification         E3 Goal assessment
    E4 Evidence specificity    E5 Replan guidance quality
  `)
}

main().catch((err) => {
  console.error("Benchmark failed:", err)
  process.exit(1)
})
