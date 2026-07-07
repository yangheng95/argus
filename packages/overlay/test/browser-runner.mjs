#!/usr/bin/env node
import { readdir } from "node:fs/promises"
import { spawn, spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const browserTestDir = new URL("./browser/", import.meta.url)
const DEFAULT_INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000

function parsePositiveInteger(value, name) {
  if (value === undefined || value === "") return DEFAULT_INACTIVITY_TIMEOUT_MS
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got ${value}`)
  }
  return parsed
}

const inactivityTimeoutMs = parsePositiveInteger(
  process.env.OPENCORVUS_OVERLAY_BROWSER_RUNNER_IDLE_MS,
  "OPENCORVUS_OVERLAY_BROWSER_RUNNER_IDLE_MS",
)

function collectWindowsDescendantPids(rootPid) {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress",
    ],
    {
      encoding: "utf8",
      windowsHide: true,
    },
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`powershell process enumeration exited with status ${result.status ?? "null"}`)
  }
  const records = result.stdout.trim() ? JSON.parse(result.stdout) : []
  const processes = Array.isArray(records) ? records : [records]
  const childrenByParent = new Map()
  for (const item of processes) {
    const pid = Number(item?.ProcessId)
    const parent = Number(item?.ParentProcessId)
    if (!Number.isInteger(pid) || !Number.isInteger(parent)) continue
    const list = childrenByParent.get(parent) ?? []
    list.push(pid)
    childrenByParent.set(parent, list)
  }
  const pending = [...(childrenByParent.get(rootPid) ?? [])]
  const descendants = []
  while (pending.length > 0) {
    const pid = pending.pop()
    if (!pid || descendants.includes(pid)) continue
    descendants.push(pid)
    pending.push(...(childrenByParent.get(pid) ?? []))
  }
  return descendants
}

let childClosed = false

function waitForChildClose(child, timeoutMs) {
  if (childClosed) return Promise.resolve(true)
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.off("close", onClose)
      resolve(value)
    }
    const onClose = () => finish(true)
    const timer = setTimeout(() => finish(childClosed), timeoutMs)
    child.once("close", onClose)
  })
}

async function terminateChildTree(child, reason, graceMs = 5_000) {
  if (!child.pid) return
  console.error(`overlay browser tests inactive for ${inactivityTimeoutMs}ms after ${reason}; terminating test process`)
  if (process.platform === "win32") {
    const descendantPids = collectWindowsDescendantPids(child.pid)
    const result = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    })
    if (result.error) throw result.error
    if (result.status !== 0 && !childClosed && descendantPids.length === 0) {
      throw new Error(`taskkill exited with status ${result.status ?? "null"}`)
    }
    for (const pid of descendantPids) {
      spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      })
    }
    if (!(await waitForChildClose(child, graceMs))) throw new Error("test process tree did not exit after taskkill")
    return
  }
  let signaled = false
  try {
    process.kill(-child.pid, "SIGTERM")
    signaled = true
  } catch (error) {
    if (!child.kill("SIGTERM")) throw error
    signaled = true
  }
  if (signaled && (await waitForChildClose(child, graceMs))) return
  try {
    process.kill(-child.pid, "SIGKILL")
  } catch (error) {
    if (!child.kill("SIGKILL")) throw error
  }
  if (!(await waitForChildClose(child, graceMs))) throw new Error("test process tree did not exit after SIGKILL")
}

const explicitFiles = process.argv.slice(2)
const files =
  explicitFiles.length > 0
    ? explicitFiles
    : (await readdir(browserTestDir, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && (entry.name.endsWith(".test.mjs") || entry.name.endsWith(".test.ts")))
        .map((entry) => fileURLToPath(new URL(entry.name, browserTestDir)))
        .sort()

if (files.length === 0) {
  throw new Error("No Node browser tests found under packages/overlay/test/browser")
}

const child = spawn(process.execPath, ["--test", "--test-concurrency=1", ...files], {
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER: "1",
  },
  detached: process.platform !== "win32",
  windowsHide: true,
})

let finished = false
let exitStatus = { code: 1, signal: null }
let lastActivity = "runner start"
let inactivityTimer
const resetInactivityTimer = (source) => {
  lastActivity = source
  if (inactivityTimer) clearTimeout(inactivityTimer)
  inactivityTimer = setTimeout(() => {
    if (finished) return
    finished = true
    void (async () => {
      try {
        await terminateChildTree(child, lastActivity)
      } catch (error) {
        console.error(
          `overlay browser test process cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      } finally {
        process.exit(1)
      }
    })()
  }, inactivityTimeoutMs)
}

child.stdout?.on("data", (chunk) => {
  process.stdout.write(chunk)
  resetInactivityTimer("stdout")
})
child.stderr?.on("data", (chunk) => {
  process.stderr.write(chunk)
  resetInactivityTimer("stderr")
})
resetInactivityTimer("runner start")

child.on("exit", (code, signal) => {
  if (finished) return
  exitStatus = { code: code ?? 1, signal }
  resetInactivityTimer("root process exit")
})

child.on("close", (code, signal) => {
  childClosed = true
  if (finished) return
  finished = true
  if (inactivityTimer) clearTimeout(inactivityTimer)
  const resolvedSignal = signal ?? exitStatus.signal
  if (resolvedSignal) {
    console.error(`overlay browser tests stopped by ${resolvedSignal}`)
    process.exit(1)
  }
  process.exit(code ?? exitStatus.code ?? 1)
})

child.on("error", (error) => {
  if (finished) return
  finished = true
  if (inactivityTimer) clearTimeout(inactivityTimer)
  console.error(`overlay browser tests failed to start: ${error.message}`)
  process.exit(1)
})
