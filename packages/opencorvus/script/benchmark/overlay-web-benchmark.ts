#!/usr/bin/env bun

import { mkdtempSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import puppeteer, { type Page } from "puppeteer-core"
import { parseSSE } from "../../src/control-plane/sse"
import { inactivityAgeMs } from "../../src/util/activity-timeout"
import { auditWorkspace, deriveRunMetrics, evaluateQualityGates, moduleBlocksFromRequest } from "./quality-gates"

function flag(name: string) {
  return process.argv.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1)
}

function benchmarkRoutingForExecutor(executor: "opencode" | "codex" | "claude-code") {
  if (executor === "opencode") {
    return {
      spec: "opencorvus" as const,
      goal: "opencorvus" as const,
      plan: "opencorvus" as const,
    }
  }
  return {
    spec: "executor" as const,
    goal: "opencorvus" as const,
    plan: "executor" as const,
  }
}

// No overall hard timeout. The only execution gate is stall: if there is no
// event/progress/log activity for stallTimeoutMs, the benchmark aborts.
// All stage timeouts (spec, planner, standby) default to effectively unlimited
// so that slow models are never killed mid-thought.
//
// --planning-stall-timeout-ms: separate (usually longer) stall timeout applied
// while the task is in "planning" status. During spec generation the task stays
// in "planning" with no progress changes even when the spec agent is actively
// making tool calls — using the normal stallTimeoutMs here causes false stalls.
const stallTimeoutMs = Number(flag("--stall-timeout-ms")) || 20 * 60 * 1000
const planningStallTimeoutMs = Number(flag("--planning-stall-timeout-ms")) || stallTimeoutMs
const requestTimeoutMs = Number(flag("--request-timeout-ms")) || 30_000
const specTimeoutMs = Number(flag("--spec-timeout-ms")) || 24 * 60 * 60 * 1000
const plannerTimeoutMs = Number(flag("--planner-timeout-ms")) || 24 * 60 * 60 * 1000
const toolTimeoutMs = Number(flag("--tool-timeout-ms")) || 10 * 60 * 1000
const standbyTimeoutMs = Number(flag("--standby-timeout-ms")) || 24 * 60 * 60 * 1000
const completionHardTimeoutMs = Number(flag("--completion-hard-timeout-ms")) || 0
// --timeout-ms accepted for backwards compat but no longer drives other timeouts
const specMaxSteps = Number(flag("--spec-max-steps")) || 80
const plannerMaxSteps = Number(flag("--planner-max-steps")) || 96
const maxRuns = Number(flag("--max-runs")) || 20
const maxReplans = Number(flag("--max-replans")) || 8
const maxEvaluations = Number(flag("--max-evaluations")) || 200
const report = flag("--report")
const keep = !process.argv.includes("--no-keep")
const headless = !process.argv.includes("--headed")
const executor = (flag("--executor") || "opencode") as
  | "opencode"
  | "codex"
  | "claude-code"
const requestFile = flag("--request-file")
const deliveryVerifyCmd = flag("--delivery-verify-cmd")
const skipLocalVerify = process.argv.includes("--skip-local-verify")

