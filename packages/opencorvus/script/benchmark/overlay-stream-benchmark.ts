#!/usr/bin/env bun

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import puppeteer, { type Browser, type Page } from "puppeteer-core"
import { $ } from "bun"
import { ExecutorRegistry } from "../../src/executor/registry"
import type { CodingEventInfo, CodingProvider, CodingResumeInfo, CodingRunInfo } from "../../src/executor/compat"
import { Instance } from "../../src/project/instance"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../../test/fixture/db"

Log.init({ print: true })

const report = process.argv.find((item) => item.startsWith("--report="))?.slice("--report=".length)
const keep = process.argv.includes("--keep")
const headless = !process.argv.includes("--headed")
const timeoutMs = Number(process.argv.find((item) => item.startsWith("--timeout-ms="))?.split("=")[1]) || 480_000
const specTimeoutMs = Number(process.argv.find((item) => item.startsWith("--spec-timeout-ms="))?.split("=")[1]) || Math.max(60_000, Math.min(180_000, Math.floor(timeoutMs * 0.2)))
const plannerTimeoutMs = Number(process.argv.find((item) => item.startsWith("--planner-timeout-ms="))?.split("=")[1]) || Math.max(60_000, Math.min(180_000, Math.floor(timeoutMs * 0.25)))
const BENCHMARK_EXECUTOR = "codex"

function benchmarkRouting() {
  return {
    spec: "executor" as const,
    goal: "opencorvus" as const,
    plan: "executor" as const,
  }
}
const FINAL = new Set(["completed", "failed", "cancelled"])
const TASK_TITLE = "Overlay Parallel Benchmark"
const TASK_REQUEST = `
实现两个相互独立的电商帮助模块，并确保最终测试通过。

- src/catalog.ts: 导出 buildCatalogTitle(name: string)
- src/cart.ts: 导出 formatCartTotal(cents: number)
- 最终运行 bun test ./src/catalog.test.ts ./src/cart.test.ts 必须通过
`.trim()

const GOALS = [
  {
    description: "Create the catalog helper",
    criteria: "Add src/catalog.ts so the catalog test can pass.",
    priority: "advisory" as const,
    metadata: {
      check_selector: ["catalog_test"],
    },
  },
  {
    description: "Create the cart helper",
    criteria: "Add src/cart.ts so the cart test can pass.",
    priority: "advisory" as const,
    metadata: {
      check_selector: ["cart_test"],
    },
  },
]

const temp = {
  dir: "",
  home: "",
}

temp.home = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-overlay-stream-home-"))
temp.dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-overlay-stream-project-"))
process.env.OPENCORVUS_HOME = temp.home
process.env.OPENCORVUS_GOAL_PARALLELISM = "2"
process.env.OPENCORVUS_SPEC_TIMEOUT_MS = String(specTimeoutMs)
process.env.OPENCORVUS_PLANNER_TIMEOUT_MS = String(plannerTimeoutMs)
process.env.OPENCORVUS_SPEC_AGENT_TIMEOUT_MS = String(specTimeoutMs)
process.env.OPENCORVUS_PLANNER_AGENT_TIMEOUT_MS = String(plannerTimeoutMs)

await resetDatabase()
await scaffoldProject(temp.dir)

await Instance.provide({
  directory: temp.dir,
  init: InstanceBootstrap,
  fn: async () => {
    ExecutorRegistry.registerCoding(BENCHMARK_EXECUTOR, benchmarkProvider(), {
      cwd: () => Instance.directory,
      planning: {
        spec: true,
        plan: true,
      },
    })
  },
})

const server = Server.listen({ port: 0, hostname: "127.0.0.1" })
const browser = await launchBrowser(headless)
let page = await browser.newPage()
await page.setViewport({ width: 1600, height: 1200 })

const marks = {
  startedAt: Date.now(),
  onlineAt: 0,
  createdAt: 0,
  listAt: 0,
  selectedAt: 0,
  parallelAt: 0,
  reloadedAt: 0,
  completedAt: 0,
}
let stage = "bootstrap"
const deadline = Date.now() + timeoutMs

