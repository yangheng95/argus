#!/usr/bin/env bun

// ── Crash Diagnostics ──
// Capture the exact reason and call stack when the process exits unexpectedly.
// Use os.tmpdir() for cross-platform compatibility (avoids /tmp failure on Windows).
const DIAG_LOG = require("node:path").join(require("node:os").tmpdir(), "benchmark-crash-diag.log")
function diagWrite(msg: string) {
  const ts = new Date().toISOString()
  const line = `[${ts}] ${msg}\n`
  try { require("node:fs").appendFileSync(DIAG_LOG, line) } catch {}
  process.stderr.write(line)
}
diagWrite(`benchmark PID=${process.pid} started`)
diagWrite(`diag_log=${DIAG_LOG}`)

// Emergency partial report path — set once reportFile is known, used in exit handler.
// Captures in-flight state when process is killed (OOM, SIGKILL, exit 127, etc.)
// before the normal finally block can run.
let _emergencyReportPath = ""
let _emergencyWritten = false

process.on("exit", (code) => {
  diagWrite(`process.exit event — code=${code}`)
  diagWrite(`stack:\n${new Error("exit-trace").stack}`)
  // Write emergency partial report if the task was running but never completed normally.
  if (_emergencyReportPath && !_emergencyWritten) {
    try {
      require("node:fs").writeFileSync(
        _emergencyReportPath,
        JSON.stringify({
          generated_at: new Date().toISOString(),
          type: "emergency_exit",
          exit_code: code,
          taskID,
          elapsed_ms: Date.now() - marks.startedAt,
          marks,
          last_progress_signature: lastProgressSignature,
          events_captured: events.length,
          last_event_at: lastEventAt,
          last_activity_at: lastActivityLogAt,
        }, null, 2),
      )
    } catch {}
  }
})
// Signal-driven cleanup. Without this, SIGTERM / SIGINT only logged a
// stack trace before bun went through default abrupt-exit handling — the
// main `finally { cleanup ... }` block never ran, so orphan processes
// (puppeteer chrome, claude-code SDK, vite preview, ripgrep) survived
// every interrupted bench. A flag prevents double cleanup when the OS
// signals us during natural shutdown.
let _shuttingDown = false
const shutdown = (signal: string) => {
  if (_shuttingDown) return
  _shuttingDown = true
  diagWrite(`${signal} received PID=${process.pid}`)
  diagWrite(`stack:\n${new Error(signal.toLowerCase() + "-trace").stack}`)
  // Surface as an unhandled rejection so the main try/catch/finally block
  // unwinds through its cleanup() chain. Default Node behavior on SIGTERM
  // is exit-without-finally; we override here. Exit code follows
  // shell convention (130 for SIGINT, 143 for SIGTERM, 129 for SIGHUP).
  const code = signal === "SIGINT" ? 130 : signal === "SIGHUP" ? 129 : 143
  process.exitCode = code
  // Give the running async chain ~3s to settle through finally; if it
  // still hasn't exited (stuck git subprocess, hung LLM stream), force-
  // exit so we don't dangle indefinitely.
  setTimeout(() => process.exit(code), 3_000).unref()
  // Trigger an AbortError up the chain by throwing an unhandled rejection.
  // Many awaited paths catch and absorb; the main try/catch will catch
  // the throw and run finally with cleanup.
  Promise.reject(new Error(`shutdown: ${signal}`))
}
process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGHUP", () => shutdown("SIGHUP"))
process.on("uncaughtException", (err) => {
  diagWrite(`uncaughtException: ${err.message}\n${err.stack}`)
})
process.on("unhandledRejection", (reason) => {
  diagWrite(`unhandledRejection: ${reason instanceof Error ? reason.message + "\n" + reason.stack : String(reason)}`)
})

import { mkdtempSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import puppeteer, { type Page } from "puppeteer-core"
import { parseSSE } from "../../src/util/sse"
import { auditWorkspace, deriveRunMetrics, evaluateQualityGates, moduleBlocksFromRequest } from "./quality-gates"

type OverlayBenchmarkWindow = Window & {
  applyDirectory: (directory: string, options: { save: boolean; temp: boolean; restoreWorkspace: boolean }) => Promise<void> | void
  loadTasks: () => Promise<void> | void
  selectTask: (taskID: string) => Promise<void> | void
  persistOverlaySettings: () => Promise<void> | void
  loadBoard: () => Promise<void> | void
  loadConversation: () => Promise<void> | void
  boardStore: {
    board: any
    tasks: any[]
    pendingTasks: any[]
    selectedTaskID: string
  }
  settingsStore: {
    directory: string
    savedDirectory: string
    workspaceDirectory: string
    workspaceTaskID: string
  }
}

// Accept either `--name=value` or `--name value`. The old version quietly
// returned undefined for the space form, which masked typos and mis-quoted
// paths in benchmark invocations — by the time the task ran with a wrong
// default you had no idea a flag was dropped. Any unrecognised top-level
// --flag is surfaced as a hard error at startup (see validateFlags below).
function flag(name: string) {
  const eq = process.argv.find((item) => item.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const idx = process.argv.indexOf(name)
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1]
  return undefined
}

function stripWrappingQuotes(value: string | undefined): string | undefined {
  if (!value) return value
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return value
}

// Authoritative list of every CLI flag the benchmark recognises. Anything
// else on the command line is a typo or a dropped/quoted value (e.g.
// `--reference-images "C:/path with space.png"` getting split). We refuse
// to start in that case rather than silently using defaults.
const KNOWN_FLAGS = new Set<string>([
  "--delivery-verify-cmd",
  "--executor",
  "--idle-timeout-ms",
  "--max-executor-groups",
  "--max-fix-runs",
  "--max-runs",
  "--project-dir",
  "--reference-images",
  "--report",
  "--request-attachment",
  "--request-file",
  "--resume-home-dir",
  "--resume-message",
  "--resume-task-id",
  "--title",
  "--figma-url",
  // boolean (no value) switches
  "--no-keep",
  "--skip-local-verify",
  "--no-browser",
  "--stop-after-architect",
])

function validateFlags(): void {
  // process.argv layout: [bun, scriptPath, ...userArgs]
  const userArgs = process.argv.slice(2)
  const unknown: string[] = []
  for (let i = 0; i < userArgs.length; i++) {
    const arg = userArgs[i]
    if (!arg.startsWith("--")) continue
    const key = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg
    if (KNOWN_FLAGS.has(key)) {
      // Skip the value slot for `--name value` form so we don't mistake the
      // value for an unknown flag if it happens to start with "--".
      if (!arg.includes("=") && i + 1 < userArgs.length && !userArgs[i + 1].startsWith("--")) {
        i += 1
      }
      continue
    }
    unknown.push(arg)
  }
  if (unknown.length > 0) {
    const known = [...KNOWN_FLAGS].sort().join("\n  ")
    process.stderr.write(
      `[overlay-benchmark] unknown flag(s): ${unknown.join(" ")}\n` +
      `Known flags:\n  ${known}\n` +
      `Hint: use either --name=value or --name value; quote paths that contain spaces.\n`,
    )
    process.exit(2)
  }
}
validateFlags()

const maxRuns = Number(flag("--max-runs")) || 20
const maxFixRuns = Number(flag("--max-fix-runs")) || 8
const report = stripWrappingQuotes(flag("--report"))
const keep = !process.argv.includes("--no-keep")
// Resume mode: re-attach to an existing task rather than creating a new one.
// --resume-task-id  : ID of the task to resume (e.g. tsk_xxx)
// --resume-home-dir : opencorvus home directory from the original run (contains the database)
// --resume-message  : user message injected to wake up the failed task
const resumeTaskID = flag("--resume-task-id")
const resumeHomeDir = flag("--resume-home-dir")
const resumeMessage = flag("--resume-message")
if (resumeMessage !== undefined && resumeMessage.trim().length === 0) {
  process.stderr.write("[overlay-benchmark] --resume-message must not be empty when provided\n")
  process.exit(2)
}
const executor = (flag("--executor") || "opencorvus") as
  | "opencorvus"
  | "codex"
  | "claude-code"
const requestFile = flag("--request-file")
const requestAttachment = flag("--request-attachment")
const rawReferenceImages = flag("--reference-images")?.split(",").map(s => s.trim()).filter(Boolean) ?? []
if (requestFile && requestAttachment) {
  process.stderr.write("[overlay-benchmark] cannot pass both --request-file and --request-attachment\n")
  process.exit(2)
}
const figmaUrl = flag("--figma-url")?.trim() || undefined
const deliveryVerifyCmd = flag("--delivery-verify-cmd")
const skipLocalVerify = process.argv.includes("--skip-local-verify")
// `--no-browser` bypasses the puppeteer-driven overlay UI and drives the
// benchmark entirely through HTTP API polling. The downstream code already
// guards every puppeteer call with `if (page)` — this flag activates those
// branches. Useful when the overlay UI is under refactor (07-panel-reactivity.md)
// and we only want to exercise the opencorvus server pipeline end-to-end.
const noBrowser = process.argv.includes("--no-browser")
const stopAfterArchitect = process.argv.includes("--stop-after-architect")
// Only set task-level budget when explicitly provided via CLI flag.
// Otherwise leave undefined so the task inherits the config-level default (opencorvus.jsonc).
const maxExecutorGroups = flag("--max-executor-groups") ? Number(flag("--max-executor-groups")) : undefined
const WEB_CLONE_VISUAL_THRESHOLD = process.env.OPENCORVUS_WEB_CLONE_BENCHMARK_THRESHOLD?.trim() || "0.96"
const WEB_CLONE_VISUAL_WORST_THRESHOLD = process.env.OPENCORVUS_WEB_CLONE_BENCHMARK_WORST_THRESHOLD?.trim() || "0.75"

const DEFAULT_TASK_TITLE = "Overlay Web Benchmark"
// The default brief is a text-only chat-app spec — there is no canonical
// visual reference for it. Visual-diff gating only activates when the caller
// passes `--reference-images <path>`; otherwise the run completes without an
// SSIM gate.
const referenceImages = rawReferenceImages
const DEFAULT_TASK_REQUEST = `帮我做一个生产级的多模型 AI Chat Web 应用（Vite + React + TypeScript），整体定位对标 ChatGPT / Claude.ai / Poe，UI/UX 现代专业，深色/浅色主题切换，可在 Chrome 桌面端正常运行，本地启动后即可进入。

【账户与权限】
1. 启动页支持 "Google 一键登录"（mock 异步延迟 800-1200ms 后登录成功）和 "邮箱+密码" 登录两种入口，登录态持久化到 localStorage，刷新后自动恢复。
2. 顶部右上角头像菜单包含：账户设置、API Keys、订阅信息（mock 显示"免费版 / 已用 X / Y 次"）、深浅色主题、语言（中/英）、退出登录。
3. API Keys 页面分别支持 Deepseek、OpenAI、Anthropic 三家 Key 的填写、保存（加密存储到 IndexedDB）、连通性测试按钮（实际打 /v1/models 或同等端点验证可用性）。

【模型与对话】
4. 顶部模型选择器是分组下拉，按 provider 分组展示：Deepseek（deepseek-chat / deepseek-reasoner）、OpenAI（gpt-4o-mini mock 占位）、Anthropic（claude-3-5-sonnet mock 占位）。仅 Deepseek 走真实 SSE，其他在未配置 Key 时按 mock 流返回。
5. 流式对话使用 SSE，必须支持：发送中可中断（停止生成）、生成失败可一键 Retry、对任意助手消息可 "Regenerate"、对任意用户消息可 Edit 后从该点重新分支（保留旧分支可切换）。
6. 会话级断点续传：用户在生成中刷新页面，重新打开后能从最后一条增量继续渲染，不丢字（通过保存增量到 IndexedDB + 重连同一 SSE 通道实现）。
7. 推理类模型（如 deepseek-reasoner）需在助手气泡内显示可折叠的"思考过程"块，与最终回答分离。

【输入与多模态】
8. 输入框支持：粘贴/拖拽上传图片、PDF、txt、md、代码文件，附件展示为缩略卡片可删除；图片附件随消息发送，PDF/文本类附件提取纯文本拼接到 prompt 末尾。
9. 输入框支持斜杠命令：/clear 清空当前会话，/system 编辑系统提示词，/temp 调整 temperature，/model 快速切换模型，输入即弹出补全列表。
10. 支持 @ 引用历史消息：在输入框内 @ 可弹出当前会话消息列表，选中后将该消息作为上下文片段附加。

【消息渲染】
11. 助手消息渲染需支持：GitHub Flavored Markdown、代码块语法高亮（多语言）、行内 / 块级数学公式（KaTeX）、Mermaid 图表、表格、任务列表、链接预览。
12. 代码块右上角提供 复制 / 下载 / "Run in Sandbox"（mock 弹窗显示 stdout）按钮。
13. 每条消息底部展示 token 用量、生成耗时、模型标签；可复制全文、点赞/点踩反馈、分享单条（生成只读分享链接，路由 /s/:id）。

【会话管理】
14. 左侧会话列表分组：Pinned / Today / Yesterday / Last 7 days / Older，支持新建文件夹、拖拽分组、重命名、删除（带确认）、置顶、搜索（标题+内容全文）、导出（Markdown / JSON）。
15. 支持会话标签（多色），列表可按标签过滤；空状态有插图与 New chat 引导。
16. 全局搜索（Cmd/Ctrl+K）：跨会话搜索消息，结果可点击跳转并高亮匹配。

【New Chat 起始页】
17. 未发起对话时展示 "示例 Prompt 卡片网格"（写作 / 代码 / 数学 / 角色扮演 / 数据分析 5 类，每类 2-3 张卡），点击直接预填到输入框。
18. 起始页底部展示当日 Tips 与最近 3 条会话快捷入口。

【设置与高级】
19. 设置面板支持：默认模型 / temperature / max_tokens / top_p / 系统提示词模板（支持多套切换）、自定义快捷键、上下文窗口截断策略。
20. 提供 keyboard shortcut 浮层（按 ?）说明所有快捷键。

【数据与存储】
21. 所有会话与设置以 IndexedDB 持久化（schema 含 conversations / messages / settings / api_keys 四个 store），刷新无损；提供"清空所有数据"按钮（带二次确认）。

【非功能要求】
22. 整体响应：移动端宽度 360px 以上可用，桌面端居中最大宽度 1280px。
23. 真实可跑：使用真实 Deepseek API 完成至少一次端到端 streaming 对话；UI 完成度对标 chatgpt.com/claude.ai 视觉水平（无占位文字、无 lorem ipsum）。
24. 代码质量：TypeScript strict、组件分层清晰（features / components / hooks / lib / store）、无 console.error 红字、初次加载 < 5s。`
let TASK_REQUEST = requestFile ? (await Bun.file(path.resolve(requestFile)).text()).trim() : DEFAULT_TASK_REQUEST
// Build base64 attachments from reference images (sent as multimodal vision content)
const TASK_ATTACHMENTS: Array<{ mime: string; data: string; filename: string }> = []

// --request-attachment: upload the file as a real task attachment instead of
// inlining its text into request. Exercises the read-tool attachment-URL path
// so sub-agents (planner, architect, executor) can re-read the source via
// AttachmentStore. The request itself just points the agent at the attachment.
if (requestAttachment) {
  const src = path.resolve(requestAttachment)
  const bytes = await Bun.file(src).arrayBuffer()
  const ext = path.extname(src).toLowerCase().replace(".", "") || "txt"
  const filename = path.basename(src)
  const mime =
    ext === "txt" || ext === "md" || ext === "log" ? "text/plain" :
    ext === "json" ? "application/json" :
    ext === "pdf"  ? "application/pdf"  :
    ext === "html" || ext === "htm" ? "text/html" :
    ext === "csv" ? "text/csv" :
    "application/octet-stream"
  TASK_ATTACHMENTS.push({
    mime,
    data: Buffer.from(bytes).toString("base64"),
    filename,
  })
  console.log(`[overlay-benchmark] request-attachment ${filename} ${mime} ${Math.round(bytes.byteLength / 1024)}KB`)
  TASK_REQUEST =
    `The full task brief is attached as the file "${filename}" (${mime}, ${Math.round(bytes.byteLength / 1024)} KB). ` +
    `It contains the complete requirements, scope, and acceptance criteria — treat it as the authoritative source of truth. ` +
    `Run the standard pipeline (requirements → architect → planner → executor → delivery); the attachment is ` +
    `forwarded automatically to each sub-agent and they will read it via their \`read\` tool when needed.`
}
// Reference images are NOT injected as task attachments — the agent owns its
// visual capture path (e.g. url_screenshot tool against the URL in the
// request). When `--reference-images` is supplied, each file is copied into
// the worktree's references/ dir and feeds the visual-diff gate below.
const TASK_TITLE = flag("--title")?.trim()
  || (requestFile ? path.parse(requestFile).name : undefined)
  || (requestAttachment ? path.parse(requestAttachment).name : undefined)
  || DEFAULT_TASK_TITLE
// DELIVERY_VERIFY_CMD is assigned after temp.dir is initialized (see below).
// Auto-registration rules when no explicit --delivery-verify-cmd is supplied:
//   1. --reference-images provided → visual-diff SSIM gate against that file
//   2. no reference images (default chat-app brief, or external --request-file) → no auto-verify
// Web-clone SSIM thresholds are explicit. The visual-diff CLI defaults are
// looser generic smoke-test values and are not acceptable for replica scoring.
let DELIVERY_VERIFY_CMD = ""

const AUTO_REPLY =
  "Complete the task autonomously end-to-end. Choose reasonable defaults consistent with the request, keep scope minimal, continue execution, and do not ask again unless the request is contradictory or unsafe."

const FINAL = new Set(["completed", "failed", "cancelled"])
const STREAM_PLACEHOLDERS = new Set(["", "...", "â€¦â€¦", "æ€è€ƒä¸­", "Thinking"])
const DIAG_TYPES = new Set([
  "orchestrator.agent.updated",
  "orchestrator.run.created",
  "orchestrator.run.updated",
  "orchestrator.task.created",
  "orchestrator.task.updated",
  "orchestrator.interaction.requested",
  "orchestrator.interaction.resolved",
  // Executor events flow through Message — tool calls and text arrive
  // as message.part.updated instead of run.progress/run.output.
  "orchestrator.message.part.updated",
  "orchestrator.message.updated",
  // Per-goal heartbeat from event bridge (bypasses Session→Bus→Bridge chain)
  "orchestrator.goal.progress",
  "orchestrator.goal.passed",
  "orchestrator.goal.failed",
  // Task Agent tool invocations in the new agent-driven architecture
  "orchestrator.goal.created",
  "orchestrator.goal.updated",
  // Integrity reviewer lifecycle + verdict. `chunk` is throttled reasoning-delta
  // forwarded by the LLM stream; `completed` carries the structured per-dimension
  // verdict that buildBenchmarkReport's `integrity` section renders.
  "orchestrator.integrity.review.started",
  "orchestrator.integrity.review.progress",
  "orchestrator.integrity.review.chunk",
  "orchestrator.integrity.review.completed",
  // Session lifecycle (single source). Replaces the per-phase *.completed
  // events the benchmark used to track for stage-terminal heartbeat — the
  // formatEventLine handler above filters streaming/idle and surfaces only
  // terminal + retry transitions in the digest.
  "orchestrator.session.status",
  "orchestrator.delivery.ready",
  "orchestrator.evaluation.completed",
])
const projectDir = flag("--project-dir")
const temp = {
  dir: "",
  home: "",
  config: "",
}

temp.home = resumeHomeDir
  ? path.resolve(resumeHomeDir)
  : await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-overlay-benchmark-home-"))
if (resumeTaskID && !projectDir) throw new Error("--resume-task-id requires --project-dir")
temp.dir = projectDir ? path.resolve(projectDir) : await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-overlay-benchmark-project-"))
temp.config = path.join(temp.home, "config-override")
process.env.OPENCORVUS_HOME = temp.home
// Copy request file into the project directory so the Task Agent can reference it
if (requestFile) {
  const dest = path.join(temp.dir, path.basename(requestFile))
  await fs.copyFile(path.resolve(requestFile), dest).catch(() => undefined)
}
// Copy reference images into the project directory under references/
if (referenceImages.length > 0) {
  const refDir = path.join(temp.dir, "references")
  await fs.mkdir(refDir, { recursive: true })
  for (const img of referenceImages) {
    const src = path.resolve(img)
    const dest = path.join(refDir, path.basename(src))
    await fs.copyFile(src, dest).catch((e) => console.warn(`[overlay-benchmark] failed to copy reference image ${src}: ${e}`))
  }
}
// Copy real auth.json into temp home so OAuth providers (e.g. github-copilot) work in isolated home
{
  const appData = process.env.APPDATA || process.env.LOCALAPPDATA
  const realDataDir = process.platform === "win32" && appData
    ? path.join(appData, "opencorvus")
    : path.join(os.homedir(), ".local", "share", "opencorvus")
  const realAuth = path.join(realDataDir, "auth.json")
  const tempDataDir = path.join(temp.home, "data")
  await fs.mkdir(tempDataDir, { recursive: true })
  await fs.copyFile(realAuth, path.join(tempDataDir, "auth.json")).catch(() => undefined)
}
const { ensureBenchmarkModel, loadBenchmarkEnv, prepareLocalProviders, resolveBenchmarkModel } = await import("./env")
const { Log } = await import("../../src/util/log")
Log.init({ print: true })
const { ExecutorBootstrap } = await import("../../src/executor/bootstrap")
const { Instance } = await import("../../src/project/instance")
const { InstanceBootstrap } = await import("../../src/project/bootstrap")
const { Server } = await import("../../src/server/server")
const { resetDatabase } = await import("../../test/fixture/db")

// Start the HTTP server before anything calls Instance.provide.
// resolveBenchmarkModel / ensureBenchmarkModel / InstanceBootstrap all go
// through Plugin.state, whose initializer reads Server.url(). If the server
// hasn't called listen() yet, Server.url() throws and the provider init
// silently half-completes (missing plugin hooks).
const server = Server.listen({ port: 0, hostname: "127.0.0.1" })

await loadBenchmarkEnv(import.meta.dir)
process.env.OPENCORVUS_CONFIG_DIR = temp.config
await prepareLocalProviders()
const model = await resolveBenchmarkModel(import.meta.dir, {
  allowOpenAICodex: executor === "codex",
})
process.env.OPENCORVUS_BENCHMARK_MODEL = model
await ensureBenchmarkModel(import.meta.dir, model)

process.env.OPENCORVUS_AUTO_DISCOVER_EXECUTORS = "1"
process.env.OPENCORVUS_EXECUTOR_CLAUDE_PERMISSION_MODE = "bypassPermissions"
// Complex replication tasks legitimately need >3 delivery iterations to converge.
// Schema allows up to 10. 6 balances convergence room against total wall time.
process.env.OPENCORVUS_MAX_DELIVERY_ITERATIONS = "6"

console.log(
  `[overlay-benchmark] config model=${model} executor=${executor} groups=${maxExecutorGroups ?? "config-default"} idle_timeout_ms=disabled`,
)

// Force-remove SQLite WAL/SHM before reset — prevents previous benchmark's
// uncommitted data from being recovered into the fresh database.
const dbPath = path.join(os.homedir(), ".local", "share", "opencorvus", "opencorvus.db")
await fs.rm(`${dbPath}-wal`, { force: true }).catch(() => {})
await fs.rm(`${dbPath}-shm`, { force: true }).catch(() => {})

if (resumeTaskID) {
  // Resume mode: keep existing database and project state intact.
  // Only ensure the config-override directory exists (server bootstrap needs it).
  await fs.mkdir(temp.config, { recursive: true })
} else {
  await resetDatabase()
  if (!projectDir) {
    await scaffoldProject(temp.dir, model)
  } else {
    // Strip project-level opencorvus state to prevent old task IDs from bleeding into new runs
    await fs.rm(path.join(temp.dir, "opencorvus.json"), { force: true })
    await fs.rm(path.join(temp.dir, ".opencorvus"), { recursive: true, force: true })
    await fs.mkdir(temp.config, { recursive: true })
    await fs.mkdir(path.join(temp.dir, ".opencorvus"), { recursive: true })
    // Re-register the benchmark model. scaffoldProject does this for fresh
    // projects; here we just write the model config (no scaffolding) so the
    // existing source tree is preserved and the orchestrator boots with an
    // LLM available — without this it crashes with MissingModelConfigError.
    await writeBenchmarkModelConfig(temp.dir, model)
  }
}
// Re-inject local provider configs after scaffoldProject (which overwrites config-override)
await prepareLocalProviders()

// AgentTrace dir: keep traces under the current runtime root. The old
// `<project>/.opencorvus/trace` path is a legacy runtime location that
// Instance rejects before bootstrap, so benchmark-owned trace capture must
// live inside `.opencorvus/runtime`.
if (!process.env.OPENCORVUS_AGENT_TRACE_DIR) {
  process.env.OPENCORVUS_AGENT_TRACE_DIR = path.join(temp.dir, ".opencorvus", "runtime", "trace")
}
await fs.mkdir(process.env.OPENCORVUS_AGENT_TRACE_DIR, { recursive: true }).catch(() => undefined)
process.stderr.write(`[trace] OPENCORVUS_AGENT_TRACE_DIR=${process.env.OPENCORVUS_AGENT_TRACE_DIR}\n`)

await Instance.provide({
  directory: temp.dir,
  init: InstanceBootstrap,
  fn: async () => {
    await ExecutorBootstrap.autoRegister(true)
  },
})
const browser = noBrowser ? null : await launchBrowser()
let page = browser ? await browser.newPage() : null
if (page) await page.setViewport({ width: 1600, height: 1200 })
// Forward overlay browser console + pageerror events to benchmark stdout.
// Without this the overlay's own `console.error(...)` (including the
// `[sse] dispatch error for event X` introduced to surface tree-writer
// throws that were previously silently swallowed) is invisible to the
// benchmark driver, making UI-side regressions appear as generic overlay
// rendering failures.
if (page) {
  page.on("console", (msg) => {
    const type = msg.type()
    // Only forward warning+ to avoid log noise from info/debug.
    if (type === "log" || type === "info" || type === "debug") return
    process.stderr.write(`[overlay-console:${type}] ${msg.text()}\n`)
  })
  page.on("pageerror", (err) => {
    process.stderr.write(`[overlay-pageerror] ${err.message}\n${err.stack ?? ""}\n`)
  })
}

const marks = {
  startedAt: Date.now(),
  onlineAt: 0,
  submittedAt: 0,
  planningAt: 0,
  streamingAt: 0,
  createdAt: 0,
  selectedAt: 0,
  boardAt: 0,
  resumedAt: 0,
  completedAt: 0,
}
let taskID = ""
const defaultReportDir = path.resolve(import.meta.dir, "../../../..", ".scratch", "benchmark-runs")
const reportFile = report ? path.resolve(report) : path.join(defaultReportDir, `overlay-web-benchmark-report-${Date.now()}.json`)
await fs.mkdir(path.dirname(reportFile), { recursive: true })

// Now that temp.dir and reportFile are known, resolve DELIVERY_VERIFY_CMD.
{
  const visualDiffScript = path.join(import.meta.dir, "visual-diff.ts")
  // The verify command is executed through `cmd /c <string>` on Windows or
  // `bash -lc <string>` on POSIX (see runLocalVerify). On Windows, cmd.exe
  // round-trips paths wrapped in `"…"` correctly — including paths with
  // spaces and non-ASCII characters (CJK, accented chars) — because Node /
  // bun spawn passes the argv as wide-string via CreateProcessW. The ONLY
  // thing cmd /c cannot escape inside the outer quoted string is a literal
  // `"` character in the path itself, which is essentially never present in
  // real filesystem paths. On POSIX, single-quoting with the standard
  // `'\''` escape handles every printable char.
  const SHELL_SAFE = /^[A-Za-z0-9_.:/\\-]+$/
  const safe = (s: string): string => {
    if (SHELL_SAFE.test(s)) return s
    if (process.platform === "win32") {
      if (s.includes('"')) {
        throw new Error(
          `[overlay-benchmark] cannot embed path containing literal '"' in cmd /c command line: ${s}\n` +
            `Rename the file to remove the embedded double-quote character.`,
        )
      }
      return `"${s}"`
    }
    return `'${s.replace(/'/g, "'\\''")}'`
  }
  const buildVisualDiffCmd = (refs: readonly string[]) => {
    const baseOut = path.join(path.dirname(reportFile), path.basename(reportFile, ".json") + ".visual-diff-out")
    return refs.map((ref, index) => {
      const visualOut = refs.length === 1 ? baseOut : path.join(baseOut, `reference-${index + 1}`)
      return [
        `bun run ${safe(visualDiffScript)}`,
        `--rendered-dir=${safe(temp.dir)}`,
        `--reference=${safe(path.resolve(ref))}`,
        `--out=${safe(visualOut)}`,
        `--threshold=${WEB_CLONE_VISUAL_THRESHOLD}`,
        `--worst-threshold=${WEB_CLONE_VISUAL_WORST_THRESHOLD}`,
      ].join(" ")
    }).join(" && ")
  }
  DELIVERY_VERIFY_CMD = skipLocalVerify
    ? ""
    : (deliveryVerifyCmd?.trim()
      || (referenceImages.length > 0 ? buildVisualDiffCmd(referenceImages) : ""))
  if (DELIVERY_VERIFY_CMD) {
    console.log(`[overlay-benchmark] delivery_verify_cmd=${DELIVERY_VERIFY_CMD}`)
  }
}
_emergencyReportPath = reportFile.endsWith(".json")
  ? reportFile.slice(0, -".json".length) + ".emergency.json"
  : `${reportFile}.emergency.json`
const eventFile = reportFile.endsWith(".json")
  ? reportFile.slice(0, -".json".length) + ".events.json"
  : `${reportFile}.events.json`
const eventLogFile = reportFile.endsWith(".json")
  ? reportFile.slice(0, -".json".length) + ".events.ndjson"
  : `${reportFile}.events.ndjson`
const events: Array<Record<string, unknown>> = []
const reportApiErrors: string[] = []
let flushed = Promise.resolve()
let lastEventAt = Date.now()
let lastProgressSignature = ""
let lastLogAt = Date.now()
let lastActivityLogAt = Date.now()
let lastHeartbeatAt = 0
let lastActivityLine = ""
// Terminal signal — resolved by onEvent when orchestrator.task.updated carries
// a FINAL status (completed/failed/cancelled). waitForFinal races its poll sleep
// against this promise so the loop exits immediately on terminal SSE.
let terminalSignalResolver: (() => void) | null = null
let terminalReached = false
let planning: any = null
let streaming: any = null
let board: any = null
let progress: any = null
let finalBoard: any = null
let transcript: any = null
let timeline: any = null
let runs: any = null
// Latest IntegrityReviewCompleted payload (full properties retained — the events
// array stores only flattened fixed fields). buildBenchmarkReport reads this for
// the `integrity` section. Each completed emission overwrites; benchmark records
// the final verdict the orchestrator settled on, not interim ones.
let latestIntegrity: Record<string, unknown> | null = null
let integrityAttemptCount = 0
let lastIntegrityProgressLogAt = 0

function logLine(value: string) {
  lastLogAt = Date.now()
  console.log(value)
}

function activityLine(value: string) {
  lastActivityLogAt = Date.now()
  lastLogAt = lastActivityLogAt
  console.log(value)
}

function errorLine(value: string) {
  lastLogAt = Date.now()
  console.error(value)
}

function formatEventLine(
  entry: {
    type: string
    kind: string
    stage: string
    status: string
    progressType: string
    summary: string
    text: string
    toolName: string
    goalRunID: string
  },
  props: Record<string, unknown> = {},
) {
  // message.part.updated / message.updated fire on every token chunk during
  // streaming — printing each one floods stdout and obscures real milestones.
  // Drop them entirely; the SSE counters + per-stage logs already capture
  // progress at a higher signal level. A tool call kicking off shows up via
  // the dedicated "tool=" path below.
  if (entry.type === "orchestrator.message.part.updated" || entry.type === "orchestrator.message.updated") {
    return ""
  }
  // Architect contracts: show category + spec excerpt for tool_result
  if (entry.stage === "architect" && entry.kind === "tool_result" && entry.toolName === "register_contract") {
    const content = entry.text || entry.summary
    return `[overlay-benchmark] architect contract registered: ${clipText(content, 300)}`
  }
  if (entry.stage === "architect" && entry.kind === "status") {
    return `[overlay-benchmark] architect ${clipText(entry.summary || entry.status, 120)}`
  }
  // Integrity reviewer events. `chunk` is reasoning-delta — too noisy to print
  // line-per-event; the alive-stall timer is what we care about. `progress` is
  // throttled to ~once per 20s by the reviewer but still gets gated here to one
  // log line per 10s to keep stdout readable. `started` and `completed` always
  // print — they're the lifecycle bookends a human reading the log needs.
  if (entry.type === "orchestrator.integrity.review.chunk") return ""
  if (entry.type === "orchestrator.integrity.review.progress") {
    const now = Date.now()
    if (now - lastIntegrityProgressLogAt < 10_000) return ""
    lastIntegrityProgressLogAt = now
    return `[overlay-benchmark] integrity.review.progress (still working)`
  }
  if (entry.type === "orchestrator.integrity.review.started") {
    return `[overlay-benchmark] integrity.review.started`
  }
  if (entry.type === "orchestrator.integrity.review.completed") {
    const data = latestIntegrity ?? {}
    const verdict = String((data as any).verdict ?? "")
    const summary = clipText(String((data as any).summary ?? ""), 200)
    const dims = Array.isArray((data as any).dimensions) ? (data as any).dimensions : []
    const dimText = dims
      .map((d: any) => `${String(d.id ?? "")}=${String(d.verdict ?? "")}(i${d.issueCount ?? 0}/c${d.correctionCount ?? 0}/m${d.missingGoalCount ?? 0})`)
      .join(" ")
    const issueCount = Array.isArray((data as any).issues) ? (data as any).issues.length : 0
    const correctionCount = Array.isArray((data as any).corrections) ? (data as any).corrections.length : 0
    const missingCount = Array.isArray((data as any).missingGoals) ? (data as any).missingGoals.length : 0
    return `[overlay-benchmark] integrity.review.completed verdict=${verdict || "?"} ` +
      `dims=[${dimText}] totals=i${issueCount}/c${correctionCount}/m${missingCount} ` +
      `summary="${summary}"`
  }
  // Session lifecycle milestones (single source — see
  // packages/opencorvus/src/session/status.ts). Replaces the per-phase
  // *.completed events the benchmark used to enumerate; counts that used
  // to surface here are derived from boardStore in the live overlay.
  if (entry.type === "orchestrator.session.status") {
    const status = props.status as { type?: string; reason?: string; error?: string; attempt?: number } | undefined
    if (!status) return ""
    const sessionID = String(props.sessionID ?? "")
    const t = String(status.type ?? "")
    if (t === "terminal") {
      const reason = String(status.reason ?? "")
      const errPart = status.error ? ` error="${clipText(String(status.error), 200)}"` : ""
      return `[overlay-benchmark] session.terminal session=${sessionID} reason=${reason}${errPart}`
    }
    if (t === "retry") {
      return `[overlay-benchmark] session.retry session=${sessionID} attempt=${status.attempt ?? "?"}`
    }
    // streaming / idle: too noisy to surface line-by-line in the log digest.
    return ""
  }
  if (entry.type === "orchestrator.delivery.ready") {
    const summary = clipText(String(props.summary ?? entry.summary ?? ""), 240)
    return `[overlay-benchmark] delivery.ready summary="${summary}"`
  }
  if (entry.type === "orchestrator.evaluation.completed") {
    const status = String(props.status ?? entry.status ?? "")
    const verdict = String(props.verdict ?? "")
    const summary = clipText(String(props.summary ?? entry.summary ?? ""), 240)
    return `[overlay-benchmark] evaluation.completed status=${status} verdict=${verdict} summary="${summary}"`
  }
  const summary = entry.summary || entry.text
  const parts = [
    `[overlay-benchmark] event=${entry.type.replace("orchestrator.", "")}`,
    entry.stage ? `stage=${entry.stage}` : "",
    entry.status ? `status=${entry.status}` : "",
    entry.toolName ? `tool=${entry.toolName}` : "",
    entry.goalRunID ? `goalRun=${entry.goalRunID}` : "",
    summary ? `detail=${clipText(summary, 180)}` : "",
  ].filter(Boolean)
  return parts.join(" ")
}

function eventValue(payload: Record<string, unknown>, props: Record<string, unknown>, key: string) {
  const value = payload[key]
  if (typeof value === "string") return value
  const next = props[key]
  return typeof next === "string" ? next : ""
}

function normalizeEvent(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("type" in payload)) return
  const item = payload as Record<string, unknown>
  const rawType = String(item.type || "")
  if (!rawType) return
  const type = rawType.startsWith("orchestrator.") ? rawType : `orchestrator.${rawType}`
  if (!DIAG_TYPES.has(type)) return
  const props =
    item.properties && typeof item.properties === "object"
      ? item.properties as Record<string, unknown>
      : item.payload && typeof item.payload === "object"
        ? item.payload as Record<string, unknown>
        : {}
  return {
    type,
    payload: item,
    props,
  }
}

