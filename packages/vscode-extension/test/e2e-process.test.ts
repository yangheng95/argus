import { describe, expect, test } from "bun:test"
import { spawn } from "node:child_process"
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { waitForEvent, watchEventLogActivity } from "../script/e2e-event-log"
import { terminateOwnedProcessTree } from "../script/process-tree"

const runnerPath = path.resolve(import.meta.dir, "..", "script", "e2e-vscode.ts")
const benchmarkPath = path.resolve(import.meta.dir, "..", "script", "benchmark-100-rounds.ts")

describe("VS Code E2E process cleanup", () => {
  test("runner failure paths use owned process-tree cleanup", async () => {
    const source = await readFile(runnerPath, "utf8")

    expect(source).toContain('terminateOwnedProcessTree(child, "VS Code E2E")')
    expect(source).toContain('detached: process.platform !== "win32"')
    expect(source).toContain("watchEventLogActivity(options.eventLogFile, resetIdle)")
    expect(source).not.toContain('child.kill("SIGTERM")')
  })

  test("Windows PowerShell cleanup delegates are bounded", async () => {
    const source = await readFile(path.resolve(import.meta.dir, "..", "script", "process-tree.ts"), "utf8")

    expect(source).toContain("const WINDOWS_POWERSHELL_CLEANUP_TIMEOUT_MS = 5_000")
    expect(source).toContain("PowerShell cleanup timed out after")
    expect(source).toContain("runner.kill()")
    expect(source).toContain("clearTimeout(timer)")
  })

  test("Windows visual screenshot capture is bounded", async () => {
    const source = await readFile(runnerPath, "utf8")

    expect(source).toContain("const WINDOWS_SCREEN_CAPTURE_TIMEOUT_MS = 15_000")
    expect(source).toContain("timeout: WINDOWS_SCREEN_CAPTURE_TIMEOUT_MS")
  })

  test("100-round benchmark uses owned process-tree cleanup for idle timeouts", async () => {
    const source = await readFile(benchmarkPath, "utf8")

    expect(source).toContain('terminateOwnedProcessTree(proc, `VS Code 100-round benchmark ${name}`)')
    expect(source).toContain('detached: process.platform !== "win32"')
    expect(source).not.toContain("Bun.spawn")
    expect(source).not.toContain("proc.kill()")
  })

  test("terminates ignored-stdio descendants", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "oc-vscode-e2e-process-"))
    const childProcessIDFile = path.join(root, "child.pid")
    const rootScript = path.join(root, "root.cjs")
    await writeFile(
      rootScript,
      `
const { spawn } = require("node:child_process")
const fs = require("node:fs")
const child = spawn(process.execPath, [
  "-e",
  "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"
], {
  stdio: "ignore",
  windowsHide: true
})
fs.writeFileSync(${JSON.stringify(childProcessIDFile)}, String(child.pid))
process.on("SIGTERM", () => {})
setInterval(() => {}, 1000)
`,
    )

    const processHandle = spawn(process.execPath, [rootScript], {
      cwd: root,
      stdio: "ignore",
      detached: process.platform !== "win32",
      windowsHide: true,
    })

    try {
      const childProcessID = await waitForProcessIDFile(childProcessIDFile)
      await terminateOwnedProcessTree(processHandle, "VS Code E2E test", { graceMs: 80 })
      await waitForProcessExit(processHandle.pid, "root")
      await waitForProcessExit(childProcessID, "descendant")
    } finally {
      await terminateOwnedProcessTree(processHandle, "VS Code E2E test cleanup", { graceMs: 80 }).catch(
        () => undefined,
      )
      await rm(root, { recursive: true, force: true })
    }
  }, 10_000)

  test("visual event wait resets timeout after event-log activity", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "oc-vscode-e2e-event-log-"))
    const eventsFile = path.join(root, "events.jsonl")
    const startedAt = Date.now()
    try {
      const wait = waitForEvent(eventsFile, "visual.ready", 250)
      await Bun.sleep(70)
      await appendFile(eventsFile, `${JSON.stringify({ type: "suite.progress", step: 1 })}\n`)
      await Bun.sleep(70)
      await appendFile(eventsFile, `${JSON.stringify({ type: "suite.progress", step: 2 })}\n`)
      await Bun.sleep(70)
      await appendFile(eventsFile, `${JSON.stringify({ type: "visual.ready" })}\n`)

      await wait
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(180)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test("event-log activity watcher reports file progress without console output", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "oc-vscode-e2e-event-watch-"))
    const eventsFile = path.join(root, "events.jsonl")
    let activityCount = 0
    try {
      const stop = watchEventLogActivity(eventsFile, () => {
        activityCount += 1
      }, 20)
      await appendFile(eventsFile, `${JSON.stringify({ type: "suite.progress", step: 1 })}\n`)
      await Bun.sleep(60)
      await appendFile(eventsFile, `${JSON.stringify({ type: "suite.progress", step: 2 })}\n`)
      await Bun.sleep(60)
      stop()

      expect(activityCount).toBeGreaterThanOrEqual(2)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

async function waitForProcessIDFile(file: string): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const value = Number((await readFile(file, "utf8")).trim())
      if (Number.isInteger(value) && value > 0) return value
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
    await Bun.sleep(20)
  }
  throw new Error(`timed out waiting for process ID file ${file}`)
}

async function waitForProcessExit(processID: number | undefined, label: string): Promise<void> {
  if (!processID) throw new Error(`${label} process did not expose a process ID`)
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (!processAlive(processID)) return
    await Bun.sleep(20)
  }
  throw new Error(`${label} process ${processID} was still alive after cleanup`)
}

function processAlive(processID: number): boolean {
  try {
    process.kill(processID, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ESRCH") return false
    return code === "EPERM"
  }
}

function isNotFound(error: unknown): boolean {
  return error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"
}