const api = async (pathname: string, init?: RequestInit) => {
  const url = new URL(pathname, server.url)
  url.searchParams.set("directory", temp.dir)
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.pathname}`)
  return res
}

try {
  stage = "overlay.bootstrap"
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

  stage = "overlay.open"
  await page.goto(new URL("/ui/index.html", server.url).toString(), { waitUntil: "load" })
  stage = "overlay.online"
  await page.waitForFunction(() => document.querySelector("#connBadge")?.dataset.status === "online", { timeout: remaining(60_000) })
  marks.onlineAt = Date.now()
  stage = "overlay.directory"
  await syncDirectory(page, temp.dir)

  stage = "task.create"
  const taskID = await api("/task", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      title: TASK_TITLE,
      request: TASK_REQUEST,
      executor: BENCHMARK_EXECUTOR,
      routing: benchmarkRouting(),
      checks: {
        build: false,
        test: false,
        lint: false,
        verify_cmd: false,
        named: {
          catalog_test: {
            label: "Catalog Goal Test",
            family: "test",
            commands: ["bun test ./src/catalog.test.ts"],
          },
          cart_test: {
            label: "Cart Goal Test",
            family: "test",
            commands: ["bun test ./src/cart.test.ts"],
          },
          final_suite: {
            label: "Final Delivery Test",
            family: "verify_cmd",
            commands: ["bun test ./src/catalog.test.ts ./src/cart.test.ts"],
          },
        },
        spec_check: {
          enabled: false,
        },
      },
      goals: GOALS,
    }),
  })
    .then((res) => res.json())
    .then((body) => String(body.task_id || ""))
  if (!taskID) throw new Error("task creation did not return task_id")
  marks.createdAt = Date.now()
  stage = "task.list"
  await waitForTaskList(page, taskID, deadline)
  marks.listAt = Date.now()

  stage = "task.select"
  await page.evaluate(async (id) => {
    await window.eval("selectTask")(id)
  }, taskID)
  stage = "task.selected"
  await page.waitForFunction((id) => {
    try {
      const state = window.eval("state")
      return state.selectedTaskID === id && state.board?.task?.id === id
    } catch {
      return false
    }
  }, { timeout: remaining(60_000) }, taskID)
  marks.selectedAt = Date.now()

  stage = "task.parallel"
  const parallel = await waitForParallelStart(taskID, api, deadline)
  marks.parallelAt = Date.now()

  stage = "overlay.live"
  const early = await waitForOverlayLive(page, deadline)
  await Bun.sleep(700)
  const mid = await overlaySnapshot(page)

  stage = "overlay.resume"
  page = await verifyResume(browser, page, server.url.origin, taskID, temp.dir, deadline)
  marks.reloadedAt = Date.now()
  const resumed = await waitForOverlayResume(page, deadline)

  stage = "task.final"
  const progress = await waitForFinal(taskID, deadline, api)
  marks.completedAt = Date.now()

  stage = "delivery.verify"
  const local = await Bun.spawn(["bun", "test", "./src/catalog.test.ts", "./src/cart.test.ts"], {
    cwd: temp.dir,
    stdout: "pipe",
    stderr: "pipe",
  })
  const localStdout = await new Response(local.stdout).text()
  const localStderr = await new Response(local.stderr).text()
  const localExit = await local.exited

  const growth = {
    reasoning: textSize(mid.reasoning) > textSize(early.reasoning),
    assistant: textSize(mid.assistant) > textSize(early.assistant),
    progress: totalProgress(mid.processes) > totalProgress(early.processes),
    output: totalOutput(mid.processes) > totalOutput(early.processes),
  }
  const parallelUI = {
    earlyCount: early.processes.length,
    resumedCount: resumed.processes.length,
    earlyDistinctTitles: new Set(early.processes.map((item) => item.title)).size >= 2,
    resumedDistinctTitles: new Set(resumed.processes.map((item) => item.title)).size >= 2,
  }
  const delivery = {
    taskStatus: progress.task.status,
    verdict: progress.evaluation?.verdict || "",
    localExit,
  }

  const out = {
    generated_at: new Date().toISOString(),
    directory: temp.dir,
    server: server.url.toString(),
    taskID,
    taskStatus: progress.task.status,
    evaluation: progress.evaluation?.verdict,
    changedFiles: progress.delivery?.result?.changedFiles ?? [],
    timings_ms: {
      online: marks.onlineAt - marks.startedAt,
      created: marks.createdAt - marks.startedAt,
      listed: marks.listAt - marks.startedAt,
      selected: marks.selectedAt - marks.startedAt,
      parallel: marks.parallelAt - marks.startedAt,
      reloaded: marks.reloadedAt - marks.startedAt,
      completed: marks.completedAt - marks.startedAt,
    },
    assertions: {
      parallel_dispatch: {
        pass: parallel.active >= 2 && parallel.completedBeforeParallel === 0,
        sample: parallel,
      },
      streaming_growth: {
        pass: Object.values(growth).some(Boolean),
        sample: growth,
        early,
        mid,
      },
      resume_history: {
        pass: resumed.processes.length >= 2 && textSize(resumed.reasoning) > 0 && totalOutput(resumed.processes) > 0,
        resumed,
      },
      parallel_progress: {
        pass: parallelUI.earlyCount >= 2 && parallelUI.resumedCount >= 2 && parallelUI.earlyDistinctTitles && parallelUI.resumedDistinctTitles,
        sample: parallelUI,
      },
      delivery: {
        pass: delivery.taskStatus === "completed" && delivery.verdict === "accepted" && delivery.localExit === 0,
        sample: delivery,
      },
    },
    local_verify: {
      exitCode: localExit,
      stdout: localStdout.trim(),
      stderr: localStderr.trim(),
    },
  }

  const file = report || path.join(process.cwd(), `overlay-stream-benchmark-report-${Date.now()}.json`)
  await Bun.write(file, JSON.stringify(out, null, 2))
  console.log(JSON.stringify(out, null, 2))
  console.log(`report: ${file}`)

  if (!Object.values(out.assertions).every((item) => item.pass)) {
    process.exitCode = 1
  }
} catch (error) {
  const file = report || path.join(process.cwd(), `overlay-stream-benchmark-report-${Date.now()}.json`)
  const out = {
    generated_at: new Date().toISOString(),
    directory: temp.dir,
    server: server.url.toString(),
    stage,
    error: String(error),
    stack: error instanceof Error ? error.stack || "" : "",
    overlay: await overlaySnapshot(page).catch((cause) => ({ error: String(cause) })),
  }
  await Bun.write(file, JSON.stringify(out, null, 2))
  console.error(JSON.stringify(out, null, 2))
  console.error(`report: ${file}`)
  process.exitCode = 1
} finally {
  ExecutorRegistry.reset()
  await cleanup("page.close", () => page.close().catch(() => undefined))
  await cleanup("browser.close", () => browser.close().catch(() => undefined), () => browser.process()?.kill("SIGKILL"))
  await cleanup("server.stop", () => server.stop(true))
  await cleanup("instance.disposeAll", () => Instance.disposeAll().catch(() => undefined))
  if (!keep && temp.dir) await cleanup("temp.dir", () => fs.rm(temp.dir, { recursive: true, force: true }).catch(() => undefined))
  if (!keep && temp.home) await cleanup("temp.home", () => fs.rm(temp.home, { recursive: true, force: true }).catch(() => undefined))
  process.exit(process.exitCode ?? 0)
}

function benchmarkProvider(): CodingProvider {
  const cancelled = new Set<string>()

  const stream = async function* (input: CodingRunInfo | CodingResumeInfo): AsyncIterable<CodingEventInfo> {
    if (input.outputSchema) {
      const output = planningOutput(input.prompt)
      yield {
        type: "text_delta",
        text: output,
      }
      yield {
        type: "done",
        sessionID: `planning-${Date.now()}`,
        output,
      }
      return
    }

    const goal = goalFromPrompt(input.prompt)
    const sessionID = `benchmark-${goal.key}-${Date.now()}`
    yield {
      type: "status",
      status: "running",
      meta: {
        session_id: sessionID,
      },
    }
    await pause(140, input.signal, cancelled, sessionID)
    yield {
      type: "reasoning_delta",
      text: `Inspecting ${goal.title}. `,
    }
    await pause(180, input.signal, cancelled, sessionID)
    yield {
      type: "reasoning_delta",
      text: `Preparing ${goal.file}.`,
    }
    await pause(180, input.signal, cancelled, sessionID)
    yield {
      type: "progress",
      kind: "tool",
      id: "tool_shared",
      status: "running",
      summary: `Starting ${goal.label}`,
      meta: {
        name: goal.label,
      },
    }
    yield {
      type: "text_delta",
      text: `Starting ${goal.label}. `,
    }
    await pause(260, input.signal, cancelled, sessionID)
    yield {
      type: "text_delta",
      text: `Drafting ${goal.file}. `,
    }
    await pause(260, input.signal, cancelled, sessionID)
    await fs.mkdir(path.dirname(path.join(input.cwd || process.cwd(), goal.file)), { recursive: true })
    await fs.writeFile(path.join(input.cwd || process.cwd(), goal.file), goal.body)
    yield {
      type: "progress",
      kind: "tool",
      id: "tool_shared",
      status: "running",
      summary: `Saved ${goal.file}`,
      output: `wrote ${goal.file}`,
      meta: {
        name: goal.label,
      },
    }
    yield {
      type: "text_delta",
      text: `Saved ${goal.file}. `,
    }
    await pause(320, input.signal, cancelled, sessionID)
    yield {
      type: "progress",
      kind: "tool",
      id: "tool_shared",
      status: "completed",
      summary: `Completed ${goal.label}`,
      output: `ok ${goal.file}`,
      meta: {
        name: goal.label,
      },
    }
    yield {
      type: "done",
      sessionID,
      output: `Implemented ${goal.file}`,
    }
  }

  return {
    name: BENCHMARK_EXECUTOR,
    capabilities() {
      return {
        builtinTools: false,
        customTools: false,
        stream: true,
        resume: true,
        interrupt: true,
        cwd: true,
        system: true,
      }
    },
    run(input) {
      return stream(input)
    },
    resume(input) {
      return stream(input)
    },
    async interrupt(sessionID) {
      cancelled.add(sessionID)
      return true
    },
  }
}

function planningOutput(prompt: string) {
  if (prompt.includes("Authoritative specification:")) {
    return JSON.stringify({
      prd: "# Parallel Benchmark Plan\n\nBuild the catalog and cart helpers in parallel and verify the final tests.",
      summary: "Implement the catalog and cart helpers in parallel.",
      subtasks: [
        {
          title: "Catalog helper",
          description: "Create src/catalog.ts for the catalog test.",
          order: 1,
        },
        {
          title: "Cart helper",
          description: "Create src/cart.ts for the cart test.",
          order: 2,
        },
      ],
      risks: [],
      assumptions: [],
      clarifications: [],
    })
  }
  return JSON.stringify({
    summary: "Implement the catalog and cart helpers.",
    content: [
      "# Scope",
      "",
      "Create src/catalog.ts and src/cart.ts so the final Bun tests pass.",
      "",
      "The work is intentionally split into two independent goals for parallel execution.",
    ].join("\n"),
    goals: GOALS,
    assumptions: [],
    risks: [],
    clarifications: [],
  })
}

function goalFromPrompt(prompt: string) {
  const goal = prompt.match(/(?:^|\n)Goal:\s*\n([^\n]+)/i)?.[1]?.trim().toLowerCase() || ""
  if (goal.includes("cart helper")) {
    return {
      key: "cart",
      title: "the cart helper",
      label: "cart_writer",
      file: "src/cart.ts",
      body: [
        "export function formatCartTotal(cents: number) {",
        "  const dollars = (cents / 100).toFixed(2)",
        "  return `$${dollars}`",
        "}",
        "",
      ].join("\n"),
    }
  }
  if (goal.includes("catalog helper")) {
    return {
      key: "catalog",
      title: "the catalog helper",
      label: "catalog_writer",
      file: "src/catalog.ts",
      body: [
        "export function buildCatalogTitle(name: string) {",
        "  const value = name.trim()",
        "  if (!value) return \"Catalog Item\"",
        "  return `${value[0]?.toUpperCase() || \"\"}${value.slice(1)} • 1 item`",
        "}",
        "",
      ].join("\n"),
    }
  }
  return {
    key: "catalog",
    title: "the catalog helper",
    label: "catalog_writer",
    file: "src/catalog.ts",
    body: [
      "export function buildCatalogTitle(name: string) {",
      "  const value = name.trim()",
      "  if (!value) return \"Catalog Item\"",
      "  return `${value[0]?.toUpperCase() || \"\"}${value.slice(1)} • 1 item`",
      "}",
      "",
    ].join("\n"),
  }
}

