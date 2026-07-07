import { spawn, type ChildProcess } from "node:child_process"

const DEFAULT_TERMINATION_GRACE_MS = 2_000
const WINDOWS_POWERSHELL_CLEANUP_TIMEOUT_MS = 5_000
const POLL_MS = 25

function processExited(processHandle: ChildProcess): boolean {
  return processHandle.exitCode !== null || processHandle.signalCode !== null
}

function processGroupIsRunning(processID: number): boolean {
  try {
    process.kill(-processID, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ESRCH") return false
    return code === "EPERM"
  }
}

function signalProcessGroup(processID: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-processID, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return
    throw error
  }
}

async function waitForProcessGroupExit(processID: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!processGroupIsRunning(processID)) return true
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  return !processGroupIsRunning(processID)
}

async function waitForRootExit(processHandle: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (processExited(processHandle)) return true
  return await new Promise<boolean>((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      processHandle.off("exit", onExit)
      resolve(false)
    }, timeoutMs)
    if (typeof timer.unref === "function") timer.unref()
    const onExit = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(true)
    }
    processHandle.once("exit", onExit)
  })
}

async function terminateWindowsProcessTree(processID: number, label: string, graceMs: number): Promise<void> {
  const script = `
$ErrorActionPreference = "Stop"
$root = ${processID}
$processes = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
$children = @{}
foreach ($process in $processes) {
  $parent = [int]$process.ParentProcessId
  if (-not $children.ContainsKey($parent)) {
    $children[$parent] = New-Object System.Collections.Generic.List[int]
  }
  $children[$parent].Add([int]$process.ProcessId)
}
$queue = New-Object System.Collections.Generic.Queue[int]
$seen = New-Object System.Collections.Generic.HashSet[int]
$targets = New-Object System.Collections.Generic.List[int]
$queue.Enqueue([int]$root)
while ($queue.Count -gt 0) {
  $current = $queue.Dequeue()
  if (-not $seen.Add($current)) { continue }
  if ($current -eq $root) {
    foreach ($process in $processes) {
      if ([int]$process.ProcessId -eq [int]$root) {
        $targets.Add([int]$root)
        break
      }
    }
  }
  if (-not $children.ContainsKey($current)) { continue }
  foreach ($child in $children[$current]) {
    $targets.Add([int]$child)
    $queue.Enqueue([int]$child)
  }
}
$unique = @($targets | Sort-Object -Unique)
if ($unique.Count -gt 0) {
  foreach ($target in $unique) {
    Stop-Process -Id $target -Force -ErrorAction SilentlyContinue
  }
  $unique | ConvertTo-Json -Compress
} else {
  Write-Output "[]"
}
`
  const stopped = await runWindowsPowerShellForProcessIDs(script, label)
  await waitForWindowsProcessIDsExit(stopped, graceMs, label)
}

async function runWindowsPowerShellForProcessIDs(script: string, label: string): Promise<number[]> {
  const output = await new Promise<string>((resolve, reject) => {
    const runner = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    let settled = false
    let stdout = ""
    let stderr = ""
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    const timer = setTimeout(() => {
      runner.kill()
      settle(() =>
        reject(new Error(`${label} PowerShell cleanup timed out after ${WINDOWS_POWERSHELL_CLEANUP_TIMEOUT_MS}ms`)),
      )
    }, WINDOWS_POWERSHELL_CLEANUP_TIMEOUT_MS)
    if (typeof timer.unref === "function") timer.unref()
    runner.stdout.setEncoding("utf8")
    runner.stderr.setEncoding("utf8")
    runner.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    runner.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    runner.once("exit", (code, signal) => {
      settle(() => {
        if (code === 0) resolve(stdout)
        else reject(new Error(`${label} PowerShell cleanup exited with ${signal ?? code}: ${stderr.trim()}`))
      })
    })
    runner.once("error", (error) => settle(() => reject(error)))
  })
  const trimmed = output.trim()
  if (!trimmed) return []
  const parsed = JSON.parse(trimmed) as number | number[]
  return (Array.isArray(parsed) ? parsed : [parsed]).filter((value) => Number.isInteger(value) && value > 0)
}

async function waitForWindowsProcessIDsExit(pids: number[], timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (pids.every((pid) => !processIDIsRunning(pid))) return
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  const live = pids.filter(processIDIsRunning)
  if (live.length > 0) throw new Error(`${label} did not exit after cleanup: ${live.join(", ")}`)
}

function processIDIsRunning(processID: number): boolean {
  try {
    process.kill(processID, 0)
    return true
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ESRCH") return false
    return code === "EPERM"
  }
}

export async function terminateOwnedProcessTree(
  processHandle: ChildProcess,
  label: string,
  options: { graceMs?: number } = {},
): Promise<void> {
  const processID = processHandle.pid
  if (!processID) return
  const graceMs = options.graceMs ?? DEFAULT_TERMINATION_GRACE_MS

  if (process.platform === "win32") {
    await terminateWindowsProcessTree(processID, label, graceMs)
    if (await waitForRootExit(processHandle, graceMs)) return
    throw new Error(`${label} process ${processID} did not exit after taskkill`)
  }

  if (!processGroupIsRunning(processID)) return
  signalProcessGroup(processID, "SIGTERM")
  if (await waitForProcessGroupExit(processID, graceMs)) return
  signalProcessGroup(processID, "SIGKILL")
  if (await waitForProcessGroupExit(processID, graceMs)) return
  throw new Error(`${label} process group ${processID} did not exit after SIGKILL`)
}
