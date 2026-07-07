import { spawn, spawnSync, type ChildProcess } from "child_process"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Filesystem } from "@/util/filesystem"
import { which } from "@/util/which"

const SIGKILL_TIMEOUT_MS = 200

export namespace ProcessSupervisor {
  export interface SpawnOptions {
    command: string
    shell: string
    cwd?: string
    env?: NodeJS.ProcessEnv
    stdin?: "ignore" | "pipe"
    requireProcessTreeCleanup?: boolean
  }

  export interface Handle {
    pid: number
    stdin: NodeJS.WritableStream | null
    stdout: NodeJS.ReadableStream | null
    stderr: NodeJS.ReadableStream | null
    exited: Promise<number>
    terminate(): Promise<void>
    dispose(): Promise<void>
    unref(): void
  }

  export const TERMINATION_CLEANUP_TIMEOUT_MS = 5_000
  export const TERMINATION_EXIT_TIMEOUT_MS = 1_000

  type Factory = (opts: SpawnOptions) => Promise<Handle>
  type WindowsHelperResolver = () => Promise<string | undefined>
  type LiveHandle = {
    id: number
    pid: number
    cwd: string
    handle: Handle
  }

  let factory: Factory | undefined
  let windowsHelperResolver: WindowsHelperResolver | undefined
  let nextLiveHandleID = 1
  const liveHandles = new Map<number, LiveHandle>()

  export async function spawnShell(opts: SpawnOptions): Promise<Handle> {
    const handle = await (factory ?? defaultSpawnShell)(opts)
    return trackLiveHandle(opts, handle)
  }

  export async function disposeLiveProcessesUnder(directory: string): Promise<{ disposed: number; pids: number[] }> {
    const target = normalizeCwd(directory)
    const matches = Array.from(liveHandles.values()).filter((entry) => Filesystem.contains(target, entry.cwd))
    const results = await Promise.allSettled(matches.map((entry) => entry.handle.dispose()))
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected")
    if (failures.length > 0) {
      const details = failures.map((failure) => String(failure.reason)).join("; ")
      throw new Error(
        `Failed to dispose ${failures.length}/${matches.length} live supervised process(es) under ${directory}: ${details}`,
      )
    }
    return { disposed: matches.length, pids: matches.map((entry) => entry.pid) }
  }

  export function setFactoryForTest(next: Factory | undefined) {
    const previous = factory
    factory = next
    return () => {
      factory = previous
    }
  }

  export function setWindowsHelperResolverForTest(next: WindowsHelperResolver | undefined) {
    const previous = windowsHelperResolver
    windowsHelperResolver = next
    return () => {
      windowsHelperResolver = previous
    }
  }

  async function defaultSpawnShell(opts: SpawnOptions): Promise<Handle> {
    if (process.platform === "win32") return await spawnWindows(opts)
    return spawnUnix(opts)
  }

  function normalizeCwd(cwd: string) {
    return path.resolve(Filesystem.windowsPath(cwd))
  }

  function trackLiveHandle(opts: SpawnOptions, handle: Handle): Handle {
    if (!opts.cwd) return handle
    const id = nextLiveHandleID++
    const cwd = normalizeCwd(opts.cwd)
    let unregistered = false
    const unregister = () => {
      if (unregistered) return
      unregistered = true
      liveHandles.delete(id)
    }
    const tracked: Handle = {
      pid: handle.pid,
      stdin: handle.stdin,
      stdout: handle.stdout,
      stderr: handle.stderr,
      exited: handle.exited,
      terminate: () => handle.terminate(),
      dispose: async () => {
        await handle.dispose()
        unregister()
      },
      unref: () => handle.unref(),
    }
    liveHandles.set(id, { id, pid: handle.pid, cwd, handle: tracked })
    return tracked
  }