async function pause(ms: number, signal: AbortSignal | undefined, cancelled: Set<string>, sessionID: string) {
  if (signal?.aborted || cancelled.has(sessionID)) throw new Error("cancelled")
  await new Promise<void>((resolve, reject) => {
    const done = () => signal?.removeEventListener("abort", abort)
    const timer = setTimeout(() => {
      done()
      resolve()
    }, ms)
    const abort = () => {
      clearTimeout(timer)
      done()
      reject(new Error("cancelled"))
    }
    signal?.addEventListener("abort", abort, { once: true })
  })
  if (cancelled.has(sessionID)) throw new Error("cancelled")
}

async function waitForParallelStart(taskID: string, api: (pathname: string, init?: RequestInit) => Promise<Response>, deadline: number) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 30_000 && Date.now() < deadline) {
    const progress = await settle(await api(`/task/${taskID}/progress`).then((res) => res.json()), api)
    const goalRuns = Array.isArray(progress.goalRuns) ? progress.goalRuns : []
    const active = goalRuns.filter((item: { status?: string }) => ["queued", "accepted", "running", "blocked"].includes(String(item.status || "")))
    const completed = goalRuns.filter((item: { status?: string }) => ["completed", "failed", "aborted"].includes(String(item.status || "")))
    if (active.length >= 2) {
      return {
        active: active.length,
        completedBeforeParallel: completed.length,
        statuses: goalRuns.map((item: { id?: string; status?: string }) => ({
          id: item.id || "",
          status: item.status || "",
        })),
      }
    }
    if (completed.length > 0) {
      throw new Error(`goal runs completed before parallel start: ${JSON.stringify(goalRuns)}`)
    }
    await Bun.sleep(250)
  }
  throw new Error("parallel goal runs did not start in time")
}