function topLevelText(item: Record<string, unknown>, key: string) {
  const value = item[key]
  return typeof value === "string" ? value : ""
}

const onEvent = ({ payload }: { payload: unknown }) => {
  // Any parsed SSE frame advances the alive-stall timer. "Alive" means bytes
  // are flowing from the server; whether we log/diagnose the event is a
  // separate concern handled below via DIAG_TYPES. Without this
  // unconditional reset, long-running backend steps that emit only
  // non-diag events (e.g. fidelity.review.started / .progress) would trip
  // the 120s alive cap even while the server is actively working and
  // streaming them over the wire.
  if (payload && typeof payload === "object") {
    lastEventAt = Date.now()
  }
  // LLM delta events (message.part.delta) are ephemeral and high-frequency.
  // They don't produce a log line, but they DO count as progress activity —
  if (payload && typeof payload === "object" && "type" in payload) {
    const rawType = String((payload as any).type ?? "")
    if (rawType === "message.part.delta" || rawType.endsWith(".part.delta") ||
        rawType === "message.part.updated" || rawType.endsWith(".part.updated")) {
      lastActivityLogAt = Date.now()
      lastLogAt = Date.now()
      // message.part.updated carries tool calls — let it through to normalizeEvent
      // for logging, but message.part.delta is too high-frequency to log.
      if (rawType === "message.part.delta" || rawType.endsWith(".part.delta")) return
    }
  }
  const normalized = normalizeEvent(payload)
  if (!normalized) return
  lastEventAt = Date.now()
  const entry = {
    at: new Date().toISOString(),
    elapsed_ms: Date.now() - marks.startedAt,
    type: normalized.type,
    taskID: eventValue(normalized.payload, normalized.props, "taskID"),
    runID: eventValue(normalized.payload, normalized.props, "runID"),
    stage: eventValue(normalized.props, normalized.payload, "stage"),
    kind: eventValue(normalized.props, normalized.payload, "kind") || topLevelText(normalized.payload, "kind"),
    status: eventValue(normalized.props, normalized.payload, "status"),
    toolName: eventValue(normalized.props, normalized.payload, "toolName"),
    summary: clipText(eventValue(normalized.props, normalized.payload, "summary") || topLevelText(normalized.payload, "summary"), 600),
    text: clipText(eventValue(normalized.props, normalized.payload, "text"), 2000),
    progressType: eventValue(normalized.props, normalized.props, "type"),
    goalRunID: eventValue(normalized.payload, normalized.props, "goalRunID"),
  }
  events.push(entry)
  // Retain the full IntegrityReviewCompleted payload — the flattened entry
  // above keeps only fixed text fields, but the verdict / per-dimension
  // breakdown / issues / corrections / missingGoals live in `props`. The
  // benchmark report's `integrity` section reads from latestIntegrity; each
  // emission overwrites so the final state is whatever the orchestrator
  // settled on.
  if (entry.type === "orchestrator.integrity.review.completed") {
    integrityAttemptCount += 1
    latestIntegrity = { ...normalized.props, sessionID: eventValue(normalized.payload, normalized.props, "sessionID") }
  }
  if (entry.type === "orchestrator.task.updated" && FINAL.has(entry.status)) {
    if (!terminalReached) {
      terminalReached = true
      activityLine(`[overlay-benchmark] terminal-signal status=${entry.status}`)
    }
    const resolver = terminalSignalResolver
    terminalSignalResolver = null
    if (resolver) resolver()
  }
  const line = formatEventLine(entry, normalized.props)
  if (line && line !== lastActivityLine) {
    lastActivityLine = line
    activityLine(line)
  }
  // Ensure tool_call/tool_result events always refresh the activity timer
  // even when formatEventLine returns empty (e.g. during evaluation).
  // Prevents false stall detection while evaluator is actively investigating.
  if (!line && (entry.kind === "tool_call" || entry.kind === "tool_result" || entry.kind === "status")) {
    lastActivityLogAt = Date.now()
    lastLogAt = lastActivityLogAt
  }
  flushed = flushed
    .then(() => fs.appendFile(eventLogFile, `${JSON.stringify(entry)}\n`))
    .catch(() => undefined)
}