const DEFAULT_TASK_TITLE = "Overlay Web Benchmark NoteStore"
const DEFAULT_TASK_REQUEST = `
Implement a minimal NoteStore.

Only create or modify these files:
- src/note-store.ts
- src/note-store.test.ts

Do not add package.json, tsconfig.json, README files, docs, or any other files unless they are strictly required.
The Bun runtime and bun:test are already available, and the project scaffold is ready.

Requirements for src/note-store.ts:
- export interface Note { id: string; title: string; done: boolean; created_at: number }
- export class NoteStore backed by an in-memory Map<string, Note>
- create(title: string): trim the title, throw on empty input, use crypto.randomUUID(), set done=false and created_at=Date.now()
- get(id: string): return Note | undefined
- list(): return all notes sorted by created_at ascending
- toggle(id: string): flip done and return the updated note or undefined
- remove(id: string): delete the note and return boolean

Requirements for src/note-store.test.ts:
- use bun:test
- cover these cases:
  1. create returns a complete Note
  2. empty title throws
  3. list preserves creation order
  4. toggle flips done
  5. remove deletes successfully and get then returns undefined

Acceptance:
- run bun test ./src/note-store.test.ts
- that command must pass
`.trim()
const TASK_REQUEST = requestFile ? (await Bun.file(path.resolve(requestFile)).text()).trim() : DEFAULT_TASK_REQUEST
const TASK_TITLE = flag("--title")?.trim() || (requestFile ? path.parse(requestFile).name : DEFAULT_TASK_TITLE)
// DELIVERY_VERIFY_CMD: runs only at final quality gate (buildBenchmarkReport).
// Never passed to the orchestrator as per-goal checks — per-goal evaluation uses the LLM judge only.
// For the default NoteStore task, use bun test as the acceptance command.
const DELIVERY_VERIFY_CMD = skipLocalVerify ? "" : (deliveryVerifyCmd?.trim() || (requestFile ? "" : "bun test ./src/note-store.test.ts"))
const TASK_GOALS = requestFile
  ? undefined
  : [{
      description: "Implement NoteStore and tests",
      criteria: "Create src/note-store.ts and src/note-store.test.ts so bun test ./src/note-store.test.ts passes.",
      priority: "blocking" as const,
    }]

const AUTO_REPLY =
  "Complete the task autonomously end-to-end. Choose reasonable defaults consistent with the request, keep scope minimal, continue execution, and do not ask again unless the request is contradictory or unsafe."

const FINAL = new Set(["completed", "failed", "cancelled"])
const STREAM_PLACEHOLDERS = new Set(["", "...", "â€¦â€¦", "æ€è€ƒä¸­", "Thinking"])
const DIAG_TYPES = new Set([
  "orchestrator.agent.updated",
  "orchestrator.run.created",
  "orchestrator.run.updated",
  "orchestrator.run.progress",
  "orchestrator.run.output",
  "orchestrator.task.created",
  "orchestrator.task.updated",
  "orchestrator.spec.created",
  "orchestrator.spec.updated",
  "orchestrator.plan.created",
  "orchestrator.plan.activated",
  "orchestrator.interaction.requested",
  "orchestrator.interaction.resolved",
])
const PLANNING_VISIBLE_TIMEOUT_MS = Number(flag("--planning-timeout-ms")) || 2 * 60 * 1000
const TASK_CREATE_TIMEOUT_MS = Number(flag("--task-create-timeout-ms")) || 5 * 60 * 1000
const TASK_RESUME_TIMEOUT_MS = Number(flag("--task-resume-timeout-ms")) || 10 * 60 * 1000
const projectDir = flag("--project-dir")
const temp = {
  dir: "",
  home: "",
  config: "",
}

temp.home = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-overlay-benchmark-home-"))
temp.dir = projectDir ? path.resolve(projectDir) : await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-overlay-benchmark-project-"))
temp.config = path.join(temp.home, "config-override")
process.env.OPENCORVUS_HOME = temp.home
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
const { ensureBenchmarkModel, loadBenchmarkEnv, prepareDashscopeEnv, resolveBenchmarkModel } = await import("./env")
const { Log } = await import("../../src/util/log")
Log.init({ print: true })
const { ExecutorBootstrap } = await import("../../src/executor/bootstrap")
const { Instance } = await import("../../src/project/instance")
const { InstanceBootstrap } = await import("../../src/project/bootstrap")
const { Server } = await import("../../src/server/server")
const { resetDatabase } = await import("../../test/fixture/db")

await loadBenchmarkEnv(import.meta.dir)
prepareDashscopeEnv()
const model = await resolveBenchmarkModel(import.meta.dir)
process.env.OPENCORVUS_BENCHMARK_MODEL = model
process.env.OPENCORVUS_CONFIG_DIR = temp.config
await ensureBenchmarkModel(import.meta.dir, model)

