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
   *
   * audit-2026-04-29 opencorvus F2 — uses O_EXCL (`flag: "wx"`) so the
   * lock acquisition is atomic: two sidecars racing to write the same
   * file get exactly one winner; the loser sees EEXIST. The caller
   * (sidecar.ts) detects existing locks via `detectExisting` first;
   * but between the check and the write, another sidecar could have
   * just written its own lock — without exclusive create the loser
   * silently overwrites the winner, breaking §19.1.1.
   *
   * Throws SidecarLockContendedError on EEXIST so the caller can map
   * to exit code 3 with the same message path as the regular
   * "existing instance" rejection.
   */
  export class SidecarLockContendedError extends Error {
    override readonly name = "SidecarLockContendedError"
    constructor(public readonly file: string, public readonly existing: LockInfo | null) {
      super(
        existing
          ? `existing managed sidecar holds the workspace lock (PID=${existing.pid}, port=${existing.port})`
          : `another sidecar is racing to acquire the workspace lock (file=${file})`,
      )
    }
  }

  export function acquire(info: LockInfo): { file: string; release: () => void } {
    const file = lockFilePath(info.workspace)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    try {
      fs.writeFileSync(file, JSON.stringify(info, null, 2), {
        encoding: "utf8",
        flag: "wx",
      })
    } catch (err: any) {
      if (err?.code === "EEXIST") {
        // The pre-check (detectExisting) already auto-pruned dead
        // PIDs, so a live lock here is genuine contention. Read it
        // back so the caller has the live PID for the error message.
        let existing: LockInfo | null = null
        try {
          existing = JSON.parse(fs.readFileSync(file, "utf8")) as LockInfo
        } catch {}
        throw new SidecarLockContendedError(file, existing)
      }
      throw err
    }
    log.info("acquired", { file, pid: info.pid, port: info.port })
    return {
      file,
      release: () => {
        // audit-2026-04-29 W2-V3 — retry release a few times on
        // EBUSY / EPERM / transient IO. Without retry, a Windows AV
        // that briefly opens the lock file forces the release to
        // fail; the sidecar then exits and leaves the lock orphaned
        // until `detectExisting` auto-prunes via the dead-PID path.
        // During that window, a new sidecar boot sees the stale
        // lock and exits 3 with a confusing "another instance" hint.
        const MAX_ATTEMPTS = 3
        let lastErr: unknown
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          try {
            const current = JSON.parse(fs.readFileSync(file, "utf8")) as LockInfo
            if (current.pid !== info.pid) return // not ours anymore
            fs.unlinkSync(file)
            log.info("released", { file })
            return
          } catch (err: any) {
            lastErr = err
            if (err?.code === "ENOENT") return // already gone — fine
            if (attempt < MAX_ATTEMPTS) {
              // Synchronous tiny back-off; the sidecar is in
              // shutdown so we want to finish quickly.
              const until = Date.now() + 50
              while (Date.now() < until) { /* spin */ }
            }
          }
        }
        log.warn("release failed after retries", { file, attempts: MAX_ATTEMPTS, error: String(lastErr) })
      },
    }
  }
}
