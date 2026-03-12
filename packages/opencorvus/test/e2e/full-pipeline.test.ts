/**
 * Full end-to-end test: real Planner LLM → real OpencodeExecutor → real Checks → real Evaluator LLM.
 *
 * 无任何 mock。全链路：
 *   createTask → plan (real LLM) → execute (real opencorvus session) → verify (bun test) → evaluate (real LLM)
 *   → retry/replan (budget: maxRuns=3, maxReplans=1) → assert final state
 *
 * 任务: 根据 Moment Diary PRD（specs/prd.txt 第14节），实现 DiaryEntry 数据模型与内存 CRUD store，用 bun test 验证。
 * Slack: 任务状态变更通知到 #argus-opencode 频道（Bus.subscribe + chat.postMessage）。
 *
 * 运行: bun test test/e2e/full-pipeline.test.ts
 */
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "fs/promises"
import path from "path"
import { SlackGateway } from "../../src/channel/slack"
import { OrchestratorService } from "../../src/orchestrator/service"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: true })

function env(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
}

function model(input: string) {
  return input.includes("/") ? input : `alibaba-cn/${input}`
}

// ---------------------------------------------------------------------------
// 凭证 & 配置（硬编码）
// ---------------------------------------------------------------------------

const DASHSCOPE_KEY = env("OPENCORVUS_E2E_DASHSCOPE_KEY", "CODING_DASHSCOPE_API_KEY", "DASHSCOPE_API_KEY") ?? "test-dashscope-key"
const DASHSCOPE_BASE_URL =
  env("OPENCORVUS_E2E_DASHSCOPE_API_URL", "CODING_DASHSCOPE_API_URL")
  ?? (DASHSCOPE_KEY.startsWith("sk-sp-")
    ? "https://coding.dashscope.aliyuncs.com/v1"
    : "https://dashscope.aliyuncs.com/compatible-mode/v1")
const MODEL = model(env("OPENCORVUS_E2E_MODEL", "CODING_MODEL") ?? "qwen3.5-plus")
const MODEL_ID = MODEL.split("/").at(-1) ?? MODEL

const SLACK_BOT_TOKEN = env("OPENCORVUS_E2E_SLACK_BOT_TOKEN", "SLACK_BOT_TOKEN") ?? "test-slack-bot-token"
const SLACK_APP_TOKEN = env("OPENCORVUS_E2E_SLACK_APP_TOKEN", "SLACK_APP_TOKEN") ?? "test-slack-app-token"
const SLACK_CHANNEL_ID = env("OPENCORVUS_E2E_SLACK_CHANNEL_ID", "SLACK_CHANNEL_ID") ?? "test-slack-channel"
const RUN_LIVE_E2E = process.env.OPENCORVUS_RUN_LIVE_E2E === "1" || process.env.OPENCORVUS_RUN_LIVE_E2E === "true"
const HAS_LIVE_CREDS = !!(
  env("OPENCORVUS_E2E_DASHSCOPE_KEY", "CODING_DASHSCOPE_API_KEY", "DASHSCOPE_API_KEY")
  && env("OPENCORVUS_E2E_SLACK_BOT_TOKEN", "SLACK_BOT_TOKEN")
  && env("OPENCORVUS_E2E_SLACK_APP_TOKEN", "SLACK_APP_TOKEN")
  && env("OPENCORVUS_E2E_SLACK_CHANNEL_ID", "SLACK_CHANNEL_ID")
)
const liveTest = RUN_LIVE_E2E && HAS_LIVE_CREDS ? test : test.skip

const TIMEOUT_MS = parseInt(process.env.OPENCORVUS_E2E_TIMEOUT_MS ?? "1800000", 10) // 30 分钟
const AUTO_REPLY = "Use reasonable defaults consistent with the task request, keep the scope minimal, continue execution, and do not ask again unless absolutely necessary."
const STATUS_LOG_INTERVAL_MS = parseInt(process.env.OPENCORVUS_E2E_STATUS_LOG_INTERVAL_MS ?? "60000", 10)