process.env.OPENCORVUS_AUTO_DISCOVER_EXECUTORS = "1"
process.env.OPENCORVUS_EXECUTOR_CLAUDE_PERMISSION_MODE = "bypassPermissions"
process.env.OPENCORVUS_GOAL_RUN_TIMEOUT_MS = String(standbyTimeoutMs)
process.env.OPENCORVUS_SPEC_TIMEOUT_MS = String(specTimeoutMs)
process.env.OPENCORVUS_PLANNER_TIMEOUT_MS = String(plannerTimeoutMs)
process.env.OPENCORVUS_SPEC_AGENT_TIMEOUT_MS = String(specTimeoutMs)
process.env.OPENCORVUS_PLANNER_AGENT_TIMEOUT_MS = String(plannerTimeoutMs)
process.env.OPENCORVUS_TOOL_TIMEOUT_MS = String(toolTimeoutMs)
process.env.OPENCORVUS_STANDBY_TIMEOUT_MS = String(standbyTimeoutMs)
process.env.OPENCORVUS_SPEC_AGENT_MAX_STEPS = String(specMaxSteps)
process.env.OPENCORVUS_PLANNER_AGENT_MAX_STEPS = String(plannerMaxSteps)

console.log(
  `[overlay-benchmark] config model=${model} stall=${stallTimeoutMs / 1000}s planning-stall=${planningStallTimeoutMs / 1000}s spec=${specTimeoutMs === 86400000 ? "∞" : specTimeoutMs / 1000 + "s"} planner=${plannerTimeoutMs === 86400000 ? "∞" : plannerTimeoutMs / 1000 + "s"} tool=${toolTimeoutMs / 1000}s standby=${standbyTimeoutMs === 86400000 ? "∞" : standbyTimeoutMs / 1000 + "s"} request=${requestTimeoutMs / 1000}s hard=${completionHardTimeoutMs > 0 ? completionHardTimeoutMs / 1000 + "s" : "none"}`,
)

// Detect stale SQLite WAL lock from a crashed previous run
const dbPath = path.join(os.homedir(), ".local", "share", "opencorvus", "opencorvus.db")
const walPath = `${dbPath}-wal`
try {
  const walStat = await fs.stat(walPath)
  const ageMs = Date.now() - walStat.mtimeMs
  // WAL older than 5 minutes with no running bun process is a stale lock — remove it
  if (ageMs > 5 * 60 * 1000) {
    await fs.rm(walPath, { force: true })
    await fs.rm(`${dbPath}-shm`, { force: true })
  }
} catch {
  // no WAL file, fine
}

await resetDatabase()
if (!projectDir) {
  await scaffoldProject(temp.dir, model)
} else {
  // Strip project-level opencorvus state to prevent old task IDs from bleeding into new runs
  await fs.rm(path.join(temp.dir, "opencorvus.json"), { force: true })
  await fs.rm(path.join(temp.dir, ".opencorvus"), { recursive: true, force: true })
  await fs.mkdir(temp.config, { recursive: true })
}

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
  planningAt: 0,
  streamingAt: 0,
  createdAt: 0,
  selectedAt: 0,
  boardAt: 0,
  resumedAt: 0,
  completedAt: 0,
}
let taskID = ""
const reportFile = report ? path.resolve(report) : path.join(process.cwd(), `overlay-web-benchmark-report-${Date.now()}.json`)
const eventFile = reportFile.endsWith(".json")
  ? reportFile.slice(0, -".json".length) + ".events.json"
  : `${reportFile}.events.json`
const eventLogFile = reportFile.endsWith(".json")
  ? reportFile.slice(0, -".json".length) + ".events.ndjson"
  : `${reportFile}.events.ndjson`
const events: Array<Record<string, unknown>> = []
let flushed = Promise.resolve()
let lastEventAt = Date.now()
let lastProgressAt = Date.now()
let lastProgressSignature = ""
let lastLogAt = Date.now()
let lastActivityLogAt = Date.now()
let lastHeartbeatAt = 0
let lastActivityLine = ""
let planning: any = null
let streaming: any = null
let board: any = null
let progress: any = null
let finalBoard: any = null
let transcript: any = null
let timeline: any = null
let runs: any = null

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