async function waitForTaskList(page: Page, taskID: string, deadline: number) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 60_000 && Date.now() < deadline) {
    const listed = await page.evaluate(async (id) => {
      await window.eval("loadTasks")()
      const state = window.eval("state")
      return Array.isArray(state.tasks) && state.tasks.some((item: { task?: { id?: string } }) => item?.task?.id === id)
    }, taskID)
    if (listed) return
    await Bun.sleep(250)
  }
  throw new Error(`overlay did not list task ${taskID}`)
}

async function waitForFinal(taskID: string, deadline: number, api: (pathname: string, init?: RequestInit) => Promise<Response>) {
  const startedAt = Date.now()
  while (Date.now() < deadline) {
    const progress = await settle(await api(`/task/${taskID}/progress`).then((res) => res.json()), api)
    if (FINAL.has(progress.task.status)) return progress
    await Bun.sleep(500)
  }
  throw new Error(`task ${taskID} did not finish within ${Date.now() - startedAt}ms`)
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
      body: JSON.stringify({ message: "Continue autonomously." }),
    })
  }
  if (pending.length === 0) return progress
  return api(`/task/${progress.task.id}/progress`).then((res) => res.json())
}

async function waitForOverlayLive(page: Page, deadline: number) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 30_000 && Date.now() < deadline) {
    const shot = await overlaySnapshot(page)
    if (shot.processes.length >= 2 && textSize(shot.reasoning) > 0 && totalOutput(shot.processes) > 0) return shot
    await Bun.sleep(150)
  }
  throw new Error(`overlay did not expose live parallel output: ${JSON.stringify(await overlaySnapshot(page))}`)
}