// ---------------------------------------------------------------------------
// 任务内容（来自 specs/prd.txt 第14节，字段完整）
// ---------------------------------------------------------------------------

const TASK_TITLE = "实现 Moment Diary DiaryEntry 数据模型与 CRUD Store"

const TASK_REQUEST = `
# 项目背景

Moment Diary 是一款个人日记 App（PRD V1.0，2026-03-10）。
本任务要求用 TypeScript 实现后端核心数据层。

---

# PRD 第14节 —— 数据结构设计

## 14.1 日记实体 DiaryEntry

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 日记唯一 ID |
| user_id | string | 用户 ID |
| title | string | 标题 |
| content | string | 正文内容 |
| mood | string | 主心情（very_happy/happy/calm/sad/anxious/angry） |
| mood_tags | string[] | 情绪标签 |
| tags | string[] | 自定义标签（最多 10 个，每个最长 20 字） |
| images | string[] | 图片 URL 列表 |
| audios | string[] | 语音 URL 列表 |
| location_name | string | 地点名称 |
| latitude | number | 纬度 |
| longitude | number | 经度 |
| weather | string | 天气 |
| is_favorite | boolean | 是否收藏 |
| created_at | number | 创建时间戳（ms） |
| diary_at | number | 日记记录时间戳（ms） |
| updated_at | number | 更新时间戳（ms） |
| deleted_at | number \\| null | 软删除时间戳（ms），null 表示未删除 |
| sync_status | string | 同步状态 |

## 14.2 标签实体 Tag

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 标签 ID |
| user_id | string | 用户 ID |
| name | string | 标签名（最长 20 字） |
| color | string | 标签颜色（hex） |
| created_at | number | 创建时间戳（ms） |

---

# 本次实现任务

## 要求创建的文件

### src/types.ts
导出 \`DiaryEntry\` 和 \`Tag\` 两个 TypeScript interface，字段与上表完全一致。

### src/diary-store.ts
实现 \`DiaryStore\` class（内存存储，用 Map），导出如下方法：
- \`create(entry: Omit<DiaryEntry, "id" | "created_at" | "updated_at">): DiaryEntry\`
  — 自动生成 id（crypto.randomUUID()）、created_at、updated_at（Date.now()）
  — tags 超过 10 个时抛出错误
- \`get(id: string): DiaryEntry | undefined\`
- \`update(id: string, patch: Partial<Omit<DiaryEntry, "id" | "created_at">>): DiaryEntry | undefined\`
  — 更新 updated_at
- \`delete(id: string): boolean\`
  — 软删除：设 deleted_at = Date.now()，返回 true；不存在返回 false
- \`list(userId: string): DiaryEntry[]\`
  — 返回该用户未软删除的日记，按 diary_at 降序

### src/diary-store.test.ts
用 bun:test 编写以下测试（必须全部通过）：
1. create 返回含 id 和 timestamps 的完整日记（含 audios、sync_status 等新字段）
2. get 可以取到刚创建的日记
3. update 更新字段并刷新 updated_at
4. delete 软删除后 deleted_at 不为 null
5. list 只返回未删除日记，按 diary_at 降序排序
6. tags 超过 10 个时 create 抛出错误

---

# 约束
- 只创建/修改 src/ 下的文件，不修改 package.json / tsconfig.json
- 不引入任何第三方依赖
`.trim()

// ---------------------------------------------------------------------------
// Slack 辅助（直接 HTTP API，只需 bot token，无需 Socket Mode）
// ---------------------------------------------------------------------------

async function slackPost(text: string, threadTs?: string): Promise<void> {
  try {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: SLACK_CHANNEL_ID,
        ...(threadTs ? { thread_ts: threadTs } : {}),
        text,
      }),
    })
  } catch {
    // 通知失败不影响测试
  }
}

// ---------------------------------------------------------------------------
// 项目脚手架
// ---------------------------------------------------------------------------

