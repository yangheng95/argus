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

  type Factory = (opts: SpawnOptions) => Promise<Handle>
  type WindowsHelperResolver = () => Promise<string | undefined>

  let factory: Factory | undefined
  let windowsHelperResolver: WindowsHelperResolver | undefined

  export async function spawnShell(opts: SpawnOptions): Promise<Handle> {
    return await (factory ?? defaultSpawnShell)(opts)
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
    if (!helper) return spawnWindowsManagedShell(opts)
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
    const pid = await waitForPidFile(pidPath, helperHandle.exited, opts.command)
    return {
      ...helperHandle,
      pid,
      async dispose() {
        await helperHandle.dispose()
        await fs.rm(requestDir, { recursive: true, force: true }).catch(() => {})
      },
    }
  }

  function spawnWindowsManagedShell(opts: SpawnOptions): Handle {
    const proc = spawn(opts.command, {
      shell: opts.shell,
      cwd: opts.cwd,
      env: opts.env,
      stdio: [opts.stdin ?? "ignore", "pipe", "pipe"],
      windowsHide: true,
    })
    if (!proc.pid) throw new Error(`Failed to start process: ${opts.command}`)
    return childHandle(proc, { cleanupProcessGroup: false })
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
        await terminateProcessGroup(proc.pid!)
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

  async function terminateProcessGroup(pid: number) {
    try {
      process.kill(-pid, "SIGTERM")
      await Bun.sleep(SIGKILL_TIMEOUT_MS)
      try {
        process.kill(-pid, "SIGKILL")
      } catch {}
    } catch {}
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
      path.resolve(import.meta.dir, "../../native/process-supervisor/target/release", exe),
      path.resolve(import.meta.dir, "../../native/process-supervisor/target/debug", exe),
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
