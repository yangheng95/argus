#!/usr/bin/env bun

import { mkdtempSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import puppeteer, { type Page } from "puppeteer-core"
import { ExecutorBootstrap } from "../../src/executor/bootstrap"
import { OrchestratorService } from "../../src/orchestrator/service"
import { Instance } from "../../src/project/instance"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { Provider } from "../../src/provider/provider"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../../test/fixture/db"
import { dashscopeCodingKey, env, loadBenchmarkEnv, prepareDashscopeEnv } from "./env"

Log.init({ print: true })

const timeoutMs = Number(process.argv.find((item) => item.startsWith("--timeout-ms="))?.split("=")[1]) || 20 * 60 * 1000
const report = process.argv.find((item) => item.startsWith("--report="))?.slice("--report=".length)
const keep = process.argv.includes("--keep")
const headless = !process.argv.includes("--headed")
const executor = (process.argv.find((item) => item.startsWith("--executor="))?.split("=")[1] || "opencode") as
  | "opencode"
  | "codex"
  | "claude-code"

const TASK_TITLE = "Overlay Web Benchmark NoteStore"
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

- Bun runtime、bun:test 和 crypto.randomUUID() 已可直接使用，不需要补环境
- 可以自由组织项目并新增必要文件，只要最终交付合理、可运行、易于理解
- 运行 \`bun test src/note-store.test.ts\` 必须通过
`.trim()

const PANEL_REQUEST = `请创建一个新任务并立即开始执行以下工作：\n\n${TASK_REQUEST}`

const AUTO_REPLY =
  "Complete the task autonomously end-to-end. Choose reasonable defaults consistent with the request, keep scope minimal, continue execution, and do not ask again unless the request is contradictory or unsafe."

const FINAL = new Set(["completed", "failed", "cancelled"])
const TASK_CREATE_TIMEOUT_MS = 4 * 60 * 1000
const TASK_RESUME_TIMEOUT_MS = 4 * 60 * 1000
const temp = {
  dir: "",
  home: "",
}

await loadBenchmarkEnv(import.meta.dir)
prepareDashscopeEnv()
const model = await resolveModel()
await ensureLiveModel(model)

temp.home = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-overlay-benchmark-home-"))
temp.dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-overlay-benchmark-project-"))
process.env.OPENCORVUS_HOME = temp.home
process.env.OPENCORVUS_AUTO_DISCOVER_EXECUTORS = "1"
process.env.OPENCORVUS_EXECUTOR_CLAUDE_PERMISSION_MODE = "bypassPermissions"

await resetDatabase()
await scaffoldProject(temp.dir, model)

await Instance.provide({
  directory: temp.dir,
  init: InstanceBootstrap,
  fn: async () => {
    await ExecutorBootstrap.autoRegister(true)
  },
})

const server = Server.listen({ port: 0, hostname: "127.0.0.1" })
const browser = await launchBrowser(headless)
let page = await browser.newPage()
await page.setViewport({ width: 1600, height: 1200 })

const marks = {
  startedAt: Date.now(),
  onlineAt: 0,
  submittedAt: 0,
  selectedAt: 0,
  boardAt: 0,
  resumedAt: 0,
  completedAt: 0,
}
let taskID = ""

const api = async (pathname: string, init?: RequestInit) => {
  const url = new URL(pathname, server.url)
  url.searchParams.set("directory", temp.dir)
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.pathname}`)
  return res
}

try {
  await page.evaluateOnNewDocument((serverUrl, directory) => {
    localStorage.setItem("oc_server_url", serverUrl)
    localStorage.setItem("oc_auto_server", "false")
    localStorage.setItem("oc_directory", directory)
    localStorage.setItem("oc_directory_mode", "custom")
    localStorage.setItem("oc_workspace_directory", directory)
    localStorage.setItem("oc_unattended", "true")
    localStorage.setItem("oc_auto_permission", "true")
    localStorage.setItem("oc_auto_question", "true")
  }, server.url.origin, temp.dir)

  await page.goto(new URL("/ui/index.html", server.url).toString(), { waitUntil: "load" })
  await page.waitForFunction(() => document.querySelector("#connBadge")?.dataset.status === "online", { timeout: 60_000 })
  marks.onlineAt = Date.now()
  const overlay = await syncDirectory(page, temp.dir)
  console.log(`[overlay-benchmark] directory=${overlay.directory} saved=${overlay.savedDirectory}`)

  await page.$eval("#chatTextarea", (node, value) => {
    const input = node as HTMLTextAreaElement
    input.value = String(value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  }, PANEL_REQUEST)
  marks.submittedAt = Date.now()
  await page.click("#chatSend")

  taskID = await waitForTaskCreated(page, api)
  await page.evaluate(async (id) => {
    const state = window.eval("state")
    if (state.selectedTaskID === id) return
    await window.eval("loadTasks")()
    await window.eval("selectTask")(id)
  }, taskID)
  await page.waitForFunction((id) => {
    try {
      return window.eval("state").selectedTaskID === id
    } catch {
      return false
    }
  }, { timeout: 120_000 }, taskID)
  marks.selectedAt = Date.now()

  await page.waitForFunction(() => {
    try {
      return !!window.eval("state").board?.task?.id
    } catch {
      return false
    }
  }, { timeout: 120_000 })
  marks.boardAt = Date.now()
  page = await verifyResume(browser, page, server.url.origin, taskID, temp.dir)
  marks.resumedAt = Date.now()

  let progress = await waitForFinal(taskID, timeoutMs, api)
  marks.completedAt = Date.now()

  const transcript = await api(`/task/${taskID}/transcript`).then((res) => res.json())
  const timeline = await api(`/control/timeline?taskID=${encodeURIComponent(taskID)}`).then((res) => res.json())
  const runs = await api(`/task/${taskID}/runs`).then((res) => res.json())

  const localTest = await Bun.spawn(["bun", "test", "src/note-store.test.ts"], {
    cwd: temp.dir,
    stdout: "pipe",
    stderr: "pipe",
  })
  const localStdout = await new Response(localTest.stdout).text()
  const localStderr = await new Response(localTest.stderr).text()
  const localExit = await localTest.exited

  const screenshot = path.join(process.cwd(), `overlay-web-benchmark-${Date.now()}.png`)
  await page.screenshot({ path: screenshot, fullPage: true })

  const out = {
    generated_at: new Date().toISOString(),
    executor,
    model,
    directory: temp.dir,
    server: server.url.toString(),
    taskID,
    taskStatus: progress.task.status,
    evaluation: progress.evaluation?.verdict,
    changedFiles: progress.delivery?.result?.changedFiles ?? [],
    transcriptCount: Array.isArray(transcript) ? transcript.length : 0,
    timelineCount: Array.isArray(timeline) ? timeline.length : 0,
    runCount: Array.isArray(runs) ? runs.length : 0,
    screenshot,
    resume: {
      restored: marks.resumedAt > 0,
      selectedAt: marks.resumedAt ? marks.resumedAt - marks.startedAt : null,
    },
    timings_ms: {
      online: marks.onlineAt - marks.startedAt,
      submit: marks.submittedAt - marks.startedAt,
      task_selected: marks.selectedAt - marks.startedAt,
      board_loaded: marks.boardAt - marks.startedAt,
      resumed: marks.resumedAt - marks.startedAt,
      completed: marks.completedAt - marks.startedAt,
      execution: marks.completedAt - marks.submittedAt,
    },
    local_verify: {
      exitCode: localExit,
      stdout: localStdout.trim(),
      stderr: localStderr.trim(),
    },
  }

  const file = report || path.join(process.cwd(), `overlay-web-benchmark-report-${Date.now()}.json`)
  await Bun.write(file, JSON.stringify(out, null, 2))
  console.log(JSON.stringify(out, null, 2))
  console.log(`report: ${file}`)

  if (progress.task.status !== "completed" || progress.evaluation?.verdict !== "accepted" || localExit !== 0) {
    process.exit(1)
  }
} catch (error) {
  const file = report || path.join(process.cwd(), `overlay-web-benchmark-report-${Date.now()}.json`)
  const out = {
    generated_at: new Date().toISOString(),
    executor,
    model,
    directory: temp.dir,
    server: server.url.toString(),
    taskID,
    error: String(error),
    timings_ms: {
      online: marks.onlineAt ? marks.onlineAt - marks.startedAt : null,
      submit: marks.submittedAt ? marks.submittedAt - marks.startedAt : null,
      task_selected: marks.selectedAt ? marks.selectedAt - marks.startedAt : null,
      board_loaded: marks.boardAt ? marks.boardAt - marks.startedAt : null,
      resumed: marks.resumedAt ? marks.resumedAt - marks.startedAt : null,
      completed: marks.completedAt ? marks.completedAt - marks.startedAt : null,
      execution: marks.submittedAt && marks.completedAt ? marks.completedAt - marks.submittedAt : null,
    },
    overlay: await overlaySnapshot(page).catch((cause) => ({ error: String(cause) })),
  }
  await Bun.write(file, JSON.stringify(out, null, 2))
  console.error(JSON.stringify(out, null, 2))
  console.error(`report: ${file}`)
  process.exitCode = 1
} finally {
  await page.close().catch(() => undefined)
  await browser.close().catch(() => undefined)
  await server.stop(true)
  await Instance.disposeAll().catch(() => undefined)
  if (!keep && temp.dir) await fs.rm(temp.dir, { recursive: true, force: true }).catch(() => undefined)
  if (!keep && temp.home) await fs.rm(temp.home, { recursive: true, force: true }).catch(() => undefined)
}

async function resolveModel() {
  return Instance.provide({
    directory: path.resolve(import.meta.dir, "../../.."),
    fn: async () => {
      const providers = await Provider.list()
      const explicit = env("OPENCORVUS_E2E_MODEL")
      if (explicit) {
        if (explicit.includes("/")) return explicit
        const preferred = ["alibaba-cn", "google", "deepseek", "gitlab", "moonshotai-cn", "moonshotai", "huggingface", "github-copilot"]
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
        const [entry] = Provider.sort(Object.values(provider.models))
        if (entry) return `${providerID}/${entry.id}`
      }

      const fallback = await Provider.defaultModel()
      if (fallback.providerID !== "github-copilot") return `${fallback.providerID}/${fallback.modelID}`
      for (const provider of Object.values(providers)) {
        if (provider.id === "github-copilot" || provider.id === "openai-codex") continue
        const [entry] = Provider.sort(Object.values(provider.models))
        if (entry) return `${provider.id}/${entry.id}`
      }
      return `${fallback.providerID}/${fallback.modelID}`
    },
  })
}

async function ensureLiveModel(model: string) {
  await Instance.provide({
    directory: path.resolve(import.meta.dir, "../../.."),
    fn: async () => {
      const parsed = Provider.parseModel(model)
      const resolved = await Provider.getModel(parsed.providerID, parsed.modelID)
      await Provider.getLanguage(resolved)
    },
  })
}

async function scaffoldProject(dir: string, model: string) {
  await fs.mkdir(path.join(dir, "src"), { recursive: true })
  await fs.mkdir(path.join(dir, ".opencorvus"), { recursive: true })
  const providerID = model.split("/")[0] || "openai"
  const config = JSON.stringify(
    {
      $schema: "https://opencorvus.ai/config.json",
      model,
      experimental: {
        unattended: true,
      },
      provider: {
        [providerID]: {
          options: {
            timeout: 300000,
          },
        },
      },
    },
    null,
    2,
  )
  await Bun.write(path.join(dir, "opencorvus.json"), config)
  await Bun.write(path.join(dir, ".opencorvus", "opencorvus.json"), config)
}

async function launchBrowser(headless: boolean) {
  const executablePath = await findBrowser()
  return puppeteer.launch({
    executablePath,
    headless: headless ? "new" : false,
    userDataDir: mkdtempSync(path.join(os.tmpdir(), "pptr-overlay-web-benchmark-")),
    args: ["--no-sandbox", "--no-first-run", "--no-default-browser-check"],
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

async function waitForFinal(taskID: string, timeoutMs: number, api: (pathname: string, init?: RequestInit) => Promise<Response>) {
  const startedAt = Date.now()
  let last = ""
  while (Date.now() - startedAt < timeoutMs) {
    let progress = await api(`/task/${taskID}/progress`).then((res) => res.json())
    progress = await settle(progress, api)
    if (FINAL.has(progress.task.status)) return progress
    if (progress.task.status !== last) {
      last = progress.task.status
      console.log(`[overlay-benchmark] status=${last}`)
    }
    await Bun.sleep(2_000)
  }
  throw new Error(`Task did not finish within ${timeoutMs}ms`)
}

async function waitForTaskCreated(page: Page, api: (pathname: string, init?: RequestInit) => Promise<Response>) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < TASK_CREATE_TIMEOUT_MS) {
    const overlay = await overlaySnapshot(page)
    if (overlay.selectedTaskID) return overlay.selectedTaskID
    if (overlay.taskIDs[0]) return overlay.taskIDs[0]
    const board = await api("/tasks").then((res) => res.json()).catch(() => null)
    const taskID = Array.isArray(board?.tasks) ? board.tasks[0]?.task?.id || "" : ""
    if (taskID) return taskID
    await Bun.sleep(1_000)
  }
  throw new Error(`Overlay did not create a task within ${TASK_CREATE_TIMEOUT_MS}ms: ${JSON.stringify(await debugSnapshot(page, api))}`)
}

async function verifyResume(browser: Awaited<ReturnType<typeof launchBrowser>>, current: Page, serverUrl: string, taskID: string, directory: string) {
  const next = await browser.newPage()
  await next.setViewport({ width: 1600, height: 1200 })
  await next.evaluateOnNewDocument((origin, dir, id) => {
    localStorage.setItem("oc_server_url", origin)
    localStorage.setItem("oc_auto_server", "false")
    localStorage.setItem("oc_directory", dir)
    localStorage.setItem("oc_directory_mode", "custom")
    localStorage.setItem("oc_workspace_directory", dir)
    localStorage.setItem("oc_workspace_task", id)
    localStorage.setItem("oc_unattended", "true")
    localStorage.setItem("oc_auto_permission", "true")
    localStorage.setItem("oc_auto_question", "true")
  }, serverUrl, directory, taskID)
  await next.goto(new URL("/ui/index.html", serverUrl).toString(), { waitUntil: "load" })
  await next.waitForFunction(() => document.querySelector("#connBadge")?.dataset.status === "online", { timeout: 60_000 })
  await next.waitForFunction((id, dir) => {
    try {
      const state = window.eval("state")
      return state.directory === dir && state.selectedTaskID === id && state.workspaceTaskID === id
    } catch {
      return false
    }
  }, { timeout: TASK_RESUME_TIMEOUT_MS }, taskID, directory)
  await next.evaluate(async () => {
    try {
      await window.eval("persistOverlaySettings")()
      if (!window.eval("state").board?.task?.id) await window.eval("loadBoard")()
    } catch {
      return
    }
  })
  await current.close().catch(() => undefined)
  return next
}

async function settle(progress: any, api: (pathname: string, init?: RequestInit) => Promise<Response>) {
  const pending = Array.isArray(progress?.pendingInteractions)
    ? progress.pendingInteractions.filter((item: { status: string }) => item.status === "pending")
    : []
  for (const item of pending) {
    if (item.type === "permission") {
      await api(`/interaction/${item.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reply: "always" }),
      })
      continue
    }
    await api(`/interaction/${item.id}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: AUTO_REPLY }),
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
    await window.eval("applyDirectory")(dir, { save: true, temp: false, restoreWorkspace: false })
    await window.eval("loadTasks")()
    const state = window.eval("state")
    return {
      directory: state.directory,
      savedDirectory: state.savedDirectory,
      workspaceDirectory: state.workspaceDirectory,
    }
  }, directory)
}

async function overlaySnapshot(page: Page) {
  return page.evaluate(() => {
    try {
      const state = window.eval("state")
      const storage = {
        directory: localStorage.getItem("oc_directory") || "",
        directoryMode: localStorage.getItem("oc_directory_mode") || "",
        workspaceDirectory: localStorage.getItem("oc_workspace_directory") || "",
        workspaceTaskID: localStorage.getItem("oc_workspace_task") || "",
      }
      return {
        directory: state.directory || "",
        savedDirectory: state.savedDirectory || "",
        workspaceDirectory: state.workspaceDirectory || "",
        selectedTaskID: state.selectedTaskID || "",
        taskIDs: Array.isArray(state.tasks)
          ? state.tasks.map((item: { task?: { id?: string } }) => item?.task?.id || "").filter(Boolean).slice(0, 5)
          : [],
        storage,
      }
    } catch (error) {
      return {
        directory: "",
        savedDirectory: "",
        workspaceDirectory: "",
        selectedTaskID: "",
        taskIDs: [],
        storage: {},
        error: String(error),
      }
    }
  })
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
