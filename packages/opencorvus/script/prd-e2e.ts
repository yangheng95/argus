#!/usr/bin/env bun
/**
 * PRD 全链路端到端测试
 *
 * 用 OpenAI Codex OAuth 将 PRD 喂给 PlannerAgent，
 * 生成完整开发计划，然后用 GoalJudge 评估模拟交付结果。
 *
 * 用法:
 *   bun run script/prd-e2e.ts [--prd <path>]
 *
 * 默认读取 specs/prd.txt
 */
import path from "path"
import * as fs from "fs/promises"
import { generateText, stepCountIs } from "ai"
import z from "zod"
import { GoalJudgment, type GoalJudgmentType } from "@/evaluator/agent"
import { createCodebaseTools } from "@/orchestrator/codebase-tools"
import { GoalInput } from "@/orchestrator/model"
import {
  DEFAULT_OPENAI_CODEX_MODEL,
  getOpenAICodexLanguage,
  hasOpenAICodexAuth,
  normalizeOpenAICodexModel,
  openAICodexAuthHelp,
} from "../src/provider/codex-live"

const PlannerE2EOutput = z.object({
  prd: z.string(),
  summary: z.string(),
  goals: z.array(
    GoalInput.extend({
      check_selector: z.array(z.string()).optional(),
    }),
  ).default([]),
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
  risks: z.array(z.string()).default([]),
  assumptions: z
    .array(
      z.object({
        question: z.string(),
        assumption: z.string(),
      }),
    )
    .optional(),
})

type PlannerE2EOutputType = z.infer<typeof PlannerE2EOutput>

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const prdFlag = args.indexOf("--prd")
const prdPath = prdFlag >= 0 && args[prdFlag + 1]
  ? path.resolve(args[prdFlag + 1])
  : path.resolve(import.meta.dir, "../../../specs/prd.txt")

// ── API key ─────────────────────────────────────────────────────────────────
const MODEL = normalizeOpenAICodexModel(process.env.OPENCORVUS_E2E_MODEL ?? DEFAULT_OPENAI_CODEX_MODEL)

if (!(await hasOpenAICodexAuth())) {
  console.error(`ERROR: 需要 OpenAI OAuth 凭据。${openAICodexAuthHelp()}`)
  process.exit(1)
}

console.log(`\n═══════════════════════════════════════════════════════`)
console.log(`  PRD 全链路端到端测试`)
console.log(`═══════════════════════════════════════════════════════`)
console.log(`  模型:     ${MODEL}`)
console.log(`  认证:     OpenAI OAuth (auth.json)`)
console.log(`  PRD:      ${prdPath}`)
console.log(`═══════════════════════════════════════════════════════\n`)

// ── 读取 PRD ────────────────────────────────────────────────────────────────
const prdContent = await fs.readFile(prdPath, "utf-8")
console.log(`PRD 长度: ${prdContent.length} 字符, ${prdContent.split("\n").length} 行\n`)

// ── 创建模型 ────────────────────────────────────────────────────────────────
const model = await getOpenAICodexLanguage({
  directory: path.resolve(import.meta.dir, ".."),
  model: MODEL,
})

// ── 创建临时项目目录 ────────────────────────────────────────────────────────
const tmpDir = path.join(
  process.env.TEMP || process.env.TMPDIR || "/tmp",
  `moment-diary-e2e-${Date.now()}`,
)
await fs.mkdir(path.join(tmpDir, "src"), { recursive: true })

// 脚手架 MVP 项目结构
await Bun.write(
  path.join(tmpDir, "package.json"),
  JSON.stringify({
    name: "moment-diary",
    version: "0.1.0",
    type: "module",
    scripts: {
      dev: "bun run --hot src/index.ts",
      test: "bun test",
      build: "bunx tsc --noEmit",
    },
    dependencies: { hono: "^4.0.0" },
    devDependencies: { "@types/bun": "latest", typescript: "^5.7.0" },
  }, null, 2),
)

await Bun.write(
  path.join(tmpDir, "tsconfig.json"),
  JSON.stringify({
    compilerOptions: {
      strict: true,
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      outDir: "dist",
    },
    include: ["src/**/*.ts"],
  }, null, 2),
)