const api = async (pathname: string, init?: RequestInit) => {
  const url = new URL(pathname, server.url)
  url.searchParams.set("directory", temp.dir)
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.pathname}`)
  return res
}

function subscribeTaskEvents(taskID: string) {
  const stop = new AbortController()
  const signal = stop.signal
  const run = (async () => {
    while (!signal.aborted) {
      const url = new URL(`/task/${taskID}/events`, server.url)
      url.searchParams.set("directory", temp.dir)
      const res = await fetch(url, { signal }).catch(() => undefined)
      if (!res || !res.ok || !res.body) {
        if (signal.aborted) return
        await Bun.sleep(1000)
        continue
      }
      await parseSSE(res.body, signal, (event) => onEvent({ payload: event })).catch(() => undefined)
      if (!signal.aborted) await Bun.sleep(250)
    }
  })()
  return {
    async stop() {
      stop.abort()
      await run.catch(() => undefined)
    },
  }
}

let eventStream = {
  stop: async () => undefined,
}

try {
  await Bun.write(eventLogFile, "")

  if (page) {
    await page.evaluateOnNewDocument((serverUrl, directory) => {
      localStorage.setItem("oc_server_url", serverUrl)
      localStorage.setItem("oc_auto_server", "false")
      localStorage.setItem("oc_directory", directory)
      localStorage.setItem("oc_directory_mode", "custom")
      localStorage.setItem("oc_workspace_directory", directory)
      localStorage.setItem("oc_auto_question", "true")
    }, server.url.origin, temp.dir)

    await page.goto(new URL("/ui/index.html", server.url).toString(), { waitUntil: "load" })
    const overlayReady = await page.waitForFunction(() => typeof (window as OverlayBenchmarkWindow).applyDirectory === "function", { timeout: 0 })
      .then(() => true)
      .catch((error) => {
        errorLine(`[overlay-benchmark] overlay readiness wait failed; continuing API-only for primary task: ${error instanceof Error ? error.stack || error.message : String(error)}`)
        return false
      })
    if (overlayReady) {
      const overlay = await syncDirectory(page, temp.dir).catch((error) => {
        errorLine(`[overlay-benchmark] overlay directory sync failed; continuing API-only for primary task: ${error instanceof Error ? error.stack || error.message : String(error)}`)
        return null
      })
      if (overlay) logLine(`[overlay-benchmark] directory=${overlay.directory} saved=${overlay.savedDirectory}`)
    }
    await api("/global/health").catch((error) => {
      errorLine(`[overlay-benchmark] health check failed; continuing primary task: ${error instanceof Error ? error.stack || error.message : String(error)}`)
    })
  }
  marks.onlineAt = Date.now()
  marks.submittedAt = Date.now()

  if (resumeTaskID) {
    // ── Resume mode ──────────────────────────────────────────────────────────
    // Attach to an existing task without creating a new one.
    taskID = resumeTaskID
    eventStream = subscribeTaskEvents(taskID)

    // Navigate browser to the overlay and select the existing task
    if (page) {
      await page.evaluate(async (id) => {
        const overlay = window as OverlayBenchmarkWindow
        await overlay.loadTasks()
        await overlay.selectTask(id)
      }, taskID)
      await page.waitForFunction((id) => {
        return (window as OverlayBenchmarkWindow).boardStore.selectedTaskID === id
      }, { timeout: 0 }, taskID)
    }

    // Synthesize planning/streaming snapshots from current board state
    const currentProg = await api(`/task/${taskID}/progress`).then((r) => r.json()).catch(() => null)
    planning = {
      pendingCount: 0,
      taskList: currentProg?.task?.title ?? TASK_TITLE,
      reasoning: "",
      assistantText: "",
      taskIDs: [taskID],
      selectedTaskID: taskID,
    }
    marks.planningAt = Date.now()
    marks.createdAt = Date.now()
    marks.selectedAt = Date.now()

    if (page) {
      await page.waitForFunction(() => {
        return !!(window as OverlayBenchmarkWindow).boardStore.board?.task?.id
      }, { timeout: 0 })
    }
    marks.boardAt = Date.now()

    if (resumeMessage !== undefined) {
      logLine(`[overlay-benchmark] resume taskID=${taskID} injecting explicit message: ${resumeMessage}`)
      await api(`/task/${taskID}/message`, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ text: resumeMessage, source: "user_message" }),
      })
      marks.resumedAt = Date.now()
    } else {
      logLine(`[overlay-benchmark] resume taskID=${taskID} attached without message injection`)
    }

    if (page) {
      streaming = await waitForStreamingVisible(page).catch(() => ({
        reasoning: "", assistantText: "", liveRole: "", liveText: "",
      }))
    } else {
      streaming = { reasoning: "", assistantText: "", liveRole: "", liveText: "" }
    }
    marks.streamingAt = Date.now()
    // ─────────────────────────────────────────────────────────────────────────
  } else {
    // ── Normal mode: create a new task ────────────────────────────────────────
    taskID = await api("/task", {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        title: TASK_TITLE,
        request: TASK_REQUEST,
        ...(TASK_ATTACHMENTS.length > 0 ? { attachments: TASK_ATTACHMENTS } : {}),
        executor,
        budget: {
          maxRuns,
          maxFixRuns,
          ...(maxExecutorGroups != null ? { maxExecutorGroups } : {}),
        },
        ...(DELIVERY_VERIFY_CMD || figmaUrl
          ? {
              metadata: {
                ...(DELIVERY_VERIFY_CMD ? { delivery_verify_cmd: DELIVERY_VERIFY_CMD } : {}),
                ...(figmaUrl ? { figma_url: figmaUrl } : {}),
              },
            }
          : {}),
      }),
    })
      .then((res) => res.json())
      .then((body) => String(body.task_id || ""))
    if (!taskID) throw new Error("Task creation did not return task_id")
    eventStream = subscribeTaskEvents(taskID)
    // Resume hint: print everything needed to re-attach with --resume-* flags
    // after a kill. Without this the user has to dig the tempdir paths out of
    // earlier log lines (or guess), which makes resume effectively unusable.
    logLine(`[overlay-benchmark] RESUME-INFO taskID=${taskID}`)
    logLine(`[overlay-benchmark] RESUME-INFO home=${temp.home}`)
    logLine(`[overlay-benchmark] RESUME-INFO project=${temp.dir}`)
    logLine(
      `[overlay-benchmark] RESUME-CMD bun run script/benchmark/overlay-web-benchmark.ts ` +
        `--resume-task-id=${taskID} --resume-home-dir="${temp.home}" --project-dir="${temp.dir}" --executor=${executor}`,
    )

    if (page) {
      planning = await waitForPlanningVisible(page, api).catch((error) => {
        errorLine(`[overlay-benchmark] overlay planning visibility check failed; falling back to API polling: ${error instanceof Error ? error.stack || error.message : String(error)}`)
        return null
      })
      if (!planning) {
        while (true) {
          const prog = await api(`/task/${taskID}/progress`).then((r) => r.json()).catch(() => null)
          if (prog?.task?.status && prog.task.status !== "queued") {
            planning = { pendingCount: 0, taskList: [], reasoning: "", assistantText: "", taskIDs: [taskID], selectedTaskID: taskID }
            break
          }
          await Bun.sleep(1000)
        }
      }
    } else {
      while (true) {
        const prog = await api(`/task/${taskID}/progress`).then((r) => r.json()).catch(() => null)
        if (prog?.task?.status && prog.task.status !== "queued") {
          planning = { pendingCount: 0, taskList: [], reasoning: "", assistantText: "", taskIDs: [taskID], selectedTaskID: taskID }
          break
        }
        await Bun.sleep(1000)
      }
    }
    marks.planningAt = Date.now()

    if (page) {
      taskID = await waitForTaskCreated(page, api).catch((error) => {
        errorLine(`[overlay-benchmark] overlay task-created visibility check failed; keeping API taskID=${taskID}: ${error instanceof Error ? error.stack || error.message : String(error)}`)
        return taskID
      })
    }
    marks.createdAt = Date.now()
    await api(`/task/${taskID}/budget`, {
      method: "PATCH",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        budget: {
          maxRuns,
          maxFixRuns,
          ...(maxExecutorGroups != null ? { maxExecutorGroups } : {}),
        },
      }),
    }).catch(() => undefined)

    if (page) {
      await page.evaluate(async (id) => {
        const overlay = window as OverlayBenchmarkWindow
        if (overlay.boardStore.selectedTaskID === id) return
        await overlay.loadTasks()
        await overlay.selectTask(id)
      }, taskID).catch((error) => {
        errorLine(`[overlay-benchmark] overlay selectTask failed; continuing with API task state: ${error instanceof Error ? error.stack || error.message : String(error)}`)
      })
      await page.waitForFunction((id) => {
        return (window as OverlayBenchmarkWindow).boardStore.selectedTaskID === id
      }, { timeout: 0 }, taskID).catch((error) => {
        errorLine(`[overlay-benchmark] overlay selected-task wait failed; continuing with API task state: ${error instanceof Error ? error.stack || error.message : String(error)}`)
      })
    }
    marks.selectedAt = Date.now()

    if (page) {
      await page.waitForFunction(() => {
        return !!(window as OverlayBenchmarkWindow).boardStore.board?.task?.id
      }, { timeout: 0 }).catch((error) => {
        errorLine(`[overlay-benchmark] overlay board wait failed; continuing with API task state: ${error instanceof Error ? error.stack || error.message : String(error)}`)
      })
    }
    marks.boardAt = Date.now()
    if (page) {
      streaming = await waitForStreamingVisible(page).catch((error) => {
        errorLine(`[overlay-benchmark] overlay streaming visibility check failed; continuing with API task state: ${error instanceof Error ? error.stack || error.message : String(error)}`)
        return { reasoning: "", assistantText: "", liveRole: "", liveText: "" }
      })
    } else {
      streaming = { reasoning: "", assistantText: "", liveRole: "", liveText: "" }
    }
    marks.streamingAt = Date.now()
    // ─────────────────────────────────────────────────────────────────────────
  }
  if (page && browser) {
    page = await verifyResume(browser, page, server.url.origin, taskID, temp.dir, api)
      .catch((error) => {
        errorLine(`[overlay-benchmark] resume overlay verification failed; continuing primary task: ${error instanceof Error ? error.stack || error.message : String(error)}`)
        return page
      })
  }
  board = await api(`/task/${taskID}/board?sync=1`).then((res) => res.json())

  if (stopAfterArchitect) {
    finalBoard = await waitForArchitectBoard(taskID, api)
    progress = await api(`/task/${taskID}/progress`).then((res) => res.json()).catch(() => null)
    marks.completedAt = Date.now()
  } else {
    progress = await waitForFinal(taskID, api)
    const status = String(progress?.task?.status ?? "")
    if (status !== "completed") {
      logLine(`[overlay-benchmark] task ended status=${status} — report preserves the terminal state without automatic resume`)
    }
    marks.completedAt = Date.now()
    finalBoard = taskID ? await api(`/task/${taskID}/board?sync=1`).then((res) => res.json()) : board
  }

  transcript = await api(`/task/${taskID}/transcript`).then((res) => res.json())
  timeline = await api(`/control/timeline?taskID=${encodeURIComponent(taskID)}`).then((res) => res.json())
  runs = await api(`/task/${taskID}/runs`).then((res) => res.json())

  const out = await buildBenchmarkReport()

  await flushed
  await Bun.write(eventFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    taskID,
    event_count: events.length,
    stage_summary: summarizeEvents(events, taskID),
    events,
  }, null, 2))
  await Bun.write(reportFile, JSON.stringify(out, null, 2))
  _emergencyWritten = true
  logLine(JSON.stringify(out, null, 2))
  logLine(`report: ${reportFile}`)
  logLine(`events: ${eventFile}`)
  logLine(`events_ndjson: ${eventLogFile}`)

  const pass = stopAfterArchitect
    ? out.assertions.planning_visible.pass && out.assertions.streaming_visible.pass && out.assertions.materialized.pass && out.assertions.architect_contract_graph.pass
    : out.assertions.planning_visible.pass && out.assertions.streaming_visible.pass && out.assertions.materialized.pass && out.assertions.delivery.pass && out.failure_matrix.verdict === "accepted"
  if (!pass) {
    process.exit(1)
  }
} catch (error) {
  process.exitCode = 1
  if (!marks.completedAt) marks.completedAt = Date.now()
  let out: unknown
  try {
    out = await buildBenchmarkReport(error)
  } catch (reportErr) {
    out = {
      generated_at: new Date().toISOString(),
      type: "benchmark_report_failed",
      taskID,
      error: String(error),
      report_error: reportErr instanceof Error ? reportErr.message : String(reportErr),
      elapsed_ms: Date.now() - marks.startedAt,
      marks,
      last_progress_signature: lastProgressSignature,
      events_captured: events.length,
      last_event_at: lastEventAt,
      last_activity_at: lastActivityLogAt,
    }
  }
  await flushed.catch(() => undefined)
  const eventPayload = {
    generated_at: new Date().toISOString(),
    taskID,
    error: String(error),
    event_count: events.length,
    stage_summary: summarizeEvents(events, taskID),
    events,
  }
  let wroteReport = false
  try {
    await Bun.write(eventFile, JSON.stringify(eventPayload, null, 2))
  } catch (writeErr) {
    errorLine(`[overlay-benchmark] failed to write events report ${eventFile}: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`)
  }
  try {
    await Bun.write(reportFile, JSON.stringify(out, null, 2))
    wroteReport = true
  } catch (writeErr) {
    errorLine(`[overlay-benchmark] failed to write benchmark report ${reportFile}: ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`)
  }
  _emergencyWritten = wroteReport
  errorLine(JSON.stringify(out, null, 2))
  errorLine(`report: ${reportFile}`)
  errorLine(`events: ${eventFile}`)
  errorLine(`events_ndjson: ${eventLogFile}`)
} finally {
  await cleanup("events.stop", () => eventStream.stop())
  await flushed.catch(() => undefined)
  if (taskID) {
    await cleanup("task.cancel", () =>
      api(`/task/${taskID}/cancel`, {
        method: "POST",
      }).catch(() => undefined),
    )
  }
  if (page) await cleanup("page.close", () => page!.close().catch(() => undefined))
  if (browser) await cleanup("browser.close", () => browser!.close().catch(() => undefined), () => browser!.process()?.kill("SIGKILL"))
  await cleanup("server.stop", () => server.stop(true))
  await cleanup("instance.disposeAll", () => Instance.disposeAll().catch(() => undefined))
  // Kill any orphaned processes that executors left behind in the workspace
  // (e.g. test scripts with setInterval that never exit on their own).
  if (temp.dir) {
    await cleanup("orphan.kill", async () => {
      try {
        await Bun.spawn(["pkill", "-9", "-f", temp.dir], { stdout: "pipe", stderr: "pipe" }).exited
      } catch { /* best effort — pkill not available on all platforms */ }
    })
  }
  if (!keep && temp.dir) {
    // Rescue the trace dir before wiping the workspace. Default trace dir is
    // under `<temp.dir>/.opencorvus/runtime/trace`, which would otherwise die
    // with the workspace and make every benchmark run lose its agent traces.
    const traceDir = process.env.OPENCORVUS_AGENT_TRACE_DIR
    if (traceDir && traceDir.startsWith(temp.dir)) {
      const stamp = Date.now()
      const survivor = path.join(process.cwd(), `overlay-web-benchmark-trace-${stamp}`)
      await cleanup("trace.preserve", () => fs.rename(traceDir, survivor).catch(() => undefined))
      logLine(`[overlay-benchmark] trace preserved at ${survivor}`)
    }
    await cleanup("temp.dir", () => fs.rm(temp.dir, { recursive: true, force: true }).catch(() => undefined))
  }
  if (!keep && temp.home) await cleanup("temp.home", () => fs.rm(temp.home, { recursive: true, force: true }).catch(() => undefined))
  process.exit(process.exitCode ?? 0)
}

async function scaffoldProject(dir: string, model: string) {
  await fs.mkdir(path.join(dir, "src"), { recursive: true })
  await fs.mkdir(path.join(dir, "data"), { recursive: true })
  // .gitkeep ensures data/ is tracked by git and survives git clean / executor git ops.
  // Without this, executors that run git init or git clean can remove the directory,
  // causing db.ts to fail at runtime when it opens data/trading.db.
  await Bun.write(path.join(dir, "data", ".gitkeep"), "")
  await fs.mkdir(path.join(dir, ".opencorvus"), { recursive: true })
  await fs.mkdir(temp.config, { recursive: true })
  // W2-V32: the server no longer auto-runs git init for non-git directories
  // (task-api/index.ts:289 throws WorktreeNotGitError). The benchmark is
  // unattended and creates its own scratch dir, so it must init git itself
  // — there is no overlay user gesture to prompt for.
  {
    const proc = Bun.spawn(["git", "init"], { cwd: dir, stdout: "pipe", stderr: "pipe" })
    const code = await proc.exited
    if (code !== 0) {
      const err = (await proc.stderr.text()).trim() || "git init failed"
      throw new Error(`scaffoldProject: git init failed in ${dir}: ${err}`)
    }
  }
  // Generate .gitignore only if one doesn't already exist
  const gitignorePath = path.join(dir, ".gitignore")
  if (!(await Bun.file(gitignorePath).exists())) {
    await Bun.write(gitignorePath, generateGitignore(model))
  }
  await Bun.write(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name: "overlay-web-benchmark",
        private: true,
        type: "module",
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(dir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "Preserve",
          moduleResolution: "Bundler",
          strict: true,
          skipLibCheck: true,
        },
      },
      null,
      2,
    ),
  )
  await writeBenchmarkModelConfig(dir, model)
}

async function writeBenchmarkModelConfig(dir: string, model: string) {
  const config = JSON.stringify(
    {
      $schema: "https://opencorvus.ai/config.json",
      model,
      experimental: {
        auto_question: true,
      },
      lsp: {
        biome: {
          disabled: true,
        },
        eslint: {
          disabled: true,
        },
      },
      // Do not write an empty provider override here. A model id such as
      // glm51/glm51 resolves through the built-in provider catalog; adding
      // provider.glm51={options:{}} shadows that catalog entry and erases its
      // model list.
      // Bench runs always fail-fast on context drops. When any agent
      // emits <INFORMATION MISSING>...</INFORMATION MISSING> the host
      // process.exits with code 99 (see prompt/information-missing.ts +
      // agent/runner.ts). Surfaces dispatcher-level context drops as
      // hard signals instead of letting agents guess past them — the
      // primary signal benchmarks exist to catch.
      assistant: {
        debug: {
          fail_on_information_missing: true,
        },
      },
    },
    null,
    2,
  )
  await Bun.write(path.join(dir, "opencorvus.json"), config)
  await Bun.write(path.join(dir, ".opencorvus", "opencorvus.json"), config)
  await Bun.write(path.join(temp.config, "opencorvus.json"), config)
}

/** Generate a .gitignore appropriate for the project context (inferred from request + model). */
function generateGitignore(model: string): string {
  const sections: string[] = []

  // Core: always ignore these regardless of stack
  sections.push(`# Dependencies