function formatEventLine(entry: {
  type: string
  stage: string
  status: string
  progressType: string
  summary: string
  text: string
  toolName: string
  goalRunID: string
}) {
  if (entry.type === "orchestrator.run.output" && entry.text && !STREAM_PLACEHOLDERS.has(entry.text)) {
    return `[overlay-benchmark] output=${clipText(entry.text, 240)}`
  }
  if (entry.type === "orchestrator.run.progress") {
    const detail = entry.summary || entry.text || entry.progressType || entry.status
    if (!detail || STREAM_PLACEHOLDERS.has(detail)) return ""
    return `[overlay-benchmark] progress-event=${clipText(detail, 240)}`
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
  const line = formatEventLine(entry)
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
  const timeoutSignal = AbortSignal.timeout(requestTimeoutMs)
  const signal = init?.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal
  const res = await fetch(url, {
    ...init,
    signal,
  })
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
  logLine(`[overlay-benchmark] directory=${overlay.directory} saved=${overlay.savedDirectory}`)
  marks.submittedAt = Date.now()
  taskID = await api("/task", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      title: TASK_TITLE,
      request: TASK_REQUEST,
      executor,
      budget: {
        maxWallTimeMs: undefined,
        maxRuns,
        maxReplans,
        maxEvaluations,
      },
      routing: benchmarkRoutingForExecutor(executor),
      checks: {
        build: false,
        lint: false,
        test: false,
        verify_cmd: false,
        spec_check: {
          enabled: false,
        },
      },
      goals: TASK_GOALS,
      ...(DELIVERY_VERIFY_CMD ? { metadata: { delivery_verify_cmd: DELIVERY_VERIFY_CMD } } : {}),
    }),
  })
    .then((res) => res.json())
    .then((body) => String(body.task_id || ""))
  if (!taskID) throw new Error("Task creation did not return task_id")
  eventStream = subscribeTaskEvents(taskID)

  planning = await waitForPlanningVisible(page, api, PLANNING_VISIBLE_TIMEOUT_MS)
  marks.planningAt = Date.now()

  taskID = await waitForTaskCreated(page, api, TASK_CREATE_TIMEOUT_MS)
  marks.createdAt = Date.now()
  // Budget is already set during task creation; PATCH /budget is optional
  await api(`/task/${taskID}/budget`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      budget: {
        maxWallTimeMs: undefined,
        maxRuns,
        maxReplans,
        maxEvaluations,
      },
    }),
  }).catch(() => undefined)
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
  streaming = await waitForStreamingVisible(page, PLANNING_VISIBLE_TIMEOUT_MS)
  marks.streamingAt = Date.now()
  page = await verifyResume(browser, page, server.url.origin, taskID, temp.dir, api)
  marks.resumedAt = Date.now()
  board = await api(`/task/${taskID}/board?sync=1`).then((res) => res.json())

  progress = await waitForFinal(taskID, stallTimeoutMs, api, completionHardTimeoutMs)
  marks.completedAt = Date.now()
  finalBoard = taskID ? await api(`/task/${taskID}/board?sync=1`).then((res) => res.json()).catch(() => board) : board

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
  logLine(JSON.stringify(out, null, 2))
  logLine(`report: ${reportFile}`)
  logLine(`events: ${eventFile}`)
  logLine(`events_ndjson: ${eventLogFile}`)

  const pass = out.assertions.planning_visible.pass && out.assertions.streaming_visible.pass && out.assertions.materialized.pass && out.assertions.delivery.pass && out.failure_matrix.verdict === "accepted"
  if (!pass) {
    process.exit(1)
  }
} catch (error) {
  if (!marks.completedAt) marks.completedAt = Date.now()
  const out = await buildBenchmarkReport(error)
  await flushed
  await Bun.write(eventFile, JSON.stringify({
    generated_at: new Date().toISOString(),
    taskID,
    error: String(error),
    event_count: events.length,
    stage_summary: summarizeEvents(events, taskID),
    events,
  }, null, 2))
  await Bun.write(reportFile, JSON.stringify(out, null, 2))
  errorLine(JSON.stringify(out, null, 2))
  errorLine(`report: ${reportFile}`)
  errorLine(`events: ${eventFile}`)
  errorLine(`events_ndjson: ${eventLogFile}`)
  process.exitCode = 1
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
  await cleanup("page.close", () => page.close().catch(() => undefined))
  await cleanup("browser.close", () => browser.close().catch(() => undefined), () => browser.process()?.kill("SIGKILL"))
  await cleanup("server.stop", () => server.stop(true))
  await cleanup("instance.disposeAll", () => Instance.disposeAll().catch(() => undefined))
  if (!keep && temp.dir) await cleanup("temp.dir", () => fs.rm(temp.dir, { recursive: true, force: true }).catch(() => undefined))
  if (!keep && temp.home) await cleanup("temp.home", () => fs.rm(temp.home, { recursive: true, force: true }).catch(() => undefined))
  process.exit(process.exitCode ?? 0)
}

