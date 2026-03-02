import { Flag } from "@/flag/flag"
import { lazy } from "@/util/lazy"
import { Filesystem } from "@/util/filesystem"
import path from "path"
import { spawn, type ChildProcess } from "child_process"

const SIGKILL_TIMEOUT_MS = 200

export namespace Shell {
  function firstExisting(paths: Array<string | null | undefined>) {
    for (const item of paths) {
      if (!item) continue
      if (Filesystem.stat(item)?.size) return item
    }
  }

  function gitBashCandidates() {
    const fromGit = (() => {
      const git = Bun.which("git")
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

    const genericBash = [Bun.which("bash.exe"), Bun.which("bash")].filter((item): item is string => {
      if (!item) return false
      return !item.toLowerCase().endsWith("\\windows\\system32\\bash.exe")
    })

    return [
      ...fromGit,
      ...fromCommonInstalls,
      ...genericBash,
    ]
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
  const BLACKLIST = new Set(["fish", "nu"])

  function fallback() {
    if (process.platform === "win32") {
      const bash = firstExisting([Flag.ARGUS_GIT_BASH_PATH, ...gitBashCandidates()])
      if (bash) return bash
      return process.env.COMSPEC || "cmd.exe"
    }
    if (process.platform === "darwin") {
      const zsh = Bun.which("zsh")
      if (zsh) return zsh
      return "/bin/zsh"
    }
    const bash = Bun.which("bash")
    if (bash) return bash
    const sh = Bun.which("sh")
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