node_modules/
.pnp.*
.yarn/

# Build outputs
dist/
build/
.output/
.next/
.nuxt/
.svelte-kit/
.astro/

# Environment & secrets
.env
.env.*
!.env.example

# Data & databases
*.db
*.db-shm
*.db-wal
*.sqlite
*.sqlite3
data/*.db*

# IDE & OS
.vscode/
.idea/
*.swp
*.swo
.DS_Store
Thumbs.db

# TypeScript
*.tsbuildinfo
tsconfig.tsbuildinfo

# Test & coverage
coverage/
.nyc_output/

# Logs
*.log
logs/

# Caches
.cache/
.parcel-cache/
.turbo/
.vercel/

# Lock files (keep bun.lock, ignore others if present)
package-lock.json
yarn.lock
pnpm-lock.yaml

# Misc
*.tgz
*.tar.gz
`)

  return sections.join("\n")
}

async function runLocalVerify(cwd: string, cmd: string) {
  if (!cmd) {
    return {
      mode: "skipped",
      command: null,
      exitCode: null,
      stdout: "",
      stderr: "",
      status: "not_run",
    }
  }
  const shell = process.platform === "win32" ? ["cmd", "/c", cmd] : ["bash", "-lc", cmd]
  const proc = Bun.spawn(shell, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  })
  return {
    mode: "command",
    command: cmd,
    exitCode: await proc.exited,
    stdout: (await new Response(proc.stdout).text()).trim(),
    stderr: (await new Response(proc.stderr).text()).trim(),
    status: "completed",
  }
}

function skippedLocalVerify(reason: string, cmd: string) {
  return {
    mode: cmd ? "command" : "skipped",
    command: cmd || null,
    exitCode: null,
    stdout: "",
    stderr: reason,
    status: "not_run",
  }
}

// Format the latest IntegrityReviewCompleted payload into a stable shape for
// the benchmark report. Returns null when no integrity review fired (e.g. the
// task failed before architect reached the integrity stage). Field names match
// the IntegrityReviewCompleted Zod schema in engine/model.ts so the report
// stays readable next to source-of-truth definitions.
function formatIntegritySection(
  payload: Record<string, unknown> | null,
  attemptCount: number,
): Record<string, unknown> | null {
  if (!payload) return null
  const dims = Array.isArray(payload.dimensions) ? (payload.dimensions as Array<Record<string, unknown>>) : []
  const issues = Array.isArray(payload.issues) ? (payload.issues as Array<Record<string, unknown>>) : []
  const corrections = Array.isArray(payload.corrections) ? (payload.corrections as Array<Record<string, unknown>>) : []
  const missingGoals = Array.isArray(payload.missingGoals) ? (payload.missingGoals as Array<Record<string, unknown>>) : []
  return {
    sessionID: typeof payload.sessionID === "string" ? payload.sessionID : null,
    verdict: typeof payload.verdict === "string" ? payload.verdict : null,
    summary: typeof payload.summary === "string" ? payload.summary : null,
    attempts_observed: attemptCount,
    attempts_reported: typeof payload.attempts === "number" ? payload.attempts : null,
    dimensions: dims.map((d) => ({
      id: typeof d.id === "string" ? d.id : null,
      verdict: typeof d.verdict === "string" ? d.verdict : null,
      issueCount: typeof d.issueCount === "number" ? d.issueCount : 0,
      correctionCount: typeof d.correctionCount === "number" ? d.correctionCount : 0,
      missingGoalCount: typeof d.missingGoalCount === "number" ? d.missingGoalCount : 0,
    })),
    issues: issues.map((i) => ({
      type: typeof i.type === "string" ? i.type : null,
      description: typeof i.description === "string" ? i.description : null,
    })),
    corrections: corrections.map((c) => ({
      action: typeof c.action === "string" ? c.action : null,
      goalID: typeof c.goalID === "string" ? c.goalID : null,
      reason: typeof c.reason === "string" ? c.reason : null,
      updatesTitle: typeof c.updatesTitle === "string" ? c.updatesTitle : null,
      updatesObjective: typeof c.updatesObjective === "string" ? c.updatesObjective : null,
    })),
    missingGoals: missingGoals.map((g) => ({
      title: typeof g.title === "string" ? g.title : null,
      objective: typeof g.objective === "string" ? g.objective : null,
      reason: typeof g.reason === "string" ? g.reason : null,
    })),
  }
}

async function buildBenchmarkReport(error?: unknown) {
  const reportError = error ? String(error) : undefined
  const completedAt = marks.completedAt || Date.now()
  const currentBoard = board ?? (taskID ? await reportApiJson(`/task/${taskID}/board?sync=1`) : null)
  const currentFinalBoard = finalBoard ?? (taskID ? await reportApiJson(`/task/${taskID}/board?sync=1`) : null)
  const currentTranscript = transcript ?? (taskID ? await reportApiJson(`/task/${taskID}/transcript`) : null)
  const currentTimeline = timeline ?? (taskID ? await reportApiJson(`/control/timeline?taskID=${encodeURIComponent(taskID)}`) : null)
  const currentRuns = runs ?? (taskID ? await reportApiJson(`/task/${taskID}/runs`) : null)
  const currentTaskStatus = String(progress?.task?.status ?? currentFinalBoard?.task?.status ?? currentBoard?.task?.status ?? "")
  const localVerify = reportError || currentTaskStatus !== "completed"
    ? skippedLocalVerify(
      reportError
        ? `skipped because benchmark ended before task completion: ${reportError}`
        : `skipped because task status is ${currentTaskStatus || "unknown"}, not completed`,
      DELIVERY_VERIFY_CMD,
    )
    : await runLocalVerify(temp.dir, DELIVERY_VERIFY_CMD)
  const deliveryChangedFiles = progress?.delivery?.result?.changedFiles ?? currentFinalBoard?.delivery?.result?.changedFiles ?? []
  // Delivery changedFiles may only contain internal .opencorvus/ files while
  // actual source files are in committed diffs. Git is a parallel evidence
  // source, not a substitute; failures throw instead of producing an empty
  // changed-files list.
  const gitObservedFiles = await gitChangedFiles(temp.dir)
  const changedFiles = dedupePaths([...deliveryChangedFiles, ...gitObservedFiles])
  const moduleBlocks = resolveModuleBlocks(progress, currentFinalBoard ?? currentBoard, TASK_REQUEST)
  const artifactAudit = await auditWorkspace({
    rootDir: temp.dir,
    changedFiles,
    request: TASK_REQUEST,
    moduleBlocks,
  })
  const runMetrics = await deriveRunMetrics({
    rootDir: temp.dir,
    changedFiles,
    completedAt,
    events,
    evaluationChecks: progress?.evaluation?.checks ?? currentFinalBoard?.evaluation?.checks ?? [],
    moduleBlocks,
  })
  const qualityVerdict = applyBenchmarkErrorVerdict(evaluateQualityGates({
    artifactAudit,
    runMetrics,
    taskStatus: progress?.task?.status || currentFinalBoard?.task?.status || "",
    evaluationVerdict: progress?.evaluation?.verdict || currentFinalBoard?.evaluation?.verdict || "",
    localVerify,
  }), reportError)
  const screenshot = page ? await takeBenchmarkScreenshot(page) : null
  const currentOverlay = page ? await overlaySnapshot(page).catch((cause) => ({ error: String(cause) })) : { error: "no-browser mode" }

  return {
    generated_at: new Date().toISOString(),
    title: TASK_TITLE,
    request_file: requestFile ? path.resolve(requestFile) : null,
    executor,
    model,
    directory: temp.dir,
    server: server.url.toString(),
    taskID,
    error: reportError,
    taskStatus: progress?.task?.status || currentFinalBoard?.task?.status || "",
    evaluation: progress?.evaluation?.verdict || currentFinalBoard?.evaluation?.verdict || "",
    changedFiles,
    transcriptCount: Array.isArray(currentTranscript) ? currentTranscript.length : null,
    timelineCount: Array.isArray(currentTimeline) ? currentTimeline.length : null,
    runCount: Array.isArray(currentRuns) ? currentRuns.length : null,
    planning: planning
      ? {
          pendingCount: planning.pendingCount,
          taskList: planning.taskList,
          reasoning: planning.reasoning,
          assistantText: planning.assistantText,
        }
      : null,
    streaming: streaming
      ? {
          reasoning: streaming.reasoning,
          assistantText: streaming.assistantText,
          liveRole: streaming.liveRole,
          liveText: streaming.liveText,
          reasoningVisible: meaningfulLiveText(streaming.reasoning),
          assistantVisible: meaningfulLiveText(streaming.assistantText),
          liveVisible: meaningfulLiveText(streaming.liveText),
        }
      : null,
    materialization: {
      boardTaskID: currentBoard?.task?.id || "",
      boardStatus: currentBoard?.task?.status || "",
      specVersion: currentBoard?.spec?.version ?? null,
      goalCount: Array.isArray(currentBoard?.goalWorkflows) ? currentBoard.goalWorkflows.length : 0,
      goalRunCount: Array.isArray(currentBoard?.goalRuns) ? currentBoard.goalRuns.length : 0,
      criteriaCount: (() => {
        const evalChecks = currentBoard?.evaluation?.checks
        return Array.isArray(evalChecks) ? evalChecks.length : 0
      })(),
    },
    architect: currentFinalBoard?.architect
      ? {
          summary: currentFinalBoard.architect.summary ?? null,
          contractCount: currentFinalBoard.architect.contractCount ?? null,
          categories: currentFinalBoard.architect.categories ?? null,
        }
      : null,
    plan: currentFinalBoard?.plan
      ? {
          id: currentFinalBoard.plan.id ?? null,
          version: currentFinalBoard.plan.version ?? null,
          status: currentFinalBoard.plan.status ?? null,
          summary: currentFinalBoard.plan.summary ?? null,
        }
      : null,
    integrity: formatIntegritySection(latestIntegrity, integrityAttemptCount),
    screenshot,
    resume: {
      attached: !!resumeTaskID && marks.selectedAt > 0,
      messageInjected: marks.resumedAt > 0,
      selectedAt: elapsedOrNull(marks.selectedAt),
      injectedAt: elapsedOrNull(marks.resumedAt),
      // resume mode metadata
      resumeTaskID: resumeTaskID ?? null,
      resumeHomeDir: resumeHomeDir ?? null,
    },
    timings_ms: {
      online: elapsedOrNull(marks.onlineAt),
      submit: elapsedOrNull(marks.submittedAt),
      planning_visible: elapsedOrNull(marks.planningAt),
      streaming_visible: elapsedOrNull(marks.streamingAt),
      task_created: elapsedOrNull(marks.createdAt),
      task_selected: elapsedOrNull(marks.selectedAt),
      board_loaded: elapsedOrNull(marks.boardAt),
      resumed: elapsedOrNull(marks.resumedAt),
      completed: elapsedOrNull(completedAt),
      execution: marks.submittedAt ? completedAt - marks.submittedAt : null,
    },
    assertions: {
      planning_visible: {
        pass: !!planning && (planning.pendingCount > 0 || planning.taskIDs.length > 0 || !!planning.selectedTaskID),
        sample: planning,
      },
      streaming_visible: {
        pass: !!streaming && (
          meaningfulLiveText(streaming.reasoning) ||
          meaningfulLiveText(streaming.assistantText) ||
          meaningfulLiveText(streaming.liveText)
        ),
        sample: streaming,
      },
      materialized: {
        pass: !!taskID && (currentBoard?.task?.id || "") === taskID && marks.boardAt > 0,
        sample: {
          taskID,
          boardTaskID: currentBoard?.task?.id || "",
          boardLoaded: marks.boardAt > 0,
        },
      },
      architect_contract_graph: {
        pass: Array.isArray(currentFinalBoard?.goalWorkflows) &&
          currentFinalBoard.goalWorkflows.length >= 2 &&
          typeof currentFinalBoard?.architect?.contractCount === "number" &&
          currentFinalBoard.architect.contractCount > 0,
        sample: {
          goalCount: Array.isArray(currentFinalBoard?.goalWorkflows) ? currentFinalBoard.goalWorkflows.length : 0,
          contractCount: currentFinalBoard?.architect?.contractCount ?? null,
          architectSummary: currentFinalBoard?.architect?.summary ?? null,
        },
      },
      delivery: {
        pass: (progress?.task?.status || currentFinalBoard?.task?.status) === "completed" &&
            (progress?.evaluation?.verdict || currentFinalBoard?.evaluation?.verdict) === "accepted" &&
            qualityVerdict.verdict === "accepted",
        sample: {
          taskStatus: progress?.task?.status || currentFinalBoard?.task?.status || "",
          verdict: progress?.evaluation?.verdict || currentFinalBoard?.evaluation?.verdict || "",
          localExit: localVerify.exitCode,
          qualityVerdict: qualityVerdict.verdict,
        },
      },
    },
    local_verify: localVerify,
    artifact_audit: artifactAudit,
    run_metrics: runMetrics,
    failure_matrix: {
      verdict: qualityVerdict.verdict,
      primary_failure: qualityVerdict.primary_failure,
      failures: qualityVerdict.failures,
    },
    manual_review_summary: qualityVerdict.manual_review_summary,
    overlay: currentOverlay,
    diagnostics: {
      event_file: eventFile,
      event_count: events.length,
      stage_summary: summarizeEvents(events, taskID),
      report_api_errors: reportApiErrors,
    },
  }
}

async function reportApiJson(pathname: string) {
  try {
    return await api(pathname).then((res) => res.json())
  } catch (error) {
    const message = `${pathname}: ${error instanceof Error ? error.message : String(error)}`
    reportApiErrors.push(message)
    logLine(`[overlay-benchmark] report api error ${message}`)
    return null
  }
}

function applyBenchmarkErrorVerdict(base: ReturnType<typeof evaluateQualityGates>, error?: string) {
  void error
  return base
}

async function takeBenchmarkScreenshot(page: Page) {
  const screenshot = path.join(process.cwd(), `overlay-web-benchmark-${Date.now()}.png`)
  try {
    await page.screenshot({ path: screenshot, fullPage: true })
    return screenshot
  } catch {
    return null
  }
}

function elapsedOrNull(at: number) {
  return at ? at - marks.startedAt : null
}

function dedupePaths(files: string[]) {
  return [...new Set(files.filter((item): item is string => typeof item === "string" && item.length > 0).map((item) => item.replace(/\\/g, "/")))]
}

async function gitChangedFiles(dir: string): Promise<string[]> {
  const run = async (args: string[]) => {
    const proc = Bun.spawn(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" })
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    if (exitCode !== 0) {
      throw new Error(`git ${args.join(" ")} failed with exit ${exitCode}: ${stderr.trim()}`)
    }
    return stdout.trim().split(/\r?\n/).filter(Boolean)
  }
  // 1. Uncommitted changes (working tree vs HEAD)
  const [modified, untracked] = await Promise.all([
    run(["diff", "--name-only", "HEAD"]),
    run(["ls-files", "--others", "--exclude-standard"]),
  ])
  if (modified.length > 0 || untracked.length > 0) return [...modified, ...untracked]
  // 2. Committed changes: compare initial checkpoint to HEAD.
  //    The orchestrator creates a checkpoint commit, executor works, delivery commits.
  //    `git diff HEAD` is empty because everything is committed.
  const commits = await run(["log", "--oneline", "--reverse"])
  if (commits.length >= 2) {
    const firstHash = commits[0].split(" ")[0]
    return run(["diff", "--name-only", firstHash, "HEAD"])
  }
  // 3. Single commit: list all files in that commit (everything was added in one go)
  if (commits.length === 1) {
    return run(["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"])
  }
  return []
}

function resolveModuleBlocks(progress: any, board: any, request: string) {
  const specBlocks = progress?.spec?.metadata?.module_blocks ?? board?.spec?.metadata?.module_blocks
  if (Array.isArray(specBlocks) && specBlocks.length > 0) {
    return specBlocks
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => ({
        id: typeof item.id === "string" ? item.id : "spec-block",
        owned_paths: Array.isArray(item.owned_paths) ? dedupePaths(item.owned_paths.filter((path): path is string => typeof path === "string")) : [],
      }))
      .filter((item) => item.owned_paths.length > 0)
  }
  const contractAllowed = progress?.plan?.metadata?.task_contract?.artifacts?.allowed ?? board?.plan?.metadata?.task_contract?.artifacts?.allowed
  if (Array.isArray(contractAllowed) && contractAllowed.length > 0) {
    return [{
      id: "task-contract",
      owned_paths: dedupePaths(contractAllowed.filter((item): item is string => typeof item === "string")),
    }]
  }
  return moduleBlocksFromRequest(request)
}

async function launchBrowser() {
  const executablePath = await findBrowser()
  return puppeteer.launch({
    executablePath,
    headless: false,
    userDataDir: mkdtempSync(path.join(os.tmpdir(), "pptr-overlay-web-benchmark-")),
    args: [
      "--no-sandbox",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-setuid-sandbox",
      "--disable-extensions",
      // Without these, Windows under DPI scaling drops the window in the bottom-right corner.
      "--window-position=0,0",
      "--window-size=1600,1200",
    ],
  })
}

async function findBrowser() {
  const list = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ]
  for (const item of list) {
    if (await Bun.file(item).exists()) return item
  }
  throw new Error("No local Edge/Chrome executable found for overlay benchmark")
}

async function cleanup(
  label: string,
  run: () => Promise<unknown>,
  force?: () => void | Promise<void>,
) {
  try {
    await run()
  } catch (error) {
    errorLine(`[cleanup] ${label}: ${String(error)}`)
    await force?.()
  }
}

async function waitForFinal(
  taskID: string,
  api: (pathname: string, init?: RequestInit) => Promise<Response>,
) {
  let lastStatus = ""
  lastProgressSignature = ""
  lastHeartbeatAt = 0
  terminalReached = false
  const terminalPromise = new Promise<void>((resolve) => {
    terminalSignalResolver = () => resolve()
  })
  try {
  while (true) {
    let progress: any
    try {
      progress = await api(`/task/${taskID}/progress`).then((res) => res.json())
    } catch (e) {
      const isTransient = e instanceof SyntaxError
        || (e instanceof DOMException && (e.name === "AbortError" || e.name === "TimeoutError"))
        || (e instanceof TypeError && typeof (e as any).message === "string" && /fetch|network|abort/i.test((e as any).message))
      if (isTransient) {
        logLine(`[overlay-benchmark] warn: progress poll error (${(e as any)?.name ?? "Error"}: ${(e as any)?.message}), retrying in 2s`)
        await Bun.sleep(2_000)
        continue
      }
      throw e
    }
    progress = await settle(progress, api)
    if (FINAL.has(progress.task.status)) return progress
    const signature = progressSignature(progress)
    if (signature !== lastProgressSignature) {
      lastProgressSignature = signature
      activityLine(`[overlay-benchmark] progress=${signature}`)
    }
    if (progress.task.status !== lastStatus) {
      lastStatus = progress.task.status
      activityLine(`[overlay-benchmark] status=${lastStatus}`)
    }
    const now = Date.now()
    const taskStatus = progress?.task?.status || ""
    if (now - lastHeartbeatAt >= 60_000) {
      lastHeartbeatAt = now
      const retryCount = progress?.run?.retryCount ?? progress?.activeRun?.retryCount ?? 0
      const maxFixRuns = (progress?.task as any)?.budget?.maxFixRuns ?? "?"
      logLine(
        `[overlay-benchmark] heartbeat status=${taskStatus} retry=${retryCount}/${maxFixRuns} last_progress=${lastProgressSignature || "none"}`,
      )
    }
    if (terminalReached) {
      await Bun.sleep(250)
    } else {
      await Promise.race([Bun.sleep(2_000), terminalPromise])
    }
  }
  } finally {
    terminalSignalResolver = null
  }
}

async function waitForArchitectBoard(
  taskID: string,
  api: (pathname: string, init?: RequestInit) => Promise<Response>,
) {
  let lastSignature = ""
  let lastChangeAt = Date.now()
  while (true) {
    const currentBoard = await api(`/task/${taskID}/board?sync=1`).then((res) => res.json())
    const status = String(currentBoard?.task?.status ?? "")
    const goalCount = Array.isArray(currentBoard?.goalWorkflows) ? currentBoard.goalWorkflows.length : 0
    const contractCount = typeof currentBoard?.architect?.contractCount === "number"
      ? currentBoard.architect.contractCount
      : null
    const signature = JSON.stringify({
      status,
      goalCount,
      contractCount,
      hasArchitect: !!currentBoard?.architect,
    })
    if (signature !== lastSignature) {
      lastSignature = signature
      lastChangeAt = Date.now()
      activityLine(
        `[overlay-benchmark] architect-check status=${status || "unknown"} goals=${goalCount} contracts=${contractCount ?? "unknown"}`,
      )
    }
    if (currentBoard?.architect && goalCount >= 2) return currentBoard
    if (FINAL.has(status)) return currentBoard
    await Bun.sleep(2_000)
  }
}

function progressSignature(progress: any) {
  return JSON.stringify({
    task: progress?.task?.status || "",
    run: progress?.run?.status || progress?.activeRun?.status || "",
    phase: progress?.run?.phase || progress?.activeRun?.phase || "",
    retry_count: progress?.run?.retryCount ?? progress?.activeRun?.retryCount ?? 0,
    verdict: progress?.evaluation?.verdict || "",
    delivery: progress?.delivery?.status || "",
    goals: Array.isArray(progress?.goals)
      ? progress.goals.map((item: any) => `${item.id || "goal"}:${item.status || ""}`)
      : [],
    pending: Array.isArray(progress?.pendingInteractions)
      ? progress.pendingInteractions.map((item: any) => `${item.id || "interaction"}:${item.type || ""}:${item.status || ""}`)
      : [],
    // Pre-plan sessions (requirements / architect / fidelity / design-analyst)
    // surface here so the signature evolves while goals is still empty —
    // keeps progress_age_ms moving during the architect phase.
    sessions: Array.isArray(progress?.activeSessions)
      ? progress.activeSessions.map((item: any) => `${item.kind || "?"}:${item.sessionID || ""}`)
      : [],
  })
}

async function waitForPlanningVisible(
  page: Page,
  api: (pathname: string, init?: RequestInit) => Promise<Response>,
) {
  while (true) {
    const overlay = await overlaySnapshot(page)
    if (overlay.pendingCount > 0 || overlay.selectedTaskID || overlay.taskIDs[0]) return overlay
    const board = await api("/tasks").then((res) => res.json()).catch(() => null)
    const taskID = Array.isArray(board?.tasks) ? board.tasks[0]?.task?.id || "" : ""
    if (taskID) return { ...overlay, taskIDs: [taskID, ...overlay.taskIDs].filter(Boolean).slice(0, 5) }
    await Bun.sleep(250)
  }
}

async function waitForStreamingVisible(page: Page) {
  while (true) {
    const overlay = await overlaySnapshot(page)
    if (meaningfulLiveText(overlay.reasoning)) return overlay
    if (meaningfulLiveText(overlay.assistantText)) return overlay
    if (meaningfulLiveText(overlay.liveText)) return overlay
    await Bun.sleep(250)
  }
}

async function waitForTaskCreated(page: Page, api: (pathname: string, init?: RequestInit) => Promise<Response>) {
  while (true) {
    const overlay = await overlaySnapshot(page)
    if (overlay.selectedTaskID) return overlay.selectedTaskID
    if (overlay.taskIDs[0]) return overlay.taskIDs[0]
    const board = await api("/tasks").then((res) => res.json()).catch(() => null)
    const taskID = Array.isArray(board?.tasks) ? board.tasks[0]?.task?.id || "" : ""
    if (taskID) return taskID
    await Bun.sleep(1_000)
  }
}

async function verifyResume(
  browser: Awaited<ReturnType<typeof launchBrowser>>,
  current: Page,
  serverUrl: string,
  taskID: string,
  directory: string,
  api: (pathname: string, init?: RequestInit) => Promise<Response>,
) {
  const next = await browser.newPage()
  await next.setViewport({ width: 1600, height: 1200 })
  await next.evaluateOnNewDocument((origin, dir, id) => {
    localStorage.setItem("oc_server_url", origin)
    localStorage.setItem("oc_auto_server", "false")
    localStorage.setItem("oc_directory", dir)
    localStorage.setItem("oc_directory_mode", "custom")
    localStorage.setItem("oc_workspace_directory", dir)
    localStorage.setItem("oc_workspace_task", id)
    localStorage.setItem("oc_auto_question", "true")
  }, serverUrl, directory, taskID)
  await next.goto(new URL("/ui/index.html", serverUrl).toString(), { waitUntil: "load" })
  await next.waitForFunction(() => typeof (window as OverlayBenchmarkWindow).applyDirectory === "function", { timeout: 0 })
  await syncDirectory(next, directory)
  await api("/global/health")
  await waitForTaskCreated(next, api)
  await next.evaluate(async (id) => {
    const overlay = window as OverlayBenchmarkWindow
    if (overlay.boardStore.selectedTaskID === id && overlay.boardStore.board?.task?.id === id) return
    await overlay.selectTask(id)
  }, taskID)
  await next.waitForFunction((id, dir) => {
    const overlay = window as OverlayBenchmarkWindow
    return overlay.settingsStore.directory === dir
      && overlay.boardStore.board?.task?.id === id
      && overlay.settingsStore.workspaceTaskID === id
  }, { timeout: 0 }, taskID, directory)
  await next.evaluate(async () => {
    const overlay = window as OverlayBenchmarkWindow
    await overlay.persistOverlaySettings()
    if (!overlay.boardStore.board?.task?.id) await overlay.loadBoard()
    await overlay.loadConversation()
  })
  await current.close().catch(() => undefined)
  return next
}

// Pick a non-cancel option label, preferring the longest-living approval
// ("Allow for this session") so subsequent same-tool calls don't re-prompt.
// Mirrors codex's mcp_tool_call_approval option set
// {Allow, Allow for this session, Cancel} — confirmed via
// `codex app-server generate-ts` output (v2/ToolRequestUserInputOption).
function pickOptionLabel(options: Array<{ label?: unknown }>): string | undefined {
  const labels = options
    .map((opt) => (typeof opt?.label === "string" ? opt.label.trim() : ""))
    .filter((label): label is string => label.length > 0)
  if (labels.length === 0) return undefined
  const allowed = labels.filter((label) => !/^(cancel|reject|deny|no|stop|abort|decline)$/i.test(label))
  if (allowed.length === 0) return labels[0]
  const session = allowed.find((label) => /for this session|always/i.test(label))
  return session ?? allowed[0]
}

// Build a positional answers array for a question interaction whose questions
// carry inline options (codex 0.125 elicitations like mcp_tool_call_approval).
// Returns undefined when ANY question is free-text — caller falls back to
// AUTO_REPLY in that case.
//
// Server schema (engine/model.ts ReplyInteractionInput): `answers: string[][]`
// where outer index is the question position and inner is the answer list for
// that question. The server then hands `answers[i]` to the host's
// externalAnswerContent which keys it on `event.questions[i].id` before
// re-wrapping into codex's ToolRequestUserInputResponse shape — so the
// benchmark MUST send the positional array, NOT a record.
//
// Earlier bench logs showed HTTP 400 from `/interaction/.../reply` because we
// posted `{ answers: { [id]: ["label"] } }` which violated the `z.array(...)`
// schema check (caught on _session-20260429-005130.out at 17:06:49).
function pickOptionAnswers(item: { payload?: unknown }): string[][] | undefined {
  const payload = item.payload && typeof item.payload === "object" ? (item.payload as { questions?: unknown }) : undefined
  const questions = Array.isArray(payload?.questions) ? payload.questions : []
  if (questions.length === 0) return undefined
  const out: string[][] = []
  for (const raw of questions) {
    if (!raw || typeof raw !== "object") return undefined
    const q = raw as { options?: unknown }
    const options = Array.isArray(q.options) ? (q.options as Array<{ label?: unknown }>) : []
    if (options.length === 0) return undefined  // free-text — caller falls back to AUTO_REPLY
    const label = pickOptionLabel(options)
    if (!label) return undefined
    out.push([label])
  }
  return out.length > 0 ? out : undefined
}

async function settle(progress: any, api: (pathname: string, init?: RequestInit) => Promise<Response>) {
  const pending = Array.isArray(progress?.pendingInteractions)
    ? progress.pendingInteractions.filter((item: { status: string }) => item.status === "pending")
    : []
  for (const item of pending) {
    if (item.type === "permission") {
      // ReplyInteractionInput.autoReply is non-optional per engine/model.ts;
      // omitting it was the silent cause of HTTP 400 on benchmark reply that
      // turned every clarification gate into an abort.
      await api(`/interaction/${item.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoReply: true, reply: "always" }),
      })
      continue
    }
    // Question interactions with fixed options (e.g. codex 0.125 emits
    // `mcp_tool_call_approval` elicitations with
    // `options: [{label:"Allow"},{label:"Allow for this session"},{label:"Cancel"}]`).
    // Free-text AUTO_REPLY falls outside the option set — codex treats
    // unrecognized text as Cancel and the MCP tool never produces a
    // tool_result, surfacing as `tool_call ... ended without a matching
    // tool_result` in the build agent. Caught on _session-20260429-002531.out.
    // Send a structured answers map so the server's interaction reply path
    // forwards a real label back to codex.
    const answers = pickOptionAnswers(item)
    if (answers) {
      await api(`/interaction/${item.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoReply: true, answers }),
      })
      continue
    }
    // Free-text question: server falls back to `answersFromMessage(message)`
    // when `answers` isn't provided.
    await api(`/interaction/${item.id}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ autoReply: true, message: AUTO_REPLY }),
    })
  }
  if (pending.length === 0) return progress
  return api(`/task/${progress.task.id}/progress`).then((res) => res.json())
}

async function syncDirectory(page: Page, directory: string) {
  return page.evaluate(async (dir) => {
    localStorage.setItem("oc_directory", dir)
    localStorage.setItem("oc_directory_mode", "custom")
    localStorage.setItem("oc_workspace_directory", dir)
    const overlay = window as OverlayBenchmarkWindow
    await overlay.applyDirectory(dir, { save: true, temp: false, restoreWorkspace: false })
    await overlay.loadTasks()
    return {
      directory: overlay.settingsStore.directory,
      savedDirectory: overlay.settingsStore.savedDirectory,
      workspaceDirectory: overlay.settingsStore.workspaceDirectory,
    }
  }, directory)
}

async function overlaySnapshot(page: Page) {
  return page.evaluate(() => {
    const overlay = window as OverlayBenchmarkWindow
    // Overlay conversation cards are rendered as `<article class="card" data-kind=...
    // data-role=... data-stage=... data-depth="N">` via components/Card.tsx. Top-level
    // items live at data-depth="0". Text for assistant/agent/goal/tool streams lives
    // inside `.card__body` using `.msg-text` / `.reasoning-text` classes from CardParts
    // and ReasoningPart. User-message cards carry data-role="user" and are excluded.
    const visibleTurns = [...document.querySelectorAll<HTMLElement>('.card[data-depth="0"]')]
      .map((element) => {
        const role = element.dataset.role || element.dataset.kind || ""
        const body = element.querySelector(".card__body")
        const text = body?.querySelector(".msg-text")?.textContent?.trim()
          || body?.querySelector(".reasoning-text")?.textContent?.trim()
          || element.querySelector(".card__goal-desc")?.textContent?.trim()
          || body?.textContent?.trim().slice(0, 200)
          || element.querySelector(".card__title")?.textContent?.trim()
          || ""
        return { role, text }
      })
      .filter((item) => item.role && item.role !== "user" && item.text)
    const liveTurn = visibleTurns.at(-1) || { role: "", text: "" }
    const storage = {
      directory: localStorage.getItem("oc_directory") || "",
      directoryMode: localStorage.getItem("oc_directory_mode") || "",
      workspaceDirectory: localStorage.getItem("oc_workspace_directory") || "",
      workspaceTaskID: localStorage.getItem("oc_workspace_task") || "",
    }
    const firstText = (sel: string) =>
      document.querySelector(sel)?.textContent?.trim() || ""
    return {
      directory: overlay.settingsStore.directory || "",
      savedDirectory: overlay.settingsStore.savedDirectory || "",
      workspaceDirectory: overlay.settingsStore.workspaceDirectory || "",
      selectedTaskID: overlay.boardStore.selectedTaskID || "",
      pendingCount: Array.isArray(overlay.boardStore.pendingTasks) ? overlay.boardStore.pendingTasks.length : 0,
      taskIDs: Array.isArray(overlay.boardStore.tasks)
        ? overlay.boardStore.tasks.map((item: { task?: { id?: string } }) => item?.task?.id || "").filter(Boolean).slice(0, 5)
        : [],
      taskList: document.querySelector("#taskListPanel")?.textContent?.trim() || "",
      reasoning: firstText('.card[data-role="assistant"] .reasoning-text')
        || firstText('.card[data-kind="agent"] .reasoning-text')
        || firstText('.card[data-kind="goal"] .reasoning-text')
        || firstText('.card[data-depth="0"] .reasoning-text'),
      assistantText: firstText('.card[data-role="assistant"] .msg-text')
        || firstText('.card[data-kind="agent"] .msg-text')
        || firstText('.card[data-kind="goal"] .msg-text')
        || firstText('.card[data-kind="tool"] .msg-text')
        || firstText('.card[data-depth="0"]:not([data-role="user"]) .card__body'),
      liveRole: liveTurn.role,
      liveText: liveTurn.text,
      visibleTurns: visibleTurns.slice(-5),
      storage,
    }
  })
}

function meaningfulLiveText(value: string) {
  const text = String(value || "").trim()
  if (!text) return false
  return !STREAM_PLACEHOLDERS.has(text)
}

function clipText(value: string, max: number) {
  if (!value) return ""
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`
}

function summarizeEvents(events: Array<Record<string, unknown>>, taskID: string) {
  const filtered = events.filter((item) => !taskID || item.taskID === taskID)
  const agents = filtered.filter((item) => item.type === "orchestrator.agent.updated")
  const runEvents = filtered.filter((item) =>
    item.type === "orchestrator.message.part.updated" ||
    item.type === "orchestrator.message.updated"
  )
  const kinds = filtered.reduce<Record<string, number>>((map, item) => {
    const type = typeof item.type === "string" ? item.type : ""
    if (!type) return map
    map[type] = (map[type] ?? 0) + 1
    return map
  }, {})
  // Include both legacy stage names (spec, planner) and new agent names (task, decompose, eval, architect)
  const stages = ["spec", "planner", "evaluator", "task", "decompose", "eval", "architect"].flatMap((stage) => {
    const list = agents.filter((item) => item.stage === stage)
    if (list.length === 0) return []
    const toolCalls = list
      .filter((item) => item.kind === "tool_call")
      .reduce<Record<string, number>>((map, item) => {
        const name = typeof item.toolName === "string" ? item.toolName : ""
        if (!name) return map
        map[name] = (map[name] ?? 0) + 1
        return map
      }, {})
    const byKind = list.reduce<Record<string, number>>((map, item) => {
      const kind = typeof item.kind === "string" ? item.kind : ""
      if (!kind) return map
      map[kind] = (map[kind] ?? 0) + 1
      return map
    }, {})
    return [[stage, {
      event_count: list.length,
      first_event_ms: list[0]?.elapsed_ms ?? null,
      first_message_ms: list.find((item) => item.kind === "message_delta")?.elapsed_ms ?? null,
      first_tool_call_ms: list.find((item) => item.kind === "tool_call")?.elapsed_ms ?? null,
      first_tool_result_ms: list.find((item) => item.kind === "tool_result")?.elapsed_ms ?? null,
      submit_tool_ms: list.find((item) => item.kind === "tool_call" && (item.toolName === "submit_spec" || item.toolName === "submit_plan" || item.toolName === "submit_analysis"))?.elapsed_ms ?? null,
      error_ms: list.find((item) => item.kind === "error")?.elapsed_ms ?? null,
      last_event_ms: list.at(-1)?.elapsed_ms ?? null,
      kind_counts: byKind,
      tool_calls: toolCalls,
    }]]
  })
  const execution = runEvents.length === 0
    ? []
    : [["execution", {
        event_count: runEvents.length,
        first_event_ms: runEvents[0]?.elapsed_ms ?? null,
        first_progress_ms: runEvents.find((item) => item.type === "orchestrator.run.progress")?.elapsed_ms ?? null,
        first_output_ms: runEvents.find((item) => item.type === "orchestrator.run.output")?.elapsed_ms ?? null,
        last_event_ms: runEvents.at(-1)?.elapsed_ms ?? null,
        types: runEvents.reduce<Record<string, number>>((map, item) => {
          const type = typeof item.type === "string" ? item.type : ""
          if (!type) return map
          map[type] = (map[type] ?? 0) + 1
          return map
        }, {}),
        progress_types: runEvents.reduce<Record<string, number>>((map, item) => {
          const type = typeof item.progressType === "string" ? item.progressType : ""
          if (!type) return map
          map[type] = (map[type] ?? 0) + 1
          return map
        }, {}),
        goal_runs: [...new Set(runEvents.flatMap((item) => typeof item.goalRunID === "string" && item.goalRunID ? [item.goalRunID] : []))],
      }]]
  return {
    types: kinds,
    stages: Object.fromEntries([...stages, ...execution]),
  }
}

async function debugSnapshot(page: Page, api: (pathname: string, init?: RequestInit) => Promise<Response>) {
  const overlay = await overlaySnapshot(page).catch((error) => ({ error: String(error) }))
  const tasks = await api("/tasks")
    .then((res) => res.json())
    .then((data) =>
      Array.isArray(data?.tasks)
        ? data.tasks.map((item: { task?: { id?: string; status?: string } }) => ({
            id: item?.task?.id || "",
            status: item?.task?.status || "",
          }))
        : data,
    )
    .catch((error) => ({ error: String(error) }))
  return {
    overlay,
    tasks,
  }
}
