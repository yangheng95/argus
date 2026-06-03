#!/usr/bin/env bun

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ensureStandaloneGitRepo } from "./git"
import {
  DEFAULT_MISSION_BENCHMARK_REQUEST,
  DEFAULT_MISSION_VERIFY_CMD,
  MISSION_BENCHMARK_TITLE,
  evaluateMissionBenchmarkReport,
  missionTaskRows,
  terminalMissionTasks,
  missionStateMentionsTerminalTasks,
  type MissionBenchmarkTask,
} from "./mission-scenario"

type Executor = "opencorvus" | "codex" | "claude-code"

const KNOWN_FLAGS = new Set([
  "--delivery-verify-cmd",
  "--executor",
  "--max-wait-ms",
  "--mission-id",
  "--poll-ms",
  "--project-dir",
  "--report",
  "--request-file",
  "--skip-local-verify",
  "--title",
  "--no-keep",
])

function flag(name: string): string | undefined {
  const eq = process.argv.find((item) => item.startsWith(`${name}=`))
  if (eq) return eq.slice(name.length + 1)
  const idx = process.argv.indexOf(name)
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1]
  return undefined
}

function validateFlags(): void {
  const unknown: string[] = []
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith("--")) continue
    const key = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg
    if (KNOWN_FLAGS.has(key)) {
      if (!arg.includes("=") && i + 1 < args.length && !args[i + 1].startsWith("--")) i += 1
      continue
    }
    unknown.push(arg)
  }
  if (unknown.length > 0) {
    throw new Error(`unknown mission benchmark flag(s): ${unknown.join(" ")}`)
  }
}

function stripWrappingQuotes(value: string | undefined): string | undefined {
  if (!value) return value
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return value
}

function parseExecutor(value: string | undefined): Executor {
  if (!value) return "opencorvus"
  if (value === "opencorvus" || value === "codex" || value === "claude-code") return value
  throw new Error(`unsupported executor: ${value}`)
}

