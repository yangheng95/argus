/**
 * Full end-to-end test: real Planner LLM → real OpencorvusExecutor → real Checks → real Evaluator LLM.
 *
 * 无任何 mock。全链路：
 *   createTask → plan (real LLM) → execute (real opencorvus session) → verify (bun test) → evaluate (real LLM)
 *   → retry/replan (small budget) → assert final state
 *
 * 任务: 实现一个最小可用的 NoteStore 闭环。
 * Slack: 任务状态变更通知到 #argus-opencode 频道（Bus.subscribe + chat.postMessage）。
 *
 * 运行: bun test test/e2e/full-pipeline.test.ts
 */
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "fs/promises"
import path from "path"
import { SlackGateway } from "../../src/channel/slack"
import { ExecutorBootstrap } from "../../src/executor/bootstrap"
import { EngineService } from "@/task-api"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Log } from "../../src/util/log"
import { dashscopeCodingKey, env, loadBenchmarkEnv } from "../../script/benchmark/env"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: true })

await loadBenchmarkEnv(import.meta.dir)

// ---------------------------------------------------------------------------
// 凭证 & 配置（硬编码）
// ---------------------------------------------------------------------------

async function resolveModel() {
  return Instance.provide({
    directory: path.resolve(import.meta.dir, "../.."),
    fn: async () => {
      const providers = await Provider.list()
      const explicit = env("OPENCORVUS_E2E_MODEL")
      if (explicit) {
        if (explicit.includes("/")) return explicit
        const preferred = ["alibaba-cn", "google", "deepseek", "gitlab", "moonshotai-cn", "moonshotai", "huggingface"]
        for (const providerID of preferred) {
          const provider = providers[providerID]
          if (provider?.models[explicit]) return `${providerID}/${explicit}`
        }
        for (const provider of Object.values(providers)) {
          if (provider.models[explicit]) return `${provider.id}/${explicit}`
        }
        throw new Error(`OPENCORVUS_E2E_MODEL not found: ${explicit}`)
      }

      if (dashscopeCodingKey() && providers["alibaba-cn"]?.models["qwen3.5-plus"]) {
        return "alibaba-cn/qwen3.5-plus"
      }
      const preferred = ["alibaba-cn", "google", "deepseek", "gitlab", "moonshotai-cn", "moonshotai", "huggingface"]
      for (const providerID of preferred) {
        const provider = providers[providerID]
        if (!provider) continue
        const [model] = Provider.sort(Object.values(provider.models))
        if (model) return `${providerID}/${model.id}`
      }

      const def = await Provider.defaultModel()
      return `${def.providerID}/${def.modelID}`
    },
  })
}

const MODEL = await resolveModel()
const MODEL_PROVIDER_ID = MODEL.split("/")[0] ?? "openai"
const EXECUTOR = (process.env.OPENCORVUS_E2E_EXECUTOR ?? "opencorvus") as "opencorvus" | "codex" | "claude-code"

async function hasLiveModel(model: string) {
  try {
    await Instance.provide({
      directory: path.resolve(import.meta.dir, "../.."),
      fn: async () => {
        const parsed = Provider.parseModel(model)
        const resolved = await Provider.getModel(parsed.providerID, parsed.modelID)
        await Provider.getLanguage(resolved)
      },
    })
    return true
  } catch (error) {
    console.warn(`[E2E] live model unavailable for ${model}: ${String(error)}`)
    return false
  }
}

const HAS_LIVE_MODEL = await hasLiveModel(MODEL)

