import { Flag } from "@/flag/flag"
import { lazy } from "@/util/lazy"
import { Filesystem } from "@/util/filesystem"
import path from "path"
import { which } from "@/util/which"
import { PidGuard } from "./pid-guard"
import { ProcessSupervisor } from "./process-supervisor"

export namespace Shell {
  export interface RunOptions {
    cwd?: string
    env?: NodeJS.ProcessEnv
    /** Hard wall-clock timeout (ms). Process killed after this regardless of activity. */
    timeoutMs?: number
    /**
     * Inactivity timeout (ms). Timer resets on every stdout/stderr data event.
     * When triggered, `idleTimedOut` is set on the result. Use for commands that
     * may be long-running servers: they start, produce output, then go idle.
     */
    idleTimeoutMs?: number
    abort?: AbortSignal
  }

  export interface RunResult {
    exitCode: number
    stdout: string
    stderr: string
    /** True when hard wall-clock timeoutMs was reached. */
    timedOut: boolean
    /** True when idleTimeoutMs of inactivity was reached (process went quiet). */
    idleTimedOut: boolean
    aborted: boolean
    /** Diagnostic PID of the supervised shell root. Cleanup is owned by the
     * process supervisor, not by later PID-tree commands. */
    pid?: number
  }

  function firstExisting(paths: Array<string | null | undefined>) {
    for (const item of paths) {
      if (!item) continue
      if (Filesystem.stat(item)?.size) return item
    }
  }

  function gitBashCandidates() {
    const fromGit = (() => {
      const git = which("git")
      if (!git) return []
      const gitDir = path.dirname(git)
      return [path.resolve(gitDir, "..", "bin", "bash.exe"), path.resolve(gitDir, "..", "usr", "bin", "bash.exe")]
    })()

    const installRoots = [
      process.env.ProgramW6432,
      process.env.ProgramFiles,
      process.env["ProgramFiles(x86)"],
      process.env.LocalAppData,
      process.env.ChocolateyInstall,
    ].filter((value): value is string => Boolean(value))

    const fromCommonInstalls = installRoots.flatMap((root) => [
      path.join(root, "Git", "bin", "bash.exe"),
      path.join(root, "Git", "usr", "bin", "bash.exe"),
    ])

    const genericBash = [which("bash.exe"), which("bash")].filter((item): item is string => {
      if (!item) return false
      return !item.toLowerCase().endsWith("\\windows\\system32\\bash.exe")
    })

    return [...fromGit, ...fromCommonInstalls, ...genericBash]
  }