await Bun.write(
  path.join(tmpDir, "src", "index.ts"),
  `// Moment Diary — MVP entry point
import { Hono } from "hono"

const app = new Hono()

app.get("/", (c) => c.text("Moment Diary API"))

export default app
`,
)

console.log(`临时项目目录: ${tmpDir}\n`)

// ── Phase 1: PlannerAgent ───────────────────────────────────────────────────

const PLANNER_SYSTEM = `You are a senior software architect. Your job is to analyze a PRD (Product Requirements Document), explore the codebase, and create a comprehensive development plan for the MVP version.

## Your Process

### Phase 1: EXPLORE the codebase (MANDATORY)
Use the provided tools to understand the project structure:
1. List the project root
2. Read package.json
3. Read key source files

### Phase 2: ANALYZE the PRD
Extract MVP requirements, identify core data models, API endpoints, and implementation priorities.

### Phase 3: OUTPUT as JSON
Respond with ONLY a JSON object (no markdown fences):
{
  "prd": "Expanded technical PRD based on exploration...",
  "summary": "One-line summary of the MVP plan",
  "goals": [{ "description": "...", "criteria": "...", "priority": "blocking", "check_selector": ["build","test"] }],
  "milestones": [{ "title": "...", "goal_indices": [0] }],
  "subtasks": [{ "title": "...", "description": "...", "order": 1 }],
  "risks": ["..."],
  "assumptions": [{ "question": "...", "assumption": "..." }]
}

Rules:
- ALWAYS explore the codebase before planning
- Focus on MVP scope only (V1.0 features from the PRD)
- goals.criteria must be concrete and verifiable
- Every blocking goal MUST have at least one check_selector
- subtasks should be ordered by implementation dependency
- Write in Chinese (same language as the PRD)`

const REQUEST = `## 工作目录

本任务的工作目录是 \`${tmpDir.replace(/\\/g, "/")}\`。

## 产品需求文档 (PRD)

${prdContent}

## 任务要求

请基于以上 PRD，为 MVP 版本（V1.0）制定详细的技术开发计划。
技术栈: Bun + TypeScript + Hono (后端 API) + SQLite (本地存储)
重点关注:
1. 数据模型设计 (DiaryEntry, Tag, User)
2. RESTful API 设计
3. 核心业务逻辑
4. 安全与隐私
5. 测试策略

先探索项目结构，然后输出结构化的开发计划。`

const tools = createCodebaseTools(tmpDir)

console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
console.log("  Phase 1: PlannerAgent — 生成开发计划")
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")

const planStart = Date.now()
const planResult = await generateText({
  model,
  stopWhen: stepCountIs(35),
  tools,
  maxOutputTokens: 16384,
  abortSignal: AbortSignal.timeout(300_000),
  system: PLANNER_SYSTEM,
  prompt: REQUEST,
})
const planDuration = ((Date.now() - planStart) / 1000).toFixed(1)

console.log(`\n完成! 耗时 ${planDuration}s, ${planResult.steps.length} 步`)
console.log("Tool calls:")
for (const [i, step] of planResult.steps.entries()) {
  const tc = step.toolCalls?.length ?? 0
  if (tc > 0) {
    console.log(`  Step ${i + 1}: ${step.toolCalls?.map((t) => t.toolName).join(", ")}`)
  }
}

const totalToolCalls = planResult.steps.reduce((s, step) => s + (step.toolCalls?.length ?? 0), 0)
console.log(`总 tool calls: ${totalToolCalls}`)

// ── 解析 Plan 输出 ──────────────────────────────────────────────────────────

function collectText(result: { text: string; steps: Array<{ text?: string }> }) {
  return result.text || result.steps.map((s) => s.text).filter(Boolean).join("\n")
}