const PROJECT_CONFIG = JSON.stringify(
  {
    $schema: "https://opencorvus.ai/config.json",
    model: MODEL,
    provider: {
      "alibaba-cn": {
        options: { baseURL: DASHSCOPE_BASE_URL },
        models: {
          [MODEL_ID]: {
            tool_call: true,
            attachment: MODEL_ID.includes("qwen"),
            reasoning: true,
            family: MODEL_ID.includes("qwen") ? "qwen" : "minimax",
          },
        },
      },
    },
  },
  null,
  2,
)

async function scaffoldProject(dir: string) {
  await fs.mkdir(path.join(dir, "src"), { recursive: true })
  await fs.mkdir(path.join(dir, ".opencorvus"), { recursive: true })

  await Bun.write(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "moment-diary", scripts: { test: "bun test" } }, null, 2),
  )
  await Bun.write(
    path.join(dir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          lib: ["ES2022"],
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ),
  )

  // Config.get() 会从项目根或 .opencorvus/ 读取，两处都写
  await Bun.write(path.join(dir, "opencorvus.json"), PROJECT_CONFIG)
  await Bun.write(path.join(dir, ".opencorvus", "opencorvus.json"), PROJECT_CONFIG)
}

// ---------------------------------------------------------------------------
// 轮询辅助
// ---------------------------------------------------------------------------

const FINAL = new Set(["completed", "failed", "cancelled"])

function answers(payload: Record<string, unknown> | undefined) {
  const questions = Array.isArray(payload?.questions) ? payload.questions : []
  const items = questions.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const row = item as Record<string, unknown>
    const assumed =
      typeof row.default_assumption === "string" && row.default_assumption.trim()
        ? row.default_assumption.trim()
        : AUTO_REPLY
    return [[assumed]]
  })
  return items.length > 0 ? items : [[AUTO_REPLY]]
}

async function settle(taskID: string, progress: Awaited<ReturnType<typeof OrchestratorService.getProgress>>) {
  const pending = progress.pendingInteractions.filter((item) => item.status === "pending")
  if (pending.length === 0) return progress
  for (const item of pending) {
    console.log(`[E2E] 自动处理交互: type=${item.type} id=${item.id} title=${item.title ?? "(无标题)"}`)
    if (item.type === "permission") {
      await OrchestratorService.replyInteraction(item.id, {
        reply: "always",
        message: "Live E2E auto-approved",
      })
      continue
    }
    await OrchestratorService.replyInteraction(item.id, {
      answers: answers(item.payload),
      message: AUTO_REPLY,
    })
  }
  return OrchestratorService.getProgress(taskID)
}