  export async function awaitWithTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error(message)), timeoutMs)
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  export async function terminateAndWaitForExit(
    handle: Handle,
    label: string,
    opts: { cleanupTimeoutMs?: number; exitTimeoutMs?: number } = {},
  ): Promise<number> {
    const cleanupTimeoutMs = opts.cleanupTimeoutMs ?? TERMINATION_CLEANUP_TIMEOUT_MS
    const exitTimeoutMs = opts.exitTimeoutMs ?? TERMINATION_EXIT_TIMEOUT_MS
    await awaitWithTimeout(
      handle.terminate(),
      cleanupTimeoutMs,
      `${label} terminate cleanup did not finish within ${cleanupTimeoutMs}ms`,
    )
    return await awaitWithTimeout(
      handle.exited,
      exitTimeoutMs,
      `${label} terminate cleanup completed but process did not exit within ${exitTimeoutMs}ms`,
    )
  }

  export async function disposeAndWaitForExit(
    handle: Handle,
    label: string,
    opts: { cleanupTimeoutMs?: number; exitTimeoutMs?: number } = {},
  ): Promise<number> {
    const cleanupTimeoutMs = opts.cleanupTimeoutMs ?? TERMINATION_CLEANUP_TIMEOUT_MS
    const exitTimeoutMs = opts.exitTimeoutMs ?? TERMINATION_EXIT_TIMEOUT_MS
    await awaitWithTimeout(
      handle.dispose(),
      cleanupTimeoutMs,
      `${label} dispose cleanup did not finish within ${cleanupTimeoutMs}ms`,
    )
    return await awaitWithTimeout(
      handle.exited,
      exitTimeoutMs,
      `${label} dispose cleanup completed but process did not exit within ${exitTimeoutMs}ms`,
    )
  }

  export async function terminateProcessTree(pid: number, label = `process ${pid}`): Promise<void> {
    if (!Number.isInteger(pid) || pid <= 0) throw new Error(`${label} has invalid process id ${pid}`)
    if (process.platform === "win32") {
      await terminateWindowsProcessTree(pid, label)
      return
    }
    await terminatePosixProcessTree(pid, label)
  }

  export async function terminateProcessGroup(pid: number, label = `process group ${pid}`): Promise<void> {
    if (!Number.isInteger(pid) || pid <= 0) throw new Error(`${label} has invalid process group id ${pid}`)
    if (process.platform === "win32") {
      await terminateWindowsProcessTree(pid, label)
      return
    }
    await terminatePosixProcessGroup(pid, label)
  }

  function spawnUnix(opts: SpawnOptions): Handle {
    const proc = spawn(opts.command, {
      shell: opts.shell,
      cwd: opts.cwd,
      env: opts.env,
      stdio: [opts.stdin ?? "ignore", "pipe", "pipe"],
      detached: true,
    })
    if (!proc.pid) throw new Error(`Failed to start process: ${opts.command}`)
    return childHandle(proc, { cleanupProcessGroup: true })
  }

  async function spawnWindows(opts: SpawnOptions): Promise<Handle> {
    const helper = await resolveWindowsHelper()
    if (!helper) {
      throw new Error("Windows process supervisor helper is required for process-tree cleanup")
    }
    const requestDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-supervisor-"))
    const requestPath = path.join(requestDir, "request.json")
    const pidPath = path.join(requestDir, "pid.txt")
    await fs.writeFile(
      requestPath,
      JSON.stringify({
        command: opts.command,
        shell: opts.shell,
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        pid_file: pidPath,
      }),
      "utf8",
    )
    const proc = spawn(helper, ["--request", requestPath], {
      stdio: [opts.stdin ?? "ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    const helperHandle = childHandle(proc, { cleanupProcessGroup: false })
    let pid: number
    try {
      pid = await waitForPidFile(pidPath, helperHandle.exited, opts.command)
    } catch (error) {
      await helperHandle.dispose().catch(() => undefined)
      await fs.rm(requestDir, { recursive: true, force: true }).catch(() => {})
      throw error
    }
    let terminated = false
    let disposed = false
    const terminate = async () => {
      if (terminated) return
      terminated = true
      let firstError: unknown
      try {
        await terminateProcessTree(pid, `Windows supervised process tree ${pid}`)
      } catch (error) {
        firstError = error
      }
      try {
        await helperHandle.terminate()
      } catch (error) {
        if (!firstError) firstError = error
      }
      if (firstError) throw firstError
    }

    const dispose = async () => {
      if (disposed) return
      disposed = true
      let firstError: unknown
      try {
        await terminate()
      } catch (error) {
        firstError = error
      }
      await helperHandle.exited.catch(() => undefined)
      await fs.rm(requestDir, { recursive: true, force: true }).catch(() => {})
      if (firstError) throw firstError
    }

    return {
      ...helperHandle,
      pid,
      terminate,
      dispose,
    }
  }

  function childHandle(proc: ChildProcess, opts: { cleanupProcessGroup: boolean }): Handle {
    if (!proc.pid) throw new Error("Process supervisor child has no pid")
    let disposed = false
    let terminated = false
    let settled = false
    const exited = new Promise<number>((resolve, reject) => {
      proc.once("exit", (code, signal) => {
        settled = true
        resolve(code ?? (signal ? 1 : 0))
      })
      proc.once("error", (error) => {
        settled = true
        reject(error)
      })
    })

    const terminate = async () => {
      if (terminated) return
      terminated = true
      if (opts.cleanupProcessGroup) {
        await terminateProcessGroup(proc.pid!, `process group ${proc.pid}`)
        return
      }
      if (!settled && proc.exitCode === null && proc.signalCode === null) {
        proc.kill("SIGTERM")
        await Bun.sleep(SIGKILL_TIMEOUT_MS)
        if (!settled && proc.exitCode === null && proc.signalCode === null) {
          proc.kill("SIGKILL")
        }
      }
    }

    const dispose = async () => {
      if (disposed) return
      disposed = true
      await terminate()
      await exited.catch(() => undefined)
    }

    return {
      pid: proc.pid,
      stdin: proc.stdin,
      stdout: proc.stdout,
      stderr: proc.stderr,
      exited,
      terminate,
      dispose,
      unref() {
        proc.unref?.()
        ;(proc.stdout as unknown as { unref?: () => void } | null)?.unref?.()
        ;(proc.stderr as unknown as { unref?: () => void } | null)?.unref?.()
      },
    }
  }

  function processGroupIsRunning(pid: number) {
    try {
      process.kill(-pid, 0)
      return true
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === "ESRCH") return false
      return code === "EPERM"
    }
  }

  function signalProcessGroupIfRunning(pid: number, signal: NodeJS.Signals) {
    try {
      process.kill(-pid, signal)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return
      throw error
    }
  }

  async function terminatePosixProcessGroup(pid: number, label: string) {
    if (!processGroupIsRunning(pid)) return
    signalProcessGroupIfRunning(pid, "SIGTERM")
    await Bun.sleep(SIGKILL_TIMEOUT_MS)
    if (processGroupIsRunning(pid)) signalProcessGroupIfRunning(pid, "SIGKILL")
    await Bun.sleep(SIGKILL_TIMEOUT_MS)
    if (processGroupIsRunning(pid)) throw new Error(`${label} did not exit after SIGKILL`)
  }

  function processIsRunning(pid: number) {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM"
    }
  }

  async function waitForProcessExit(pid: number, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (!processIsRunning(pid)) return true
      await Bun.sleep(20)
    }
    return !processIsRunning(pid)
  }

  function killIfRunning(pid: number, signal: NodeJS.Signals) {
    try {
      process.kill(pid, signal)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return
      throw error
    }
  }

  function childPids(pid: number): number[] {
    const result = spawnSync("pgrep", ["-P", String(pid)], {
      encoding: "utf8",
    })
    if (result.error) throw result.error
    if (result.status === 1) return []
    if (result.status !== 0) {
      const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim()
      throw new Error(detail || `pgrep failed while inspecting child processes for ${pid}`)
    }
    return result.stdout
      .split(/\r?\n/)
      .map((line) => Number(line.trim()))
      .filter((value) => Number.isInteger(value) && value > 0)
  }

  function descendantPids(pid: number): number[] {
    const result: number[] = []
    const visit = (current: number) => {
      for (const child of childPids(current)) {
        result.push(child)
        visit(child)
      }
    }
    visit(pid)
    return result
  }

  async function terminatePosixProcessTree(pid: number, label: string) {
    const descendants = descendantPids(pid)
    for (const target of [...descendants].reverse()) killIfRunning(target, "SIGTERM")
    killIfRunning(pid, "SIGTERM")
    await Bun.sleep(SIGKILL_TIMEOUT_MS)
    const targets = [pid, ...descendants]
    const stillRunning = targets.filter(processIsRunning)
    for (const target of stillRunning.reverse()) killIfRunning(target, "SIGKILL")
    await Bun.sleep(SIGKILL_TIMEOUT_MS)
    const survivors = targets.filter(processIsRunning)
    if (survivors.length > 0) throw new Error(`${label} did not exit after SIGKILL: ${survivors.join(", ")}`)
  }

  async function terminateWindowsProcessTree(pid: number, label: string) {
    const helper = await resolveWindowsHelper()
    if (!helper) {
      throw new Error("Windows process supervisor helper is required for process-tree cleanup")
    }
    await runWindowsProcessTreeCleanup(helper, pid, label)
  }

  async function runWindowsProcessTreeCleanup(helper: string, pid: number, label: string) {
    const proc = spawn(helper, ["--kill-tree", String(pid)], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    let stdout = ""
    let stderr = ""
    proc.stdout?.setEncoding("utf8")
    proc.stderr?.setEncoding("utf8")
    proc.stdout?.on("data", (chunk) => {
      stdout += chunk
    })
    proc.stderr?.on("data", (chunk) => {
      stderr += chunk
    })

    const exited = new Promise<number>((resolve, reject) => {
      proc.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)))
      proc.once("error", reject)
    })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      proc.kill("SIGKILL")
    }, TERMINATION_CLEANUP_TIMEOUT_MS)
    try {
      const code = await exited
      if (timedOut) {
        throw new Error(`${label} Windows process tree cleanup timed out after ${TERMINATION_CLEANUP_TIMEOUT_MS}ms`)
      }
      if (code !== 0) {
        const detail = [stderr, stdout].filter(Boolean).join("\n").trim()
        throw new Error(detail || `${label} Windows process tree cleanup failed with exit code ${code}`)
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async function waitForPidFile(pidPath: string, exited: Promise<number>, command: string): Promise<number> {
    const deadline = Date.now() + 5_000
    let exitCode: number | undefined
    exited
      .then((code) => {
        exitCode = code
      })
      .catch(() => {
        exitCode = 125
      })
    while (Date.now() < deadline) {
      const text = await fs.readFile(pidPath, "utf8").catch(() => undefined)
      const pid = text ? Number(text.trim()) : NaN
      if (Number.isInteger(pid) && pid > 0) return pid
      if (exitCode !== undefined) {
        throw new Error(`Windows process supervisor exited before starting command '${command}' (exit=${exitCode})`)
      }
      await Bun.sleep(20)
    }
    throw new Error(`Windows process supervisor did not report a PID for command '${command}'`)
  }

  async function resolveWindowsHelper(): Promise<string | undefined> {
    if (windowsHelperResolver) return await windowsHelperResolver()

    const envPath = process.env.OPENCORVUS_PROCESS_SUPERVISOR
    if (envPath && Filesystem.stat(envPath)?.size) return envPath

    const exe = "opencorvus-process-supervisor.exe"
    const execDir = path.dirname(process.execPath)
    const candidates = [
      path.join(execDir, exe),
      path.join(execDir, "bin", exe),
      path.join(path.dirname(execDir), exe),
      path.join(path.dirname(execDir), "bin", exe),
      path.resolve(import.meta.dir, "../../native/process-supervisor/target/debug", exe),
      path.resolve(import.meta.dir, "../../native/process-supervisor/target/release", exe),
    ]
    for (const candidate of candidates) {
      if (Filesystem.stat(candidate)?.size) return candidate
    }

    const manifest = path.resolve(import.meta.dir, "../../native/process-supervisor/Cargo.toml")
    const cargo = which("cargo")
    if (cargo && Filesystem.stat(manifest)?.size) {
      const result = spawnSync(cargo, ["build", "--manifest-path", manifest], { stdio: "ignore" })
      const debug = path.resolve(import.meta.dir, "../../native/process-supervisor/target/debug", exe)
      if (result.status === 0 && Filesystem.stat(debug)?.size) return debug
    }

    return undefined
  }
}