async function waitForOverlayResume(page: Page, deadline: number) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 30_000 && Date.now() < deadline) {
    const shot = await overlaySnapshot(page)
    if (shot.processes.length >= 2 && textSize(shot.reasoning) > 0 && totalOutput(shot.processes) > 0) return shot
    await Bun.sleep(150)
  }
  throw new Error(`overlay did not restore persisted parallel output: ${JSON.stringify(await overlaySnapshot(page))}`)
}

async function verifyResume(browser: Browser, current: Page, serverUrl: string, taskID: string, directory: string, deadline: number) {
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
  await next.waitForFunction(() => document.querySelector("#connBadge")?.dataset.status === "online", { timeout: remaining(60_000) })
  await syncDirectory(next, directory)
  await waitForTaskList(next, taskID, deadline)
  await next.evaluate(async (id) => {
    const state = window.eval("state")
    if (state.selectedTaskID === id && state.board?.task?.id === id) return
    await window.eval("selectTask")(id)
  }, taskID)
  await next.waitForFunction((id, dir) => {
    try {
      const state = window.eval("state")
      return state.directory === dir && state.board?.task?.id === id
    } catch {
      return false
    }
  }, { timeout: remaining(60_000) }, taskID, directory)
  await next.evaluate(async () => {
    await window.eval("persistOverlaySettings")()
    if (!window.eval("state").board?.task?.id) await window.eval("loadBoard")()
    await window.eval("loadConversation")()
  })
  await current.close().catch(() => undefined)
  return next
}