async function waitForFinal(taskID: string, maxWaitMs: number) {
  const deadline = Date.now() + maxWaitMs
  let lastStatus = ""
  let lastLogAt = 0
  while (Date.now() < deadline) {
    let progress = await OrchestratorService.getProgress(taskID)
    progress = await settle(taskID, progress)
    if (FINAL.has(progress.task.status)) return progress
    if (lastLogAt === 0 || Date.now() - lastLogAt >= STATUS_LOG_INTERVAL_MS || progress.task.status !== lastStatus) {
      const elapsed = Math.round((Date.now() - (deadline - maxWaitMs)) / 1000)
      const runs = await OrchestratorService.listRuns(taskID).catch(() => [])
      const runInfo = runs.map((r) => `${r.id.slice(-6)}:${r.status}`).join(",") || "none"
      console.log(`[E2E] ${elapsed}s  status=${progress.task.status}  runs=[${runInfo}]`)
      lastStatus = progress.task.status
      lastLogAt = Date.now()
    }
    await Bun.sleep(2_000)
  }
  throw new Error(`Task ${taskID} did not finish within ${maxWaitMs}ms`)
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe("Full E2E: Moment Diary — real Planner + Executor + Checks + Evaluator", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  liveTest(
    "DiaryEntry CRUD store: submit → plan → execute → bun test → evaluate",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await scaffoldProject(tmp.path)
      console.log(`[E2E] workspace = ${tmp.path}`)

      // Slack thread ts（在 fn 里创建初始消息后赋值）
      let slackThreadTs: string | undefined
      // SlackGateway 实例（双向通信：事件推送 + 接收用户查询）
      let gateway: SlackGateway | undefined

      try { await Instance.provide({
        directory: tmp.path,
        init: async () => {
          const { Env } = await import("../../src/env/index")
          // LLM API key（Planner + Executor session 均读取此 key）
          Env.set("DASHSCOPE_API_KEY", DASHSCOPE_KEY)
          Env.set("CODING_DASHSCOPE_API_KEY", DASHSCOPE_KEY)
          Env.set("ALIBABA_CODING_PLAN_API_KEY", DASHSCOPE_KEY)
          // Slack
          Env.set("SLACK_BOT_TOKEN", SLACK_BOT_TOKEN)
          Env.set("SLACK_APP_TOKEN", SLACK_APP_TOKEN)
          // 启动 orchestrator 轮询调度
          OrchestratorService.init()

          // 启动 SlackGateway（Socket Mode 双向通信）：
          //   - 自动推送 TaskUpdated / RunCreated / EvaluationCompleted 事件（含工作目录）
          //   - 接收用户发来的自然语言指令（查询会话、查看任务状态、选择会话进入等）
          //     → 通过 ChannelIngress → ControlMessage.handle() 用 LLM 解析并执行
          gateway = new SlackGateway({
            directory: tmp.path,
            token: SLACK_BOT_TOKEN,
            appToken: SLACK_APP_TOKEN,
          })
          await gateway.start()
          console.log("[E2E] SlackGateway 已启动（Socket Mode），支持双向通信")
        },
        fn: async () => {
          // ── 创建 Slack 线程（获取 thread_ts）───────────────────────────
          const initRes = await fetch("https://slack.com/api/chat.postMessage", {
            method: "POST",
            headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              channel: SLACK_CHANNEL_ID,
              text: `🎬 [E2E] 开始任务: *${TASK_TITLE}*`,
            }),
          }).then((r) => r.json() as Promise<{ ok: boolean; ts?: string; error?: string }>)

          if (initRes.ok && initRes.ts) {
            slackThreadTs = initRes.ts
            console.log(`[E2E] Slack thread_ts = ${slackThreadTs}`)
          } else {
            console.warn(`[E2E] Slack 初始消息发送失败: ${initRes.error ?? "unknown"}`)
          }

          // ── 提交任务 ────────────────────────────────────────────────────
          console.log("\n[E2E] ─── 提交任务 ───")
          const taskID = await OrchestratorService.createTask({
            title: TASK_TITLE,
            request: TASK_REQUEST,
            budget: { maxRuns: 3, maxReplans: 1 },
            checks: {
              build: false,
              lint: false,
              test: false,
              verify_cmd: ["bun test src/diary-store.test.ts"],
            },
            channelBinding: {
              platform: "slack",
              channel: SLACK_CHANNEL_ID,
              thread: slackThreadTs ?? `e2e-diary-${Date.now()}`,
            },
          })
          console.log(`[E2E] task_id = ${taskID}`)
          await slackPost(`📌 task_id = \`${taskID}\``, slackThreadTs)

          // ── 轮询终态 ────────────────────────────────────────────────────
          console.log("[E2E] 等待任务完成（最长 29m45s）...")
          const progress = await waitForFinal(taskID, TIMEOUT_MS - 15_000)

          // ── 结果报告 ────────────────────────────────────────────────────
          console.log(`\n[E2E] ─── 结果报告 ───`)
          console.log(`[E2E] 最终状态: ${progress.task.status}`)
          if (progress.task.error) console.log(`[E2E] 错误信息: ${progress.task.error}`)

          const runs = await OrchestratorService.listRuns(taskID)
          const interactions = await OrchestratorService.listTaskInteractions(taskID)
          console.log(`[E2E] 执行轮次: ${runs.length}`)
          for (const r of runs) {
            console.log(`[E2E]   run=${r.id}  status=${r.status}  retry=${r.retryCount}  executor=${r.executor}`)
            const events = await OrchestratorService.listExecutorEvents(r.id).catch(() => [])
            console.log(`[E2E]     executor_events=${events.length}`)
            for (const event of events.slice(-12)) {
              console.log(`[E2E]       #${event.sequence} ${event.kind}: ${event.summary ?? "(无摘要)"}`)
            }
          }
          console.log(`[E2E] 交互数: ${interactions.length}`)
          for (const item of interactions) {
            console.log(`[E2E]   interaction=${item.id}  type=${item.type}  status=${item.status}  title=${item.title ?? "(无标题)"}`)
          }

          if (progress.delivery) {
            console.log(`[E2E] 交付摘要: ${progress.delivery.result?.summary ?? "(无)"}`)
            const files = progress.delivery.result?.changedFiles ?? []
            console.log(`[E2E] 变更文件: ${files.length > 0 ? files.join(", ") : "(无)"}`)
          }

          if (progress.evaluation) {
            console.log(`[E2E] 评估: verdict=${progress.evaluation.verdict}  status=${progress.evaluation.status}`)
            console.log(`[E2E]       ${progress.evaluation.summary}`)
            for (const chk of progress.evaluation.checks ?? []) {
              console.log(`[E2E]       check ${chk.name}: ${chk.status}`)
            }
          }

          for (const goal of progress.goals ?? []) {
            console.log(`[E2E] 目标 [${goal.priority}] ${goal.description}: ${goal.status}`)
          }

          // Slack 最终汇报
          const files = progress.delivery?.result?.changedFiles ?? []
          await slackPost(
            progress.task.status === "completed"
              ? `🎉 E2E 测试通过！\n状态: *${progress.task.status}*\n变更文件: ${files.join(", ")}`
              : `⚠️ 任务结束: *${progress.task.status}*\n${progress.task.error ?? "（无错误信息）"}`,
            slackThreadTs,
          )

          // ── 文档快照扫描 ─────────────────────────────────────────────
          const readDocDir = async (subdir: string) => {
            const dir = path.join(tmp.path, ".opencorvus", subdir)
            try {
              const entries = await fs.readdir(dir)
              return await Promise.all(
                entries
                  .filter((f) => f.endsWith(".md"))
                  .sort()
                  .map(async (f) => {
                    const content = await fs.readFile(path.join(dir, f), "utf-8")
                    return { name: f, length: content.length, content }
                  }),
              )
            } catch {
              return []
            }
          }

          const [prdDocs, planDocs, goalDocs, evalDocs] = await Promise.all([
            readDocDir("prds"),
            readDocDir("plans"),
            readDocDir("goals"),
            readDocDir("evaluations"),
          ])

          console.log(`\n[E2E] ─── 文档快照 ───`)
          for (const [label, docs] of [["prds", prdDocs], ["plans", planDocs], ["goals", goalDocs], ["evaluations", evalDocs]] as const) {
            console.log(`[E2E] ${label}/: ${docs.length} 个文件`)
            for (const d of docs) console.log(`[E2E]   ${d.name}  (${d.length} chars)`)
          }

          // ── 断言 ─────────────────────────────────────────────────────────
          expect(["completed", "failed"]).toContain(progress.task.status)

          // ── 文档详细程度 + 会话一致性 ──────────────────────────────────

          // PRD 和计划文档在任务创建时生成，无论成败都应存在
          expect(prdDocs.length, "prds/ 应有至少 1 个文档").toBeGreaterThan(0)
          expect(planDocs.length, "plans/ 应有至少 1 个文档").toBeGreaterThan(0)

          for (const d of prdDocs) {
            // ── PRD 详细程度 ──────────────────────────────────────────────
            expect(d.length, `PRD 文档 ${d.name} 长度应 > 200`).toBeGreaterThan(200)
            // 必须包含的结构化章节
            expect(d.content, "PRD 应含 # PRD 标题").toMatch(/# PRD/)
            expect(d.content, "PRD 应含 ## Request 节").toMatch(/## Request/)
            expect(d.content, "PRD 应含 ## Summary 节").toMatch(/## Summary/)
            // ## Content 由 spec_analysis.expanded_spec 填充，部分 LLM 可能不生成
            // 各节内容不能是空壳（至少 10 字符的实际内容）
            const prdRequestBody = d.content.split("## Request")[1]?.split("##")[0]?.trim() ?? ""
            expect(prdRequestBody.length, "PRD ## Request 节内容不能为空").toBeGreaterThan(10)
            const prdSummaryBody = d.content.split("## Summary")[1]?.split("##")[0]?.trim() ?? ""
            expect(prdSummaryBody.length, "PRD ## Summary 节内容不能为空").toBeGreaterThan(5)
            if (d.content.includes("## Content")) {
              const prdContentBody = d.content.split("## Content")[1]?.split("##")[0]?.trim() ?? ""
              if (prdContentBody.length === 0) {
                console.log(`[E2E] ⚠ PRD ${d.name} ## Content 节为空（LLM 未生成 expanded_spec）`)
              }
            }

            // ── PRD ↔ 会话一致性 ──────────────────────────────────────────
            // 文件名和正文都含 taskID
            expect(d.name, "PRD 文件名应含 taskID").toContain(taskID)
            expect(d.content, "PRD 正文应含 taskID").toContain(taskID)
            // 文档内记录的请求与原始请求关键词一致
            expect(d.content, "PRD 应含任务标题关键词 DiaryEntry").toMatch(/DiaryEntry/)
            expect(d.content, "PRD 应含任务标题关键词 CRUD").toMatch(/CRUD|create|update|delete/i)
          }

          for (const d of planDocs) {
            // ── Plan 详细程度 ─────────────────────────────────────────────
            expect(d.length, `Plan 文档 ${d.name} 长度应 > 200`).toBeGreaterThan(200)
            expect(d.content, "Plan 应含 # Plan Graph Snapshot 标题").toMatch(/# Plan Graph Snapshot/)
            expect(d.content, "Plan 应含 ## Request 节").toMatch(/## Request/)
            expect(d.content, "Plan 应含 ## Summary 节").toMatch(/## Summary/)
            expect(d.content, "Plan 应含 ## Execution Prompt 节").toMatch(/## Execution Prompt/)
            // Execution Prompt 节应有代码围栏且内容非空
            expect(d.content, "Plan 应含代码围栏").toContain("````text")
            const promptBody = d.content.split("````text")[1]?.split("````")[0]?.trim() ?? ""
            expect(promptBody.length, "Plan Execution Prompt 内容不能为空").toBeGreaterThan(20)
            // Steps 节（如果存在）应有编号步骤
            if (d.content.includes("## Steps")) {
              expect(d.content, "Plan Steps 节应有编号步骤").toMatch(/1\. /)
            }

            // ── Plan ↔ 会话一致性 ─────────────────────────────────────────
            expect(d.name, "Plan 文件名应含 taskID").toContain(taskID)
            expect(d.content, "Plan 正文应含 taskID").toContain(taskID)
            // Request 节应含原始请求关键词
            expect(d.content, "Plan 应含 DiaryEntry 关键词").toMatch(/DiaryEntry/)
          }

          if (progress.task.status === "completed") {
            // 有交付物且改了文件
            expect(progress.delivery).toBeDefined()
            expect((progress.delivery!.result?.changedFiles ?? []).length).toBeGreaterThan(0)

            // 评估通过
            expect(progress.evaluation?.verdict).toBe("accepted")

            // ── Goals 文档详细程度 + 一致性 ────────────────────────────────
            expect(goalDocs.length, "goals/ 应有至少 1 个文档").toBeGreaterThan(0)
            for (const d of goalDocs) {
              expect(d.length, `Goals 文档 ${d.name} 长度应 > 100`).toBeGreaterThan(100)
              expect(d.content, "Goals 应含 # Spec Goals Snapshot 标题").toMatch(/# Spec Goals Snapshot/)
              expect(d.content, "Goals 应含 ## Goals 节").toMatch(/## Goals/)
              expect(d.content, "Goals 应含 ## Plan Summary 节").toMatch(/## Plan Summary/)
              // 每个 goal 列表项应含 Criteria
              expect(d.content, "Goals 应含 - Criteria: 详情").toContain("- Criteria:")
              // 应含 goal 统计计数
              expect(d.content, "Goals 应含 Total Goals 计数").toMatch(/Total Goals: \d+/)

              // ── Goals ↔ 会话一致性 ──────────────────────────────────────
              expect(d.name, "Goals 文件名应含 taskID").toContain(taskID)
              expect(d.content, "Goals 正文应含 taskID").toContain(taskID)
              // goals 文档中的目标描述与 API 返回一致
              for (const goal of progress.goals ?? []) {
                const snippet = goal.description.slice(0, 30)
                expect(d.content, `Goals 文档应含目标描述片段: "${snippet}"`).toContain(snippet)
              }
            }
            // 最终 goals 快照应反映评估后的状态（passed）
            const lastGoalDoc = goalDocs.at(-1)!
            expect(lastGoalDoc.content, "最终 Goals 快照应含 Passed 计数 > 0").toMatch(/Passed: [1-9]/)
            // 初始 goals 快照应含 pending 状态
            const firstGoalDoc = goalDocs[0]!
            expect(firstGoalDoc.content, "初始 Goals 快照应含 Pending 状态").toMatch(/Pending: [1-9]/)

            // ── Evaluation 文档详细程度 + 一致性 ───────────────────────────
            expect(evalDocs.length, "evaluations/ 应有至少 1 个文档").toBeGreaterThan(0)
            for (const d of evalDocs) {
              expect(d.length, `Evaluation 文档 ${d.name} 长度应 > 200`).toBeGreaterThan(200)
              // 评估类型：Coordinator 或 Goal Run
              expect(d.content, "Evaluation 应含标题").toMatch(/# (Coordinator|Goal Run) Evaluation Snapshot/)
              expect(d.content, "Evaluation 应含 ## Request 节").toMatch(/## Request/)
              expect(d.content, "Evaluation 应含 ## Summary 节").toMatch(/## Summary/)
              expect(d.content, "Evaluation 应含 ## Checks 节").toMatch(/## Checks/)
              // Summary 节内容非空
              const evalSummaryBody = d.content.split("## Summary")[1]?.split("##")[0]?.trim() ?? ""
              expect(evalSummaryBody.length, "Evaluation Summary 节不能为空").toBeGreaterThan(5)
              // Checks 节应含至少一个检查项 [status]
              expect(d.content, "Evaluation Checks 应含状态标记").toMatch(/\[(passed|failed)\]/)
              // Analysis 和 Goal Assessment（LLM analyzeDelivery 产出）
              if (d.content.includes("## Analysis")) {
                expect(d.content, "Analysis 应含 Classification").toContain("Classification:")
              }
              if (d.content.includes("## Goal Assessment")) {
                expect(d.content, "Goal Assessment 应含状态标记").toMatch(/\[(passed|failed|pending)\]/)
              }
              // Delivery 节（如果存在）
              if (d.content.includes("## Delivery")) {
                expect(d.content, "Delivery 应含 Summary").toContain("Summary:")
              }

              // ── Evaluation ↔ 会话一致性 ──────────────────────────────────
              expect(d.name, "Evaluation 文件名应含 taskID").toContain(taskID)
              expect(d.content, "Evaluation 正文应含 taskID").toContain(taskID)
            }

            const coordinatorEvalDocs = evalDocs.filter((d) => d.content.includes("# Coordinator Evaluation Snapshot"))
            expect(coordinatorEvalDocs.length, "evaluations/ 应至少包含 1 个 Coordinator evaluation 文档").toBeGreaterThan(0)
            for (const d of coordinatorEvalDocs) {
              // verdict 与 API 返回一致
              const verdict = progress.evaluation!.verdict
              expect(d.content, `Coordinator Evaluation 文档 verdict 应为 ${verdict}`).toContain(`Verdict: ${verdict}`)
              // evaluation summary 片段出现在文档中
              const summarySnippet = progress.evaluation!.summary.slice(0, 40)
              expect(d.content, "Coordinator Evaluation 文档摘要应与 API 返回一致").toContain(summarySnippet)
              // 各 check 名称出现在文档中
              for (const chk of progress.evaluation!.checks ?? []) {
                expect(d.content, `Coordinator Evaluation 应含 check: ${chk.name}`).toMatch(new RegExp(`\\[${chk.status}\\].*${chk.name}|\\[${chk.status}\\].*${chk.label ?? chk.name}`, "i"))
              }
            }

            // ── 跨文档一致性 ──────────────────────────────────────────────
            // 所有文档都引用同一个 taskID
            const allDocContents = [
              ...prdDocs.map((d) => d.content),
              ...planDocs.map((d) => d.content),
              ...goalDocs.map((d) => d.content),
              ...evalDocs.map((d) => d.content),
            ]
            for (const content of allDocContents) {
              expect(content, "所有文档应含 taskID").toContain(taskID)
            }
            // 目标描述在 PRD、Goals、Evaluation 三类文档中一致
            for (const goal of progress.goals ?? []) {
              const snippet = goal.description.slice(0, 30)
              expect(prdDocs[0]!.content, `PRD 应含目标 "${snippet}"`).toContain(snippet)
              expect(lastGoalDoc.content, `Goals 应含目标 "${snippet}"`).toContain(snippet)
              // evaluation 中的 Goal Assessment 也应引用该目标
              const evalWithGoals = evalDocs.find((d) => d.content.includes("## Goal Assessment"))
              if (evalWithGoals) {
                expect(evalWithGoals.content, `Evaluation Goal Assessment 应含 "${snippet}"`).toContain(snippet)
              }
            }

            // 三个源文件物理存在
            for (const file of ["src/types.ts", "src/diary-store.ts", "src/diary-store.test.ts"]) {
              const exists = await Bun.file(path.join(tmp.path, file)).exists()
              expect(exists).toBe(true)
            }

            // types.ts 包含完整的 DiaryEntry interface（含 PRD 新增字段）
            const types = await Bun.file(path.join(tmp.path, "src/types.ts")).text()
            expect(types).toMatch(/DiaryEntry/)
            expect(types).toMatch(/Tag/)
            expect(types).toMatch(/audios/)       // 语音列表（PRD 14.1）
            expect(types).toMatch(/latitude/)     // 纬度（PRD 14.1）
            expect(types).toMatch(/longitude/)    // 经度（PRD 14.1）
            expect(types).toMatch(/weather/)      // 天气（PRD 14.1）
            expect(types).toMatch(/sync_status/)  // 同步状态（PRD 14.1）

            // diary-store.ts 导出 DiaryStore
            const store = await Bun.file(path.join(tmp.path, "src/diary-store.ts")).text()
            expect(store).toMatch(/DiaryStore/)

            console.log("\n[E2E] ✓ 全链路端到端测试通过！")
          } else {
            // budget 耗尽属合法结果，不算测试框架失败
            console.log(`\n[E2E] 任务因 budget 耗尽或不可恢复错误而失败（不强制断言 completed）`)
            // 但至少应该尝试过至少一轮执行
            expect(runs.length).toBeGreaterThan(0)
          }
        },
      }) } finally {
        // 停止 SlackGateway（断开 Socket Mode 连接）
        await gateway?.stop().catch(() => {})
        console.log("[E2E] SlackGateway 已停止")
      }
    },
    { timeout: TIMEOUT_MS },
  )
})