async function scaffoldProject(dir: string, model: string) {
  await fs.mkdir(path.join(dir, "src"), { recursive: true })
  await fs.mkdir(path.join(dir, "data"), { recursive: true })
  await fs.mkdir(path.join(dir, ".opencorvus"), { recursive: true })
  await fs.mkdir(temp.config, { recursive: true })
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
  const providerID = model.split("/")[0] || "openai"
  const config = JSON.stringify(
    {
      $schema: "https://opencorvus.ai/config.json",
      model,
      experimental: {
        unattended: true,
      },
      lsp: {
        biome: {
          disabled: true,
        },
        eslint: {
          disabled: true,
        },
      },
      provider: {
        [providerID]: {
          options: {
            timeout: requestTimeoutMs,
          },
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

async function runLocalVerify(cwd: string, cmd: string) {
  if (!cmd) {
    return {
      mode: "skipped",
      command: null,
      exitCode: 0,
      stdout: "",
      stderr: "",
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
  }
}

async function buildBenchmarkReport(error?: unknown) {
  const reportError = error ? String(error) : undefined
  const completedAt = marks.completedAt || Date.now()
  const currentBoard = board ?? (taskID ? await tryApiJson(`/task/${taskID}/board?sync=1`) : null)
  const currentFinalBoard = finalBoard ?? (taskID
    ? await tryApiJson(`/task/${taskID}/board?sync=1`, currentBoard)
    : currentBoard)
  const currentTranscript = transcript ?? (taskID ? await tryApiJson(`/task/${taskID}/transcript`, []) : [])
  const currentTimeline = timeline ?? (taskID ? await tryApiJson(`/control/timeline?taskID=${encodeURIComponent(taskID)}`, []) : [])
  const currentRuns = runs ?? (taskID ? await tryApiJson(`/task/${taskID}/runs`, []) : [])
  const localVerify = await runLocalVerify(temp.dir, DELIVERY_VERIFY_CMD)
  const deliveryChangedFiles = progress?.delivery?.result?.changedFiles ?? currentFinalBoard?.delivery?.result?.changedFiles ?? []
  // Always run git fallback: delivery changedFiles may only contain internal .opencorvus/ files
  // while actual source files are in committed diffs (executor commits before delivery).
  const gitFallbackFiles = await gitChangedFiles(temp.dir)
  const changedFiles = dedupePaths([...deliveryChangedFiles, ...gitFallbackFiles])
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
    localVerifyExitCode: localVerify.exitCode,
  }), reportError)
  const screenshot = await takeBenchmarkScreenshot(page)
  const currentOverlay = await overlaySnapshot(page).catch((cause) => ({ error: String(cause) }))

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
    stage_timeout_ms: {
      spec: specTimeoutMs,
      planner: plannerTimeoutMs,
      tool: toolTimeoutMs,
      standby: standbyTimeoutMs,
      stall: stallTimeoutMs,
      request: requestTimeoutMs,
    },
    stage_max_steps: {
      spec: specMaxSteps,
      planner: plannerMaxSteps,
    },
    stall_timeout_ms: stallTimeoutMs,
    completion_hard_timeout_ms: completionHardTimeoutMs || null,
    request_timeout_ms: requestTimeoutMs,
    taskStatus: progress?.task?.status || currentFinalBoard?.task?.status || "",
    evaluation: progress?.evaluation?.verdict || currentFinalBoard?.evaluation?.verdict || "",
    changedFiles,
    transcriptCount: Array.isArray(currentTranscript) ? currentTranscript.length : 0,
    timelineCount: Array.isArray(currentTimeline) ? currentTimeline.length : 0,
    runCount: Array.isArray(currentRuns) ? currentRuns.length : 0,
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
      goalCount: (() => {
        const lane = Array.isArray(currentBoard?.lanes) ? currentBoard.lanes.find((l: any) => l.id === "goals") : undefined
        return Array.isArray(lane?.cards) ? lane.cards.length : 0
      })(),
      goalRunCount: Array.isArray(currentBoard?.goalRuns) ? currentBoard.goalRuns.length : 0,
      criteriaCount: (() => {
        const evalChecks = currentBoard?.evaluation?.checks
        return Array.isArray(evalChecks) ? evalChecks.length : 0
      })(),
    },
    screenshot,
    resume: {
      restored: marks.resumedAt > 0,
      selectedAt: elapsedOrNull(marks.resumedAt),
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
        pass: !!taskID && (currentBoard?.task?.id || "") === taskID && marks.resumedAt > 0,
        sample: {
          taskID,
          boardTaskID: currentBoard?.task?.id || "",
          resumed: marks.resumedAt > 0,
        },
      },
      delivery: {
        pass: (progress?.task?.status || currentFinalBoard?.task?.status) === "completed" &&
            (progress?.evaluation?.verdict || currentFinalBoard?.evaluation?.verdict) === "accepted" &&
            localVerify.exitCode === 0 &&
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
    },
  }
}

async function tryApiJson(pathname: string, fallback: unknown = null) {
  try {
    return await api(pathname).then((res) => res.json())
  } catch {
    return fallback
  }
}

function applyBenchmarkErrorVerdict(base: ReturnType<typeof evaluateQualityGates>, error?: string) {
  if (!error || !/(did not finish within|timed out|timeout|stall)/i.test(error)) return base
  if (base.failures.some((item) => item.category === "liveness")) {
    return {
      ...base,
      verdict: "blocked" as const,
      primary_failure: "liveness" as const,
      manual_review_summary: `liveness: Benchmark timed out before task completion | ${base.manual_review_summary}`,
    }
  }
  const failure = {
    category: "liveness" as const,
    message: "Benchmark timed out before task completion",
    evidence: error,
  }
  const failures = [failure, ...base.failures]
  return {
    verdict: "blocked" as const,
    primary_failure: "liveness" as const,
    failures,
    manual_review_summary: failures.map((item) => `${item.category}: ${item.message}`).join(" | "),
  }
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

/** Fallback: compute changed+untracked files directly from project git when delivery result is empty. */
async function gitChangedFiles(dir: string): Promise<string[]> {
  try {
    const run = (args: string[]) =>
      Bun.spawn(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" })
        .stdout.text().then((t) => t.trim().split(/\r?\n/).filter(Boolean))
        .catch(() => [] as string[])
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
  } catch {
    return []
  }
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
    errorLine(`[cleanup] ${label}: ${String(error)}`)
    await force?.()
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function waitForFinal(
  taskID: string,
  stallTimeoutMs: number,
  api: (pathname: string, init?: RequestInit) => Promise<Response>,
  completionHardTimeoutMs = 0,
) {
  const startedAt = Date.now()
  let lastStatus = ""
  while (true) {
    let progress = await api(`/task/${taskID}/progress`).then((res) => res.json())
    progress = await settle(progress, api)
    if (FINAL.has(progress.task.status)) return progress
    const signature = progressSignature(progress)
    if (signature !== lastProgressSignature) {
      lastProgressSignature = signature
      lastProgressAt = Date.now()
      activityLine(`[overlay-benchmark] progress=${signature}`)
    }
    if (progress.task.status !== lastStatus) {
      lastStatus = progress.task.status
      activityLine(`[overlay-benchmark] status=${lastStatus}`)
    }
    const now = Date.now()
    const silentFor = inactivityAgeMs(now, lastEventAt, lastProgressAt)
    const logSilentFor = inactivityAgeMs(now, lastActivityLogAt)
    // Use a separate (usually longer) stall timeout during the planning phase.
    // In "planning" status the task shows no progress changes while the spec agent
    // is actively making tool calls, so the normal stallTimeoutMs causes false stalls.
    const taskStatus = progress?.task?.status || ""
    const pipelineStatuses = ["queued", "spec_generating", "goal_decomposing", "planning", "planned"]
    const effectiveStallMs = pipelineStatuses.includes(taskStatus) ? planningStallTimeoutMs : stallTimeoutMs
    if (now - lastHeartbeatAt >= 60_000) {
      lastHeartbeatAt = now
      logLine(
        `[overlay-benchmark] heartbeat status=${taskStatus} signal_age_ms=${silentFor} activity_log_age_ms=${logSilentFor} log_age_ms=${now - lastLogAt} effective_stall_ms=${effectiveStallMs} last_progress=${lastProgressSignature || "none"}`,
      )
    }
    if (silentFor >= effectiveStallMs || logSilentFor >= effectiveStallMs) {
      throw new Error(
        `Task stalled: no event/progress change for ${effectiveStallMs}ms or no activity log output for ${effectiveStallMs}ms (status: ${taskStatus}, last progress: ${lastProgressSignature || "none"}, activity log age: ${logSilentFor}ms, last log age: ${now - lastLogAt}ms)`,
      )
    }
    if (completionHardTimeoutMs > 0 && (now - startedAt) >= completionHardTimeoutMs) {
      throw new Error(`Task exceeded optional hard completion timeout of ${completionHardTimeoutMs}ms`)
    }
    await Bun.sleep(2_000)
  }
}

function progressSignature(progress: any) {
  return JSON.stringify({
    task: progress?.task?.status || "",
    run: progress?.run?.status || progress?.activeRun?.status || "",
    phase: progress?.run?.phase || progress?.activeRun?.phase || "",
    verdict: progress?.evaluation?.verdict || "",
    delivery: progress?.delivery?.status || "",
    goals: Array.isArray(progress?.goalRuns)
      ? progress.goalRuns.map((item: any) => `${item.goal_id || item.goalID || item.id || "goal"}:${item.status || ""}:${item.phase || ""}`)
      : [],
    pending: Array.isArray(progress?.pendingInteractions)
      ? progress.pendingInteractions.map((item: any) => `${item.id || "interaction"}:${item.type || ""}:${item.status || ""}`)
      : [],
  })
}

async function waitForPlanningVisible(
  page: Page,
  api: (pathname: string, init?: RequestInit) => Promise<Response>,
  timeoutMs: number,
) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const overlay = await overlaySnapshot(page)
    if (overlay.pendingCount > 0 || overlay.selectedTaskID || overlay.taskIDs[0]) return overlay
    const board = await api("/tasks").then((res) => res.json()).catch(() => null)
    const taskID = Array.isArray(board?.tasks) ? board.tasks[0]?.task?.id || "" : ""
    if (taskID) return { ...overlay, taskIDs: [taskID, ...overlay.taskIDs].filter(Boolean).slice(0, 5) }
    await Bun.sleep(250)
  }
  throw new Error(`Overlay did not expose planning state within ${timeoutMs}ms: ${JSON.stringify(await debugSnapshot(page, api))}`)
}

async function waitForStreamingVisible(page: Page, timeoutMs: number) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const overlay = await overlaySnapshot(page)
    if (meaningfulLiveText(overlay.reasoning)) return overlay
    if (meaningfulLiveText(overlay.assistantText)) return overlay
    if (meaningfulLiveText(overlay.liveText)) return overlay
    await Bun.sleep(250)
  }
  throw new Error(`Overlay did not render streamed task output within ${timeoutMs}ms`)
}