async function syncDirectory(page: Page, directory: string) {
  return page.evaluate(async (dir) => {
    localStorage.setItem("oc_directory", dir)
    localStorage.setItem("oc_directory_mode", "custom")
    localStorage.setItem("oc_workspace_directory", dir)
    await window.eval("applyDirectory")(dir, { save: true, temp: false, restoreWorkspace: false })
    await window.eval("loadTasks")()
    return window.eval("state").directory
  }, directory)
}

async function overlaySnapshot(page: Page) {
  return page.evaluate(() => {
    const text = (selector: string) => [...document.querySelectorAll(selector)].map((node) => node.textContent || "").join("\n")
    return {
      processes: [...document.querySelectorAll(".executor-process-card")].map((node) => ({
        title: node.querySelector(".executor-process-title")?.textContent || "",
        progress: node.querySelector(".executor-process-progress")?.textContent || "",
        output: node.querySelector(".executor-process-output")?.textContent || "",
        status: node.getAttribute("data-status") || "",
      })),
      reasoning: text('.turn[data-role="assistant"] .reasoning-text'),
      assistant: text('.turn[data-role="assistant"] .msg-body'),
    }
  })
}

function textSize(value: string) {
  return value.trim().length
}

function totalOutput(items: Array<{ output?: string }>) {
  return items.reduce((sum, item) => sum + String(item.output || "").trim().length, 0)
}

function totalProgress(items: Array<{ progress?: string }>) {
  return items.reduce((sum, item) => sum + String(item.progress || "").trim().length, 0)
}

function remaining(limit = timeoutMs) {
  const left = deadline - Date.now()
  if (left <= 0) throw new Error(`benchmark exceeded ${timeoutMs}ms at ${stage}`)
  return Math.max(1_000, Math.min(limit, left))
}

