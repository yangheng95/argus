#!/usr/bin/env bun

import { mkdtempSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import puppeteer, { type Page } from "puppeteer-core"
import { $ } from "bun"
import { ExecutorBootstrap } from "../../src/executor/bootstrap"
import { Instance } from "../../src/project/instance"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../../test/fixture/db"
import { ensureBenchmarkModel, loadBenchmarkEnv, prepareDashscopeEnv, resolveBenchmarkModel } from "./env"

Log.init({ print: true })

const timeoutMs = Number(process.argv.find((item) => item.startsWith("--timeout-ms="))?.split("=")[1]) || 15 * 60 * 1000
const taskCreateTimeoutMs =
  Number(process.argv.find((item) => item.startsWith("--task-create-timeout-ms="))?.split("=")[1]) || 8 * 60 * 1000
const report = process.argv.find((item) => item.startsWith("--report="))?.slice("--report=".length)
const keep = process.argv.includes("--keep")
const headless = !process.argv.includes("--headed")

const PANEL_REQUEST = "创建一个个人主页"
const AUTO_REPLY =
  "Complete the task autonomously end-to-end. Choose reasonable defaults consistent with the request, keep scope minimal, continue execution, and do not ask again unless the request is contradictory or unsafe."
const FINAL = new Set(["completed", "failed", "cancelled"])
const OVERLAY_STALE_MS = 12_000
const OVERLAY_INTERRUPT_TEXT = "已中断"

const temp = {
  dir: "",
  home: "",
}

await loadBenchmarkEnv(import.meta.dir)
prepareDashscopeEnv()
const model = await resolveBenchmarkModel(import.meta.dir)
await ensureBenchmarkModel(import.meta.dir, model)

temp.home = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-overlay-repro-home-"))
temp.dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-overlay-repro-project-"))
process.env.OPENCORVUS_HOME = temp.home
process.env.OPENCORVUS_AUTO_DISCOVER_EXECUTORS = "1"
process.env.OPENCORVUS_EXECUTOR_CLAUDE_PERMISSION_MODE = "bypassPermissions"

await resetDatabase()
await scaffoldRepo(temp.dir, model)

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
  interruptedAt: 0,
  apiTaskAt: 0,
  overlayTaskAt: 0,
  selectedAt: 0,
  boardAt: 0,
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
  await syncDirectory(page, temp.dir)

  await page.$eval("#chatTextarea", (node, value) => {
    const input = node as HTMLTextAreaElement
    input.value = String(value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  }, PANEL_REQUEST)
  marks.submittedAt = Date.now()
  await page.click("#chatSend")

  const created = await waitForTaskCreated(page, api, marks)
  taskID = created.taskID

  const beforeSelect = created.overlay
  if (!beforeSelect.selectedTaskID && taskID) {
    await page.evaluate(async (id) => {
      const state = window.eval("state")
      if (state.selectedTaskID === id) return
      await window.eval("loadTasks")()
      await window.eval("selectTask")(id)
    }, taskID)
  }

  if (taskID) {
    await page.waitForFunction((id) => {
      try {
        return window.eval("state").selectedTaskID === id
      } catch {
        return false
      }
    }, { timeout: 120_000 }, taskID)
    marks.selectedAt = Date.now()
  }

  await page.waitForFunction(() => {
    try {
      return !!window.eval("state").board?.task?.id
    } catch {
      return false
    }
  }, { timeout: 120_000 })
  marks.boardAt = Date.now()

  const afterSelect = await overlaySnapshot(page)
  const progress = taskID ? await waitForFinal(taskID, timeoutMs, api) : null
  marks.completedAt = Date.now()

  const diagnostics = await collectDiagnostics(page, api, taskID)
  const taskRows = Array.isArray(diagnostics.taskList?.tasks) ? diagnostics.taskList.tasks : []
  const overlayTaskListEmpty = marks.apiTaskAt > 0 && !marks.overlayTaskAt
  const swallowedFirstMessage = !containsRequest(beforeSelect, PANEL_REQUEST) && containsRequest(afterSelect, PANEL_REQUEST)
  const leaseMismatch =
    containsText(progress?.evaluation?.summary) ||
    containsText(progress?.task?.error) ||
    containsLog(diagnostics.logs, "Executor lease belongs to a different runtime")
  const executionWorkspace = currentGoalWorkspace(diagnostics.board)
  const cwdMismatch = !!executionWorkspace && executionWorkspace !== afterSelect.directory
  const taskListNotUpdated = overlayTaskListEmpty || (!beforeSelect.taskIDs.length && taskRows.length > 0)
  const interruptedBeforeTask =
    !!marks.interruptedAt &&
    ((!marks.apiTaskAt && !marks.overlayTaskAt) ||
      (marks.apiTaskAt > 0 && marks.interruptedAt <= marks.apiTaskAt) ||
      (marks.overlayTaskAt > 0 && marks.interruptedAt <= marks.overlayTaskAt))

  const out = {
    generated_at: new Date().toISOString(),
    model,
    directory: temp.dir,
    server: server.url.toString(),
    prompt: PANEL_REQUEST,
    taskID,
    timings_ms: {
      online: marks.onlineAt - marks.startedAt,
      submit: marks.submittedAt - marks.startedAt,
      interrupted: marks.interruptedAt ? marks.interruptedAt - marks.startedAt : null,
      api_task: marks.apiTaskAt ? marks.apiTaskAt - marks.startedAt : null,
      overlay_task: marks.overlayTaskAt ? marks.overlayTaskAt - marks.startedAt : null,
      selected: marks.selectedAt ? marks.selectedAt - marks.startedAt : null,
      board: marks.boardAt ? marks.boardAt - marks.startedAt : null,
      completed: marks.completedAt ? marks.completedAt - marks.startedAt : null,
    },
    overlay: {
      before_select: beforeSelect,
      after_select: afterSelect,
    },
    task_list: taskRows.map((item: any) => ({
      id: item?.task?.id || "",
      status: item?.task?.status || "",
      title: item?.task?.title || "",
    })),
    board: summarizeBoard(diagnostics.board),
    progress: progress
      ? {
          task_status: progress.task?.status,
          task_error: progress.task?.error ?? null,
          evaluation_verdict: progress.evaluation?.verdict ?? null,
          evaluation_summary: progress.evaluation?.summary ?? null,
        }
      : null,
    transcript_count: Array.isArray(diagnostics.transcript) ? diagnostics.transcript.length : 0,
    timeline_count: Array.isArray(diagnostics.timeline) ? diagnostics.timeline.length : 0,
    tui: diagnostics.tui,
    screenshot: diagnostics.screenshot,
    symptoms: {
      swallowed_first_message: swallowedFirstMessage,
      front_end_interrupted: !!marks.interruptedAt,
      front_end_interrupted_before_task_created: interruptedBeforeTask,
      task_list_not_updated: taskListNotUpdated,
      overlay_task_missing_until_manual_select: overlayTaskListEmpty,
      evaluation_rejected_due_to_lease: leaseMismatch,
      tui_runtime_started: !!diagnostics.tui?.runtime?.running,
      cwd_execution_workspace_mismatch: cwdMismatch,
    },
    logs: diagnostics.logs,
  }

  const file = report || path.join(process.cwd(), `overlay-repro-benchmark-report-${Date.now()}.json`)
  await Bun.write(file, JSON.stringify(out, null, 2))
  console.log(JSON.stringify(out, null, 2))
  console.log(`report: ${file}`)
} catch (error) {
  const file = report || path.join(process.cwd(), `overlay-repro-benchmark-report-${Date.now()}.json`)
  const diagnostics = await collectDiagnostics(page, api, taskID).catch((cause) => ({
    overlay: { error: String(cause) },
  }))
  const out = {
    generated_at: new Date().toISOString(),
    model,
    directory: temp.dir,
    server: server.url.toString(),
    prompt: PANEL_REQUEST,
    taskID,
    error: String(error),
    timings_ms: {
      online: marks.onlineAt ? marks.onlineAt - marks.startedAt : null,
      submit: marks.submittedAt ? marks.submittedAt - marks.startedAt : null,
      interrupted: marks.interruptedAt ? marks.interruptedAt - marks.startedAt : null,
      api_task: marks.apiTaskAt ? marks.apiTaskAt - marks.startedAt : null,
      overlay_task: marks.overlayTaskAt ? marks.overlayTaskAt - marks.startedAt : null,
    },
    overlay: diagnostics.overlay,
    board: summarizeBoard(diagnostics.board),
    progress: diagnostics.progress
      ? {
          task_status: diagnostics.progress.task?.status,
          task_error: diagnostics.progress.task?.error ?? null,
          evaluation_verdict: diagnostics.progress.evaluation?.verdict ?? null,
          evaluation_summary: diagnostics.progress.evaluation?.summary ?? null,
        }
      : null,
    task_list: Array.isArray(diagnostics.taskList?.tasks)
      ? diagnostics.taskList.tasks.map((item: any) => ({
          id: item?.task?.id || "",
          status: item?.task?.status || "",
          title: item?.task?.title || "",
        }))
      : [],
    transcript_count: Array.isArray(diagnostics.transcript) ? diagnostics.transcript.length : 0,
    timeline_count: Array.isArray(diagnostics.timeline) ? diagnostics.timeline.length : 0,
    tui: diagnostics.tui,
    screenshot: diagnostics.screenshot,
    logs: diagnostics.logs,
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

async function scaffoldRepo(dir: string, model: string) {
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
  await Bun.write(path.join(dir, "README.md"), "# Empty repo\n")
  await $`git init -b master`.cwd(dir)
  await $`git config user.name codex`.cwd(dir)
  await $`git config user.email codex@example.com`.cwd(dir)
  await $`git add README.md opencorvus.json .opencorvus/opencorvus.json`.cwd(dir)
  await $`git commit -m init`.cwd(dir)
}

async function launchBrowser(headless: boolean) {
  const executablePath = await findBrowser()
  return puppeteer.launch({
    executablePath,
    headless: headless ? "new" : false,
    userDataDir: mkdtempSync(path.join(os.tmpdir(), "pptr-overlay-repro-benchmark-")),
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
  throw new Error("No local Edge/Chrome executable found for overlay reproduction benchmark")
}

async function waitForTaskCreated(page: Page, api: (pathname: string, init?: RequestInit) => Promise<Response>, marks: typeof marks) {
  const startedAt = Date.now()
  let apiTaskID = ""
  let apiSeenAt = 0
  let lastOverlay = await overlaySnapshot(page)
  while (Date.now() - startedAt < taskCreateTimeoutMs) {
    lastOverlay = await overlaySnapshot(page)
    if (!marks.interruptedAt && containsInterrupted(lastOverlay)) {
      marks.interruptedAt = Date.now()
      console.log(`[overlay-repro] overlay interrupted after ${marks.interruptedAt - marks.submittedAt}ms`)
    }
    const taskID = lastOverlay.selectedTaskID || lastOverlay.taskIDs[0] || ""
    if (taskID) {
      marks.overlayTaskAt ||= Date.now()
      console.log(`[overlay-repro] overlay surfaced task ${taskID}`)
      return {
        taskID,
        overlay: lastOverlay,
      }
    }

    const board = await api("/tasks").then((res) => res.json()).catch(() => null)
    const next = Array.isArray(board?.tasks) ? board.tasks[0]?.task?.id || "" : ""
    if (next && !apiTaskID) {
      apiTaskID = next
      apiSeenAt = Date.now()
      marks.apiTaskAt ||= apiSeenAt
      console.log(`[overlay-repro] api surfaced task ${apiTaskID}`)
    }
    if (apiTaskID && Date.now() - apiSeenAt >= OVERLAY_STALE_MS) {
      return {
        taskID: apiTaskID,
        overlay: lastOverlay,
      }
    }
    await Bun.sleep(1_000)
  }
  throw new Error(`Overlay did not create a task within ${taskCreateTimeoutMs}ms: ${JSON.stringify(lastOverlay)}`)
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
      console.log(`[overlay-repro] status=${last}`)
    }
    await Bun.sleep(2_000)
  }
  throw new Error(`Task did not finish within ${timeoutMs}ms`)
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
    return true
  }, directory)
}

async function overlaySnapshot(page: Page) {
  return page.evaluate(() => {
    try {
      const state = window.eval("state")
      const messages = Array.isArray(state.messages)
        ? state.messages.map((item: any) => ({
            role: item?.info?.role || "",
            text: Array.isArray(item?.parts)
              ? item.parts
                  .map((part: any) => {
                    if (part?.type === "text" && typeof part.text === "string") return part.text
                    if (part?.type === "reasoning" && typeof part.text === "string") return `[reasoning] ${part.text}`
                    if (part?.type === "tool") {
                      const tool = typeof part.tool === "string" ? part.tool : "tool"
                      const status = typeof part.state?.status === "string" ? part.state.status : "unknown"
                      const title = typeof part.state?.title === "string" ? part.state.title : ""
                      return [`[tool:${tool}:${status}]`, title].filter(Boolean).join(" ")
                    }
                    if (part?.type === "file" && typeof part.filename === "string") return `[file] ${part.filename}`
                    return ""
                  })
                  .filter(Boolean)
                  .join("\n")
              : "",
          }))
        : []
      const turns = [...document.querySelectorAll(".turn")].map((node) => ({
        role: (node as HTMLElement).dataset.role || "",
        body: (node.querySelector(".msg-body")?.textContent || "").trim(),
      }))
      const workspace = document.querySelector("#taskWorkspaceDir") as HTMLElement | null
      return {
        directory: state.directory || "",
        savedDirectory: state.savedDirectory || "",
        workspaceDirectory: state.workspaceDirectory || "",
        selectedTaskID: state.selectedTaskID || "",
        taskIDs: Array.isArray(state.tasks)
          ? state.tasks.map((item: { task?: { id?: string } }) => item?.task?.id || "").filter(Boolean).slice(0, 5)
          : [],
        chatCount: document.querySelector("#chatCount")?.textContent || "",
        messages,
        turns,
        board: state.board
          ? {
              taskID: state.board.task?.id || "",
              status: state.board.task?.status || "",
              evaluation: state.board.evaluation?.summary || "",
              verdict: state.board.evaluation?.verdict || "",
              goalRuns: Array.isArray(state.board.goalRuns)
                ? state.board.goalRuns.map((item: any) => ({
                    id: item?.id || "",
                    status: item?.status || "",
                    workspaceDir: item?.workspaceDir || "",
                  }))
                : [],
            }
          : null,
        executionWorkspace: workspace?.hidden ? "" : workspace?.textContent || "",
      }
    } catch (error) {
      return {
        error: String(error),
      }
    }
  })
}

async function collectDiagnostics(page: Page, api: (pathname: string, init?: RequestInit) => Promise<Response>, taskID: string) {
  const overlay = await overlaySnapshot(page).catch((error) => ({ error: String(error) }))
  const taskList = await api("/tasks").then((res) => res.json()).catch((error) => ({ error: String(error) }))
  const progress = taskID ? await api(`/task/${taskID}/progress`).then((res) => res.json()).catch(() => null) : null
  const board = taskID ? await api(`/task/${taskID}/board`).then((res) => res.json()).catch(() => null) : null
  const transcript = taskID ? await api(`/task/${taskID}/transcript`).then((res) => res.json()).catch(() => []) : []
  const timeline = taskID ? await api(`/control/timeline?taskID=${encodeURIComponent(taskID)}`).then((res) => res.json()).catch(() => []) : []
  const tui = await api("/tui/status").then((res) => res.json()).catch((error) => ({ error: String(error) }))
  const logs = await api("/log/tail?n=400").then((res) => res.json()).catch((error) => ({ error: String(error) }))
  const screenshot = path.join(process.cwd(), `overlay-repro-benchmark-${Date.now()}.png`)
  await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined)
  return {
    overlay,
    taskList,
    progress,
    board,
    transcript,
    timeline,
    tui,
    logs,
    screenshot,
  }
}

