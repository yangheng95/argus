import { Flag } from "@/flag/flag"
import { lazy } from "@/util/lazy"
import { Filesystem } from "@/util/filesystem"
import path from "path"
import { spawn, type ChildProcess } from "child_process"
import { which } from "@/util/which"

const SIGKILL_TIMEOUT_MS = 200

export namespace Shell {
  export interface RunOptions {
    cwd?: string
    env?: NodeJS.ProcessEnv
    timeoutMs?: number
    abort?: AbortSignal
  }

  export interface RunResult {
    exitCode: number
    stdout: string
    stderr: string
    timedOut: boolean
    aborted: boolean
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

  export async function killTree(proc: ChildProcess, opts?: { exited?: () => boolean }): Promise<void> {
    const pid = proc.pid
    if (!pid || opts?.exited?.()) return

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
    const proc = spawn(command, {
      shell: acceptable(),
      cwd: opts.cwd,
      env: opts.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    })

    let stdout = ""
    let stderr = ""
    let timedOut = false
    let aborted = false
    let exited = false

    proc.stdout?.on("data", (chunk) => {
      stdout += chunk.toString()
    })
    proc.stderr?.on("data", (chunk) => {
      stderr += chunk.toString()
    })

    const kill = () => killTree(proc, { exited: () => exited })

    if (opts.abort?.aborted) {
      aborted = true
      await kill()
    }

    const abortHandler = () => {
      aborted = true
      void kill()
    }

    opts.abort?.addEventListener("abort", abortHandler, { once: true })

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
      aborted,
    }
  }

  const BLACKLIST = new Set(["fish", "nu"])

  function fallback() {
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

  export const preferred = lazy(() => {
    const s = process.env.SHELL
    if (s) return s
    return fallback()
  })

  export const acceptable = lazy(() => {
    const s = process.env.SHELL
    if (s && !BLACKLIST.has(process.platform === "win32" ? path.win32.basename(s) : path.basename(s))) return s
    return fallback()
  })
}