async function scaffoldProject(dir: string) {
  const pluginPath = path.join(dir, "benchmark-plugin.ts")
  await fs.mkdir(path.join(dir, "src"), { recursive: true })
  await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({
    name: "overlay-parallel-benchmark",
    private: true,
    type: "module",
  }, null, 2))
  await fs.writeFile(path.join(dir, "src", "catalog.test.ts"), [
    "import { describe, expect, test } from \"bun:test\"",
    "import { buildCatalogTitle } from \"./catalog\"",
    "",
    "describe(\"catalog\", () => {",
    "  test(\"formats the catalog title\", () => {",
    "    expect(buildCatalogTitle(\"tea\")).toBe(\"Tea • 1 item\")",
    "  })",
    "})",
    "",
  ].join("\n"))
  await fs.writeFile(path.join(dir, "src", "cart.test.ts"), [
    "import { describe, expect, test } from \"bun:test\"",
    "import { formatCartTotal } from \"./cart\"",
    "",
    "describe(\"cart\", () => {",
    "  test(\"formats cents into dollars\", () => {",
    "    expect(formatCartTotal(1234)).toBe(\"$12.34\")",
    "  })",
    "})",
    "",
  ].join("\n"))
  await fs.writeFile(pluginPath, [
    "export default async function benchmarkPlugin() {",
    "  return {",
    "    \"evaluation.analysis\": async (input, output) => {",
    "      const failed = input.checkResults.some((item) => item.status === \"failed\")",
    "      output.analysis = failed",
    "        ? {",
    "            verdict: \"rejected\",",
    "            classification: \"evaluation\",",
    "            summary: \"Benchmark evaluator rejected the delivery.\",",
    "            goal_statuses: input.goals.map((goal, goal_index) => ({",
    "              goal_index,",
    "              status: \"failed\",",
    "              evidence: \"At least one automated check failed.\",",
    "              reasoning: `Benchmark evaluator rejected ${goal.description}.`,",
    "            })),",
    "            replan_guidance: {",
    "              root_cause: \"Automated checks failed.\",",
    "              what_failed: \"The benchmark verification suite did not pass.\",",
    "              suggested_strategy: \"Fix the failing verification and retry.\",",
    "              avoid_approaches: [],",
    "            },",
    "          }",
    "        : {",
    "            verdict: \"accepted\",",
    "            classification: \"evaluation\",",
    "            summary: \"Benchmark evaluator accepted the delivery.\",",
    "            goal_statuses: input.goals.map((goal, goal_index) => ({",
    "              goal_index,",
    "              status: \"passed\",",
    "              evidence: \"The verification suite passed.\",",
    "              reasoning: `Benchmark evaluator accepted ${goal.description}.`,",
    "            })),",
    "            replan_guidance: null,",
    "          }",
    "    },",
    "  }",
    "}",
    "",
  ].join("\n"))
  await fs.writeFile(path.join(dir, "opencorvus.json"), JSON.stringify({
    plugin: [pathToFileURL(pluginPath).href],
  }, null, 2))

  await $`git init`.cwd(dir)
  await $`git config user.email benchmark@example.com`.cwd(dir)
  await $`git config user.name benchmark`.cwd(dir)
  await $`git add .`.cwd(dir)
  await $`git commit -m scaffold`.cwd(dir)
}

async function launchBrowser(headlessMode: boolean) {
  return puppeteer.launch({
    headless: headlessMode,
    executablePath: await browserPath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  })
}

async function cleanup(
  label: string,
  run: () => Promise<unknown>,
  force?: () => void | Promise<void>,
  timeout = 10_000,
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const wait = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeout}ms`)), timeout)
  })
  try {
    await Promise.race([run(), wait])
  } catch (error) {
    console.error(`[cleanup] ${label}: ${String(error)}`)
    await force?.()
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function browserPath() {
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