const SLACK_BOT_TOKEN = env("OPENCORVUS_E2E_SLACK_BOT_TOKEN", "SLACK_BOT_TOKEN") ?? "test-slack-bot-token"
const SLACK_APP_TOKEN = env("OPENCORVUS_E2E_SLACK_APP_TOKEN", "SLACK_APP_TOKEN") ?? "test-slack-app-token"
const SLACK_CHANNEL_ID = env("OPENCORVUS_E2E_SLACK_CHANNEL_ID", "SLACK_CHANNEL_ID") ?? "test-slack-channel"
const RUN_LIVE_E2E = process.env.OPENCORVUS_RUN_LIVE_E2E === "1" || process.env.OPENCORVUS_RUN_LIVE_E2E === "true"
const HAS_SLACK_CREDS = !!(
  env("OPENCORVUS_E2E_SLACK_BOT_TOKEN", "SLACK_BOT_TOKEN")
  && env("OPENCORVUS_E2E_SLACK_APP_TOKEN", "SLACK_APP_TOKEN")
  && env("OPENCORVUS_E2E_SLACK_CHANNEL_ID", "SLACK_CHANNEL_ID")
)
const liveTest = RUN_LIVE_E2E && HAS_LIVE_MODEL ? test : test.skip

const TIMEOUT_MS = parseInt(process.env.OPENCORVUS_E2E_TIMEOUT_MS ?? "1800000", 10) // 30 分钟
const MODEL_TIMEOUT_MS = parseInt(process.env.OPENCORVUS_E2E_MODEL_TIMEOUT_MS ?? "300000", 10) // 5 minutes
const SPEC_TIMEOUT_MS = parseInt(process.env.OPENCORVUS_E2E_SPEC_TIMEOUT_MS ?? String(MODEL_TIMEOUT_MS), 10)
const PLANNER_TIMEOUT_MS = parseInt(process.env.OPENCORVUS_E2E_PLANNER_TIMEOUT_MS ?? String(MODEL_TIMEOUT_MS), 10)
const EVALUATOR_TIMEOUT_MS = parseInt(process.env.OPENCORVUS_E2E_EVALUATOR_TIMEOUT_MS ?? String(MODEL_TIMEOUT_MS), 10)
const AUTO_REPLY =
  "Complete the task autonomously end-to-end. Choose reasonable defaults consistent with the request, keep scope minimal, continue execution, and do not ask again unless the request is contradictory or unsafe."
const STATUS_LOG_INTERVAL_MS = parseInt(process.env.OPENCORVUS_E2E_STATUS_LOG_INTERVAL_MS ?? "30000", 10)

// ---------------------------------------------------------------------------
// 任务内容（最小可用 NoteStore）
// ---------------------------------------------------------------------------

const TASK_TITLE = "实现 NoteStore 最小闭环"

const TASK_REQUEST = `
# 任务

实现一个最小可用的 NoteStore，并补充测试。

## 1. 创建 src/note-store.ts

- 导出 \`Note\` interface：{ id: string; title: string; done: boolean; created_at: number }
- 导出 \`NoteStore\` class，使用内存 Map
- \`create(title: string)\`：title trim 后不能为空；id 用 crypto.randomUUID()；done=false；created_at=Date.now()
- \`get(id: string)\`：返回 Note 或 undefined
- \`list()\`：返回全部 Note，按 created_at 升序
- \`toggle(id: string)\`：切换 done，返回更新后的 Note 或 undefined
- \`remove(id: string)\`：删除并返回 boolean

## 2. 创建 src/note-store.test.ts

使用 bun:test 覆盖这些用例：

1. create 返回完整 Note
2. 空 title 会抛错
3. list 保持创建顺序
4. toggle 会切换 done
5. remove 删除成功后，get 返回 undefined

## 3. 约束

- 可以自由组织项目并新增必要文件，只要最终交付合理、可运行、易于理解
- 运行 \`bun test src/note-store.test.ts\` 必须通过
`.trim()

// ---------------------------------------------------------------------------
// Slack 辅助（直接 HTTP API，只需 bot token，无需 Socket Mode）
// ---------------------------------------------------------------------------

