import { Flag } from "@/flag/flag"
import { lazy } from "@/util/lazy"
import { Filesystem } from "@/util/filesystem"
import path from "path"
import { spawn, type ChildProcess } from "child_process"
import { which } from "@/util/which"
import { PidGuard } from "./pid-guard"

const SIGKILL_TIMEOUT_MS = 200

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
    /** OS PID of the spawned shell process. Surfaced so callers (tool wrappers,
     *  LLM output) can target it with `taskkill /T /PID <pid>` or `kill -TERM
     *  -<pid>` on a later turn — lets an agent cleanly kill a backgrounded
     *  child (`cmd & …`) instead of guessing the PID via netstat. Undefined
     *  only if spawn failed before a PID was assigned. */
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

  export async function killTree(proc: ChildProcess, opts?: { exited?: () => boolean; allowExitedRoot?: boolean }): Promise<void> {
    const pid = proc.pid
    if (!pid || (!opts?.allowExitedRoot && opts?.exited?.())) return

    if (process.platform === "win32") {
      const killed = await new Promise<boolean>((resolve) => {
        const killer = spawn("taskkill", ["/pid", String(pid), "/f", "/t"], { stdio: "ignore" })
        killer.once("exit", (code) => resolve(code === 0))
        killer.once("error", () => resolve(false))
      })
      if (!killed && !opts?.exited?.()) {
        proc.kill("SIGTERM")
        await Bun.sleep(SIGKILL_TIMEOUT_MS)
        if (!opts?.exited?.()) {
          proc.kill("SIGKILL")
        }
      }
      return
    }

    try {
      process.kill(-pid, "SIGTERM")
      await Bun.sleep(SIGKILL_TIMEOUT_MS)
      if (!opts?.exited?.()) {
        process.kill(-pid, "SIGKILL")
      }
    } catch (_e) {
      proc.kill("SIGTERM")
      await Bun.sleep(SIGKILL_TIMEOUT_MS)
      if (!opts?.exited?.()) {
        proc.kill("SIGKILL")
      }
    }
  }

  export async function run(command: string, opts: RunOptions = {}): Promise<RunResult> {
    const guardEnv = await PidGuard.env(acceptable())
    const proc = spawn(command, {
      shell: acceptable(),
      cwd: opts.cwd,
      env: { ...opts.env, ...guardEnv },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    })

    let stdout = ""
    let stderr = ""
    let timedOut = false
    let idleTimedOut = false
    let aborted = false
    let exited = false

    const kill = () => killTree(proc, { exited: () => exited })

    // ── Idle timeout: reset on every data event ──
    const idleMs = typeof opts.idleTimeoutMs === "number" && Number.isFinite(opts.idleTimeoutMs) && opts.idleTimeoutMs > 0
      ? opts.idleTimeoutMs
      : undefined
    let idleTimer: ReturnType<typeof setTimeout> | undefined

    function resetIdleTimer() {
      if (!idleMs) return
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        idleTimedOut = true
        void kill()
      }, idleMs)
      idleTimer.unref?.()
    }

    proc.stdout?.on("data", (chunk) => {
      stdout += chunk.toString()
      resetIdleTimer()
    })
    proc.stderr?.on("data", (chunk) => {
      stderr += chunk.toString()
      resetIdleTimer()
    })

    // Start idle timer after process launch
    resetIdleTimer()

    if (opts.abort?.aborted) {
      aborted = true
      await kill()
    }

    const abortHandler = () => {
      aborted = true
      void kill()
    }

    opts.abort?.addEventListener("abort", abortHandler, { once: true })

    // ── Hard wall-clock timeout (safety cap) ──
    const timeoutMs = typeof opts.timeoutMs === "number" && Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : undefined
    const timer = timeoutMs && timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true
          void kill()
        }, timeoutMs)
      : undefined
    timer?.unref?.()

    const exitCode = await new Promise<number>((resolve, reject) => {
      const cleanup = () => {
        if (timer) clearTimeout(timer)
        if (idleTimer) clearTimeout(idleTimer)
        opts.abort?.removeEventListener("abort", abortHandler)
      }

      proc.once("error", (error) => {
        exited = true
        cleanup()
        reject(error)
      })

      proc.once("exit", (code, signal) => {
        exited = true
        cleanup()
        resolve(code ?? (signal ? 1 : 0))
      })
    })

    return {
      exitCode,
      stdout,
      stderr,
      timedOut,
      idleTimedOut,
      aborted,
      pid: typeof proc.pid === "number" ? proc.pid : undefined,
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
   * the address/port, then unrefs the process so it keeps running independently.
   * Returns the PID and detected address (if any).
   */
  export async function launch(
    command: string,
    opts: { cwd?: string; env?: NodeJS.ProcessEnv; outputSniffMs?: number } = {},
  ): Promise<LaunchResult> {
    const { cwd, env, outputSniffMs = 8000 } = opts
    const guardEnv = await PidGuard.env(acceptable())
    const proc = spawn(command, {
      shell: acceptable(),
      cwd,
      env: { ...process.env, ...env, ...guardEnv },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    })

    if (!proc.pid) throw new Error(`Failed to start process: ${command}`)

    let initialOutput = ""
    let exited = false
    proc.stdout?.on("data", (chunk: Buffer) => { initialOutput += chunk.toString() })
    proc.stderr?.on("data", (chunk: Buffer) => { initialOutput += chunk.toString() })
    proc.once("exit", () => { exited = true })

    await new Promise((r) => setTimeout(r, outputSniffMs))

    if (exited) {
      throw new Error(
        `Process exited immediately after launch. Output:\n${initialOutput.slice(0, 1000)}`,
      )
    }

    proc.unref()

    const address = detectLaunchAddress(initialOutput)
    return { pid: proc.pid, address, initialOutput: initialOutput.slice(0, 2000) }
  }

  function detectLaunchAddress(output: string): string | undefined {
    // Match full http/https URLs first
    const urlMatch = output.match(/https?:\/\/[^\s\n"'><,]+/)
    if (urlMatch) return urlMatch[0].replace(/\/$/, "")
    // Match bare host:port
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