  export async function run(command: string, opts: RunOptions = {}): Promise<RunResult> {
    const shell = acceptable()
    const guardEnv = await PidGuard.env(shell)
    const supervisor = await ProcessSupervisor.spawnShell({
      command,
      shell,
      cwd: opts.cwd,
      env: { ...opts.env, ...guardEnv },
    })

    let stdout = ""
    let stderr = ""
    let timedOut = false
    let idleTimedOut = false
    let aborted = false

    const terminate = () => supervisor.terminate()

    const idleMs = typeof opts.idleTimeoutMs === "number" && Number.isFinite(opts.idleTimeoutMs) && opts.idleTimeoutMs > 0
      ? opts.idleTimeoutMs
      : undefined
    let idleTimer: ReturnType<typeof setTimeout> | undefined

    function resetIdleTimer() {
      if (!idleMs) return
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        idleTimedOut = true
        void terminate()
      }, idleMs)
      idleTimer.unref?.()
    }

    supervisor.stdout?.on("data", (chunk) => {
      stdout += chunk.toString()
      resetIdleTimer()
    })
    supervisor.stderr?.on("data", (chunk) => {
      stderr += chunk.toString()
      resetIdleTimer()
    })

    resetIdleTimer()

    if (opts.abort?.aborted) {
      aborted = true
      await terminate()
    }

    const abortHandler = () => {
      aborted = true
      void terminate()
    }
    opts.abort?.addEventListener("abort", abortHandler, { once: true })

    const timeoutMs = typeof opts.timeoutMs === "number" && Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : undefined
    const timer = timeoutMs && timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true
          void terminate()
        }, timeoutMs)
      : undefined
    timer?.unref?.()

    try {
      const exitCode = await supervisor.exited
      return {
        exitCode,
        stdout,
        stderr,
        timedOut,
        idleTimedOut,
        aborted,
        pid: supervisor.pid,
      }
    } finally {
      if (timer) clearTimeout(timer)
      if (idleTimer) clearTimeout(idleTimer)
      opts.abort?.removeEventListener("abort", abortHandler)
      await supervisor.dispose()
    }
  }

  export interface LaunchResult {
    pid: number
    address?: string
    initialOutput: string
  }

  /**
   * Launch a long-running process in the background.
   *
   * Spawns the process, collects initial output for `outputSniffMs` to detect
   * the address/port, then unrefs the supervisor so it keeps running under the
   * same ownership boundary. Returns the diagnostic PID and detected address.
   */
  export async function launch(
    command: string,
    opts: { cwd?: string; env?: NodeJS.ProcessEnv; outputSniffMs?: number } = {},
  ): Promise<LaunchResult> {
    const { cwd, env, outputSniffMs = 8000 } = opts
    const shell = acceptable()
    const guardEnv = await PidGuard.env(shell)
    const supervisor = await ProcessSupervisor.spawnShell({
      command,
      shell,
      cwd,
      env: { ...process.env, ...env, ...guardEnv },
    })

    let initialOutput = ""
    let exited = false
    supervisor.stdout?.on("data", (chunk: Buffer) => { initialOutput += chunk.toString() })
    supervisor.stderr?.on("data", (chunk: Buffer) => { initialOutput += chunk.toString() })
    supervisor.exited.then(() => { exited = true }, () => { exited = true })

    await new Promise((r) => setTimeout(r, outputSniffMs))

    if (exited) {
      await supervisor.dispose()
      throw new Error(
        `Process exited immediately after launch. Output:\n${initialOutput.slice(0, 1000)}`,
      )
    }

    supervisor.unref()

    const address = detectLaunchAddress(initialOutput)
    return { pid: supervisor.pid, address, initialOutput: initialOutput.slice(0, 2000) }
  }

  function detectLaunchAddress(output: string): string | undefined {
    const urlMatch = output.match(/https?:\/\/[^\s\n"'><,]+/)
    if (urlMatch) return urlMatch[0].replace(/\/$/, "")
    const hostPortMatch = output.match(/(?:localhost|0\.0\.0\.0|127\.0\.0\.1):\d{2,5}/)
    if (hostPortMatch) return `http://${hostPortMatch[0]}`
  }

  const BLACKLIST = new Set(["fish", "nu"])

  function platformDefault() {
    if (process.platform === "win32") {
      const bash = firstExisting([Flag.OPENCORVUS_GIT_BASH_PATH, ...gitBashCandidates()])
      if (bash) return bash
      return process.env.COMSPEC || "cmd.exe"
    }
    if (process.platform === "darwin") {
      const zsh = which("zsh")
      if (zsh) return zsh
      return "/bin/zsh"
    }
    const bash = which("bash")
    if (bash) return bash
    const sh = which("sh")
    if (sh) return sh
    return "/bin/sh"
  }

  export function fromEnv(shell: string | undefined, platform: NodeJS.Platform): string | undefined {
    if (!shell) return undefined
    if (platform === "win32") {
      const base = path.win32.basename(shell).toLowerCase()
      if (base === "powershell.exe" || base === "pwsh.exe" || base === "cmd.exe") return undefined
    }
    return shell
  }

  export const preferred = lazy(() => {
    const s = fromEnv(process.env.SHELL, process.platform)
    if (s) return s
    return platformDefault()
  })

  export const acceptable = lazy(() => {
    const s = fromEnv(process.env.SHELL, process.platform)
    if (s && !BLACKLIST.has(process.platform === "win32" ? path.win32.basename(s) : path.basename(s))) return s
    return platformDefault()
  })
}