async function waitForTaskCreated(page: Page, api: (pathname: string, init?: RequestInit) => Promise<Response>, timeoutMs: number) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const overlay = await overlaySnapshot(page)
    if (overlay.selectedTaskID) return overlay.selectedTaskID
    if (overlay.taskIDs[0]) return overlay.taskIDs[0]
    const board = await api("/tasks").then((res) => res.json()).catch(() => null)
    const taskID = Array.isArray(board?.tasks) ? board.tasks[0]?.task?.id || "" : ""
    if (taskID) return taskID
    await Bun.sleep(1_000)
  }
  throw new Error(`Overlay did not create a task within ${timeoutMs}ms: ${JSON.stringify(await debugSnapshot(page, api))}`)
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
    localStorage.setItem("oc_unattended", "true")
    localStorage.setItem("oc_auto_permission", "true")
    localStorage.setItem("oc_auto_question", "true")
  }, serverUrl, directory, taskID)
  await next.goto(new URL("/ui/index.html", serverUrl).toString(), { waitUntil: "load" })
  await next.waitForFunction(() => document.querySelector("#connBadge")?.dataset.status === "online", { timeout: 60_000 })
  await syncDirectory(next, directory)
  await waitForTaskCreated(next, api, TASK_RESUME_TIMEOUT_MS)
  await next.evaluate(async (id) => {
    const state = window.eval("state")
    if (state.selectedTaskID === id && state.board?.task?.id === id) return
    await window.eval("selectTask")(id)
  }, taskID)
  await next.waitForFunction((id, dir) => {
    try {
      const state = window.eval("state")
      return state.directory === dir && state.board?.task?.id === id && state.workspaceTaskID === id
    } catch {
      return false
    }
  }, { timeout: TASK_RESUME_TIMEOUT_MS }, taskID, directory)
  await next.evaluate(async () => {
    try {
      await window.eval("persistOverlaySettings")()
      if (!window.eval("state").board?.task?.id) await window.eval("loadBoard")()
      await window.eval("loadConversation")()
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
      const visibleTurns = [...document.querySelectorAll(".turn[data-role]")]
        .map((node) => {
          const element = node as HTMLElement
          const role = element.dataset.role || ""
          const text = element.querySelector(".msg-body")?.textContent?.trim() || ""
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
      return {
        directory: state.directory || "",
        savedDirectory: state.savedDirectory || "",
        workspaceDirectory: state.workspaceDirectory || "",
        selectedTaskID: state.selectedTaskID || "",
        pendingCount: Array.isArray(state.pendingTasks) ? state.pendingTasks.length : 0,
        taskIDs: Array.isArray(state.tasks)
          ? state.tasks.map((item: { task?: { id?: string } }) => item?.task?.id || "").filter(Boolean).slice(0, 5)
          : [],
        taskList: document.querySelector("#taskListPanel")?.textContent?.trim() || "",
        reasoning: document.querySelector('.turn[data-role="assistant"] .reasoning-text')?.textContent?.trim() || "",
        assistantText: document.querySelector('.turn[data-role="assistant"] .msg-text')?.textContent?.trim() || "",
        liveRole: liveTurn.role,
        liveText: liveTurn.text,
        visibleTurns: visibleTurns.slice(-5),
        storage,
      }
    } catch (error) {
      return {
        directory: "",
        savedDirectory: "",
        workspaceDirectory: "",
        selectedTaskID: "",
        pendingCount: 0,
        taskIDs: [],
        taskList: "",
        reasoning: "",
        assistantText: "",
        liveRole: "",
        liveText: "",
        visibleTurns: [],
        storage: {},
        error: String(error),
      }
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
  const runEvents = filtered.filter((item) => item.type === "orchestrator.run.progress" || item.type === "orchestrator.run.output")
  const kinds = filtered.reduce<Record<string, number>>((map, item) => {
    const type = typeof item.type === "string" ? item.type : ""
    if (!type) return map
    map[type] = (map[type] ?? 0) + 1
    return map
  }, {})
  const stages = ["spec", "planner", "judge"].flatMap((stage) => {
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
