import fs from "fs"
import path from "path"
import { Global } from "../global"
import { Log } from "../util/log"

const log = Log.create({ service: "sidecar-lock" })

export namespace SidecarLock {
  export interface LockInfo {
    pid: number
    port: number
    hostname: string
    parentPid: number
    workspace: string
    startedAt: number
  }

  function lockFilePath(workspace: string): string {
    const safe = workspace.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80)
    return path.join(Global.Path.state, `sidecar.${safe}.lock`)
  }

  function isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch (err: any) {
      if (err?.code === "EPERM") return true
      return false
    }
  }

  /**
   * Detect a live managed sidecar already owning this workspace.
   * Returns the live LockInfo or null.
   *
   * NOTE: regular `opencorvus serve` daemons do not write this lock,
   * so they are not detected here. That gap is documented in §19.1.1
   * follow-up: detection of non-managed external daemons is deferred.
   * Managed sidecars never co-exist with another managed sidecar on the
   * same workspace, which is the immediate VSCode multi-window concern.
   */
  export function detectExisting(workspace: string): LockInfo | null {
    const file = lockFilePath(workspace)
    let raw: string
    try {
      raw = fs.readFileSync(file, "utf8")
    } catch {
      return null
    }
    let info: LockInfo
    try {
      info = JSON.parse(raw)
    } catch {
      log.warn("malformed lock file, treating as stale", { file })
      try { fs.unlinkSync(file) } catch {}
      return null
    }
    if (!isProcessAlive(info.pid)) {
      log.info("stale lock from dead pid, removing", { file, pid: info.pid })
      try { fs.unlinkSync(file) } catch {}
      return null
    }
    return info
  }

  /**
   * Write the lock file for this managed sidecar. Caller MUST call
   * release() before exiting; sidecar lifecycle hooks handle this.
   */
  export function acquire(info: LockInfo): { file: string; release: () => void } {
    const file = lockFilePath(info.workspace)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(info, null, 2), { encoding: "utf8" })
    log.info("acquired", { file, pid: info.pid, port: info.port })
    return {
      file,
      release: () => {
        try {
          const current = JSON.parse(fs.readFileSync(file, "utf8")) as LockInfo
          if (current.pid !== info.pid) return // not ours anymore
          fs.unlinkSync(file)
          log.info("released", { file })
        } catch (err) {
          log.warn("release failed", { file, error: String(err) })
        }
      },
    }
  }
}