function containsRequest(snapshot: any, request: string) {
  const target = String(request).trim()
  if (!target) return false
  const inMessages = Array.isArray(snapshot?.messages) && snapshot.messages.some((item: any) => String(item?.text || "").includes(target))
  if (inMessages) return true
  return Array.isArray(snapshot?.turns) && snapshot.turns.some((item: any) => String(item?.body || "").includes(target))
}

function containsInterrupted(snapshot: any) {
  const messages = Array.isArray(snapshot?.messages) ? snapshot.messages : []
  if (messages.some((item: any) => typeof item?.text === "string" && item.text.includes(OVERLAY_INTERRUPT_TEXT))) return true
  const turns = Array.isArray(snapshot?.turns) ? snapshot.turns : []
  return turns.some((item: any) => typeof item?.body === "string" && item.body.includes(OVERLAY_INTERRUPT_TEXT))
}

function containsText(value: unknown) {
  return typeof value === "string" && value.includes("Executor lease belongs to a different runtime")
}

function containsLog(logs: any, text: string) {
  return Array.isArray(logs?.lines) && logs.lines.some((line: string) => typeof line === "string" && line.includes(text))
}

function currentGoalWorkspace(board: any) {
  if (!Array.isArray(board?.goalRuns)) return ""
  const active = board.goalRuns.find((item: any) => typeof item?.workspaceDir === "string" && item.workspaceDir && ["queued", "accepted", "running", "blocked", "completed", "failed"].includes(item.status))
  return active?.workspaceDir || ""
}

function summarizeBoard(board: any) {
  if (!board || typeof board !== "object") return null
  return {
    task: {
      id: board.task?.id || "",
      status: board.task?.status || "",
      error: board.task?.error || null,
      directory: board.task?.directory || "",
    },
    evaluation: board.evaluation
      ? {
          verdict: board.evaluation.verdict || null,
          summary: board.evaluation.summary || null,
        }
      : null,
    goalRuns: Array.isArray(board.goalRuns)
      ? board.goalRuns.map((item: any) => ({
          id: item?.id || "",
          status: item?.status || "",
          workspaceDir: item?.workspaceDir || "",
        }))
      : [],
  }
}