function parsePositiveInt(name: string, defaultValue: number): number {
  const raw = flag(name)
  if (!raw) return defaultValue
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`)
  return Math.floor(value)
}

validateFlags()

const startedAt = Date.now()
const executor = parseExecutor(flag("--executor"))
const requestFile = stripWrappingQuotes(flag("--request-file"))
const reportFlag = stripWrappingQuotes(flag("--report"))
const projectDirFlag = stripWrappingQuotes(flag("--project-dir"))
const title = stripWrappingQuotes(flag("--title")) ?? MISSION_BENCHMARK_TITLE
const missionID = stripWrappingQuotes(flag("--mission-id")) ?? `mission-bench-${Date.now().toString(36)}`
const maxWaitMs = parsePositiveInt("--max-wait-ms", 45 * 60 * 1000)
const pollMs = parsePositiveInt("--poll-ms", 2_000)
const skipLocalVerify = process.argv.includes("--skip-local-verify")
const keep = !process.argv.includes("--no-keep")
const deliveryVerifyCmd = stripWrappingQuotes(flag("--delivery-verify-cmd")) ?? DEFAULT_MISSION_VERIFY_CMD

const temp = {
  home: await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-mission-benchmark-home-")),
  dir: projectDirFlag
    ? path.resolve(projectDirFlag)
    : await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-mission-benchmark-project-")),
  config: "",
}
temp.config = path.join(temp.home, "config-override")
const ownsProjectDir = !projectDirFlag

process.env.OPENCORVUS_HOME = temp.home
process.env.OPENCORVUS_CONFIG_DIR = temp.config
process.env.OPENCORVUS_AUTO_DISCOVER_EXECUTORS = "1"
process.env.OPENCORVUS_EXECUTOR_CLAUDE_PERMISSION_MODE = "bypassPermissions"

const defaultReportDir = path.resolve(import.meta.dir, "../../../..", ".scratch", "benchmark-runs")
const reportFile = reportFlag
  ? path.resolve(reportFlag)
  : path.join(defaultReportDir, `mission-benchmark-report-${Date.now()}.json`)
await fs.mkdir(path.dirname(reportFile), { recursive: true })

const requestText = requestFile
  ? await fs.readFile(path.resolve(requestFile), "utf8")
  : DEFAULT_MISSION_BENCHMARK_REQUEST
const missionPrompt = [
  requestText,
  "",
  `Benchmark driver constraint: when calling panel.create_task, set executor="${executor}".`,
].join("\n")

const reportApiErrors: string[] = []
let server: any
let finalExitCode = 1

function log(message: string): void {
  process.stdout.write(`[mission-benchmark] ${message}\n`)
}

function failReport(error: unknown) {
  return {
    generated_at: new Date().toISOString(),
    title,
    missionID,
    executor,
    directory: temp.dir,
    report: reportFile,
    error: error instanceof Error ? error.stack || error.message : String(error),
    elapsed_ms: Date.now() - startedAt,
    failure_matrix: {
      verdict: "rejected",
      failures: [error instanceof Error ? error.message : String(error)],
    },
    diagnostics: { report_api_errors: reportApiErrors },
  }
}

try {
  await copyAuthIntoTempHome(temp.home)
  const { ensureBenchmarkModel, loadBenchmarkEnv, prepareLocalProviders, resolveBenchmarkModel } = await import("./env")
  const { ExecutorBootstrap } = await import("../../src/executor/bootstrap")
  const { Instance } = await import("../../src/project/instance")
  const { InstanceBootstrap } = await import("../../src/project/bootstrap")
  const { Server } = await import("../../src/server/server")
  const { resetDatabase } = await import("../../test/fixture/db")
  const { Log } = await import("../../src/util/log")

  Log.init({ print: true })
  server = Server.listen({ port: 0, hostname: "127.0.0.1" })

  await loadBenchmarkEnv(import.meta.dir)
  await prepareLocalProviders()
  const model = await resolveBenchmarkModel(import.meta.dir)
  process.env.OPENCORVUS_BENCHMARK_MODEL = model
  await ensureBenchmarkModel(import.meta.dir, model)
  await resetDatabase()
  await scaffoldMissionProject(temp.dir, temp.config, model)
  await prepareLocalProviders()

  await Instance.provide({
    directory: temp.dir,
    init: InstanceBootstrap,
    fn: async () => {
      await ExecutorBootstrap.autoRegister(true)
    },
  })

  log(`server=${server.url}`)
  log(`project=${temp.dir}`)
  log(`missionID=${missionID}`)
  log(`model=${model} executor=${executor}`)

  const firstWake = await wakeMission({
    missionID,
    text: missionPrompt,
    title,
  })
  if (!firstWake.created) throw new Error(`first wake unexpectedly resumed existing mission ${missionID}`)
  log(`first wake session=${firstWake.sessionID}`)

  const dispatched = await waitForMissionDispatch(missionID)
  log(`mission dispatched ${dispatched.length} task(s): ${dispatched.map((item) => item.task?.id).join(", ")}`)

  const terminal = await waitForMissionTerminalTasks(missionID)
  log(`terminal mission tasks: ${terminal.map((item) => `${item.task?.id}:${item.task?.status}`).join(", ")}`)

  const secondWake = await wakeMission({
    missionID,
    text: [
      `Reconcile mission ${missionID}.`,
      `The dispatched task IDs are: ${terminal.map((item) => item.task?.id).filter(Boolean).join(", ")}.`,
      "Use panel.query_task, update tasks.md/frontier.md/notes.md, then write handoff.md with the current acceptance status.",
    ].join("\n"),
    title,
  })
  if (secondWake.created) throw new Error(`second wake created a new mission instead of resuming ${missionID}`)
  log(`second wake resumed session=${secondWake.sessionID}`)

  const missionState = await waitForMissionReconciliation(missionID, terminal)
  await waitForSessionSettled(secondWake.sessionID)
  const latestBoard = await apiJson("/tasks?limit=50")
  const missionTasks = missionTaskRows(latestBoard, missionID)
  const localVerify = skipLocalVerify
    ? skippedVerify(deliveryVerifyCmd)
    : await runLocalVerify(temp.dir, deliveryVerifyCmd)

  const verdict = evaluateMissionBenchmarkReport({
    missionID,
    sessionID: firstWake.sessionID,
    firstWakeCreated: firstWake.created,
    secondWakeCreated: secondWake.created,
    missionState,
    missionTasks,
    localVerify,
  })

  const out = {
    generated_at: new Date().toISOString(),
    title,
    request_file: requestFile ? path.resolve(requestFile) : null,
    executor,
    model,
    directory: temp.dir,
    server: server.url.toString(),
    missionID,
    sessionID: firstWake.sessionID,
    elapsed_ms: Date.now() - startedAt,
    wakes: {
      first: firstWake,
      second: secondWake,
    },
    mission_state: summarizeMissionState(missionState),
    mission_tasks: missionTasks.map((item) => ({
      id: item.task?.id ?? "",
      source: item.task?.source ?? "",
      status: item.task?.status ?? "",
      evaluation: item.evaluation?.verdict ?? null,
      metadata: item.task?.metadata ?? {},
    })),
    local_verify: localVerify,
    failure_matrix: verdict,
    diagnostics: {
      report_api_errors: reportApiErrors,
    },
  }

  await fs.writeFile(reportFile, JSON.stringify(out, null, 2))
  log(JSON.stringify(out, null, 2))
  log(`report: ${reportFile}`)
  finalExitCode = verdict.verdict === "accepted" ? 0 : 1
} catch (error) {
  const out = failReport(error)
  await fs.writeFile(reportFile, JSON.stringify(out, null, 2)).catch(() => undefined)
  log(JSON.stringify(out, null, 2))
  log(`report: ${reportFile}`)
  finalExitCode = 1
} finally {
  const { Instance } = await import("../../src/project/instance")
  await Instance.disposeAll().catch(() => undefined)
  if (server) await server.stop(true).catch(() => undefined)
  if (!keep) {
    await fs.rm(temp.home, { recursive: true, force: true }).catch(() => undefined)
    if (ownsProjectDir) await fs.rm(temp.dir, { recursive: true, force: true }).catch(() => undefined)
  }
  process.exit(finalExitCode)
}

async function wakeMission(input: {
  missionID: string
  text: string
  title: string
}): Promise<{ missionID: string; sessionID: string; created: boolean }> {
  const res = await api("/mission/wake", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(`/mission/wake failed ${res.status}: ${await res.text()}`)
  return await res.json()
}

async function waitForMissionDispatch(id: string): Promise<MissionBenchmarkTask[]> {
  return waitFor(`mission ${id} to dispatch a task`, async () => {
    const board = await apiJson("/tasks?limit=50")
    const rows = missionTaskRows(board, id)
    return rows.length > 0 ? rows : undefined
  })
}

async function waitForMissionTerminalTasks(id: string): Promise<MissionBenchmarkTask[]> {
  return waitFor(`mission ${id} dispatched task to reach terminal state`, async () => {
    const board = await apiJson("/tasks?limit=50")
    const rows = missionTaskRows(board, id)
    if (rows.length === 0) return undefined
    const terminal = terminalMissionTasks(rows)
    return terminal.length === rows.length ? terminal : undefined
  })
}

async function waitForMissionReconciliation(
  id: string,
  terminalTasks: MissionBenchmarkTask[],
): Promise<Record<string, string>> {
  return waitFor(`mission ${id} reconciliation state`, async () => {
    const state = await readMissionState(id)
    return missionStateMentionsTerminalTasks(state, terminalTasks) ? state : undefined
  })
}

async function waitForSessionSettled(sessionID: string): Promise<void> {
  const { SessionStatus } = await import("../../src/session")
  await waitFor(`mission session ${sessionID} to settle`, async () => {
    const status = SessionStatus.get(sessionID)
    return status.type === "streaming" || status.type === "retry" ? undefined : true
  })
}

async function readMissionState(id: string): Promise<Record<string, string>> {
  const files = ["frontier.md", "tasks.md", "handoff.md", "notes.md"]
  return Object.fromEntries(await Promise.all(files.map(async (file) => [file, await readMissionFile(id, file)])))
}

async function waitFor<T>(label: string, fn: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + maxWaitMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const result = await fn()
      if (result !== undefined) return result
    } catch (error) {
      lastError = error
    }
    await Bun.sleep(pollMs)
  }
  throw new Error(`timed out waiting for ${label}${lastError ? `: ${lastError instanceof Error ? lastError.message : String(lastError)}` : ""}`)
}

async function readMissionFile(id: string, file: string): Promise<string> {
  return fs.readFile(path.join(temp.dir, ".opencorvus", "runtime", "mission", id, file), "utf8").catch(() => "")
}

async function api(pathname: string, init: RequestInit = {}) {
  if (!server) throw new Error("server not started")
  const url = new URL(pathname, server.url)
  const headers = new Headers(init.headers)
  headers.set("x-opencorvus-directory", temp.dir)
  return fetch(url, { ...init, headers })
}

async function apiJson(pathname: string) {
  const res = await api(pathname)
  if (!res.ok) {
    const message = `${pathname}: ${res.status} ${await res.text()}`
    reportApiErrors.push(message)
    throw new Error(message)
  }
  return await res.json()
}

async function scaffoldMissionProject(dir: string, configDir: string, model: string): Promise<void> {
  await fs.mkdir(path.join(dir, "src"), { recursive: true })
  await fs.mkdir(path.join(dir, ".opencorvus"), { recursive: true })
  await fs.mkdir(configDir, { recursive: true })
  await gitInit(dir)
  await writeIfMissing(path.join(dir, ".gitignore"), ["node_modules/", "dist/", ".opencorvus/runtime/", "*.log", ""].join("\n"))
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "mission-benchmark-project", private: true, type: "module", scripts: { test: "bun test" } }, null, 2),
  )
  await fs.writeFile(
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
  await writeBenchmarkConfig(dir, configDir, model)
}

async function writeBenchmarkConfig(dir: string, configDir: string, model: string): Promise<void> {
  const config = JSON.stringify(
    {
      $schema: "https://opencorvus.ai/config.json",
      model,
      experimental: { auto_question: true },
      lsp: {
        biome: { disabled: true },
        eslint: { disabled: true },
      },
      assistant: {
        debug: { fail_on_information_missing: true },
      },
    },
    null,
    2,
  )
  await fs.writeFile(path.join(dir, "opencorvus.json"), config)
  await fs.writeFile(path.join(dir, ".opencorvus", "opencorvus.json"), config)
  await fs.writeFile(path.join(configDir, "opencorvus.json"), config)
}

async function gitInit(dir: string): Promise<void> {
  await ensureStandaloneGitRepo(dir)
}

async function writeIfMissing(file: string, content: string): Promise<void> {
  if (await Bun.file(file).exists()) return
  await fs.writeFile(file, content)
}

async function copyAuthIntoTempHome(home: string): Promise<void> {
  const appData = process.env.APPDATA || process.env.LOCALAPPDATA
  const realDataDir = process.platform === "win32" && appData
    ? path.join(appData, "opencorvus")
    : path.join(os.homedir(), ".local", "share", "opencorvus")
  const realAuth = path.join(realDataDir, "auth.json")
  const tempDataDir = path.join(home, "data")
  await fs.mkdir(tempDataDir, { recursive: true })
  await fs.copyFile(realAuth, path.join(tempDataDir, "auth.json")).catch(() => undefined)
}

async function runLocalVerify(cwd: string, cmd: string) {
  if (!cmd) return skippedVerify(cmd)
  const shell = process.platform === "win32" ? ["cmd", "/c", cmd] : ["bash", "-lc", cmd]
  const proc = Bun.spawn(shell, { cwd, stdout: "pipe", stderr: "pipe" })
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  return {
    mode: "command",
    command: cmd,
    exitCode,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    status: "completed",
  }
}

function skippedVerify(command: string) {
  return {
    mode: "skipped",
    command: command || null,
    exitCode: null,
    stdout: "",
    stderr: "",
    status: "not_run",
  }
}

function summarizeMissionState(state: Record<string, string>) {
  return Object.fromEntries(Object.entries(state).map(([file, content]) => [
    file,
    {
      bytes: Buffer.byteLength(content),
      preview: content.slice(0, 800),
    },
  ]))
}