async function finalizePlanText(
  prompt: string,
  result: { steps: Array<{ text?: string; toolCalls?: unknown[]; toolResults?: unknown[] }> },
) {
  const transcript = result.steps
    .flatMap((step, index) => {
      const calls = Array.isArray(step.toolCalls)
        ? step.toolCalls.map((item) => `Step ${index + 1} tool_call: ${JSON.stringify(item).slice(0, 1200)}`)
        : []
      const outputs = Array.isArray(step.toolResults)
        ? step.toolResults.map((item) => `Step ${index + 1} tool_result: ${JSON.stringify(item).slice(0, 4000)}`)
        : []
      return [...calls, ...outputs]
    })
    .join("\n\n")
  const forced = await generateText({
    model,
    stopWhen: stepCountIs(8),
    maxOutputTokens: 16384,
    abortSignal: AbortSignal.timeout(120_000),
    system: `${PLANNER_SYSTEM}\n\nExploration is already complete. Do not explore again. Output only the final JSON object now.`,
    prompt: [
      prompt,
      "# 已完成的探索记录",
      transcript || "(无工具记录)",
      "现在请基于以上探索结果，直接输出最终 JSON 对象，不要继续调用工具。",
    ].join("\n\n"),
  })
  return collectText(forced)
}

function extractJSON<T>(result: { text: string; steps: Array<{ text: string }> }, schema: z.ZodType<T>): T {
  const allText = collectText(result)
  let raw = allText.trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) raw = fenced[1].trim()
  if (!raw.startsWith("{")) {
    const match = raw.match(/(\{[\s\S]*\})/)
    if (match) raw = match[1]
  }
  const obj = JSON.parse(raw)
  if (typeof obj === "object" && obj) {
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

let plan: PlannerE2EOutputType
try {
  const primaryText = collectText(planResult)
  const source = primaryText.trim()
    ? { ...planResult, text: primaryText }
    : { ...planResult, text: await finalizePlanText(REQUEST, planResult) }
  plan = extractJSON(source, PlannerE2EOutput)
} catch (err) {
  console.error("\nJSON 解析失败:")
  console.error(err)
  const raw = collectText(planResult)
  console.error("原始输出 (前 2000 字):", raw.slice(0, 2000))
  process.exit(1)
}

console.log("\n┌─────────────────────────────────────────────────────┐")
console.log("│                    开发计划输出                      │")
console.log("└─────────────────────────────────────────────────────┘\n")

console.log(`📋 Summary: ${plan.summary}`)
console.log(`📄 PRD: ${plan.prd.length} 字符`)
console.log(`🎯 Goals: ${plan.goals.length}`)
console.log(`📦 Subtasks: ${plan.subtasks.length}`)
console.log(`⚠️  Risks: ${plan.risks.length}`)
console.log(`🏁 Milestones: ${plan.milestones?.length ?? 0}`)
console.log(`❓ Assumptions: ${plan.assumptions?.length ?? 0}`)

console.log("\n── Goals ──────────────────────────────────────────────")
for (const [i, g] of plan.goals.entries()) {
  console.log(`  ${i + 1}. [${g.priority}] ${g.description}`)
  console.log(`     Criteria: ${g.criteria}`)
  if (g.check_selector?.length) console.log(`     Checks: ${g.check_selector.join(", ")}`)
}

console.log("\n── Subtasks ───────────────────────────────────────────")
for (const s of plan.subtasks) {
  console.log(`  ${s.order}. ${s.title}`)
  console.log(`     ${s.description.slice(0, 150)}${s.description.length > 150 ? "..." : ""}`)
}

if (plan.risks.length > 0) {
  console.log("\n── Risks ──────────────────────────────────────────────")
  for (const r of plan.risks) console.log(`  • ${r}`)
}

if (plan.milestones && plan.milestones.length > 0) {
  console.log("\n── Milestones ─────────────────────────────────────────")
  for (const m of plan.milestones) {
    console.log(`  ${m.title} → goals: [${m.goal_indices.join(", ")}]`)
  }
}

if (plan.assumptions && plan.assumptions.length > 0) {
  console.log("\n── Assumptions ────────────────────────────────────────")
  for (const a of plan.assumptions) {
    console.log(`  Q: ${a.question}`)
    console.log(`  A: ${a.assumption}`)
  }
}

console.log("\n── PRD (技术 PRD 全文) ──────────────────────────────────")
console.log(plan.prd)

// ── Phase 2: GoalJudge — 模拟评估 ──────────────────────────────────────

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
console.log("  Phase 2: GoalJudge — 模拟交付评估")
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")

const GOAL_JUDGE_SYSTEM = `You are a senior code reviewer. Analyze the results of a coding task.

## Process
1. REVIEW automated check results
2. ASSESS each goal independently
3. CLASSIFY failure type if verdict is "rejected"
4. OUTPUT as JSON:
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
- Write in Chinese`

// 模拟部分交付成功的场景
const goalsList = plan.goals
  .map((g, i) => `${i}. [${g.priority}] ${g.description}\n   Criteria: ${g.criteria}`)
  .join("\n\n")

const evalPrompt = `# Task

Title: Moment Diary MVP 开发
Request: 基于 PRD 实现日记软件 MVP

# Goals (${plan.goals.length})

${goalsList}

# Automated Check Results

Passed: 2 | Failed: 1 | Total: 3

[PASS] build — tsc --noEmit exit code 0
[FAIL] test
   Output:
   FAIL src/diary.test.ts
     ✗ 创建日记条目
       Expected: 日记创建成功并返回 ID
       Received: Error: SQLite table 'diary_entries' not found
       at src/diary.test.ts:25:5
   PASS src/auth.test.ts — 5 tests passed
[PASS] lint

# Delivery

Summary: 实现了用户注册登录、日记 CRUD API 和基础时间轴首页，但数据库迁移脚本未正确执行。
Changed files: src/models/diary.ts, src/routes/diary.ts, src/routes/auth.ts, src/middleware/auth.ts, src/db/schema.ts, src/db/migrations/001_init.sql

Analyze the results. Then produce your analysis as a JSON object.`

const evalStart = Date.now()
const evalResult = await generateText({
  model,
  stopWhen: stepCountIs(5),
  abortSignal: AbortSignal.timeout(120_000),
  system: GOAL_JUDGE_SYSTEM,
  prompt: evalPrompt,
})
const evalDuration = ((Date.now() - evalStart) / 1000).toFixed(1)

let analysis: GoalJudgmentType
try {
  analysis = extractJSON(evalResult, GoalJudgment)
} catch (err) {
  console.error("GoalJudge JSON 解析失败:", err)
  process.exit(1)
}

console.log(`完成! 耗时 ${evalDuration}s`)
console.log(`\nVerdict: ${analysis.verdict}`)
console.log(`Classification: ${analysis.classification}`)
console.log(`Summary: ${analysis.summary}`)

console.log("\n── Goal Statuses ──────────────────────────────────────")
for (const gs of analysis.goal_statuses) {
  const goalDesc = plan.goals[gs.goal_index]?.description ?? `Goal ${gs.goal_index}`
  console.log(`  ${gs.goal_index}. [${gs.status}] ${goalDesc}`)
  console.log(`     Evidence: ${gs.evidence.slice(0, 150)}`)
}

if (analysis.replan_guidance) {
  console.log("\n── Replan Guidance ────────────────────────────────────")
  console.log(`  Root cause: ${analysis.replan_guidance.root_cause}`)
  console.log(`  What failed: ${analysis.replan_guidance.what_failed}`)
  console.log(`  Strategy: ${analysis.replan_guidance.suggested_strategy}`)
  if (analysis.replan_guidance.avoid_approaches.length > 0) {
    console.log(`  Avoid: ${analysis.replan_guidance.avoid_approaches.join("; ")}`)
  }
}

// ── Phase 3: Replan (如果评估失败) ──────────────────────────────────────────

if (analysis.verdict === "rejected") {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
  console.log("  Phase 3: Replan — 基于失败分析重新规划")
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")

  const replanPrompt = [
    `# Task\n\nTitle: Moment Diary MVP 修复\n\nRequest:\n修复 MVP 开发中发现的问题。`,
    `# Replan Context\n\nThe previous plan FAILED.\n\n## Previous Plan Summary\n${plan.summary}`,
    `## Failure Analysis\nClassification: ${analysis.classification}\nSummary: ${analysis.summary}\nRoot Cause: ${analysis.replan_guidance?.root_cause ?? analysis.summary}\nSuggested Strategy: ${analysis.replan_guidance?.suggested_strategy ?? ""}`,
    `## Approaches to AVOID\n${(analysis.replan_guidance?.avoid_approaches ?? []).map((a) => `- ${a}`).join("\n") || "- None specified"}`,
    `## Previous Goal Results\n${analysis.goal_statuses.map((g) => `- ${plan.goals[g.goal_index]?.description ?? `Goal ${g.goal_index}`}: **${g.status}** — ${g.evidence}`).join("\n")}`,
    "Explore the codebase briefly (2-3 tool calls MAX), then produce your revised JSON plan.",
  ].join("\n\n")

  const replanStart = Date.now()
  const replanResult = await generateText({
    model,
  stopWhen: stepCountIs(25),
    tools,
    maxOutputTokens: 16384,
    abortSignal: AbortSignal.timeout(300_000),
    system: PLANNER_SYSTEM,
    prompt: replanPrompt,
  })
  const replanDuration = ((Date.now() - replanStart) / 1000).toFixed(1)

  let replan: PlannerE2EOutputType
  try {
    const replanText = collectText(replanResult)
    const source = replanText.trim()
      ? { ...replanResult, text: replanText }
      : { ...replanResult, text: await finalizePlanText(replanPrompt, replanResult) }
    replan = extractJSON(source, PlannerE2EOutput)
  } catch (err) {
    console.error("Replan JSON 解析失败:", err)
    process.exit(1)
  }

  console.log(`完成! 耗时 ${replanDuration}s`)
  console.log(`\nReplan Summary: ${replan.summary}`)
  console.log(`Goals: ${replan.goals.length}`)
  console.log(`Subtasks: ${replan.subtasks.length}`)

  console.log("\n── Replan Goals ───────────────────────────────────────")
  for (const [i, g] of replan.goals.entries()) {
    console.log(`  ${i + 1}. [${g.priority}] ${g.description}`)
    console.log(`     Criteria: ${g.criteria}`)
  }

  console.log("\n── Replan Subtasks ────────────────────────────────────")
  for (const s of replan.subtasks) {
    console.log(`  ${s.order}. ${s.title}`)
  }
}

// ── 质量断言 ────────────────────────────────────────────────────────────────

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
console.log("  质量断言检查")
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")

const checks: Array<[string, boolean]> = [
  ["PRD 长度 >= 200 字符", plan.prd.length >= 200],
  ["至少 1 个 blocking goal", plan.goals.some((g) => g.priority === "blocking")],
  ["至少 3 个 subtasks", plan.subtasks.length >= 3],
  ["Summary 非空", plan.summary.length > 10],
  ["PRD 包含数据模型相关内容", /diary|日记|DiaryEntry|数据模型/i.test(plan.prd)],
  ["Subtasks 包含 API/接口", plan.subtasks.some((s) => /API|接口|路由|route/i.test(`${s.title} ${s.description}`))],
  ["Evaluator 产出 verdict", ["accepted", "rejected", "inconclusive"].includes(analysis.verdict)],
  ["Evaluator goal_statuses 非空", analysis.goal_statuses.length > 0],
  ["Goal statuses 覆盖所有 goals", analysis.goal_statuses.length >= plan.goals.length],
]

let passed = 0
let failed = 0
for (const [name, ok] of checks) {
  const icon = ok ? "PASS" : "FAIL"
  console.log(`  [${icon}] ${name}`)
  if (ok) passed++; else failed++
}

console.log(`\n结果: ${passed} passed, ${failed} failed, 共 ${checks.length} 项`)

// ── 清理 ────────────────────────────────────────────────────────────────────
await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})

console.log(`\n═══════════════════════════════════════════════════════`)
console.log(`  全链路测试${failed === 0 ? "通过" : "失败"} `)
console.log(`  Plan: ${planDuration}s | Eval: ${evalDuration}s`)
console.log(`═══════════════════════════════════════════════════════\n`)

process.exit(failed > 0 ? 1 : 0)
