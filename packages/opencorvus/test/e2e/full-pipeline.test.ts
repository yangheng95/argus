/**
 * Full end-to-end test: real Planner LLM → real OpencodeExecutor → real Checks → real Evaluator LLM.
 *
 * 无任何 mock。全链路：
 *   createTask → plan (real LLM) → execute (real opencorvus session) → verify (bun test) → evaluate (real LLM)
 *   → retry/replan (budget: maxRuns=5, maxReplans=2) → assert final state
 *
 * 任务: 根据 Moment Diary 完整 PRD（specs/prd.txt 全部 22 节），实现 V1.0 MVP 后端核心层：
 *   3 个数据模型 + 8 个 Store/Service + 全覆盖测试。
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

const TIMEOUT_MS = parseInt(process.env.OPENCORVUS_E2E_TIMEOUT_MS ?? "3600000", 10) // 60 分钟
const AUTO_REPLY = "Use reasonable defaults consistent with the task request, keep the scope minimal, continue execution, and do not ask again unless absolutely necessary."
const STATUS_LOG_INTERVAL_MS = parseInt(process.env.OPENCORVUS_E2E_STATUS_LOG_INTERVAL_MS ?? "60000", 10)

// ---------------------------------------------------------------------------
// 任务内容（完整 PRD V1.0 MVP 后端实现）
// ---------------------------------------------------------------------------

const TASK_TITLE = "实现 Moment Diary V1.0 MVP 完整后端"

const TASK_REQUEST = `
# 项目背景

Moment Diary 是一款个人日记 App（PRD V1.0，2026-03-10）。
本任务要求用 TypeScript 实现 V1.0 MVP 的完整后端核心层（内存存储，无需数据库）。

---

# 一、数据结构设计（PRD 第14节）

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
| sync_status | string | 同步状态（local/synced/syncing/conflict） |

## 14.2 标签实体 Tag

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 标签 ID |
| user_id | string | 用户 ID |
| name | string | 标签名（最长 20 字） |
| color | string | 标签颜色（hex） |
| created_at | number | 创建时间戳（ms） |

## 14.3 用户实体 User

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 用户 ID |
| nickname | string | 昵称 |
| avatar | string | 头像 URL |
| email | string | 邮箱 |
| phone | string | 手机号 |
| password_hash | string | 密码哈希（简单 hash 即可） |
| login_type | string | 登录方式（email/phone/guest） |
| is_vip | boolean | 是否会员 |
| lock_enabled | boolean | 是否开启应用锁 |
| lock_pin | string | 锁屏 PIN（4-6位） |
| biometric_enabled | boolean | 是否开启生物识别 |
| reminder_enabled | boolean | 是否开启提醒 |
| reminder_time | string | 提醒时间（HH:mm 格式） |
| theme_mode | string | 主题模式（light/dark/system） |
| created_at | number | 创建时间戳（ms） |
| updated_at | number | 更新时间戳（ms） |

---

# 二、要求创建的文件（全部在 src/ 下）

## 1. src/types.ts — 类型定义
导出以下 TypeScript interface 和类型：
- \`DiaryEntry\` — 字段与 14.1 完全一致
- \`Tag\` — 字段与 14.2 完全一致
- \`User\` — 字段与 14.3 完全一致
- \`Mood\` 类型或常量 — "very_happy" | "happy" | "calm" | "sad" | "anxious" | "angry"
- \`SyncStatus\` 类型 — "local" | "synced" | "syncing" | "conflict"
- \`DiaryTemplate\` interface — { id: string, name: string, prompts: string[] }
- \`SearchFilter\` interface — { keyword?: string, mood?: string, tag?: string, startDate?: number, endDate?: number, hasFavorite?: boolean, hasImages?: boolean, hasLocation?: boolean }
- \`CalendarDay\` interface — { date: string(YYYY-MM-DD), count: number, moods: string[] }
- \`MoodStat\` interface — { mood: string, count: number, percentage: number }
- \`DiaryStats\` interface — { totalEntries: number, totalDays: number, currentStreak: number, longestStreak: number, moodDistribution: MoodStat[], topTags: Array<{tag: string, count: number}>, averageEntriesPerWeek: number }

## 2. src/diary-store.ts — 日记 CRUD 存储
\`DiaryStore\` class（内存 Map）：
- \`create(entry)\` — 自动 id/created_at/updated_at/deleted_at=null，tags>10 抛错，每个 tag 长度>20 字抛错
- \`get(id)\` — 返回日记或 undefined
- \`update(id, patch)\` — 更新 updated_at，返回日记或 undefined
- \`delete(id)\` — 软删除（deleted_at = Date.now()），返回 boolean
- \`hardDelete(id)\` — 彻底删除（从 Map 移除），返回 boolean
- \`restore(id)\` — 恢复软删除（deleted_at = null），返回日记或 undefined
- \`list(userId)\` — 返回该用户未删除日记，按 diary_at 降序
- \`listDeleted(userId)\` — 返回该用户已软删除日记，按 deleted_at 降序
- \`toggleFavorite(id)\` — 切换 is_favorite，返回日记或 undefined

## 3. src/tag-store.ts — 标签 CRUD 存储
\`TagStore\` class（内存 Map）：
- \`create(tag)\` — 自动 id/created_at，name 长度>20 字抛错，同用户重名抛错
- \`get(id)\` — 返回 Tag 或 undefined
- \`update(id, patch)\` — 返回 Tag 或 undefined
- \`delete(id)\` — 硬删除，返回 boolean
- \`listByUser(userId)\` — 返回该用户所有标签，按 created_at 降序
- \`findByName(userId, name)\` — 按名称查找

## 4. src/user-store.ts — 用户存储与认证
\`UserStore\` class（内存 Map）：
- \`register(input: {nickname, email?, phone?, password})\` — 创建用户，密码用简单 hash（如 btoa 或自定义），邮箱/手机号已存在则抛错
- \`login(input: {email?: string, phone?: string, password: string})\` — 验证密码，返回 User 或 null
- \`get(id)\` — 返回 User 或 undefined
- \`update(id, patch)\` — 更新 updated_at，返回 User 或 undefined
- \`setLock(id, pin)\` — 设置应用锁 PIN
- \`verifyLock(id, pin)\` — 验证 PIN
- \`setReminder(id, enabled, time?)\` — 设置提醒

## 5. src/search-service.ts — 搜索与筛选
\`SearchService\` class（依赖 DiaryStore）：
- \`search(userId, filter: SearchFilter)\` — 全文搜索（keyword 匹配 title/content/tags/location_name），支持心情/标签/时间/收藏/图片/位置筛选
- 搜索结果按 diary_at 降序

## 6. src/calendar-service.ts — 日历视图
\`CalendarService\` class（依赖 DiaryStore）：
- \`getMonthView(userId, year, month)\` — 返回 CalendarDay[]，含每天日记数量和心情列表
- \`getEntriesByDate(userId, date: string)\` — 返回某天所有日记

## 7. src/statistics-service.ts — 数据统计
\`StatisticsService\` class（依赖 DiaryStore）：
- \`getStats(userId)\` — 返回 DiaryStats：总日记数、总天数、当前连续天数、最长连续天数、心情分布、热门标签 Top10、周均日记数
- \`getMoodTrend(userId, days: number)\` — 返回最近 N 天每天的主心情

## 8. src/template-service.ts — 模板写作
\`TemplateService\` class：
- 内置模板列表（至少 8 个）：自由日记、三句话日记、感恩日记、情绪日记、旅行日记、梦境记录、工作复盘、今日小确幸
- \`list()\` — 返回所有内置模板
- \`get(id)\` — 返回模板或 undefined
- \`applyTemplate(templateId)\` — 返回 { title: string, contentPrompt: string } 供前端填充

## 9. src/export-service.ts — 导出功能
\`ExportService\` class（依赖 DiaryStore）：
- \`exportToMarkdown(userId)\` — 导出该用户所有未删除日记为 Markdown 格式字符串
- \`exportEntry(entryId)\` — 导出单篇日记为 Markdown 字符串

---

# 三、测试文件（全部在 src/ 下，用 bun:test）

每个 Store/Service 必须有对应测试文件，覆盖核心功能：

## src/diary-store.test.ts
1. create 返回含完整字段的日记（含 audios、sync_status 等）
2. get 可取到刚创建的日记
3. update 更新字段并刷新 updated_at
4. delete 软删除后 deleted_at 不为 null
5. hardDelete 彻底删除后 get 返回 undefined
6. restore 恢复软删除后 deleted_at 为 null
7. list 只返回未删除日记，按 diary_at 降序
8. listDeleted 返回已删除日记
9. toggleFavorite 切换收藏状态
10. tags 超过 10 个时 create 抛错
11. tag 长度超过 20 字时 create 抛错

## src/tag-store.test.ts
1. create 返回含 id 和 created_at 的标签
2. 同用户重名标签 create 抛错
3. name 超过 20 字 create 抛错
4. listByUser 返回该用户标签
5. findByName 正确查找
6. delete 后 get 返回 undefined

## src/user-store.test.ts
1. register 创建用户成功
2. 重复邮箱 register 抛错
3. login 正确密码返回 User
4. login 错误密码返回 null
5. setLock 和 verifyLock 正确工作
6. setReminder 正确工作

## src/search-service.test.ts
1. keyword 搜索匹配 title
2. keyword 搜索匹配 content
3. keyword 搜索匹配 tags
4. mood 筛选正确
5. 时间范围筛选正确
6. 收藏筛选正确

## src/calendar-service.test.ts
1. getMonthView 返回正确天数和心情
2. getEntriesByDate 返回指定日期的日记

## src/statistics-service.test.ts
1. getStats 返回正确的总数和心情分布
2. 连续天数计算正确
3. topTags 排序正确

## src/template-service.test.ts
1. list 返回至少 8 个模板
2. get 返回正确模板
3. applyTemplate 返回非空的 title 和 contentPrompt

## src/export-service.test.ts
1. exportToMarkdown 返回含所有日记的 Markdown
2. exportEntry 返回含标题和内容的 Markdown
3. exportToMarkdown 不含已删除日记

---

# 四、约束
- 只创建/修改 src/ 下的文件，不修改 package.json / tsconfig.json
- 不引入任何第三方依赖
- 所有 Store/Service 均使用内存存储（Map），无需数据库
- 所有 ID 用 crypto.randomUUID() 生成
- 所有时间戳均为 ms 级 number（Date.now()）
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

describe("Full E2E: Moment Diary MVP — real Planner + Executor + Checks + Evaluator", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  liveTest(
    "Moment Diary V1.0 MVP 完整后端: submit → plan → execute → bun test → evaluate",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await scaffoldProject(tmp.path)
      console.log(`[E2E] workspace = ${tmp.path}`)

      // Slack thread ts（在 fn 里创建初始消息后赋值）
      let slackThreadTs: string | undefined
      // SlackGateway 实例（双向通信：事件推送 + 接收用户查询）
      let gateway: SlackGateway | undefined
      // taskID 提升到外部作用域，供 finally 块清理
      let taskID: string | undefined

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
          taskID = await OrchestratorService.createTask({
            title: TASK_TITLE,
            request: TASK_REQUEST,
            budget: { maxRuns: 5, maxReplans: 2 },
            checks: {
              build: false,
              lint: false,
              test: false,
              verify_cmd: ["bun test"],
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
          console.log("[E2E] 等待任务完成（最长 59m45s）...")
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
            expect(d.length, `PRD 文档 ${d.name} 长度应 > 200`).toBeGreaterThan(200)
            expect(d.content, "PRD 应含 # PRD 标题").toMatch(/# PRD/)
            expect(d.content, "PRD 应含 ## Request 节").toMatch(/## Request/)
            expect(d.content, "PRD 应含 ## Summary 节").toMatch(/## Summary/)
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
            expect(d.name, "PRD 文件名应含 taskID").toContain(taskID)
            expect(d.content, "PRD 正文应含 taskID").toContain(taskID)
            // MVP 完整 PRD 关键词
            expect(d.content, "PRD 应含 DiaryEntry 关键词").toMatch(/DiaryEntry/)
            expect(d.content, "PRD 应含 MVP 或 Moment Diary 关键词").toMatch(/MVP|Moment Diary/i)
          }

          for (const d of planDocs) {
            expect(d.length, `Plan 文档 ${d.name} 长度应 > 200`).toBeGreaterThan(200)
            expect(d.content, "Plan 应含 # Plan Graph Snapshot 标题").toMatch(/# Plan Graph Snapshot/)
            expect(d.content, "Plan 应含 ## Request 节").toMatch(/## Request/)
            expect(d.content, "Plan 应含 ## Summary 节").toMatch(/## Summary/)
            expect(d.content, "Plan 应含 ## Execution Prompt 节").toMatch(/## Execution Prompt/)
            expect(d.content, "Plan 应含代码围栏").toContain("````text")
            const promptBody = d.content.split("````text")[1]?.split("````")[0]?.trim() ?? ""
            expect(promptBody.length, "Plan Execution Prompt 内容不能为空").toBeGreaterThan(20)
            if (d.content.includes("## Steps")) {
              expect(d.content, "Plan Steps 节应有编号步骤").toMatch(/1\. /)
            }
            expect(d.name, "Plan 文件名应含 taskID").toContain(taskID)
            expect(d.content, "Plan 正文应含 taskID").toContain(taskID)
            expect(d.content, "Plan 应含 DiaryEntry 关键词").toMatch(/DiaryEntry/)
          }

          if (progress.task.status === "completed") {
            // 有交付物且改了文件
            expect(progress.delivery).toBeDefined()
            const changedFiles = progress.delivery!.result?.changedFiles ?? []
            expect(changedFiles.length, "交付物应含多个文件").toBeGreaterThan(5)

            // 评估通过
            expect(progress.evaluation?.verdict).toBe("accepted")

            // ── Goals 文档详细程度 + 一致性 ────────────────────────────────
            expect(goalDocs.length, "goals/ 应有至少 1 个文档").toBeGreaterThan(0)
            for (const d of goalDocs) {
              expect(d.length, `Goals 文档 ${d.name} 长度应 > 100`).toBeGreaterThan(100)
              expect(d.content, "Goals 应含 # Spec Goals Snapshot 标题").toMatch(/# Spec Goals Snapshot/)
              expect(d.content, "Goals 应含 ## Goals 节").toMatch(/## Goals/)
              expect(d.content, "Goals 应含 ## Plan Summary 节").toMatch(/## Plan Summary/)
              expect(d.content, "Goals 应含 - Criteria: 详情").toContain("- Criteria:")
              expect(d.content, "Goals 应含 Total Goals 计数").toMatch(/Total Goals: \d+/)
              expect(d.name, "Goals 文件名应含 taskID").toContain(taskID)
              expect(d.content, "Goals 正文应含 taskID").toContain(taskID)
              for (const goal of progress.goals ?? []) {
                const snippet = goal.description.slice(0, 30)
                expect(d.content, `Goals 文档应含目标描述片段: "${snippet}"`).toContain(snippet)
              }
            }
            const lastGoalDoc = goalDocs.at(-1)!
            expect(lastGoalDoc.content, "最终 Goals 快照应含 Passed 计数 > 0").toMatch(/Passed: [1-9]/)
            const firstGoalDoc = goalDocs[0]!
            expect(firstGoalDoc.content, "初始 Goals 快照应含 Pending 状态").toMatch(/Pending: [1-9]/)

            // ── Evaluation 文档详细程度 + 一致性 ───────────────────────────
            expect(evalDocs.length, "evaluations/ 应有至少 1 个文档").toBeGreaterThan(0)
            for (const d of evalDocs) {
              expect(d.length, `Evaluation 文档 ${d.name} 长度应 > 200`).toBeGreaterThan(200)
              expect(d.content, "Evaluation 应含标题").toMatch(/# (Coordinator|Goal Run) Evaluation Snapshot/)
              expect(d.content, "Evaluation 应含 ## Request 节").toMatch(/## Request/)
              expect(d.content, "Evaluation 应含 ## Summary 节").toMatch(/## Summary/)
              expect(d.content, "Evaluation 应含 ## Checks 节").toMatch(/## Checks/)
              const evalSummaryBody = d.content.split("## Summary")[1]?.split("##")[0]?.trim() ?? ""
              expect(evalSummaryBody.length, "Evaluation Summary 节不能为空").toBeGreaterThan(5)
              expect(d.content, "Evaluation Checks 应含状态标记").toMatch(/\[(passed|failed)\]/)
              if (d.content.includes("## Analysis")) {
                expect(d.content, "Analysis 应含 Classification").toContain("Classification:")
              }
              if (d.content.includes("## Goal Assessment")) {
                expect(d.content, "Goal Assessment 应含状态标记").toMatch(/\[(passed|failed|pending)\]/)
              }
              if (d.content.includes("## Delivery")) {
                expect(d.content, "Delivery 应含 Summary").toContain("Summary:")
              }
              expect(d.name, "Evaluation 文件名应含 taskID").toContain(taskID)
              expect(d.content, "Evaluation 正文应含 taskID").toContain(taskID)
            }

            const coordinatorEvalDocs = evalDocs.filter((d) => d.content.includes("# Coordinator Evaluation Snapshot"))
            expect(coordinatorEvalDocs.length, "evaluations/ 应至少包含 1 个 Coordinator evaluation 文档").toBeGreaterThan(0)
            for (const d of coordinatorEvalDocs) {
              const verdict = progress.evaluation!.verdict
              expect(d.content, `Coordinator Evaluation 文档 verdict 应为 ${verdict}`).toContain(`Verdict: ${verdict}`)
              const summarySnippet = progress.evaluation!.summary.slice(0, 40)
              expect(d.content, "Coordinator Evaluation 文档摘要应与 API 返回一致").toContain(summarySnippet)
              for (const chk of progress.evaluation!.checks ?? []) {
                expect(d.content, `Coordinator Evaluation 应含 check: ${chk.name}`).toMatch(new RegExp(`\\[${chk.status}\\].*${chk.name}|\\[${chk.status}\\].*${chk.label ?? chk.name}`, "i"))
              }
            }

            // ── 跨文档一致性 ──────────────────────────────────────────────
            const allDocContents = [
              ...prdDocs.map((d) => d.content),
              ...planDocs.map((d) => d.content),
              ...goalDocs.map((d) => d.content),
              ...evalDocs.map((d) => d.content),
            ]
            for (const content of allDocContents) {
              expect(content, "所有文档应含 taskID").toContain(taskID)
            }
            for (const goal of progress.goals ?? []) {
              const snippet = goal.description.slice(0, 30)
              expect(prdDocs[0]!.content, `PRD 应含目标 "${snippet}"`).toContain(snippet)
              expect(lastGoalDoc.content, `Goals 应含目标 "${snippet}"`).toContain(snippet)
              const evalWithGoals = evalDocs.filter((d) => d.content.includes("## Goal Assessment"))
              if (evalWithGoals.length > 0) {
                const found = evalWithGoals.some((d) => d.content.includes(snippet))
                expect(found, `至少一个 Evaluation Goal Assessment 应含 "${snippet}"`).toBe(true)
              }
            }

            // ══════════════════════════════════════════════════════════════
            // 交付物文件验证 — 完整 MVP 后端
            // ══════════════════════════════════════════════════════════════

            // ── 源文件必须存在 ──────────────────────────────────────────
            const requiredSrcFiles = [
              "src/types.ts",
              "src/diary-store.ts",
              "src/tag-store.ts",
              "src/user-store.ts",
              "src/search-service.ts",
              "src/calendar-service.ts",
              "src/statistics-service.ts",
              "src/template-service.ts",
              "src/export-service.ts",
            ]
            for (const file of requiredSrcFiles) {
              const exists = await Bun.file(path.join(tmp.path, file)).exists()
              expect(exists, `源文件 ${file} 应存在`).toBe(true)
            }

            // ── 测试文件必须存在 ────────────────────────────────────────
            const requiredTestFiles = [
              "src/diary-store.test.ts",
              "src/tag-store.test.ts",
              "src/user-store.test.ts",
              "src/search-service.test.ts",
              "src/calendar-service.test.ts",
              "src/statistics-service.test.ts",
              "src/template-service.test.ts",
              "src/export-service.test.ts",
            ]
            for (const file of requiredTestFiles) {
              const exists = await Bun.file(path.join(tmp.path, file)).exists()
              expect(exists, `测试文件 ${file} 应存在`).toBe(true)
            }

            // ── types.ts 完整性检查 ─────────────────────────────────────
            const types = await Bun.file(path.join(tmp.path, "src/types.ts")).text()
            // 三大数据模型
            expect(types, "types.ts 应含 DiaryEntry").toMatch(/DiaryEntry/)
            expect(types, "types.ts 应含 Tag interface").toMatch(/Tag/)
            expect(types, "types.ts 应含 User interface").toMatch(/User/)
            // DiaryEntry 关键字段
            expect(types, "types.ts 应含 mood 字段").toMatch(/mood/)
            expect(types, "types.ts 应含 mood_tags 字段").toMatch(/mood_tags/)
            expect(types, "types.ts 应含 tags 字段").toMatch(/tags/)
            expect(types, "types.ts 应含 images 字段").toMatch(/images/)
            expect(types, "types.ts 应含 audios 字段").toMatch(/audios/)
            expect(types, "types.ts 应含 latitude 字段").toMatch(/latitude/)
            expect(types, "types.ts 应含 longitude 字段").toMatch(/longitude/)
            expect(types, "types.ts 应含 weather 字段").toMatch(/weather/)
            expect(types, "types.ts 应含 is_favorite 字段").toMatch(/is_favorite/)
            expect(types, "types.ts 应含 sync_status 字段").toMatch(/sync_status/)
            expect(types, "types.ts 应含 diary_at 字段").toMatch(/diary_at/)
            expect(types, "types.ts 应含 deleted_at 字段").toMatch(/deleted_at/)
            // User 关键字段
            expect(types, "types.ts 应含 nickname 字段").toMatch(/nickname/)
            expect(types, "types.ts 应含 lock_enabled 字段").toMatch(/lock_enabled/)
            expect(types, "types.ts 应含 reminder_enabled 字段").toMatch(/reminder_enabled/)
            expect(types, "types.ts 应含 reminder_time 字段").toMatch(/reminder_time/)
            expect(types, "types.ts 应含 theme_mode 字段").toMatch(/theme_mode/)
            // 辅助类型
            expect(types, "types.ts 应含 SearchFilter").toMatch(/SearchFilter/)
            expect(types, "types.ts 应含 DiaryTemplate").toMatch(/DiaryTemplate/)
            expect(types, "types.ts 应含 CalendarDay").toMatch(/CalendarDay/)
            expect(types, "types.ts 应含 DiaryStats 或 MoodStat").toMatch(/DiaryStats|MoodStat/)

            // ── diary-store.ts 完整性检查 ────────────────────────────────
            const diaryStore = await Bun.file(path.join(tmp.path, "src/diary-store.ts")).text()
            expect(diaryStore, "diary-store 应含 DiaryStore class").toMatch(/DiaryStore/)
            expect(diaryStore, "diary-store 应含 create 方法").toMatch(/create/)
            expect(diaryStore, "diary-store 应含 delete 方法").toMatch(/delete/)
            expect(diaryStore, "diary-store 应含 list 方法").toMatch(/list/)
            expect(diaryStore, "diary-store 应含软删除逻辑").toMatch(/deleted_at/)
            expect(diaryStore, "diary-store 应含 toggleFavorite 或 favorite 方法").toMatch(/favorite/i)
            expect(diaryStore, "diary-store 应含 restore 或 hardDelete 方法").toMatch(/restore|hardDelete|hard_delete/i)

            // ── tag-store.ts 完整性检查 ──────────────────────────────────
            const tagStore = await Bun.file(path.join(tmp.path, "src/tag-store.ts")).text()
            expect(tagStore, "tag-store 应含 TagStore class").toMatch(/TagStore/)
            expect(tagStore, "tag-store 应含 create 方法").toMatch(/create/)
            expect(tagStore, "tag-store 应含 listByUser 或 list 方法").toMatch(/list/i)

            // ── user-store.ts 完整性检查 ─────────────────────────────────
            const userStore = await Bun.file(path.join(tmp.path, "src/user-store.ts")).text()
            expect(userStore, "user-store 应含 UserStore class").toMatch(/UserStore/)
            expect(userStore, "user-store 应含 register 方法").toMatch(/register/)
            expect(userStore, "user-store 应含 login 方法").toMatch(/login/)
            expect(userStore, "user-store 应含 lock 或 pin 验证").toMatch(/lock|pin|verify/i)

            // ── search-service.ts 完整性检查 ─────────────────────────────
            const searchSvc = await Bun.file(path.join(tmp.path, "src/search-service.ts")).text()
            expect(searchSvc, "search-service 应含 SearchService class").toMatch(/SearchService/)
            expect(searchSvc, "search-service 应含 search 方法").toMatch(/search/)

            // ── calendar-service.ts 完整性检查 ───────────────────────────
            const calendarSvc = await Bun.file(path.join(tmp.path, "src/calendar-service.ts")).text()
            expect(calendarSvc, "calendar-service 应含 CalendarService class").toMatch(/CalendarService/)
            expect(calendarSvc, "calendar-service 应含 month 或 getMonth 方法").toMatch(/month|getMonth/i)

            // ── statistics-service.ts 完整性检查 ─────────────────────────
            const statsSvc = await Bun.file(path.join(tmp.path, "src/statistics-service.ts")).text()
            expect(statsSvc, "statistics-service 应含 StatisticsService class").toMatch(/StatisticsService/)
            expect(statsSvc, "statistics-service 应含 streak 或连续天数逻辑").toMatch(/streak|consecutive|连续/i)
            expect(statsSvc, "statistics-service 应含 mood 统计").toMatch(/mood/i)

            // ── template-service.ts 完整性检查 ───────────────────────────
            const templateSvc = await Bun.file(path.join(tmp.path, "src/template-service.ts")).text()
            expect(templateSvc, "template-service 应含 TemplateService class").toMatch(/TemplateService/)
            expect(templateSvc, "template-service 应含 list 方法").toMatch(/list/)
            // 至少应包含几种内置模板名称
            expect(templateSvc, "template-service 应含感恩日记模板").toMatch(/感恩|gratitude/i)

            // ── export-service.ts 完整性检查 ─────────────────────────────
            const exportSvc = await Bun.file(path.join(tmp.path, "src/export-service.ts")).text()
            expect(exportSvc, "export-service 应含 ExportService class").toMatch(/ExportService/)
            expect(exportSvc, "export-service 应含 markdown 或 export 方法").toMatch(/markdown|export/i)

            // ── 文件总数检查 ─────────────────────────────────────────────
            const allSrcFiles = changedFiles.filter((f: string) => f.startsWith("src/") && f.endsWith(".ts"))
            console.log(`[E2E] 交付源文件数: ${allSrcFiles.length}`)
            console.log(`[E2E] 交付文件列表: ${allSrcFiles.join(", ")}`)
            expect(allSrcFiles.length, "交付应含至少 15 个 .ts 文件（9 源 + 8 测试）").toBeGreaterThanOrEqual(15)

            console.log("\n[E2E] ✓ Moment Diary V1.0 MVP 全链路端到端测试通过！")
          } else {
            // budget 耗尽属合法结果，不算测试框架失败
            console.log(`\n[E2E] 任务因 budget 耗尽或不可恢复错误而失败（不强制断言 completed）`)
            // 但至少应该尝试过至少一轮执行
            expect(runs.length).toBeGreaterThan(0)
          }
        },
      }) } finally {
        // 清理：取消正在运行的任务（终止 executor session + 清理 worktree）
        if (taskID) {
          await OrchestratorService.cancelTask(taskID).catch((err) => {
            console.log(`[E2E] cancelTask 失败（可能已完成）: ${err}`)
          })
          console.log("[E2E] 任务已取消/清理")
        }
        // 停止 SlackGateway（断开 Socket Mode 连接）
        await gateway?.stop().catch(() => {})
        console.log("[E2E] SlackGateway 已停止")
      }
    },
    { timeout: TIMEOUT_MS },
  )
})