async function slackPost(text: string, threadTs?: string): Promise<void> {
  if (!HAS_SLACK_CREDS) return
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
    experimental: {
      // Headless runs auto-reject stale questions so the pipeline never parks
      // waiting for a human. Permissions default to allow in PermissionNext.
      auto_question: true,
    },
    provider: {
      [MODEL_PROVIDER_ID]: {
        options: {
          timeout: MODEL_TIMEOUT_MS,
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

async function settle(taskID: string, progress: Awaited<ReturnType<typeof EngineService.getProgress>>) {
  const pending = progress.pendingInteractions.filter((item) => item.status === "pending")
  if (pending.length === 0) return progress
  for (const item of pending) {
    console.log(`[E2E] 自动处理交互: type=${item.type} id=${item.id} title=${item.title ?? "(无标题)"}`)
    if (item.type === "permission") {
      await EngineService.replyInteraction(item.id, {
        reply: "always",
        autoReply: true,
        message: "Live E2E permission accepted",
      })
      continue
    }
    await EngineService.replyInteraction(item.id, {
      autoReply: true,
      answers: answers(item.payload),
      message: AUTO_REPLY,
    })
  }
  return EngineService.getProgress(taskID)
}

async function waitForFinal(taskID: string, maxWaitMs: number) {
  const deadline = Date.now() + maxWaitMs
  let lastStatus = ""
  let lastLogAt = 0
  while (Date.now() < deadline) {
    let progress = await EngineService.getProgress(taskID)
    progress = await settle(taskID, progress)
    if (FINAL.has(progress.task.status)) return progress
    if (lastLogAt === 0 || Date.now() - lastLogAt >= STATUS_LOG_INTERVAL_MS || progress.task.status !== lastStatus) {
      const elapsed = Math.round((Date.now() - (deadline - maxWaitMs)) / 1000)
      const runs = await EngineService.listRuns(taskID).catch(() => [])
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

describe("Full E2E: NoteStore Minimal — real Planner + Executor + Checks + Evaluator", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  liveTest(
    "NoteStore 最小闭环: submit → plan → execute → bun test → evaluate",
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
          Env.set("OPENCORVUS_SPEC_TIMEOUT_MS", String(SPEC_TIMEOUT_MS))
          Env.set("OPENCORVUS_PLANNER_TIMEOUT_MS", String(PLANNER_TIMEOUT_MS))
          Env.set("OPENCORVUS_EVALUATOR_AGENT_TIMEOUT_MS", String(EVALUATOR_TIMEOUT_MS))
          Env.set("OPENCORVUS_INTERACTION_TIMEOUT_MS", String(TIMEOUT_MS))
          Env.set("OPENCORVUS_SPEC_AGENT_MAX_STEPS", "10")
          Env.set("OPENCORVUS_PLANNER_AGENT_MAX_STEPS", "10")
          await ExecutorBootstrap.autoRegister(true)
          // 启动 orchestrator 轮询调度
          EngineService.init()

          if (!HAS_SLACK_CREDS) {
            console.log("[E2E] Slack 未配置，跳过 channel 绑定与网关联动")
            return
          }

          // Slack
          Env.set("SLACK_BOT_TOKEN", SLACK_BOT_TOKEN)
          Env.set("SLACK_APP_TOKEN", SLACK_APP_TOKEN)

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
          if (HAS_SLACK_CREDS) {
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
          }

          // ── 提交任务 ────────────────────────────────────────────────────
          console.log("\n[E2E] ─── 提交任务 ───")
          taskID = await EngineService.createTask({
            executor: EXECUTOR,
            title: TASK_TITLE,
            request: TASK_REQUEST,
            queue: false,
            budget: { maxExecutorGroups: 2 },
            checks: {
              build: false,
              lint: false,
              test: ["bun test src/note-store.test.ts"],
              verify_cmd: ["bun test src/note-store.test.ts"],
            },
            ...(HAS_SLACK_CREDS
              ? {
                  channelBinding: {
                    platform: "slack" as const,
                    channel: SLACK_CHANNEL_ID,
                    thread: slackThreadTs ?? `e2e-note-store-${Date.now()}`,
                  },
                }
              : {}),
          })
          console.log(`[E2E] task_id = ${taskID}`)
          await slackPost(`📌 task_id = \`${taskID}\``, slackThreadTs)

          // ── 轮询终态 ────────────────────────────────────────────────────
          console.log(`[E2E] 等待任务完成（最长 ${Math.round((TIMEOUT_MS - 15_000) / 60000)}m）...`)
          const progress = await waitForFinal(taskID, TIMEOUT_MS - 15_000)

          // ── 结果报告 ────────────────────────────────────────────────────
          console.log(`\n[E2E] ─── 结果报告 ───`)
          console.log(`[E2E] 最终状态: ${progress.task.status}`)
          if (progress.task.error) console.log(`[E2E] 错误信息: ${progress.task.error}`)

          const runs = await EngineService.listRuns(taskID)
          const interactions = await EngineService.listTaskInteractions(taskID)
          console.log(`[E2E] 执行轮次: ${runs.length}`)
          for (const r of runs) {
            console.log(`[E2E]   run=${r.id}  status=${r.status}  retry=${r.retryCount}  executor=${r.executor}`)
            const events = await EngineService.listExecutorEvents(r.id).catch(() => [])
            console.log(`[E2E]     executor_events=${events.length}`)
            for (const event of events.slice(-12)) {
              console.log(`[E2E]       #${event.sequence} ${event.kind}: ${event.summary ?? "(无摘要)"}`)
            }
          }
          console.log(`[E2E] 交互数: ${interactions.length}`)
          for (const item of interactions) {
            console.log(`[E2E]   interaction=${item.id}  type=${item.type}  status=${item.status}  title=${item.title ?? "(无标题)"}`)
          }

          if (progress.acceptance) {
            console.log(`[E2E] 交付摘要: ${progress.acceptance.result?.summary ?? "(无)"}`)
            const files = progress.acceptance.result?.changedFiles ?? []
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
          const files = progress.acceptance?.result?.changedFiles ?? []
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
          expect(progress.task.status, progress.task.error ?? "task should complete").toBe("completed")
          expect(progress.acceptance, "应生成交付物").toBeDefined()
          expect(progress.evaluation?.verdict, "评估应通过").toBe("accepted")

          expect(prdDocs.length, "prds/ 应有至少 1 个文档").toBeGreaterThan(0)
          expect(planDocs.length, "plans/ 应有至少 1 个文档").toBeGreaterThan(0)
          expect(goalDocs.length, "goals/ 应有至少 1 个文档").toBeGreaterThan(0)
          expect(evalDocs.length, "evaluations/ 应有至少 1 个文档").toBeGreaterThan(0)

          for (const content of [
            prdDocs.at(-1)?.content ?? "",
            planDocs.at(-1)?.content ?? "",
            goalDocs.at(-1)?.content ?? "",
            evalDocs.at(-1)?.content ?? "",
          ]) {
            expect(content, "文档应包含 taskID").toContain(taskID)
          }

          const changedFiles = progress.acceptance?.result?.changedFiles ?? []
          expect(changedFiles, "应修改 note-store 源文件").toContain("src/note-store.ts")
          expect(changedFiles, "应修改 note-store 测试文件").toContain("src/note-store.test.ts")

          const noteStorePath = path.join(tmp.path, "src/note-store.ts")
          const noteStoreTestPath = path.join(tmp.path, "src/note-store.test.ts")
          expect(await Bun.file(noteStorePath).exists(), "src/note-store.ts 应存在").toBe(true)
          expect(await Bun.file(noteStoreTestPath).exists(), "src/note-store.test.ts 应存在").toBe(true)

          const noteStore = await Bun.file(noteStorePath).text()
          const noteStoreTest = await Bun.file(noteStoreTestPath).text()
          expect(noteStore, "源文件应定义 NoteStore").toMatch(/NoteStore/)
          expect(noteStore, "源文件应定义 Note interface").toMatch(/interface\s+Note/)
          expect(noteStore, "源文件应包含 create/list/toggle/remove").toMatch(/create|list|toggle|remove/)
          expect(noteStoreTest, "测试文件应覆盖 create").toMatch(/create/)
          expect(noteStoreTest, "测试文件应覆盖 toggle").toMatch(/toggle/)
          expect(noteStoreTest, "测试文件应使用 bun:test").toMatch(/bun:test/)

          console.log("\n[E2E] ✓ NoteStore 最小闭环全链路端到端测试通过！")
        },
      }) } finally {
        // 清理：取消正在运行的任务（终止 executor session + 清理 worktree）
        if (taskID) {
          await Instance.provide({
            directory: tmp.path,
            fn: () => EngineService.cancelTask(taskID!),
          }).catch((err) => {
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
